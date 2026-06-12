// /.netlify/functions/aftercare
// GET    ?session_id=uuid  — aftercare schedule for a session
// GET    ?due=1            — all follow-ups due today or overdue
// GET    ?client_id=uuid   — all aftercare for a client
// PATCH  ?id=uuid          — mark as sent, skipped, add response

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    let query = sb.from('aftercare').select('*, sessions(service, session_date, client_name)');

    if (params.session_id) {
      query = query.eq('session_id', params.session_id).order('scheduled_for', { ascending: true });
    } else if (params.client_id) {
      query = query.eq('client_id', params.client_id).order('scheduled_for', { ascending: false });
    } else if (params.due) {
      const now = new Date().toISOString();
      query = query
        .lte('scheduled_for', now)
        .eq('status', 'scheduled')
        .order('scheduled_for', { ascending: true });
    } else if (params.all) {
      // All follow-ups across clients, optionally filtered by status
      if (params.status) {
        query = query.eq('status', params.status);
      } else {
        query = query.in('status', ['scheduled', 'sent', 'skipped']);
      }
      query = query.order('scheduled_for', { ascending: false }).limit(200);
    } else {
      return respond(400, { error: 'session_id, client_id, due=1, or all=1 is required.' });
    }

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { aftercare: data });
  }

  // ── POST — create ad-hoc follow-up from Follow-Up Center ────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.client_id && !body.client_name) return respond(400, { error: 'client_id or client_name is required.' });
    if (!body.scheduled_for)                  return respond(400, { error: 'scheduled_for is required.' });
    if (!body.followup_type)                  return respond(400, { error: 'followup_type is required.' });

    const insertFull = {
      session_id:    body.session_id    || null,
      client_id:     body.client_id     || null,
      client_name:   body.client_name   || null,
      followup_type: body.followup_type,
      scheduled_for: body.scheduled_for,
      status:        'scheduled',
      channel:       body.channel       || 'text',
      message_body:  body.message_body  || null,
      notes:         body.notes         || null,
      priority:      body.priority      || 'medium',
      source:        'manual',
    };

    let { data, error } = await sb.from('aftercare').insert(insertFull).select().single();
    // If Sprint 2 migration not yet run, columns won't exist — retry without them
    if (error && (error.message.includes("column") || error.code === '42703')) {
      const { notes: _n, priority: _p, source: _s, ...insertBase } = insertFull;
      ({ data, error } = await sb.from('aftercare').insert(insertBase).select().single());
    }
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'aftercare', recordId: data.id, newData: data, context: `Manual follow-up created for ${data.client_name || data.client_id}`, ip });
    return respond(201, { aftercare: data });
  }

  // ── PATCH — mark sent / skipped / add response ────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['status','sent_at','client_response','message_body','channel','notes','priority','scheduled_for','followup_type'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    if (updates.status === 'sent' && !updates.sent_at) {
      updates.sent_at = new Date().toISOString();
    }

    let { data, error } = await sb.from('aftercare').update(updates).eq('id', params.id).select().single();
    // If Sprint 2 migration not yet run, retry without new-column fields
    if (error && (error.message.includes('column') || error.code === '42703')) {
      const { notes: _n, priority: _p, ...baseUpdates } = updates;
      ({ data, error } = await sb.from('aftercare').update(baseUpdates).eq('id', params.id).select().single());
    }
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'aftercare', recordId: params.id, newData: data, context: `Aftercare ${data.followup_type} marked ${data.status} for ${data.client_name}`, ip });
    return respond(200, { aftercare: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
