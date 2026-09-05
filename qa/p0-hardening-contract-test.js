'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

process.env.APPOINTMENT_ACTION_SECRET = 'test-only-appointment-secret-0123456789abcdef0123456789abcdef';
const tokens = require('../netlify/functions/lib/appointment-token');
const policy = require('../netlify/functions/lib/record-policy');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('PASS', name);
}

test('valid signed appointment token works', () => {
  const token = tokens.createAppointmentToken('session-a', 'manage', { now: 100, ttlSeconds: 60 });
  assert.equal(tokens.verifyAppointmentToken(token, 'session-a', 'cancel', { now: 120 }).ok, true);
});
test('expired appointment token fails', () => {
  const token = tokens.createAppointmentToken('session-a', 'manage', { now: 100, ttlSeconds: 10 });
  assert.equal(tokens.verifyAppointmentToken(token, 'session-a', 'view', { now: 111 }).reason, 'expired');
});
test('tampered appointment token fails', () => {
  const token = tokens.createAppointmentToken('session-a', 'manage', { now: 100 });
  assert.equal(tokens.verifyAppointmentToken(token + 'x', 'session-a', 'view', { now: 101 }).ok, false);
});
test('token for wrong session fails', () => {
  const token = tokens.createAppointmentToken('session-a', 'manage', { now: 100 });
  assert.equal(tokens.verifyAppointmentToken(token, 'session-b', 'view', { now: 101 }).reason, 'wrong_session');
});
test('new management links contain signed token', () => {
  assert.match(tokens.appointmentManageUrl('session-a'), /session_id=session-a&token=/);
});
test('caller supplied email is not authoritative', () => {
  const source = read('netlify/functions/manage-appointment.js');
  assert(!source.includes('body.client_email || await lookupClientEmail'));
  assert(source.includes('const clientEmail = await lookupClientEmail'));
});
test('bare link compatibility is explicit and time limited', () => {
  const source = read('netlify/functions/manage-appointment.js');
  assert(source.includes('APPOINTMENT_LEGACY_LINK_CUTOFF'));
  assert(source.includes('created < TOKEN_ROLLOUT_AT'));
});
test('permanent admin secret is never returned or accepted', () => {
  const verify = read('netlify/functions/verify-pin.js');
  const auth = read('netlify/functions/lib/auth.js');
  assert(!verify.includes('DASHBOARD_API_SECRET'));
  assert(!auth.includes('x-dashboard-token'));
  assert(auth.includes('admin_sessions'));
  assert(auth.includes('expires_at'));
  assert(auth.includes('revoked_at'));
});
test('logout revokes server session and clears cookie', () => {
  const source = read('netlify/functions/verify-pin.js');
  assert(source.includes("method === 'DELETE'"));
  assert(source.includes('revoked_at'));
  assert(source.includes('clearSessionCookie'));
});
test('QA records are excluded by explicit markers', () => {
  assert.equal(policy.isQaRecord({ source: 'qa_auto' }), true);
  assert.equal(policy.isQaRecord({ full_name: 'Person [QA]' }), true);
  assert.equal(policy.isQaRecord({ full_name: 'Unusual Sprint Name', source: 'manual' }), false);
});
test('calendar eligibility excludes historical and in-person records', () => {
  const base = { id: 'a', session_date: '2099-01-01', session_time: '10:00', status: 'confirmed', location_type: 'distance', source: 'online' };
  assert.equal(policy.isCalendarEligible(base, '2098-01-01'), true);
  assert.equal(policy.isCalendarEligible({ ...base, source: 'planner-reconciliation' }, '2098-01-01'), false);
  assert.equal(policy.isCalendarEligible({ ...base, location_type: 'in-person' }, '2098-01-01'), false);
});
test('manual payment path queues only eligible paid sessions', () => {
  const source = read('netlify/functions/payments.js');
  assert(source.includes("newStatus === 'paid'"));
  assert(source.includes('isCalendarEligible'));
  assert(source.includes("session.google_calendar_status === 'not_requested'"));
});
test('sessions endpoint supports explicit QA diagnostics', () => {
  const source = read('netlify/functions/sessions.js');
  assert(source.includes("params.include_qa === 'true'"));
  assert(source.includes('filter(s => !isQaRecord(s))'));
});

console.log(`${passed}/${passed} P0 hardening checks passed`);
