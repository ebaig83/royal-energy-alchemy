'use strict';
const normalized=v=>String(v||'').trim().toLowerCase();
function isQa(r){if(!r)return false;const name=r.client_name||r.full_name||'';return r.is_test===true||['qa','qa_auto','qa_financial','qa_migration_check','qa_test','test','demo','seed','controlled_test','controlled_google_meet_test','workflow_audit'].includes(normalized(r.source))||(Array.isArray(r.tags)?r.tags:[]).some(t=>['qa','test','seed','demo','controlled-test'].includes(normalized(t)))||/\[qa\]|^QA(?:\s|-)|^test$|^Sprint Test Client$|^SPRINT \d+[A-Z]? TEST|^__sprint\d+_verify__$|^__match_(?:probe|flow_test)__$|^Brand New Person \d{13}$|^(?:Jordan Sandbox|Stripe Sandbox Test|Jordan Live Verification) \d{8}$|^Google Meet Test$/i.test(name);}
function filterData(d,includeQA=false){
 const clients=new Map(d.clients.map(c=>[c.id,c])),sessions=new Map(d.sessions.map(s=>[s.id,s]));
 const bad=r=>isQa(r)||isQa(clients.get(r.client_id))||isQa(sessions.get(r.session_id||r.related_session_id))||isQa(clients.get(sessions.get(r.session_id||r.related_session_id)?.client_id));
 const result={...d};for(const key of ['clients','sessions','payments','ledger','communications','aftercare'])result[key]=(d[key]||[]).map(r=>({...r,is_test:bad(r)})).filter(r=>includeQA||!r.is_test);
 result.relationships=(d.relationships||[]).filter(r=>includeQA||(!isQa(clients.get(r.client_id))&&!isQa(clients.get(r.related_client_id))));return result;
}
function contactClass(c,sessions,now=new Date()){
 if(isQa(c))return 'QA/test';
 if(c.tags?.includes('identity-linkage-pending'))return 'Descriptive/relationship client';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const rows=sessions.filter(s=>s.client_id===c.id),current=rows.some(s=>s.session_date>=today&&!['cancelled','completed','no_show'].includes(s.status));
 const contact=!!(c.email||c.phone);
 if(!current&&!contact&&(rows.length||/planner/.test(c.source||'')||/planner/.test(c.notes||'')))return 'Historical planner client — contact unknown';
 return contact?'Current client — contact complete':'Current client — contact missing';
}
function diagnostics(d,env={},now=new Date(),heartbeats=[]){
 const live=filterData(d),calendar=live.sessions.filter(s=>s.source!=='manual_planner_import_20260905'&&/error|failed/.test(s.google_calendar_status||''));
 const stuck=live.sessions.filter(s=>s.source!=='manual_planner_import_20260905'&&['pending','reschedule_pending','cancel_pending'].includes(s.google_calendar_status));
 const failures=live.communications.filter(m=>m.status==='failed');
 const configured=(keys)=>keys.every(k=>!!env[k]);
 const pending=(name,keys,detail)=>({name,status:env.P1_LOCAL_REVIEW?'Degraded':configured(keys)?'Degraded':'Not Configured',detail:env.P1_LOCAL_REVIEW?'Production provider configuration is not exposed to this local review. Saved workflow observations are available.':configured(keys)?detail:'Required server configuration is missing.'});
 const workerHealth=(worker)=>{const row=heartbeats.find(h=>h.worker===worker);if(!row)return {status:'Degraded',detail:'No durable heartbeat is available. Migration and worker rollout await approval.'};const age=now-new Date(row.finished_at||row.started_at);if(!Number.isFinite(age)||age>15*60*1000)return {status:'Degraded',detail:'Worker heartbeat is stale or incomplete.'};if(['failed','attention'].includes(row.status))return {status:'Attention Needed',detail:'The last worker run reported failures.'};if(row.status==='running')return {status:'Degraded',detail:'Worker run is in progress; completion is not confirmed.'};return {status:'Healthy',detail:'Worker completed within the last 15 minutes.'};};
 return {checked_at:now.toISOString(),counts:{failedCalendar:calendar.length,stuckWorkflows:stuck.length,failedCommunications:failures.length},services:[
 {...pending('Stripe',['STRIPE_SECRET_KEY'],'Configured; live provider connectivity has not been probed.'),mode:/^(?:sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||'')?'LIVE':env.STRIPE_SECRET_KEY?'NOT LIVE':'Unknown'},
 pending('Stripe webhook',['STRIPE_WEBHOOK_SECRET'],'Signing secret configured; subscription/delivery health requires provider verification.'),
 {...pending('Google Calendar',['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_CALENDAR_ID'],'Configured; saved session state is available, provider access is not probed.'),...(calendar.length?{status:'Attention Needed',detail:calendar.length+' saved Calendar failures need review.'}:{})},
 {name:'Calendar worker',...workerHealth('calendar')},
 {name:'Communications worker',...workerHealth('communications')},
 pending('Email provider',['RESEND_API_KEY','FROM_EMAIL'],'Configured; delivery history is available. No test email or provider probe was sent.'),
 {name:'Supabase/database',status:'Healthy',detail:'Authenticated read completed successfully.'}
 ]};
}
module.exports={isQa,filterData,contactClass,diagnostics};
