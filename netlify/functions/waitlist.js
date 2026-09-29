'use strict';
const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { respond, requireAdmin } = require('./lib/auth');

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  const sb = getClient();
  if (event.httpMethod === 'POST') {
    let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    try {
      if (body.action === 'accept_offer') {
        if (!body.offer_token || !body.attempt_id) return respond(400, { error: 'Offer token and booking attempt are required.' });
        const { data, error } = await sb.rpc('accept_waitlist_offer', { p_offer_token: body.offer_token, p_attempt_id: body.attempt_id, p_correlation_id: crypto.randomUUID() });
        if (error) return respond(409, { error: error.message });
        return respond(200, data);
      }
      if (body.action === 'match_offer') {
        const auth = await requireAdmin(event); if (auth.error) return auth.error;
        const { data, error } = await sb.rpc('match_waitlist_and_offer', { p_slot_id: body.slot_id, p_service: body.service, p_wave: body.wave || 1, p_correlation_id: crypto.randomUUID() });
        if (error) return respond(409, { error: error.message });
        return respond(200, { offers: data || [] });
      }
      const { data, error } = await sb.rpc('signup_waitlist', { p_payload: body, p_correlation_id: crypto.randomUUID() });
      if (error) return respond(409, { error: error.message });
      return respond(201, { entry: data });
    } catch { return respond(503, { error: 'Waitlist signup is temporarily unavailable.' }); }
  }
  if (event.httpMethod === 'GET' && event.queryStringParameters?.offer) {
    const { data, error } = await sb.rpc('inspect_waitlist_offer', { p_offer_token: event.queryStringParameters.offer });
    if (error) return respond(410, { error: 'This waitlist offer is expired or unavailable.' });
    return respond(200, { offer: data });
  }
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });
  const [entries, offers, reservations] = await Promise.all([
    sb.from('waitlist_entries').select('id,first_name,last_name,email,phone,service,preferred_days,preferred_times,timezone,status,exclusion_reason,joined_at,expires_at'),
    sb.from('waitlist_offers').select('id,waitlist_entry_id,wave,slot_id,status,offered_at,expires_at,accepted_at'),
    sb.from('appointment_slot_reservations').select('id,slot_id,attempt_id,waitlist_offer_id,status,reserved_at,expires_at,released_at'),
  ]);
  if (entries.error || offers.error || reservations.error) return respond(503, { error: 'Waitlist data is unavailable.' });
  return respond(200, { entries: entries.data || [], offers: offers.data || [], reservations: reservations.data || [] });
};
