'use strict';
const assert = require('assert');
const { processDue } = require('../netlify/functions/session-communications');

const now = new Date('2026-08-29T13:30:00Z');
const sessions = [
  { id:'A', client_id:'ca', client_name:'A', service:'Energy', session_date:'2026-08-29', session_time:'10:00', duration_minutes:60, status:'confirmed' },
  { id:'B', client_id:'cb', client_name:'B', service:'Energy', session_date:'2026-08-29', session_time:null, status:'confirmed' },
  { id:'C', client_id:'cc', client_name:'C', service:'Energy', session_date:'2026-08-29', session_time:'10:00', duration_minutes:60, status:'confirmed' },
  { id:'D', client_id:'cd', client_name:'D', service:'Energy', session_date:'2026-08-26', session_time:'08:30', duration_minutes:60, status:'confirmed' },
  { id:'E', client_id:'ce', client_name:'E', service:'Energy', session_date:'2026-08-26', session_time:'08:30', duration_minutes:60, status:'confirmed' },
  { id:'F', client_id:'cf', client_name:'F', service:'Energy', session_date:'2026-08-29', session_time:'10:00', duration_minutes:60, status:'confirmed' },
];
const sent = new Set(['F']); const sends = []; const aftercare = new Map([['E', { id:'ae', status:'scheduled', followup_template_used:'C' }]]);
class Query { constructor(table){this.table=table;this.filters={};} select(){return this;} gte(){return this;} lte(){return this;} eq(k,v){this.filters[k]=v;return this;} contains(k,v){this.containsValue=v;return this;} limit(){return this;} insert(row){this.insertRow=row;return this;} single(){return this._result();} then(a,b){return Promise.resolve(this._result()).then(a,b);} _result(){
  if(this.table==='sessions') return {data:sessions,error:null};
  if(this.table==='clients') return {data:{email:`${this.filters.id}@fake.test`},error:null};
  if(this.table==='communications') return {data:(this.containsValue?.session_id && sent.has(this.containsValue.session_id))?[{id:'existing'}]:[],error:null};
  if(this.table==='aftercare'){ const id=this.filters.session_id; if(id==='D') throw new Error('aftercare lookup failed token=SECRET'); if(this.insertRow){const row={id:'ad',...this.insertRow}; aftercare.set(id,row); return {data:row,error:null};} return {data:aftercare.has(id)?[aftercare.get(id)]:[],error:null}; }
  return {data:null,error:null};
} }
const sb={from:(table)=>new Query(table)};
async function run(){
  const result=await processDue({sb,now,send:async(_sb,p)=>{ if(p.sessionId==='C') throw new Error('provider failure api_key=SECRET'); sends.push(p.sessionId); sent.add(p.sessionId); }});
  assert.deepStrictEqual(sends.sort(),['A','E']);
  assert(result.failed.some(x=>x.id==='C') && result.failed.some(x=>x.id==='D'));
  assert(!result.sent.some(x=>x.id==='B') && !result.sent.some(x=>x.id==='F'));
  const retry=await processDue({sb,now,send:async(_sb,p)=>{ if(p.sessionId==='C') sends.push('C-retry'); }});
  assert(!retry.sent.some(x=>x.id==='A') && !retry.sent.some(x=>x.id==='E'));
  assert(sends.includes('C-retry'));
  assert(!JSON.stringify(result).match(/@fake|SECRET|token|api_key/i));
  console.log('multi-session failure isolation: 14/14 passed (A/E success; B/C/D failed or skipped; F suppressed; retry verified)');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
