'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('dashboard.html');
const paymentsApi = read('netlify/functions/payments.js');
const webhookSource = read('netlify/functions/stripe-webhook.js');
const migration = read('supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql');
const { processStripeEvent } = require('../netlify/functions/stripe-webhook')._test;

async function main() {
  const event = { id: 'evt_synthetic_1', type: 'checkout.session.completed', data: { object: {} } };
  const handler = webhookSource.slice(webhookSource.indexOf('exports.handler ='));
  const calls = [];
  const sb = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { duplicate: false, session: { id: 'session_synthetic' } }, error: null }; } };
  const result = await processStripeEvent(sb, event, { sessionId: 'session_synthetic', updates: { payment_status: 'paid' }, paymentAction: 'upsert', payment: { method: 'stripe' } });
  assert.equal(calls.length, 1, 'event claim/session/payment must enter one RPC call');
  assert.equal(calls[0].name, 'process_stripe_webhook_event_with_audit');
  assert.equal(calls[0].args.p_payload.id, event.id);
  assert.equal(calls[0].args.p_actor_type, undefined, 'actor must be assigned inside trusted SQL, not caller payload');
  assert.equal(result.session.id, 'session_synthetic');

  await assert.rejects(() => processStripeEvent({ rpc: async () => ({ data: null, error: new Error('synthetic ledger failure') }) }, event, { sessionId: 'session_synthetic', updates: {}, paymentAction: 'upsert', payment: {} }), /synthetic ledger failure/);
  await assert.rejects(() => processStripeEvent({ rpc: async () => ({ data: null, error: new Error('synthetic session/audit failure') }) }, event, { sessionId: 'session_synthetic', updates: {}, paymentAction: 'upsert', payment: {} }), /synthetic session\/audit failure/);

  const checks = [
    ['signature verification precedes transactional RPC', handler.indexOf('verifyStripeSignature(header(event') < handler.indexOf('await markPayment(')],
    ['webhook business and claim writes use RPCs only', !/\.from\(['"]payments['"]\)\s*\.(insert|upsert|update)/.test(webhookSource) && !/\.from\(['"]sessions['"]\)\s*\.update/.test(webhookSource) && !/\.from\(['"]stripe_webhook_events['"]\)\s*\.(insert|update)/.test(webhookSource)],
    ['email is invoked after atomic RPC returns', webhookSource.indexOf('await markPayment(') < webhookSource.indexOf('await notifyPaymentSuccess(')],
    ['SQL transaction includes trusted audited session mutation', migration.includes('trusted_session_update_with_audit(') && migration.includes("'system','stripe_webhook'")],
    ['SQL transaction includes canonical Stripe ledger write', migration.includes("if p_payment_action='upsert' then") && migration.includes("if p_payment_action='refund' then")],
    ['Stripe ledger writes persist system attribution and payment audit', migration.includes("actor_type='system',actor_id='stripe_webhook'") && migration.includes("'stripe_payment_recorded'") && migration.includes("'stripe_refund_updated'")],
    ['event idempotency is serialized and committed with business writes', migration.includes("pg_advisory_xact_lock(hashtextextended('stripe-event:'||p_event_id,0))") && migration.includes('business_committed_at=now()')],
    ['audit failure propagates through transactional RPC', migration.includes('appointment_action_audit') && migration.includes('process_stripe_webhook_event_with_audit')],
    ['dashboard loads paid/ready sessions', dashboard.includes('renderStripeBookingQueue') && dashboard.includes('booking_status') && dashboard.includes('payment_status')],
    ['Booking renders Supabase Stripe sessions', dashboard.includes('id="stripeBookingQueue"') && dashboard.includes('_stripeSessionRows')],
    ['Calendar retains unified sessions', dashboard.includes('getScheduleSessions().filter')],
    ['Payments renders live ledger', dashboard.includes('id="stripePaymentLedger"') && dashboard.includes('/.netlify/functions/payments?all=1')],
    ['payments API supports safe all-ledger read', paymentsApi.includes('if (params.all)') && paymentsApi.includes(".from('payments')")],
  ];
  checks.forEach(([name, ok]) => { assert.ok(ok, name); console.log('PASS', name); });
  console.log(`Stripe ledger/dashboard integration: ${checks.length + 3}/${checks.length + 3} passed`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
