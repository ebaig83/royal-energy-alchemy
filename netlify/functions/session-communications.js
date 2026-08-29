'use strict';

// Scheduled, idempotent client communications for authoritative sessions.
// Netlify invokes this every five minutes; the exported processDue function is
// dependency-injectable for local contract tests and never requires production credentials.
const { getClient } = require('./lib/supabase');
const { sendWithPreferences } = require('./lib/comms');
const { pickTemplate } = require('./lib/followup-templates');
const { sessionStart, isActiveSession, isDue, followupDue, followupUrl } = require('./lib/session-communications');

async function processDue({ sb, now = new Date(), send = sendWithPreferences } = {}) {
  if (!sb) throw new Error('Supabase client is required');
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: sessions, error } = await sb.from('sessions')
    .select('id, client_id, client_name, service, session_date, session_time, duration_minutes, status, google_meet_url')
    .gte('session_date', from).lte('session_date', to);
  if (error) throw error;
  const sent = [], skipped = [], failed = [];
  for (const session of sessions || []) {
    try {
    if (!isActiveSession(session)) { skipped.push({ id: session.id, reason: 'inactive' }); continue; }
    const start = sessionStart(session);
    const reminder = isDue(start, now, 30);
    const followup = followupDue(session, now);
    if (!reminder && !followup) continue;
    const kind = reminder ? 'reminder' : 'followup';
    const messageType = reminder ? 'appointment_reminder' : 'followup_reminder';
    const templateName = reminder ? 'session_30_minute_reminder' : 'session_72_hour_followup';
    const { data: client } = await sb.from('clients').select('email').eq('id', session.client_id).single();
    if (!client?.email) { skipped.push({ id: session.id, reason: 'no_client_email', kind }); continue; }
    const { data: existing } = await sb.from('communications').select('id').eq('message_type', messageType).contains('metadata', { session_id: session.id, automation: templateName }).limit(1);
    if (existing?.length) { skipped.push({ id: session.id, reason: 'already_sent', kind }); continue; }
    let vars = { client_name: session.client_name || '', service: session.service || '', session_date: session.session_date, session_time: String(session.session_time || '').slice(0, 5), timezone: 'ET', contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com' };
    if (reminder && /^https:\/\/meet\.google\.com\//i.test(session.google_meet_url || '')) vars.google_meet_url = session.google_meet_url;
    if (followup) {
      const { data: existingFollowup } = await sb.from('aftercare').select('id, status, followup_template_used').eq('session_id', session.id).eq('followup_type', '72hr').limit(1);
      if (existingFollowup?.length && existingFollowup[0].status === 'completed') {
        skipped.push({ id: session.id, reason: 'followup_completed', kind });
        continue;
      }
      const template = existingFollowup?.[0]?.followup_template_used || pickTemplate('72hr');
      const row = existingFollowup?.[0] || (await sb.from('aftercare').insert({ session_id: session.id, client_id: session.client_id, client_name: session.client_name, followup_type: '72hr', scheduled_for: now.toISOString(), status: 'scheduled', channel: 'email', followup_template_used: template }).select('id').single()).data;
      if (!row?.id) throw new Error('Unable to create follow-up record');
      vars = { ...vars, followup_url: followupUrl(row.id, template), followup_type: '72hr' };
    }
    await send(sb, { templateName, recipientEmail: client.email, clientId: session.client_id, sessionId: session.id, messageType, variables: vars, metadata: { session_id: session.id, automation: templateName, notification_type: messageType }, idempotencyKey: `${templateName}:${session.id}:${session.session_date}:${String(session.session_time || '').slice(0, 5)}` });
    sent.push({ id: session.id, kind });
    } catch (error) {
      // Log only the session identifier and sanitized error message; never PII, tokens, or payloads.
      console.error('[session-communications] session failed', session?.id || 'unknown', String(error?.message || 'unknown error').replace(/(token|secret|key|password)=?\S*/gi, '$1=[redacted]'));
      failed.push({ id: session?.id || null, reason: 'processing_failed' });
    }
  }
  return { sent, skipped, failed };
}

exports.config = { schedule: '*/5 * * * *' };
exports.processDue = processDue;
exports.handler = async () => {
  try { return { statusCode: 200, body: JSON.stringify(await processDue({ sb: getClient() })) }; }
  catch (error) { console.error('[session-communications]', error.message); return { statusCode: 500, body: JSON.stringify({ error: 'Communication job failed.' }) }; }
};
