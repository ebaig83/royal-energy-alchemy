'use strict';

const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { respond } = require('./lib/auth');
const { findService } = require('./lib/services');

function json(event) { try { return JSON.parse(event.body || '{}'); } catch { return null; } }
function correlation(event) { return event.headers?.['x-correlation-id'] || event.headers?.['X-Correlation-Id'] || crypto.randomUUID(); }

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Use an explicit POST action.' });
  const body = json(event);
  if (!body || typeof body !== 'object') return respond(400, { error: 'Invalid JSON.' });
  const sb = getClient();
  const action = body.action || 'start';
  try {
    if (action === 'start') {
      const key = String(body.idempotency_key || event.headers?.['x-idempotency-key'] || '').trim();
      if (key.length < 16 || key.length > 200) return respond(400, { error: 'A valid idempotency key is required.' });
      const payload = { ...(body.payload || body) };
      const service = findService(payload.service);
      if (!service) return respond(400, { error: 'Selected service is not valid.' });
      payload.service_id = service.id;
      payload.payment_amount = service.price;
      payload.location_type = service.locationType || payload.location_type || 'distance';
      const { data, error } = await sb.rpc('start_booking_attempt', { p_payload: payload, p_idempotency_key: key, p_correlation_id: correlation(event) });
      if (error) return respond(400, { error: error.message });
      return respond(200, { attempt: data.attempt, resume_token: data.resume_token, duplicate: data.duplicate === true });
    }
    if (action === 'resume') {
      if (!body.resume_token) return respond(400, { error: 'Resume token is required.' });
      const { data, error } = await sb.rpc('resume_booking_attempt', { p_resume_token: body.resume_token });
      if (error) return respond(410, { error: 'This booking link is expired or invalid.' });
      return respond(200, data);
    }
    if (action === 'validate') {
      if (!body.attempt_id) return respond(400, { error: 'Attempt ID is required.' });
      const { data, error } = await sb.rpc('validate_booking_completion', { p_attempt_id: body.attempt_id, p_payment_status: body.payment_status || null });
      if (error) return respond(400, { error: error.message });
      return respond(200, data);
    }
    if (action === 'finalize') {
      if (!body.attempt_id || body.payment_status !== 'paid') return respond(409, { error: 'Verified payment is required before finalization.' });
      const key = String(body.idempotency_key || event.headers?.['x-idempotency-key'] || '').trim();
      if (key.length < 16) return respond(400, { error: 'A valid idempotency key is required.' });
      const { data, error } = await sb.rpc('finalize_booking_attempt', { p_attempt_id: body.attempt_id, p_payment_status: 'paid', p_idempotency_key: key, p_correlation_id: correlation(event) });
      if (error) return respond(409, { error: error.message });
      return respond(200, data);
    }
    return respond(400, { error: 'Unsupported booking attempt action.' });
  } catch (error) {
    console.error('[booking-attempt]', error.message);
    return respond(500, { error: 'Booking attempt service is temporarily unavailable.' });
  }
};

exports._test = { correlation };
