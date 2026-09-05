'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { sendTransactional } = require('./lib/mailer');
const checkout = require('./create-stripe-checkout');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const auth = await requireAdmin(event); if (auth.error) return auth.error;
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  const sessionId = body.session_id; if (!sessionId) return respond(400, { error: 'session_id is required.' });
  const sb = getClient();
  const { data: session, error } = await sb.from('sessions').select('id,client_id,client_name,client_email,session_date,session_time,service,payment_status,waiver_status,waiver_completed,stripe_checkout_session_id').eq('id', sessionId).single();
  if (error || !session) return respond(404, { error: 'Session not found.' });
  if (String(session.payment_status || '').toLowerCase() === 'paid') return respond(409, { error: 'Payment already completed.', code: 'already_paid' });
  if (!(session.waiver_completed === true || ['complete','completed','signed'].includes(String(session.waiver_status || '').toLowerCase()))) return respond(409, { error: 'Waiver must be completed before payment can be requested.', code: 'waiver_required' });
  let email = session.client_email || null;
  if (!email && session.client_id) { const r = await sb.from('clients').select('email').eq('id', session.client_id).single(); email = r.data?.email || null; }
  if (!email) return respond(409, { error: 'Client email required.', code: 'client_email_required' });
  const result = await checkout.handler({ ...event, body: JSON.stringify({ session_id: session.id }) });
  const payload = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
  if (result.statusCode !== 200 || !payload?.url) return result;
  const mail = await sendTransactional(sb, { templateName: 'practitioner_payment_link', recipientEmail: email, clientId: session.client_id, idempotencyKey: `payment-link:${session.id}:${payload.checkout_session_id || 'new'}`, variables: { client_name: session.client_name || 'there', payment_url: payload.url, session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0,5), service: session.service || '' }, metadata: { notification_type: 'practitioner_payment_link', session_id: session.id } });
  return respond(200, { sent: mail.sent === true, url: payload.url, payment_status: 'pending' });
};
