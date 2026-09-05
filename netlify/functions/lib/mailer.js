'use strict';

// ── lib/mailer.js — transactional email sender ────────────────────────────────
// Sends template-based emails from server functions without requiring admin auth.
// Silently skips when RESEND_API_KEY / FROM_EMAIL not configured.
// All sends are logged to the communications table.

const https = require('https');
const { renderTemplate } = require('./email-render');

function callResend(payload, idempotencyKey) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return Promise.resolve({ success: false, error: 'no_key' });

  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req  = https.request(
      {
        hostname: 'api.resend.com',
        port:     443,
        path:     '/emails',
        method:   'POST',
        headers:  {
          Authorization:    'Bearer ' + apiKey,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          try   { resolve({ success: res.statusCode === 200, status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ success: res.statusCode === 200, status: res.statusCode, body: d }); }
        });
      }
    );
    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

async function logComm(sb, entry) {
  if (!sb) return null;
  try {
    const { data } = await sb.from('communications').insert({
      client_id:           entry.client_id    || null,
      channel:             'email',
      message_type:        entry.message_type || 'general_message',
      recipient:           entry.recipient,
      subject:             entry.subject      || null,
      status:              entry.status       || 'sent',
      provider:            'resend',
      provider_message_id: entry.message_id   || null,
      template_id:         entry.template_id  || null,
      metadata:            entry.metadata     || null,
      sent_at:             new Date().toISOString(),
    }).select('id').single();
    return data;
  } catch { return null; }
}

/**
 * sendTransactional({ sb, templateName, recipientEmail, clientId, variables, metadata })
 *
 * Fire-and-forget email triggered by server-side events (intake, reschedule, cancel).
 * Never throws — logs warnings and returns { skipped: true } on any failure.
 */
async function sendTransactional(sb, opts) {
  const { templateName, recipientEmail, clientId, variables, metadata, idempotencyKey, transport } = opts || {};

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.warn('[mailer] Email env not configured — skipping', templateName);
    return { skipped: true, reason: 'email_not_configured' };
  }
  if (!recipientEmail) {
    console.warn('[mailer] No recipient for', templateName);
    return { skipped: true, reason: 'no_recipient' };
  }
  if (!templateName) {
    console.warn('[mailer] No templateName provided');
    return { skipped: true, reason: 'no_template_name' };
  }

  let reservation = null;
  if (idempotencyKey && sb) {
    const reservedAt = new Date().toISOString();
    const row = {
      idempotency_key: idempotencyKey,
      stripe_event_id: metadata?.stripe_event_id || null,
      recipient: recipientEmail.toLowerCase(),
      notification_type: metadata?.notification_type || templateName,
      status: 'reserved',
      attempt_count: 1,
      reserved_at: reservedAt,
      metadata: metadata || null,
    };
    const { data, error } = await sb.from('transactional_notifications').insert(row).select('id,status').single();
    if (!error) reservation = data;
    else if (error.code === '23505') {
      const { data: existing, error: readError } = await sb
        .from('transactional_notifications')
        .select('id,status,attempt_count')
        .eq('idempotency_key', idempotencyKey)
        .single();
      if (readError) throw readError;
      if (existing.status === 'sent' || existing.status === 'reserved') {
        return { skipped: true, duplicate: true, reason: 'notification_already_reserved' };
      }
      const { data: reclaimed, error: reclaimError } = await sb
        .from('transactional_notifications')
        .update({ status: 'reserved', reserved_at: reservedAt, last_error: null, attempt_count: Number(existing.attempt_count || 0) + 1 })
        .eq('id', existing.id)
        .eq('status', 'failed')
        .select('id,status')
        .single();
      if (reclaimError || !reclaimed) return { skipped: true, duplicate: true, reason: 'notification_claim_lost' };
      reservation = reclaimed;
    } else {
      throw error;
    }
  }

  // Fetch template from DB
  let tmpl = null;
  if (sb) {
    const { data } = await sb
      .from('email_templates')
      .select('*')
      .eq('name', templateName)
      .eq('is_active', true)
      .single();
    tmpl = data;
  }

  if (!tmpl) {
    console.warn('[mailer] Template not found:', templateName);
    return { skipped: true, reason: 'template_not_found' };
  }

  let rendered;
  try {
    rendered = renderTemplate(tmpl, variables || {});
  } catch (error) {
    console.error('[mailer] Rendering blocked for', templateName, '-', error.code || 'render_error');
    await logComm(sb, {
      client_id: clientId || null, message_type: tmpl.type, recipient: recipientEmail,
      subject: null, status: 'failed', template_id: tmpl.id,
      metadata: { ...(metadata || {}), rendering_error: true, error_code: error.code || 'EMAIL_RENDER_ERROR' },
    });
    if (reservation && sb) {
      await sb.from('transactional_notifications').update({
        status: 'failed', failed_at: new Date().toISOString(),
        last_error: error.code || 'EMAIL_RENDER_ERROR',
      }).eq('id', reservation.id);
    }
    throw error;
  }

  const send = transport || callResend;
  const result = await send({
    from:    fromEmail,
    to:      [recipientEmail],
    subject: rendered.subject,
    html:    rendered.html,
    ...(rendered.text ? { text: rendered.text } : {}),
  }, idempotencyKey);

  const status = result.success ? 'sent' : 'failed';
  const msgId  = result.body && result.body.id ? result.body.id : null;

  if (!result.success) {
    console.error('[mailer] Send failed for', templateName, ':', result.body || result.error);
  }

  await logComm(sb, {
    client_id:   clientId || null,
    message_type: tmpl.type,
    recipient:   recipientEmail,
    subject:     rendered.subject,
    status,
    message_id:  msgId,
    template_id: tmpl.id,
    metadata:    metadata || null,
  });

  if (reservation && sb) {
    await sb.from('transactional_notifications').update({
      status,
      provider_message_id: msgId,
      sent_at: result.success ? new Date().toISOString() : null,
      failed_at: result.success ? null : new Date().toISOString(),
      last_error: result.success ? null : String(result.body?.message || result.error || 'Email provider rejected the request').slice(0, 1000),
    }).eq('id', reservation.id);
  }

  return { sent: result.success, status, message_id: msgId };
}

module.exports = { sendTransactional, _test: { renderTemplate, callResend } };
