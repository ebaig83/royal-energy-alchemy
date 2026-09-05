'use strict';

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..', 'netlify', 'functions');
const supabasePath = require.resolve(path.join(root, 'lib', 'supabase.js'));
const auditPath = require.resolve(path.join(root, 'lib', 'audit.js'));
const authPath = require.resolve(path.join(root, 'lib', 'auth.js'));
const verifyPath = require.resolve(path.join(root, 'verify-pin.js'));

const state = { sessions: [], failed: 0, seq: 0 };

class Query {
  constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; this.patch = null; this.row = null; this.countMode = false; }
  select(_columns, options = {}) { this.operation = 'select'; this.countMode = options.count === 'exact'; return this; }
  insert(row) { this.operation = 'insert'; this.row = row; return this; }
  update(patch) { this.operation = 'update'; this.patch = patch; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(field, value) { this.filters.push(row => row[field] === value); return this; }
  is(field, value) { this.filters.push(row => row[field] === value); return this; }
  gt(field, value) { this.filters.push(row => String(row[field]) > String(value)); return this; }
  gte() { return this; }
  lt(field, value) { this.filters.push(row => String(row[field]) < String(value)); return this; }
  maybeSingle() { return this; }
  execute() {
    if (this.table === 'audit_logs') return { count: state.failed, data: null, error: null };
    if (this.table !== 'admin_sessions') return { data: null, error: null };
    if (this.operation === 'insert') {
      state.sessions.push({ id: `session-${++state.seq}`, created_at: new Date().toISOString(), revoked_at: null, ...this.row });
      return { data: null, error: null };
    }
    const matches = state.sessions.filter(row => this.filters.every(test => test(row)));
    if (this.operation === 'update') { matches.forEach(row => Object.assign(row, this.patch)); return { data: null, error: null }; }
    if (this.operation === 'delete') { state.sessions = state.sessions.filter(row => !matches.includes(row)); return { data: null, error: null }; }
    return { data: matches[0] || null, error: null };
  }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
}

const fake = { from: table => new Query(table) };
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getClient: () => fake } };
require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { log: async () => {} } };
delete require.cache[authPath];
delete require.cache[verifyPath];

process.env.DASHBOARD_PIN = '246810';
process.env.ADMIN_EMAIL = 'admin@example.test';
process.env.SITE_URL = 'https://www.daronroyal.com';
const { handler } = require(verifyPath);
const { requireAdmin } = require(authPath);

const event = (method, body, cookie) => ({
  httpMethod: method,
  headers: { origin: 'https://www.daronroyal.com', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function login() {
  const response = await handler(event('POST', { pin: '246810' }));
  assert.strictEqual(response.statusCode, 200);
  assert(!response.body.includes('token'));
  assert(response.headers['Set-Cookie'].includes('HttpOnly'));
  assert(response.headers['Set-Cookie'].includes('Secure'));
  assert(response.headers['Set-Cookie'].includes('SameSite=Strict'));
  return response.headers['Set-Cookie'].split(';')[0];
}

(async () => {
  let response = await handler(event('POST', { pin: 'wrong' }));
  assert.strictEqual(response.statusCode, 401);

  const firstCookie = await login();
  response = await handler(event('GET', undefined, firstCookie));
  assert.strictEqual(response.statusCode, 200);

  state.sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  response = await handler(event('GET', undefined, firstCookie));
  assert.strictEqual(response.statusCode, 401);

  const secondCookie = await login();
  response = await handler(event('DELETE', undefined, secondCookie));
  assert.strictEqual(response.statusCode, 200);
  response = await handler(event('GET', undefined, secondCookie));
  assert.strictEqual(response.statusCode, 401);

  response = await handler(event('GET'));
  assert.strictEqual(response.statusCode, 401);
  const legacyAttempt = await requireAdmin({ httpMethod: 'GET', headers: { 'x-dashboard-token': 'permanent-shared-secret' } });
  assert.strictEqual(legacyAttempt.error.statusCode, 401);
  console.log('admin-session-auth-test: 13/13 passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
