'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const worker = read('netlify/functions/reminder.js');
const sessions = read('netlify/functions/sessions.js');
const comms = read('netlify/functions/lib/comms.js');
const migration = read('supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql');
const auditHelper = require('../netlify/functions/lib/appointment-audit');

assert.equal(typeof auditHelper.reminderCorrelationId, 'function');
const fixture = { id: 'session_fixture', session_date: '2026-10-03', session_time: '14:00:00' };
assert.equal(auditHelper.reminderCorrelationId(fixture), auditHelper.reminderCorrelationId(fixture), 'retry correlation should be stable');

const manual = sessions.slice(sessions.indexOf("if (body.action === 'reminder')"), sessions.indexOf('// ── RESCHEDULE action'));
const checks = [
  ['worker marker mutation goes through audited RPC', worker.includes("rpc('record_session_reminder_with_audit'") && !worker.includes(".from('sessions').update")],
  ['dashboard reminder marker mutation goes through audited RPC', manual.includes("rpc('record_session_reminder_with_audit'") && !manual.includes(".from('sessions').update")],
  ['worker identity is fixed server-side', worker.includes("p_actor_type: 'system'") && worker.includes("p_actor_id: 'reminder_worker'") && worker.includes("p_source: 'reminder_worker'")],
  ['dashboard actor derives from authenticated admin', manual.includes('p_actor_type: \'practitioner\'') && manual.includes('p_actor_id: auth.user.id') && manual.includes('p_actor_email: auth.user.email')],
  ['correlation ID is attached to worker communication', worker.includes('correlation_id: correlationId') && worker.includes('metadata: reminderMetadata')],
  ['correlation ID is attached to manual communication', manual.includes('correlation_id: correlationId') && manual.includes('metadata: { trigger: \'dashboard_manual_reminder\'')],
  ['communication helper persists metadata for consent and send paths', comms.includes('metadata,') && comms.includes('...(metadata || {})')],
  ['reminder state plus audit are inside one RPC transaction', migration.includes('create or replace function public.record_session_reminder_with_audit') && migration.includes('update public.sessions set reminder_sent=true') && migration.includes('insert into public.appointment_action_audit')],
  ['failed audit cannot be swallowed by worker marker', worker.includes('if (auditError) throw auditError')],
  ['manual reminder fails closed on audited-state failure', manual.includes('if (reminderError || !mutation?.session) return respond(500')],
  ['duplicate sends are guarded by communications and idempotency', worker.includes('already_logged_in_communications') && manual.includes('idempotencyKey: reminderKey')],
  ['RPC rejects spoofed actor/source combinations', migration.includes("p_actor_id is distinct from 'reminder_worker'") && migration.includes('Practitioner actor is not active')],
];
checks.forEach(([name, ok]) => { assert.ok(ok, name); console.log('PASS', name); });
console.log(`Reminder audited mutation: ${checks.length}/${checks.length} passed`);
