const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const token = require(path.join(root, 'netlify/functions/lib/appointment-token'));
const sync = read('netlify/functions/session-calendar-sync.js');
const communications = read('netlify/functions/session-communications.js');
const retryWorker = read('netlify/functions/meeting-ready-retry.js');
const renderer = require(path.join(root, 'netlify/functions/lib/email-render'));

process.env.APPOINTMENT_ACTION_SECRET = 'synthetic-only-appointment-secret-2026-long';
process.env.SITE_URL = 'https://www.daronroyal.com';
const sessionId = '4ccebd81-0d21-4c4b-a06f-3dbb20627621';
const url = token.appointmentManageUrl(sessionId, { now: 1700000000, ttlSeconds: 1800 });
const parsed = new URL(url);
assert.equal(parsed.origin, 'https://www.daronroyal.com');
assert.equal(parsed.pathname, '/manage-appointment.html');
assert.equal(parsed.searchParams.get('session_id'), sessionId);
assert.match(parsed.searchParams.get('token'), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.equal(token.verifyAppointmentToken(parsed.searchParams.get('token'), sessionId, 'view', { now: 1700000100 }).ok, true);
assert.throws(() => token.appointmentManageUrl(sessionId, { siteUrl: '' }), /base URL is not configured/);
assert.throws(() => token.appointmentManageUrl(sessionId, { siteUrl: 'javascript:alert(1)' }), /base URL is invalid/);
assert.throws(() => token.appointmentManageUrl(sessionId, { siteUrl: 'https://www.daronroyal.com bad' }), /base URL is invalid/);
assert.throws(() => token.appointmentManageUrl('', { siteUrl: 'https://www.daronroyal.com' }), /sessionId is invalid/);

const template = { name: 'session_google_meet_ready', subject: 'Ready', html_body: '<a href="{{google_meet_url}}">Meet</a><a href="{{manage_url}}">Manage</a>', text_body: '{{manage_url}}' };
const rendered = renderer.renderTemplate(template, { google_meet_url: 'https://meet.google.com/abc-defg-hij', manage_url: url });
assert.match(rendered.html, /https:\/\/www\.daronroyal\.com\/manage-appointment\.html/);
assert.throws(() => renderer.renderTemplate(template, { google_meet_url: 'https://meet.google.com/abc-defg-hij', manage_url: '' }), error => error.code === 'EMAIL_INVALID_URL');
assert.match(sync, /appointmentManageUrl\(session\.id\)/);
assert.match(sync, /manage_url:/);
assert.match(sync, /retryFailedMeetingReady/);
assert.match(sync, /error_code: 'EMAIL_INVALID_URL'/);
assert.match(sync, /google_calendar_status', 'ready'/);
assert.match(communications, /appointmentManageUrl\(session\.id\)/);
assert.match(communications, /manage_url:/);
assert.match(retryWorker, /retryFailedMeetingReady/);
assert.match(retryWorker, /It never calls Google Calendar/);

console.log('meeting-ready management URL tests passed');
