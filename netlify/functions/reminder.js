'use strict';

// ── /.netlify/functions/reminder ──────────────────────────────────────────────
// ADMIN GET — trigger appointment reminders for sessions in the next 24 hours.
//
// ?dry_run=1   — list sessions that would receive reminders without sending
// ?hours=N     — look-ahead window in hours (default 24, max 72)
//
// Designed to be called by a scheduled Netlify cron job or from the dashboard.
// Prevents duplicate sends by checking communications table for existing reminders.

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { sendWithPreferences }   = require('./lib/comms');
const { reminderFailure }       = require('./lib/ops-alert');
const { appointmentManageUrl }  = require('./lib/appointment-token');

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const dryRun = !!params.dry_run;
  const hours  = Math.min(parseInt(params.hours) || 24, 72);

  // ── Find sessions in the look-ahead window ────────────────────────────────
  const now     = new Date();
  const cutoff  = new Date(now.getTime() + hours * 3600000);

  const todayStr   = now.toISOString().slice(0, 10);
  const cutoffStr  = cutoff.toISOString().slice(0, 10);

  const { data: sessions, error: sessErr } = await sb
    .from('sessions')
    .select('id, client_id, client_name, service, session_date, session_time, status, reminder_sent, reminder_sent_at')
    .gte('session_date', todayStr)
    .lte('session_date', cutoffStr)
    .in('status', ['pending', 'confirmed'])
    .eq('reminder_sent', false)          // skip if already sent
    .order('session_date', { ascending: true });

  if (sessErr) return respond(500, { error: sessErr.message });

  const candidates = (sessions || []).filter(s => {
    // If session is today, only include if session_time is ≥ now
    if (s.session_date === todayStr && s.session_time) {
      const [hh, mm] = s.session_time.split(':').map(Number);
      const sessionMs = new Date(todayStr).setHours(hh, mm, 0, 0);
      return sessionMs > now.getTime();
    }
    return true;
  });

  if (dryRun) {
    return respond(200, { dry_run: true, would_remind: candidates.length, sessions: candidates });
  }

  const sent    = [];
  const skipped = [];
  const failed  = [];

  for (const session of candidates) {
    try {
      // Dedup: check if reminder already logged in communications
      const { data: existing } = await sb
        .from('communications')
        .select('id')
        .eq('message_type', 'appointment_reminder')
        .contains('metadata', { session_id: session.id })
        .limit(1);

      if (existing && existing.length > 0) {
        skipped.push({ session_id: session.id, reason: 'already_logged_in_communications' });
        continue;
      }

      // Fetch client email
      let clientEmail = null;
      if (session.client_id) {
        const { data: client } = await sb
          .from('clients')
          .select('email')
          .eq('id', session.client_id)
          .single();
        clientEmail = client?.email || null;
      }

      if (!clientEmail) {
        skipped.push({ session_id: session.id, reason: 'no_client_email' });
        continue;
      }

      const manageUrl = appointmentManageUrl(session.id, { siteUrl: SITE_URL });
      const timeStr   = session.session_time ? session.session_time.slice(0, 5) : '';

      const result = await sendWithPreferences(sb, {
        templateName:   'appointment_reminder',
        recipientEmail: clientEmail,
        clientId:       session.client_id || null,
        sessionId:      session.id,
        messageType:    'appointment_reminder',
        variables: {
          client_name:  session.client_name || '',
          service:      session.service     || '',
          session_date: session.session_date,
          session_time: timeStr,
          timezone:     'ET',
          manage_url:   manageUrl,
          contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
        },
        metadata: { trigger: 'reminder_job', session_id: session.id },
      });

      if (result && result.skipped && result.reason === 'email_consent_off') {
        skipped.push({ session_id: session.id, reason: 'email_consent_off', preferred_contact: result.preferred_contact });
        // Still mark reminder_sent so we don't retry email — manual outreach already logged
        await sb.from('sessions').update({ reminder_sent: true, reminder_sent_at: new Date().toISOString() }).eq('id', session.id);
        continue;
      }

      // Mark reminder sent on session
      await sb.from('sessions').update({
        reminder_sent:    true,
        reminder_sent_at: new Date().toISOString(),
      }).eq('id', session.id);

      sent.push({ session_id: session.id, client_id: session.client_id, email: clientEmail });

    } catch (e) {
      await reminderFailure(sb, { clientId: session.client_id, sessionId: session.id, error: e });
      failed.push({ session_id: session.id, error: e.message });
    }
  }

  return respond(200, {
    triggered:   candidates.length,
    sent:        sent.length,
    skipped:     skipped.length,
    failed:      failed.length,
    details:     { sent, skipped, failed },
  });
};
