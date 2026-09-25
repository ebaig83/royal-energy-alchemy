'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'netlify/functions'), { recursive: true }).filter(f => /\.(?:js|cjs|mjs)$/.test(f));
const source = new Map(files.map(f => [String(f).replace(/\\/g, '/'), fs.readFileSync(path.join(root, 'netlify/functions', f), 'utf8')]));
const directPayments = [];
const directFinancialLedger = [];
const directSessions = [];
for (const [file, text] of source) {
  for (const m of text.matchAll(/\.from\(\s*['"]payments['"]\s*\)(?:(?!;)[\s\S]){0,800}?\.(insert|update|upsert)\s*\(/g)) directPayments.push(`${file}:${m[1]}`);
  for (const m of text.matchAll(/\.from\(\s*['"]ledger_entries['"]\s*\)(?:(?!;)[\s\S]){0,800}?\.(insert|update|upsert|delete)\s*\(/g)) directFinancialLedger.push(`${file}:${m[1]}`);
  for (const m of text.matchAll(/\.from\(\s*['"]sessions['"]\s*\)(?:(?!;)[\s\S]){0,800}?\.update\s*\(/g)) directSessions.push(`${file}:${m.index}`);
}

assert.deepEqual(directPayments, [], `Direct payments-table writes remain: ${directPayments.join(', ')}`);
assert.deepEqual(directFinancialLedger, [], `Direct financial ledger writes remain: ${directFinancialLedger.join(', ')}`);
const sessionsSource = source.get('sessions.js');
assert.ok(sessionsSource.indexOf("if(['reschedule','cancel'].includes(body.action))return") < sessionsSource.indexOf("if (body.action === 'cancel')"), 'legacy dashboard cancellation branch must remain unreachable behind audited return');
assert.ok(sessionsSource.indexOf("if(['reschedule','cancel'].includes(body.action))return") < sessionsSource.indexOf('// ── RESCHEDULE action'), 'legacy dashboard reschedule branch must remain unreachable');
assert.ok(sessionsSource.indexOf("if(['retry-calendar','retry_google_sync'].includes(body.action))return") < sessionsSource.indexOf("if (body.action === 'retry_google_sync')"), 'legacy Calendar retry update must remain unreachable behind audited return');

const management = source.get('manage-appointment.js');
assert.ok(/if \(action === 'reschedule_confirmed'\)\s*\{\s*return await managedChange/.test(management));
assert.ok(/if \(action === 'cancel_confirmed'\)\s*\{\s*return await managedChange/.test(management));
assert.equal((management.match(/handleRescheduleConfirmed\s*\(/g) || []).length, 1, 'legacy direct reschedule writer must have no call sites');
assert.equal((management.match(/handleCancelConfirmed\s*\(/g) || []).length, 1, 'legacy direct cancellation writer must have no call sites');

const paymentWorker = source.get('payment-email-reconcile.js');
const webhook = source.get('stripe-webhook.js');
assert.ok(paymentWorker.includes("rpc('payment_reconciliation_attach_with_audit'"));
assert.ok(!paymentWorker.includes("rpc('payment_reconciliation_attach'"));
assert.ok(!/\.from\(\s*['"]stripe_webhook_events['"]\s*\)(?:(?!;)[\s\S]){0,800}?\.(insert|update|upsert)\s*\(/.test(webhook));
assert.ok(directSessions.every(item => item.startsWith('sessions.js:') || item.startsWith('manage-appointment.js:')), `Unexpected direct session writes: ${directSessions.join(', ')}`);
console.log('PASS complete active payment/session direct-write scan');
console.log('PASS no direct financial ledger table writes remain');
console.log('PASS remaining legacy dashboard and management writes are structurally unreachable');
