const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'dashboard-p1', 'agent-operations.mjs'), 'utf8');

assert.match(view, /function validMessage/);
assert.match(view, /function validCommunication/);
assert.match(view, /Manager Communication/);
assert.match(view, /No Manager messages right now\./);
assert.match(view, /unreadCount/);
assert.match(view, /Recent communication history/);
assert.match(view, /Unread/);
assert.match(view, /Read/);
assert.match(view, /Acknowledged/);
assert.match(view, /data-manager-message-action="read"/);
assert.match(view, /data-manager-message-action="acknowledge"/);
assert.match(view, /body:JSON.stringify\(\{id,action\}\)/);
assert.match(view, /Manager communication temporarily unavailable/);
assert.match(view, /button\.disabled=false/);
assert.doesNotMatch(view, /data-manager-message-action="send"/);
assert.doesNotMatch(view, /data-manager-message-action="edit"/);
assert.doesNotMatch(view, /data-manager-message-action="delete"/);
assert.doesNotMatch(view, /AGENT_TELEMETRY_(WEBSITE|DASHBOARD|MANAGER)_TOKEN/);
assert.doesNotMatch(view, /service_role|client_email|payment_credentials|raw_prompt|chain.of.thought/);

console.log('Manager Communication UI contract: ok');
