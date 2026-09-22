'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/2026-09-22-incomplete-booking-payment-holds.sql'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'netlify/functions/expire-payment-holds.js'), 'utf8');
const netlifyConfig = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');

assert.match(migration, /payload\s*->\s*'data'\s*->\s*'object'\s*->\s*'metadata'\s*->>\s*'session_id'/);
assert.match(migration, /payload\s*->\s*'data'\s*->\s*'object'\s*->\s*'metadata'\s*->>\s*'booking_id'/);
assert.match(migration, /payload\s*->\s*'data'\s*->\s*'object'\s*->>\s*'client_reference_id'/);
assert.doesNotMatch(migration, /payload\s*->\s*'data'\s*->\s*object\b/);

for (const clause of [
  /s\.payment_status\s+in\s*\('pending',\s*'unpaid'\)/i,
  /s\.booking_status\s+in\s*\('booking_received',\s*'payment_pending',\s*'payment_expired'\)/i,
  /s\.payment_hold_expires_at\s*<=\s*p_now/i,
  /s\.status\s+in\s*\('pending',\s*'expired'\)/i,
  /s\.stripe_checkout_session_id\s+is\s+null/i,
  /s\.stripe_payment_intent_id\s+is\s+null/i,
  /s\.stripe_payment_status\s+is\s+null/i,
  /s\.google_calendar_event_id\s+is\s+null/i,
  /s\.google_meet_url\s+is\s+null/i,
  /s\.google_calendar_status\s+is\s+null\s+or\s+s\.google_calendar_status\s*=\s*'not_requested'/i,
  /and\s+not\s+exists\s*\([\s\S]*?public\.stripe_webhook_events/i,
]) assert.match(migration, clause, `eligibility clause missing: ${clause}`);

const now = Date.parse('2026-09-22T19:00:00.000Z');
const eligibleSession = {
  id: 'eligible',
  status: 'expired',
  payment_status: 'pending',
  booking_status: 'payment_expired',
  payment_hold_expires_at: '2026-09-22T18:30:00.000Z',
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  stripe_payment_status: null,
  google_calendar_event_id: null,
  google_meet_url: null,
  google_calendar_status: 'not_requested',
};

function qualifies(session, webhookEvents = []) {
  const pending = ['pending', 'unpaid'].includes(session.payment_status);
  const bookingState = ['booking_received', 'payment_pending', 'payment_expired'].includes(session.booking_status);
  const state = ['pending', 'expired'].includes(session.status);
  const holdExpired = session.payment_hold_expires_at && Date.parse(session.payment_hold_expires_at) <= now;
  const noStripeEvidence = !session.stripe_checkout_session_id && !session.stripe_payment_intent_id && !session.stripe_payment_status;
  const noCalendarEvidence = !session.google_calendar_event_id && !session.google_meet_url &&
    (session.google_calendar_status == null || session.google_calendar_status === 'not_requested');
  const hasWebhookEvidence = webhookEvents.some(event => {
    const object = event.payload?.data?.object;
    return object?.metadata?.session_id === session.id ||
      object?.metadata?.booking_id === session.id ||
      object?.client_reference_id === session.id;
  });
  return pending && bookingState && state && holdExpired && noStripeEvidence && noCalendarEvidence && !hasWebhookEvidence;
}

assert.equal(qualifies({ ...eligibleSession }), true, 'expired unpaid hold qualifies');
assert.equal(qualifies({ ...eligibleSession, status: 'cancelled' }), false, 'cancelled session is excluded');
assert.equal(qualifies({ ...eligibleSession, payment_status: 'paid' }), false, 'paid session is excluded');
assert.equal(qualifies({ ...eligibleSession, stripe_payment_intent_id: 'pi_test' }), false, 'Stripe-backed session is excluded');
assert.equal(qualifies({ ...eligibleSession, stripe_payment_status: 'succeeded' }), false, 'Stripe status evidence is excluded');
const webhookBySession = [{ payload: { data: { object: { metadata: { session_id: 'eligible' } } } } }];
const webhookByBooking = [{ payload: { data: { object: { metadata: { booking_id: 'eligible' } } } } }];
const webhookByClientReference = [{ payload: { data: { object: { client_reference_id: 'eligible' } } } }];
assert.equal(qualifies({ ...eligibleSession }, webhookBySession), false, 'matching session webhook is excluded');
assert.equal(qualifies({ ...eligibleSession }, webhookByBooking), false, 'matching booking webhook is excluded');
assert.equal(qualifies({ ...eligibleSession }, webhookByClientReference), false, 'matching client-reference webhook is excluded');
assert.equal(qualifies({ ...eligibleSession, google_calendar_event_id: 'event-1' }), false, 'Calendar event evidence is excluded');
assert.equal(qualifies({ ...eligibleSession, google_meet_url: 'https://meet.google.com/test' }), false, 'Meet evidence is excluded');
assert.equal(qualifies({ ...eligibleSession, google_calendar_status: 'ready' }), false, 'Calendar state evidence is excluded');

assert.match(workerSource, /rpc\('expire_unpaid_booking_holds'/);
assert.match(netlifyConfig, /\[functions\."expire-payment-holds"\][\s\S]*?schedule\s*=\s*"\*\/5 \* \* \* \*"/);
assert.doesNotMatch(workerSource, /booking-notifications|booking-state/);

let rpcResult = { data: { expired_count: 1 }, error: null };
let rpcCalls = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './lib/supabase' && parent?.filename === path.join(root, 'netlify/functions/expire-payment-holds.js')) {
    return { getClient: () => ({ rpc: async (...args) => { rpcCalls.push(args); return rpcResult; } }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let worker;
try {
  worker = require(path.join(root, 'netlify/functions/expire-payment-holds.js'));
} finally {
  Module._load = originalLoad;
}

(async () => {
  const success = await worker.handler();
  assert.equal(success.statusCode, 200);
  assert.deepEqual(JSON.parse(success.body), { expired: true, count: 1 });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0][0], 'expire_unpaid_booking_holds');
  assert.ok(Number.isFinite(Date.parse(rpcCalls[0][1].p_now)), 'worker sends a server timestamp');

  rpcResult = { data: null, error: { message: 'database detail must not leak' } };
  const failure = await worker.handler();
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(JSON.parse(failure.body), { expired: false });
  assert.doesNotMatch(failure.body, /database detail/);
  assert.equal(rpcCalls.length, 2);

  console.log('PASS payment-hold expiration: eligibility, webhook path, worker success/failure, five-minute schedule');
})().catch(error => { console.error(error); process.exitCode = 1; });
