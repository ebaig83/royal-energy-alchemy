'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { observeWorker } = require('../netlify/functions/lib/worker-health');

function fakeSupabase() {
  const rows = new Map();
  return { rows, from(table) {
    assert.equal(table, 'worker_health');
    return { upsert(row) { rows.set(row.worker, { ...(rows.get(row.worker) || {}), ...row }); return Promise.resolve({ error: null }); } };
  } };
}

(async () => {
  const sb = fakeSupabase();
  const first = await observeWorker(sb, 'payment-reconciliation', async () => ({ scanned: 12, parsed: 7 }));
  assert.deepEqual(first, { scanned: 12, parsed: 7 });
  assert.equal(sb.rows.get('payment-reconciliation').status, 'healthy');
  assert.equal(sb.rows.get('payment-reconciliation').scanned_count, 12);
  assert.equal(sb.rows.get('payment-reconciliation').processed_count, 7);
  const firstStarted = sb.rows.get('payment-reconciliation').started_at;
  await observeWorker(sb, 'payment-reconciliation', async () => ({ scanned: 3, processed: 2 }));
  assert.equal(sb.rows.size, 1);
  assert.notEqual(sb.rows.get('payment-reconciliation').started_at, firstStarted);
  assert.equal(sb.rows.get('payment-reconciliation').scanned_count, 3);
  assert.equal(sb.rows.get('payment-reconciliation').processed_count, 2);
  await assert.rejects(() => observeWorker(sb, 'payment-reconciliation', async () => { throw Error('sensitive provider detail'); }), /sensitive provider detail/);
  assert.equal(sb.rows.get('payment-reconciliation').status, 'failed');
  assert.equal(sb.rows.get('payment-reconciliation').error_summary, 'worker_run_failed');
  assert.equal(sb.rows.size, 1);
  const worker = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/payment-email-reconcile.js'), 'utf8');
  assert.match(worker, /PAYMENT_EMAIL_AUTO_ATTACH_ENABLED === 'true'/);
  assert.match(worker, /payment_reconciliation_checkpoints/);
  console.log('PASS payment reconciliation worker health success/update/failure telemetry, checkpoint preservation, and auto-attach gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
