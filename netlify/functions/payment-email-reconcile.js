'use strict';

const { getClient } = require('./lib/supabase');
const { observeWorker } = require('./lib/worker-health');
const { requiredConfig, accessToken, listPaymentMessages } = require('./lib/gmail-payment-source');
const { matchPayment } = require('./lib/payment-reconciliation');

const SOURCE = 'gmail_payment_notifications';
function safeItem(payment, match) {
  return { provider: payment.provider, provider_reference_id: payment.provider_reference_id, payer_display_name: payment.payer_display_name, payer_email: payment.payer_email, payer_phone: payment.payer_phone, amount: payment.amount, transaction_at: payment.transaction_at, memo: payment.memo, recipient_context: payment.recipient_context, source_message_id: payment.source_message_id, status: match.status === 'matched' ? 'matched' : match.status, confidence: match.confidence || 'none', match_reason: match.reason || null, candidate_matches: match.candidates || [], matched_client_id: match.matched_client_id || null, matched_session_id: match.matched_session_id || null };
}
async function processPayments({ sb, env = process.env, now = () => new Date() } = {}) {
  const missing = requiredConfig(env);
  if (missing.length) return { skipped: true, reason: 'gmail_not_configured', missing: missing.map(key => key.replace(/^GMAIL_/, '')) };
  const checkpoint = (await sb.from('payment_reconciliation_checkpoints').select('*').eq('source_name', SOURCE).maybeSingle()).data;
  const token = await accessToken(env);
  const messages = await listPaymentMessages({ token, after: checkpoint?.last_message_at });
  const sessions = (await sb.from('sessions').select('id,client_id,client_name,client_email,client_phone,session_date,session_time,status,payment_status,amount_due,amount_paid,source,stripe_payment_status,stripe_payment_intent_id,payment_request_reference')).data || [];
  const clients = (await sb.from('clients').select('id,full_name,email,phone')).data || [];
  const references = messages.map(message => message.parsed.provider_reference_id).filter(Boolean);
  const existing = references.length ? ((await sb.from('payments').select('method,reference_id,session_id').in('reference_id', references)).data || []) : [];
  const rows = messages.filter(message => message.parsed.valid).map(message => safeItem(message.parsed, matchPayment(message.parsed, { sessions, clients, existingPayments: existing })));
  if (rows.length) {
    const { error } = await sb.from('payment_reconciliation_items').upsert(rows, { onConflict: 'provider_reference_key', ignoreDuplicates: true });
    if (error) throw error;
  }
  let attached = 0;
  if (env.PAYMENT_EMAIL_AUTO_ATTACH_ENABLED === 'true') {
    for (const row of rows.filter(item => item.status === 'matched' && item.confidence === 'high' && item.matched_session_id)) {
      const itemLookup = await sb.from('payment_reconciliation_items').select('id').eq('provider_reference_key', `${row.provider}:${row.provider_reference_id}`.toLowerCase()).maybeSingle();
      if (itemLookup.error || !itemLookup.data?.id) continue;
      const result = await sb.rpc('payment_reconciliation_attach', { p_item_id: itemLookup.data.id, p_session_id: row.matched_session_id, p_actor: 'payment-email-reconcile', p_mode: 'automatic' });
      if (!result.error && result.data?.status === 'attached') attached += 1;
    }
  }
  const latest = messages.map(message => message.internalDate).filter(Boolean).sort().at(-1) || checkpoint?.last_message_at || now().toISOString();
  await sb.from('payment_reconciliation_checkpoints').upsert({ source_name: SOURCE, cursor: latest, last_message_at: latest, last_success_at: now().toISOString(), last_error: null, updated_at: now().toISOString() }, { onConflict: 'source_name' });
  return { scanned: messages.length, parsed: rows.length, attached, review_only: rows.filter(row => row.status !== 'matched').length };
}

exports.config = { schedule: '*/30 * * * *' };
exports.processPayments = processPayments;
exports.handler = async () => {
  const sb = getClient();
  try { return { statusCode: 200, body: JSON.stringify(await observeWorker(sb, 'payment-reconciliation', () => processPayments({ sb }))) }; }
  catch (error) { console.error('[payment-email-reconcile]', String(error.message || error).slice(0, 300)); return { statusCode: 500, body: JSON.stringify({ error: 'Payment reconciliation worker failed.' }) }; }
};
