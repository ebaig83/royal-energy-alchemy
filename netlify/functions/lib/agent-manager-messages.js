'use strict';

const { getClient } = require('./supabase');

const CATEGORIES = new Set(['General Update','Question','Approval Needed','Action Needed','Warning','Release Update','Issue Resolved']);
const PRIORITIES = new Set(['Normal','Important','Urgent']);

function clean(value, max) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return result ? result.slice(0, max) : null;
}

function commit(value) {
  const result = clean(value, 64);
  return result && /^[0-9a-f]{7,64}$/i.test(result) ? result : null;
}

function sanitizeMessage(body = {}) {
  const subject = clean(body.subject, 180);
  const messageBody = clean(body.message_body, 4000);
  const category = clean(body.category, 40);
  const priority = clean(body.priority || 'Normal', 20);
  if (!subject || !messageBody || !CATEGORIES.has(category) || !PRIORITIES.has(priority)) throw new Error('Manager message fields are invalid.');
  return {
    subject,
    message_body: messageBody,
    category,
    priority,
    related_commit: body.related_commit ? commit(body.related_commit) : null,
    related_deploy_id: clean(body.related_deploy_id, 120),
    is_active: true,
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    subject: row.subject,
    messageBody: row.message_body,
    category: row.category,
    priority: row.priority,
    createdAt: row.created_at,
    readAt: row.read_at,
    acknowledgedAt: row.acknowledged_at,
    relatedCommit: row.related_commit,
    relatedDeployId: row.related_deploy_id,
    isActive: row.is_active,
  };
}

async function readManagerMessages() {
  const { data, error } = await getClient()
    .from('agent_manager_messages')
    .select('id,subject,message_body,category,priority,created_at,read_at,acknowledged_at,related_commit,related_deploy_id,is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const messages = (data || []).map(publicMessage);
  return { newest: messages[0] || null, unreadCount: messages.filter(message => !message.readAt).length, history: messages };
}

async function acknowledgeMessage(id, action) {
  const cleanId = String(id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(cleanId) || !['read','acknowledge'].includes(action)) throw new Error('Message action is invalid.');
  const now = new Date().toISOString();
  const updates = action === 'acknowledge' ? { read_at: now, acknowledged_at: now } : { read_at: now };
  const { data, error } = await getClient()
    .from('agent_manager_messages')
    .update(updates)
    .eq('id', cleanId)
    .eq('is_active', true)
    .select('id,subject,message_body,category,priority,created_at,read_at,acknowledged_at,related_commit,related_deploy_id,is_active')
    .single();
  if (error) throw error;
  return publicMessage(data);
}

module.exports = { CATEGORIES, PRIORITIES, sanitizeMessage, publicMessage, readManagerMessages, acknowledgeMessage };
