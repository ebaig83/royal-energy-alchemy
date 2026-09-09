'use strict';
const crypto = require('crypto');
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { sendTransactional } = require('./lib/mailer');
const checkout = require('./create-stripe-checkout');
const { configuredSettings, validateProvider, LABELS, formatAmount } = require('./lib/payment-request');

function parseBody(event) { try { return JSON.parse(event.body || '{}'); } catch { return null; } }
function safeError(error) { return String(error?.message || 'Payment request could not be prepared.').slice(0, 240); }
async function loadSession(sb, sessionId) {
  const { data: session, error } = await sb.from('sessions').select('id,client_id,client_name,client_email,session_date,session_time,service,amount_due,payment_status,waiver_status,waiver_completed,stripe_checkout_session_id,payment_request_reference').eq('id', sessionId).single();
  if (error || !session) return null;
  let email = session.client_email || null;
  if (!email && session.client_id) { const r = await sb.from('clients').select('email').eq('id', session.client_id).single(); email = r.data?.email || null; }
  return { ...session, client_email: email };
}
function waiverComplete(session) { return session.waiver_completed === true || ['complete', 'completed', 'signed'].includes(String(session.waiver_status || '').toLowerCase()); }
async function stripeRequest(event, sb, session) {
  const result = await checkout.handler({ ...event, body: JSON.stringify({ session_id: session.id }) });
  const payload = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  if (result.statusCode !== 200 || !payload?.url) return result;
  const mail = await sendTransactional(sb, { templateName: 'practitioner_payment_link', recipientEmail: session.client_email, clientId: session.client_id, idempotencyKey: `payment-link:${session.id}:${payload.checkout_session_id || 'new'}`, variables: { client_name: session.client_name || 'there', payment_url: payload.url, session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0, 5), service: session.service || '' }, metadata: { notification_type: 'practitioner_payment_link', session_id: session.id, provider: 'stripe' } });
  return respond(200, { sent: mail.sent === true, url: payload.url, payment_status: 'pending', provider: 'stripe' });
}
function newReference() { return `REA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
async function offPlatformRequest(sb, session, provider, requestId) {
  const { data: row, error: readError } = await sb.from('practitioner_payment_settings').select('*').eq('practitioner_key', 'default').maybeSingle();
  if (readError || !row) return respond(503, { error: 'Payment settings are not available.' });
  const settings = configuredSettings(row);
  let selected; try { selected = validateProvider(provider, settings); } catch (error) { return respond(409, { error: safeError(error), code: 'payment_method_unavailable' }); }
  const { data: existing } = await sb.from('payment_requests').select('id,session_id,provider,amount_due,safe_reference,idempotency_key,status,provider_message_id').eq('session_id', session.id).maybeSingle();
  if (existing) {
    if (existing.provider !== selected) return respond(409, { error: 'A different payment request already exists for this appointment.', code: 'payment_request_exists' });
    return respond(200, { sent: existing.status === 'sent', duplicate: true, provider: existing.provider, payment_reference: existing.safe_reference, amount_due: Number(existing.amount_due), request_status: existing.status, payment_status: 'pending' });
  }
  const amountDue = Number(session.amount_due);
  if (!Number.isFinite(amountDue) || amountDue <= 0) return respond(409, { error: 'The canonical amount due is unavailable.', code: 'amount_unavailable' });
  const idempotencyKey = String(requestId || '').trim() || `payment-request:${session.id}:${selected}`;
  const { data: request, error: insertError } = await sb.from('payment_requests').insert({ session_id: session.id, provider: selected, amount_due: amountDue, safe_reference: newReference(), idempotency_key: idempotencyKey, status: 'pending' }).select('id,session_id,provider,amount_due,safe_reference,status').single();
  if (insertError || !request) {
    if (insertError?.code === '23505') {
      const retry = await sb.from('payment_requests').select('provider,amount_due,safe_reference,status').eq('session_id', session.id).maybeSingle();
      if (retry.data) return respond(200, { sent: retry.data.status === 'sent', duplicate: true, provider: retry.data.provider, payment_reference: retry.data.safe_reference, amount_due: Number(retry.data.amount_due), request_status: retry.data.status, payment_status: 'pending' });
    }
    return respond(500, { error: 'Payment request could not be recorded.' });
  }
  const config = settings[selected];
  const mail = await sendTransactional(sb, { templateName: 'practitioner_off_platform_payment_request', recipientEmail: session.client_email, clientId: session.client_id, idempotencyKey: `payment-request:${session.id}:${selected}:${idempotencyKey}`, variables: { client_name: session.client_name || 'there', amount_due: formatAmount(amountDue), payment_provider: LABELS[selected], payment_instructions: [config.label, config.destination].filter(Boolean).join(': '), session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0, 5), service: session.service || '', payment_reference: request.safe_reference }, metadata: { notification_type: 'practitioner_off_platform_payment_request', session_id: session.id, provider: selected, payment_reference: request.safe_reference } });
  if (!mail.sent) {
    await sb.from('payment_requests').update({ status: 'failed', last_error: 'Payment request email was not sent.', updated_at: new Date().toISOString() }).eq('id', request.id);
    return respond(502, { error: 'Payment request email was not sent.', code: 'payment_request_email_failed' });
  }
  await sb.from('sessions').update({ payment_request_reference: request.safe_reference }).eq('id', session.id).is('payment_request_reference', null);
  await sb.from('payment_requests').update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: mail.message_id || null, updated_at: new Date().toISOString() }).eq('id', request.id);
  return respond(200, { sent: true, duplicate: false, provider: selected, payment_reference: request.safe_reference, amount_due: amountDue, request_status: 'sent', payment_status: 'pending' });
}
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const auth = await requireAdmin(event); if (auth.error) return auth.error;
  const body = parseBody(event); if (!body) return respond(400, { error: 'Invalid JSON.' });
  const sessionId = body.session_id; if (!sessionId) return respond(400, { error: 'session_id is required.' });
  const sb = getClient();
  const session = await loadSession(sb, sessionId);
  if (!session) return respond(404, { error: 'Session not found.' });
  if (String(session.payment_status || '').toLowerCase() === 'paid') return respond(409, { error: 'Payment already completed.', code: 'already_paid' });
  if (!waiverComplete(session)) return respond(409, { error: 'Waiver must be completed before payment can be requested.', code: 'waiver_required' });
  if (!session.client_email) return respond(409, { error: 'Client email required.', code: 'client_email_required' });
  const provider = String(body.provider || 'stripe').trim().toLowerCase();
  if (provider === 'stripe') return stripeRequest(event, sb, session);
  return offPlatformRequest(sb, session, provider, body.request_id);
};
exports._test = { newReference, waiverComplete, parseBody };
