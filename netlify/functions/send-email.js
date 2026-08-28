// /.netlify/functions/send-email
//
// POST ?action=send_email    — send a freeform email via Resend + log
// POST ?action=send_template — render a stored template + send + log
//
// Environment variables required:
//   RESEND_API_KEY   — Resend API key (never exposed to frontend)
//   FROM_EMAIL       — verified sender address in Resend
//
// All sends are logged to the `communications` table.
// API key is NEVER returned in any response.

'use strict';

const https = require('https');
const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { sendTransactional }     = require('./lib/mailer');

const CONTROLLED_TEST_RECIPIENT = 'droyal168@gmail.com';
const CONTROLLED_TEST_KEY = 'controlled-production-transactional-email-test-2026-08-28';

// ── Resend API call (server-side only) ────────────────────────────────────
function callResend(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request(
      {
        hostname: 'api.resend.com',
        port:     443,
        path:     '/emails',
        method:   'POST',
        headers:  {
          Authorization:   'Bearer ' + apiKey,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', chunk => (d += chunk));
        res.on('end', () => {
          try   { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Template variable substitution ───────────────────────────────────────
function renderTemplate(template, variables) {
  let html = template.html_body || '';
  let text = template.text_body || '';
  let subj = template.subject   || '';
  const vars = variables || {};
  Object.keys(vars).forEach(k => {
    const re = new RegExp('\\{\\{' + k + '\\}\\}', 'g');
    html = html.replace(re, String(vars[k] || ''));
    text = text.replace(re, String(vars[k] || ''));
    subj = subj.replace(re, String(vars[k] || ''));
  });
  return { html, text, subject: subj };
}

// ── Missing-table guard (same pattern as financial.js) ────────────────────
function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg  = String(error.message || '');
  return (
    code === '42P01'    ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

// ── Log to communications table ──────────────────────────────────────────
async function logCommunication(sb, entry) {
  try {
    const { data, error } = await sb.from('communications').insert({
      client_id:           entry.client_id           || null,
      channel:             entry.channel             || 'email',
      message_type:        entry.message_type,
      recipient:           entry.recipient,
      subject:             entry.subject             || null,
      status:              entry.status              || 'sent',
      provider:            'resend',
      provider_message_id: entry.provider_message_id || null,
      template_id:         entry.template_id         || null,
      metadata:            entry.metadata            || null,
      sent_at:             new Date().toISOString(),
    }).select().single();
    if (error && !isMissingTableError(error)) console.error('[send-email] comm log error:', error.message);
    return data || null;
  } catch (err) {
    console.error('[send-email] comm log exception:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed.' });

  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  const apiKey   = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey)    return respond(500, { error: 'RESEND_API_KEY is not configured.' });
  if (!fromEmail) return respond(500, { error: 'FROM_EMAIL is not configured.' });

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON.' }); }

  const action = params.action || 'send_email';

  try {
    if (action === 'controlled_transactional_test') return respond(200, await sendControlledTransactionalTest(sb));
    if (action === 'send_email')    return respond(200, await sendFreeform(sb, body, auth, ip, apiKey, fromEmail));
    if (action === 'send_template') return respond(200, await sendTemplate(sb, body, auth, ip, apiKey, fromEmail));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[send-email]', action, err.message);
    return respond(500, { error: err.message });
  }
};

// Temporary one-shot production validation. The recipient and content cannot be
// supplied by the request, and the fixed reservation key prevents a second send.
async function sendControlledTransactionalTest(sb) {
  const template = {
    id: null,
    name: 'controlled_production_transactional_email_test',
    type: 'general_message',
    is_active: true,
    subject: 'Royal Energy Alchemy — Transactional Email Test',
    html_body: '<p>This is a production email delivery test only. No booking, payment, or refund was created.</p>',
    text_body: 'This is a production email delivery test only. No booking, payment, or refund was created.',
  };

  const templateQuery = {
    select() { return this; },
    eq() { return this; },
    async single() { return { data: template, error: null }; },
  };
  const controlledClient = new Proxy(sb, {
    get(target, property) {
      if (property === 'from') {
        return table => table === 'email_templates' ? templateQuery : target.from(table);
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const result = await sendTransactional(controlledClient, {
    templateName: template.name,
    recipientEmail: CONTROLLED_TEST_RECIPIENT,
    idempotencyKey: CONTROLLED_TEST_KEY,
    metadata: {
      controlled_test: true,
      booking_created: false,
      payment_created: false,
      refund_created: false,
    },
  });

  return {
    success: result.sent === true,
    status: result.status || null,
    accepted: Boolean(result.message_id),
    duplicate: result.duplicate === true,
    reason: result.reason || null,
  };
}

// ── Send freeform email ───────────────────────────────────────────────────
async function sendFreeform(sb, body, auth, ip, apiKey, fromEmail) {
  if (!body.recipient_email) throw new Error('recipient_email is required.');
  if (!body.subject)         throw new Error('subject is required.');
  if (!body.message_type)    throw new Error('message_type is required.');
  if (!body.html && !body.text) throw new Error('html or text body is required.');

  const VALID_TYPES = [
    'appointment_reminder','followup_reminder','recommendation_delivery',
    'invoice_notification','package_expiration_warning','general_message',
  ];
  if (!VALID_TYPES.includes(body.message_type)) {
    throw new Error(`Invalid message_type. Valid values: ${VALID_TYPES.join(', ')}`);
  }

  const payload = {
    from:    fromEmail,
    to:      [body.recipient_email],
    subject: body.subject,
  };
  if (body.html) payload.html = body.html;
  if (body.text) payload.text = body.text;
  if (body.reply_to) payload.reply_to = body.reply_to;

  const result = await callResend(apiKey, payload);

  const status = result.status === 200 ? 'sent' : 'failed';
  const msgId  = (result.body && result.body.id) ? result.body.id : null;

  if (result.status !== 200) {
    const errMsg = (result.body && result.body.message) ? result.body.message : String(result.status);
    console.error('[send-email] Resend error:', errMsg);
  }

  const commRecord = await logCommunication(sb, {
    client_id:           body.client_id    || null,
    channel:             'email',
    message_type:        body.message_type,
    recipient:           body.recipient_email,
    subject:             body.subject,
    status,
    provider_message_id: msgId,
    metadata:            body.metadata     || null,
  });

  await log({
    actor:     auth.user.email,
    action:    'created',
    tableName: 'communications',
    recordId:  commRecord ? commRecord.id : null,
    newData:   { recipient: body.recipient_email, subject: body.subject, message_type: body.message_type, status },
    context:   `Sent ${body.message_type} email to ${body.recipient_email}`,
    ip,
  });

  return {
    success:  status === 'sent',
    status,
    message_id: msgId,
    communication_id: commRecord ? commRecord.id : null,
    ...(result.status !== 200 ? { provider_error: result.body } : {}),
  };
}

// ── Send template email ───────────────────────────────────────────────────
async function sendTemplate(sb, body, auth, ip, apiKey, fromEmail) {
  if (!body.recipient_email) throw new Error('recipient_email is required.');
  if (!body.template_id && !body.template_name) throw new Error('template_id or template_name is required.');

  // Fetch template
  let tmplQuery = sb.from('email_templates').select('*').eq('is_active', true);
  if (body.template_id)   tmplQuery = tmplQuery.eq('id', body.template_id);
  else                    tmplQuery = tmplQuery.eq('name', body.template_name);
  const { data: tmpl, error: tmplErr } = await tmplQuery.single();
  if (tmplErr || !tmpl) throw new Error('Email template not found or inactive.');

  // Render variables
  const rendered = renderTemplate(tmpl, body.variables || {});

  const payload = {
    from:    fromEmail,
    to:      [body.recipient_email],
    subject: rendered.subject,
    html:    rendered.html,
    text:    rendered.text || undefined,
  };
  if (body.reply_to) payload.reply_to = body.reply_to;

  const result = await callResend(apiKey, payload);

  const status = result.status === 200 ? 'sent' : 'failed';
  const msgId  = (result.body && result.body.id) ? result.body.id : null;

  if (result.status !== 200) {
    console.error('[send-email] Resend template error:', result.body);
  }

  const commRecord = await logCommunication(sb, {
    client_id:           body.client_id || null,
    channel:             'email',
    message_type:        tmpl.type,
    recipient:           body.recipient_email,
    subject:             rendered.subject,
    status,
    provider_message_id: msgId,
    template_id:         tmpl.id,
    metadata:            body.metadata || null,
  });

  await log({
    actor:     auth.user.email,
    action:    'created',
    tableName: 'communications',
    recordId:  commRecord ? commRecord.id : null,
    newData:   { template: tmpl.name, recipient: body.recipient_email, status },
    context:   `Sent template "${tmpl.name}" to ${body.recipient_email}`,
    ip,
  });

  return {
    success:  status === 'sent',
    status,
    template: tmpl.name,
    message_id: msgId,
    communication_id: commRecord ? commRecord.id : null,
    ...(result.status !== 200 ? { provider_error: result.body } : {}),
  };
}
