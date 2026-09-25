'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { receiptRows, summarizeReceipts } = require('../netlify/functions/lib/payment-revenue');

const exact = summarizeReceipts([{ amount: 200, status: 'received' }]);
assert.deepEqual(exact, { totalCollected: 200, serviceRevenue: 200, tips: 0, clientCredits: 0 });

const partial = summarizeReceipts([{ amount: 80, status: 'received' }]);
assert.equal(partial.serviceRevenue, 80);
assert.equal(partial.totalCollected, 80);

const overpayment = summarizeReceipts([{ amount: 250, tip_amount: 50, client_credit_amount: 0, status: 'received' }]);
assert.deepEqual(overpayment, { totalCollected: 250, serviceRevenue: 200, tips: 50, clientCredits: 0 });

const designatedCredit = summarizeReceipts([{ amount: 250, tip_amount: 0, client_credit_amount: 50, status: 'received' }]);
assert.deepEqual(designatedCredit, { totalCollected: 250, serviceRevenue: 200, tips: 0, clientCredits: 50 });
assert.equal(designatedCredit.serviceRevenue + designatedCredit.tips, 200, 'client credit is excluded from earned revenue');
assert.equal(designatedCredit.totalCollected, designatedCredit.serviceRevenue + designatedCredit.tips + designatedCredit.clientCredits);

const once = receiptRows(
  [{ amount: 250, tip_amount: 50, client_credit_amount: 0, correlation_id: 'same', status: 'received' }],
  [
    { entry_type: 'payment', amount: 250, tip_amount: 50, correlation_id: 'same', related_payment_id: null },
    { entry_type: 'payment', amount: 250, related_payment_id: 'payment-row' },
    { entry_type: 'charge', amount: 250, related_payment_id: null },
  ],
);
assert.equal(once.length, 1);
assert.deepEqual(summarizeReceipts(once), { totalCollected: 250, serviceRevenue: 200, tips: 50, clientCredits: 0 });

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260925020452_payment_overpayment_tip_policy.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'financial-module.js'), 'utf8');
assert.match(migration, /allocate_payment_excess/);
assert.match(migration, /excess_allocation text/);
assert.match(migration, /p_excess_allocation text default null/);
assert.match(migration, /p_excess_allocation='client_credit'/);
assert.match(migration, /if p_excess_allocation='client_credit' then client_credit:=excess; else tip:=excess; end if/);
assert.match(migration, /not\|no\|never\|do not\|don.t/);
assert.match(migration, /allocation->>'excess_allocation'/);
assert.match(migration, /p_correlation_id uuid,p_request_path text/);
assert.match(migration, /correlation_id=p_correlation_id::text/);
assert.match(migration, /values\(s\.id,s\.client_id[\s\S]*?gross/);
assert.match(migration, /amount_paid=applied/);
assert.match(migration, /service_amount:=least\(service_amount,greatest\(round\(coalesce\(inv\.total,0\)-coalesce\(inv\.amount_paid,0\),2\),0\)\)/);
assert.match(migration, /greatest\(round\(coalesce\(s\.amount_due,0\)-other_service,2\),0\)/);
assert.match(ui, /kpi\('Service Revenue'/);
assert.match(ui, /kpi\('Tips'/);

console.log('PASS exact, partial, tip overpayment, explicit client credit, structured allocation, negation guard, gross collection, no double counting, transactional service allocation, and Finance labels');
