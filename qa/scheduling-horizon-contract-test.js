'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  publicHorizonDate,
  isWithinPublicHorizon,
  generationStartDate,
  buildStandardSlotRows,
} = require('../netlify/functions/lib/scheduling-horizon');
const { filterSlotsAgainstSessions } = require('../netlify/functions/lib/session-overlap');

const root = path.resolve(__dirname, '..');
const availability = fs.readFileSync(path.join(root, 'netlify/functions/availability.js'), 'utf8');
const booking = fs.readFileSync(path.join(root, 'netlify/functions/booking.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'netlify/functions/lib/scheduling-horizon.js'), 'utf8');

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`); }

test('current date is within public horizon', () => {
  assert.strictEqual(isWithinPublicHorizon('2026-08-29', '2026-08-29'), true);
});

test('next month is within public horizon', () => {
  assert.strictEqual(isWithinPublicHorizon('2026-09-29', '2026-08-29'), true);
});

test('six-calendar-month horizon is reachable and clamped', () => {
  assert.strictEqual(publicHorizonDate('2026-08-29'), '2027-02-28');
});

test('public dates beyond the horizon are rejected by model and UI navigation is guarded', () => {
  assert.strictEqual(isWithinPublicHorizon('2027-03-01', '2026-08-29'), false);
  assert.match(index, /clientCalMonthIndex[\s\S]*clientCalendarHorizon/);
  assert.match(index, /clientCalNextBtn/);
});

test('valid weekday offered slots are generated within horizon', () => {
  const rows = buildStandardSlotRows('2027-02-26', '2027-02-28');
  assert.deepStrictEqual(rows.map(row => row.slot_time), ['10:00:00','12:00:00','14:00:00','16:00:00','18:00:00']);
});

test('active session removes a conflicting offered slot and preserves adjacent slot', () => {
  const slots = [
    { slot_date:'2026-09-01',slot_time:'10:00:00',status:'available' },
    { slot_date:'2026-09-01',slot_time:'12:00:00',status:'available' },
  ];
  const visible = filterSlotsAgainstSessions(slots, [{ session_date:'2026-09-01',session_time:'10:00:00',duration_minutes:60,status:'confirmed' }]);
  assert.deepStrictEqual(visible.map(row => row.slot_time), ['12:00:00']);
});

test('cancelled and no-show sessions do not block', () => {
  const slots = [{ slot_date:'2026-09-01',slot_time:'10:00:00',status:'available' }];
  for (const status of ['cancelled','no_show']) {
    assert.strictEqual(filterSlotsAgainstSessions(slots, [{ session_date:'2026-09-01',session_time:'10:00:00',duration_minutes:60,status }]).length, 1);
  }
});

test('off-grid overlap still blocks standard slot', () => {
  const slots = [{ slot_date:'2026-09-01',slot_time:'10:00:00',status:'available' }];
  assert.strictEqual(filterSlotsAgainstSessions(slots, [{ session_date:'2026-09-01',session_time:'09:30:00',duration_minutes:60,status:'confirmed' }]).length, 0);
});

test('generated rows are unique by date and time', () => {
  const rows = buildStandardSlotRows('2026-09-01', '2027-02-28');
  assert.strictEqual(new Set(rows.map(row => `${row.slot_date}@${row.slot_time}`)).size, rows.length);
  assert.match(helper, /ignoreDuplicates: true/);
});

test('rolling extension starts after latest curated date and does not reopen earlier holes', () => {
  assert.strictEqual(generationStartDate('2026-08-29', '2026-10-01'), '2026-10-02');
  assert.strictEqual(buildStandardSlotRows('2026-10-02', '2026-10-02').some(row => row.slot_date < '2026-10-02'), false);
});

test('dashboard calendars can navigate beyond six months and load all future sessions', () => {
  assert.match(dashboard, /function calNext\(\).*_calMonth\+\+/);
  assert.match(dashboard, /function slotCalNext\(\).*_slotCalMonth\+\+/);
  assert.match(dashboard, /fetch\('\/\.netlify\/functions\/sessions'/);
});

test('booking endpoint rejects out-of-horizon claimed slot before client or session creation', () => {
  const guard = booking.indexOf('isWithinPublicHorizon(sessionDate, today)');
  const clientStep = booking.indexOf('Step 2: Upsert client record');
  assert.ok(guard > 0 && guard < clientStep);
  assert.match(booking, /outside the public booking horizon/);
});

test('horizon maintenance has no Stripe, payment, refund, or email dependency', () => {
  assert.doesNotMatch(helper + availability, /require\([^)]*(stripe|comms|mailer|refund|payment)/i);
  assert.match(availability, /filterSlotsAgainstSessions/);
});

console.log(`\n${passed}/13 scheduling horizon checks passed.`);
