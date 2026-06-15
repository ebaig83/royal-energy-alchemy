// /.netlify/functions/manage-appointment
//
// Public-facing endpoint — no auth required (clients use it from email links)
//
// GET ?session_id=uuid — return minimal session info for the public manage page
//
// POST body: { session_id, action, ... }
//   action = 'view' | 'reschedule_request' | 'reschedule_confirmed' |
//            'cancel_request' | 'cancel_confirmed' | 'contact_request'
//
// reschedule_confirmed body: { session_id, action, slot_id, new_date, new_time, reason? }
//   — atomically books new slot, releases old slot, updates session date/time
//
// cancel_confirmed body: { session_id, action, reason?, detail? }
//   — sets session status to cancelled, releases linked availability slot

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

    if (error || !data) return respond(404, { error: 'Session not found.' });

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

  // ── POST — handle appointment management actions ──────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { session_id, action } = body;

    if (!action)                         return respond(400, { error: 'action is required.' });
    if (!VALID_ACTIONS.includes(action)) return respond(400, { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });

    // ── reschedule_confirmed — real slot swap ─────────────────────────────
    if (action === 'reschedule_confirmed') {
      return await handleRescheduleConfirmed(sb, body, session_id, ip, ua);
    }

    // ── cancel_confirmed — real session cancel ────────────────────────────
    if (action === 'cancel_confirmed') {
      return await handleCancelConfirmed(sb, body, session_id, ip, ua);
    }

    // ── All other actions — just write audit record ───────────────────────
    const meta = {};
    if (body.subject || body.message) {
      meta.subject = body.subject;
      meta.message = body.message;
    }

    const record = {
      session_id:   session_id || null,
      action,
      old_date:     body.old_date     || null,
      old_time:     body.old_time     || null,
      new_date:     body.new_date     || null,
      new_time:     body.new_time     || null,
      reason:       body.reason       || null,
      client_name:  body.client_name  || null,
      client_email: body.client_email || null,
      ip_address:   ip,
      user_agent:   ua.slice(0, 500),
      metadata:     Object.keys(meta).length ? meta : (body.metadata || null),
    };

    const { data, error } = await sb
      .from('appointment_management_audit')
      .insert(record)
      .select('id')
      .single();

    if (error) {
      if (isMissingTableError(error)) {
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

// ── reschedule_confirmed ────────────────────────────────────────────────────
// 1. Validate slot is still available (atomic update with status guard)
// 2. Release old slot linked to session
// 3. Update session date/time
// 4. Write audit record

async function handleRescheduleConfirmed(sb, body, session_id, ip, ua) {
  const { slot_id, new_date, new_time, reason } = body;

  if (!session_id) return respond(400, { error: 'session_id is required.' });
  if (!slot_id)    return respond(400, { error: 'slot_id is required for reschedule_confirmed.' });
  if (!new_date)   return respond(400, { error: 'new_date is required.' });
  if (!new_time)   return respond(400, { error: 'new_time is required.' });

  // 1. Fetch current session (for old date/time and validation)
  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .select('id, session_date, session_time, status')
    .eq('id', session_id)
    .single();

  if (sessErr || !session) return respond(404, { error: 'Session not found.' });
  if (['cancelled', 'completed'].includes(session.status)) {
    return respond(400, { error: 'Cannot reschedule a cancelled or completed session.' });
  }

  // 2. Atomically book new slot — only succeeds if still available (prevents double booking)
  const { data: newSlot, error: slotErr } = await sb
    .from('availability_slots')
    .update({ status: 'booked', session_id })
    .eq('id', slot_id)
    .eq('status', 'available')   // guard against double booking
    .select('id, slot_date, slot_time')
    .single();

  if (slotErr || !newSlot) {
    return respond(409, { error: 'This time slot is no longer available. Please select another.' });
  }

  // 3. Release the old slot linked to this session (if any)
  await sb
    .from('availability_slots')
    .update({ status: 'available', session_id: null })
    .eq('session_id', session_id)
    .neq('id', slot_id);   // don't touch the new slot we just booked

  // 4. Update session date and time
  const timeNorm = new_time.length === 5 ? new_time + ':00' : new_time;
  await sb
    .from('sessions')
    .update({ session_date: new_date, session_time: timeNorm, updated_at: new Date().toISOString() })
    .eq('id', session_id);

  // 5. Write audit record
  const { data: audit } = await sb
    .from('appointment_management_audit')
    .insert({
      session_id,
      action:       'reschedule_confirmed',
      old_date:     session.session_date,
      old_time:     session.session_time,
      new_date,
      new_time:     timeNorm,
      reason:       reason || null,
      client_name:  body.client_name  || null,
      client_email: body.client_email || null,
      ip_address:   ip,
      user_agent:   ua.slice(0, 500),
      metadata:     { slot_id, booked_at: new Date().toISOString() },
    })
    .select('id')
    .single();

  return respond(200, {
    rescheduled: true,
    new_date,
    new_time:    timeNorm,
    slot_id,
    audit_id:    audit?.id || null,
  });
}

// ── cancel_confirmed ────────────────────────────────────────────────────────
// 1. Set session status to cancelled
// 2. Release linked availability slot
// 3. Write audit record

async function handleCancelConfirmed(sb, body, session_id, ip, ua) {
  if (!session_id) return respond(400, { error: 'session_id is required.' });

  // 1. Fetch session
  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .select('id, session_date, session_time, status, amount_due, payment_status')
    .eq('id', session_id)
    .single();

  if (sessErr || !session) return respond(404, { error: 'Session not found.' });
  if (session.status === 'cancelled') {
    return respond(400, { error: 'Session is already cancelled.' });
  }
  if (session.status === 'completed') {
    return respond(400, { error: 'Cannot cancel a completed session.' });
  }

  // 2. Update session status
  await sb
    .from('sessions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', session_id);

  // 3. Release linked slot
  await sb
    .from('availability_slots')
    .update({ status: 'available', session_id: null })
    .eq('session_id', session_id);

  // 4. Write audit record
  const { data: audit } = await sb
    .from('appointment_management_audit')
    .insert({
      session_id,
      action:       'cancel_confirmed',
      old_date:     session.session_date,
      old_time:     session.session_time,
      reason:       body.reason  || null,
      client_name:  body.client_name  || null,
      client_email: body.client_email || null,
      ip_address:   ip,
      user_agent:   ua.slice(0, 500),
      metadata:     {
        detail:           body.detail           || null,
        payment_status:   session.payment_status,
        amount_due:       session.amount_due,
        cancelled_at:     new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  return respond(200, {
    cancelled: true,
    session_id,
    audit_id:  audit?.id || null,
  });
}
