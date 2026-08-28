'use strict';

const assert = require('assert');
process.env.RESEND_API_KEY = 'test_only';
process.env.FROM_EMAIL = 'test@example.com';
process.env.ADMIN_EMAIL = 'daron@example.com';

const webhook = require('../netlify/functions/stripe-webhook')._test;

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.action = 'select'; this.payload = null; this.filters = []; }
  select() { return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  single() { return this.exec(true); }
  maybeSingle() { return this.exec(true); }
  then(resolve, reject) { return this.exec(false).then(resolve, reject); }
  async exec(single) {
    const rows = this.db[this.table] || (this.db[this.table] = []);
    const matches = row => this.filters.every(([key, value]) => row[key] === value);
    if (this.action === 'select') {
      const found = rows.filter(matches);
      return { data: single ? (found[0] || null) : found, error: null };
    }
    if (this.action === 'insert') {
      const row = { id: this.payload.id || `${this.table}-${rows.length + 1}`, ...this.payload };
      if (this.table === 'transactional_notifications' && rows.some(x => x.idempotency_key === row.idempotency_key)) {
        return { data: null, error: { code: '23505' } };
      }
      rows.push(row);
      return { data: single ? row : [row], error: null };
    }
    const found = rows.filter(matches);
    found.forEach(row => Object.assign(row, this.payload));
    return { data: single ? (found[0] || null) : found, error: null };
  }
}

const templateNames = [
  'stripe_payment_confirmed_client', 'stripe_payment_confirmed_practitioner',
  'stripe_refund_confirmed_client', 'stripe_refund_confirmed_practitioner',
  'stripe_payment_failed_client',
];
const db = {
  clients: [{ id: 'client-1', email: 'client@example.com', email_consent: true }],
  email_templates: templateNames.map((name, i) => ({ id: `tmpl-${i}`, name, is_active: true, type: name, subject: name, html_body: '<p>{{session_reference}} {{amount_paid}} {{refunded_amount}}</p>', text_body: '{{session_reference}}' })),
  transactional_notifications: [], communications: [],
};
const sb = { from: table => new Query(db, table) };
let sends = 0;
const transport = async (_payload, key) => { sends++; assert.ok(key); return { success: true, status: 200, body: { id: `msg-${sends}` } }; };
const session = { id: 'session-1', client_id: 'client-1', client_name: 'Client', service: 'Session', session_date: '2026-09-01', session_time: '10:00:00', amount_paid: 70, payment_reference: 'pi_test', refunded_amount: 70, refund_reference: 're_test' };

(async () => {
  await webhook.notifyPaymentSuccess(sb, 'evt_paid', session, transport);
  assert.strictEqual(sends, 2, 'paid event sends client and practitioner messages');
  await webhook.notifyPaymentSuccess(sb, 'evt_paid', session, transport);
  assert.strictEqual(sends, 2, 'duplicate paid event sends nothing');

  await webhook.notifyRefund(sb, 'evt_refund', session, transport);
  assert.strictEqual(sends, 4, 'refund sends client and practitioner messages');
  await webhook.notifyRefund(sb, 'evt_refund', session, transport);
  assert.strictEqual(sends, 4, 'duplicate refund sends nothing');

  await webhook.notifyPaymentFailure(sb, 'evt_failed', session, transport);
  assert.strictEqual(sends, 5, 'payment failure sends client guidance');
  await webhook.notifyPaymentFailure(sb, 'evt_failed', session, transport);
  assert.strictEqual(sends, 5, 'duplicate failure sends nothing');

  assert.strictEqual(db.transactional_notifications.length, 5, 'one reservation per event/recipient/type');
  assert.ok(db.transactional_notifications.every(row => row.status === 'sent'));
  assert.ok(db.communications.length === 5);
  console.log('Stripe transactional email smoke: 12/12 passed');
})().catch(error => { console.error(error); process.exit(1); });
