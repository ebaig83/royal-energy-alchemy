'use strict';

const crypto = require('crypto');
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  const value = process.env.APPOINTMENT_ACTION_SECRET;
  if (!value || value.length < 32) throw new Error('Appointment action-token configuration is incomplete.');
  return value;
}
function b64(value) { return Buffer.from(value).toString('base64url'); }
function sign(input) { return crypto.createHmac('sha256', secret()).update(input).digest('base64url'); }

function createAppointmentToken(sessionId, scope = 'manage', options = {}) {
  if (!sessionId) throw new Error('sessionId is required.');
  const now = Number(options.now || Math.floor(Date.now() / 1000));
  const payload = b64(JSON.stringify({ sid: String(sessionId), scope, iat: now, exp: now + Number(options.ttlSeconds || DEFAULT_TTL_SECONDS) }));
  return `${payload}.${sign(payload)}`;
}

function verifyAppointmentToken(token, sessionId, action = 'view', options = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return { ok: false, reason: 'missing' };
    const expected = Buffer.from(sign(parts[0]));
    const actual = Buffer.from(parts[1]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { ok: false, reason: 'tampered' };
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const now = Number(options.now || Math.floor(Date.now() / 1000));
    if (payload.sid !== String(sessionId || '')) return { ok: false, reason: 'wrong_session' };
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return { ok: false, reason: 'expired' };
    const allowed = payload.scope === 'manage' || payload.scope === action || (payload.scope === 'reschedule' && action === 'view') || (payload.scope === 'cancel' && action === 'view');
    return allowed ? { ok: true, payload } : { ok: false, reason: 'wrong_scope' };
  } catch (_) { return { ok: false, reason: 'invalid' }; }
}

function canonicalSiteOrigin(options = {}) {
  const hasExplicitSiteUrl = Object.prototype.hasOwnProperty.call(options, 'siteUrl');
  const raw = hasExplicitSiteUrl ? options.siteUrl : (process.env.SITE_URL || 'https://www.daronroyal.com');
  if (raw == null || !String(raw).trim()) throw new Error('Appointment management base URL is not configured.');
  let parsed;
  try { parsed = new URL(String(raw).trim()); } catch { throw new Error('Appointment management base URL is invalid.'); }
  const hostname = parsed.hostname.toLowerCase();
  const allowedHost = hostname === 'www.daronroyal.com' || hostname === 'daronroyal.com' || hostname.endsWith('.netlify.app');
  if (parsed.protocol !== 'https:' || !allowedHost || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('Appointment management base URL is invalid.');
  }
  return `https://${hostname}`;
}

function appointmentManageUrl(sessionId, options = {}) {
  if (sessionId == null || !String(sessionId).trim() || /\s/.test(String(sessionId))) throw new Error('sessionId is invalid.');
  const base = canonicalSiteOrigin(options);
  const token = createAppointmentToken(sessionId, options.scope || 'manage', options);
  const url = new URL('/manage-appointment.html', `${base}/`);
  url.searchParams.set('session_id', String(sessionId));
  url.searchParams.set('token', token);
  const result = url.href;
  if (!/^https:\/\/[^\s/]+\/manage-appointment\.html\?session_id=[^&]+&token=[^&]+$/.test(result)) throw new Error('Appointment management URL could not be constructed safely.');
  return result;
}

module.exports = { createAppointmentToken, verifyAppointmentToken, canonicalSiteOrigin, appointmentManageUrl, DEFAULT_TTL_SECONDS };
