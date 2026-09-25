'use strict';
const { observeWorker } = require('./lib/worker-health');

const { getClient } = require('./lib/supabase');
const { isSilentPlannerImport, isReviewedPlannerCalendar, isQaRecord } = require('./lib/record-policy');
const { sendWithPreferences } = require('./lib/comms');
const { syncSession, sanitizeError, createGoogleCalendarApi } = require('./lib/google-calendar');
const { isWebsiteBooking, isOperationalWebsiteBooking, attachServiceAddress } = require('./lib/booking-state');

const ACTIONABLE_STATUSES = ['pending', 'retryable_error', 'reschedule_pending', 'cancel_pending'];

async function sendMeetingReady(sb, session, send = sendWithPreferences) {
  if (isSilentPlannerImport(session)) return { skipped: true, reason: 'silent_planner_import' };
  if (isWebsiteBooking(session) && !isOperationalWebsiteBooking(session)) return { skipped: true, reason: 'website_booking_not_operational' };
  if (!session.google_meet_url) return { skipped: true, reason: 'meet_not_ready' };
  let email = session.client_email || null;
  if (!email && session.client_id) {
    const { data: client } = await sb.from('clients').select('email').eq('id', session.client_id).single();
    email = client?.email || null;
  }
  if (!email) return { skipped: true, reason: 'no_client_email' };
  const correlationId=session.correlation_id||require('crypto').randomUUID();
  return send(sb, {
    templateName: 'session_google_meet_ready', recipientEmail: email, clientId: session.client_id || null, sessionId: session.id,
    messageType: 'appointment_meeting_ready', idempotencyKey: `session-google-meet-ready:${session.id}`,
    variables: { client_name: session.client_name || '', service: session.service || '', session_date: session.session_date, session_time: String(session.session_time || '').slice(0, 5), timezone: 'ET', google_meet_url: session.google_meet_url },
    metadata: { session_id: session.id, automation: 'session_google_meet_ready', notification_type: 'appointment_meeting_ready', correlation_id: correlationId },
  });
}

async function processPending({ sb, api, limit = 25, now = () => new Date(), send = sendWithPreferences, syncOptions = {} } = {}) {
  if (!sb || !api) throw new Error('Dependencies required');
  const { data, error } = await sb.from('sessions').select('*').in('google_calendar_status', ACTIONABLE_STATUSES).limit(limit);
  if (error) throw error;
  const inPersonIds=(data||[]).filter(s=>isWebsiteBooking(s)&&['in_person','in-person'].includes(String(s.location_type||'').toLowerCase())).map(s=>s.id);
  let addressBySession=new Map();
  if(inPersonIds.length){const {data:addresses,error:addressError}=await sb.from('session_service_addresses').select('session_id,address_line1,address_line2,city,state,postal_code,country').in('session_id',inPersonIds);if(addressError)throw addressError;addressBySession=new Map((addresses||[]).map(a=>[a.session_id,a]));}
  const candidates=(data||[]).map(s=>attachServiceAddress(s,addressBySession.get(s.id)));
  const results = { synced: [], failed: [], notifications: [] };
  for (const session of candidates.filter(s => (!isQaRecord(s) && s.google_calendar_event_id && ['cancel_pending','reschedule_pending'].includes(s.google_calendar_status)) || isReviewedPlannerCalendar(s) || s.source === 'manual_practitioner_calendar' || (!isSilentPlannerImport(s) && (isWebsiteBooking(s) ? isOperationalWebsiteBooking(s) : String(s.payment_status || '').toLowerCase() === 'paid')))) {
    const correlationId=require('crypto').randomUUID();
    try {
      const result = await syncSession(session, api, syncOptions);
      const patch = {
        google_calendar_event_id: result.eventId || null,
        google_calendar_status: result.status,
        google_calendar_error: null,
        google_calendar_synced_at: now().toISOString(),
      };
      if (result.meetUrl) patch.google_meet_url = result.meetUrl;
      else if (result.operation === 'cancel') patch.google_meet_url = null;
      const { data: mutation, error: updateError } = await sb.rpc('trusted_session_update_with_audit', { p_id: session.id, p_updates: patch, p_actor_type: 'system', p_actor_id: 'session-calendar-sync', p_actor_email: null, p_source: 'calendar-worker', p_action: 'calendar_sync_completed', p_correlation_id: correlationId, p_request_path: '/.netlify/functions/session-calendar-sync' });
      if (updateError || !mutation?.session) throw updateError || new Error('Calendar state was not committed.');
      console.info('[session-calendar-sync] appointment mutation', JSON.stringify({ session_id: session.id, correlation_id: correlationId, actor_type: 'system', source: 'calendar-worker', action: 'calendar_sync_completed' }));
      if (result.status === 'ready' && session.google_calendar_status !== 'ready') {
        try {
          const notification = await sendMeetingReady(sb, { ...session, ...patch, correlation_id: correlationId }, send);
          results.notifications.push({ id: session.id, sent: notification?.sent === true, skipped: notification?.skipped === true });
        } catch (notificationError) {
          results.notifications.push({ id: session.id, sent: false, failed: true });
          console.error('[session-calendar-sync] meeting-ready notification failed', session.id, sanitizeError(notificationError));
        }
      }
      results.synced.push({ id: session.id, status: result.status, operation: result.operation });
    } catch (error) {
      const message = sanitizeError(error);
      const status = error?.retryable ? 'retryable_error' : 'failed';
      const {error:updateError}=await sb.rpc('trusted_session_update_with_audit',{p_id:session.id,p_updates:{google_calendar_status:status,google_calendar_error:message,updated_at:now().toISOString()},p_actor_type:'system',p_actor_id:'session-calendar-sync',p_actor_email:null,p_source:'calendar-worker',p_action:'calendar_sync_failed',p_correlation_id:correlationId,p_request_path:'/.netlify/functions/session-calendar-sync'});
      if(updateError)throw updateError;
      results.failed.push({ id: session.id, reason: 'sync_failed', retryable: Boolean(error?.retryable) });
      console.error('[session-calendar-sync] session failed', session.id, message);
    }
  }
  return results;
}

exports.config = { schedule: '*/5 * * * *' };
exports.ACTIONABLE_STATUSES = ACTIONABLE_STATUSES;
exports.sendMeetingReady = sendMeetingReady;
exports.processPending = processPending;
exports.handler = async () => {
  try { return { statusCode: 200, body: JSON.stringify(await observeWorker(getClient(), 'calendar', () => processPending({ sb: getClient(), api: createGoogleCalendarApi() }))) }; }
  catch (error) { console.error('[session-calendar-sync]', sanitizeError(error)); return { statusCode: 500, body: JSON.stringify({ error: 'Calendar synchronization job failed.' }) }; }
};
