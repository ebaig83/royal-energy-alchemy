'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const endpoint = require(path.join(root, 'netlify/functions/practitioner-invite.js'));
const ui = fs.readFileSync(path.join(root, 'dashboard-p1/multi-user-login.mjs'), 'utf8');
const token = 'A'.repeat(43);
const hash = crypto.createHash('sha256').update(token).digest('hex');
const future = new Date(Date.now() + 20 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

assert.equal(endpoint._test.normalizeInviteToken(token), token);
assert.equal(endpoint._test.normalizeInviteToken(encodeURIComponent(token)), token);
assert.equal(endpoint._test.normalizeInviteToken('not a token'), '');

const pending = { active: true, invite_token_hash: hash, invite_expires_at: future };
assert.deepEqual(endpoint._test.invitationValidation(pending, token).setup_allowed, true);
assert.equal(endpoint._test.invitationValidation(pending, 'B'.repeat(43)).token_hash_match, false);
assert.equal(endpoint._test.invitationValidation({ ...pending, invite_expires_at: past }, token).invite_not_expired, false);
assert.equal(endpoint._test.invitationValidation({ ...pending, active: false }, token).setup_allowed, false);

assert.match(ui, /decodeURIComponent/);
assert.match(ui, /readInviteToken/);
assert.match(ui, /history\.replaceState/);
assert.doesNotMatch(ui, /console\.(log|error).*invite|console\.(log|error).*token/);

console.log('invitation validation contract: PASS');
