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
 const requestId=body.request_id;
 const correlationId=require('crypto').randomUUID();
 const trustedActor=actor;
 if(!trustedActor||!['practitioner','client'].includes(trustedActor.actor_type)||!trustedActor.actor_id||!trustedActor.actor_email||!['dashboard','manage_appointment'].includes(trustedActor.source))return respond(401,{error:'Verified appointment actor is required.'});
 const {data,error}=await sb.rpc('practitioner_appointment_change',{p_id:session.id,p_action:body.action,p_expected_date:body.expected_date,p_expected_time:body.expected_time,p_date:body.action==='reschedule'?body.new_date:null,p_time:body.action==='reschedule'?body.new_time:null,p_actor_type:trustedActor.actor_type,p_actor_id:trustedActor.actor_id,p_actor_email:trustedActor.actor_email,p_source:trustedActor.source,p_request_path:trustedActor.request_path,p_reason:String(body.reason||'').slice(0,500),p_request:requestId,p_correlation:correlationId,p_slot:body.new_slot_id||null});
 if(error){console.error('[practitioner-appointments] mutation failed',JSON.stringify({session_id:session.id,correlation_id:correlationId,source:trustedActor.source}));return respond(409,{error:'The appointment could not be changed. Reload and check that the destination is available.'});}
 const persistedCorrelationId=data?.correlation_id||correlationId;
 console.info('[practitioner-appointments] mutation',JSON.stringify({session_id:session.id,correlation_id:persistedCorrelationId,actor_type:trustedActor.actor_type,source:trustedActor.source,action:body.action}));
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
 if(!actor||actor.actor_type!=='practitioner'||actor.source!=='dashboard'||!actor.actor_id||!actor.actor_email)return respond(401,{error:'Verified practitioner context is required.'});
 const correlationId=require('crypto').randomUUID();
 const {data:result,error}=await sb.rpc('practitioner_update_session_with_audit',{p_id:session.id,p_updates:{google_calendar_status:next,google_calendar_error:null},p_actor_id:actor.actor_id,p_actor_email:actor.actor_email,p_request:correlationId,p_request_path:'/.netlify/functions/sessions'});
 if(error||!result?.session)return respond(409,{error:'The Calendar retry could not be queued. Reload and try again.'});
 return respond(200,{session:result.session,retried:true,calendar_status:next,request_id:body.request_id,correlation_id:correlationId});
}
module.exports={change,retryCalendar};
