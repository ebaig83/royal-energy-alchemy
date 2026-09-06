'use strict';
const { observeWorker } = require('./lib/worker-health');

const { getClient } = require('./lib/supabase');
const { isSilentPlannerImport } = require('./lib/record-policy');
const { sendWithPreferences } = require('./lib/comms');
const { syncSession, sanitizeError, createGoogleCalendarApi } = require('./lib/google-calendar');

const ACTIONABLE_STATUSES = ['pending', 'retryable_error', 'reschedule_pending', 'cancel_pending'];

async function sendMeetingReady(sb, session, send = sendWithPreferences) {
  if (isSilentPlannerImport(session)) return { skipped: true, reason: 'silent_planner_import' };
  if (!session.google_meet_url) return { skipped: true, reason: 'meet_not_ready' };
  let email = session.client_email || null;
  if (!email && session.client_id) {
    const { data: client } = await sb.from('clients').select('email').eq('id', session.client_id).single();
    email = client?.email || null;
  }
  if (!email) return { skipped: true, reason: 'no_client_email' };
  return send(sb, {
    templateName: 'session_google_meet_ready', recipientEmail: email, clientId: session.client_id || null, sessionId: session.id,
    messageType: 'appointment_meeting_ready', idempotencyKey: `session-google-meet-ready:${session.id}`,
    variables: { client_name: session.client_name || '', service: session.service || '', session_date: session.session_date, session_time: String(session.session_time || '').slice(0, 5), timezone: 'ET', google_meet_url: session.google_meet_url },
    metadata: { session_id: session.id, automation: 'session_google_meet_ready', notification_type: 'appointment_meeting_ready' },
  });
}

async function processPending({ sb, api, limit = 25, now = () => new Date(), send = sendWithPreferences, syncOptions = {} } = {}) {
  if (!sb || !api) throw new Error('Dependencies required');
  const { data, error } = await sb.from('sessions').select('*').in('google_calendar_status', ACTIONABLE_STATUSES).limit(limit);
  if (error) throw error;
  const results = { synced: [], failed: [], notifications: [] };
  for (const session of (data || []).filter(s => !isSilentPlannerImport(s) && String(s.payment_status || '').toLowerCase() === 'paid')) {
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
      const { error: updateError } = await sb.from('sessions').update(patch).eq('id', session.id);
      if (updateError) throw updateError;
      if (result.status === 'ready' && session.google_calendar_status !== 'ready') {
        try {
          const notification = await sendMeetingReady(sb, { ...session, ...patch }, send);
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
      await sb.from('sessions').update({ google_calendar_status: status, google_calendar_error: message }).eq('id', session.id);
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
