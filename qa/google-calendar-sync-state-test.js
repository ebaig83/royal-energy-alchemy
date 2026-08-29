'use strict';
const assert = require('assert');
const { processPending } = require('../netlify/functions/session-calendar-sync');

const rows = [
  { id: 'A', client_id: 'ca', client_name: 'A', session_date: '2026-09-01', session_time: '10:00', service: 'Remote', status: 'confirmed', location_type: 'distance', google_calendar_status: 'pending' },
  { id: 'B', client_id: 'cb', client_name: 'B', session_date: '2026-09-01', session_time: '11:00', service: 'Remote', status: 'confirmed', location_type: 'distance', google_calendar_status: 'pending' },
  { id: 'C', client_id: 'cc', client_name: 'C', session_date: '2026-09-01', session_time: '12:00', service: 'Remote', status: 'cancelled', location_type: 'distance', google_calendar_event_id: 'event-c', google_calendar_status: 'cancel_pending' },
];
class Query {
  constructor(table) { this.table = table; this.filters = {}; this.patch = null; }
  select() { return this; } in(_k, values) { this.allowed = values; return this; } limit() { return this; }
  update(patch) { this.patch = patch; return this; } eq(k, v) { this.filters[k] = v; return this; }
  single() { if (this.table === 'clients') return Promise.resolve({ data: { email: `${this.filters.id}@example.test` }, error: null }); return this._result(); }
  then(resolve, reject) { return Promise.resolve(this._result()).then(resolve, reject); }
  _result() {
    if (this.table === 'sessions' && this.patch) { const row = rows.find(r => r.id === this.filters.id); Object.assign(row, this.patch); return { data: null, error: null }; }
    if (this.table === 'sessions') return { data: rows.filter(r => this.allowed.includes(r.google_calendar_status)).map(r => ({ ...r })), error: null };
    return { data: null, error: null };
  }
}
const sb = { from: table => new Query(table) };
const sends = [];
const api = {
  create: async body => { if (body.extendedProperties.private.reaSessionId === 'B') { const e = new Error('temporary'); e.retryable = true; throw e; } return { id: body.id, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } }; },
  get: async id => ({ id }), update: async id => ({ id }), delete: async () => ({}),
};
(async () => {
  const first = await processPending({ sb, api, send: async (_sb, payload) => { sends.push(payload.idempotencyKey); return { sent: true }; }, syncOptions: { delayMs: 0, attempts: 1, sleep: async () => {} } });
  assert(first.synced.some(x => x.id === 'A' && x.status === 'ready'));
  assert(first.failed.some(x => x.id === 'B' && x.retryable));
  assert(first.synced.some(x => x.id === 'C' && x.operation === 'cancel'));
  assert.strictEqual(rows.find(r => r.id === 'A').google_calendar_status, 'ready');
  assert.strictEqual(rows.find(r => r.id === 'B').google_calendar_status, 'retryable_error');
  assert.strictEqual(rows.find(r => r.id === 'C').google_calendar_status, 'cancelled');
  assert.deepStrictEqual(sends, ['session-google-meet-ready:A']);
  const second = await processPending({ sb, api, send: async () => { throw new Error('ready email must not repeat'); }, syncOptions: { delayMs: 0, attempts: 1, sleep: async () => {} } });
  assert(!second.synced.some(x => x.id === 'A') && !second.synced.some(x => x.id === 'C'));
  assert(second.failed.length === 1 && second.failed[0].id === 'B');
  console.log('google-calendar-sync-state-test: 9/9 passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
