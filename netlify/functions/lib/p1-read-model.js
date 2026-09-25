'use strict';
const FIELDS={
 clients:'id,full_name,email,phone,address,date_of_birth,emergency_contact,additional_information,preferred_contact,source,status,notes,tags,created_at,merged_into_client_id,merged_at,merged_by',
 session_service_addresses:'session_id,address_line1,address_line2,city,state,postal_code,country',
 sessions:'id,client_id,client_name,client_email,client_phone,service,session_date,session_time,duration_minutes,location_type,status,booking_status,payment_status,amount_due,amount_paid,payment_method,payment_reference,payment_note,payment_source,payment_hold_expires_at,source,seller_notes,created_at,intake_status,waiver_status,waiver_completed,google_calendar_status,google_meet_url',
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
  const u=new URL('/rest/v1/'+table,base);u.search=new URLSearchParams({select:FIELDS[table],order:table==='session_service_addresses'?'session_id.asc':'id.asc',offset:String(offset),limit:'500'});
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
 const canonicalClients=new Map(d.clients.map(c=>[c.id,c]));
 // Current UI identity comes from clients.id; snapshots remain historical evidence.
 // Resolve soft-merged links without exposing the duplicate as an active profile.
 const resolveCurrentClient=id=>{const seen=new Set();let client=id?canonicalClients.get(id):null;while(client?.merged_into_client_id&&!seen.has(client.id)){seen.add(client.id);client=canonicalClients.get(client.merged_into_client_id)||null;}return client?.full_name||null;};
 const withCurrentIdentity=row=>{const current=resolveCurrentClient(row.client_id);const historical=row.historical_client_name||row.client_name||null;return {...row,client_display_name:current||historical,historical_client_name:historical,client_name:current||historical||null};};
 const payments=new Map(d.payments.map(p=>[p.id,p]));
 const addresses=new Map(d.session_service_addresses.map(a=>[a.session_id,{service_address_line1:a.address_line1,service_address_line2:a.address_line2,service_city:a.city,service_state:a.state,service_postal_code:a.postal_code,service_country:a.country}]));
 return {preview:false,fullHistory:true,now:new Date().toISOString(),coverage:'Complete paginated Supabase reads · refreshed when the page loads · provider heartbeats not checked',errors:[],
  clients:d.clients.filter(c=>!c.merged_into_client_id),sessions:d.sessions.map(s=>{const client=canonicalClients.get(s.client_id);const session={...s,...(addresses.get(s.id)||{}),client_email:s.client_email||client?.email||null,client_phone:s.client_phone||client?.phone||null};const gate=require('./booking-state');const website=gate.isWebsiteBooking(session);const operational=gate.isOperationalAppointment(session);return {...withCurrentIdentity(session),operational_eligible:operational,incomplete_booking:website&&!gate.isOperationalWebsiteBooking(session)&&!gate.isExpiredWebsiteBooking(session)&&!gate.isPendingWebsiteBooking(session),pending_payment:gate.isPendingWebsiteBooking(session),expired_request:gate.isExpiredWebsiteBooking(session),session_notes:d.session_notes.filter(n=>n.session_id===s.id)};}),
  ledger:d.ledger_entries.filter(l=>!l.deleted_at).map(l=>({...withCurrentIdentity(l),payment_method:payments.get(l.related_payment_id)?.method||null})),
  communications:d.communications.map(m=>({...withCurrentIdentity(m),error_message:m.status==='failed'?'Delivery failed. Detailed provider diagnostics are not connected.':null})),
  payments:d.payments.map(withCurrentIdentity),aftercare:d.aftercare.map(withCurrentIdentity),relationships:d.client_relationships};
}

module.exports={FIELDS,readTable,readReconciliation,project};
