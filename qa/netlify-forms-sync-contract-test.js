'use strict';

const assert = require('assert');
const path = require('path');

const functionPath = path.resolve(__dirname, '../netlify/functions/netlify-forms-sync.js');
const originalFetch = global.fetch;
const originalEnv = {
  DASHBOARD_API_SECRET: process.env.DASHBOARD_API_SECRET,
  NETLIFY_ACCESS_TOKEN: process.env.NETLIFY_ACCESS_TOKEN,
  SITE_ID: process.env.SITE_ID,
};

function event(token) {
  return {
    httpMethod: 'GET',
    headers: token ? { 'x-dashboard-token': token } : {},
    queryStringParameters: { per_page: '100' },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function run() {
  process.env.DASHBOARD_API_SECRET = 'contract-test-dashboard-secret';
  process.env.NETLIFY_ACCESS_TOKEN = 'contract-test-netlify-token';
  process.env.SITE_ID = 'contract-test-site';

  delete require.cache[functionPath];
  const { handler } = require(functionPath);

  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    throw new Error('Unauthenticated request must not access Netlify.');
  };

  const unauthenticated = await handler(event());
  assert.strictEqual(unauthenticated.statusCode, 401);
  assert.strictEqual(fetchCount, 0);

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/sites/contract-test-site/forms')) {
      return jsonResponse(200, [{ id: 'booking-form-id', name: 'booking' }]);
    }
    if (url.includes('/forms/booking-form-id/submissions?')) {
      return jsonResponse(200, [{
        id: 'submission-1',
        created_at: '2026-08-28T12:00:00.000Z',
        data: { name: 'Test Client', contact: 'test@example.com', service: 'Distance Energy Session' },
      }]);
    }
    throw new Error(`Unexpected Netlify request: ${url}`);
  };

  const authenticated = await handler(event('contract-test-dashboard-secret'));
  assert.strictEqual(authenticated.statusCode, 200);
  const body = JSON.parse(authenticated.body);
  assert.strictEqual(body.success, true);
  assert.ok(Array.isArray(body.submissions));
  assert.strictEqual(body.submissions.length, 1);
  assert.strictEqual(body.submissions[0].netlifySubmissionId, 'submission-1');
  assert.strictEqual(requests.length, 2);
  requests.forEach(({ options }) => {
    assert.ok(!options.method || options.method === 'GET', 'Netlify API access must remain read-only.');
    assert.strictEqual(options.body, undefined, 'Read-only requests must not include a body.');
  });

  console.log('netlify-forms-sync contract: 4/4 passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});
