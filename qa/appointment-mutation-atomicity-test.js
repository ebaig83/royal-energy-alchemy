'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { change } = require('../netlify/functions/lib/practitioner-appointments');
const sql = fs.readFileSync('supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql', 'utf8');

const atomicFunctions = [
  ['practitioner_appointment_change', /update public\.sessions[\s\S]*?insert into public\.appointment_notices[\s\S]*?insert into public\.appointment_action_audit/],
  ['practitioner_restore_appointment', /update public\.availability_slots[\s\S]*?update public\.sessions[\s\S]*?insert into public\.appointment_action_audit/],
  ['practitioner_update_session_with_audit', /update public\.sessions[\s\S]*?insert into public\.appointment_action_audit/],
  ['practitioner_create_appointment_with_audit', /insert into public\.sessions[\s\S]*?update public\.availability_slots[\s\S]*?insert into public\.appointment_action_audit/],
];
for (const [name, contract] of atomicFunctions) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = sql.indexOf('$function$;', sql.indexOf('as $function$', start) + 13);
  assert.notEqual(end, -1, `${name} function body terminates`);
  assert.match(sql.slice(start, end), contract, `${name} performs business write and audit in its function transaction`);
}

(async () => {
  let fromCalls = 0;
  let rpcCalls = 0;
  const sb = {
    from() { fromCalls += 1; throw new Error('no direct database writes allowed in caller'); },
    async rpc(name, params) {
      rpcCalls += 1;
      assert.equal(name, 'practitioner_appointment_change');
      assert.notEqual(params.p_request, params.p_correlation);
      return { data: null, error: { message: 'simulated transaction failure' } };
    },
  };
  const result = await change(sb,
    { id: 'session-1', status: 'confirmed', session_date: '2099-01-01', session_time: '11:00:00', source: 'manual_practitioner' },
    { action: 'cancel', confirmed: true, request_id: 'd2fe56f1-0ded-4572-a47f-9761a6548f55', expected_date: '2099-01-01', expected_time: '11:00:00' },
    { actor_type: 'practitioner', actor_id: 'admin-1', actor_email: 'practitioner@sample.org', source: 'dashboard', request_path: '/sessions' });
  assert.equal(result.statusCode, 409);
  assert.equal(rpcCalls, 1);
  assert.equal(fromCalls, 0, 'caller performs no post-RPC business/audit write after RPC failure');
  console.log('appointment mutation atomicity contract and fail-closed RPC error behavior passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
