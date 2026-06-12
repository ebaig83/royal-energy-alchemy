// /.netlify/functions/session-notes
// GET    ?session_id=uuid  — all notes for a session
// GET    ?client_id=uuid   — all notes for a client across sessions
// POST                     — create a note, optionally run session-notes agent
// PATCH  ?id=uuid          — edit a note

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { runSessionNotesAgent }  = require('./agents/session-notes-agent');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    let query = sb.from('session_notes').select('*');

    if (params.session_id) {
      query = query.eq('session_id', params.session_id);
    } else if (params.client_id) {
      query = query.eq('client_id', params.client_id);
    } else {
      return respond(400, { error: 'session_id or client_id is required.' });
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return respond(500, { error: error.message });
    return respond(200, { notes: data });
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.session_id && !body.client_id) return respond(400, { error: 'session_id or client_id is required.' });
    if (!body.content?.trim()) return respond(400, { error: 'content is required.' });

    const insert = {
      session_id:      body.session_id      || null,
      client_id:       body.client_id       || null,
      note_type:       body.note_type        || 'session',
      content:         body.content.trim(),
      energy_findings: body.energy_findings  || null,
      removals_done:   body.removals_done    || [],
      recommendations: body.recommendations  || null,
      env_notes:       body.env_notes        || null,
      snm_json:        body.snm_json         || null,
      authored_by:     'daron',
    };

    const { data, error } = await sb.from('session_notes').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'session_notes', recordId: data.id, newData: data, context: `Added ${data.note_type} note for session ${data.session_id}`, ip });

    // Optionally enhance with agent
    if (body.enhance && process.env.ANTHROPIC_API_KEY) {
      try {
        const enhanced = await runSessionNotesAgent({ note: data, sb });
        const { data: updated } = await sb
          .from('session_notes')
          .update({ agent_enhanced: enhanced.summary, recommendations: enhanced.recommendations || data.recommendations })
          .eq('id', data.id)
          .select()
          .single();
        return respond(201, { note: updated, agentRan: true });
      } catch (err) {
        console.error('[session-notes] Agent error:', err.message);
      }
    }

    return respond(201, { note: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['content','note_type','energy_findings','removals_done','recommendations','agent_enhanced','env_notes','snm_json'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    const { data, error } = await sb.from('session_notes').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'session_notes', recordId: params.id, newData: data, context: `Edited session note`, ip });
    return respond(200, { note: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
