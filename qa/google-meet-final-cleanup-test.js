'use strict';
const assert=require('assert');
const {syncSession}=require('../netlify/functions/lib/google-calendar');
const {processPending}=require('../netlify/functions/session-calendar-sync');
const {runCli}=require('./controlled-google-meet-runner');
(async()=>{
  let creates=0,deletes=0,updates=0;
  const api={create:async()=>{creates++;throw Error('no create');},update:async()=>{updates++;throw Error('no update');},delete:async()=>{deletes++;}};
  const cancelled={id:'local-cancelled-test',status:'cancelled',payment_status:'paid',google_calendar_status:'cancelled',google_calendar_event_id:null};
  assert.deepEqual(await syncSession(cancelled,api),await syncSession(cancelled,api));
  assert.equal(creates+deletes+updates,0);
  const unpaid={id:'unpaid',source:'controlled_google_meet_test',payment_status:'pending',google_calendar_status:'pending'};
  const sb={from:()=>({select(){return this;},in(){return this;},limit:async()=>({data:[unpaid]})})};
  assert.equal((await processPending({sb,api})).synced.length,0);
  assert.equal(creates+deletes+updates,0);
  await assert.rejects(runCli(['--controlled-production','--confirm-single-production-lifecycle']),/retired/);
  await assert.rejects(runCli(['--probe-cycle']),/retired/);
  console.log('final cleanup: cancellation idempotency, spoofed source payment gate, retired runner: 6/6 passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
