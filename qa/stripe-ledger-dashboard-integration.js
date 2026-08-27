'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('dashboard.html');
const paymentsApi = read('netlify/functions/payments.js');
const webhookSource = read('netlify/functions/stripe-webhook.js');
const { recordStripePayment } = require('../netlify/functions/stripe-webhook')._test;

function paymentClient(seed) {
  const rows = seed.slice();
  function builder(operation, payload) {
    const filters = {};
    const chain = {
      select() { return chain; },
      eq(key, value) { filters[key] = value; return chain; },
      maybeSingle: async () => ({ data: rows.find(r => Object.entries(filters).every(([k,v]) => r[k] === v)) || null, error: null }),
      single: async () => {
        if (operation === 'insert') {
          if (rows.some(r => r.method === payload.method && r.reference_id === payload.reference_id)) return { data: null, error: { code: '23505' } };
          const row = Object.assign({ id: `pay_${rows.length + 1}` }, payload); rows.push(row); return { data: row, error: null };
        }
        return { data: rows.find(r => Object.entries(filters).every(([k,v]) => r[k] === v)) || null, error: null };
      },
      then(resolve) {
        if (operation === 'update') {
          const row = rows.find(r => Object.entries(filters).every(([k,v]) => r[k] === v));
          if (row) Object.assign(row, payload);
        }
        return Promise.resolve({ error: null }).then(resolve);
      }
    };
    return chain;
  }
  return {
    rows,
    from(table) {
      assert.strictEqual(table, 'payments');
      return {
        select: () => builder('select'),
        insert: row => builder('insert', row),
        update: row => builder('update', row),
      };
    }
  };
}

(async () => {
  const sb = paymentClient([{ id: 'cash_1', method: 'cash', reference_id: 'shared-history', amount: 10 }]);
  const stripeRow = { session_id: 'sess_1', client_name: 'Synthetic Client', amount: 30, method: 'stripe', status: 'received', reference_id: 'pi_test_1' };
  await recordStripePayment(sb, stripeRow);
  await recordStripePayment(sb, Object.assign({}, stripeRow, { amount: 30 }));
  assert.strictEqual(sb.rows.filter(r => r.method === 'stripe' && r.reference_id === 'pi_test_1').length, 1, 'duplicate webhook created a second Stripe row');
  assert.strictEqual(sb.rows.find(r => r.id === 'cash_1').amount, 10, 'historical non-Stripe payment changed');

  const checks = [
    ['webhook avoids incompatible reference upsert', !/upsert\([\s\S]*onConflict:\s*['"]reference_id/.test(webhookSource)],
    ['refund targets original reference', webhookSource.includes(".eq('reference_id', charge.payment_intent)")],
    ['dashboard loads paid/ready sessions', dashboard.includes('renderStripeBookingQueue') && dashboard.includes('booking_status') && dashboard.includes('payment_status')],
    ['Booking renders Supabase Stripe sessions', dashboard.includes('id="stripeBookingQueue"') && dashboard.includes('_stripeSessionRows')],
    ['Calendar retains unified sessions', dashboard.includes('getScheduleSessions().filter')],
    ['Clients retain session-derived roster', dashboard.includes('sessions.forEach(function(s)') && dashboard.includes('clientMap')],
    ['Payments renders live ledger', dashboard.includes('id="stripePaymentLedger"') && dashboard.includes('/.netlify/functions/payments?all=1')],
    ['payments API supports safe all-ledger read', paymentsApi.includes('if (params.all)') && paymentsApi.includes(".from('payments')")],
    ['non-Stripe sessions still use unified schedule', dashboard.includes('return source.filter(function(s)') && dashboard.includes("scheduleSource==='supabase'")],
  ];
  checks.forEach(([name, ok]) => { assert.ok(ok, name); console.log('PASS', name); });
  console.log('PASS Stripe ledger creates one row for duplicate delivery');
  console.log('PASS historical non-Stripe payment remains unchanged');
  console.log(`Stripe ledger/dashboard integration: ${checks.length + 2}/${checks.length + 2} passed`);
})().catch(err => { console.error(err); process.exitCode = 1; });
