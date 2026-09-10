'use strict';

const crypto = require('crypto');
const { getClient } = require('./supabase');

const BUILDER_FIELDS = new Set([
  'last_heartbeat_at', 'current_task_summary', 'status',
  'latest_handoff_summary', 'blocker_summary', 'last_test_summary', 'last_agent_commit'
]);
const MANAGER_FIELDS = new Set([
  'manager_review_status', 'production_status', 'release_approval',
  'deploy_id', 'deploy_status', 'production_health_summary', 'final_blocker_summary', 'daron_status'
]);
const STATUSES = new Set(['idle', 'working', 'blocked', 'needs-review', 'complete']);
const AGENTS = {
  website: { name: 'REA Website Agent', branch: 'agent/website', env: 'AGENT_TELEMETRY_WEBSITE_TOKEN' },
  dashboard: { name: 'REA Dashboard Agent', branch: 'agent/dashboard', env: 'AGENT_TELEMETRY_DASHBOARD_TOKEN' },
  manager: { name: 'REA Manager Agent', branch: 'agent/manager', env: 'AGENT_TELEMETRY_MANAGER_TOKEN' },
};

function text(value, max = 500) {
  if (value === null || value === undefined) return null;
  const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}
function commit(value) {
  const clean = text(value, 64);
  return clean && /^[0-9a-f]{7,64}$/i.test(clean) ? clean : null;
}
function iso(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function header(event, name) {
  return String((event.headers && (event.headers[name] || event.headers[name.toLowerCase()])) || '');
}
function identity(event) {
  const key = header(event, 'x-agent-key').trim().toLowerCase();
  const agent = AGENTS[key];
  if (!agent || !constantTimeEqual(header(event, 'x-agent-telemetry-token'), process.env[agent.env])) return null;
  return { key, role: key === 'manager' ? 'manager' : 'builder', ...agent };
}
function sanitizeAgentUpdate(body, role) {
  const allowed = role === 'manager' ? new Set([...BUILDER_FIELDS, ...MANAGER_FIELDS]) : BUILDER_FIELDS;
  const supplied = Object.keys(body || {}).filter(key => key !== 'agent_key');
  if (role === 'builder' && supplied.some(key => !BUILDER_FIELDS.has(key))) throw new Error('Builder attempted to update a Manager-owned field.');
  const output = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!allowed.has(key)) continue;
    if (key === 'status') {
      if (!STATUSES.has(String(value))) throw new Error('Invalid agent status.');
      output[key] = String(value);
    } else if (key === 'last_agent_commit') output[key] = commit(value);
    else if (key === 'last_heartbeat_at') output[key] = iso(value);
    else output[key] = text(value, key.includes('summary') ? 500 : 160);
  }
  if (role === 'builder') {
    if (!Object.keys(output).length) throw new Error('No builder-editable telemetry fields supplied.');
  }
  return output;
}
function sanitizeManagerUpdate(body) {
  const output = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!MANAGER_FIELDS.has(key)) throw new Error('Manager update contains an unsupported field.');
    output[key] = text(value, key === 'daron_status' || key.includes('summary') ? 1000 : 160);
  }
  if (!Object.keys(output).length) throw new Error('No Manager-owned telemetry fields supplied.');
  return output;
}
function staleness(lastHeartbeat, now = new Date()) {
  if (!lastHeartbeat) return { label: 'No heartbeat', ageMinutes: null };
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - new Date(lastHeartbeat).getTime()) / 60000));
  return { label: ageMinutes <= 15 ? 'Live/Recent' : ageMinutes <= 60 ? 'Stale' : 'No recent heartbeat', ageMinutes };
}
function publicAgent(row, now) {
  return {
    agentKey: row.agent_key, agentName: row.agent_name, branch: row.branch,
    status: row.status, staleness: staleness(row.last_heartbeat_at, now),
    lastHeartbeatAt: row.last_heartbeat_at, currentTaskSummary: row.current_task_summary,
    latestHandoffSummary: row.latest_handoff_summary, blockerSummary: row.blocker_summary,
    lastTestSummary: row.last_test_summary, lastAgentCommit: row.last_agent_commit,
    managerReviewStatus: row.manager_review_status, productionStatus: row.production_status,
  };
}
async function readOperations() {
  const sb = getClient();
  const [{ data: agents, error: agentsError }, { data: state, error: stateError }] = await Promise.all([
    sb.from('agent_status').select('*').order('agent_key'),
    sb.from('agent_operations_state').select('*').eq('state_key', 'current').maybeSingle(),
  ]);
  if (agentsError) throw agentsError;
  if (stateError) throw stateError;
  const now = new Date();
  return {
    agents: (agents || []).map(row => publicAgent(row, now)),
    recentHandoffs: (agents || []).filter(row => row.latest_handoff_summary).map(row => ({ agentKey: row.agent_key, summary: row.latest_handoff_summary })),
    activeBlockers: (agents || []).filter(row => row.blocker_summary).map(row => ({ agentKey: row.agent_key, summary: row.blocker_summary })),
    approvalsPending: state?.release_approval === 'pending' ? 1 : 0,
    releaseAuthority: 'Manager Agent',
    daronStatus: state?.daron_status || 'No Manager Status has been published.',
    managerState: { releaseApproval: state?.release_approval || 'pending', deployStatus: state?.deploy_status || 'not-deployed', productionHealthSummary: state?.production_health_summary || null, finalBlockerSummary: state?.final_blocker_summary || null },
  };
}

module.exports = { AGENTS, BUILDER_FIELDS, MANAGER_FIELDS, STATUSES, identity, sanitizeAgentUpdate, sanitizeManagerUpdate, staleness, readOperations };
