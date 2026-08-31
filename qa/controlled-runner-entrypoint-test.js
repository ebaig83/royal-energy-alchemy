'use strict';
const assert = require('assert');
const { runCli, runLifecycle } = require('./controlled-google-meet-runner');

function bundle(overrides={}) {
  const calls={}; const hit=(name,value=true)=>async()=>{calls[name]=(calls[name]||0)+1;return value;};
  const adapters={createAuth:hit('createAuth'),createExpiry:hit('createExpiry'),createAuthDeploy:hit('authDeploy'),pollAuthDeploy:hit('authPoll'),verifyHealthActive:hit('healthActive'),booking:hit('booking'),reconcileBooking:hit('reconcile',{id:'session-1'}),pollSync:hit('sync'),verifyEvent:hit('event'),verifyMeet:hit('meet'),verifyDashboard:hit('dashboard'),verifyCommunication:hit('communication'),verifyReminder:hit('reminder'),reschedule:hit('reschedule'),verifyReschedule:hit('rescheduleVerify'),cancel:hit('cancel'),verifyCancellation:hit('cancelVerify'),deleteAuth:hit('deleteAuth'),deleteExpiry:hit('deleteExpiry'),createCleanupDeploy:hit('cleanupDeploy'),pollCleanupDeploy:hit('cleanupPoll'),verifyHealthClosed:hit('healthClosed'),...overrides};
  return {calls,adapters,dispose:()=>{calls.dispose=(calls.dispose||0)+1;},summary:()=>({sessionId:'session-1'})};
}

(async()=>{
  await assert.rejects(()=>runCli([],{}),/retired/);
  await assert.rejects(()=>runCli(['--controlled-production','--confirm-single-production-lifecycle'],{createAdapters:async()=>{throw new Error('Authenticated Netlify token not found.');}}),/Netlify token/);
  await assert.rejects(()=>runCli(['--controlled-production','--confirm-single-production-lifecycle'],{createAdapters:async()=>{throw new Error('Supabase verification unavailable.');}}),/Supabase/);
  const happy=bundle(); const output=[];
  assert.strictEqual(await runCli(['--controlled-production','--confirm-single-production-lifecycle'],{createAdapters:async()=>happy,write:v=>output.push(v)}),0);
  assert.strictEqual(happy.calls.booking,1);assert.strictEqual(happy.calls.reschedule,1);assert.strictEqual(happy.calls.cancel,1);assert.strictEqual(happy.calls.authDeploy,1);assert.strictEqual(happy.calls.cleanupDeploy,1);assert.strictEqual(happy.calls.dispose,1);assert.strictEqual(output[0].ok,true);
  const failed=bundle({pollSync:async()=>{failed.calls.sync=(failed.calls.sync||0)+1;throw new Error('sync failed');}});
  await assert.rejects(()=>runCli(['--controlled-production','--confirm-single-production-lifecycle'],{createAdapters:async()=>failed,lifecycle:runLifecycle}),/sync failed/);
  assert.strictEqual(failed.calls.booking,1);assert.strictEqual(failed.calls.reschedule||0,0);assert.strictEqual(failed.calls.cancel||0,0);assert.strictEqual(failed.calls.cleanupDeploy,1);assert.strictEqual(failed.calls.dispose,1);
  console.log('controlled-runner-entrypoint-test: 6/6 passed; happy mutations booking=1 reschedule=1 cancel=1');
})().catch(error=>{console.error(error);process.exitCode=1;});
