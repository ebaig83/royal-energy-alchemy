// /.netlify/functions/onboarding
//
// PUBLIC  POST  — submit onboarding package (intake + session booking together)
// ADMIN   GET   — list intakes / onboarding packages
// ADMIN   PATCH ?id=uuid — update intake status, add review notes, mark reviewed

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const RESPONSE_KEYS = [
  'presenting_concerns',
  'goals',
  'stressors',
  'spiritual_concerns',
  'prior_healing_experience',
  'expectations',
  'focus_areas',
  'life_circumstances',
  'additional_notes',
];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb  = getClient();
  const prm = event.queryStringParameters || {};
  const ip  = (event.headers['x-forwarded-for'] || '').split(',')[0].trim();

  // ── PUBLIC POST — submit onboarding booking ───────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Honeypot
    if (body.bot_field) return respond(200, { success: true });

    const {
      client_name, client_email, client_phone,
      method,           // 'written' | 'ai_call'
      intake_date, intake_time,
      session_window_1, session_window_2,  // preferred session slots (labels)
      service,
      responses,        // written questionnaire answers
      buffer_hours,
    } = body;

    if (!client_name) return respond(400, { error: 'client_name is required.' });
    if (!method || !['written','ai_call'].includes(method)) {
      return respond(400, { error: 'method must be "written" or "ai_call".' });
    }

    // Sanitise responses
    const cleanResponses = {};
    if (responses && typeof responses === 'object') {
      RESPONSE_KEYS.forEach(k => {
        if (responses[k]) cleanResponses[k] = String(responses[k]).slice(0, 4000);
      });
    }

    // 1. Insert intake record
    const intakeRow = {
      client_name:   String(client_name).slice(0, 200),
      client_email:  client_email  ? String(client_email).slice(0, 300)  : null,
      client_phone:  client_phone  ? String(client_phone).slice(0, 50)   : null,
      method,
      intake_date:   intake_date   || null,
      intake_time:   intake_time   || null,
      responses:     cleanResponses,
      intake_status: 'scheduled',
      source:        'onboarding_form',
    };

    const { data: intake, error: intakeErr } = await sb
      .from('intakes').insert(intakeRow).select().single();
    if (intakeErr) return respond(500, { error: intakeErr.message });

    // 2. Auto-generate summary for written intakes
    let summary = null;
    if (method === 'written' && Object.keys(cleanResponses).length > 0) {
      summary = buildSummary(client_name, cleanResponses);
      await sb.from('intakes')
        .update({ summary, intake_status: 'summary_generated' })
        .eq('id', intake.id);
    }

    // 3. Create a session record for the preferred session window
    let sessionId = null;
    if (session_window_1) {
      const { data: sess } = await sb.from('sessions').insert({
        client_name:   intakeRow.client_name,
        service:       service || 'Initial Energy Session',
        status:        'pending',
        payment_status:'unpaid',
        location_type: 'distance',
        seller_notes:  [
          session_window_1 ? `Preferred: ${session_window_1}` : '',
          session_window_2 ? `Backup: ${session_window_2}`    : '',
        ].filter(Boolean).join(' | '),
        source:        'onboarding_form',
      }).select().single();
      if (sess) {
        sessionId = sess.id;
        await sb.from('intakes').update({ session_id: sessionId }).eq('id', intake.id);
      }
    }

    // 4. Create onboarding_package record linking intake + session
    await sb.from('onboarding_packages').insert({
      intake_id:      intake.id,
      session_id:     sessionId,
      client_name:    intakeRow.client_name,
      client_email:   intakeRow.client_email,
      package_status: 'intake_pending',
      buffer_hours:   Number(buffer_hours) || 48,
    });

    await log({
      actor: 'public', action: 'onboarding_submitted',
      tableName: 'intakes', recordId: intake.id,
      newData: { method, has_responses: Object.keys(cleanResponses).length > 0 },
      ip,
    });

    return respond(201, {
      success:   true,
      intakeId:  intake.id,
      sessionId,
      summary:   summary ? 'generated' : 'pending',
    });
  }

  // ── ADMIN ROUTES ──────────────────────────────────────────────
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  // ── ADMIN GET — list onboarding queue ────────────────────────
  if (event.httpMethod === 'GET') {
    if (prm.id) {
      // Single intake detail
      const { data, error } = await sb.from('intakes').select('*').eq('id', prm.id).single();
      if (error) return respond(404, { error: 'Not found.' });
      return respond(200, { intake: data });
    }

    // Join intakes + onboarding_packages for queue view
    let q = sb.from('intakes')
      .select(`
        id, client_name, client_email, client_phone, method,
        intake_date, intake_time, intake_status, summary,
        recommendations, suggested_focus, risk_flags,
        reviewed_by, reviewed_at, review_notes,
        session_id, created_at, responses
      `)
      .order('created_at', { ascending: false });

    if (prm.status)  q = q.eq('intake_status', prm.status);
    if (prm.method)  q = q.eq('method', prm.method);
    if (prm.limit)   q = q.limit(parseInt(prm.limit) || 50);

    const { data, error } = await q;
    if (error) return respond(500, { error: error.message });
    return respond(200, { intakes: data });
  }

  // ── ADMIN PATCH — update intake status / review ───────────────
  if (event.httpMethod === 'PATCH') {
    if (!prm.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON.' }); }

    const ALLOWED = [
      'intake_status','review_notes','reviewed_by','reviewed_at',
      'summary','recommendations','suggested_focus','key_themes',
      'risk_flags','seller_notes','session_id','intake_date','intake_time',
    ];
    const updates = {};
    ALLOWED.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    // Auto-stamp review time
    if (updates.intake_status === 'reviewed' && !updates.reviewed_at) {
      updates.reviewed_at = new Date().toISOString();
      updates.reviewed_by = auth.user?.email || 'daron';
    }

    const { data: oldData } = await sb.from('intakes').select('*').eq('id', prm.id).single();
    const { data, error }   = await sb.from('intakes').update(updates).eq('id', prm.id).select().single();
    if (error) return respond(500, { error: error.message });

    // Propagate to onboarding_package
    const pkgStatusMap = {
      completed:            'intake_complete',
      summary_generated:    'review_pending',
      reviewed:             'review_complete',
      ready_for_session:    'session_scheduled',
    };
    if (pkgStatusMap[updates.intake_status]) {
      await sb.from('onboarding_packages')
        .update({ package_status: pkgStatusMap[updates.intake_status] })
        .eq('intake_id', prm.id);
    }

    await log({
      actor: auth.user?.email, action: 'updated',
      tableName: 'intakes', recordId: prm.id,
      oldData, newData: data,
      context: `Intake ${prm.id} → ${data.intake_status}`, ip,
    });

    return respond(200, { intake: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ── Summary builder (plain text, used until AI agent runs) ────────────────────
function buildSummary(name, r) {
  const LABELS = {
    presenting_concerns:     'Presenting Concerns',
    goals:                   'Goals',
    stressors:               'Current Stressors',
    spiritual_concerns:      'Spiritual Concerns',
    prior_healing_experience:'Prior Healing Experience',
    expectations:            'Expectations',
    focus_areas:             'Requested Focus Areas',
    life_circumstances:      'Life Circumstances',
    additional_notes:        'Additional Notes',
  };
  const lines = [`Intake Summary — ${name}`, ''];
  Object.entries(LABELS).forEach(([k, label]) => {
    if (r[k]) lines.push(`${label}:\n${r[k]}`, '');
  });
  return lines.join('\n');
}
