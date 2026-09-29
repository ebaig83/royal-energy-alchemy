'use strict';
const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { respond } = require('./lib/auth');
const { sendWithPreferences } = require('./lib/comms');

exports.config = { schedule: '*/15 * * * *' };
exports.handler = async event => {
  if (event?.httpMethod && event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const sb = getClient();
  try {
    const { data: due, error } = await sb.rpc('schedule_booking_recovery', { p_now: new Date().toISOString() });
    if (error) throw error;
    const results = [];
    for (const item of due || []) {
      const { data: attempt } = await sb.from('booking_attempts').select('*').eq('id', item.attempt_id).maybeSingle();
      if (!attempt || !['incomplete','resumed'].includes(attempt.status) || Date.parse(attempt.expires_at) <= Date.now()) {
        await sb.rpc('record_booking_recovery_result', { p_event_id: item.id, p_status: 'suppressed', p_error: 'Attempt is no longer eligible.' });
        continue;
      }
      try {
        // Raw tokens exist only in this invocation. The database receives only
        // a SHA-256 digest, so a recovery email never exposes stored token data.
        const resumeToken = crypto.randomBytes(32).toString('hex');
        const { error: tokenError } = await sb.from('booking_resume_tokens').insert({ attempt_id: attempt.id, token_hash: crypto.createHash('sha256').update(resumeToken).digest('hex'), expires_at: attempt.expires_at });
        if (tokenError) throw tokenError;
        const result = await sendWithPreferences(sb, { templateName: 'booking_attempt_recovery', recipientEmail: attempt.client_email, clientId: attempt.client_id, variables: { client_name: `${attempt.client_first_name || ''} ${attempt.client_last_name || ''}`.trim(), service: attempt.service || '', resume_url: `${process.env.SITE_URL || ''}/book.html?resume=${encodeURIComponent(resumeToken)}` }, metadata: { attempt_id: attempt.id, reminder_number: item.reminder_number }, idempotencyKey: `booking-attempt-recovery:${item.id}` });
        await sb.rpc('record_booking_recovery_result', { p_event_id: item.id, p_status: 'sent', p_provider_message_id: result?.id || null });
        results.push({ id: item.id, status: 'sent' });
      } catch (sendError) {
        await sb.rpc('record_booking_recovery_result', { p_event_id: item.id, p_status: 'failed', p_error: sendError.message });
        results.push({ id: item.id, status: 'failed' });
      }
    }
    return respond(200, { scheduled: (due || []).length, results });
  } catch (error) {
    console.error('[booking-recovery]', error.message);
    return respond(500, { error: 'Booking recovery worker failed.' });
  }
};
