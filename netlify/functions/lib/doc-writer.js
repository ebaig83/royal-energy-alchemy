'use strict';

// Shared writer for the client_documents system of record.
// Upserts one canonical row per (client_id, document_type, version) so that
// re-saving a treatment plan or re-submitting a follow-up updates in place.
// Resilient: if the client_documents table is not yet provisioned, it no-ops
// rather than breaking the calling flow.

function isMissingTableError(err) {
  if (!err) return false;
  const c = err.code || '', m = err.message || '';
  return c === '42P01' || c === 'PGRST204' || c === 'PGRST200' ||
    m.includes('does not exist') || m.includes('Could not find') || m.includes('schema cache');
}

// fields: { client_id (required), document_type (required), title, status,
//           version, session_id, document_url, submitted_at, signed_at,
//           acknowledged_at, viewed_at }
async function recordClientDocument(sb, fields) {
  if (!sb || !fields || !fields.client_id || !fields.document_type) {
    return { skipped: true };
  }
  const now = new Date().toISOString();
  const row = {
    client_id:     fields.client_id,
    session_id:    fields.session_id || null,
    document_type: fields.document_type,
    title:         fields.title || null,
    status:        fields.status || 'submitted',
    version:       fields.version || 'v1',
    document_url:  fields.document_url || null,
    updated_at:    now,
  };
  if (fields.submitted_at)    row.submitted_at = fields.submitted_at;
  else if (row.status === 'submitted') row.submitted_at = now;
  if (fields.signed_at)       row.signed_at = fields.signed_at;
  if (fields.acknowledged_at) row.acknowledged_at = fields.acknowledged_at;
  if (fields.viewed_at)       row.viewed_at = fields.viewed_at;

  try {
    const { error } = await sb
      .from('client_documents')
      .upsert(row, { onConflict: 'client_id,document_type,version' });
    if (error && !isMissingTableError(error)) return { error };
    return { ok: true };
  } catch (e) {
    return { error: e };
  }
}

module.exports = { recordClientDocument };
