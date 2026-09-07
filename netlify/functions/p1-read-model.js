'use strict';
const {readContent}=require('./lib/p1-content');
const {providerHealth}=require('./lib/p1-provider-health');
const {requireAdmin,respond}=require('./lib/auth');
const {FIELDS,readTable,project}=require('./lib/p1-read-model');
const {filterData,contactClass,diagnostics}=require('./lib/p1-policy');
exports.handler=async event=>{
 try{
  const auth=await requireAdmin(event,{touch:false});if(auth.error)return auth.error;
  if(event.httpMethod!=='GET')return respond(405,{error:'Read-only endpoint.'});
  if(event.queryStringParameters?.embed==='tiktok')return require('./lib/p1-tiktok').embed();
  const raw=Object.fromEntries(await Promise.all(Object.keys(FIELDS).map(async table=>[table,await readTable(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,table)])));
  const content=await readContent(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{includeQA:event.queryStringParameters?.include_qa==='true'});
  const all=project(raw),data=filterData(all,event.queryStringParameters?.include_qa==='true');
  data.clients=data.clients.map(c=>({...c,contact_completeness:contactClass(c,all.sessions)}));
  let heartbeats=[];try{const u=new URL('/rest/v1/worker_health',process.env.SUPABASE_URL);u.search='select=worker,started_at,finished_at,status,failed_count';const r=await fetch(u,{method:'GET',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(10000)});if(r.ok)heartbeats=await r.json();}catch{/* Absence is reported as degraded, never healthy. */}
  content.tiktok=require('./lib/p1-tiktok').videos(content.sources);data.content=content;data.diagnostics=diagnostics(all,process.env,new Date(),heartbeats);
  if(event.queryStringParameters?.diagnostics==='true'){const probed=await providerHealth(process.env);data.diagnostics.services=data.diagnostics.services.map(s=>{const p=probed.find(p=>p.name===s.name);return p?{...s,...p}:s;});}data.authenticated=true;try{data.security=require('./lib/practitioner-credential').metadata(await require('./lib/practitioner-credential').read(require('./lib/supabase').getClient()));}catch{data.security=null;}
  return respond(200,data);
 }catch{return respond(503,{error:'Production records could not be read. No sample data was substituted.'});}
};
