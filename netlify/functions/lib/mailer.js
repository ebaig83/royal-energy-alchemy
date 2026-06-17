'use strict';

// ── lib/mailer.js — transactional email sender ────────────────────────────────
// Sends template-based emails from server functions without requiring admin auth.
// Silently skips when RESEND_API_KEY / FROM_EMAIL not configured.
// All sends are logged to the communications table.

const https = require('https');

function callResend(payload) {
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

function renderTemplate(tmpl, vars) {
  let html = tmpl.html_body || '', text = tmpl.text_body || '', subj = tmpl.subject || '';

  // Process {{#if varName}}...{{/if}} — keep block when var is truthy, strip when falsy/empty
  function processConditionals(str) {
    return str.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
      const val = vars[key];
      return (val != null && val !== '' && val !== false) ? inner : '';
    });
  }
  html = processConditionals(html);
  text = processConditionals(text);

  // Simple {{variable}} substitution
  Object.keys(vars || {}).forEach(k => {
    const re = new RegExp('\\{\\{' + k + '\\}\\}', 'g');
    const v  = String(vars[k] != null ? vars[k] : '');
    html = html.replace(re, v);
    text = text.replace(re, v);
    subj = subj.replace(re, v);
  });
  return { html, text, subject: subj };
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
  const { templateName, recipientEmail, clientId, variables, metadata } = opts || {};

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

  const rendered = renderTemplate(tmpl, variables || {});

  const result = await callResend({
    from:    fromEmail,
    to:      [recipientEmail],
    subject: rendered.subject,
    html:    rendered.html,
    ...(rendered.text ? { text: rendered.text } : {}),
  });

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

  return { sent: result.success, status, message_id: msgId };
}

module.exports = { sendTransactional };
