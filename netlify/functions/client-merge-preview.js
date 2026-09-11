'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { PROFILE_FIELDS, fieldConflicts } = require('./lib/client-identity');

const RELATED = ['sessions', 'communications', 'payments', 'session_notes', 'aftercare', 'intakes', 'intake_submissions', 'client_documents', 'recommendations', 'referrals', 'action_plans', 'packages', 'invoices', 'payment_requests', 'financial_alerts'];
async function countRelated(sb, table, id) {
  const result = await sb.from(table).select('id', { count: 'exact', head: true }).eq('client_id', id);
  return result.error ? { count: null, unavailable: true } : { count: result.count || 0, unavailable: false };
}

exports.handler = async event => {
  const auth = await requireAdmin(event, { touch: false });
  if (auth.error) return auth.error;
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Merge preview is read-only.' });
  const q = event.queryStringParameters || {}, primaryId = q.primary_id, duplicateId = q.duplicate_id;
  if (!primaryId || !duplicateId || primaryId === duplicateId) return respond(400, { error: 'Distinct primary_id and duplicate_id are required.' });
  try {
    const sb = getClient();
    const [{ data: primary }, { data: duplicate }, { data: sessions }] = await Promise.all([
      sb.from('clients').select('*').eq('id', primaryId).maybeSingle(), sb.from('clients').select('*').eq('id', duplicateId).maybeSingle(), sb.from('sessions').select('id,client_id,session_date,status,google_calendar_status,google_meet_url,google_calendar_event_id').in('client_id', [primaryId, duplicateId]),
    ]);
    if (!primary || !duplicate) return respond(404, { error: 'Both client profiles must exist.' });
    if (primary.merged_into_client_id || duplicate.merged_into_client_id) return respond(409, { error: 'Merged profiles cannot be previewed as active profiles.' });
    const counts = {};
    for (const table of RELATED) counts[table] = { primary: await countRelated(sb, table, primaryId), duplicate: await countRelated(sb, table, duplicateId) };
    const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field, { primary: primary[field] ?? null, duplicate: duplicate[field] ?? null }]));
    const upcoming = (sessions || []).filter(s => s.session_date >= new Date().toISOString().slice(0, 10) && !['cancelled', 'payment_expired', 'expired'].includes(s.status));
    return respond(200, { readOnly: true, primary: { id: primary.id, profile }, duplicate: { id: duplicate.id, profile }, conflicts: fieldConflicts(primary, duplicate), suggestedKeep: Object.fromEntries(PROFILE_FIELDS.map(field => [field, primary[field] ?? duplicate[field] ?? null])), relatedCounts: counts, upcomingAppointments: upcoming.length, calendarReferences: (sessions || []).filter(s => s.google_calendar_event_id || s.google_meet_url).length, unresolvedReferences: RELATED.filter(table => counts[table].primary.unavailable || counts[table].duplicate.unavailable) });
  } catch { return respond(503, { error: 'Merge preview is unavailable.' }); }
};
