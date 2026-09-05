'use strict';

const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { log } = require('./lib/audit');
const { requireAdmin, respond, cookieValue, hashToken, sessionCookie, clearSessionCookie, SESSION_HOURS } = require('./lib/auth');

const MAX_ATTEMPTS = 5;
const WINDOW_SECS = 900;
function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

exports.handler = async event => {
  try {
    const sb = getClient();
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'GET') {
      const auth = await requireAdmin(event);
      return auth.error || respond(200, { authenticated: true, expires_in_hours: SESSION_HOURS });
    }
    if (method === 'DELETE') {
      const token = cookieValue(event);
      if (token) await sb.from('admin_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hashToken(token));
      return respond(200, { logged_out: true }, { cookie: clearSessionCookie() });
    }
    if (method !== 'POST') return respond(405, { error: 'Method not allowed.' });

    const ip = ((event.headers && event.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'unknown';
    const windowStart = new Date(Date.now() - WINDOW_SECS * 1000).toISOString();
    const { count } = await sb.from('audit_logs').select('id', { count: 'exact', head: true })
      .eq('action', 'pin_attempt_failed').eq('ip_address', ip).gte('created_at', windowStart);
    if (count >= MAX_ATTEMPTS) return respond(429, { error: 'Too many attempts. Try again later.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Bad request.' }); }
    if (!sameSecret(body.pin, process.env.DASHBOARD_PIN)) {
      await log({ actor: 'anonymous', action: 'pin_attempt_failed', tableName: 'auth', ip });
      return respond(401, { error: 'Invalid PIN.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
    const { error } = await sb.from('admin_sessions').insert({
      token_hash: hashToken(token), actor_email: process.env.ADMIN_EMAIL || 'admin', expires_at: expiresAt,
      ip_address: ip, user_agent: String((event.headers && event.headers['user-agent']) || '').slice(0, 500),
    });
    if (error) return respond(500, { error: 'Could not create an administrator session.' });
    await sb.from('admin_sessions').delete().lt('expires_at', new Date(Date.now() - 86400000).toISOString());
    return respond(200, { success: true, expires_at: expiresAt }, { cookie: sessionCookie(token) });
  } catch (_) { return respond(400, { error: 'Bad request.' }); }
};
