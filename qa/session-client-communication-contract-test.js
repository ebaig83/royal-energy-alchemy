'use strict';
const assert = require('assert');
const h = require('../netlify/functions/lib/session-communications');
const { processDue } = require('../netlify/functions/session-communications');

const now = new Date('2026-08-29T13:30:00Z');
const base = { id: 's1', client_id: 'c1', client_name: 'Test Client', service: 'Energy Session', session_date: '2026-08-29', session_time: '10:00:00', duration_minutes: 60, status: 'confirmed' };
assert(h.isActiveSession(base));
assert(!h.isActiveSession({ ...base, status: 'cancelled' }));
assert(h.isDue(h.sessionStart(base), now, 30));
assert(h.followupDue({ ...base, session_date: '2026-08-26', session_time: '09:30:00' }, new Date('2026-08-29T14:30:00Z')));
assert(h.followupUrl('abc').includes('/aftercare.html?aid=abc'));

let writes = [];
const sb = { from(table) { const q = { table, select(){return q;}, gte(){return q;}, lte(){return q;}, eq(){return q;}, contains(){return q;}, limit(){return q;}, single(){ return Promise.resolve({ data: table === 'clients' ? { email:'fake@example.test' } : { id:'a1' }, error:null }); }, insert(row){ writes.push({ table, row }); return { select(){return this;}, single(){return Promise.resolve({ data:{id:'a1'}, error:null });} }; } }; if(table==='sessions') q.then=(resolve)=>resolve({data:[base],error:null}); if(table==='communications') q.then=(resolve)=>resolve({data:[],error:null}); return q; } };
processDue({ sb, now, send: async (_sb, payload) => { assert(payload.templateName === 'session_30_minute_reminder'); assert(!payload.variables.followup_url); } }).then(() => {
  assert.strictEqual(writes.length, 0, '30-minute reminder must not create follow-up records');
  console.log('session client communication contract: 6/6 passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
