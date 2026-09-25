export const IMPORT='manual_planner_import_20260905';
export const AREAS=['Today','Clients','Schedule','Communications','Finance','Content Studio','System'];
export const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)):'—';
export function dateKey(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function clockKey(now=new Date()){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}
export function time(t){if(!t)return 'Time not recorded';if(!validTimeValue(t))return 'Time needs review';const [h,m]=String(t).split(':');return `${+h%12||12}:${m} ${+h<12?'AM':'PM'}`;}
export function date(d){if(!d)return 'Date not recorded';const value=String(d).slice(0,10);if(!validDateValue(value))return 'Date needs review';return new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});}
export const appointmentInstant=s=>easternInstant(s?.session_date,s?.session_time);
export const validAppointmentDateTime=s=>!!appointmentInstant(s);
export const stamp=s=>validAppointmentDateTime(s)?`${s.session_date}T${s.session_time}`:'';
// Legacy QA signatures affect visibility only; no identity merging or database edits.
export const legacyQA=r=>/^(?:__match_(?:probe|flow_test)__|Brand New Person \d{13}|(?:Jordan Sandbox|Stripe Sandbox Test) \d{8}|Google Meet Test)$/.test(r?.client_name||r?.full_name||'')||/^(?:QA(?:\s|-)|test$|Sprint Test Client$)/i.test(r?.client_name||r?.full_name||'');
export const qa=r=>!!r&&(legacyQA(r)||r.is_test===true||['qa','qa_auto','qa_financial','qa_migration_check','qa_test','test','demo','seed','controlled_test','controlled_google_meet_test','workflow_audit'].includes(String(r.source||'').trim().toLowerCase())||(r.tags||[]).some(t=>['qa','test','seed','demo','controlled-test'].includes(String(t).trim().toLowerCase()))||/\[qa\]/i.test(r.client_name||r.full_name||''));
export const silent=s=>[IMPORT,'manual_planner_calendar_20260907'].includes(s.source);
export const websiteBooking=s=>['online','website','website_booking','website booking','website_form','booking'].includes(String(s?.source||'').trim().toLowerCase());
export const historical=(s,now)=>silent(s)||['historical_planner_reconciliation_20260902','planner-reconciliation'].includes(s.source)||(validAppointmentDateTime(s)&&s.session_date<dateKey(now));
export const active=s=>!['cancelled','expired','completed','no_show'].includes(String(s?.status||'').toLowerCase());
export const operational=s=>active(s)&&(websiteBooking(s)?s.operational_eligible===true:s.operational_eligible!==false);
export const pendingWebsite=s=>s.pending_payment===true;
export const incompleteWebsite=s=>s.incomplete_booking===true;
export const expiredWebsite=s=>s.expired_request===true;
export const future=(s,now)=>operational(s)&&validAppointmentDateTime(s)&&stamp(s)>=dateKey(now)+'T'+clockKey(now)+':00';
export function payment(s){if(silent(s))return /Paid (?:noted|notation):?\s*Yes|\$\d+ Paid/i.test(s.seller_notes||'')?['Paid noted in planner','amber']:['Payment unverified','muted'];return ({paid:['Paid','green'],partial:['Partial payment','amber'],complimentary:['Complimentary / no charge','purple'],refunded:['Refunded','purple'],partially_refunded:['Partially refunded','purple'],failed:['Payment failed','red'],unpaid:['Payment Needed','amber'],pending:['Payment pending','amber']})[s.payment_status]||['Payment unverified','muted'];}
export function waiver(s){return (s.waiver_completed===true||['complete','completed','signed'].includes(s.waiver_status))?['Waiver complete','green']:(s.waiver_completed===false||['needed','pending','sent','incomplete'].includes(s.waiver_status))&&!silent(s)?['Waiver Needed','amber']:['Waiver not recorded','muted'];}
export function intake(s){return ['complete','completed','submitted'].includes(s.intake_status)?['Intake complete','green']:!silent(s)&&['needed','pending','sent','incomplete'].includes(s.intake_status)?['Intake Needed','amber']:['Intake not recorded','muted'];}
export function appointment(s){if(websiteBooking(s)){if(expiredWebsite(s))return ['Hold expired · payment not completed','muted'];if(!operational(s))return String(s.payment_status||'').toLowerCase()==='paid'?['Payment received · review needed','amber']:['Payment required','amber'];return ['Confirmed','blue'];}return ({confirmed:['Confirmed','blue'],pending:['Pending confirmation','amber'],ready:['Confirmed','blue'],completed:['Completed','green'],cancelled:['Cancelled','muted'],expired:['Expired — payment not received','muted'],no_show:['Missed appointment','amber']})[s.status]||['Review appointment','muted'];}
export function meetURL(s){try{const u=new URL(s.google_meet_url);return u.protocol==='https:'&&u.hostname==='meet.google.com'?u.href:null;}catch{return null;}}
export function canJoin(s,now){return !historical(s,now)&&operational(s)&&s.payment_status==='paid'&&['distance','remote'].includes(s.location_type)&&!!meetURL(s);}
export function calendar(s,now){if(s.source==='manual_planner_calendar_20260907'){if(s.google_calendar_status==='ready')return ['Calendar Ready','green'];if(/error|failed/.test(s.google_calendar_status||''))return ['Sync Error','red'];return ['Calendar pending','muted'];}if(silent(s))return ['Automatic sync off','muted'];if(historical(s,now))return ['Historical','muted'];if(['retryable_error','failed','error'].includes(s.google_calendar_status))return ['Sync Error','red'];if(canJoin(s,now))return ['Meet Ready','green'];if(['in_person','in-person'].includes(s.location_type))return ['In person','muted'];return ['Meet not ready','muted'];}
export function needsAttention(s,now){return !historical(s,now)&&active(s)&&(payment(s)[1]==='amber'||payment(s)[1]==='red'||waiver(s)[0]==='Waiver Needed'||intake(s)[0]==='Intake Needed'||calendar(s,now)[0]==='Sync Error');}
export function forClient(rows,id){return rows.filter(r=>r.client_id===id);}
export function clientStats(c,sessions,now){const rows=forClient(sessions,c.id),scheduled=rows.filter(validAppointmentDateTime).slice().sort((a,b)=>stamp(a).localeCompare(stamp(b)));return {count:rows.length,next:scheduled.find(s=>future(s,now)),last:scheduled.filter(s=>stamp(s)<dateKey(now)+'T'+clockKey(now)+':00'&&s.status!=='cancelled').at(-1),attention:rows.some(s=>needsAttention(s,now))};}
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
 const balanceRows=sessions.filter(s=>s.session_date?.startsWith(month)&&!silent(s)&&active(s)&&['unpaid','pending','partial','failed'].includes(s.payment_status)&&s.amount_due!=null).map(s=>({id:s.id,amount:Math.max(0,cents(s.amount_due)-cents(s.amount_paid))/100}));
 return {collected,refunds,net:(cents(collected)-cents(refunds))/100,balances:total(balanceRows),balanceRows,manual:total(paid.filter(e=>e.payment_method&&e.payment_method!=='stripe')),stripe:total(paid.filter(e=>e.payment_method==='stripe')),ledgerOnly:total(paid.filter(e=>e.source_table==='ledger_entries')),plannerEvidence:total(evidence.filter(e=>e.kind==='planner'&&e.amount!=null)),manualEvidence:total(evidence.filter(e=>e.kind==='manual'&&e.amount!=null)),evidenceTotal:total(evidence.filter(e=>e.amount!=null)),evidenceUnknown:evidence.filter(e=>e.amount==null).length,evidence,rows};
}
export function practitionerReschedulable(s){return active(s)&&['pending','confirmed','ready'].includes(String(s.status||'').toLowerCase())&&!qa(s)&&!silent(s);}
export function eligibleActions(s,now){const actions=['View'];if(canJoin(s,now))actions.push('Join Meet');if(!qa(s)&&operational(s)){if(future(s,now)){actions.push('Manage','Reschedule','Cancel');if(s.payment_status!=='paid'&&s.waiver_completed===true)actions.push('Send Payment Link');if(s.payment_status==='paid'&&calendar(s,now)[0]==='Sync Error')actions.push('Retry Calendar');}else if(practitionerReschedulable(s)){actions.push('Reschedule');}}return actions;}

export const areaKey=name=>name.toLowerCase().replaceAll(' ','-');


const TIMEZONE = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
function parts(value) { return Object.fromEntries(formatter.formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])); }
function wallMillis(p) { return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second); }
function validDateValue(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return false;
 const [year,month,day]=String(value).split('-').map(Number),check=new Date(Date.UTC(year,month-1,day));
 return year>=1000&&check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===day;
}
function validTimeValue(value) {
 if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(String(value)))return false;
 const [hour,minute,second=0]=String(value).split(':').map(Number);
 return hour<=23&&minute<=59&&second<=59;
}
// Reject nonexistent spring-forward and ambiguous fall-back wall times rather
// than silently shifting a client appointment. Normal business hours are unique.
function easternInstant(date,time) {
 if (!validDateValue(date) || !validTimeValue(time)) return null;
 date=String(date);time=String(time);
 const [year,month,day]=date.split('-').map(Number),[hour,minute,second=0]=time.split(':').map(Number);
 const wall=Date.UTC(year,month-1,day,hour,minute,second),check=new Date(wall);
 const candidates=new Set();
 for(const hours of [-36,-12,0,12,36]) {
  const probe=wall+hours*3600000,offset=wallMillis(parts(new Date(probe)))-probe;
  const candidate=wall-offset;
  if(wallMillis(parts(new Date(candidate)))===wall)candidates.add(candidate);
 }
 return candidates.size===1?new Date([...candidates][0]):null;
}


export const DISPLAY_ZONES = [['America/New_York','Eastern'],['America/Chicago','Central'],['America/Denver','Mountain'],['America/Los_Angeles','Pacific'],['America/Phoenix','Arizona'],['Pacific/Honolulu','Hawaii'],['Europe/London','London'],['UTC','UTC']];
export function displayAppointment(session, zone='America/New_York') {
 if(!DISPLAY_ZONES.some(([id])=>id===zone))zone='America/New_York';
 const instant=easternInstant(session.session_date,session.session_time);
 if(!instant)return {date:date(session.session_date),time:time(session.session_time),zone:'Eastern · conversion unavailable',dateKey:session.session_date};
 return {date:new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric'}).format(instant),time:new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(instant),zone:new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'short'}).formatToParts(instant).find(p=>p.type==='timeZoneName').value,dateKey:new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(instant)};
}
