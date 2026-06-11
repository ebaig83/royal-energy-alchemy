// /.netlify/functions/referrals
// GET    ?client_id=uuid          — all for a client
// GET    ?id=uuid                 — single record
// POST                            — create
// PATCH  ?id=uuid                 — update

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const ALLOWED_TYPES     = ['pcp','therapist','psychiatrist','nutritionist','functional_medicine',
                           'neurologist','physical_therapist','energy_practitioner','other'];
const ALLOWED_URGENCY   = ['urgent','soon','routine'];
const ALLOWED_FOLLOWED  = ['yes','no','unknown'];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.id) {
      const { data, error } = await sb.from('referrals').select('*').eq('id', params.id).single();
      if (error) return respond(404, { error: 'Referral not found.' });
      return respond(200, { referral: data });
    }
    if (!params.client_id) return respond(400, { error: 'client_id or id is required.' });
    const { data, error } = await sb
      .from('referrals')
      .select('*')
      .eq('client_id', params.client_id)
      .order('referred_at', { ascending: false });
    if (error) return respond(500, { error: error.message });
    return respond(200, { referrals: data });
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.client_id)       return respond(400, { error: 'client_id is required.' });
    if (!body.provider_name?.trim()) return respond(400, { error: 'provider_name is required.' });
    if (!body.provider_type)   return respond(400, { error: 'provider_type is required.' });

    const insert = {
      client_id:        body.client_id,
      session_id:       body.session_id        || null,
      provider_name:    body.provider_name.trim(),
      provider_type:    ALLOWED_TYPES.includes(body.provider_type) ? body.provider_type : 'other',
      contact_info:     body.contact_info      || null,
      reason:           body.reason            || null,
      urgency:          ALLOWED_URGENCY.includes(body.urgency) ? body.urgency : 'routine',
      referred_at:      body.referred_at       || new Date().toISOString().slice(0, 10),
      followed_through: ALLOWED_FOLLOWED.includes(body.followed_through) ? body.followed_through : 'unknown',
      outcome_notes:    body.outcome_notes     || null,
    };

    const { data, error } = await sb.from('referrals').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'referrals', recordId: data.id,
      newData: data, context: `Referred ${data.client_id} to ${data.provider_name}`, ip });

    return respond(201, { referral: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['provider_name','provider_type','contact_info','reason','urgency',
                     'referred_at','followed_through','outcome_notes','session_id'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    if (updates.provider_type    && !ALLOWED_TYPES.includes(updates.provider_type))       updates.provider_type    = 'other';
    if (updates.urgency          && !ALLOWED_URGENCY.includes(updates.urgency))           updates.urgency          = 'routine';
    if (updates.followed_through && !ALLOWED_FOLLOWED.includes(updates.followed_through)) updates.followed_through = 'unknown';

    const { data, error } = await sb.from('referrals').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'referrals', recordId: params.id,
      newData: data, context: `Updated referral ${params.id}`, ip });

    return respond(200, { referral: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
