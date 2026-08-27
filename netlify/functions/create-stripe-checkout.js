'use strict';

const { respond }     = require('./lib/auth');
const { getClient }   = require('./lib/supabase');
const { findService } = require('./lib/services');

const SITE_URL = process.env.SITE_URL || 'https://www.daronroyal.com';

function centsFromDollars(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function isWaiverDone(session) {
  return session?.waiver_completed === true || ['complete', 'completed', 'signed'].includes(String(session?.waiver_status || '').toLowerCase());
}

function displayDate(session) {
  const parts = [];
  if (session.session_date) parts.push(session.session_date);
  if (session.session_time) parts.push(String(session.session_time).slice(0, 5));
  return parts.join(' ');
}

async function stripePost(path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('Stripe is not configured yet.');
    err.statusCode = 503;
    throw err;
  }

  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Stripe Checkout could not be created.');
    err.statusCode = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  const sessionId = body.session_id || body.booking_id;
  if (!sessionId) return respond(400, { error: 'Booking ID is required to start payment.' });

  const sb = getClient();
  const { data: session, error } = await sb
    .from('sessions')
    .select('id, client_id, client_name, service, session_date, session_time, duration_minutes, amount_due, amount_paid, payment_status, waiver_status, waiver_completed')
    .eq('id', sessionId)
    .single();

  if (error || !session) return respond(404, { error: 'Booking was not found.' });

  if (String(session.payment_status || '').toLowerCase() === 'paid') {
    return respond(409, {
      paid: true,
      error: 'This booking is already paid.',
    });
  }

  if (!isWaiverDone(session)) {
    return respond(409, { error: 'Waiver must be completed before payment.' });
  }

  let clientEmail = null;
  if (!clientEmail && session.client_id) {
    const { data: client, error: clientError } = await sb.from('clients').select('email').eq('id', session.client_id).single();
    if (clientError) return respond(500, { error: 'Unable to verify the booking email.' });
    clientEmail = client?.email || null;
  }

  if (!clientEmail) {
    return respond(409, { error: 'This booking has no verified email. Please contact Daron before paying.' });
  }

  const service = findService(session.service);
  const bookingAmount = centsFromDollars(session.amount_due);
  const catalogAmount = centsFromDollars(service?.price);
  if (!service || !bookingAmount || bookingAmount !== catalogAmount) {
    return respond(409, { error: 'The booking price does not match the current service catalog. Please contact Daron before paying.' });
  }
  const amount = catalogAmount;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${SITE_URL}/booking-confirmation.html?session_id=${encodeURIComponent(sessionId)}&payment=success`);
  params.set('cancel_url', `${SITE_URL}/booking-confirmation.html?session_id=${encodeURIComponent(sessionId)}&payment=cancelled`);
  params.set('client_reference_id', sessionId);
  if (clientEmail) params.set('customer_email', clientEmail);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(amount));
  params.set('line_items[0][price_data][product_data][name]', session.service || 'Royal Energy Alchemy Session');
  params.set('line_items[0][price_data][product_data][description]', displayDate(session) || 'Scheduled session');
  params.set('metadata[booking_id]', sessionId);
  params.set('metadata[session_id]', sessionId);
  params.set('metadata[client_name]', session.client_name || '');
  params.set('metadata[client_email]', clientEmail || '');
  params.set('metadata[service]', session.service || '');
  params.set('metadata[service_id]', service.id);
  params.set('metadata[expected_amount]', String(amount));
  params.set('metadata[currency]', 'usd');
  params.set('metadata[appointment]', displayDate(session));
  params.set('payment_intent_data[metadata][booking_id]', sessionId);
  params.set('payment_intent_data[metadata][session_id]', sessionId);
  params.set('payment_intent_data[metadata][service]', session.service || '');
  params.set('payment_intent_data[metadata][service_id]', service.id);
  params.set('payment_intent_data[metadata][expected_amount]', String(amount));
  params.set('payment_intent_data[metadata][currency]', 'usd');

  try {
    const checkout = await stripePost('/checkout/sessions', params);
    const { error: updateError } = await sb.from('sessions').update({
      payment_status: 'pending',
      booking_status: 'payment_pending',
      stripe_checkout_session_id: checkout.id,
      payment_currency: 'usd',
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
    if (updateError) throw updateError;

    return respond(200, {
      url: checkout.url,
      checkout_session_id: checkout.id,
      payment_status: 'pending',
    });
  } catch (e) {
    return respond(e.statusCode || 500, { error: e.message, detail: e.detail || null });
  }
};

exports._test = { centsFromDollars, isWaiverDone };
