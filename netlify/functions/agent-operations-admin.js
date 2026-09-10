'use strict';
const { respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { identity, sanitizeManagerUpdate } = require('./lib/agent-telemetry');

exports.handler = async event => {
  if (String(event.httpMethod || '').toUpperCase() !== 'PATCH') return respond(405, { error: 'Manager telemetry update requires PATCH.' });
  const actor = identity(event);
  if (!actor || actor.role !== 'manager') return respond(403, { error: 'Manager authorization required.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  try {
    const updates = sanitizeManagerUpdate(body);
    const sb = getClient();
    const agentUpdates = {};
    const stateUpdates = {};
    for (const [key, value] of Object.entries(updates)) (key === 'manager_review_status' || key === 'production_status' ? agentUpdates : stateUpdates)[key] = value;
    if (Object.keys(agentUpdates).length) {
      const result = await sb.from('agent_status').update(agentUpdates).eq('agent_key', 'manager').select('agent_key').single();
      if (result.error) throw result.error;
    }
    if (Object.keys(stateUpdates).length) {
      const result = await sb.from('agent_operations_state').update(stateUpdates).eq('state_key', 'current').select('state_key').single();
      if (result.error) throw result.error;
    }
    return respond(200, { ok: true, managerUpdate: true });
  } catch { return respond(400, { error: 'Manager telemetry update rejected.' }); }
};
