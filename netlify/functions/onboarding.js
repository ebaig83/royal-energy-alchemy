// /.netlify/functions/onboarding
//
// PUBLIC  POST  — submit onboarding package (intake + session booking)
// ADMIN   GET   — list intakes / single intake detail
// ADMIN   PATCH ?id=uuid — update status, add review notes, advance workflow
// ADMIN   PATCH ?id=uuid&target=package — update onboarding_package payment status

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

// Keys accepted from the written questionnaire form (7 questions)
const RESPONSE_KEYS = [
  'presenting_concerns',
  'goals',
  'stressors',
  'spiritual_concerns',
  'prior_healing_experience',
  'focus_areas',
  'additional_notes',
];

// Intake statuses that represent a completed, reviewable intake
const INTAKE_REVIEWABLE_STATUSES = new Set([
  'completed', 'summary_generated', 'reviewed',
]);

// Maps intake_status changes → package_status updates
const PKG_STATUS_MAP = {
  completed:         'intake_complete',
  summary_generated: 'review_pending',
  reviewed:          'review_complete',
  ready_for_session: 'session_scheduled',
  needs_followup:    'needs_followup',
  cancelled:         'cancelled',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb  = getClient();
  const prm = event.queryStringParameters || {};
  const ip  = (event.headers['x-forwarded-for'] || '').split(',')[0].trim();

  // ── PUBLIC POST — submit onboarding booking ───────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (body.bot_field) return respond(200, { success: true });

    const {
      client_name, client_email, client_phone,
      method,
      intake_date, intake_time,
      time_zone,
      call_consent, ai_consent, recording_consent,
      session_window_1, session_window_2,
      service,
      responses,
      buffer_hours,
    } = body;

    if (!client_name) return respond(400, { error: 'client_name is required.' });
    if (!method || !['written','ai_call'].includes(method)) {
      return respond(400, { error: 'method must be "written" or "ai_call".' });
    }

    // Sanitise questionnaire responses
    const cleanResponses = {};
    if (responses && typeof responses === 'object') {
      RESPONSE_KEYS.forEach(k => {
        if (responses[k]) cleanResponses[k] = String(responses[k]).slice(0, 4000);
      });
    }

    // Written intake requires at least presenting_concerns
    if (method === 'written' && !cleanResponses.presenting_concerns) {
      return respond(400, { error: 'presenting_concerns is required for written intakes.' });
    }

    // 1. Insert intake record
    const intakeRow = {
      client_name:       String(client_name).slice(0, 200),
      client_email:      client_email  ? String(client_email).slice(0, 300)  : null,
      client_phone:      client_phone  ? String(client_phone).slice(0, 50)   : null,
      method,
      intake_date:       intake_date   || null,
      intake_time:       intake_time   || null,
      time_zone:         time_zone     || null,
      call_consent:      !!call_consent,
      ai_consent:        !!ai_consent,
      recording_consent: !!recording_consent,
      responses:         cleanResponses,
      intake_status:     'scheduled',
      source:            'onboarding_form',
    };

    const { data: intake, error: intakeErr } = await sb
      .from('intakes').insert(intakeRow).select().single();
    if (intakeErr) return respond(500, { error: intakeErr.message });

    // 2. Auto-generate summary for written intakes with responses
    let summary = null;
    if (method === 'written' && Object.keys(cleanResponses).length > 0) {
      summary = buildSummary(intakeRow.client_name, cleanResponses);
      await sb.from('intakes')
        .update({ summary, intake_status: 'summary_generated' })
        .eq('id', intake.id);
    }

    // 3. Create session record for the preferred session window
    let sessionId = null;
    if (session_window_1) {
      const { data: sess } = await sb.from('sessions').insert({
        client_name:    intakeRow.client_name,
        service:        service || 'Initial Energy Session',
        status:         'pending',
        payment_status: 'unpaid',
        location_type:  'distance',
        seller_notes:   [
          `[ONBOARDING] Intake method: ${method}`,
          session_window_1 ? `Preferred session: ${session_window_1}` : '',
          session_window_2 ? `Backup session: ${session_window_2}`    : '',
          `Buffer required: ${Number(buffer_hours) || 48}h after intake`,
        ].filter(Boolean).join(' | '),
        source: 'onboarding_form',
      }).select().single();
      if (sess) {
        sessionId = sess.id;
        await sb.from('intakes').update({ session_id: sessionId }).eq('id', intake.id);
      }
    }

    // 4. Create onboarding_package linking intake + session
    const { error: pkgErr } = await sb.from('onboarding_packages').insert({
      intake_id:      intake.id,
      session_id:     sessionId,
      client_name:    intakeRow.client_name,
      client_email:   intakeRow.client_email,
      package_status: 'intake_pending',
      buffer_hours:   Number(buffer_hours) || 48,
      payment_status: 'unpaid',
    });
    if (pkgErr) {
      // Log orphan risk but don't fail the client response — intake + session already created
      console.error('onboarding_packages insert failed:', pkgErr.message);
    }

    await log({
      actor: 'public', action: 'onboarding_submitted',
      tableName: 'intakes', recordId: intake.id,
      newData: {
        method,
        has_responses:  Object.keys(cleanResponses).length > 0,
        has_session:    !!sessionId,
        summary_status: summary ? 'generated' : 'pending',
      },
      ip,
    });

    return respond(201, {
      success:   true,
      intakeId:  intake.id,
      sessionId,
      summary:   summary ? 'generated' : 'pending',
    });
  }

  // ── ADMIN ROUTES ─────────────────────────────────────────────────────
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  // ── ADMIN GET ────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    // Analytics summary
    if (prm.analytics === 'true') {
      const { data: allIntakes } = await sb
        .from('intakes').select('intake_status, method').eq('source', 'onboarding_form');
      const { data: allPkgs } = await sb
        .from('onboarding_packages').select('package_status, payment_status');

      const counts = {};
      (allIntakes || []).forEach(r => {
        counts[r.intake_status] = (counts[r.intake_status] || 0) + 1;
      });
      const methodCounts = {};
      (allIntakes || []).forEach(r => {
        methodCounts[r.method] = (methodCounts[r.method] || 0) + 1;
      });
      const paymentCounts = {};
      (allPkgs || []).forEach(r => {
        paymentCounts[r.payment_status] = (paymentCounts[r.payment_status] || 0) + 1;
      });
      const pkgCounts = {};
      (allPkgs || []).forEach(r => {
        pkgCounts[r.package_status] = (pkgCounts[r.package_status] || 0) + 1;
      });

      return respond(200, {
        total:         (allIntakes || []).length,
        by_status:     counts,
        by_method:     methodCounts,
        by_payment:    paymentCounts,
        by_pkg_status: pkgCounts,
      });
    }

    // Single intake detail (with linked package info)
    if (prm.id) {
      const { data: intake, error } = await sb
        .from('intakes').select('*').eq('id', prm.id).single();
      if (error) return respond(404, { error: 'Not found.' });

      // Fetch linked package
      const { data: pkg } = await sb
        .from('onboarding_packages').select('*').eq('intake_id', prm.id).single();

      return respond(200, { intake, package: pkg || null });
    }

    // List queue
    let q = sb.from('intakes')
      .select(`
        id, client_name, client_email, client_phone, method,
        intake_date, intake_time, intake_status, summary,
        reviewed_by, reviewed_at, review_notes,
        session_id, created_at, responses
      `)
      .eq('source', 'onboarding_form')
      .order('created_at', { ascending: false });

    if (prm.status) q = q.eq('intake_status', prm.status);
    if (prm.method) q = q.eq('method', prm.method);
    if (prm.limit)  q = q.limit(parseInt(prm.limit) || 50);

    const { data, error } = await q;
    if (error) return respond(500, { error: error.message });
    return respond(200, { intakes: data });
  }

  // ── ADMIN PATCH ──────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!prm.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON.' }); }

    // ── Package-level update (payment status, etc.) ──────────────────
    if (prm.target === 'package') {
      const PKG_ALLOWED = ['payment_status','amount_due','payment_method','payment_ref','paid_at','package_status','notes'];
      const pkgUpdates = {};
      PKG_ALLOWED.forEach(k => { if (body[k] !== undefined) pkgUpdates[k] = body[k]; });
      if (body.payment_status === 'paid' && !pkgUpdates.paid_at) {
        pkgUpdates.paid_at = new Date().toISOString();
      }
      const { data: pkgData, error: pkgErr } = await sb
        .from('onboarding_packages').update(pkgUpdates).eq('intake_id', prm.id).select().single();
      if (pkgErr) return respond(500, { error: pkgErr.message });
      await log({
        actor: auth.user?.email, action: 'package_updated',
        tableName: 'onboarding_packages', recordId: prm.id,
        newData: pkgUpdates, ip,
        context: `Package for intake ${prm.id} → payment:${pkgUpdates.payment_status || 'unchanged'}`,
      });
      return respond(200, { package: pkgData });
    }

    // ── Intake-level update ──────────────────────────────────────────
    const ALLOWED = [
      'intake_status','review_notes','reviewed_by','reviewed_at',
      'summary','recommendations','suggested_focus','key_themes',
      'risk_flags','seller_notes','session_id','intake_date','intake_time',
    ];
    const updates = {};
    ALLOWED.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    // Fetch current intake for validation
    const { data: current, error: fetchErr } = await sb
      .from('intakes').select('*').eq('id', prm.id).single();
    if (fetchErr || !current) return respond(404, { error: 'Intake not found.' });

    // ── Guard: reviewed requires intake content ──────────────────────
    if (updates.intake_status === 'reviewed') {
      const hasResponses = current.responses &&
        Object.values(current.responses).some(Boolean);
      const hasSummary   = !!(current.summary || updates.summary);
      if (!hasResponses && !hasSummary) {
        return respond(422, {
          error: 'Cannot mark reviewed — no intake content exists.',
          detail: 'The intake has no questionnaire responses or summary to review.',
          rule:   'review_complete:requires_intake_data',
        });
      }
    }

    // ── Guard: ready_for_session requires review + payment eligibility ─
    if (updates.intake_status === 'ready_for_session') {
      const hasResponses = current.responses &&
        Object.values(current.responses).some(Boolean);
      const hasSummary   = !!(current.summary || updates.summary);
      const wasReviewed  = current.intake_status === 'reviewed' ||
        updates.reviewed_at || current.reviewed_at;

      if (current.method === 'written' && (!hasResponses || !hasSummary)) {
        return respond(422, {
          error: 'Intake must be completed and reviewed before the session can proceed.',
          detail: 'Written intake requires questionnaire responses and a generated summary.',
          rule:   'ready_for_session:requires_written_intake',
        });
      }
      if (!wasReviewed) {
        return respond(422, {
          error: 'Intake must be completed and reviewed before the session can proceed.',
          detail: 'Mark the intake as Reviewed before advancing to Ready for Session.',
          rule:   'ready_for_session:requires_review',
        });
      }

      // Payment eligibility: unpaid/pending blocks session confirmation
      const { data: pkg } = await sb
        .from('onboarding_packages').select('payment_status').eq('intake_id', prm.id).single();
      const payStatus = pkg?.payment_status || 'unpaid';
      if (payStatus === 'unpaid') {
        return respond(422, {
          error: 'Session cannot be confirmed until payment is received.',
          detail: 'Payment status is unpaid. Mark payment as Pending or Paid before advancing.',
          payment_status: payStatus,
          rule:   'ready_for_session:requires_payment_not_unpaid',
        });
      }
    }

    // ── Guard: AI intake requires consent + scheduling fields ─────────
    if (current.method === 'ai_call' &&
        ['completed', 'ready_for_session', 'reviewed'].includes(updates.intake_status)) {
      const hasDate    = !!(current.intake_date   || updates.intake_date);
      const hasTime    = !!(current.intake_time   || updates.intake_time);
      const hasConsent = current.call_consent && current.ai_consent;
      if (!hasDate || !hasTime) {
        return respond(422, {
          error: 'AI intake call cannot be advanced — scheduling fields are missing.',
          detail: 'intake_date and intake_time must be set before advancing an AI intake.',
          rule:   'ai_intake:requires_scheduling',
        });
      }
      if (!hasConsent) {
        return respond(422, {
          error: 'AI intake call cannot be advanced — client consent is missing.',
          detail: 'call_consent and ai_consent must both be true before advancing.',
          rule:   'ai_intake:requires_consent',
        });
      }
    }

    // Auto-stamp review time
    if (updates.intake_status === 'reviewed' && !updates.reviewed_at) {
      updates.reviewed_at = new Date().toISOString();
      updates.reviewed_by = auth.user?.email || 'daron';
    }

    const { data, error } = await sb
      .from('intakes').update(updates).eq('id', prm.id).select().single();
    if (error) return respond(500, { error: error.message });

    // Propagate status to onboarding_package
    if (PKG_STATUS_MAP[updates.intake_status]) {
      await sb.from('onboarding_packages')
        .update({ package_status: PKG_STATUS_MAP[updates.intake_status] })
        .eq('intake_id', prm.id);
    }

    await log({
      actor: auth.user?.email, action: 'intake_updated',
      tableName: 'intakes', recordId: prm.id,
      oldData: current, newData: data,
      context: `Intake ${prm.id} → ${data.intake_status}`, ip,
    });

    return respond(200, { intake: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ── Summary builder (plain text, until AI agent runs) ─────────────────────────
function buildSummary(name, r) {
  const LABELS = {
    presenting_concerns:     'Presenting Concerns',
    goals:                   'Goals',
    stressors:               'Current Stressors',
    spiritual_concerns:      'Spiritual Concerns',
    prior_healing_experience:'Prior Healing Experience',
    focus_areas:             'Requested Focus Areas',
    additional_notes:        'Additional Notes',
  };
  const lines = [`Intake Summary — ${name}`, ''];
  Object.entries(LABELS).forEach(([k, label]) => {
    if (r[k]) lines.push(`${label}:\n${r[k]}`, '');
  });
  return lines.join('\n');
}
