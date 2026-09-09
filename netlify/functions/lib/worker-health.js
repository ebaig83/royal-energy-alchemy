'use strict';
// Best-effort telemetry; never changes the outcome of an existing worker job.
async function record(sb,worker,patch){try{const {error}=await sb.from('worker_health').upsert({worker,...patch},{onConflict:'worker'});if(error)console.warn('[worker-health] write failed',worker,error.code||'unknown');return !error;}catch(error){console.warn('[worker-health] write failed',worker,error.code||'unknown');return false;}}
async function observeWorker(sb,worker,run){
 const started=new Date().toISOString();await record(sb,worker,{started_at:started,status:'running'});
 try{const result=await run();const failed=(result.failed||[]).length;await record(sb,worker,{finished_at:new Date().toISOString(),status:failed?'attention':'healthy',failed_count:failed,scanned_count:Number.isFinite(Number(result.scanned))?Number(result.scanned):null,processed_count:Number.isFinite(Number(result.processed??result.parsed))?Number(result.processed??result.parsed):null,error_summary:null});return result;}
 catch(error){await record(sb,worker,{finished_at:new Date().toISOString(),status:'failed',failed_count:null,error_summary:'worker_run_failed'});throw error;}
}
module.exports={observeWorker};
