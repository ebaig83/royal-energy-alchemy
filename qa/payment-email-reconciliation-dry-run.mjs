import fs from 'node:fs/promises';
import { parsePaymentEmail } from '../netlify/functions/lib/payment-email-parsers.js';
import { matchPayment } from '../netlify/functions/lib/payment-reconciliation.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node qa/payment-email-reconciliation-dry-run.mjs <sanitized-sample.json>');
  process.exit(2);
}
const samples = JSON.parse(await fs.readFile(file, 'utf8'));
if (!Array.isArray(samples)) throw new Error('Sample file must contain an array.');
const sessions = JSON.parse(process.env.PAYMENT_RECONCILIATION_SESSIONS_JSON || '[]');
const clients = JSON.parse(process.env.PAYMENT_RECONCILIATION_CLIENTS_JSON || '[]');
const existingPayments = JSON.parse(process.env.PAYMENT_RECONCILIATION_PAYMENTS_JSON || '[]');
const proposals = samples.map((sample, index) => {
  const parsed = parsePaymentEmail(sample);
  const match = parsed.valid ? matchPayment(parsed, { sessions, clients, existingPayments }) : { status: 'needs_reconciliation', confidence: 'none', reason: parsed.reason, candidates: [] };
  return { sample: index + 1, provider: parsed.provider, reference_present: Boolean(parsed.provider_reference_id), amount: parsed.amount, status: match.status, confidence: match.confidence || 'none', reason: match.reason || null, candidate_session_ids: (match.candidates || []).map(candidate => candidate.session_id) };
});
console.log(JSON.stringify({ mode: 'dry_run', writes: 0, proposals }, null, 2));
