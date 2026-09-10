const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'dashboard-p1', 'app.mjs'), 'utf8');
const view = fs.readFileSync(path.join(root, 'dashboard-p1', 'agent-operations.mjs'), 'utf8');

assert.match(app, /agentOperationsNavObserver/);
assert.match(app, /data-agent-operations-nav/);
assert.match(app, /id="agent-operations-panel"/);
assert.match(app, /href="#agent-operations"/);
assert.match(app, /showAgentOperationsPage/);
assert.doesNotMatch(app, /href="#system" data-agent-operations-nav/);
assert.match(view, /agent-operations/);
assert.match(view, /Live, sanitized Manager telemetry/);
assert.match(view, /Live\/Recent/);
assert.match(view, /Stale/);
assert.match(view, /No heartbeat/);
assert.match(view, /agent-operations-refresh/);
assert.match(view, /agent-operations/);
assert.match(view, /fetch\('\/.netlify\/functions\/agent-operations'/);
assert.match(view, /Agent status temporarily unavailable/);
assert.match(view, /credentials:'same-origin'/);
assert.match(view, /Manager Communication/);
assert.match(view, /managerCommunication/);
assert.match(view, /agent-manager-message/);
assert.match(view, /method:'PATCH'/);
assert.match(view, /action/);
assert.doesNotMatch(view, /method:'POST'/);
assert.doesNotMatch(view, /method:'DELETE'/);
assert.doesNotMatch(view, /x-agent-telemetry-token|client_email|payment/);

console.log('agent operations read-only UI contract: ok');
