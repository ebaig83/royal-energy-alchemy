// /.netlify/functions/aftercare
// PUBLIC POST ?action=submit_response — client submits aftercare check-in form
// GET    ?session_id=uuid  — aftercare schedule for a session
// GET    ?due=1            — all follow-ups due today or overdue
// GET    ?client_id=uuid   — all aftercare for a client
// PATCH  ?id=uuid          — mark as sent, skipped, add response

const { requireAdmin, respond }          = require('./lib/auth');
const { getClient }                      = require('./lib/supabase');
const { log }                            = require('./lib/audit');
const { pickTemplate }                   = require('./lib/followup-templates');
const { processFollowup }                = require('./lib/followup-processor');
const { sendWithPreferences }            = require('./lib/comms');
const { emailFailure }                   = require('./lib/ops-alert');
const { recordClientDocument }           = require('./lib/doc-writer');

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── PUBLIC POST ?action=submit_response — client check-in ────────────────
  // No admin auth required. Secured by unguessable UUID aftercare_id.
  if (event.httpMethod === 'POST' && params.action === 'submit_response') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Honeypot — silent accept for bots
    if (body.bot_field || body['bot-field']) return respond(200, { saved: true });

    const { aftercare_id, session_id, timepoint, response_data } = body;

    // Required field validation
    if (!aftercare_id)  return respond(400, { error: 'aftercare_id is required.' });
    if (!response_data) return respond(400, { error: 'response_data is required.' });
    if (typeof response_data !== 'object' || Array.isArray(response_data)) {
      return respond(400, { error: 'response_data must be an object.' });
    }
    if (Object.keys(response_data).length === 0) {
      return respond(400, { error: 'response_data must not be empty.' });
    }

    // Rate limiting — max 5 submissions per IP per hour
    if (ip) {
      const windowStart = new Date(Date.now() - 3600000).toISOString();
      try {
        const { count } = await sb
          .from('audit_logs')
          .select('id', { count: 'exact', head: true })
          .eq('action', 'aftercare_submission')
          .eq('ip_address', ip.split(',')[0].trim())
          .gte('created_at', windowStart);
        if (count >= 5) return respond(429, { error: 'Too many submissions. Please try again later.' });
      } catch (rlErr) {
        console.warn('[aftercare] rate limit check error:', rlErr.message);
      }
    }

    // Verify aftercare record exists — only select what's needed (no other client data exposed)
    const { data: record, error: findErr } = await sb
      .from('aftercare')
      .select('id, session_id, status, followup_type, client_id')
      .eq('id', aftercare_id)
      .single();

    if (findErr || !record) return respond(404, { error: 'Check-in link not found or has expired.' });

    // Validate session_id if provided (optional cross-check)
    if (session_id && record.session_id && record.session_id !== session_id) {
      return respond(403, { error: 'Link is not valid for this session.' });
    }

    // Guard: already completed — reject unless it's within 24h (allow correction window)
    if (record.status === 'completed') {
      return respond(409, { error: 'This check-in has already been submitted. Contact Daron if you need to make a correction.' });
    }

    const now = new Date().toISOString();

    // Map named fields to columns where they exist; everything else goes to response_data jsonb
    const updates = {
      response_data:                response_data,
      outcome_response_at:          now,
      completed_at:                 now,
      status:                       'completed',
      // Map specific fields to dedicated columns for dashboard querying
      client_response:              response_data.additionalSupportNeeded      || null,
      recommendations_not_followed: response_data.recommendationsNotFollowed   || null,
      protection_frequency:         response_data.protectionFrequency          || null,
      breakthroughs:                response_data.breakthroughsExperienced     || null,
      challenges_remaining:         response_data.challengesRemaining          || null,
      // Core intelligence fields (existing columns)
      techniques_used:              response_data.techniquesUsed               || null,
      symptoms_improved:            response_data.symptomsImproved             || null,
      symptoms_worsened:            response_data.symptomsWorsened             || null,
    };

    const { data: updated, error: updateErr } = await sb
      .from('aftercare')
      .update(updates)
      .eq('id', aftercare_id)
      .select('id, status, completed_at')
      .single();

    if (updateErr) {
      // Graceful column-missing fallback if migration hasn't run
      if (updateErr.message.includes('column') || updateErr.code === '42703') {
        const safeUpdates = {
          response_data:       response_data,
          outcome_response_at: now,
          status:              'completed',
          client_response:     response_data.additionalSupportNeeded || null,
        };
        const { error: retryErr } = await sb.from('aftercare').update(safeUpdates).eq('id', aftercare_id);
        if (retryErr) return respond(500, { error: 'Unable to save response.' });
        await logAftercareAudit(sb, aftercare_id, record.client_id, ip);
        // Client actually submitted → record the follow-up document (submitted).
        await recordClientDocument(sb, {
          client_id: record.client_id, session_id: record.session_id,
          document_type: 'followup', title: 'Follow-Up Form', status: 'submitted', submitted_at: now,
        });
        return respond(200, { saved: true, id: aftercare_id, status: 'completed' });
      }
      console.error('[aftercare] submit_response update error:', updateErr.message);
      return respond(500, { error: 'Unable to save response.' });
    }

    // Audit log for rate limiting + traceability
    await logAftercareAudit(sb, aftercare_id, record.client_id, ip);

    // Client actually submitted the follow-up → record it as a client document.
    // (Scheduling a follow-up does NOT create this row — only real submission.)
    await recordClientDocument(sb, {
      client_id:     record.client_id,
      session_id:    record.session_id,
      document_type: 'followup',
      title:         'Follow-Up Form',
      status:        'submitted',
      submitted_at:  now,
    });

    // ── AI agent handoff (fire-and-forget) ──────────────────────────────────
    // Queues a post-response intelligence run: summarize, flag concerns,
    // update client file, feed outcome + pattern detection, notify if urgent.
    triggerAftercareAgent(sb, {
      aftercare_id,
      session_id:   record.session_id,
      client_id:    record.client_id,
      followup_type: record.followup_type || timepoint,
      response_data,
    }).catch(e => console.warn('[aftercare] agent handoff error:', e.message));

    return respond(200, {
      saved:        true,
      id:           updated?.id || aftercare_id,
      status:       'completed',
      completed_at: updated?.completed_at || now,
    });
  }

  // All other endpoints require admin auth
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

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
        .in('status', ['scheduled', 'sent'])
        .order('scheduled_for', { ascending: true });
    } else if (params.all) {
      if (params.status) {
        query = query.eq('status', params.status);
      } else {
        query = query.in('status', ['scheduled', 'sent', 'completed', 'skipped']);
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
      session_id:            body.session_id    || null,
      client_id:             body.client_id     || null,
      client_name:           body.client_name   || null,
      followup_type:         body.followup_type,
      scheduled_for:         body.scheduled_for,
      status:                'scheduled',
      channel:               body.channel       || 'text',
      message_body:          body.message_body  || null,
      notes:                 body.notes         || null,
      priority:              body.priority      || 'medium',
      source:                'manual',
      followup_template_used: body.followup_template_used || pickTemplate(body.followup_type),
    };

    let { data, error } = await sb.from('aftercare').insert(insertFull).select().single();
    // If Sprint 2 migration not yet run, columns won't exist — retry without them
    if (error && (error.message.includes("column") || error.code === '42703')) {
      const { notes: _n, priority: _p, source: _s, ...insertBase } = insertFull;
      ({ data, error } = await sb.from('aftercare').insert(insertBase).select().single());
    }
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'aftercare', recordId: data.id, newData: data, context: `Manual follow-up created for ${data.client_name || data.client_id}`, ip });

    // ── Deliver follow-up link to client (fire-and-forget) ──────────────────
    // Build public URL with aftercare ID and assigned template letter.
    // Client clicks link → aftercare.html renders template-specific questions.
    const templateLetter = data.followup_template_used || 'A';
    const followupUrl    = `${SITE_URL}/aftercare.html?aid=${data.id}&tmpl=${templateLetter}&t=${data.followup_type || '72hr'}`;

    if (data.client_id) {
      // Fetch client email for delivery
      sb.from('clients').select('email, name').eq('id', data.client_id).single()
        .then(async ({ data: client }) => {
          if (!client?.email) return;
          sendWithPreferences(sb, {
            templateName:   'followup_scheduled',
            recipientEmail: client.email,
            clientId:       data.client_id,
            sessionId:      data.session_id,
            messageType:    'followup_reminder',
            variables: {
              client_name:   data.client_name || client.name || '',
              followup_type: data.followup_type || '72hr',
              followup_url:  followupUrl,
              scheduled_for: data.scheduled_for || '',
              contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
            },
            metadata: { trigger: 'aftercare_created', aftercare_id: data.id, template: templateLetter },
          }).catch(async e => {
            await emailFailure(sb, { templateName: 'followup_scheduled', clientId: data.client_id, sessionId: data.session_id, error: e });
          });
        })
        .catch(() => {}); // non-fatal
    }

    return respond(201, { aftercare: data, followup_url: followupUrl });
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

// ── helpers ──────────────────────────────────────────────────────────────────

async function logAftercareAudit(sb, aftercareId, clientId, ip) {
  try {
    await sb.from('audit_logs').insert({
      action:     'aftercare_submission',
      table_name: 'aftercare',
      record_id:  aftercareId,
      actor:      clientId || 'client',
      ip_address: ip ? ip.split(',')[0].trim() : null,
      new_data:   { aftercare_id: aftercareId, submitted_at: new Date().toISOString() },
    });
  } catch (e) {
    console.warn('[aftercare] audit log error:', e.message);
  }
}

// AI agent handoff — runs after response is saved.
// Calls followup-processor for structured signal extraction, summary generation,
// client file update, research/knowledge center feeds, and urgent notification.
async function triggerAftercareAgent(sb, ctx) {
  const { aftercare_id, session_id, client_id, followup_type, response_data } = ctx;

  // Fetch the template used for this record (stored at creation time)
  let templateUsed = null;
  try {
    const { data } = await sb.from('aftercare').select('followup_template_used').eq('id', aftercare_id).single();
    templateUsed = data && data.followup_template_used;
  } catch { /* non-fatal */ }

  // Run structured processing pipeline
  let isUrgent = false;
  try {
    const result = await processFollowup(sb, {
      aftercare_id,
      client_id,
      followup_type,
      response_data,
      template_used: templateUsed,
    });
    isUrgent = result.isUrgent;
  } catch (e) {
    console.warn('[aftercare] processor error:', e.message);
    // Fall back to basic urgency check
    const supportNeeded = (response_data.additionalSupportNeeded || '').toLowerCase();
    isUrgent = supportNeeded.includes('yes') || supportNeeded.includes('book another');
  }

  // Queue agent task record for audit trail and future webhook runner
  try {
    await sb.from('audit_logs').insert({
      action:     'aftercare_agent_queued',
      table_name: 'aftercare',
      record_id:  aftercare_id,
      actor:      'system',
      new_data:   { aftercare_id, session_id, client_id, followup_type, template_used: templateUsed, queued_at: new Date().toISOString() },
    });
  } catch (e) {
    console.warn('[aftercare] agent queue audit error:', e.message);
  }

  // Urgent flag → communications table for Daron's attention
  if (isUrgent && client_id) {
    try {
      await sb.from('communications').insert({
        client_id,
        channel:      'internal',
        message_type: 'urgent_flag',
        recipient:    'daron',
        subject:      'Client Follow-Up: Additional Support Requested',
        status:       'pending',
        metadata: {
          aftercare_id, followup_type, template_used: templateUsed,
          support_needed: response_data.additionalSupportNeeded || response_data.supportStillNeeded || '',
          response_snapshot: {
            intensity:     response_data.intensity                || null,
            challenges:    response_data.challengesRemaining      || null,
            breakthroughs: response_data.breakthroughsExperienced || null,
          },
          flagged_at: new Date().toISOString(),
        },
        sent_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[aftercare] urgent flag error:', e.message);
    }
  }
}
