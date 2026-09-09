'use strict';
const FIELDS={
 clients:'id,full_name,email,phone,source,status,notes,tags,created_at',
 sessions:'id,client_id,client_name,service,session_date,session_time,duration_minutes,location_type,status,payment_status,amount_due,amount_paid,payment_method,payment_reference,payment_note,payment_source,source,seller_notes,created_at,intake_status,waiver_status,waiver_completed,google_calendar_status,google_meet_url',
 ledger_entries:'id,client_id,client_name,entry_type,amount,entry_date,created_at,related_session_id,related_payment_id,deleted_at',
 payments:'id,session_id,client_id,client_name,method,status,amount,paid_at,refunded_amount,refunded_at,refund_status',
 communications:'id,client_id,channel,message_type,recipient,subject,status,sent_at,created_at',
 aftercare:'id,session_id,client_id,client_name,status,scheduled_for,source',
 client_relationships:'id,client_id,related_client_id,relationship_type,relationship_label',
 session_notes:'id,session_id,client_id,content,created_at'
};
const RECONCILIATION_FIELDS='id,client_id,client_name,session_date,session_time,status,source,google_calendar_status,google_calendar_event_id,google_meet_url';
async function readTable(base,key,table){
 if(!FIELDS[table])throw Error('Unsupported resource');
 const rows=[];
 for(let offset=0;;offset+=500){
  const u=new URL('/rest/v1/'+table,base);u.search=new URLSearchParams({select:FIELDS[table],order:'id.asc',offset:String(offset),limit:'500'});
  const r=await fetch(u,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Read unavailable: '+table+' ('+r.status+')');
  const page=await r.json();if(!Array.isArray(page))throw Error('Invalid read response');rows.push(...page);if(page.length<500)return rows;
 }
}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;}
async function readReconciliation(base,key,{clientName,date,from,to}={}){
 const rows=[];
 for(let offset=0;;offset+=500){
  const params=new URLSearchParams({select:RECONCILIATION_FIELDS,order:'session_date.asc,session_time.asc,id.asc',offset:String(offset),limit:'500'});
  if(clientName)params.set('client_name','eq.'+clientName);
  if(date)params.set('session_date','eq.'+date);
  else {if(from)params.append('session_date','gte.'+from);if(to)params.append('session_date','lte.'+to);}
  const u=new URL('/rest/v1/sessions',base);u.search=params;
  const r=await fetch(u,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Read unavailable: sessions ('+r.status+')');
  const page=await r.json();if(!Array.isArray(page))throw Error('Invalid read response');
  rows.push(...page.map(s=>({session_id:s.id,client_id:s.client_id,client_name:s.client_name,session_date:s.session_date,session_time:s.session_time,status:s.status,source:s.source,google_calendar_status:s.google_calendar_status,has_google_calendar_event_id:!!s.google_calendar_event_id,has_google_meet_url:!!s.google_meet_url})));
  if(page.length<500)return rows;
 }
}
function project(raw){
 const d=Object.fromEntries(Object.entries(FIELDS).map(([t,fields])=>[t,(raw[t]||[]).map(r=>Object.fromEntries(fields.split(',').map(k=>[k,r[k]??null])))]));
 const payments=new Map(d.payments.map(p=>[p.id,p]));
 return {preview:false,fullHistory:true,now:new Date().toISOString(),coverage:'Complete paginated Supabase reads · refreshed when the page loads · provider heartbeats not checked',errors:[],
  clients:d.clients,sessions:d.sessions.map(s=>({...s,session_notes:d.session_notes.filter(n=>n.session_id===s.id)})),
  ledger:d.ledger_entries.filter(l=>!l.deleted_at).map(l=>({...l,payment_method:payments.get(l.related_payment_id)?.method||null})),
  communications:d.communications.map(m=>({...m,error_message:m.status==='failed'?'Delivery failed. Detailed provider diagnostics are not connected.':null})),
  payments:d.payments,aftercare:d.aftercare,relationships:d.client_relationships};
}

module.exports={FIELDS,readTable,readReconciliation,project};
