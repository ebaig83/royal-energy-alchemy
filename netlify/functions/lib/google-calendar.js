'use strict';

const crypto = require('crypto');
const { isCalendarEligible } = require('./record-policy');
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TIMEZONE = process.env.DASHBOARD_TIMEZONE || 'America/New_York';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_URL = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;
let cachedToken = null;

class GoogleCalendarError extends Error {
  constructor(message, { status = 0, code = 'google_calendar_error', retryable = false } = {}) {
    super(message); this.name = 'GoogleCalendarError'; this.status = status; this.code = code; this.retryable = retryable;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new GoogleCalendarError(`Google Calendar configuration is incomplete (${name})`, { code: 'configuration_error' });
  return value;
}

async function jsonFetch(url, options, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    let payload = null; try { payload = await response.json(); } catch { payload = null; }
    return { response, payload };
  } catch (error) {
    if (error?.name === 'AbortError') throw new GoogleCalendarError('Google request timed out', { code: 'timeout', retryable: true });
    throw new GoogleCalendarError('Google request failed', { code: 'network_error', retryable: true });
  } finally { clearTimeout(timer); }
}

async function exchangeAuthorizationCode(code, { fetchImpl = fetch, timeoutMs } = {}) {
  if (!code) throw new GoogleCalendarError('Google authorization code is required', { code: 'authorization_error' });
  const { response, payload } = await jsonFetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: requiredEnv('GOOGLE_CLIENT_ID'), client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'), redirect_uri: requiredEnv('GOOGLE_OAUTH_REDIRECT_URI'), grant_type: 'authorization_code' }),
  }, { fetchImpl, timeoutMs });
  if (!response.ok || !payload?.refresh_token) throw new GoogleCalendarError('Google authorization did not return a refresh token', { status: response.status, code: 'authorization_error' });
  return { refreshToken: payload.refresh_token, expiresIn: payload.expires_in || null };
}

async function refreshAccessToken({ fetchImpl = fetch, timeoutMs, now = Date.now() } = {}) {
  if (cachedToken && cachedToken.expiresAt - 60000 > now) return { accessToken: cachedToken.value, expiresIn: Math.max(0, Math.floor((cachedToken.expiresAt - now) / 1000)) };
  const { response, payload } = await jsonFetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: requiredEnv('GOOGLE_CLIENT_ID'), client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'), refresh_token: requiredEnv('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  }, { fetchImpl, timeoutMs });
  if (!response.ok || !payload?.access_token) throw new GoogleCalendarError('Google access-token refresh failed', { status: response.status, code: response.status === 400 || response.status === 401 ? 'authorization_error' : 'token_refresh_error', retryable: response.status === 429 || response.status >= 500 });
  const expiresIn = Number(payload.expires_in || 3600);
  cachedToken = { value: payload.access_token, expiresAt: now + expiresIn * 1000 };
  return { accessToken: payload.access_token, expiresIn };
}

function eligibleSession(session) {
  return isCalendarEligible(session);
}
function requestId(sessionId) { return `rea-session-${String(sessionId)}`; }
function eventId(sessionId) { return `rea${crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 28)}`; }
function sanitizeError(error) {
  return String(error?.message || error || 'Google Calendar error')
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|code)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}
function meetUrl(event) {
  const points = event?.conferenceData?.entryPoints;
  const video = Array.isArray(points) && points.find(p => p.entryPointType === 'video' && /^https:\/\/meet\.google\.com\/[a-z0-9-]+\/?$/i.test(p.uri || ''));
  return video?.uri || null;
}
function eventBody(session, { includeConference = true, includeId = true } = {}) {
  const start = `${session.session_date}T${String(session.session_time).slice(0, 8)}`;
  const wallClockStart = new Date(`${start}Z`);
  const body = {
    summary: `Royal Energy Alchemy — ${session.service || 'Session'}`,
    start: { dateTime: start, timeZone: TIMEZONE },
    end: { dateTime: new Date(wallClockStart.getTime() + Number(session.duration_minutes || 60) * 60000).toISOString().slice(0, 19), timeZone: TIMEZONE },
    extendedProperties: { private: { reaSessionId: String(session.id) } },
  };
  if (includeId) body.id = eventId(session.id);
  if (includeConference) body.conferenceData = { createRequest: { requestId: requestId(session.id), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  return body;
}

function createGoogleCalendarApi({ fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const calendarId = encodeURIComponent(requiredEnv('GOOGLE_CALENDAR_ID'));
  async function request(method, path, body, attempt = 0) {
    const { accessToken } = await refreshAccessToken({ fetchImpl, timeoutMs });
    const { response, payload } = await jsonFetch(`${GOOGLE_CALENDAR_URL}/calendars/${calendarId}/events${path}`, {
      method, headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, { fetchImpl, timeoutMs });
    if (response.ok) return payload || {};
    if (response.status === 401 && attempt === 0) { cachedToken = null; return request(method, path, body, attempt + 1); }
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) { await sleep(Math.min(250 * 2 ** attempt, 1000)); return request(method, path, body, attempt + 1); }
    const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || 'google_api_error';
    throw new GoogleCalendarError(`Google Calendar API request failed (${response.status})`, { status: response.status, code: reason, retryable });
  }
  return {
    get: id => request('GET', `/${encodeURIComponent(id)}?conferenceDataVersion=1`),
    create: body => request('POST', '?conferenceDataVersion=1&sendUpdates=none', body),
    update: (id, body) => request('PATCH', `/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=none`, body),
    delete: id => request('DELETE', `/${encodeURIComponent(id)}?sendUpdates=none`),
  };
}

async function pollForMeet(api, initialEvent, { attempts = 3, delayMs = 250, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let event = initialEvent;
  for (let attempt = 0; attempt < attempts && event?.id && !meetUrl(event); attempt += 1) { await sleep(delayMs); event = await api.get(event.id); }
  return event;
}

async function syncSession(session, api, options = {}) {
  if (String(session?.status || '').toLowerCase() === 'cancelled' || session?.google_calendar_status === 'cancel_pending') {
    if (session.google_calendar_event_id) {
      try { await api.delete(session.google_calendar_event_id); } catch (error) { if (error?.status !== 404 && error?.status !== 410) throw error; }
    }
    const cancelled = String(session?.status || '').toLowerCase() === 'cancelled';
    return { status: cancelled ? 'cancelled' : 'not_requested', eventId: null, meetUrl: cancelled ? null : (session?.video_link || null), operation: 'cancel' };
  }
  if (!eligibleSession(session)) return { status: 'not_requested', eventId: session?.google_calendar_event_id || null, meetUrl: session?.google_meet_url || null, operation: 'skip' };
  let event; let operation;
  if (session.google_calendar_event_id) {
    operation = 'update'; event = await api.update(session.google_calendar_event_id, eventBody(session, { includeConference: false, includeId: false }));
  } else {
    operation = 'create';
    try { event = await api.create(eventBody(session)); }
    catch (error) { if (error?.status !== 409) throw error; event = await api.get(eventId(session.id)); }
  }
  if (!meetUrl(event)) event = await pollForMeet(api, event, options);
  const url = meetUrl(event);
  return { status: url ? 'ready' : 'pending', eventId: event.id || session.google_calendar_event_id || eventId(session.id), meetUrl: url || session.google_meet_url || null, operation };
}
function _resetTokenCache() { cachedToken = null; }

module.exports = { CALENDAR_SCOPE, TIMEZONE, GoogleCalendarError, eligibleSession, requestId, eventId, sanitizeError, meetUrl, eventBody, pollForMeet, syncSession, exchangeAuthorizationCode, refreshAccessToken, createGoogleCalendarApi, _resetTokenCache };
