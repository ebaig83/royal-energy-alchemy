import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../dashboard-p1/app.mjs', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../dashboard-p1/actions.mjs', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/practitioner-create-session.js', import.meta.url), 'utf8');

assert.match(app, /data-review-action=\"Add appointment\"/);
assert.match(app, /button\.dataset\.reviewAction==='Add appointment'/);
assert.match(app, /addAppointment\(data\.clients,openDialog,start\)/);
assert.match(actions, /id=\"add-appointment\"/);
assert.match(actions, /call\('availability\?date='/);
assert.match(actions, /call\('practitioner-create-session','POST'/);
assert.match(actions, /credentials:'same-origin'/);
assert.match(endpoint, /requireAdmin\(event\)/);
assert.match(endpoint, /slot\.status !== 'available'/);
assert.match(endpoint, /findSessionConflicts/);
assert.match(endpoint, /google_calendar_status: 'not_requested'/);
assert.match(endpoint, /source: 'manual_practitioner'/);
assert.match(endpoint, /eq\('status', 'available'\)\.is\('session_id', null\)/);
assert.match(endpoint, /duplicate: true/);
assert.doesNotMatch(actions, /fetch\([^)]*method:['\"](PUT|PATCH|DELETE)/);

console.log('PASS practitioner add appointment flow contract');
