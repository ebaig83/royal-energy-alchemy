export const IMPORT='manual_planner_import_20260905';
export const AREAS=['Today','Clients','Schedule','Communications','Finance','System'];
export const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)):'—';
export function dateKey(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function clockKey(now=new Date()){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}
export function time(t){if(!t)return 'Time not recorded';const [h,m]=t.split(':');return `${+h%12||12}:${m} ${+h<12?'AM':'PM'}`;}
export function date(d){if(!d)return 'Date not recorded';return new Date(d.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});}
export const stamp=s=>s.session_date+'T'+s.session_time;
// Legacy QA signatures affect visibility only; no identity merging or database edits.
export const legacyQA=r=>/^(?:__match_(?:probe|flow_test)__|Brand New Person \d{13}|(?:Jordan Sandbox|Stripe Sandbox Test) \d{8}|Google Meet Test)$/.test(r?.client_name||r?.full_name||'')||/^(?:QA(?:\s|-)|test$|Sprint Test Client$)/i.test(r?.client_name||r?.full_name||'');
export const qa=r=>!!r&&(legacyQA(r)||r.is_test===true||['qa','qa_auto','qa_financial','qa_migration_check','qa_test','test','demo','seed','controlled_test','controlled_google_meet_test','workflow_audit'].includes(String(r.source||'').trim().toLowerCase())||(r.tags||[]).some(t=>['qa','test','seed','demo','controlled-test'].includes(String(t).trim().toLowerCase()))||/\[qa\]/i.test(r.client_name||r.full_name||''));
export const silent=s=>s.source===IMPORT;
export const historical=(s,now)=>silent(s)||['historical_planner_reconciliation_20260902','planner-reconciliation'].includes(s.source)||s.session_date<dateKey(now);
export const active=s=>!['cancelled','completed','no_show'].includes(s.status);
export const future=(s,now)=>active(s)&&stamp(s)>=dateKey(now)+'T'+clockKey(now)+':00';
export function payment(s){if(silent(s))return /Paid (?:noted|notation):?\s*Yes|\$\d+ Paid/i.test(s.seller_notes||'')?['Paid noted in planner','amber']:['Payment unverified','muted'];return ({paid:['Paid','green'],refunded:['Refunded','purple'],partially_refunded:['Partially refunded','purple'],failed:['Payment failed','red'],unpaid:['Payment Needed','amber'],pending:['Payment pending','amber']})[s.payment_status]||['Payment unverified','muted'];}
export function waiver(s){return (s.waiver_completed===true||['complete','completed','signed'].includes(s.waiver_status))?['Waiver complete','green']:(s.waiver_completed===false||['needed','pending','sent','incomplete'].includes(s.waiver_status))&&!silent(s)?['Waiver Needed','amber']:['Waiver not recorded','muted'];}
export function intake(s){return ['complete','completed','submitted'].includes(s.intake_status)?['Intake complete','green']:!silent(s)&&['needed','pending','sent','incomplete'].includes(s.intake_status)?['Intake Needed','amber']:['Intake not recorded','muted'];}
export function appointment(s){return ({confirmed:['Confirmed','blue'],pending:['Pending confirmation','amber'],ready:['Confirmed','blue'],completed:['Completed','green'],cancelled:['Cancelled','muted'],no_show:['Missed appointment','amber']})[s.status]||['Review appointment','muted'];}
export function meetURL(s){try{const u=new URL(s.google_meet_url);return u.protocol==='https:'&&u.hostname==='meet.google.com'?u.href:null;}catch{return null;}}
export function canJoin(s,now){return !historical(s,now)&&active(s)&&s.payment_status==='paid'&&['distance','remote'].includes(s.location_type)&&!!meetURL(s);}
export function calendar(s,now){if(silent(s))return ['Automatic sync off','muted'];if(historical(s,now))return ['Historical','muted'];if(['retryable_error','failed','error'].includes(s.google_calendar_status))return ['Sync Error','red'];if(canJoin(s,now))return ['Meet Ready','green'];if(['in_person','in-person'].includes(s.location_type))return ['In person','muted'];return ['Meet not ready','muted'];}
export function needsAttention(s,now){return !historical(s,now)&&active(s)&&(payment(s)[1]==='amber'||payment(s)[1]==='red'||waiver(s)[0]==='Waiver Needed'||intake(s)[0]==='Intake Needed'||calendar(s,now)[0]==='Sync Error');}
export function forClient(rows,id){return rows.filter(r=>r.client_id===id);}
export function clientStats(c,sessions,now){const rows=forClient(sessions,c.id).slice().sort((a,b)=>stamp(a).localeCompare(stamp(b)));return {count:rows.length,next:rows.find(s=>future(s,now)),last:rows.filter(s=>stamp(s)<dateKey(now)+'T'+clockKey(now)+':00'&&s.status!=='cancelled').at(-1),attention:rows.some(s=>needsAttention(s,now))};}
// All sums use integer cents. Payment dates use Eastern time; note evidence uses appointment month.
const cents=v=>Number.isFinite(Number(v))?Math.round(Number(v)*100):0;
const total=rows=>rows.reduce((sum,r)=>sum+cents(r.amount),0)/100;
const transactionDate=v=>v?(String(v).length===10?v:dateKey(new Date(v))):'';
export function paidEvidence(s){
 const note=String(s.seller_notes||'');
 const structured=/Paid (?:noted|notation):\s*Yes\b/i.test(note);
 const quoted=note.match(/\$([\d,]+(?:\.\d{1,2})?)\s+Paid\b/i);
 const amount=structured?note.match(/Amount noted:\s*\$([\d,]+(?:\.\d{1,2})?)/i):null;
 if(structured||quoted)return {explicit:true,amount:amount||quoted?Number((amount||quoted)[1].replace(/,/g,'')):null,kind:'planner'};
 if(silent(s))return {explicit:false,amount:null,kind:'planner'};
 // Other notes require an unambiguous affirmative payment clause with its own amount.
 const received=note.match(/(?:^|[.;]\s*)(?:Payment received|Paid)\s*:?\s*\$([\d,]+(?:\.\d{1,2})?)(?=\s|[.;]|$)/i);
 if(received)return {explicit:true,amount:Number(received[1].replace(/,/g,'')),kind:'manual'};
 if(s.payment_status==='paid'&&['manual','quick_log'].includes(s.source))return {explicit:true,amount:s.amount_paid==null?null:Number(s.amount_paid),kind:'manual'};
 return {explicit:false,amount:null,kind:'manual'};
}
export function finance(entries,sessions,month,transactions=[]){
 const ledger=entries.filter(e=>!e.deleted_at);
 const receipts=transactions.filter(p=>p.status==='received'&&p.paid_at);
 const paymentIds=new Set(receipts.map(p=>p.id));
 const paymentRows=receipts.map(p=>({id:'payment:'+p.id,client_id:p.client_id,entry_type:'payment',entry_date:transactionDate(p.paid_at),amount:p.amount,payment_method:p.method,source_table:'payments',related_session_id:p.session_id}));
 const uniqueLedger=ledger.filter(e=>e.entry_type!=='payment'||!paymentIds.has(e.related_payment_id)).map(e=>({...e,source_table:'ledger_entries'}));
 const refundLinks=new Set(ledger.filter(e=>e.entry_type==='refund').map(e=>e.related_payment_id).filter(Boolean));
 const refundRows=transactions.filter(p=>p.refunded_at&&Number(p.refunded_amount)>0&&!refundLinks.has(p.id)).map(p=>({id:'refund:'+p.id,client_id:p.client_id,entry_type:'refund',entry_date:transactionDate(p.refunded_at),amount:p.refunded_amount,payment_method:p.method,source_table:'payments'}));
 const rows=[...uniqueLedger,...paymentRows,...refundRows].filter(e=>String(e.entry_date||e.created_at).startsWith(month));
 const paid=rows.filter(e=>e.entry_type==='payment'),collected=total(paid),refunds=total(rows.filter(e=>e.entry_type==='refund').map(e=>({...e,amount:Math.abs(Number(e.amount))})));
 const linked=new Set([...receipts.map(p=>p.session_id),...ledger.filter(e=>e.entry_type==='payment').map(e=>e.related_session_id)].filter(Boolean));
 const evidence=sessions.filter(s=>s.session_date?.startsWith(month)&&s.status!=='cancelled'&&!linked.has(s.id)).map(s=>({id:s.id,date:s.session_date,name:s.client_name,...paidEvidence(s)})).filter(e=>e.explicit);
 const balanceRows=sessions.filter(s=>s.session_date?.startsWith(month)&&!silent(s)&&active(s)&&['unpaid','pending','failed'].includes(s.payment_status)&&s.amount_due!=null).map(s=>({id:s.id,amount:Math.max(0,cents(s.amount_due)-cents(s.amount_paid))/100}));
 return {collected,refunds,net:(cents(collected)-cents(refunds))/100,balances:total(balanceRows),balanceRows,manual:total(paid.filter(e=>e.payment_method&&e.payment_method!=='stripe')),stripe:total(paid.filter(e=>e.payment_method==='stripe')),ledgerOnly:total(paid.filter(e=>e.source_table==='ledger_entries')),plannerEvidence:total(evidence.filter(e=>e.kind==='planner'&&e.amount!=null)),manualEvidence:total(evidence.filter(e=>e.kind==='manual'&&e.amount!=null)),evidenceTotal:total(evidence.filter(e=>e.amount!=null)),evidenceUnknown:evidence.filter(e=>e.amount==null).length,evidence,rows};
}
export function eligibleActions(s,now){const actions=['View'];if(canJoin(s,now))actions.push('Join Meet');if(!historical(s,now)&&active(s)){actions.push('Manage','Reschedule','Cancel');if(s.payment_status!=='paid'&&s.waiver_completed===true)actions.push('Send Payment Link');if(s.payment_status==='paid'&&calendar(s,now)[0]==='Sync Error')actions.push('Retry Calendar');}return actions;}
