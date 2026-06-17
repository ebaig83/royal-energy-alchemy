// /.netlify/functions/client-portal
//
// PUBLIC — no dashboard login. Clients reach their document hub via a secure
// portal token issued on their client record (clients.portal_token).
//
// GET ?token=<portal_token> — return the client's document hub:
//   { client, appointment, documents[], required_complete, statuses }
//
// Every required document is returned SEPARATELY (assessment, the five
// policies, waiver, intake, treatment plan, follow-ups). Waiver completion and
// intake completion are never collapsed into one another.

'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

// Ordered document registry the portal renders. `required` flags the docs that
// must be complete before a booking is considered fully ready.
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const sb    = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const token  = (params.token || params.t || '').trim();
  if (!token || token.length < 16) return respond(400, { error: 'A valid access link is required.' });

  // ── Validate token → client ──────────────────────────────────────────────
  const { data: client, error: clientErr } = await sb
    .from('clients')
    .select('id, full_name, email, tags, created_at')
    .eq('portal_token', token)
    .single();
  if (clientErr || !client) return respond(404, { error: 'This access link is invalid or has expired.' });

  const clientName = client.full_name || 'Client';
  const tags       = (client.tags || []).map(t => String(t).toLowerCase());

  // ── Relevant session (next upcoming, else latest) ─────────────────────────
  let appointment = null, sessionRow = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: sessions } = await sb
      .from('sessions')
      .select('id, service, session_date, session_time, status, payment_status, intake_status, waiver_status, waiver_signed_at')
      .eq('client_id', client.id)
      .order('session_date', { ascending: true });
    if (sessions && sessions.length) {
      sessionRow = sessions.find(s => s.session_date >= today && ['pending', 'confirmed'].includes(s.status))
                || sessions[sessions.length - 1];
      if (sessionRow) appointment = {
        service:        sessionRow.service,
        session_date:   sessionRow.session_date,
        session_time:   sessionRow.session_time ? sessionRow.session_time.slice(0, 5) : null,
        status:         sessionRow.status,
        payment_status: sessionRow.payment_status,
      };
    }
  } catch (e) { /* non-fatal */ }

  // ── Explicit document rows ────────────────────────────────────────────────
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

  // ── Follow-up derivation ──────────────────────────────────────────────────
  // A scheduled/pending follow-up is "pending" — NOT submitted. Only a real
  // client_documents row (written when the client actually submits) marks it
  // submitted. Never infer completion from fallback data.
  let followupDerived = 'not_started';
  try {
    const { data: ac } = await sb.from('aftercare').select('status').eq('client_id', client.id);
    if (ac && ac.length && ac.some(a => a.status === 'scheduled' || a.status === 'pending')) {
      followupDerived = 'pending';
    }
  } catch (e) { /* non-fatal */ }

  // ── Build the per-document list ───────────────────────────────────────────
  const sid   = sessionRow ? sessionRow.id : '';
  const email = encodeURIComponent(client.email || '');
  const tk    = encodeURIComponent(token);

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
    if (def.mode === 'acknowledge' && def.page) return `${SITE_URL}${def.page}?token=${tk}`;
    if (def.type === 'waiver')  return `${SITE_URL}/waiver-esign.html?session_id=${sid}&email=${email}&token=${tk}`;
    if (def.type === 'intake')  return `${SITE_URL}/full-intake.html?session_id=${sid}&name=${encodeURIComponent(clientName)}&email=${email}&token=${tk}`;
    if (def.type === 'full_assessment') return `${SITE_URL}/full-assessment.html?session_id=${sid}&token=${tk}`;
    if (def.type === 'assessment') return `${SITE_URL}/assess.html?token=${tk}`;
    return def.page ? `${SITE_URL}${def.page}` : null;
  }

  function actionLabel(def, done) {
    if (done) return 'View';
    if (def.mode === 'acknowledge') return 'Acknowledge';
    if (def.mode === 'sign')        return 'Sign';
    if (def.type === 'treatment_plan') return null; // added by practitioner
    return 'Complete';
  }

  let requiredComplete = true;
  const documents = DOCS.map(def => {
    const row = rowOf(def.type);
    const der = derive(def);
    const status = row ? row.status : der.status;
    const done   = (DONE[def.mode] || []).includes(status);
    if (def.required && !done) requiredComplete = false;
    return {
      type:            def.type,
      title:           def.title,
      required:        def.required,
      status,
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

  // Legacy flat statuses kept for any older dashboard reads.
  const statuses = {};
  documents.forEach(d => { statuses[d.type] = d.status; });

  return respond(200, {
    client: { name: clientName, since: client.created_at },
    appointment,
    documents,
    statuses,
    required_complete: requiredComplete,
  });
};
