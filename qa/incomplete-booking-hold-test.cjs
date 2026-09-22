'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.RESEND_API_KEY = 'test-only';
process.env.FROM_EMAIL = 'test@example.test';
process.env.ADMIN_EMAIL = 'admin@example.test';

const { resolveBookingContact, sendBookingReceivedNotices } = require('../netlify/functions/lib/booking-notifications');
const { buildWebsiteSessionRow } = require('../netlify/functions/lib/booking-state');
const { isActiveSession, filterSlotsAgainstSessions } = require('../netlify/functions/lib/session-overlap');

class Query {
  constructor(db, table) { this.db=db; this.table=table; this.action='select'; this.payload=null; this.filters=[]; }
  select(){return this;} insert(payload){this.action='insert';this.payload=payload;return this;} update(payload){this.action='update';this.payload=payload;return this;}
  eq(key,value){this.filters.push([key,value]);return this;} single(){return this.exec(true);} maybeSingle(){return this.exec(true);} then(ok,bad){return this.exec(false).then(ok,bad);}
  async exec(single){const rows=this.db[this.table]||(this.db[this.table]=[]),matches=r=>this.filters.every(([k,v])=>r[k]===v);
    if(this.action==='select'){const found=rows.filter(matches);return{data:single?(found[0]||null):found,error:null};}
    if(this.action==='insert'){const list=Array.isArray(this.payload)?this.payload:[this.payload];if(this.table==='transactional_notifications'&&rows.some(r=>r.idempotency_key===list[0].idempotency_key))return{data:null,error:{code:'23505'}};const inserted=list.map(row=>({id:`${this.table}-${rows.length+1}`,...row}));rows.push(...inserted);return{data:single?inserted[0]:inserted,error:null};}
    const found=rows.filter(matches);found.forEach(r=>Object.assign(r,this.payload));return{data:single?(found[0]||null):found,error:null};
  }
}

(async()=>{
  assert.deepEqual(resolveBookingContact({email:'canonical@example.test',phone:'5551112222'},{email:'submitted@example.test',phone:'5559998888'}),{email:'canonical@example.test',phone:'5551112222'});
  assert.deepEqual(resolveBookingContact({email:null,phone:null},{email:'submitted@example.test',phone:'5559998888'}),{email:'submitted@example.test',phone:'5559998888'});
  const row=buildWebsiteSessionRow({clientId:'client-1',clientName:'Client',contact:{email:'client@example.test',phone:'5551112222'},service:{label:'Service',duration:60,price:100},date:'2026-09-23',time:'14:00',now:Date.parse('2026-09-22T18:00:00Z'),holdMinutes:30});
  assert.equal(row.client_id,'client-1');assert.equal(row.client_email,'client@example.test');assert.equal(row.client_phone,'5551112222');assert.equal(row.payment_hold_expires_at,'2026-09-22T18:30:00.000Z');
  const templates=['booking_received_practitioner','booking_received_pending_payment'].map((name,index)=>({id:`t-${index}`,name,is_active:true,type:name,subject:name,html_body:'<p>{{client_name}} {{service}} {{session_date}} {{session_time}} {{waiver_url}}</p>',text_body:'{{session_reference}}'}));
  templates[0].html_body='<p>{{client_name}} {{client_email}} {{client_phone}} {{service}} {{session_date}} {{session_time}} {{amount_due}} {{payment_hold_expires_at}}</p>';
  const db={clients:[{id:'client-1',email_consent:true}],email_templates:templates,transactional_notifications:[],communications:[]};
  const sb={from:table=>new Query(db,table)};let sends=0;const transport=async()=>({success:true,status:200,body:{id:`msg-${++sends}`}});
  const options={session:{id:'session-1',client_id:'client-1'},contact:{email:'client@example.test',phone:'5551112222'},variables:{client_name:'Client',client_email:'client@example.test',client_phone:'5551112222',service:'Service',session_date:'2026-09-23',session_time:'14:00',timezone:'ET',amount_due:'100.00',payment_hold_expires_at:'2026-09-23T18:30:00Z',session_reference:'session-1',waiver_url:'https://example.test/waiver'},transport};
  const first=await sendBookingReceivedNotices(sb,options);assert.equal(first.admin.sent,true);assert.equal(first.client.sent,true);assert.equal(sends,2);
  await sendBookingReceivedNotices(sb,options);assert.equal(sends,2,'idempotency prevents duplicate practitioner/client notices');
  assert.equal(db.transactional_notifications.length,2);
  const missing=await sendBookingReceivedNotices(sb,{...options,session:{id:'session-2',client_id:'client-1'},contact:{email:null,phone:'5551112222'},variables:{...options.variables,session_reference:'session-2'}});
  assert.equal(missing.client.manualReviewRequired,true);assert.ok(db.communications.some(message=>message.status==='manual_required'));

  const expired={status:'pending',payment_status:'pending',booking_status:'payment_expired',session_date:'2026-09-23',session_time:'14:00:00'};
  assert.equal(isActiveSession(expired),false);
  assert.equal(filterSlotsAgainstSessions([{status:'available',slot_date:'2026-09-23',slot_time:'14:00:00'}],[expired]).length,1,'expired hold releases public availability');

  const booking=fs.readFileSync('netlify/functions/booking.js','utf8');
  for(const field of ['client_id','client_email','client_phone','payment_hold_expires_at'])assert.match(booking,new RegExp(field));
  assert.match(booking,/select\('id,session_date,session_time,duration_minutes,status,booking_status'\)/,'booking conflict check reads expiration state');
  assert.doesNotMatch(booking,/from\(['"](?:payments|ledger_entries)['"]\)\.insert/,'booking does not fabricate payment evidence');
  const model=fs.readFileSync('dashboard-p1/model.mjs','utf8');
  for(const text of ['Payment Pending','Hold expired','Payment not completed','Expired booking'])assert.ok(model.includes(text));
  const app=fs.readFileSync('dashboard-p1/app.mjs','utf8');assert.ok(app.includes('Client communication not sent / not recorded'));
  const migration=fs.readFileSync('migrations/2026-09-22-incomplete-booking-payment-holds.sql','utf8');
  for(const text of ['expire_unpaid_booking_holds','status = \'available\'','session_id = null','booking_received_practitioner'])assert.ok(migration.includes(text));
  const worker=fs.readFileSync('netlify/functions/expire-payment-holds.js','utf8');assert.ok(worker.includes("rpc('expire_unpaid_booking_holds'"));
  console.log('PASS incomplete booking: canonical contact, idempotent notices, payment statuses, availability release, no payment fabrication, worker/schema contract');
})().catch(error=>{console.error(error);process.exitCode=1;});
