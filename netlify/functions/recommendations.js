// /.netlify/functions/recommendations
// GET    ?client_id=uuid          — all for a client
// GET    ?id=uuid                 — single record
// POST                            — create
// PATCH  ?id=uuid                 — update

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const ALLOWED_CATEGORIES     = ['supplement','crystal','essential_oil','book','course','device','service','other'];
const ALLOWED_PRIORITIES     = ['high','medium','low'];
const ALLOWED_PURCHASED      = ['yes','no','unknown'];
const ALLOWED_OUTCOME_STATUS = ['recommended','purchased','tried','helpful','not_helpful','declined'];

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
      const { data, error } = await sb.from('recommendations').select('*').eq('id', params.id).single();
      if (error) return respond(404, { error: 'Recommendation not found.' });
      return respond(200, { recommendation: data });
    }
    if (!params.client_id) return respond(400, { error: 'client_id or id is required.' });
    const { data, error } = await sb
      .from('recommendations')
      .select('*')
      .eq('client_id', params.client_id)
      .order('recommended_at', { ascending: false });
    if (error) return respond(500, { error: error.message });
    return respond(200, { recommendations: data });
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.client_id)    return respond(400, { error: 'client_id is required.' });
    if (!body.product_name?.trim()) return respond(400, { error: 'product_name is required.' });

    const insert = {
      client_id:          body.client_id,
      session_id:         body.session_id          || null,
      product_name:       body.product_name.trim(),
      category:           ALLOWED_CATEGORIES.includes(body.category) ? body.category : 'other',
      reason:             body.reason              || null,
      priority:           ALLOWED_PRIORITIES.includes(body.priority) ? body.priority : 'medium',
      practitioner_notes: body.practitioner_notes  || null,
      purchased:          ALLOWED_PURCHASED.includes(body.purchased) ? body.purchased : 'unknown',
      client_outcome:     body.client_outcome      || null,
      recommended_at:     body.recommended_at      || new Date().toISOString().slice(0, 10),
    };

    const { data, error } = await sb.from('recommendations').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'recommendations', recordId: data.id,
      newData: data, context: `Recommended ${data.product_name} for client ${data.client_id}`, ip });

    return respond(201, { recommendation: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['product_name','category','reason','priority','practitioner_notes',
                     'purchased','client_outcome','recommended_at','session_id',
                     'outcome_status','outcome_date'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    if (updates.category       && !ALLOWED_CATEGORIES.includes(updates.category))         updates.category       = 'other';
    if (updates.priority       && !ALLOWED_PRIORITIES.includes(updates.priority))         updates.priority       = 'medium';
    if (updates.purchased      && !ALLOWED_PURCHASED.includes(updates.purchased))         updates.purchased      = 'unknown';
    if (updates.outcome_status && !ALLOWED_OUTCOME_STATUS.includes(updates.outcome_status)) delete updates.outcome_status;

    const { data, error } = await sb.from('recommendations').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'recommendations', recordId: params.id,
      newData: data, context: `Updated recommendation ${params.id}`, ip });

    return respond(200, { recommendation: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
