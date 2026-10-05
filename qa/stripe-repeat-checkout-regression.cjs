'use strict';
const assert = require('node:assert/strict');
process.env.STRIPE_SECRET_KEY = 'test-only';
process.env.APPOINTMENT_ACTION_SECRET = 'test-only-appointment-action-secret-000000000000';
const row = {
  id: 'booking-test', created_at: new Date(Date.now() - 3600000).toISOString(),
  client_id: 'client-test', client_name: 'Valid Client', client_email: 'valid@domain.org',
  client_phone: '5552345678', service: 'Implant/Parasite Removal', location_type: 'distance',
  session_date: '2026-10-16', session_time: '14:00', source: 'online', status: 'pending',
  payment_status: 'pending', payment_hold_expires_at: new Date(Date.now() + 3600000).toISOString(),
  waiver_completed: true, amount_due: 100,
};
const sb = {
  from(table) { return { select() { return this; }, eq() { return this; }, async single() { return { data: table === 'clients' ? { email: row.client_email } : { ...row }, error: null }; } }; },
  async rpc(_name, args) {
    if (row.stripe_checkout_session_id) return { error: new Error('Booking is no longer eligible for checkout') };
    Object.assign(row, args.p_updates);
    return { data: { session: { ...row } }, error: null };
  },
};
const clientPath = require.resolve('../netlify/functions/lib/supabase');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { getClient: () => sb } };
const handler = require('../netlify/functions/create-stripe-checkout').handler;
const webhook = require('../netlify/functions/stripe-webhook')._test;
let checkout = { id: 'cs_test_unique', client_reference_id: row.id, status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/test' };
const requests = [];
global.fetch = async (url, opts) => {
  requests.push({ url, ...opts });
  return { ok: true, json: async () => ({ ...checkout }) };
};
const event = { httpMethod: 'POST', body: JSON.stringify({ session_id: row.id }), headers: {} };
(async () => {
  const responses = await Promise.all([handler(event), handler(event)]);
  assert.ok(responses.every(x => x.statusCode === 200));
  const creates = requests.filter(x => x.method === 'POST');
  assert.equal(creates.length, 2);
  assert.equal(creates[0].headers['Idempotency-Key'], creates[1].headers['Idempotency-Key']);
  assert.equal(creates[0].body, creates[1].body, 'simultaneous requests use identical parameters');
  const reused = await handler(event);
  assert.equal(reused.statusCode, 200);
  assert.equal(requests.filter(x => x.method === 'POST').length, 2, 'existing checkout is retrieved');
  checkout = { ...checkout, status: 'complete', payment_status: 'paid', url: null };
  assert.equal((await handler(event)).statusCode, 409, 'paid Stripe checkout is blocked while database still says pending');
  delete row.stripe_checkout_session_id;
  assert.equal((await handler(event)).statusCode, 409, 'idempotent completed response cannot revert booking to pending');
  row.payment_status = 'paid';
  row.stripe_payment_intent_id = 'pi_canonical';
  const calls = [];
  const problemSb = { ...sb, async rpc(name, args) { calls.push({ name, args }); return { data: { duplicate: false }, error: null }; } };
  const ignored = await webhook.markPaymentProblem(problemSb, { object: 'checkout.session', id: 'cs_old', metadata: { session_id: row.id } }, 'expired', { id: 'evt_old', type: 'checkout.session.expired' });
  assert.equal(ignored.ignored, true);
  assert.equal(calls[0].args.p_session_id, null, 'old expiration cannot overwrite a paid booking');
  const refundCalls = [];
  const refundSb = {
    from(table) {
      return { field: null, select() { return this; }, eq(field) { this.field = field; return this; }, contains() { return this; }, in() { return this; }, limit() { return this; },
        async maybeSingle() { return { data: { payload: { data: { object: { metadata: { session_id: row.id } } } } } }; },
        async single() { return table === 'sessions' && this.field === 'stripe_payment_intent_id' ? { data: null, error: { code: 'PGRST116' } } : { data: { ...row } }; },
      };
    },
    async rpc(name, args) { refundCalls.push({ name, args }); return { data: { duplicate: false } }; },
  };
  const excessRefund = await webhook.reconcileRefund(refundSb, { payment_intent: 'pi_extra', amount: 10000, amount_refunded: 10000 }, { id: 'evt_extra_refund', type: 'charge.refunded' });
  assert.equal(excessRefund.ignored, true);
  assert.equal(refundCalls[0].args.p_session_id, null, 'refunding excess cannot refund retained booking');
  console.log('Stripe repeat checkout and stale-event regression: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
