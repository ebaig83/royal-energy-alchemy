'use strict';

// ── lib/comms.js ──────────────────────────────────────────────────────────────
// Communication preference guard.
// All outbound messages (email, SMS, calls) must route through here.
// Respects client consent flags before sending; logs manual outreach required
// when digital consent is off but contact is still needed.

const { sendTransactional } = require('./mailer');

// ── Preference lookup ─────────────────────────────────────────────────────────

async function getPreferences(sb, clientId) {
  if (!sb || !clientId) return { email_consent: true, preferred_contact: 'email' };
  try {
    const { data } = await sb
      .from('clients')
      .select('email_consent, sms_consent, call_consent, ai_call_consent, preferred_contact, followup_preference')
      .eq('id', clientId)
      .single();
    if (!data) return { email_consent: true, preferred_contact: 'email' };
    return {
      email_consent:    data.email_consent    !== false,  // default true
      sms_consent:      data.sms_consent      === true,
      call_consent:     data.call_consent     === true,
      ai_call_consent:  data.ai_call_consent  === true,
      preferred_contact: data.preferred_contact   || 'email',
      followup_preference: data.followup_preference || 'email',
    };
  } catch { return { email_consent: true, preferred_contact: 'email' }; }
}

// ── Guard: can we email this client? ─────────────────────────────────────────

async function canEmail(sb, clientId) {
  const prefs = await getPreferences(sb, clientId);
  return prefs.email_consent;
}

// ── Log that manual outreach is required ──────────────────────────────────────

async function logManualOutreachNeeded(sb, { clientId, sessionId, messageType, reason, channel }) {
  try {
    await sb.from('communications').insert({
      client_id:    clientId    || null,
      channel:      channel     || 'manual',
      message_type: messageType || 'general_message',
      recipient:    'daron',
      subject:      'Manual Outreach Required',
      status:       'manual_required',
      metadata: {
        session_id: sessionId || null,
        reason,
        requires_manual_contact: true,
        flagged_at: new Date().toISOString(),
      },
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[comms] logManualOutreachNeeded error:', e.message);
  }
}

// ── Primary send helper ───────────────────────────────────────────────────────
// Checks consent before sending. If email consent is off, logs manual alert.

async function sendWithPreferences(sb, opts) {
  const { clientId, sessionId, templateName, recipientEmail, variables, metadata, messageType } = opts;

  const prefs = await getPreferences(sb, clientId);

  if (!prefs.email_consent) {
    console.warn(`[comms] Email consent off for client ${clientId} — skipping ${templateName}, logging manual outreach`);
    await logManualOutreachNeeded(sb, {
      clientId,
      sessionId,
      messageType: messageType || templateName,
      reason:      `Email consent is off. Template '${templateName}' not sent. Preferred contact: ${prefs.preferred_contact}.`,
      channel:     prefs.preferred_contact || 'phone',
    });
    return { skipped: true, reason: 'email_consent_off', preferred_contact: prefs.preferred_contact };
  }

  return sendTransactional(sb, {
    templateName,
    recipientEmail,
    clientId,
    variables,
    metadata,
    idempotencyKey: opts.idempotencyKey,
    transport: opts.transport,
  });
}

module.exports = { getPreferences, canEmail, logManualOutreachNeeded, sendWithPreferences };
