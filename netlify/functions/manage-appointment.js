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

const { respond }            = require('./lib/auth');
const { getClient }          = require('./lib/supabase');
const { calcRefund, POLICY } = require('./lib/policy');
const { sendTransactional }  = require('./lib/mailer');

const VALID_ACTIONS = [
  'view',
  'reschedule_request',
  'reschedule_confirmed',
  'cancel_request',
  'cancel_confirmed',
  'contact_request',
  'request_time',
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

    // ── request_time — client requests alternate time from practitioner ───
    if (action === 'request_time') {
      return await handleRequestTime(sb, body, session_id, ip, ua);
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
    .select('id, session_date, session_time, status, service, client_id, client_name')
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

  // 6. Send automated reschedule confirmation (fire-and-forget)
  const clientEmail = body.client_email || await lookupClientEmail(sb, session.client_id);
  if (clientEmail) {
    sendTransactional(sb, {
      templateName:   'appointment_rescheduled',
      recipientEmail: clientEmail,
      clientId:       session.client_id || null,
      variables: {
        client_name: session.client_name || body.client_name || '',
        service:     session.service     || '',
        old_date:    session.session_date || '',
        old_time:    formatDisplayTime(session.session_time) || '',
        new_date,
        new_time:    formatDisplayTime(timeNorm),
        timezone:    'ET',
        manage_url:  process.env.SITE_URL
          ? `${process.env.SITE_URL}/manage-appointment.html?session_id=${session_id}`
          : '',
        contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
      },
      metadata: { trigger: 'reschedule_confirmed', session_id },
    }).catch(e => console.warn('[manage-appointment] reschedule email error:', e.message));
  }

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
    .select('id, session_date, session_time, status, amount_due, payment_status, service, client_id, client_name')
    .eq('id', session_id)
    .single();

  if (sessErr || !session) return respond(404, { error: 'Session not found.' });
  if (session.status === 'cancelled') {
    return respond(400, { error: 'Session is already cancelled.' });
  }
  if (session.status === 'completed') {
    return respond(400, { error: 'Cannot cancel a completed session.' });
  }

  // 2. Compute refund eligibility before cancelling
  const refund = calcRefund(session.session_date, session.session_time);

  // 3. Update session status
  await sb
    .from('sessions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', session_id);

  // 4. Release linked slot
  await sb
    .from('availability_slots')
    .update({ status: 'available', session_id: null })
    .eq('session_id', session_id);

  // 5. Write audit record
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
        refund_pct:       refund.pct,
        refund_eligible:  refund.eligible,
        cancelled_at:     new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  // 6. Send automated cancellation confirmation (fire-and-forget)
  const clientEmail = body.client_email || await lookupClientEmail(sb, session.client_id);
  if (clientEmail) {
    sendTransactional(sb, {
      templateName:   'appointment_cancelled',
      recipientEmail: clientEmail,
      clientId:       session.client_id || null,
      variables: {
        client_name:    session.client_name || body.client_name || '',
        service:        session.service     || '',
        session_date:   session.session_date || '',
        session_time:   formatDisplayTime(session.session_time) || '',
        timezone:       'ET',
        refund_summary: refund.estimate,
        policy_line_1:  POLICY.lines[0],
        policy_line_2:  POLICY.lines[1],
        policy_line_3:  POLICY.lines[2],
        policy_line_4:  POLICY.lines[3],
        contact_email:  process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
      },
      metadata: { trigger: 'cancel_confirmed', session_id, refund_pct: refund.pct },
    }).catch(e => console.warn('[manage-appointment] cancel email error:', e.message));
  }

  return respond(200, {
    cancelled:       true,
    session_id,
    audit_id:        audit?.id || null,
    refund_eligible: refund.eligible,
    refund_estimate: refund.estimate,
    refund_pct:      refund.pct,
  });
}

// ── request_time ────────────────────────────────────────────────────────────
// Client requests alternate times directly from practitioner.
// No slot booking — audit record only; practitioner responds manually.

async function handleRequestTime(sb, body, session_id, ip, ua) {
  if (!session_id)              return respond(400, { error: 'session_id is required.' });
  if (!body.preferred_dates)    return respond(400, { error: 'preferred_dates is required.' });
  if (!body.preferred_times)    return respond(400, { error: 'preferred_times is required.' });

  // Confirm session exists and is not cancelled/completed
  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .select('id, status, client_name')
    .eq('id', session_id)
    .single();

  if (sessErr || !session) return respond(404, { error: 'Session not found.' });
  if (['cancelled', 'completed'].includes(session.status)) {
    return respond(400, { error: 'Cannot request a time change for a cancelled or completed session.' });
  }

  const { data: audit, error: auditErr } = await sb
    .from('appointment_management_audit')
    .insert({
      session_id,
      action:       'request_time',
      client_name:  body.client_name  || session.client_name || null,
      client_email: body.client_email || null,
      reason:       body.reason       || null,
      ip_address:   ip,
      user_agent:   ua.slice(0, 500),
      metadata: {
        preferred_dates: body.preferred_dates,
        preferred_times: body.preferred_times,
        reason:          body.reason || null,
        requested_at:    new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (auditErr) {
    if (isMissingTableError(auditErr)) {
      console.warn('[manage-appointment] audit table missing — run 2026-06-20-sprint13a.sql');
      return respond(201, { logged: false, migration_needed: true });
    }
    console.error('[manage-appointment] request_time audit error:', auditErr.message);
    return respond(500, { error: auditErr.message });
  }

  return respond(201, { logged: true, id: audit?.id || null });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function lookupClientEmail(sb, clientId) {
  if (!sb || !clientId) return null;
  try {
    const { data } = await sb
      .from('clients')
      .select('email')
      .eq('id', clientId)
      .single();
    return data?.email || null;
  } catch { return null; }
}

function formatDisplayTime(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = String(timeStr).slice(0, 5).split(':');
  const h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}
