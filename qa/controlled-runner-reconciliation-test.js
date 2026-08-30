'use strict';
const assert = require('assert');
const r = require('./controlled-google-meet-runner');
let passed = 0;
function test(name, fn) { fn(); passed++; }
test('booking adopts exactly one', () => assert.deepStrictEqual(r.reconcileBooking([{ id: 'one' }]), { applied: true, sessionId: 'one' }));
test('booking zero stops', () => assert.strictEqual(r.reconcileBooking([]).applied, false));
test('booking duplicates hard-stop', () => assert.throws(() => r.reconcileBooking([{id:'a'},{id:'b'}]), /multiple/));
const before = { session_date:'2026-08-31', session_time:'14:00:00', google_calendar_event_id:'event-1', google_calendar_status:'ready', status:'confirmed' };
test('reschedule applied same event', () => assert.strictEqual(r.reconcileReschedule(before,{date:'2026-09-01',time:'16:00'},{...before,session_date:'2026-09-01',session_time:'16:00:00'}).applied,true));
test('reschedule unchanged stops', () => assert.strictEqual(r.reconcileReschedule(before,{date:'2026-09-01',time:'16:00'},before).applied,false));
test('reschedule partial hard-stop', () => assert.throws(() => r.reconcileReschedule(before,{date:'2026-09-01',time:'16:00'},{...before,session_date:'2026-09-01',session_time:'15:00:00'}),/partial/));
test('cancellation applied', () => assert.strictEqual(r.reconcileCancellation(before,{...before,status:'cancelled',google_calendar_status:'cancel_pending'}).applied,true));
test('cancellation unchanged stops', () => assert.strictEqual(r.reconcileCancellation(before,before).applied,false));
test('cancellation partial hard-stop', () => assert.throws(() => r.reconcileCancellation(before,{...before,status:'cancelled',google_calendar_status:'ready'}),/partial/));
test('transport ambiguity classified', () => assert.strictEqual(r.isTransportAmbiguity(new Error('network timeout')),true));
test('explicit HTTP rejection not ambiguous', () => assert.strictEqual(r.isTransportAmbiguity(new Error('HTTP 409: rejected')),false));
console.log(`controlled-runner-reconciliation-test: ${passed}/${passed} passed`);
