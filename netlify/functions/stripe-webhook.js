'use strict';

const crypto        = require('crypto');
const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { findService } = require('./lib/services');

function rawBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function verifyStripeSignature(signatureHeader, payload, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map(part => {
    const idx = part.indexOf('=');
    return idx > -1 ? [part.slice(0, idx), part.slice(idx + 1)] : [part, ''];
  }));
  const timestamp = parts.t;
  const signatures = signatureHeader.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!timestamp || !signatures.length) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + payload)
    .digest('hex');

  return signatures.some(sig => {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function isWaiverDone(session) {
  return session?.waiver_completed === true || ['complete', 'completed', 'signed'].includes(String(session?.waiver_status || '').toLowerCase());
}

async function markPayment(sb, sessionId, event, checkout) {
  const { data: session, error } = await sb
    .from('sessions')
    .select('id, status, service, waiver_status, waiver_completed, client_id, client_name, amount_due, amount_paid, payment_status')
    .eq('id', sessionId)
    .single();

  if (error || !session) throw new Error('Session not found.');

  const service = findService(session.service);
  const expectedCents = Math.round(Number(session.amount_due) * 100);
  const catalogCents = service ? Math.round(Number(service.price) * 100) : NaN;
  const actualCents = Number(checkout.amount_total);
  if (!service || !Number.isFinite(expectedCents) || expectedCents !== catalogCents) throw new Error('Booking amount does not match the server service catalog.');
  if (actualCents !== expectedCents) throw new Error('Stripe payment amount does not match the booking.');
  if (String(checkout.currency || '').toLowerCase() !== 'usd') throw new Error('Stripe payment currency does not match USD.');
  if (checkout.metadata?.service_id && checkout.metadata.service_id !== service.id) throw new Error('Stripe service does not match the booking.');
  if (checkout.payment_status !== 'paid') throw new Error('Stripe has not confirmed this payment as paid.');

  const amountPaid = checkout.amount_total != null ? Number(checkout.amount_total) / 100 : Number(session.amount_due || 0);
  const waiverDone = isWaiverDone(session);
  const updates = {
    payment_status: 'paid',
    amount_paid: amountPaid,
    payment_paid_at: new Date().toISOString(),
    stripe_checkout_session_id: checkout.id || null,
    stripe_payment_intent_id: checkout.payment_intent || null,
    stripe_payment_status: checkout.payment_status || 'paid',
    booking_status: waiverDone ? 'ready' : 'payment_paid',
    updated_at: new Date().toISOString(),
  };

  const { error: updateErr } = await sb.from('sessions').update(updates).eq('id', sessionId);
  if (updateErr) throw updateErr;

  await recordStripePayment(sb, {
    session_id: sessionId,
    client_id: session.client_id || null,
    client_name: session.client_name || null,
    amount: amountPaid,
    method: 'stripe',
    status: 'received',
    paid_at: new Date().toISOString(),
    reference_id: checkout.payment_intent || checkout.id || event.id,
    notes: 'Stripe Checkout',
  });

  return { updated: true };
}

// Postgres cannot infer the partial Stripe-only unique index through
// PostgREST's onConflict=reference_id upsert. Use an explicit lookup followed
// by insert/update instead. The partial unique index remains the final race
// guard, so duplicate webhook deliveries still converge on one ledger row
// without changing any historical non-Stripe references.
async function recordStripePayment(sb, row) {
  const referenceId = row.reference_id;
  if (!referenceId) throw new Error('Stripe payment is missing a reference ID.');

  const { data: existing, error: lookupError } = await sb
    .from('payments')
    .select('id')
    .eq('method', 'stripe')
    .eq('reference_id', referenceId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { error: updateError } = await sb
      .from('payments')
      .update(row)
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return { id: existing.id, created: false };
  }

  const { data: inserted, error: insertError } = await sb
    .from('payments')
    .insert(row)
    .select('id')
    .single();
  if (!insertError) return { id: inserted.id, created: true };
  if (insertError.code !== '23505') throw insertError;

  // A concurrent delivery won the insert race. Resolve the row through the
  // same Stripe-only key and update it to the authoritative event state.
  const { data: raced, error: racedError } = await sb
    .from('payments')
    .select('id')
    .eq('method', 'stripe')
    .eq('reference_id', referenceId)
    .single();
  if (racedError) throw racedError;
  const { error: retryUpdateError } = await sb
    .from('payments')
    .update(row)
    .eq('id', raced.id);
  if (retryUpdateError) throw retryUpdateError;
  return { id: raced.id, created: false };
}

async function markPaymentProblem(sb, checkout, status) {
  const sessionId = checkout?.metadata?.session_id || checkout?.metadata?.booking_id || checkout?.client_reference_id;
  if (!sessionId) throw new Error('Stripe event is missing a booking ID.');
  const isPaymentIntent = checkout.object === 'payment_intent';
  const updates = {
    payment_status: status,
    stripe_checkout_session_id: isPaymentIntent ? undefined : (checkout.id || null),
    stripe_payment_intent_id: isPaymentIntent ? (checkout.id || null) : (checkout.payment_intent || null),
    stripe_payment_status: checkout.payment_status || status,
    booking_status: status === 'expired' ? 'payment_expired' : 'payment_failed',
    updated_at: new Date().toISOString(),
  };
  Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);
  const { error } = await sb.from('sessions').update(updates).eq('id', sessionId);
  if (error) throw error;
}

async function claimEvent(sb, stripeEvent) {
  const now = new Date().toISOString();
  const { error } = await sb.from('stripe_webhook_events').insert({ id: stripeEvent.id, type: stripeEvent.type, state: 'processing', received_at: now, processing_started_at: now, attempt_count: 1, payload: stripeEvent });
  if (!error) return true;
  if (error.code !== '23505') throw error;
  const { data, error: readError } = await sb.from('stripe_webhook_events').select('state, attempt_count').eq('id', stripeEvent.id).single();
  if (readError) throw readError;
  if (data.state === 'processed') return false;
  if (data.state === 'processing') throw new Error('Stripe event is already being processed.');
  const { error: retryError } = await sb.from('stripe_webhook_events').update({ state: 'processing', processing_error: null, processing_started_at: now, attempt_count: Number(data.attempt_count || 0) + 1 }).eq('id', stripeEvent.id).neq('state', 'processed');
  if (retryError) throw retryError;
  return true;
}

async function reconcileRefund(sb, charge) {
  if (!charge.payment_intent) throw new Error('Refunded charge is missing its PaymentIntent.');
  const full = Number(charge.amount || 0) > 0 && Number(charge.amount_refunded || 0) >= Number(charge.amount);
  const now = new Date().toISOString();
  const refundId = charge.refunds?.data?.[0]?.id || null;
  const updates = { refunded_amount: Number(charge.amount_refunded || 0) / 100, refund_status: full ? 'full' : 'partial', refund_updated_at: now, stripe_charge_id: charge.id || null, stripe_refund_id: refundId, stripe_payment_status: full ? 'refunded' : 'partially_refunded', updated_at: now };
  if (full) Object.assign(updates, { payment_status: 'refunded', booking_status: 'payment_refunded' });
  const { error } = await sb.from('sessions').update(updates).eq('stripe_payment_intent_id', charge.payment_intent);
  if (error) throw error;
  const { error: paymentError } = await sb.from('payments').update({ refunded_amount: updates.refunded_amount, refund_status: updates.refund_status, refunded_at: now, stripe_charge_id: charge.id || null, stripe_refund_id: refundId }).eq('reference_id', charge.payment_intent);
  if (paymentError) throw paymentError;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return respond(503, { error: 'Stripe webhook is not configured.' });

  const body = rawBody(event);
  if (!verifyStripeSignature(header(event, 'stripe-signature'), body, secret)) {
    return respond(400, { error: 'Invalid Stripe signature.' });
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(body); } catch { return respond(400, { error: 'Invalid Stripe event JSON.' }); }

  const sb = getClient();
  const eventId = stripeEvent.id;
  try {
    if (!await claimEvent(sb, stripeEvent)) return respond(200, { received: true, duplicate: true });
    const object = stripeEvent.data?.object || {};
    if (stripeEvent.type === 'checkout.session.completed' && object.payment_status === 'paid') await markPayment(sb, object.metadata?.session_id || object.metadata?.booking_id || object.client_reference_id, stripeEvent, object);
    if (stripeEvent.type === 'checkout.session.async_payment_succeeded') await markPayment(sb, object.metadata?.session_id || object.metadata?.booking_id || object.client_reference_id, stripeEvent, object);
    if (stripeEvent.type === 'checkout.session.async_payment_failed') await markPaymentProblem(sb, object, 'failed');
    if (stripeEvent.type === 'checkout.session.expired') await markPaymentProblem(sb, object, 'expired');
    if (stripeEvent.type === 'payment_intent.payment_failed') await markPaymentProblem(sb, object, 'failed');
    if (stripeEvent.type === 'charge.refunded') await reconcileRefund(sb, object);
    const { error: doneError } = await sb.from('stripe_webhook_events').update({ state: 'processed', processed_at: new Date().toISOString(), processing_error: null }).eq('id', eventId);
    if (doneError) throw doneError;
    return respond(200, { received: true });
  } catch (e) {
    console.error('[stripe-webhook]', eventId, e.message);
    try { await sb.from('stripe_webhook_events').update({ state: 'failed', processing_error: String(e.message || e).slice(0, 2000), failed_at: new Date().toISOString() }).eq('id', eventId).neq('state', 'processed'); } catch { /* Stripe will retry */ }
    return respond(500, { error: 'Stripe event processing failed.' });
  }
};

exports._test = { verifyStripeSignature, markPayment, recordStripePayment, markPaymentProblem, claimEvent, reconcileRefund };
