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
    } else {
      return respond(400, { error: 'session_id, client_id, or due=1 is required.' });
    }

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { aftercare: data });
  }

  // ── PATCH — mark sent / skipped / add response ────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['status','sent_at','client_response','message_body','channel'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    if (updates.status === 'sent' && !updates.sent_at) {
      updates.sent_at = new Date().toISOString();
    }

    const { data, error } = await sb.from('aftercare').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'aftercare', recordId: params.id, newData: data, context: `Aftercare ${data.followup_type} marked ${data.status} for ${data.client_name}`, ip });
    return respond(200, { aftercare: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
