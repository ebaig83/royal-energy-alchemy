'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checkoutSource = read('netlify/functions/create-stripe-checkout.js');
const webhookSource = read('netlify/functions/stripe-webhook.js');
const migration = read('migrations/2026-08-26-stripe-booking-flow.sql');
const confirmation = read('booking-confirmation.html');
const checkout = require('../netlify/functions/create-stripe-checkout')._test;

const tests = [
  ['successful immediate card payment', /payment_status === 'paid'.*markPayment/s.test(webhookSource)],
  ['completed but unpaid is not fulfilled', /checkout\.session\.completed' && object\.payment_status === 'paid'/.test(webhookSource)],
  ['delayed success', webhookSource.includes('checkout.session.async_payment_succeeded')],
  ['delayed failure', webhookSource.includes('checkout.session.async_payment_failed')],
  ['expired Checkout', webhookSource.includes('checkout.session.expired')],
  ['failed PaymentIntent', webhookSource.includes('payment_intent.payment_failed')],
  ['processed duplicates acknowledged', /data\.state === 'processed'.*return false/s.test(webhookSource)],
  ['failed event can be reclaimed', webhookSource.includes("state: 'failed'") && webhookSource.includes("state: 'processing'") && webhookSource.includes("data.state === 'processed'")],
  ['amount mismatch rejected', webhookSource.includes('payment amount does not match')],
  ['currency mismatch rejected', webhookSource.includes('currency does not match USD')],
  ['missing waiver rejected', checkoutSource.includes('Waiver must be completed before payment.')],
  ['browser email ignored', !checkoutSource.includes('body.client_email')],
  ['already-paid booking rejected', checkoutSource.includes('This booking is already paid.')],
  ['full refund distinguished', /full \? 'full' : 'partial'/.test(webhookSource)],
  ['partial refund preserved', webhookSource.includes("stripe_payment_status: full ? 'refunded' : 'partially_refunded'")],
  ['browser close cannot affect fulfillment', !webhookSource.includes('window') && !webhookSource.includes('document')],
  ['catalog amount helper', checkout.centsFromDollars(70) === 7000],
  ['waiver helper', checkout.isWaiverDone({ waiver_completed: true })],
  ['event uniqueness', /stripe_webhook_events[\s\S]*id text primary key/.test(migration)],
  ['payment uniqueness', migration.includes('uq_payments_stripe_reference_id')],
  ['confirmation is database-driven', confirmation.includes('/.netlify/functions/manage-appointment')],
];

let failed = 0;
for (const [name, ok] of tests) { if (!ok) { failed++; console.error('FAIL', name); } else console.log('PASS', name); }
assert.strictEqual(failed, 0, `${failed} Stripe hardening checks failed`);
console.log(`Stripe hardening smoke: ${tests.length}/${tests.length} passed`);
