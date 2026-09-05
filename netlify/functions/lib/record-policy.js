'use strict';

const QA_SOURCES = new Set([
  'qa', 'qa_auto', 'qa_financial', 'qa_migration_check', 'qa_test',
  'test', 'demo', 'seed', 'controlled_test', 'controlled_google_meet_test',
  'workflow_audit',
]);
const QA_TAGS = new Set(['qa', 'test', 'seed', 'demo', 'controlled-test']);
const HISTORICAL_SOURCES = new Set([
  'historical_planner_reconciliation_20260902', 'planner-reconciliation',
]);

function normalized(value) { return String(value || '').trim().toLowerCase(); }

function isQaRecord(record) {
  if (!record) return false;
  const source = normalized(record.source);
  const tags = Array.isArray(record.tags) ? record.tags.map(normalized) : [];
  return record.is_test === true || QA_SOURCES.has(source) ||
    tags.some(tag => QA_TAGS.has(tag)) || /\[qa\]/i.test(String(record.client_name || record.full_name || ''));
}

function isHistoricalRecord(record) {
  return HISTORICAL_SOURCES.has(normalized(record && record.source));
}

function isCalendarEligible(record, today = new Date().toISOString().slice(0, 10)) {
  if (!record || isQaRecord(record) || isHistoricalRecord(record)) return false;
  const location = normalized(record.location_type);
  const status = normalized(record.status);
  if (!record.id || !record.session_date || !record.session_time) return false;
  if (record.session_date < today || ['cancelled', 'completed', 'no_show'].includes(status)) return false;
  if (['in_person', 'in-person', 'local', 'house-cleansing-blessing'].includes(location)) return false;
  return ['distance', 'remote'].includes(location);
}

module.exports = { QA_SOURCES, HISTORICAL_SOURCES, isQaRecord, isHistoricalRecord, isCalendarEligible };
