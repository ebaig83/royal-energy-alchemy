// /.netlify/functions/manage-appointment
//
// Public-facing endpoint — no auth required (clients use it from email links)
//
// POST — log an appointment management action to appointment_management_audit
//   body: { session_id, action, old_date?, old_time?, new_date?, new_time?, reason?,
//            client_name?, client_email?, message?, subject?, metadata? }
//
// GET ?session_id=uuid — return minimal session info for the public manage page
//   Returns: { session: { id, service, session_date, session_time, duration_minutes,
//                          status, payment_status, client_name, amount_due } }

'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');

const VALID_ACTIONS = [
  'view',
  'reschedule_request',
  'cancel_request',
  'contact_request',
  'reschedule_confirmed',
  'cancel_confirmed',
];

function isMissingTableError(err) {
  if (!err) return false;
  const c = err.code || '', m = err.message || '';
  return c === '42P01' || c === 'PGRST204' || c === 'PGRST200' || c === 'PGRST116' ||
    m.includes('does not exist') || m.includes('Could not find') || m.includes('schema cache');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const ip     = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const ua     = event.headers['user-agent'] || '';

  // ── GET — public session lookup ───────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const sessionId = params.session_id || params.id;
    if (!sessionId) return respond(400, { error: 'session_id is required.' });

    const { data, error } = await sb
      .from('sessions')
      .select('id, service, session_date, session_time, duration_minutes, status, payment_status, client_name, amount_due, location_type')
      .eq('id', sessionId)
      .single();

    if (error || !data) {
      if (isMissingTableError(error)) return respond(404, { error: 'Session not found.' });
      return respond(404, { error: 'Session not found.' });
    }

    // Mask sensitive data for public endpoint
    return respond(200, {
      session: {
        id:               data.id,
        service:          data.service,
        session_date:     data.session_date,
        session_time:     data.session_time,
        duration_minutes: data.duration_minutes,
        status:           data.status,
        payment_status:   data.payment_status,
        client_name:      data.client_name,
        amount_due:       data.amount_due,
        location_type:    data.location_type,
      }
    });
  }

  // ── POST — log audit action ───────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { session_id, action } = body;

    if (!action)              return respond(400, { error: 'action is required.' });
    if (!VALID_ACTIONS.includes(action))
      return respond(400, { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });

    // Build metadata for contact requests
    const metadata = body.metadata || null;
    const extra    = {};
    if (body.subject || body.message) {
      extra.metadata = { subject: body.subject, message: body.message, ...(metadata || {}) };
    }

    const record = {
      session_id:   session_id || null,
      action,
      old_date:     body.old_date    || null,
      old_time:     body.old_time    || null,
      new_date:     body.new_date    || null,
      new_time:     body.new_time    || null,
      reason:       body.reason      || null,
      client_name:  body.client_name || null,
      client_email: body.client_email|| null,
      ip_address:   ip,
      user_agent:   ua.slice(0, 500),
      metadata:     extra.metadata || metadata || null,
    };

    const { data, error } = await sb
      .from('appointment_management_audit')
      .insert(record)
      .select('id')
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        // Migration not yet run — log to console and return success so UX doesn't break
        console.warn('[manage-appointment] audit table missing — run 2026-06-20-sprint13a.sql');
        return respond(201, { logged: false, migration_needed: true });
      }
      console.error('[manage-appointment] audit insert error:', error.message);
      return respond(500, { error: error.message });
    }

    return respond(201, { logged: true, id: data?.id });
  }

  return respond(405, { error: 'Method not allowed.' });
};
