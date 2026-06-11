// /.netlify/functions/action-plans
// GET    ?client_id=uuid   — all plans for a client (newest first)
// GET    ?session_id=uuid  — all plans for a session
// GET    ?id=uuid          — single plan
// POST                     — create
// PATCH  ?id=uuid          — update

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const ALLOWED_PRIORITY = ['high', 'medium', 'low'];
const ALLOWED_STATUS   = ['draft', 'active', 'completed'];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.id) {
      const { data, error } = await sb.from('action_plans').select('*').eq('id', params.id).single();
      if (error) return respond(404, { error: 'Action plan not found.' });
      return respond(200, { action_plan: data });
    }
    if (params.session_id) {
      const { data, error } = await sb
        .from('action_plans').select('*')
        .eq('session_id', params.session_id)
        .order('created_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { action_plans: data });
    }
    if (!params.client_id) return respond(400, { error: 'client_id, session_id, or id is required.' });
    const { data, error } = await sb
      .from('action_plans').select('*')
      .eq('client_id', params.client_id)
      .order('created_at', { ascending: false });
    if (error) return respond(500, { error: error.message });
    return respond(200, { action_plans: data });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.client_id) return respond(400, { error: 'client_id is required.' });

    const insert = {
      client_id:             body.client_id,
      session_id:            body.session_id            || null,
      immediate_steps:       body.immediate_steps       || null,
      products_recommended:  body.products_recommended  || null,
      provider_referrals:    body.provider_referrals    || null,
      environmental_actions: body.environmental_actions || null,
      aftercare_tasks:       body.aftercare_tasks       || null,
      priority:              ALLOWED_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      due_date:              body.due_date              || null,
      status:                ALLOWED_STATUS.includes(body.status) ? body.status : 'active',
    };

    const { data, error } = await sb.from('action_plans').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'action_plans',
      recordId: data.id, newData: data,
      context: 'Action plan created for client ' + data.client_id, ip });

    return respond(201, { action_plan: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['immediate_steps','products_recommended','provider_referrals',
                     'environmental_actions','aftercare_tasks','priority','due_date','status','session_id'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    if (updates.priority && !ALLOWED_PRIORITY.includes(updates.priority)) updates.priority = 'medium';
    if (updates.status   && !ALLOWED_STATUS.includes(updates.status))     updates.status   = 'active';

    const { data, error } = await sb.from('action_plans').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'action_plans',
      recordId: params.id, newData: data,
      context: 'Action plan updated ' + params.id, ip });

    return respond(200, { action_plan: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
