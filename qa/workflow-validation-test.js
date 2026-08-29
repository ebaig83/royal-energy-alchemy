'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {MemoryWorkflowAdapter}=require('./workflow-data-adapter');
const v=require('./workflow-validation');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rea-workflow-')),p=path.join(dir,'run.json'),runId='workflow-unit',marker='[QA][workflow-unit]',client={id:'client-qa',name:marker+' Client'};fs.writeFileSync(p,JSON.stringify({schemaVersion:1,runId,marker,qaClientId:client.id,client,lifecycleState:'ready',records:[{type:'client',table:'clients',id:client.id,operation:'create',createdOrder:0,cleanupStatus:'pending'}],mutations:[]}));return{p,client};}
(async()=>{let n=0;const ok=()=>n++;
await assert.rejects(()=>v.initializeRunContext('',new MemoryWorkflowAdapter()));ok();
{const{x=''}={};assert.throws(()=>v.validateManifest({schemaVersion:1,runId:'x',qaClientId:'c',marker:'[QA][bad]',client:{id:'c',name:'real'}}));ok();}
{const{p,client}=fixture(),a=new MemoryWorkflowAdapter({clients:[client]}),ctx=await v.initializeRunContext(p,a),r=await v.createTrackedRecord(ctx,{type:'session',data:{client_id:client.id}});assert(ctx.manifest.records.some(x=>x.id===r.id));ok();const bad={...a,create:async()=>({})};await assert.rejects(()=>v.createTrackedRecord(Object.assign(ctx,{adapter:bad}),{type:'session',data:{}}));ok();}
{const{p,client}=fixture(),a=new MemoryWorkflowAdapter({clients:[client],aftercare:[{id:'f',client_id:client.id,status:'scheduled'}]}),ctx=await v.initializeRunContext(p,a);await v.mutateExistingWithSnapshot(ctx,{type:'followup',id:'f',fields:['status'],changes:{status:'sent'}});await v.mutateExistingWithSnapshot(ctx,{type:'followup',id:'f',fields:['status'],changes:{status:'skipped'}});assert.strictEqual(ctx.manifest.mutations[0].before.status,'scheduled');ok();}
{const{p,client}=fixture(),a=new MemoryWorkflowAdapter({clients:[client]}),ctx=await v.executeRun(p,a,{run:async c=>{await v.createTrackedRecord(c,{type:'session',data:{client_id:client.id}});throw Error('expected')}});assert.strictEqual(ctx.validationResult.passed,false);assert.strictEqual(ctx.verificationResult.passed,true);ok();}
assert.throws(()=>v.assertNoExternalSideEffect('Stripe Checkout'));ok();
console.log(`workflow validation lifecycle tests: ${n}/${n} passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
