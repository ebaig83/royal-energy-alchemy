'use strict';

const PROFILE_FIELDS = ['full_name', 'email', 'phone', 'address', 'date_of_birth', 'emergency_contact', 'additional_information', 'preferred_contact'];

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function normalizeName(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function nameSimilarityManual(a, b) {
  const left = normalizeName(a).split(' ').filter(Boolean), right = normalizeName(b).split(' ').filter(Boolean);
  if (!left.length || !right.length) return false;
  if (left.join(' ') === right.join(' ')) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length === 1 && shorter[0].length >= 4 && longer.includes(shorter[0]);
}
function hasValue(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }

function profileSummary(client, sessions) {
  const rows = sessions.filter(s => s.client_id === client.id);
  const upcoming = rows.filter(s => s.session_date && s.session_date >= new Date().toISOString().slice(0, 10) && !['cancelled', 'payment_expired', 'expired'].includes(s.status));
  const ordered = rows.filter(s => s.session_date).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));
  return {
    id: client.id, name: client.full_name || null, emailPresent: hasValue(client.email), phonePresent: hasValue(client.phone),
    sessionCount: rows.length, upcomingAppointmentCount: upcoming.length,
    lastVisit: ordered.at(-1)?.session_date || null, nextVisit: upcoming[0]?.session_date || null,
  };
}

function fieldConflicts(primary, duplicate) {
  return PROFILE_FIELDS.filter(field => hasValue(primary[field]) && hasValue(duplicate[field]) && String(primary[field]).trim() !== String(duplicate[field]).trim())
    .map(field => ({ field, primary: primary[field], duplicate: duplicate[field], suggested: primary[field] ?? duplicate[field] }));
}

module.exports = { PROFILE_FIELDS, normalizeEmail, normalizePhone, normalizeName, nameSimilarityManual, profileSummary, fieldConflicts, hasValue };
