const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'dashboard-p1', 'app.mjs'), 'utf8');
const view = fs.readFileSync(path.join(root, 'dashboard-p1', 'agent-operations.mjs'), 'utf8');

assert.match(app, /agentOperationsNavObserver/);
assert.match(app, /data-agent-operations-nav/);
assert.match(app, /id="agent-operations-panel"/);
assert.match(view, /Website Agent/);
assert.match(view, /Dashboard Agent/);
assert.match(view, /Manager Agent/);
assert.doesNotMatch(view, /fetch\(|\.netlify\/functions|PATCH|POST|DELETE/);

console.log('agent operations read-only UI contract: ok');
