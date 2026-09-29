const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260929100000_website_booking_finalization_invariant.sql'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'netlify/functions/stripe-webhook.js'), 'utf8');
const waiver = fs.readFileSync(path.join(root, 'netlify/functions/booking-waiver.js'), 'utf8');
const monitor = fs.readFileSync(path.join(root, 'netlify/functions/website-booking-consistency.js'), 'utf8');

assert.match(migration, /trusted_session_update_with_audit_legacy_text/);
assert.match(migration, /Website finalization invariant requires booking_status=confirmed/);
assert.match(migration, /Website finalization requires canonical client email and phone/);
assert.match(migration, /create trigger website_booking_finalization_invariant/);
assert.match(migration, /repair_website_booking_finalization/);
assert.match(migration, /website_booking_consistency_check/);
assert.match(webhook, /process_stripe_webhook_event_with_audit/);
assert.match(waiver, /trusted_session_update_with_audit/);
assert.match(monitor, /website_booking_consistency_check/);
assert.match(monitor, /read_only: true/);
console.log('website booking finalization invariant contract: ok');
