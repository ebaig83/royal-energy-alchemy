'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { identity, AGENTS } = require('./lib/agent-telemetry');
const { getClient } = require('./lib/supabase');
const { sanitizeMessage, publicMessage, acknowledgeMessage } = require('./lib/agent-manager-messages');

function header(event, name) {
  return String((event.headers && (event.headers[name] || event.headers[name.toLowerCase()])) || '');
}

function authorizationDiagnostic(event) {
  const key = header(event, 'x-agent-key').trim().toLowerCase();
  const token = header(event, 'x-agent-telemetry-token');
  const authorization = header(event, 'authorization');
  const agent = AGENTS[key];
  let reason = 'manager_token_mismatch';
  if (!key && !token && !authorization) reason = 'authorization_header_missing';
  else if (!agent) reason = 'agent_identity_not_manager';
  else if (!token) reason = authorization ? 'authorization_scheme_invalid' : 'authorization_header_missing';
  else if (!process.env[agent.env]) reason = agent.key === 'manager' ? 'manager_token_missing' : 'agent_token_missing';
  return {
    envPresence: Object.fromEntries(Object.entries(AGENTS).map(([agentKey, config]) => [config.env, Boolean(process.env[config.env])])),
    detectedScheme: token ? 'x-agent-key + x-agent-telemetry-token' : authorization ? 'authorization' : 'none',
    resolvedAgent: agent ? key : null,
    reason,
  };
}

exports.handler = async event => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'POST') {
    const actor = identity(event);
    if (!actor || actor.role !== 'manager') return respond(actor ? 403 : 401, { error: 'Manager authorization required.', diagnostics: authorizationDiagnostic(event) });
    try {
      const body = JSON.parse(event.body || '{}');
      const { data, error } = await getClient().from('agent_manager_messages').insert(sanitizeMessage(body)).select('id,subject,message_body,category,priority,created_at,read_at,acknowledged_at,related_commit,related_deploy_id,is_active').single();
      if (error) throw error;
      return respond(201, { ok: true, message: publicMessage(data) });
    } catch (error) {
      return respond(400, { error: error.message === 'Manager message fields are invalid.' ? error.message : 'Manager message was not created.' });
    }
  }
  if (method === 'PATCH') {
    const auth = await requireAdmin(event, { touch: false });
    if (auth.error) return auth.error;
    try {
      const body = JSON.parse(event.body || '{}');
      return respond(200, { ok: true, message: await acknowledgeMessage(body.id, body.action) });
    } catch { return respond(400, { error: 'Message acknowledgement was not accepted.' }); }
  }
  return respond(405, { error: 'Unsupported Manager Communication method.' });
};
