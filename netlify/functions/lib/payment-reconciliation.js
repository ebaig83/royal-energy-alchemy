'use strict';

const { isQaRecord } = require('./record-policy');

const OPEN_PAYMENT_STATUSES = new Set(['unpaid', 'pending', 'partial']);
function norm(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function cents(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
function remaining(session) { return Math.max(0, cents(session.amount_due) - cents(session.amount_paid)); }
function dateDistance(a, b) { if (!a || !b) return Infinity; const x = new Date(a).getTime(), y = new Date(b).getTime(); return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity; }
function eligible(session) { return session && !isQaRecord(session) && !['cancelled', 'no_show'].includes(norm(session.status)) && OPEN_PAYMENT_STATUSES.has(norm(session.payment_status)) && remaining(session) > 0 && norm(session.payment_source) !== 'stripe' && norm(session.stripe_payment_status) !== 'paid' && !session.stripe_payment_intent_id; }
function exactMemoSession(payment, sessions) { const memo = String(payment.memo || ''); return sessions.find(s => s.id && memo.includes(s.id)); }

function matchPayment(payment, { sessions = [], clients = [], existingPayments = [] } = {}) {
  if (!payment?.valid) return { status: 'needs_reconciliation', confidence: 'none', reason: payment?.reason || 'invalid_payment' };
  if (payment.provider === 'stripe') return { status: 'needs_reconciliation', confidence: 'none', reason: 'stripe_webhook_authority' };
  const duplicate = existingPayments.find(row => norm(row.method) === norm(payment.provider) && String(row.reference_id || '') === payment.provider_reference_id);
  if (duplicate) return { status: 'duplicate', confidence: 'high', reason: 'provider_reference_already_recorded', matched_session_id: duplicate.session_id || null };
  const open = sessions.filter(eligible);
  const memoSession = exactMemoSession(payment, open);
  if (memoSession) return evaluate(payment, [memoSession], 'high', 'memo_contains_exact_session_reference');

  const payerEmail = norm(payment.payer_email);
  const payerPhone = digits(payment.payer_phone);
  const contactClientIds = new Set(clients.filter(c => (payerEmail && norm(c.email) === payerEmail) || (payerPhone && digits(c.phone) === payerPhone)).map(c => c.id));
  const contact = open.filter(s => (payerEmail && norm(s.client_email) === payerEmail) || (payerPhone && digits(s.client_phone) === payerPhone) || contactClientIds.has(s.client_id));
  if (contact.length) return evaluate(payment, contact, 'high', 'exact_payer_contact');

  const name = norm(payment.payer_display_name);
  const exactName = name ? open.filter(s => norm(s.client_name) === name || clients.some(c => c.id === s.client_id && norm(c.full_name) === name)) : [];
  if (exactName.length) return evaluate(payment, exactName, 'high', 'exact_payer_name');

  const close = open.filter(s => name && (norm(s.client_name).includes(name) || name.includes(norm(s.client_name))) && dateDistance(payment.transaction_at, `${s.session_date}T${String(s.session_time || '00:00').slice(0, 5)}:00-05:00`) <= 3);
  if (close.length) return evaluate(payment, close, 'medium', 'name_amount_date_proximity_review_only');
  return { status: 'needs_reconciliation', confidence: 'none', reason: 'no_high_confidence_match' };
}

function evaluate(payment, candidates, confidence, reason) {
  const amountMatches = candidates.filter(s => cents(payment.amount) <= remaining(s));
  if (amountMatches.length !== 1 || candidates.length !== 1) return { status: 'needs_reconciliation', confidence, reason: candidates.length > 1 ? 'multiple_plausible_matches' : 'amount_conflict', candidates: candidates.map(s => ({ session_id: s.id, client_id: s.client_id, client_name: s.client_name, remaining: remaining(s) / 100 })) };
  return { status: confidence === 'high' ? 'matched' : 'needs_reconciliation', confidence, reason, matched_session_id: amountMatches[0].id, matched_client_id: amountMatches[0].client_id || null, candidates: [{ session_id: amountMatches[0].id, client_id: amountMatches[0].client_id, client_name: amountMatches[0].client_name, remaining: remaining(amountMatches[0]) / 100 }] };
}

module.exports = { matchPayment, eligible, remaining, cents, norm, digits };
