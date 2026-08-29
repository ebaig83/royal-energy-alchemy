'use strict';
const assert = require('assert');
const start = require('../netlify/functions/google-oauth-start');
const callback = require('../netlify/functions/google-oauth-callback');
(async () => {
  const a = await start.handler({});
  const b = await callback.handler({ queryStringParameters: { state: 'ignored', code: 'ignored' } });
  assert.strictEqual(a.statusCode, 410);
  assert.strictEqual(b.statusCode, 410);
  assert(!a.body.includes('client_secret') && !b.body.includes('authorization code'));
  console.log('google-oauth-contract-test: 3/3 passed (public OAuth provisioning disabled)');
})().catch(error => { console.error(error); process.exitCode = 1; });
