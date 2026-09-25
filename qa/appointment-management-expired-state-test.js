'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'manage-appointment.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/2026-09-22-pending-booking-management-link.sql'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'netlify/functions/manage-appointment.js'), 'utf8');
const token = require(path.join(root, 'netlify/functions/lib/appointment-token'));

assert.match(page, /id="expiredState"[\s\S]*?This appointment request has expired because payment was not completed in time\. No cancellation is required\./);
assert.match(page, /status === 'expired' \|\| String\(s\.booking_status \|\| ''\)\.toLowerCase\(\) === 'payment_expired'/);
assert.match(page, /String\(s\.payment_status \|\| ''\)\.toLowerCase\(\) !== 'paid'/);
assert.match(page, /getElementById\('actionGrid'\)\.classList\.add\('hidden'\)/);
assert.match(page, /if \(status === 'cancelled' \|\| status === 'completed'\)/);
assert.ok(page.indexOf('if (expiredUnpaid)') < page.indexOf("if (status === 'cancelled' || status === 'completed')"));
assert.match(migration, /href="\{\{manage_url\}\}"\>Manage Appointment/);
assert.match(migration, /array_append\(variables, 'manage_url'\)/);
for (const template of ['booking_received_pending_payment', 'session_google_meet_ready', 'session_30_minute_reminder']) assert(migration.includes(template));
assert.doesNotMatch(migration, /session_id=\{\{session_reference\}\}|cancel_url/);
assert.match(endpoint, /verifyAppointmentToken/);
const renderStart = page.indexOf('function renderAppointment(s) {');
const renderEnd = page.indexOf('\n// ── Refund Calculator', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, 'renderAppointment function must be present');
const renderAppointmentSource = page.slice(renderStart, renderEnd).trim();
function renderState(session) {
  const nodes = new Map();
  const doc = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {
      className: '', textContent: '', style: {}, classes: new Set(),
      classList: { add(name) { this.node.classes.add(name); }, remove(name) { this.node.classes.delete(name); } },
    });
    const node = nodes.get(id);
    node.classList.node = node;
    return node;
  } };
  doc.getElementById('expiredState').classes.add('hidden');
  doc.getElementById('actionGrid');
  vm.runInNewContext(`(${renderAppointmentSource})(session)`, {
    document: doc, formatDate: value => value, formatTime: value => value, session,
  });
  return nodes;
}
const expiredUi = renderState({ status: 'expired', booking_status: 'payment_expired', payment_status: 'pending' });
assert(expiredUi.get('expiredState').classes.has('hidden') === false);
assert(expiredUi.get('actionGrid').classes.has('hidden'));
const activePaidUi = renderState({ status: 'confirmed', booking_status: 'confirmed', payment_status: 'paid' });
assert(activePaidUi.get('expiredState').classes.has('hidden'));
assert.equal(activePaidUi.get('actionGrid').classes.has('hidden'), false);
const cancelledUi = renderState({ status: 'cancelled', payment_status: 'paid' });
assert.equal(cancelledUi.get('actCancel').style.pointerEvents, 'none');
const completedUi = renderState({ status: 'completed', payment_status: 'paid' });
assert.equal(completedUi.get('actReschedule').style.pointerEvents, 'none');
for (const [, attrs, script] of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/\bsrc\s*=/.test(attrs) && script.trim()) new vm.Script(script);
}

process.env.APPOINTMENT_ACTION_SECRET = ['test-only', 'secret-with-at-least-32-chars'].join('-');
const sessionId = 'f8c0ca10-b8ab-47d5-993b-af7ad0bae295';
const signed = token.createAppointmentToken(sessionId, 'manage', { now: 1000, ttlSeconds: 120 });
assert.equal(token.verifyAppointmentToken(signed, sessionId, 'view', { now: 1050 }).ok, true);
assert.equal(token.verifyAppointmentToken(signed, sessionId, 'cancel_confirmed', { now: 1050 }).ok, true);
assert.equal(token.verifyAppointmentToken(signed, sessionId, 'view', { now: 1120 }).ok, false);
assert.equal(token.verifyAppointmentToken(signed, 'another-session', 'view', { now: 1050 }).ok, false);
assert.equal(token.verifyAppointmentToken('not-a-token', sessionId, 'view', { now: 1050 }).ok, false);
const rescheduleOnly = token.createAppointmentToken(sessionId, 'reschedule', { now: 1000, ttlSeconds: 120 });
assert.equal(token.verifyAppointmentToken(rescheduleOnly, sessionId, 'cancel_confirmed', { now: 1050 }).ok, false);
console.log('appointment management expired-state and token-security contract: passed');
