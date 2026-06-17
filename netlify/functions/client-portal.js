// /.netlify/functions/client-portal
//
// Returns a client's portal dashboard payload. Two access paths reach the SAME
// client account (Sprint 17):
//   1. Portal token  — GET ?token=<portal_token>            (booking-email path)
//   2. Account login — Authorization: Bearer <supabase JWT> (website login path)
//
// service_role stays server-side; the function enforces that the caller only
// ever receives their own client record. RLS provides defense-in-depth for any
// direct client-side reads.

'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

const DOCS = [
  { type: 'privacy_policy',                    title: 'Privacy Policy',                               page: '/privacy-policy.html',                   mode: 'acknowledge', required: true },
  { type: 'ai_recording_transcription_policy', title: 'AI Use, Recording & Transcription Disclosure', page: '/ai-recording-transcription-policy.html', mode: 'acknowledge', required: true },
  { type: 'recording_policy',                  title: 'Recording Policy',                             page: '/recording-policy.html',                 mode: 'acknowledge', required: true },
  { type: 'cancellation_policy',               title: 'Cancellation Policy',                          page: '/cancellation-policy.html',              mode: 'acknowledge', required: true },
  { type: 'payment_policy',                    title: 'Payment Policy',                               page: '/payment-policy.html',                   mode: 'acknowledge', required: true },
  { type: 'waiver',                            title: 'Waiver / Legal Agreement',                     page: '/waiver-esign.html',                     mode: 'sign',        required: true },
  { type: 'intake',                            title: 'Full Intake',                                  page: '/full-intake.html',                      mode: 'submit',      required: true },
  { type: 'full_assessment',                   title: 'Full Assessment',                              page: '/full-assessment.html',                  mode: 'submit',      required: true },
  { type: 'assessment',                        title: 'Public Assessment',                            page: '/assess.html',                           mode: 'submit',      required: false },
  { type: 'treatment_plan',                    title: 'Treatment Plan',                               page: null,                                     mode: 'view',        required: false },
  { type: 'followup',                          title: 'Follow-Up Forms',                              page: null,                                     mode: 'submit',      required: false },
];

const DONE = {
  acknowledge: ['acknowledged', 'signed', 'submitted', 'complete'],
  sign:        ['signed', 'complete'],
  submit:      ['submitted', 'complete'],
  view:        ['viewed', 'complete', 'added'],
};

function isMissingTableError(err) {
  if (!err) return false;
  const c = err.code || '', m = err.message || '';
  return c === '42P01' || c === 'PGRST204' || c === 'PGRST200' ||
    m.includes('does not exist') || m.includes('Could not find') || m.includes('schema cache');
}

function bearer(event) {
  const h = event.headers['authorization'] || event.headers['Authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const token  = (params.token || params.t || '').trim();
  const jwt    = bearer(event);

  let client = null;
  let via = null;

  // ── Path 1: account login (Bearer JWT) ────────────────────────────────────
  if (jwt) {
    const { data: userData, error: authErr } = await sb.auth.getUser(jwt);
    if (authErr || !userData || !userData.user) {
      return respond(401, { error: 'Your session has expired. Please log in again.' });
    }
    const authUser = userData.user;
    const emailNorm = (authUser.email || '').toLowerCase().trim();

    // Email must match exactly one booked client.
    const { data: matches } = await sb
      .from('clients')
      .select('id, full_name, email, tags, created_at, auth_user_id, portal_access_method, portal_login_count')
      .eq('email', emailNorm);
    if (!matches || matches.length === 0) {
      return respond(403, { error: 'No client record matches this email. Please use the email you booked with.' });
    }
    if (matches.length > 1) {
      // Duplicate emails — flag for practitioner review, never auto-link.
      await sb.from('clients').update({ duplicate_flag: true }).eq('email', emailNorm);
      return respond(409, { error: 'Multiple records found for this email. Daron has been notified to review your account.' });
    }
    client = matches[0];
    via = 'account';

    // Link auth user + login tracking.
    const existing = client.portal_access_method;
    const updates = {
      auth_user_id:        client.auth_user_id || authUser.id,
      portal_last_login:   new Date().toISOString(),
      portal_login_count:  (client.portal_login_count || 0) + 1,
      portal_access_method: (existing && existing !== 'account') ? 'both' : 'account',
    };
    if (!client.auth_user_id) updates.portal_account_created = new Date().toISOString();
    await sb.from('clients').update(updates).eq('id', client.id);

  // ── Path 2: portal token ──────────────────────────────────────────────────
  } else if (token && token.length >= 16) {
    // Select ONLY long-standing columns so this path keeps working even before
    // the Sprint 17 account migration is applied (no regression to token access).
    const { data, error } = await sb
      .from('clients')
      .select('id, full_name, email, tags, created_at')
      .eq('portal_token', token)
      .single();
    if (error || !data) return respond(404, { error: 'This access link is invalid or has expired.' });
    client = data;
    via = 'token';
    // Best-effort access-method tracking — a no-op if account columns are not
    // yet migrated (the inner query simply errors and is swallowed).
    try {
      const { data: acc } = await sb.from('clients').select('portal_access_method, auth_user_id').eq('id', client.id).single();
      if (acc) {
        client.auth_user_id = acc.auth_user_id;
        const existing = acc.portal_access_method;
        await sb.from('clients').update({
          portal_access_method: (existing && existing !== 'token') ? 'both' : 'token',
        }).eq('id', client.id);
      }
    } catch (e) { /* columns not migrated yet — non-fatal */ }

  } else {
    return respond(401, { error: 'Sign in or use your secure portal link to view your portal.' });
  }

  const payload = await buildPayload(sb, client, token);
  payload.access_method = via;
  return respond(200, payload);
};

async function buildPayload(sb, client, token) {
  const clientName = client.full_name || 'Client';
  const tags       = (client.tags || []).map(t => String(t).toLowerCase());
  const today      = new Date().toISOString().slice(0, 10);

  // ── Sessions → appointments + relevant session ────────────────────────────
  let sessions = [];
  try {
    const { data } = await sb
      .from('sessions')
      .select('id, service, session_date, session_time, status, payment_status, intake_status, waiver_status, waiver_signed_at, amount_due, amount_paid')
      .eq('client_id', client.id)
      .order('session_date', { ascending: true });
    sessions = data || [];
  } catch (e) { /* non-fatal */ }

  const sessionRow = sessions.find(s => s.session_date >= today && ['pending', 'confirmed'].includes(s.status))
                  || sessions[sessions.length - 1] || null;

  const appointments = sessions.map(s => ({
    id:             s.id,
    service:        s.service,
    session_date:   s.session_date,
    session_time:   s.session_time ? s.session_time.slice(0, 5) : null,
    status:         s.status,
    payment_status: s.payment_status,
    upcoming:       s.session_date >= today && !['cancelled', 'completed'].includes(s.status),
    manage_url:     `${SITE_URL}/manage-appointment.html?session_id=${s.id}`,
  }));

  const appointment = sessionRow ? {
    service:        sessionRow.service,
    session_date:   sessionRow.session_date,
    session_time:   sessionRow.session_time ? sessionRow.session_time.slice(0, 5) : null,
    status:         sessionRow.status,
    payment_status: sessionRow.payment_status,
  } : null;

  // ── Document rows ──────────────────────────────────────────────────────────
  let rows = [];
  try {
    const { data, error } = await sb
      .from('client_documents')
      .select('document_type, title, status, version, viewed_at, acknowledged_at, signed_at, submitted_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: true });
    if (error && !isMissingTableError(error)) throw error;
    rows = data || [];
  } catch (e) { /* table may not exist yet */ }
  const rowOf = type => rows.filter(r => r.document_type === type).sort((a, b) => (b.version || '') > (a.version || '') ? 1 : -1)[0];

  let followupDerived = 'not_started';
  try {
    const { data: ac } = await sb.from('aftercare').select('status').eq('client_id', client.id);
    if (ac && ac.length && ac.some(a => a.status === 'scheduled' || a.status === 'pending')) {
      followupDerived = 'pending';
    }
  } catch (e) { /* non-fatal */ }

  const sid   = sessionRow ? sessionRow.id : '';
  const email = encodeURIComponent(client.email || '');
  const tk    = encodeURIComponent(token || '');

  function derive(def) {
    switch (def.type) {
      case 'waiver':
        if (sessionRow && sessionRow.waiver_status === 'signed') return { status: 'signed', signed_at: sessionRow.waiver_signed_at || null };
        if (tags.includes('waiver')) return { status: 'signed' };
        return { status: 'not_started' };
      case 'intake':
        if (sessionRow && sessionRow.intake_status === 'complete') return { status: 'submitted' };
        if (tags.includes('intake')) return { status: 'submitted' };
        return { status: 'not_started' };
      case 'assessment':
        return { status: tags.includes('assessment') ? 'submitted' : 'not_started' };
      case 'followup':
        return { status: followupDerived };
      default:
        return { status: 'not_started' };
    }
  }
  function actionLink(def) {
    // Token is appended only when present (token path). Account-path links rely
    // on the logged-in session; the pages also accept a token when available.
    const t = tk ? `&token=${tk}` : '';
    const tq = tk ? `?token=${tk}` : '';
    if (def.mode === 'acknowledge' && def.page) return `${SITE_URL}${def.page}${tq}`;
    if (def.type === 'waiver')  return `${SITE_URL}/waiver-esign.html?session_id=${sid}&email=${email}${t}`;
    if (def.type === 'intake')  return `${SITE_URL}/full-intake.html?session_id=${sid}&name=${encodeURIComponent(clientName)}&email=${email}${t}`;
    if (def.type === 'full_assessment') return `${SITE_URL}/full-assessment.html?session_id=${sid}${t}`;
    if (def.type === 'assessment') return `${SITE_URL}/assess.html${tq}`;
    return def.page ? `${SITE_URL}${def.page}` : null;
  }
  function actionLabel(def, done) {
    if (done) return 'View';
    if (def.mode === 'acknowledge') return 'Acknowledge';
    if (def.mode === 'sign')        return 'Sign';
    if (def.type === 'treatment_plan') return null;
    return 'Complete';
  }

  let requiredComplete = true;
  let requiredTotal = 0, requiredDone = 0;
  const documents = DOCS.map(def => {
    const row = rowOf(def.type);
    const der = derive(def);
    const status = row ? row.status : der.status;
    const done   = (DONE[def.mode] || []).includes(status);
    if (def.required) { requiredTotal++; if (done) requiredDone++; else requiredComplete = false; }
    return {
      type: def.type, title: def.title, required: def.required, status,
      version:         (row && row.version) || 'v1',
      viewed_at:       row ? row.viewed_at : null,
      acknowledged_at: row ? row.acknowledged_at : null,
      signed_at:       row ? row.signed_at : (der.signed_at || null),
      submitted_at:    row ? row.submitted_at : null,
      action_label:    (def.type === 'treatment_plan' && !done) ? null : actionLabel(def, done),
      action_url:      (def.type === 'treatment_plan' && !done) ? null : actionLink(def),
      done,
    };
  });

  const statuses = {};
  documents.forEach(d => { statuses[d.type] = d.status; });

  // ── Progress ───────────────────────────────────────────────────────────────
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const treatmentDoc = rowOf('treatment_plan');
  const progress = {
    session_count:        completedSessions,
    total_sessions:       sessions.length,
    documents_completed:  requiredDone,
    documents_total:      requiredTotal,
    completion_percent:   requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 0,
    followup_status:      statuses.followup,
    treatment_plan_status: treatmentDoc ? treatmentDoc.status : 'not_available',
  };

  // ── Purchases (lightweight read-only mapping from sessions) ─────────────────
  const PAY_STATUS = { paid: 'Paid', pending: 'Pending', unpaid: 'Unpaid', refunded: 'Refunded', partial: 'Partial', exchange: 'Package Credit', waived: 'Package Credit' };
  let outstanding = 0, paidCount = 0, pendingCount = 0;
  const purchases = sessions.map(s => {
    const due  = Number(s.amount_due || 0);
    const paid = Number(s.amount_paid || 0);
    const bal  = Math.max(due - paid, 0);
    const ps   = (s.payment_status || 'unpaid').toLowerCase();
    if (ps === 'paid' || ps === 'exchange' || ps === 'waived') paidCount++;
    else { pendingCount++; outstanding += bal; }
    return {
      service:        s.service,
      date:           s.session_date,
      amount_due:     due,
      amount_paid:    paid,
      balance:        bal,
      status:         PAY_STATUS[ps] || (s.payment_status || 'Unpaid'),
      reference:      s.id,
    };
  });
  const purchases_summary = { paid: paidCount, pending: pendingCount, outstanding };

  // ── Questions (own) ─────────────────────────────────────────────────────────
  let questions = [];
  try {
    const { data, error } = await sb
      .from('client_questions')
      .select('id, question, category, priority, status, practitioner_response, preferred_contact_method, submitted_at, responded_at')
      .eq('client_id', client.id)
      .order('submitted_at', { ascending: false });
    if (error && !isMissingTableError(error)) throw error;
    questions = data || [];
  } catch (e) { /* table may not exist yet */ }
  const openQuestions = questions.filter(q => q.status === 'new' || q.status === 'in_review').length;
  const questions_summary = { open: openQuestions, total: questions.length, latest_status: questions[0] ? questions[0].status : null };

  return {
    client: { name: clientName, email: client.email, since: client.created_at, has_account: !!client.auth_user_id },
    appointment,
    appointments,
    documents,
    statuses,
    progress,
    purchases,
    purchases_summary,
    questions,
    questions_summary,
    required_complete: requiredComplete,
  };
}
