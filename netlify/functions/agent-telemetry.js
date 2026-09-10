'use strict';
const { respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { identity, sanitizeAgentUpdate } = require('./lib/agent-telemetry');

exports.handler = async event => {
  if (String(event.httpMethod || '').toUpperCase() !== 'PATCH') return respond(405, { error: 'Telemetry self-update requires PATCH.' });
  const actor = identity(event);
  if (!actor) return respond(401, { error: 'Agent telemetry authorization failed.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  const requestedKey = String(body.agent_key || '').trim().toLowerCase();
  if (!requestedKey || requestedKey !== actor.key) return respond(403, { error: 'Agents may update only their own telemetry row.' });
  try {
    const updates = sanitizeAgentUpdate(body, actor.role);
    const result = await getClient().from('agent_status').update(updates).eq('agent_key', actor.key).select('agent_key').single();
    if (result.error) throw result.error;
    return respond(200, { ok: true, agentKey: actor.key });
  } catch (error) { return respond(400, { error: error.message === 'Invalid agent status.' ? error.message : 'Telemetry update rejected.' }); }
};
