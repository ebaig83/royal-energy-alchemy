const assert = require('node:assert/strict');
const { staleness, sanitizeAgentUpdate } = require('../netlify/functions/lib/agent-telemetry');

assert.equal(staleness(null).label, 'No heartbeat');
assert.equal(staleness(new Date(Date.now() - 10 * 60000)).label, 'Live/Recent');
assert.equal(staleness(new Date(Date.now() - 30 * 60000)).label, 'Stale');
assert.equal(staleness(new Date(Date.now() - 90 * 60000)).label, 'No recent heartbeat');
assert.throws(() => sanitizeAgentUpdate({ status: 'working', current_task_summary: 'Inspect UI', manager_review_status: 'approved' }, 'builder'), /Manager-owned field/);
assert.equal(sanitizeAgentUpdate({ status: 'working', current_task_summary: 'Inspect UI' }, 'builder').status, 'working');
assert.throws(() => sanitizeAgentUpdate({ status: 'healthy' }, 'builder'), /Invalid agent status/);
assert.equal(sanitizeAgentUpdate({ release_approval: 'approved', daron_status: 'Ready' }, 'manager').release_approval, 'approved');
console.log('agent operations telemetry contract: ok');
