'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname,'../netlify/functions/sessions.js'),'utf8');
let dbReads=0;
const sandbox={exports:{},require:name=>{
  if(name==='./lib/auth')return {requireAdmin:async()=>({error:{statusCode:401,body:'Unauthorized'}}),respond:(statusCode,body)=>({statusCode,body})};
  if(name==='./lib/supabase')return {getClient:()=>{dbReads++;throw new Error('Unauthorized DB access');}};
  return {};
}};
vm.runInNewContext(source,sandbox);
(async()=>{
  let checks=0;
  for(const method of ['GET','POST','PATCH']) for(const action of ['reschedule','cancel','restore']){
    const result=await sandbox.exports.handler({httpMethod:method,headers:{'x-google-meet-test-auth':'local-test-only'},queryStringParameters:{id:'existing'},body:JSON.stringify({action})});
    assert.equal(result.statusCode,401);checks++;
  }
  assert.equal(dbReads,0);checks++;
  assert(!/GOOGLE_MEET_TEST_|authorizeControlledLifecycle|auth.controlled/.test(source));checks++;
  assert(!source.includes("source === 'controlled_google_meet_test'"));checks++;
  assert(source.includes("action: 'session_rescheduled'")&&source.includes("action: 'session_cancelled'"));checks++;
  console.log(`controlled lifecycle removal/auth contract: ${checks}/13 passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
