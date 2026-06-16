// /.netlify/functions/intake
// POST (public — no auth)  — receives form submission, runs intake agent,
//                            creates/matches client, creates session record
// GET  (admin auth)        — list unprocessed intake submissions
// PATCH ?id=uuid (admin)   — manually mark as processed / link to client

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { runIntakeAgent }        = require('./agents/intake-agent');
const { sendTransactional }     = require('./lib/mailer');

// Rate limits for public intake POST (per IP)
const RATE_SHORT_MAX  = 5;    // 5 per 10 minutes
const RATE_SHORT_SECS = 600;
const RATE_DAY_MAX    = 20;   // 20 per 24 hours
const RATE_DAY_SECS   = 86400;

async function checkIntakeRateLimit(sb, ip) {
  if (!ip || ip === 'unknown') return false;
  const now = Date.now();
  const shortWindow = new Date(now - RATE_SHORT_SECS * 1000).toISOString();
  const dayWindow   = new Date(now - RATE_DAY_SECS   * 1000).toISOString();
  const [shortRes, dayRes] = await Promise.all([
    sb.from('audit_logs').select('id', { count: 'exact', head: true })
      .eq('action', 'intake_submission').eq('ip_address', ip).gte('created_at', shortWindow),
    sb.from('audit_logs').select('id', { count: 'exact', head: true })
      .eq('action', 'intake_submission').eq('ip_address', ip).gte('created_at', dayWindow),
  ]);
  return (shortRes.count >= RATE_SHORT_MAX) || (dayRes.count >= RATE_DAY_MAX);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb = getClient();
  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // ── PUBLIC POST — form submission ─────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Honeypot check first — silently accept spam before rate limit burn
    if (body.bot_field || body['bot-field']) {
      return respond(200, { success: true });
    }

    // Rate limit
    try {
      const limited = await checkIntakeRateLimit(sb, ip);
      if (limited) {
        return respond(429, { error: 'Too many requests. Please try again later.' });
      }
    } catch (rlErr) {
      console.error('[intake] Rate limit check error:', rlErr.message);
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

    // Log the submission for rate limiting (non-fatal if it fails)
    await log({ actor: 'public', action: 'intake_submission', tableName: 'intake_submissions', recordId: submission.id, ip });

    // 2. Run intake agent (find/create client, create session, generate summary)
    let agentResult = null;
    try {
      agentResult = await runIntakeAgent({ submission, sb, ip });

      // 3. Send intake_received confirmation email (fire-and-forget)
      if (email) {
        sendTransactional(sb, {
          templateName:   'intake_received',
          recipientEmail: email,
          clientId:       agentResult.clientId || null,
          variables: {
            client_name:   fullName,
            service:       body.service || 'your session',
            contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
          },
          metadata: { trigger: 'intake_received', submission_id: submission.id },
        }).catch(e => console.warn('[intake] intake_received email error:', e.message));
      }

      return respond(201, {
        success:      true,
        submissionId: submission.id,
        clientId:     agentResult.clientId,
        sessionId:    agentResult.sessionId,
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
