'use strict';

const crypto = require('crypto');
const { respond }     = require('./lib/auth');
const { getClient }   = require('./lib/supabase');
const { findService } = require('./lib/services');
const { createAppointmentToken } = require('./lib/appointment-token');
const { isWebsiteBooking, completeWebsiteDetails, attachServiceAddress } = require('./lib/booking-state');

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

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('Stripe is not configured yet.');
    err.statusCode = 503;
    throw err;
  }
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + key },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Stripe Checkout could not be retrieved.');
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

  const attemptId = body.attempt_id;
  const sessionId = body.session_id || body.booking_id;
  if (!sessionId && !attemptId) return respond(400, { error: 'Booking ID is required to start payment.' });

  const sb = getClient();
  if (attemptId) {
    const { data: attempt, error: attemptError } = await sb.from('booking_attempts').select('id,client_first_name,client_last_name,client_email,service,service_id,session_date,session_time,location_type,status,waiver_completed,payment_status,payment_amount,payment_reference,expires_at,slot_id,stripe_checkout_session_id').eq('id', attemptId).single();
    if (attemptError || !attempt) return respond(404, { error: 'Booking attempt was not found.' });
    if (attempt.status === 'completed' || attempt.payment_status === 'paid') return respond(409, { error: 'This booking attempt is already paid or finalized.' });
    if (attempt.stripe_checkout_session_id) {
      try {
        const existing = await stripeGet(`/checkout/sessions/${encodeURIComponent(attempt.stripe_checkout_session_id)}`);
        if (existing.status === 'open' && existing.url) {
          return respond(200, {
            url: existing.url,
            checkout_session_id: existing.id,
            payment_status: 'pending',
            attempt_id: attemptId,
            reused: true,
          });
        }
        if (existing.status === 'complete') {
          return respond(409, { error: 'Payment is complete and is being finalized.' });
        }
        if (existing.status === 'expired') {
          const { error: clearError } = await sb.from('booking_attempts').update({ stripe_checkout_session_id: null, updated_at: new Date().toISOString() }).eq('id', attemptId).eq('stripe_checkout_session_id', attempt.stripe_checkout_session_id);
          if (clearError) throw clearError;
        }
      } catch (e) {
        return respond(e.statusCode || 502, { error: e.message, detail: e.detail || null });
      }
    }
    if (!attempt.expires_at || Date.parse(attempt.expires_at) <= Date.now() || !attempt.waiver_completed) return respond(409, { error: 'This booking attempt is incomplete or expired. Please resume and revalidate it.' });
    const service = findService(attempt.service);
    const expected = centsFromDollars(attempt.payment_amount);
    if (!service || expected !== centsFromDollars(service.price)) return respond(409, { error: 'The booking price does not match the current service catalog.' });
    const { data: validation, error: validationError } = await sb.rpc('validate_booking_completion', { p_attempt_id: attemptId, p_payment_status: 'paid' });
    if (validationError || !validation?.valid) return respond(409, { error: 'This booking attempt is no longer available. Please choose a fresh time.' });
    const email = String(attempt.client_email || '').trim().toLowerCase();
    if (!email) return respond(409, { error: 'A verified booking email is required before payment.' });
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${SITE_URL}/book.html?attempt_id=${encodeURIComponent(attemptId)}&payment=success`);
    params.set('cancel_url', `${SITE_URL}/book.html?attempt_id=${encodeURIComponent(attemptId)}&payment=cancelled`);
    params.set('client_reference_id', attemptId);
    params.set('customer_email', email);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', String(expected));
    params.set('line_items[0][price_data][product_data][name]', attempt.service || 'Royal Energy Alchemy Session');
    params.set('metadata[attempt_id]', attemptId);
    params.set('metadata[booking_attempt_id]', attemptId);
    params.set('metadata[service_id]', service.id);
    params.set('metadata[expected_amount]', String(expected));
    params.set('payment_intent_data[metadata][attempt_id]', attemptId);
    params.set('payment_intent_data[metadata][expected_amount]', String(expected));
    try {
      const checkout = await stripePost('/checkout/sessions', params);
      const { error: claimError } = await sb.from('booking_attempts').update({ payment_status: 'pending', stripe_checkout_session_id: checkout.id }).eq('id', attemptId).is('stripe_checkout_session_id', null);
      if (claimError) throw claimError;
      return respond(200, { url: checkout.url, checkout_session_id: checkout.id, payment_status: 'pending', attempt_id: attemptId });
    } catch (e) { return respond(e.statusCode || 500, { error: e.message, detail: e.detail || null }); }
  }
  const { data: rawSession, error } = await sb
    .from('sessions')
    .select('id, client_id, client_name, client_email, client_phone, service, session_date, session_time, duration_minutes, location_type, source, status, booking_status, payment_hold_expires_at, amount_due, amount_paid, payment_status, waiver_status, waiver_completed')
    .eq('id', sessionId)
    .single();

  if (error || !rawSession) return respond(404, { error: 'Booking was not found.' });
  let session=rawSession;
  if(['in_person','in-person'].includes(String(session.location_type||'').toLowerCase())){
    const {data:address,error:addressError}=await sb.from('session_service_addresses').select('address_line1,address_line2,city,state,postal_code,country').eq('session_id',session.id).maybeSingle();
    if(addressError)return respond(503,{error:'Unable to verify the in-person service address.'});
    session=attachServiceAddress(session,address);
  }

  if (String(session.payment_status || '').toLowerCase() === 'paid') {
    return respond(409, {
      paid: true,
      error: 'This booking is already paid.',
    });
  }

  if (isWebsiteBooking(session) && (String(session.status || '').toLowerCase() !== 'pending' || !session.payment_hold_expires_at || Date.parse(session.payment_hold_expires_at) <= Date.now() || !completeWebsiteDetails(session))) {
    return respond(409, { error: 'This booking request is incomplete or its payment hold has expired. Please submit a new request.' });
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
  const actionToken = createAppointmentToken(sessionId);
  params.set('success_url', `${SITE_URL}/booking-confirmation.html?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(actionToken)}&payment=success`);
  params.set('cancel_url', `${SITE_URL}/booking-confirmation.html?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(actionToken)}&payment=cancelled`);
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
    const correlationId = crypto.randomUUID();
    const { data: mutation, error: updateError } = await sb.rpc('trusted_session_update_with_audit', {
      p_id: sessionId,
      p_updates: {
      payment_status: 'pending',
      booking_status: 'payment_pending',
      stripe_checkout_session_id: checkout.id,
      updated_at: new Date().toISOString(),
      },
      p_actor_type: 'system', p_actor_id: 'stripe-checkout', p_actor_email: null,
      p_source: 'stripe-checkout', p_action: 'checkout_session_created',
      p_correlation_id: correlationId, p_request_path: '/.netlify/functions/create-stripe-checkout',
    });
    if (updateError || !mutation?.session) throw updateError || new Error('Checkout state was not committed.');
    console.info('[create-stripe-checkout] appointment mutation', JSON.stringify({ session_id: sessionId, correlation_id: correlationId, actor_type: 'system', source: 'stripe-checkout', action: 'checkout_session_created' }));

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
