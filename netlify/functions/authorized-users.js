'use strict';

const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { requireAdmin, respond, hashToken } = require('./lib/auth');
const { sendTransactional } = require('./lib/mailer');

const roles = new Set(['developer', 'staff', 'authorized_user']);
const normalize = value => String(value || '').trim().toLowerCase();

function invitationState(user, now = Date.now()) {
  if (!user) return 'new';
  if (user.password_hash) return 'active';
  if (user.invite_token_hash && user.invite_expires_at && new Date(user.invite_expires_at).getTime() > now) return 'pending';
  if (user.invite_token_hash && user.invite_expires_at) return 'expired';
  return 'active';
}

async function audit(sb, auth, action, id, newData = {}) {
  await sb.from('audit_logs').insert({
    action, table_name: 'practitioner_users', record_id: id,
    actor: auth.user.email, new_data: { ...newData, actor_user_id: auth.user.id, actor_role: auth.role },
  });
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  if (auth.role !== 'owner') return respond(403, { error: 'Owner authorization is required.' });
  const sb = getClient();
  if (event.httpMethod === 'GET') {
    const { data, error } = await sb.from('practitioner_users').select('id,email,display_name,role,active,created_at,last_login_at,invited_at').order('created_at', { ascending: true });
    if (error) return respond(500, { error: 'Authorized users are unavailable.' });
    return respond(200, { users: data || [] });
  }
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid request.' }); }
  if (event.httpMethod === 'POST') {
    const email = normalize(body.email), displayName = String(body.display_name || '').trim();
    const role = String(body.role || 'staff');
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !displayName || !roles.has(role)) return respond(400, { error: 'Valid email, name, and permitted role are required.' });
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const invitedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 20 * 60000).toISOString();
    const { data: existing, error: lookupError } = await sb.from('practitioner_users').select('id,email,display_name,role,active,password_hash,invite_token_hash,invite_expires_at').ilike('email', email).maybeSingle();
    if (lookupError) return respond(500, { error: 'User could not be invited.' });

    let user, resend = false;
    if (existing) {
      const state = invitationState(existing, now.getTime());
      if (state === 'pending') return respond(409, { error: 'An invitation is already pending for that user.', code: 'INVITATION_PENDING' });
      if (state === 'active') return respond(409, { error: 'That user already has an active account.', code: 'USER_EXISTS' });
      const { data, error } = await sb.from('practitioner_users').update({ display_name: displayName, role, active: true, invited_at: invitedAt, invite_token_hash: hashToken(token), invite_expires_at: expiresAt }).eq('id', existing.id).is('password_hash', null).select('id,email,display_name,role,active,created_at,invited_at').single();
      if (error || !data) return respond(500, { error: 'User could not be reinvited.' });
      user = data;
      resend = true;
    } else {
      const { data, error } = await sb.from('practitioner_users').insert({ email, display_name: displayName, role, active: true, created_by: auth.user.id, invited_at: invitedAt, invite_token_hash: hashToken(token), invite_expires_at: expiresAt }).select('id,email,display_name,role,active,created_at,invited_at').single();
      if (error) return respond(500, { error: 'User could not be created.' });
      user = data;
    }
    const base = String(process.env.SITE_URL || 'https://www.daronroyal.com').replace(/\/$/, '');
    let mail;
    try {
      mail = await sendTransactional(sb, { templateName: 'practitioner_user_invitation', recipientEmail: email, idempotencyKey: `practitioner-invite:${user.id}:${user.invited_at}`, variables: { invite_url: `${base}/dashboard.html#invite=${token}` }, metadata: { notification_type: 'practitioner_user_invitation', invitation_token_present: true, resend } });
    } catch {
      mail = { sent: false, reason: 'notification_failed' };
    }
    await audit(sb, auth, resend ? 'authorized_user_invitation_resent' : 'authorized_user_created', user.id, { role, email_hash: crypto.createHash('sha256').update(email).digest('hex'), email_sent: Boolean(mail.sent), resend });
    if (!mail.sent) return respond(502, { error: 'Invitation email could not be sent.', code: 'INVITATION_EMAIL_FAILED' });
    return respond(resend ? 200 : 201, { user, invitation_sent: true, resent: resend });
  }
  if (event.httpMethod === 'PATCH') {
    const id = String(body.id || ''), action = String(body.action || '');
    if (!id || !['activate', 'deactivate', 'change_role'].includes(action)) return respond(400, { error: 'Invalid user action.' });
    if (id === auth.user.id) return respond(400, { error: 'You cannot revoke your own access.' });
    const updates = action === 'change_role' ? { role: roles.has(body.role) ? body.role : null } : { active: action === 'activate' };
    if (action === 'change_role' && !updates.role) return respond(400, { error: 'Invalid role.' });
    const { data: user, error } = await sb.from('practitioner_users').update(updates).eq('id', id).neq('role', 'owner').select('id,email,display_name,role,active').single();
    if (error || !user) return respond(404, { error: 'Authorized user not found.' });
    if (action === 'deactivate') await sb.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('user_id', id).is('revoked_at', null);
    await audit(sb, auth, action === 'change_role' ? 'authorized_user_role_changed' : action === 'deactivate' ? 'authorized_user_revoked' : 'authorized_user_reactivated', id, { role: user.role, active: user.active });
    return respond(200, { user });
  }
  return respond(405, { error: 'Method not allowed.' });
};

exports._test = { invitationState };
