'use strict';
// Best-effort telemetry; never changes the outcome of an existing worker job.
async function record(sb,worker,patch){try{await sb.from('worker_health').upsert({worker,...patch},{onConflict:'worker'});}catch{/* Missing migration must not interrupt jobs. */}}
async function observeWorker(sb,worker,run){
 const started=new Date().toISOString();await record(sb,worker,{started_at:started,status:'running'});
 try{const result=await run();const failed=(result.failed||[]).length;await record(sb,worker,{finished_at:new Date().toISOString(),status:failed?'attention':'healthy',failed_count:failed});return result;}
 catch(error){await record(sb,worker,{finished_at:new Date().toISOString(),status:'failed',failed_count:null});throw error;}
}
module.exports={observeWorker};
