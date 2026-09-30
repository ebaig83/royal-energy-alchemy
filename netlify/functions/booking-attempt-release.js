'use strict';

const { getClient } = require('./lib/supabase');
const { requireAdmin, respond } = require('./lib/auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async event => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST required.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  if (body.confirmed !== true) return respond(400, { error: 'Explicit confirmation is required.' });
  if (!UUID.test(String(body.attempt_id || ''))) return respond(400, { error: 'A valid booking attempt is required.' });
  if (!UUID.test(String(body.request_id || ''))) return respond(400, { error: 'A valid request id is required.' });

  try {
    const { data, error } = await getClient().rpc('release_booking_attempt', {
      p_attempt_id: body.attempt_id,
      p_actor_id: auth.user.id,
      p_actor_email: auth.user.email,
      p_request_id: body.request_id,
      p_reason: String(body.reason || '').slice(0, 500),
    });
    if (error) {
      console.error(JSON.stringify({ fn: 'booking-attempt-release', stage: 'release_rpc', message: String(error.message || 'rpc failed').slice(0, 240) }));
      return respond(409, { error: String(error.message || '').includes('Confirmed or paid') ? 'Confirmed or paid appointments must use the normal appointment workflow.' : 'The incomplete booking could not be released.' });
    }
    return respond(200, data);
  } catch (error) {
    console.error(JSON.stringify({ fn: 'booking-attempt-release', stage: 'handler', message: String(error.message || error).slice(0, 240) }));
    return respond(500, { error: 'The incomplete booking release could not be completed.' });
  }
};
