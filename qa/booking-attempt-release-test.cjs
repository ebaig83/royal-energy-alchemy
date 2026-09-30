const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260930170000_booking_attempt_manual_release.sql');
const endpoint = read('netlify/functions/booking-attempt-release.js');
const model = read('netlify/functions/lib/p1-read-model.js');
const actions = read('dashboard-p1/actions.mjs');
const app = read('dashboard-p1/app.mjs');

assert.match(migration, /create or replace function public\.release_booking_attempt/);
assert.match(migration, /status='withdrawn'/);
assert.match(migration, /status='released',released_at/);
assert.match(migration, /booking_recovery_events/);
assert.match(migration, /revoked_at=coalesce/);
assert.match(migration, /Confirmed or paid booking attempts cannot be released here/);
assert.match(migration, /s\.status='booked' and s\.session_id is null/);
assert.match(migration, /r\.status='active'/);
assert.match(migration, /stale_slot_released/);
assert.doesNotMatch(migration, /update public\.booking_attempts set[\s\S]{0,300}payment_status\s*=/i);

assert.match(endpoint, /requireAdmin/);
assert.match(endpoint, /body\.confirmed !== true/);
assert.match(endpoint, /release_booking_attempt/);
assert.match(endpoint, /p_request_id/);
assert.match(endpoint, /Confirmed or paid appointments must use the normal appointment workflow/);

assert.match(model, /withdrawn_at/);
assert.match(model, /recovery_1_scheduled_at/);
assert.match(actions, /export function releaseBookingAttempt/);
assert.match(actions, /booking-attempt-release/);
assert.match(actions, /Confirm Cancel \/ Release/);
assert.match(app, /data-booking-attempt-action/);
assert.match(app, /Cancel \/ Release/);
assert.match(app, /payment_status!=='paid'/);
assert.match(app, /Incomplete Bookings/);

console.log('booking-attempt release contract tests passed');
