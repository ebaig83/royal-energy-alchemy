'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { sendTransactional } = require('./lib/mailer');
const SITE_URL = process.env.SITE_URL || 'https://www.daronroyal.com';
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const auth = requireAdmin(event); if (auth.error) return auth.error;
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  const sessionId = body.session_id; if (!sessionId) return respond(400, { error: 'session_id is required.' });
  const sb = getClient();
  const { data: session, error } = await sb.from('sessions').select('id,client_id,client_name,client_email,session_date,session_time,service,waiver_status,waiver_completed').eq('id', sessionId).single();
  if (error || !session) return respond(404, { error: 'Session not found.' });
  if (session.waiver_completed === true || ['complete','completed','signed'].includes(String(session.waiver_status || '').toLowerCase())) return respond(200, { waiver_complete: true });
  let email = session.client_email || null;
  if (!email && session.client_id) { const r = await sb.from('clients').select('email').eq('id', session.client_id).single(); email = r.data?.email || null; }
  if (!email) return respond(409, { error: 'Client email required.', code: 'client_email_required' });
  const waiverUrl = `${SITE_URL}/waiver-esign.html?session_id=${encodeURIComponent(session.id)}&name=${encodeURIComponent(session.client_name || '')}&email=${encodeURIComponent(email)}`;
  const result = await sendTransactional(sb, { templateName: 'practitioner_waiver_link', recipientEmail: email, clientId: session.client_id, idempotencyKey: `waiver-link:${session.id}:${Math.floor(Date.now()/60000)}`, variables: { client_name: session.client_name || 'there', waiver_url: waiverUrl, session_date: session.session_date || '', session_time: String(session.session_time || '').slice(0,5), service: session.service || '' }, metadata: { notification_type: 'practitioner_waiver_link', session_id: session.id } });
  return respond(200, { sent: result.sent === true, waiver_url: waiverUrl });
};
