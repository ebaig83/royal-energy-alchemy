const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(root, 'netlify/functions/authorized-users.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'dashboard-p1/authorized-users-ui.mjs'), 'utf8');
const { invitationState } = require(path.join(root, 'netlify/functions/authorized-users.js'))._test;

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();
assert.equal(invitationState(null), 'new');
assert.equal(invitationState({ invite_token_hash: 'hash', invite_expires_at: future }), 'pending');
assert.equal(invitationState({ invite_token_hash: 'old-hash', invite_expires_at: past }), 'expired');
assert.equal(invitationState({ password_hash: 'set', invite_token_hash: null, invite_expires_at: null }), 'active');
assert.match(endpoint, /crypto\.randomBytes\(32\)/);
assert.match(endpoint, /invitationState\(existing/);
assert.match(endpoint, /invite_token_hash: hashToken\(token\)/);
assert.match(endpoint, /invite_expires_at: expiresAt/);
assert.match(endpoint, /authorized_user_invitation_resent/);
assert.match(endpoint, /INVITATION_PENDING/);
assert.match(endpoint, /INVITATION_EMAIL_FAILED/);
assert.match(ui, /response\.ok&&result\.invitation_sent/);
assert.match(ui, /const form=event\.currentTarget/);
assert.doesNotMatch(endpoint, /console\.(log|error).*token/);
console.log('PASS invitation create, active-duplicate, expired-reinvite, token rotation, email truthfulness, and redaction contracts');
