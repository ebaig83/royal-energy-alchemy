'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  filterSlotsAgainstSessions,
  findSessionConflicts,
} = require('../netlify/functions/lib/session-overlap');

const root = path.resolve(__dirname, '..');
const availabilitySource = fs.readFileSync(path.join(root, 'netlify/functions/availability.js'), 'utf8');
const availabilityGetSource = availabilitySource.split('// ── ADMIN WRITE')[0];
const bookingSource = fs.readFileSync(path.join(root, 'netlify/functions/booking.js'), 'utf8');
const importSource = fs.readFileSync(path.join(root, 'netlify/functions/manual-session-import.js'), 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const slots = [
  { id: 's10', slot_date: '2026-09-14', slot_time: '10:00:00', status: 'available' },
  { id: 's12', slot_date: '2026-09-14', slot_time: '12:00:00', status: 'available' },
];

test('offered 10 AM remains when no session conflicts', () => {
  assert.deepStrictEqual(filterSlotsAgainstSessions(slots, []).map(x => x.id), ['s10', 's12']);
});

test('10 AM session removes 10 AM slot and preserves adjacent 12 PM', () => {
  const result = filterSlotsAgainstSessions(slots, [{
    id: 'a', session_date: '2026-09-14', session_time: '10:00:00', duration_minutes: 60, status: 'confirmed',
  }]);
  assert.deepStrictEqual(result.map(x => x.id), ['s12']);
});

test('off-grid 9:30 AM session overlapping 10 AM removes 10 AM', () => {
  const result = filterSlotsAgainstSessions(slots, [{
    id: 'b', session_date: '2026-09-14', session_time: '09:30:00', duration_minutes: 60, status: 'confirmed',
  }]);
  assert.deepStrictEqual(result.map(x => x.id), ['s12']);
});

test('non-overlapping session does not remove offered slot', () => {
  const result = filterSlotsAgainstSessions(slots, [{
    id: 'c', session_date: '2026-09-14', session_time: '08:00:00', duration_minutes: 60, status: 'confirmed',
  }]);
  assert.deepStrictEqual(result.map(x => x.id), ['s10', 's12']);
});

test('half-open interval preserves a slot beginning when prior session ends', () => {
  const conflicts = findSessionConflicts([{
    id: 'd', session_date: '2026-09-14', session_time: '09:00:00', duration_minutes: 60, status: 'confirmed',
  }], { date: '2026-09-14', time: '10:00:00', duration_minutes: 60 });
  assert.strictEqual(conflicts.length, 0);
});

test('availability calculation does not mutate dashboard session records', () => {
  const sessions = [{
    id: 'e', client_name: 'Private Name', notes: 'Private note', payment_status: 'paid',
    session_date: '2026-09-14', session_time: '09:30:00', duration_minutes: 60, status: 'confirmed',
  }];
  const before = JSON.stringify(sessions);
  filterSlotsAgainstSessions(slots, sessions);
  assert.strictEqual(JSON.stringify(sessions), before);
});

test('public availability selects only occupancy fields and returns no private fields', () => {
  assert.match(availabilitySource, /select\('id,session_date,session_time,duration_minutes,status'\)/);
  assert.doesNotMatch(availabilitySource, /client_name|payment_status|seller_notes|practitioner_notes/);
});

test('availability checks have no communications or payment side effects', () => {
  assert.doesNotMatch(availabilityGetSource, /\.insert\(|\.update\(|\.delete\(|comms|stripe|refund|payment_intent/i);
});

test('silent importer is authenticated, session-only, and has no communications or payment workflow imports', () => {
  assert.match(importSource, /requireAdmin\(event\)/);
  assert.match(importSource, /from\('sessions'\)[\s\S]*\.insert\(row\)/);
  assert.doesNotMatch(importSource, /from\('availability_slots'\)|require\([^)]*(comms|stripe|payment|refund)/i);
});

test('booking flow independently rejects conflicts before creating a session', () => {
  const conflictIndex = bookingSource.indexOf('findSessionConflicts');
  const sessionInsertIndex = bookingSource.indexOf(".from('sessions')\n      .insert");
  assert.ok(conflictIndex >= 0 && sessionInsertIndex > conflictIndex);
  assert.match(bookingSource, /This time is no longer available/);
});

(async () => {
  const priorSecret = process.env.DASHBOARD_API_SECRET;
  process.env.DASHBOARD_API_SECRET = 'contract-test-secret';
  const importer = require('../netlify/functions/manual-session-import');
  const response = await importer.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.strictEqual(response.statusCode, 401);
  passed += 1;
  console.log('PASS silent importer rejects unauthenticated requests before database access');
  if (priorSecret === undefined) delete process.env.DASHBOARD_API_SECRET;
  else process.env.DASHBOARD_API_SECRET = priorSecret;
  console.log(`\n${passed}/11 session authority contract checks passed.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
