// /.netlify/functions/communications
//
// GET  ?section=log                         — all comm log (paginated)
// GET  ?section=log&client_id=uuid          — client comm history
// GET  ?section=templates                   — all email templates
// GET  ?section=stats                       — overview KPIs
// GET  ?section=client_history&client_id=   — compact history for client profile
//
// POST ?action=create_template              — create an email template
//
// PATCH ?action=update_template&id=uuid     — update template content/active flag
// PATCH ?action=update_status&id=uuid       — update comm delivery status (webhook / manual)

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

// ── Same missing-table guard as financial.js ──────────────────────────────
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

async function safeRows(query, fallback = []) {
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return fallback;
    throw new Error(error.message);
  }
  return data || fallback;
}

async function safeOne(query, fallback = null) {
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return fallback;
    throw new Error(error.message);
  }
  return data || fallback;
}

const VALID_MSG_TYPES = [
  'appointment_reminder', 'followup_reminder', 'recommendation_delivery',
  'invoice_notification', 'package_expiration_warning', 'general_message',
];

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section;
    if (!section) return respond(400, { error: 'section is required.' });
    try {
      if (section === 'log')            return respond(200, await getLog(sb, params));
      if (section === 'templates')      return respond(200, await getTemplates(sb, params));
      if (section === 'stats')          return respond(200, await getStats(sb));
      if (section === 'client_history') return respond(200, await getClientHistory(sb, params));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[communications] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'create_template') return respond(201, await createTemplate(sb, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[communications] POST', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    const id     = params.id;
    if (!id) return respond(400, { error: 'id is required.' });
    try {
      if (action === 'update_template') return respond(200, await updateTemplate(sb, id, body, auth, ip));
      if (action === 'update_status')   return respond(200, await updateStatus(sb, id, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[communications] PATCH', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ════════════════════════════════════════════════════════════════════════════
// GET HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async function getLog(sb, params) {
  const limit  = Math.min(parseInt(params.limit)  || 100, 500);
  const offset = parseInt(params.offset) || 0;

  let q = sb
    .from('communications')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('sent_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.client_id)    q = q.eq('client_id', params.client_id);
  if (params.message_type) q = q.eq('message_type', params.message_type);
  if (params.status)       q = q.eq('status', params.status);
  if (params.from)         q = q.gte('sent_at', params.from);
  if (params.to)           q = q.lte('sent_at', params.to);

  const { data, error, count } = await q;
  if (error) {
    if (isMissingTableError(error)) return { communications: [], total: 0, limit, offset, _migration_needed: true };
    throw new Error(error.message);
  }
  return { communications: data || [], total: count || 0, limit, offset };
}

async function getTemplates(sb, params) {
  let q = sb
    .from('email_templates')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (params.type)      q = q.eq('type', params.type);
  if (params.active_only === 'true') q = q.eq('is_active', true);

  const templates = await safeRows(q);
  return { templates };
}

async function getStats(sb) {
  const comms = await safeRows(
    sb.from('communications')
      .select('status, message_type, sent_at')
      .is('deleted_at', null)
      .order('sent_at', { ascending: false })
      .limit(1000)
  );

  if (!comms.length) {
    return {
      total: 0, sent: 0, delivered: 0, failed: 0, bounced: 0,
      byType: {}, recentActivity: [], _migration_needed: true,
    };
  }

  const total     = comms.length;
  const sent      = comms.filter(c => c.status === 'sent').length;
  const delivered = comms.filter(c => c.status === 'delivered').length;
  const failed    = comms.filter(c => c.status === 'failed').length;
  const bounced   = comms.filter(c => c.status === 'bounced').length;

  const byType = {};
  comms.forEach(c => {
    byType[c.message_type] = (byType[c.message_type] || 0) + 1;
  });

  // Recent 10 for activity feed
  const recentActivity = comms.slice(0, 10);

  // Last 30 days timeline (group by day)
  const now = new Date();
  const timeline = Array.from({ length: 30 }, (_, i) => {
    const d   = new Date(now.getTime() - (29 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    const count = comms.filter(c => (c.sent_at || '').startsWith(key)).length;
    return { date: key, count };
  });

  return { total, sent, delivered, failed, bounced, byType, recentActivity, timeline };
}

async function getClientHistory(sb, params) {
  if (!params.client_id) throw new Error('client_id is required.');

  const comms = await safeRows(
    sb.from('communications')
      .select('id, message_type, subject, status, channel, sent_at, recipient')
      .eq('client_id', params.client_id)
      .is('deleted_at', null)
      .order('sent_at', { ascending: false })
      .limit(50)
  );

  return { communications: comms, _migration_needed: comms.length === 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// POST HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async function createTemplate(sb, body, auth, ip) {
  if (!body.name)      throw new Error('name is required.');
  if (!body.type)      throw new Error('type is required.');
  if (!body.subject)   throw new Error('subject is required.');
  if (!body.html_body) throw new Error('html_body is required.');
  if (!VALID_MSG_TYPES.includes(body.type)) {
    throw new Error(`Invalid type. Valid values: ${VALID_MSG_TYPES.join(', ')}`);
  }

  const insert = {
    name:       body.name.trim(),
    type:       body.type,
    subject:    body.subject.trim(),
    html_body:  body.html_body,
    text_body:  body.text_body  || null,
    variables:  Array.isArray(body.variables) ? body.variables : [],
    is_active:  body.is_active !== false,
    created_by: auth.user.email || 'daron',
  };

  const { data, error } = await sb.from('email_templates').insert(insert).select().single();
  if (error) throw new Error(error.message);

  await log({
    actor: auth.user.email, action: 'created', tableName: 'email_templates', recordId: data.id,
    newData: data, context: `Created email template: ${data.name}`, ip,
  });
  return { template: data };
}

// ════════════════════════════════════════════════════════════════════════════
// PATCH HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async function updateTemplate(sb, id, body, auth, ip) {
  const allowed = ['name', 'subject', 'html_body', 'text_body', 'variables', 'is_active'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

  const { data, error } = await sb.from('email_templates').update(updates).eq('id', id).select().single();
  if (error) throw new Error(error.message);

  await log({
    actor: auth.user.email, action: 'updated', tableName: 'email_templates', recordId: id,
    newData: data, context: `Updated email template: ${data.name}`, ip,
  });
  return { template: data };
}

async function updateStatus(sb, id, body, auth, ip) {
  const VALID_STATUSES = ['sent', 'delivered', 'failed', 'bounced', 'pending'];
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const { data, error } = await sb
    .from('communications')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await log({
    actor: auth.user.email, action: 'updated', tableName: 'communications', recordId: id,
    newData: { status: body.status }, context: `Updated comm status to ${body.status}`, ip,
  });
  return { communication: data };
}
