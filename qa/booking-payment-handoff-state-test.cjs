'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkout = fs.readFileSync(path.join(root, 'netlify/functions/create-stripe-checkout.js'), 'utf8');
const waiver = fs.readFileSync(path.join(root, 'waiver-esign.html'), 'utf8');
const confirmation = fs.readFileSync(path.join(root, 'booking-confirmation.html'), 'utf8');

assert.match(checkout, /const resumeToken = String\(body\.resume_token \|\| ''\)\.trim\(\);/);
assert.match(checkout, /resumeToken\.length < 64/);
assert.match(checkout, /booking-confirmation\.html\?attempt_id=.*resume_token=.*payment=success/);
assert.match(checkout, /booking-confirmation\.html\?attempt_id=.*resume_token=.*payment=cancelled/);
assert.doesNotMatch(checkout, /success_url', `\$\{SITE_URL\}\/book\.html\?attempt_id/);
assert.doesNotMatch(checkout, /cancel_url', `\$\{SITE_URL\}\/book\.html\?attempt_id/);

assert.match(waiver, /attempt_id: attemptId, resume_token: WAIVER_RESUME_TOKEN/);
assert.match(waiver, /booking-confirmation\.html\?attempt_id=.*resume_token=.*payment=pending/);

assert.match(confirmation, /const attemptId = params\.get\('attempt_id'\)/);
assert.match(confirmation, /const resumeToken = params\.get\('resume_token'\)/);
assert.match(confirmation, /action: 'resume', resume_token: resumeToken/);
assert.match(confirmation, /attemptId \? \{ attempt_id: attemptId, resume_token: resumeToken \}/);
assert.match(confirmation, /data\.attempt\.id !== attemptId/);

console.log('booking payment handoff state-loss regression checks passed');
