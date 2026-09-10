const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(root, 'netlify', 'functions', 'agent-manager-message.js'), 'utf8');
const telemetry = fs.readFileSync(path.join(root, 'netlify', 'functions', 'lib', 'agent-telemetry.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '2026-09-09-agent-manager-messages.sql'), 'utf8');
const operations = fs.readFileSync(path.join(root, 'netlify', 'functions', 'agent-operations.js'), 'utf8');
const messages = require(path.join(root, 'netlify', 'functions', 'lib', 'agent-manager-messages.js'));

const valid = messages.sanitizeMessage({
  subject: 'Release update',
  message_body: 'The release is ready for review.',
  category: 'Release Update',
  priority: 'Normal',
  related_commit: '7655391',
  related_deploy_id: 'deploy-123',
});
assert.equal(valid.category, 'Release Update');
assert.equal(valid.priority, 'Normal');
assert.equal(valid.related_commit, '7655391');
assert.throws(() => messages.sanitizeMessage({ subject: 'x', message_body: 'y', category: 'Unknown', priority: 'Normal' }));
assert.match(endpoint, /method === 'POST'/);
assert.match(endpoint, /actor\.role !== 'manager'/);
assert.match(endpoint, /method === 'PATCH'/);
assert.match(endpoint, /requireAdmin/);
assert.match(endpoint, /acknowledgeMessage/);
assert.match(telemetry, /readManagerMessages/);
assert.match(operations, /readOperations/);
assert.match(migration, /ALTER TABLE agent_manager_messages ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON agent_manager_messages FROM anon, authenticated/);
assert.doesNotMatch(endpoint, /client_email|payment|medical|password|token_value/);
assert.doesNotMatch(telemetry, /raw_prompt|chain.of.thought|client_email|payment_credentials/);

console.log('Manager Communication security contract: ok');
