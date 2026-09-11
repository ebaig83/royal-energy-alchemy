'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');

exports.handler = async event => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Client merge requires POST.' });
  if (!auth.user.email || auth.user.email !== (process.env.ADMIN_EMAIL || '')) return respond(403, { error: 'Manager authorization required.' });
  if (process.env.CLIENT_MERGE_ENABLED !== 'true') return respond(503, { error: 'Client merge execution is disabled.' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  if (!body.primary_id || !body.duplicate_id || body.primary_id === body.duplicate_id) return respond(400, { error: 'Distinct primary_id and duplicate_id are required.' });
  if (!body.resolutions || typeof body.resolutions !== 'object' || Array.isArray(body.resolutions)) return respond(400, { error: 'Explicit field resolutions are required.' });
  const { data, error } = await getClient().rpc('merge_client_profiles', { p_primary_id: body.primary_id, p_duplicate_id: body.duplicate_id, p_resolutions: body.resolutions, p_actor: auth.user.email });
  if (error) return respond(error.message.includes('already') || error.message.includes('conflict') ? 409 : 400, { error: 'Client merge was not applied.' });
  return respond(200, { ok: true, merge: data });
};
