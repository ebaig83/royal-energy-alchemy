'use strict';

const crypto        = require('crypto');
const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { findService } = require('./lib/services');
const { sendWithPreferences } = require('./lib/comms');
const { sendTransactional } = require('./lib/mailer');
const { appointmentManageUrl } = require('./lib/appointment-token');
const { isCalendarEligible } = require('./lib/record-policy');
const { isWebsiteBooking, isOperationalWebsiteBooking, completeWebsiteDetails, attachServiceAddress } = require('./lib/booking-state');

const SITE_URL = process.env.SITE_URL || 'https://www.daronroyal.com';

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

async function processStripeEvent(sb, stripeEvent, { sessionId = null, updates = null, payment = null, paymentAction = 'none' } = {}) {
  const { data, error } = await sb.rpc('process_stripe_webhook_event_with_audit', {
    p_event_id: stripeEvent.id,
    p_event_type: stripeEvent.type,
    p_payload: stripeEvent,
    p_session_id: sessionId,
    p_updates: updates,
    p_payment: payment,
    p_payment_action: paymentAction,
    p_request_path: '/.netlify/functions/stripe-webhook',
  });
  if (error || !data) throw error || new Error('Stripe transaction returned no result.');
  if (sessionId && !data.session) throw new Error('Stripe session mutation was not committed.');
  console.info('[stripe-webhook] atomic event mutation', JSON.stringify({ session_id: sessionId, correlation_id: data.correlation_id, stripe_event_id: stripeEvent.id, actor_type: 'system', source: 'stripe_webhook', action: stripeEvent.type }));
  return data;
}

async function markPayment(sb, sessionId, event, checkout) {
  const { data: rawSession, error } = await sb
    .from('sessions')
    .select('id, status, source, service, location_type, session_date, session_time, waiver_status, waiver_completed, client_id, client_name, client_email, client_phone, amount_due, amount_paid, payment_status, google_calendar_status, payment_hold_expires_at, booking_status')
    .eq('id', sessionId)
    .single();

  if (error || !rawSession) throw new Error('Session not found.');
  let session=rawSession;
  if (['in_person','in-person'].includes(String(session.location_type||'').toLowerCase())) {
    const {data:address,error:addressError}=await sb.from('session_service_addresses').select('address_line1,address_line2,city,state,postal_code,country').eq('session_id',session.id).maybeSingle();
    if(addressError)throw addressError;
    session=attachServiceAddress(session,address);
  }

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
  const websiteBooking = isWebsiteBooking(session);
  const holdActive = !!session.payment_hold_expires_at && Date.parse(session.payment_hold_expires_at) > Date.now() && String(session.status || '').toLowerCase() === 'pending';
  const complete = !websiteBooking || (holdActive && waiverDone && completeWebsiteDetails(session));
  const updates = {
    status: websiteBooking ? (complete ? 'confirmed' : 'pending') : session.status,
    payment_status: 'paid',
    amount_paid: amountPaid,
    payment_paid_at: new Date().toISOString(),
    stripe_checkout_session_id: checkout.id || null,
    stripe_payment_intent_id: checkout.payment_intent || null,
    stripe_payment_status: checkout.payment_status || 'paid',
    payment_hold_expires_at: null,
    google_calendar_status: websiteBooking ? (complete && isCalendarEligible({ ...session, status: 'confirmed', booking_status: 'confirmed', payment_status: 'paid' }) ? 'pending' : 'not_requested') : (isCalendarEligible({ ...session, payment_status: 'paid' }) ? 'pending' : (session.google_calendar_status || 'not_requested')),
    booking_status: websiteBooking ? (complete ? 'confirmed' : 'payment_received_incomplete') : waiverDone ? 'ready' : 'payment_paid',
    updated_at: new Date().toISOString(),
  };

  const result = await processStripeEvent(sb, event, {
    sessionId,
    updates,
    paymentAction: 'upsert',
    payment: {
    session_id: sessionId,
    client_id: session.client_id || null,
    client_name: session.client_name || null,
    amount: amountPaid,
    method: 'stripe',
    status: 'received',
    paid_at: new Date().toISOString(),
    reference_id: checkout.payment_intent || checkout.id || event.id,
    notes: 'Stripe Checkout',
    },
  });

  return { ...session, ...(result.session || updates), correlation_id: result.correlation_id, duplicate: result.duplicate === true, amount_paid: amountPaid, payment_reference: checkout.payment_intent || checkout.id || event.id };
}

async function markPaymentProblem(sb, checkout, status, stripeEvent) {
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
  const result = await processStripeEvent(sb, stripeEvent, { sessionId, updates });
  return { ...result.session, id: sessionId, correlation_id: result.correlation_id, duplicate: result.duplicate === true, client_id: result.session?.client_id || null, client_name: result.session?.client_name || null, service: result.session?.service || null, session_date: result.session?.session_date || null, session_time: result.session?.session_time || null, amount_due: result.session?.amount_due || null };
}

async function reconcileRefund(sb, charge, stripeEvent) {
  if (!charge.payment_intent) throw new Error('Refunded charge is missing its PaymentIntent.');
  const { data: session, error: sessionLookupError } = await sb
    .from('sessions')
    .select('id,client_id,client_name,service,session_date,session_time,amount_paid')
    .eq('stripe_payment_intent_id', charge.payment_intent)
    .single();
  if (sessionLookupError || !session) throw sessionLookupError || new Error('Refunded booking was not found.');
  const full = Number(charge.amount || 0) > 0 && Number(charge.amount_refunded || 0) >= Number(charge.amount);
  const now = new Date().toISOString();
  const refundId = charge.refunds?.data?.[0]?.id || null;
  const updates = { refunded_amount: Number(charge.amount_refunded || 0) / 100, refund_status: full ? 'full' : 'partial', refund_updated_at: now, stripe_charge_id: charge.id || null, stripe_refund_id: refundId, stripe_payment_status: full ? 'refunded' : 'partially_refunded', updated_at: now };
  if (full) Object.assign(updates, { payment_status: 'refunded', booking_status: 'payment_refunded' });
  const result = await processStripeEvent(sb, stripeEvent, {
    sessionId: session.id,
    updates,
    paymentAction: 'refund',
    payment: { method: 'stripe', reference_id: charge.payment_intent, refunded_amount: updates.refunded_amount, refunded_at: now, refund_status: updates.refund_status, stripe_charge_id: charge.id || null, stripe_refund_id: refundId },
  });
  return { ...session, ...result.session, correlation_id: result.correlation_id, duplicate: result.duplicate === true, refunded_amount: updates.refunded_amount, refund_reference: refundId || charge.id };
}

async function clientEmail(sb, session) {
  if (!session?.client_id) return null;
  const { data } = await sb.from('clients').select('email').eq('id', session.client_id).single();
  return data?.email || null;
}

function notificationKey(eventId, type, recipient) {
  return [eventId, type, String(recipient || '').trim().toLowerCase()].join(':');
}

async function sendStripeNotification(sb, { eventId, type, templateName, recipientEmail, session, variables, practitioner = false, transport }) {
  if (session?.duplicate) return { skipped: true, duplicate: true };
  if (!recipientEmail) return { skipped: true, reason: 'no_recipient' };
  const metadata = { stripe_event_id: eventId, correlation_id: session.correlation_id || null, notification_type: type, session_id: session.id };
  const opts = {
    templateName,
    recipientEmail,
    clientId: practitioner ? null : session.client_id,
    sessionId: session.id,
    variables,
    metadata,
    correlationId: session.correlation_id,
    idempotencyKey: notificationKey(eventId, type, recipientEmail),
    transport,
  };
  return practitioner ? sendTransactional(sb, opts) : sendWithPreferences(sb, opts);
}

async function notifyPaymentSuccess(sb, eventId, session, transport) {
  if (isWebsiteBooking(session) && !isOperationalWebsiteBooking(session)) return [{ skipped: true, reason: 'website_booking_not_operational' }];
  const email = await clientEmail(sb, session);
  const admin = process.env.ADMIN_EMAIL;
  const common = {
    client_name: session.client_name || '', service: session.service || '',
    session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0, 5),
    timezone: 'ET', amount_paid: Number(session.amount_paid || 0).toFixed(2),
    session_reference: session.id, payment_reference: session.payment_reference || '',
    manage_url: appointmentManageUrl(session.id, { siteUrl: SITE_URL }),
    dashboard_url: `${SITE_URL}/dashboard.html`,
  };
  return Promise.all([
    sendStripeNotification(sb, { eventId, type: 'client_payment_confirmed', templateName: 'stripe_payment_confirmed_client', recipientEmail: email, session, variables: common, transport }),
    sendStripeNotification(sb, { eventId, type: 'practitioner_paid_booking', templateName: 'stripe_payment_confirmed_practitioner', recipientEmail: admin, session, variables: common, practitioner: true, transport }),
  ]);
}

async function notifyRefund(sb, eventId, session, transport) {
  const email = await clientEmail(sb, session);
  const admin = process.env.ADMIN_EMAIL;
  const common = {
    client_name: session.client_name || '', service: session.service || '',
    session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0, 5),
    refunded_amount: Number(session.refunded_amount || 0).toFixed(2), session_reference: session.id,
    refund_reference: session.refund_reference || '',
  };
  return Promise.all([
    sendStripeNotification(sb, { eventId, type: 'client_refund_confirmed', templateName: 'stripe_refund_confirmed_client', recipientEmail: email, session, variables: common, transport }),
    sendStripeNotification(sb, { eventId, type: 'practitioner_refund_confirmed', templateName: 'stripe_refund_confirmed_practitioner', recipientEmail: admin, session, variables: common, practitioner: true, transport }),
  ]);
}

async function notifyPaymentFailure(sb, eventId, session, transport) {
  const email = await clientEmail(sb, session);
  return sendStripeNotification(sb, {
    eventId, type: 'client_payment_failed', templateName: 'stripe_payment_failed_client', recipientEmail: email,
    session, transport,
    variables: {
      client_name: session.client_name || '', service: session.service || '',
      session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0, 5),
      session_reference: session.id,
      retry_url: `${SITE_URL}/waiver-esign.html?session_id=${encodeURIComponent(session.id)}`,
    },
  });
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
    const object = stripeEvent.data?.object || {};
    let session = null;
    if (stripeEvent.type === 'checkout.session.completed' && object.payment_status === 'paid') {
      session = await markPayment(sb, object.metadata?.session_id || object.metadata?.booking_id || object.client_reference_id, stripeEvent, object);
      await notifyPaymentSuccess(sb, eventId, session);
    }
    else if (stripeEvent.type === 'checkout.session.async_payment_succeeded') {
      session = await markPayment(sb, object.metadata?.session_id || object.metadata?.booking_id || object.client_reference_id, stripeEvent, object);
      await notifyPaymentSuccess(sb, eventId, session);
    }
    else if (stripeEvent.type === 'checkout.session.async_payment_failed') {
      session = await markPaymentProblem(sb, object, 'failed', stripeEvent);
      await notifyPaymentFailure(sb, eventId, session);
    }
    else if (stripeEvent.type === 'checkout.session.expired') session = await markPaymentProblem(sb, object, 'expired', stripeEvent);
    else if (stripeEvent.type === 'payment_intent.payment_failed') {
      session = await markPaymentProblem(sb, object, 'failed', stripeEvent);
      await notifyPaymentFailure(sb, eventId, session);
    }
    else if (stripeEvent.type === 'charge.refunded') {
      session = await reconcileRefund(sb, object, stripeEvent);
      await notifyRefund(sb, eventId, session);
    }
    else await processStripeEvent(sb, stripeEvent); // claim unsupported/unpaid events idempotently
    const { data: finalized, error: doneError } = await sb.rpc('finalize_stripe_webhook_event', { p_event_id: eventId });
    if (doneError || finalized !== true) throw doneError || new Error('Stripe event finalization failed.');
    return respond(200, { received: true, duplicate: !!session?.duplicate });
  } catch (e) {
    console.error('[stripe-webhook]', eventId, e.message);
    return respond(500, { error: 'Stripe event processing failed.' });
  }
};

exports._test = { verifyStripeSignature, processStripeEvent, markPayment, markPaymentProblem, reconcileRefund, notificationKey, sendStripeNotification, notifyPaymentSuccess, notifyRefund, notifyPaymentFailure };
