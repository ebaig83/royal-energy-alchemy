'use strict';
const TABLES={ideas:{table:'content_ideas',fields:'id,title,content_type,topic,summary,status,scheduled_date,priority,created_at,updated_at,deleted_at'},drafts:{table:'content_drafts',fields:'id,content_idea_id,title,content_type,draft_content,generation_method,status,created_at,updated_at,deleted_at'},sources:{table:'content_sources',fields:'id,source_type,source_title,source_url,source_summary,source_tags,source_date,created_at,updated_at,deleted_at'}};
const isTest=r=>/\[qa\]|^qa[\s_-]|^test(?:[\s_-]|$)|^sprint\s*\d+/i.test(r.title||r.source_title||'')||(r.source_tags||[]).some(t=>['qa','test','seed','demo'].includes(String(t).toLowerCase()));
async function readContent(base,key,{includeQA=false,fetchImpl=fetch}={}){
 const result={ideas:[],drafts:[],sources:[],errors:[],readOnly:true};
 await Promise.all(Object.entries(TABLES).map(async([kind,meta])=>{try{const rows=[];for(let offset=0;;offset+=500){const u=new URL('/rest/v1/'+meta.table,base);u.search=new URLSearchParams({select:meta.fields,deleted_at:'is.null',order:'id.asc',offset:String(offset),limit:'500'});const r=await fetchImpl(u,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('unavailable');const batch=await r.json();if(!Array.isArray(batch))throw Error('invalid');rows.push(...batch);if(batch.length<500)break;}result[kind]=rows.filter(r=>!r.deleted_at&&(includeQA||!isTest(r))).map(r=>Object.fromEntries(meta.fields.split(',').filter(k=>k!=='deleted_at').map(k=>[k,r[k]??null])));}catch{result.errors.push(kind+' could not be loaded. No sample records were substituted.');}}));
 return result;
}
module.exports={readContent,isTest,TABLES};
