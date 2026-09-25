'use strict';

const assert = require('node:assert/strict');
const token = require('../netlify/functions/lib/appointment-token');

process.env.APPOINTMENT_ACTION_SECRET = 'synthetic-only-secret-for-management-tests-2026';

const session = {
  id: 'f8c0ca10-b8ab-47d5-993b-af7ad0bae295',
  client_id: 'e29d1f99-5939-4979-bd3f-7f9289f11320',
  client_name: 'Synthetic Client',
  client_email: 'synthetic@example.invalid',
  created_at: '2026-09-23T12:00:00.000Z',
  session_date: '2099-10-05',
  session_time: '10:00:00',
  status: 'confirmed',
  payment_status: 'paid',
  booking_status: 'confirmed',
  service: 'Synthetic test session',
  source: 'website',
  duration_minutes: 60,
};

const rpcCalls = [];
const fakeSupabase = {
  from(table) {
    assert.equal(table, 'sessions');
    const query = {
      select() { return query; },
      eq() { return query; },
      single: async () => ({ data: session, error: null }),
      maybeSingle: async () => ({ data: session, error: null }),
    };
    return query;
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    return { data: { session: { ...session, status: 'cancelled' }, correlation_id: args.p_correlation }, error: null };
  },
};

const supabaseModule = require('../netlify/functions/lib/supabase');
supabaseModule.getClient = () => fakeSupabase;
const { handler } = require('../netlify/functions/manage-appointment');

function eventFor(actionToken, body = {}) {
  return {
    httpMethod: 'POST',
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ session_id: session.id, action: 'cancel_confirmed', token: actionToken,
      reason: 'synthetic test', actor_type: 'practitioner', actor_id: 'spoofed',
      actor_email: 'spoofed@example.invalid', ...body }),
  };
}

async function main() {
  const valid = token.createAppointmentToken(session.id, 'manage');
  const response = await handler(eventFor(valid));
  assert.equal(response.statusCode, 200);
  assert.equal(rpcCalls.length, 1);
  const call = rpcCalls[0];
  assert.equal(call.name, 'practitioner_appointment_change');
  assert.equal(call.args.p_actor_type, 'client');
  assert.equal(call.args.p_actor_id, session.client_id);
  assert.equal(call.args.p_actor_email, session.client_email);
  assert.equal(call.args.p_source, 'manage_appointment');
  assert.equal(call.args.p_request_path, '/.netlify/functions/manage-appointment');
  assert.match(call.args.p_correlation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const altered = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');
  const expired = token.createAppointmentToken(session.id, 'manage', { now: 1000, ttlSeconds: 30 });
  const wrongSession = token.createAppointmentToken('another-synthetic-session', 'manage');
  for (const invalid of [altered, expired, wrongSession]) {
    const rejected = await handler(eventFor(invalid));
    assert.equal(rejected.statusCode, 401);
  }
  assert.equal(rpcCalls.length, 1, 'invalid tokens must not reach the audited RPC');
  console.log(JSON.stringify({
    result: 'passed',
    rpc: call.name,
    actor: call.args.p_actor_type,
    actor_id: call.args.p_actor_id,
    source: call.args.p_source,
    correlation_id: call.args.p_correlation,
    invalid_token_cases: 3,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
