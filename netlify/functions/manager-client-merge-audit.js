'use strict';

const { identity } = require('./lib/agent-telemetry');
const { respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { PROFILE_FIELDS, fieldConflicts, nameSimilarityManual, profileSummary } = require('./lib/client-identity');

const ALLOWED = new Set(['4ee1d314-4d53-428f-a319-8f7b2fe2eece', 'cff6a741-831d-412d-8bee-19e2cca2b9a1']);
const RELATED = { payments: ['payments', 'payment_requests', 'invoices'], communications: ['communications'], waivers: ['waivers'], intakes: ['intakes', 'intake_submissions'] };
const SAFE_PROFILE_FIELDS = new Set(PROFILE_FIELDS);

async function count(sb, tables, id) {
  const results = await Promise.all(tables.map(table => sb.from(table).select('id', { count: 'exact', head: true }).eq('client_id', id)));
  return { count: results.reduce((total, result) => total + (result.error ? 0 : (result.count || 0)), 0), unavailable: results.some(result => Boolean(result.error)) };
}
function safeProfile(row) { return Object.fromEntries(PROFILE_FIELDS.filter(field => SAFE_PROFILE_FIELDS.has(field)).map(field => [field, row[field] ?? null])); }

exports.handler = async event => {
  const actor = identity(event);
  if (!actor || actor.role !== 'manager') return respond(actor ? 403 : 401, { error: 'Manager authorization required.' });
  if (String(event.httpMethod || '').toUpperCase() !== 'GET') return respond(405, { error: 'Read-only Manager audit.' });
  const q = event.queryStringParameters || {}, primaryId = q.primary_id, duplicateId = q.duplicate_id;
  if (!ALLOWED.has(primaryId) || !ALLOWED.has(duplicateId) || primaryId === duplicateId) return respond(400, { error: 'This temporary audit accepts only the approved Erika pair.' });
  try {
    const sb = getClient();
    const [{ data: primary }, { data: duplicate }, { data: sessions }] = await Promise.all([
      sb.from('clients').select('*').eq('id', primaryId).maybeSingle(),
      sb.from('clients').select('*').eq('id', duplicateId).maybeSingle(),
      sb.from('sessions').select('id,client_id,session_date,session_time,status,google_calendar_event_id,google_meet_url').in('client_id', [primaryId, duplicateId]).order('session_date'),
    ]);
    if (!primary || !duplicate) return respond(404, { error: 'Approved profiles were not found.' });
    const rows = sessions || [];
    const upcoming = rows.filter(row => row.session_date >= new Date().toISOString().slice(0, 10) && !['cancelled', 'payment_expired', 'expired'].includes(row.status)).map(row => ({ id: row.id, date: row.session_date, time: row.session_time || null, status: row.status || null }));
    const counts = {};
    for (const [label, tables] of Object.entries(RELATED)) counts[label] = { primary: await count(sb, tables, primaryId), duplicate: await count(sb, tables, duplicateId) };
    counts.sessions = { primary: { count: rows.filter(row => row.client_id === primaryId).length, unavailable: false }, duplicate: { count: rows.filter(row => row.client_id === duplicateId).length, unavailable: false } };
    const calendar = rows.filter(row => row.google_calendar_event_id || row.google_meet_url).map(row => ({ session_id: row.id, calendar_event_present: Boolean(row.google_calendar_event_id), meet_link_present: Boolean(row.google_meet_url) }));
    return respond(200, {
      readOnly: true,
      candidate: { confidence: 'low', reason: 'name_similarity_manual_review', manualVerificationRequired: true },
      primary: { id: primary.id, profile: safeProfile(primary), summary: profileSummary(primary, rows) },
      duplicate: { id: duplicate.id, profile: safeProfile(duplicate), summary: profileSummary(duplicate, rows) },
      conflicts: fieldConflicts(primary, duplicate).map(conflict => ({ field: conflict.field, primary: conflict.primary, duplicate: conflict.duplicate, suggested: conflict.suggested })),
      sessions: { primary: rows.filter(row => row.client_id === primaryId).map(row => row.id), duplicate: rows.filter(row => row.client_id === duplicateId).map(row => row.id) },
      upcomingAppointments: upcoming,
      relatedCounts: counts,
      calendarReferences: calendar,
      unresolvedWarnings: Object.entries(counts).filter(([, value]) => value.primary.unavailable || value.duplicate.unavailable).map(([label]) => `${label} references unavailable for read-only count.`),
    });
  } catch { return respond(503, { error: 'Temporary Manager audit is unavailable.' }); }
};
