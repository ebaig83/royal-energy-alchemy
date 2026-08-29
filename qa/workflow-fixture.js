'use strict';

// Disposable workflow-validation fixture lifecycle. Never targets an existing
// client: create requires an explicit run id and cleanup requires the exact
// manifest produced by create.
const fs = require('fs');
const path = require('path');
const https = require('https');

function envFile() {
  const p = path.join(__dirname, '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}
envFile();
const url = process.env.SUPABASE_URL || process.env.QA_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.QA_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL and service-role key for fixture lifecycle');
const base = new URL(url);
function request(method, table, body, query='') { return new Promise((resolve,reject)=>{const b=body?JSON.stringify(body):null;const r=https.request({hostname:base.hostname,path:'/rest/v1/'+table+query,method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...(b?{'Content-Length':Buffer.byteLength(b)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{let j;try{j=JSON.parse(d)}catch{j=d} x.statusCode>=200&&x.statusCode<300?resolve(j):reject(new Error(`${method} ${table} ${x.statusCode}: ${d}`));});});r.on('error',reject);if(b)r.write(b);r.end();});}
const manifestPath = path.join(__dirname, 'workflow-fixture-manifest.json');
const runDir = path.join(__dirname, '.workflow-runs');
function loadManifest(){ if(!fs.existsSync(manifestPath)) throw new Error('No fixture manifest'); return JSON.parse(fs.readFileSync(manifestPath)); }
function saveManifest(m){ fs.mkdirSync(runDir,{recursive:true}); fs.writeFileSync(manifestPath,JSON.stringify(m,null,2)); }
function registerRecord(type, table, id, metadata={}){ if(!id) throw new Error(`Safety failure: ${type} created without primary key`); const m=loadManifest(); if(!m.records) m.records=[]; if(m.records.some(r=>r.table===table&&r.id===id)) return; m.records.push({type,table,id,parentId:metadata.parentId||null,createdOrder:m.records.length+1,operation:metadata.operation||'create',before:metadata.before||null,cleanupStatus:'pending'}); saveManifest(m); }
function snapshotMutation(type, table, id, before, metadata={}){ if(!id||!before) throw new Error(`Safety failure: ${type} mutation lacks identity or prior state`); const m=loadManifest(); if(!m.records) m.records=[]; m.records.push({type,table,id,parentId:metadata.parentId||null,createdOrder:m.records.length+1,operation:'update',before,fields:metadata.fields||Object.keys(before),cleanupStatus:'pending'}); saveManifest(m); }
function validateManifest(m){ if(!m||m.schemaVersion!==1||!m.runId||!m.marker||!m.marker.startsWith(`[QA][${m.runId}]`)||!m.qaClientId||m.client?.id!==m.qaClientId||!m.client.name?.includes(m.marker)||m.lifecycleState==='completed') throw new Error('Unsafe or completed QA manifest'); return m; }
const CLEANUP_ORDER={recommendation:10,'session-note':20,aftercare:30,session:40,client:100};
function cleanupPlan(m){ validateManifest(m); const unknown=(m.records||[]).filter(r=>!CLEANUP_ORDER[r.type]); if(unknown.length) throw new Error('Unsupported manifest entries: '+unknown.map(r=>`${r.type}:${r.id}`).join(', ')); return [...(m.records||[])].sort((a,b)=>(CLEANUP_ORDER[a.type]||999)-(CLEANUP_ORDER[b.type]||999)); }
module.exports={registerRecord,snapshotMutation,loadManifest,saveManifest,validateManifest,cleanupPlan};
async function create(){const runId=process.argv[3]||`workflow-${new Date().toISOString().replace(/\D/g,'').slice(0,14)}-${Math.random().toString(36).slice(2,8)}`;const marker=`[QA][${runId}]`;const rows=await request('POST','clients',{full_name:`${marker} Disposable Workflow Client`,email:`${runId.toLowerCase()}@rea-qa.invalid`,phone:'+15555550199',source:'qa_fixture'});const client=Array.isArray(rows)?rows[0]:rows;if(!client?.id)throw new Error('QA fixture create returned no client ID');client.name=client.full_name;const manifest={schemaVersion:1,runId,marker,qaClientId:client.id,client,lifecycleState:'ready',records:[{type:'client',table:'clients',id:client.id,parentId:null,operation:'create',createdOrder:0,cleanupStatus:'pending'}],mutations:[]};saveManifest(manifest);console.log(JSON.stringify({runId,marker,qaClientId:client.id,manifestPath},null,2));}
async function verify(){if(!fs.existsSync(manifestPath))throw new Error('No fixture manifest');const m=JSON.parse(fs.readFileSync(manifestPath));if(!m.marker.startsWith('[QA][')||!m.client?.id||!m.client.name?.includes(m.marker))throw new Error('Unsafe fixture manifest');const rows=await request('GET','clients',null,`?id=eq.${encodeURIComponent(m.client.id)}&select=id,name,email`);if(!rows.length||rows[0].name!==m.client.name)throw new Error('Fixture ownership verification failed');console.log('fixture verified:',m.run,m.client.id);}
async function cleanup(){if(!fs.existsSync(manifestPath))throw new Error('No fixture manifest');const m=JSON.parse(fs.readFileSync(manifestPath));if(!m.marker.startsWith('[QA][')||!m.created?.length)throw new Error('Refusing ambiguous cleanup');for(const r of [...m.created].reverse()){if(r.table!=='clients'||!r.id)throw new Error('Untracked record in manifest');await request('DELETE',r.table,null,`?id=eq.${encodeURIComponent(r.id)}&name=eq.${encodeURIComponent(m.client.name)}`);}const left=await request('GET','clients',null,`?id=eq.${encodeURIComponent(m.client.id)}&select=id`);if(left.length)throw new Error('Cleanup verification failed');fs.unlinkSync(manifestPath);console.log('fixture cleanup verified:',m.run);}
if (require.main === module) { const op=process.argv[2];(op==='create'?create:op==='verify'?verify:op==='cleanup'?cleanup:()=>Promise.reject(new Error('Usage: node workflow-fixture.js create|verify|cleanup [run-id]')))().catch(e=>{console.error(e.message);process.exitCode=1;}); }
