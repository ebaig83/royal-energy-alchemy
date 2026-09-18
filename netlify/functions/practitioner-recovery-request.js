'use strict';

const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { respond, hashToken } = require('./lib/auth');
const credential = require('./lib/practitioner-credential');
const { sendTransactional } = require('./lib/mailer');
const { hashIdentifier, logRecoveryAudit } = require('./lib/recovery-audit');

const GENERIC = { accepted: true, message: 'If the account is eligible, a secure reset link will be sent.' };
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function originAllowed(event) {
  const actual = String(event.headers?.origin || event.headers?.Origin || '').replace(/\/$/, '');
  const allowed = String(process.env.SITE_URL || 'https://www.daronroyal.com').replace(/\/$/, '');
  return !actual || actual === allowed;
}

exports.handler = async event => {
  const generic = () => respond(202, GENERIC);
  try {
    if (String(event.httpMethod || '').toUpperCase() !== 'POST' || !originAllowed(event) || (event.body || '').length > 1024) return generic();
    let body; try { body = JSON.parse(event.body || '{}'); } catch { return generic(); }
    const email = normalize(body.email);
    const configured = normalize(process.env.ADMIN_EMAIL);
    const emailHash = hashIdentifier(email);
    const sb = getClient();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { await logRecoveryAudit(sb, { eventType: 'request', outcome: 'invalid_input', identifier: emailHash }); return generic(); }
    if (!await credential.recoveryRequestAttempt(sb, event, emailHash)) { await logRecoveryAudit(sb, { eventType: 'request', outcome: 'rate_limited', identifier: emailHash }); return generic(); }
    const { data: account } = await sb.from('practitioner_users').select('id,email,active').eq('email',email).eq('active',true).maybeSingle();
    const eligible = account || (configured && email === configured ? { id: null, email: configured, active: true } : null);
    if (!eligible) { await logRecoveryAudit(sb, { eventType: 'request', outcome: 'not_eligible', identifier: emailHash }); return generic(); }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expires = new Date(Date.now() + 20 * 60000).toISOString();
    const ip = String(event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown').split(',')[0].trim();
    const { error } = await sb.from('practitioner_recovery_tokens').insert({ token_hash: tokenHash, user_id: eligible.id, expires_at: expires, request_email_hash: emailHash, request_ip_hash: hashIdentifier(ip) });
    if (error) throw Error();
    const base = String(process.env.SITE_URL || 'https://www.daronroyal.com').replace(/\/$/, '');
    const mail = await sendTransactional(sb, { templateName: 'practitioner_password_recovery', recipientEmail: eligible.email, idempotencyKey: `practitioner-recovery:${tokenHash}`, variables: { reset_url: `${base}/dashboard.html#reset=${token}` }, metadata: { notification_type: 'practitioner_password_recovery', recovery_token_present: true } });
    await sb.from('practitioner_recovery_tokens').update({ provider_message_id: mail.message_id || null }).eq('token_hash', tokenHash);
    await logRecoveryAudit(sb, { eventType: 'request', outcome: mail.sent ? 'email_sent' : 'email_not_sent', identifier: emailHash, providerMessageId: mail.message_id || null });
    return generic();
  } catch {
    return generic();
  }
};
