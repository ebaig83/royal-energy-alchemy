// /.netlify/functions/intake
// POST (public — no auth)  — receives form submission, runs intake agent,
//                            creates/matches client, creates session record
// GET  (admin auth)        — list unprocessed intake submissions
// PATCH ?id=uuid (admin)   — manually mark as processed / link to client

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { runIntakeAgent }        = require('./agents/intake-agent');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb = getClient();
  const ip = event.headers['x-forwarded-for'] || '';

  // ── PUBLIC POST — form submission ─────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Basic spam check
    if (body.bot_field || body['bot-field']) {
      return respond(200, { success: true }); // silently accept spam
    }

    const fullName = (body.name || body.full_name || '').trim();
    const email    = (body.contact || body.email  || '').trim();
    const phone    = (body.phone || '').trim();

    if (!fullName) return respond(400, { error: 'Name is required.' });

    // 1. Store raw submission
    const { data: submission, error: subErr } = await sb
      .from('intake_submissions')
      .insert({
        netlify_submission_id: body.netlify_submission_id || null,
        full_name:             fullName,
        email:                 email || null,
        phone:                 phone || null,
        service_requested:     body.service  || null,
        preferred_window_1:    body['window-1'] || body.window1 || null,
        preferred_window_2:    body['window-2'] || body.window2 || null,
        message:               body.message || null,
        raw_data:              body,
        spam_suspect:          false,
        source:                'website_form',
      })
      .select()
      .single();

    if (subErr) return respond(500, { error: 'Could not save submission.' });

    // 2. Run intake agent (find/create client, create session, generate summary)
    try {
      const result = await runIntakeAgent({ submission, sb, ip });
      return respond(201, {
        success:   true,
        submissionId: submission.id,
        clientId:  result.clientId,
        sessionId: result.sessionId,
      });
    } catch (agentErr) {
      console.error('[intake] Agent error:', agentErr.message);
      // Submission saved — agent failure is non-fatal
      return respond(201, { success: true, submissionId: submission.id, agentError: agentErr.message });
    }
  }

  // ── ADMIN GET — list unprocessed ──────────────────────────────────
  if (event.httpMethod === 'GET') {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const params = event.queryStringParameters || {};
    const processed = params.processed === 'true';

    const { data, error } = await sb
      .from('intake_submissions')
      .select('*')
      .eq('processed', processed)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return respond(500, { error: error.message });
    return respond(200, { submissions: data });
  }

  // ── ADMIN PATCH — manually process / link client ──────────────────
  if (event.httpMethod === 'PATCH') {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const params = event.queryStringParameters || {};
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['processed','client_id','session_id','agent_summary','spam_suspect','match_status','matched_at'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    if (updates.processed) updates.processed_at = new Date().toISOString();
    if (updates.client_id && !updates.match_status) {
      updates.match_status = 'matched';
      updates.matched_at   = new Date().toISOString();
    }

    const { data, error } = await sb
      .from('intake_submissions')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'intake_submissions', recordId: params.id, newData: data, context: 'Manually updated intake submission', ip });
    return respond(200, { submission: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
