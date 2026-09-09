'use strict';
const {respond}=require('./auth');
const {isCalendarEligible}=require('./google-calendar');
const {easternInstant}=require('./business-time');
const {isQaRecord}=require('./record-policy');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function calendarIntentStatus(session, action) {
  const hasEvent = Boolean(session?.google_calendar_event_id);
  if (action === 'reschedule') {
    return hasEvent ? 'reschedule_pending' : (isCalendarEligible(session) ? 'pending' : 'not_requested');
  }
  if (action === 'cancel') {
    return hasEvent ? 'cancel_pending' : 'cancelled';
  }
  return session?.google_calendar_status || 'not_requested';
}
async function change(sb,session,body,actor){
 if(body.confirmed!==true)return respond(400,{error:'Explicit confirmation is required.'});
 if(!UUID.test(body.request_id||''))return respond(400,{error:'A request identifier is required.'});
 // Controlled QA appointments may be cancelled through their signed lifecycle
 // path so their availability and Calendar state are cleaned up atomically.
 // Rescheduling QA records remains blocked to prevent test data from being
 // repurposed as a live appointment.
 if(isQaRecord(session)&&body.action!=='cancel')return respond(409,{error:'Test appointments cannot be rescheduled here.'});
 if(!['reschedule','cancel'].includes(body.action))return respond(400,{error:'Unsupported appointment action.'});
 if(body.action==='reschedule'&&!easternInstant(body.new_date,body.new_time))return respond(400,{error:'Enter a valid, unambiguous Eastern date and time.'});
 if(!body.expected_date||!body.expected_time)return respond(400,{error:'Reload the appointment before changing it.'});
 const {data,error}=await sb.rpc('practitioner_appointment_change',{p_id:session.id,p_action:body.action,p_expected_date:body.expected_date,p_expected_time:body.expected_time,p_date:body.action==='reschedule'?body.new_date:null,p_time:body.action==='reschedule'?body.new_time:null,p_actor:actor,p_reason:String(body.reason||'').slice(0,500),p_request:body.request_id,p_slot:body.new_slot_id||null});
 if(error)return respond(409,{error:'The appointment could not be changed. Reload and check that the destination is available.'});
 const nextSession = data?.session || {};
 const calendar_status = nextSession.google_calendar_status || calendarIntentStatus(nextSession, body.action);
 return respond(200,{...data,[body.action==='cancel'?'cancelled':'rescheduled']:true,communication_status:'Queued subject to contact and communication policy',calendar_status});
}
async function retryCalendar(sb,session,body,actor){
 if(!UUID.test(body.request_id||''))return respond(400,{error:'A request identifier is required.'});
 if(isQaRecord(session))return respond(409,{error:'Test appointments cannot be changed here.'});
 if(['cancelled','completed','no_show'].includes(String(session.status||'').toLowerCase()))return respond(409,{error:'This appointment cannot be retried.'});
 const retryable=['failed','error','retryable_error'];
 if(!retryable.includes(String(session.google_calendar_status||'').toLowerCase())){
  const alreadyQueued=['pending','reschedule_pending'].includes(String(session.google_calendar_status||'').toLowerCase());
  if(alreadyQueued)return respond(200,{session,calendar_status:session.google_calendar_status,duplicate:true});
  return respond(409,{error:'This appointment has no retryable Calendar failure.'});
 }
 const next=session.google_calendar_event_id?'reschedule_pending':'pending';
 const {data,error}=await sb.from('sessions').update({google_calendar_status:next,google_calendar_error:null}).eq('id',session.id).in('google_calendar_status',retryable).select().maybeSingle();
 if(error) return respond(409,{error:'The Calendar retry could not be queued. Reload and try again.'});
 if(!data)return respond(200,{session,calendar_status:session.google_calendar_status,duplicate:true});
 return respond(200,{session:data,retried:true,calendar_status:next,request_id:body.request_id,actor});
}
module.exports={change,retryCalendar};
