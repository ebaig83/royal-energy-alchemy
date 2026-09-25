'use strict';

const crypto = require('crypto');

function reminderCorrelationId(session) {
  const key = [session?.id, session?.session_date, String(session?.session_time || '').slice(0, 5)].join(':');
  return crypto.createHash('sha256').update(`appointment-reminder:${key}`).digest('hex').slice(0, 32);
}

async function recordAppointmentAction(sb, row) {
  if (!sb || !row?.correlation_id || !row?.action || !row?.source || !row?.actor_type) throw new Error('Trusted appointment audit metadata is required.');
  const { error } = await sb.from('appointment_action_audit').insert({
    session_id: row.session_id || null,
    actor_type: row.actor_type,
    actor_id: row.actor_id || null,
    actor_email: row.actor_email ? String(row.actor_email).trim().toLowerCase() : null,
    source: row.source,
    action: row.action,
    previous_state: row.previous_state || null,
    new_state: row.new_state || null,
    correlation_id: String(row.correlation_id),
    request_path: row.request_path || null,
  });
  if (error && error.code !== '23505') throw error;
  return { duplicate: error?.code === '23505' };
}

module.exports = { recordAppointmentAction, reminderCorrelationId };
