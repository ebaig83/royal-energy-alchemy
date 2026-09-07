'use strict';
const {isSilentPlannerImport,isQaRecord}=require('./record-policy');
const {sendWithPreferences}=require('./comms');
const {appointmentManageUrl}=require('./appointment-token');
async function processNotices(sb,send=sendWithPreferences){
 const {data:rows,error}=await sb.from('appointment_notices').select('*').eq('status','pending').order('created_at').limit(25);if(error)throw Error('Appointment notice queue unavailable');
 const result={sent:0,skipped:0,waiting:0,failed:0};
 for(const row of rows||[]){try{
  const {data:s,error:sessionError}=await sb.from('sessions').select('*').eq('id',row.session_id).single();if(sessionError||!s)throw Error();
  let finish;
  if(isQaRecord(s)||isSilentPlannerImport(s))finish='suppressed';
  else if(row.action==='reschedule'&&(s.status==='cancelled'||s.session_date!==row.new_date||s.session_time!==row.new_time))finish='superseded';
  else if(row.action==='cancel'&&s.status!=='cancelled')finish='superseded';
  else if(s.google_calendar_event_id&&!['ready','cancelled'].includes(s.google_calendar_status)){result.waiting++;continue;}
  if(!finish){const {data:c,error:clientError}=await sb.from('clients').select('email,email_consent').eq('id',s.client_id).maybeSingle();if(clientError)throw Error();
   if(!c?.email||c.email_consent===false)finish='no_contact_or_consent';
   else {const response=await send(sb,{templateName:row.action==='reschedule'?'appointment_rescheduled':'appointment_cancelled',recipientEmail:c.email,clientId:s.client_id,sessionId:s.id,idempotencyKey:'appointment-change:'+row.id,metadata:{session_id:s.id,appointment_change_id:row.id,trigger:'practitioner_'+row.action},variables:{client_name:s.client_name,service:s.service,old_date:row.old_date,old_time:row.old_time,new_date:row.new_date,new_time:row.new_time,session_date:s.session_date,session_time:s.session_time,timezone:'ET',duration_minutes:s.duration_minutes,duration:s.duration_minutes||60,location_type:s.location_type,google_meet_url:/^https:\/\/meet\.google\.com\/[a-z-]+$/.test(s.google_meet_url||'')?s.google_meet_url:'',manage_url:appointmentManageUrl(s.id),contact_email:process.env.ADMIN_EMAIL||'droyal168@gmail.com',refund_summary:'Cancellation does not automatically issue a refund.',policy_line_1:'Contact Daron with any questions.',policy_line_2:'',policy_line_3:'',policy_line_4:''}});
    if(response.sent||response.duplicate||response.status==='sent')finish='sent';else if(response.reason==='consent_declined')finish='suppressed';else{result.waiting++;continue;}
   }
  }
  const {error:updateError}=await sb.from('appointment_notices').update({status:finish}).eq('id',row.id);if(updateError)throw Error();result[finish==='sent'?'sent':'skipped']++;
 }catch{result.failed++;}}
 return result;
}
module.exports={processNotices};
