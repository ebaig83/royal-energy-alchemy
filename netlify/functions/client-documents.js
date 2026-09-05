// /.netlify/functions/client-documents
//
// The client document system of record. Each document (policy, waiver, intake,
// assessment, treatment plan, follow-up) is tracked SEPARATELY in the
// client_documents table — never collapsed into one another.
//
// PUBLIC (token-based — used by policy pages reached from the portal):
//   POST { token, document_type, title?, action, signature?, consents?, version? }
//     action = 'view' | 'acknowledge' | 'sign' | 'submit'
//   GET  ?token=<portal_token>            — list this client's documents
//
// ADMIN (X-Dashboard-Token — used by the dashboard client profile):
//   GET  ?client_id=<uuid>                — list a client's documents
//
// Policies are acknowledged (checkbox + typed name). The waiver uses full
// signature logic. Acknowledgment vs signature are stored in distinct columns.

'use strict';

const { respond, requireAdmin } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

// Canonical document registry — drives titles and which action each type uses.
const DOC_REGISTRY = {
  privacy_policy:                    { title: 'Privacy Policy',                                   mode: 'acknowledge', url: '/privacy-policy.html' },
  ai_recording_transcription_policy: { title: 'AI Use, Recording & Transcription Disclosure',     mode: 'acknowledge', url: '/ai-recording-transcription-policy.html' },
  recording_policy:                  { title: 'Recording Policy',                                 mode: 'acknowledge', url: '/recording-policy.html' },
  cancellation_policy:               { title: 'Cancellation Policy',                              mode: 'acknowledge', url: '/cancellation-policy.html' },
  payment_policy:                    { title: 'Payment Policy',                                   mode: 'acknowledge', url: '/payment-policy.html' },
  waiver:                            { title: 'Waiver / Legal Agreement',                         mode: 'sign',        url: '/waiver-esign.html' },
  intake:                            { title: 'Full Intake',                                      mode: 'submit',      url: '/full-intake.html' },
  full_assessment:                   { title: 'Full Assessment',                                  mode: 'submit',      url: '/full-assessment.html' },
  assessment:                        { title: 'Public Assessment',                                mode: 'submit',      url: '/assess.html' },
  treatment_plan:                    { title: 'Treatment Plan',                                   mode: 'view',        url: null },
  followup:                          { title: 'Follow-Up Forms',                                  mode: 'submit',      url: null },
};

function isMissingTableError(err) {
  if (!err) return false;
  const c = err.code || '', m = err.message || '';
  return c === '42P01' || c === 'PGRST204' || c === 'PGRST200' ||
    m.includes('does not exist') || m.includes('Could not find') || m.includes('schema cache');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));

  // ── ADMIN read: list a client's documents by client_id ────────────────────
  if (event.httpMethod === 'GET' && params.client_id) {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const { data, error } = await sb
      .from('client_documents')
      .select('*')
      .eq('client_id', params.client_id)
      .order('created_at', { ascending: true });

    if (error && !isMissingTableError(error)) return respond(500, { error: error.message });
    return respond(200, { documents: data || [] });
  }

  // ── PUBLIC read: list documents by portal token ───────────────────────────
  if (event.httpMethod === 'GET') {
    const client = await clientFromToken(sb, params.token);
    if (!client) return respond(404, { error: 'Invalid or expired access link.' });
    const { data, error } = await sb
      .from('client_documents')
      .select('document_type, title, status, version, viewed_at, acknowledged_at, signed_at, submitted_at')
      .eq('client_id', client.id);
    if (error && !isMissingTableError(error)) return respond(500, { error: error.message });
    return respond(200, { documents: data || [] });
  }

  // ── PUBLIC write: record view / acknowledge / sign / submit ────────────────
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid request body.' }); }

  const { token, document_type, action } = body;
  const reg = DOC_REGISTRY[document_type];
  if (!reg) return respond(400, { error: 'Unknown document_type.' });
  if (!['view', 'acknowledge', 'sign', 'submit'].includes(action)) {
    return respond(400, { error: 'Unknown action.' });
  }

  const client = await clientFromToken(sb, token);
  if (!client) return respond(404, { error: 'Invalid or expired access link.' });

  // A signature is required to sign; acknowledgment requires a typed name.
  if (action === 'sign' && !String(body.signature || '').trim()) {
    return respond(400, { error: 'A signature is required to sign this document.' });
  }
  if (action === 'acknowledge' && !String(body.signature || '').trim()) {
    return respond(400, { error: 'Please type your name to acknowledge.' });
  }

  const now     = new Date().toISOString();
  const version = body.version || 'v1';
  const ip      = event.headers['x-forwarded-for'] || event.headers['client-ip'] || null;
  const ua      = event.headers['user-agent'] || null;

  const statusByAction = { view: 'viewed', acknowledge: 'acknowledged', sign: 'signed', submit: 'submitted' };

  const row = {
    client_id:     client.id,
    document_type,
    title:         body.title || reg.title,
    version,
    document_url:  reg.url,
    status:        statusByAction[action],
    ip_address:    ip,
    user_agent:    ua,
    updated_at:    now,
  };
  if (action === 'view')        row.viewed_at = now;
  if (action === 'acknowledge') { row.acknowledged_at = now; row.signature = String(body.signature).trim(); }
  if (action === 'sign')        { row.signed_at = now; row.signature = String(body.signature).trim(); }
  if (action === 'submit')      row.submitted_at = now;
  if (body.consents)            row.consents = body.consents;
  // Form answers (e.g. the full assessment) persist in the existing metadata jsonb.
  if (body.responses)           row.metadata = body.responses;

  const { data, error } = await sb
    .from('client_documents')
    .upsert(row, { onConflict: 'client_id,document_type,version' })
    .select('id, document_type, status, version, acknowledged_at, signed_at, submitted_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return respond(503, { error: 'Document system not yet provisioned. Please contact us.' });
    }
    return respond(500, { error: error.message });
  }

  return respond(200, { saved: true, document: data });
};

async function clientFromToken(sb, token) {
  const t = String(token || '').trim();
  if (t.length < 16) return null;
  const { data, error } = await sb
    .from('clients')
    .select('id, full_name, email')
    .eq('portal_token', t)
    .single();
  if (error || !data) return null;
  return data;
}

module.exports.DOC_REGISTRY = DOC_REGISTRY;
