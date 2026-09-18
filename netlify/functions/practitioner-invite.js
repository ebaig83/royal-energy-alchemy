'use strict';
const { getClient } = require('./lib/supabase');
const { respond, hashToken } = require('./lib/auth');
const credential = require('./lib/practitioner-credential');

function normalizeInviteToken(value) {
  if (typeof value !== 'string') return '';
  let token = value;
  try { token = decodeURIComponent(token); } catch { return ''; }
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : '';
}

function invitationValidation(user, token, now = Date.now()) {
  const normalized = normalizeInviteToken(token);
  const tokenHashMatch = Boolean(user && normalized && user.invite_token_hash && hashToken(normalized) === user.invite_token_hash);
  const inviteNotExpired = Boolean(user && user.invite_expires_at && Date.parse(user.invite_expires_at) > now);
  return {
    user_found: Boolean(user),
    active: Boolean(user && user.active),
    token_hash_match: tokenHashMatch,
    invite_not_expired: inviteNotExpired,
    setup_allowed: Boolean(user && user.active && tokenHashMatch && inviteNotExpired),
  };
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Invitation request was not accepted.' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invitation request was not accepted.' }); }
  const token = normalizeInviteToken(body.token);
  if (!token || !credential.validNew(body.next) || body.next !== body.confirm) return respond(400, { error: 'Invitation request was not accepted.' });
  const sb = getClient();
  const { data: user, error } = await sb.from('practitioner_users').select('id,email,active,invite_token_hash,invite_expires_at').eq('invite_token_hash', hashToken(token)).maybeSingle();
  const validation = invitationValidation(user, token);
  if (error || !validation.setup_allowed) return respond(400, { error: 'Invitation request was not accepted.' });
  const encoded = await credential.hash(body.next);
  const { error: updateError } = await sb.from('practitioner_users').update({ password_hash: encoded, credential_version: 1, invite_token_hash: null, invite_expires_at: null }).eq('id', user.id).eq('active', true);
  if (updateError) return respond(503, { error: 'Invitation request was not accepted.' });
  await sb.from('audit_logs').insert({ action: 'authorized_user_password_set', table_name: 'practitioner_users', record_id: user.id, actor: user.email, new_data: { user_id: user.id } });
  return respond(200, { password_set: true, sign_in_required: true });
};

exports._test = { normalizeInviteToken, invitationValidation };
