'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260925020420_correlation_id_normalization.sql'), 'utf8');
const stripeSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql'), 'utf8');
const mailer = fs.readFileSync(path.join(root, 'netlify/functions/lib/mailer.js'), 'utf8');
const comms = fs.readFileSync(path.join(root, 'netlify/functions/lib/comms.js'), 'utf8');
const stripe = fs.readFileSync(path.join(root, 'netlify/functions/stripe-webhook.js'), 'utf8');
const sendEmail = fs.readFileSync(path.join(root, 'netlify/functions/send-email.js'), 'utf8');
const { correlationUuid } = require('../netlify/functions/lib/mailer')._test;

const legacyTables = [
  'payments', 'payment_mutation_audit', 'appointment_action_audit', 'appointment_notices',
  'cancellation_requests', 'payment_reconciliation_audit', 'session_outcomes', 'stripe_webhook_events',
  'communications', 'transactional_notifications',
];
for (const table of legacyTables) {
  assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists correlation_uuid uuid`, 'i'));
}

assert.match(migration, /correlation_uuid\s*=\s*correlation_id::uuid[\s\S]*correlation_id\s*~\*/i, 'legacy text is only copied after UUID-shape validation');
assert.doesNotMatch(migration, /alter\s+column\s+correlation_id\s+type\s+uuid/i, 'legacy values are not destructively cast');
assert.match(migration, /add column if not exists stripe_event_id text/i);
assert.match(migration, /regexp_replace\(r\.args,.*p_correlation_id\|p_correlation.*uuid/s);
assert.match(migration, /sync_legacy_correlation_uuid/i);

for (const tableName of ['communications', 'transactional_notifications']) {
  assert.match(mailer, new RegExp(`correlation_uuid:\\s+correlationId`), `${tableName} rows receive a UUID correlation`);
}
assert.match(mailer, /Communication correlation ID must be a UUID/);
assert.match(comms, /correlation_uuid: correlation_id/);
assert.match(sendEmail, /correlation_uuid:\s+entry\.correlation_id/);
assert.match(stripe, /stripe_event_id: eventId/);
assert.match(stripe, /correlation_id: session\.correlation_id/);
assert.doesNotMatch(stripe, /correlation_id:\s*eventId/);
assert.match(stripeSql, /correlation_uuid\s*=\s*v_correlation_id/i);

const id = 'a9a7fce0-4f89-4cf1-92cc-22996dd9a302';
assert.equal(correlationUuid({ correlationId: id }), id);
assert.throws(() => correlationUuid({ correlationId: 'legacy:event:123' }), /must be a UUID/);
assert.match(correlationUuid({}), /^[0-9a-f]{8}-[0-9a-f-]{27}$/i, 'missing IDs are generated server-side');

console.log('Correlation UUID normalization and communication persistence contract passed.');
