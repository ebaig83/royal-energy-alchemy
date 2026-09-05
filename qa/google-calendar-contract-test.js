'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const g = require('../netlify/functions/lib/google-calendar');

const base = { id: 'session-1', session_date: '2099-09-01', session_time: '10:00:00', duration_minutes: 60, location_type: 'distance', service: 'Energy Session', status: 'confirmed' };
const readyEvent = id => ({ id, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } });

async function run() {
  let passed = 0;
  const check = (value, message) => { assert(value, message); passed += 1; };
  check(g.eligibleSession(base), 'remote session eligible');
  check(!g.eligibleSession({ ...base, location_type: 'in_person' }), 'in-person excluded');
  check(g.requestId('abc') === 'rea-session-abc', 'deterministic conference id');
  check(g.eventId('abc') === g.eventId('abc') && /^[a-v0-9]+$/.test(g.eventId('abc')), 'deterministic valid event id');
  check(g.meetUrl(readyEvent('e1')) === 'https://meet.google.com/abc-defg-hij', 'valid Meet extracted');
  check(g.meetUrl({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://evil.test/meet' }] } }) === null, 'malformed/non-Google URL rejected');
  const body = g.eventBody(base);
  check(body.id === g.eventId(base.id) && body.conferenceData.createRequest.requestId === g.requestId(base.id), 'event and conference are idempotent');
  check(!JSON.stringify(body).match(/payment|waiver|intake|assessment|health|notes/i), 'event omits sensitive fields');

  let creates = 0;
  let result = await g.syncSession(base, { create: async b => { creates += 1; return readyEvent(b.id); }, get: async () => { throw new Error('unexpected get'); } });
  check(result.status === 'ready' && creates === 1 && result.operation === 'create', 'event and Meet created once');

  const delayed = [];
  result = await g.syncSession(base, { create: async b => ({ id: b.id }), get: async id => { delayed.push(id); return delayed.length === 2 ? readyEvent(id) : { id }; } }, { attempts: 3, delayMs: 0, sleep: async () => {} });
  check(result.status === 'ready' && delayed.length === 2, 'delayed Meet readiness polled');

  let recovered = 0;
  result = await g.syncSession(base, { create: async () => { const e = new Error('duplicate'); e.status = 409; throw e; }, get: async id => { recovered += 1; return readyEvent(id); } });
  check(result.status === 'ready' && recovered === 1 && result.eventId === g.eventId(base.id), 'create retry recovers deterministic event');

  let updatedBody = null;
  result = await g.syncSession({ ...base, google_calendar_event_id: 'stored-event', google_meet_url: 'https://meet.google.com/abc-defg-hij', google_calendar_status: 'reschedule_pending' }, { update: async (id, b) => { updatedBody = b; return readyEvent(id); }, get: async () => readyEvent('stored-event') });
  check(result.operation === 'update' && result.eventId === 'stored-event' && !updatedBody.conferenceData, 'reschedule updates exact event and preserves conference');

  let deleted = null;
  result = await g.syncSession({ ...base, status: 'cancelled', google_calendar_event_id: 'stored-event', google_calendar_status: 'cancel_pending' }, { delete: async id => { deleted = id; } });
  check(result.status === 'cancelled' && deleted === 'stored-event', 'cancellation deletes exact stored event');

  result = await g.syncSession({ ...base, location_type: 'in_person', google_meet_url: 'https://zoom.us/j/123' }, {});
  check(result.status === 'not_requested' && result.meetUrl === 'https://zoom.us/j/123', 'manual fallback preserved for excluded session');

  const oldEnv = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = 'client.test'; process.env.GOOGLE_CLIENT_SECRET = 'secret.test'; process.env.GOOGLE_REFRESH_TOKEN = 'refresh.test'; process.env.GOOGLE_CALENDAR_ID = 'primary';
  g._resetTokenCache(); let tokenCalls = 0;
  const tokenFetch = async (_url, opts) => { tokenCalls += 1; check(!String(opts.headers?.Authorization || '').includes('refresh.test'), 'refresh token not put in authorization header'); return { ok: true, status: 200, json: async () => ({ access_token: 'access.test', expires_in: 3600 }) }; };
  await g.refreshAccessToken({ fetchImpl: tokenFetch, now: 1000 }); await g.refreshAccessToken({ fetchImpl: tokenFetch, now: 2000 });
  check(tokenCalls === 1, 'access token cached safely until near expiry');
  g._resetTokenCache(); let transportCalls = 0;
  const retryFetch = async url => { transportCalls += 1; if (url.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'access.test', expires_in: 3600 }) }; if (transportCalls === 2) return { ok: false, status: 500, json: async () => ({ error: { status: 'UNAVAILABLE' } }) }; return { ok: true, status: 200, json: async () => readyEvent('e-retry') }; };
  const transport = g.createGoogleCalendarApi({ fetchImpl: retryFetch, retries: 1, sleep: async () => {} });
  check((await transport.get('e-retry')).id === 'e-retry' && transportCalls === 3, 'retryable Google API errors are bounded and retried');
  g._resetTokenCache(); let permanent = null;
  const badFetch = async url => url.includes('/token') ? { ok: true, status: 200, json: async () => ({ access_token: 'access.test', expires_in: 3600 }) } : { ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED' } }) };
  try { await g.createGoogleCalendarApi({ fetchImpl: badFetch, retries: 2 }).get('e-denied'); } catch (error) { permanent = error; }
  check(permanent?.status === 403 && permanent.retryable === false, 'permanent Google API errors are classified without retry loop');
  process.env = oldEnv; g._resetTokenCache();

  check(!g.sanitizeError(new Error('access_token=abc refresh_token=def Bearer ghi')).match(/abc|def|ghi/), 'credential values redacted');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  check(!dashboard.includes('google.accounts.oauth2.initTokenClient') && !dashboard.includes('www.googleapis.com/calendar/v3'), 'browser OAuth and Calendar writes retired');
  check(dashboard.includes('retry_google_sync') && dashboard.includes('JOIN GOOGLE MEET'), 'dashboard exposes Meet and authenticated retry UX');
  console.log(`google-calendar-contract-test: ${passed}/${passed} passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
