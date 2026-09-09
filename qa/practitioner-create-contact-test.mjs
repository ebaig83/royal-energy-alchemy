import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _test } from '../netlify/functions/practitioner-create-session.js';

const actions = fs.readFileSync(new URL('../dashboard-p1/actions.mjs', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/practitioner-create-session.js', import.meta.url), 'utf8');

assert.match(actions, /name="client_email"/);
assert.match(actions, /name="client_phone"/);
assert.match(actions, /Existing client contact loaded/);
assert.match(endpoint, /Client email is required to send the waiver or payment request/);
assert.match(endpoint, /Client telephone must be a valid phone number/);
assert.equal(_test.normalizeEmail('  Client@Example.COM '), 'client@example.com');
assert.equal(_test.validEmail('client@example.com'), true);
assert.equal(_test.validEmail('not-an-email'), false);
assert.equal(_test.normalizePhone('+1 (814) 392-2095'), '+18143922095');
assert.equal(_test.normalizePhone('814-392-2095'), '8143922095');
assert.equal(_test.normalizePhone('123'), null);
assert.doesNotMatch(endpoint, /idempotency.*client_email|idempotency.*client_phone/i);
console.log('PASS practitioner contact validation and privacy contract');
