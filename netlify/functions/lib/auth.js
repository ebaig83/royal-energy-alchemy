'use strict';

const crypto = require('crypto');
const { getClient } = require('./supabase');
const { idleExpired } = require('./session-policy');

const COOKIE_NAME = 'rea_admin_session';
const SESSION_HOURS = 8;

function cookieValue(event, name = COOKIE_NAME) {
  const raw = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}
function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function sessionCookie(token, maxAge = SESSION_HOURS * 3600) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function clearSessionCookie() { return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

async function requireAdmin(event, options = {}) {
  const token = cookieValue(event);
  if (!token || token.length < 32) return { error: respond(401, { error: 'Unauthorized.' }) };
  const sb = getClient();
  const now = new Date().toISOString();
  const { data, error } = await sb.from('admin_sessions')
    .select('id,actor_email,user_id,role,created_at,last_seen_at,expires_at,absolute_expires_at,remembered,credential_version,revoked_at')
    .eq('token_hash', hashToken(token)).is('revoked_at', null).gt('expires_at', now).maybeSingle();
  if (error || !data) return { error: respond(401, { error: 'Session expired or revoked.' }) };
  if (data.absolute_expires_at && Date.parse(data.absolute_expires_at) <= Date.parse(now)) return { error: respond(401, { error: 'Session expired or revoked.' }) };
  if (idleExpired(data)) return { error: respond(401, { error: 'Session expired or revoked.' }) };
  if (data.user_id) {
    const { data: user, error: userError } = await sb.from('practitioner_users').select('id,email,display_name,role,active,credential_version').eq('id', data.user_id).eq('active', true).single();
    if (userError || !user || user.role !== data.role || Number(user.credential_version) !== Number(data.credential_version)) return { error: respond(401, { error: 'Session expired or revoked.' }) };
    data.user = user;
  } else {
    const { data: credential, error: credentialError } = await sb.from('practitioner_credentials').select('version').eq('id', true).single();
    if (credentialError || !credential || Number(credential.version) !== Number(data.credential_version)) return { error: respond(401, { error: 'Session expired or revoked.' }) };
  }

  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const origin = String((event.headers && (event.headers.origin || event.headers.Origin)) || '');
    const allowed = String(process.env.SITE_URL || 'https://www.daronroyal.com').replace(/\/$/, '');
    if (origin && origin.replace(/\/$/, '') !== allowed) return { error: respond(403, { error: 'Origin not allowed.' }) };
  }
  if (options.touch !== false) sb.from('admin_sessions').update({ last_seen_at: now }).eq('id', data.id).then(() => {}).catch(() => {});
  return { user: { id: data.user?.id || null, email: data.user?.email || data.actor_email, displayName: data.user?.display_name || 'Daron Royal', role: data.user?.role || data.role || 'owner' }, sessionId: data.id, role: data.user?.role || data.role || 'owner' };
}

function respond(status, body, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://www.daronroyal.com',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    ...(options.headers || {}),
  };
  if (options.cookie) headers['Set-Cookie'] = options.cookie;
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

module.exports = { requireAdmin, respond, cookieValue, hashToken, sessionCookie, clearSessionCookie, COOKIE_NAME, SESSION_HOURS };
