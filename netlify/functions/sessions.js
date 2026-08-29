// /.netlify/functions/sessions
// GET    ?id=uuid          — fetch one session with notes, payments, aftercare
// GET    ?client_id=uuid   — all sessions for a client
// GET    ?date=YYYY-MM-DD  — sessions on a specific date
// GET    ?upcoming=1       — next 30 days, confirmed+pending
// GET    (no params)       — all sessions, newest first (last 90 days)
// POST                     — create a session
// PATCH  ?id=uuid          — update status, payment_status, notes, etc.

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { scheduleAftercare }     = require('./agents/aftercare-agent');
const { sendTransactional }     = require('./lib/mailer');
const { emailFailure }          = require('./lib/ops-alert');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.id) {
      const { data, error } = await sb
        .from('sessions')
        .select('*, session_notes(*), payments(*), aftercare(*)')
        .eq('id', params.id)
        .single();
      if (error) return respond(404, { error: 'Session not found.' });
      return respond(200, { session: data });
    }

    let query = sb.from('sessions').select('*, payments(amount, status, method, paid_at)');

    if (params.client_id) {
      query = query.eq('client_id', params.client_id).order('session_date', { ascending: false });
    } else if (params.date) {
      query = query.eq('session_date', params.date).order('session_time', { ascending: true });
    } else if (params.upcoming) {
      const today    = new Date().toISOString().slice(0, 10);
      const in30days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      query = query
        .gte('session_date', today)
        .lte('session_date', in30days)
        .in('status', ['pending', 'ready', 'confirmed'])
        .order('session_date', { ascending: true });
    } else {
      const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      query = query.gte('session_date', since).order('session_date', { ascending: false });
    }

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { sessions: data });
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.client_id && !body.client_name) return respond(400, { error: 'client_id or client_name is required.' });

    const insert = {
      client_id:         body.client_id        || null,
      client_name:       body.client_name       || null,
      service:           body.service           || null,
      session_date:      body.session_date       || null,
      session_time:      body.session_time       || null,
      duration_minutes:  body.duration_minutes   || 60,
      location_type:     body.location_type      || 'distance',
      status:            body.status             || 'pending',
      payment_status:    body.payment_status     || 'unpaid',
      amount_due:        body.amount_due         || null,
      square_booking_id: body.square_booking_id  || null,
      source:            body.source             || 'manual',
      seller_notes:      body.seller_notes       || null,
      state_before:      body.state_before       || null,
      state_after:       body.state_after        || null,
      google_calendar_status: ['in_person', 'in-person', 'house-cleansing-blessing'].includes(String(body.location_type || 'distance').toLowerCase()) ? 'not_requested' : 'pending',
    };

    const { data, error } = await sb.from('sessions').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'sessions', recordId: data.id, newData: data, context: `Created session for ${data.client_name || data.client_id}`, ip });

    // Auto-schedule aftercare when a completed session is created
    if (data.status === 'completed' && data.session_date) {
      await scheduleAftercare({ session: data, sb });
    }

    // Fire booking confirmation email (fire-and-forget)
    const clientEmail = body.client_email || await (async () => {
      if (!data.client_id) return null;
      try {
        const { data: c } = await sb.from('clients').select('email').eq('id', data.client_id).single();
        return c?.email || null;
      } catch { return null; }
    })();
    if (clientEmail) {
      sendTransactional(sb, {
        templateName:   'appointment_confirmation',
        recipientEmail: clientEmail,
        clientId:       data.client_id || null,
        variables: {
          client_name:  data.client_name || '',
          service:      data.service     || '',
          session_date: data.session_date || '',
          session_time: data.session_time ? data.session_time.slice(0, 5) : '',
          location_type: data.location_type || 'distance',
          manage_url:   process.env.SITE_URL
            ? `${process.env.SITE_URL}/manage-appointment.html?session_id=${data.id}`
            : '',
        },
        metadata: { trigger: 'booking_created', session_id: data.id },
      }).catch(async e => {
      await emailFailure(sb, { templateName: 'appointment_confirmation', clientId: data.client_id, sessionId: data.id, error: e });
    });
    }

    return respond(201, { session: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('sessions').select('*').eq('id', params.id).single();
    if (!old) return respond(404, { error: 'Session not found.' });

    if (body.action === 'cancel') {
      if (old.status === 'cancelled') return respond(409, { error: 'Session is already cancelled.' });
      if (old.status === 'completed') return respond(409, { error: 'Completed sessions cannot be cancelled.' });
      await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('session_id', params.id);
      const { data: cancelled, error: cancelErr } = await sb.from('sessions')
        .update({ status: 'cancelled', google_calendar_status: old.google_calendar_event_id ? 'cancel_pending' : 'cancelled', google_calendar_error: null }).eq('id', params.id).select().single();
      if (cancelErr) return respond(500, { error: cancelErr.message });
      await log({ actor: auth.user.email, action: 'session_cancelled', tableName: 'sessions', recordId: params.id,
        oldData: old, newData: cancelled, context: `Cancelled session. Reason: ${body.reason || 'not specified'}`, ip });
      return respond(200, { session: cancelled, cancelled: true });
    }

    if (body.action === 'restore') {
      if (old.status !== 'cancelled') return respond(409, { error: 'Only cancelled sessions can be restored.' });
      const timeNorm = old.session_time && old.session_time.length === 5 ? old.session_time + ':00' : old.session_time;
      const { data: slot } = await sb.from('availability_slots').select('id,status,session_id')
        .eq('slot_date', old.session_date).eq('slot_time', timeNorm).maybeSingle();
      if (slot && slot.status === 'booked' && slot.session_id && slot.session_id !== params.id) {
        return respond(409, { error: 'The original time is now booked. Reschedule instead of restoring.' });
      }
      if (slot) await sb.from('availability_slots').update({ status: 'booked', session_id: params.id }).eq('id', slot.id);
      const { data: restored, error: restoreErr } = await sb.from('sessions')
        .update({ status: 'confirmed', google_calendar_status: 'pending', google_calendar_error: null }).eq('id', params.id).select().single();
      if (restoreErr) return respond(500, { error: restoreErr.message });
      await log({ actor: auth.user.email, action: 'session_restored', tableName: 'sessions', recordId: params.id,
        oldData: old, newData: restored, context: body.reason || 'Restored cancelled session from dashboard', ip });
      return respond(200, { session: restored, restored: true });
    }

    if (body.action === 'reminder') {
      if (old.status === 'cancelled' || old.status === 'completed') {
        return respond(409, { error: 'Reminders can only be sent for active appointments.' });
      }
      let clientEmail = body.client_email || null;
      if (!clientEmail && old.client_id) {
        const { data: client } = await sb.from('clients').select('email').eq('id', old.client_id).single();
        clientEmail = client?.email || null;
      }
      if (!clientEmail) return respond(409, { error: 'No client email is available for this appointment.' });
      const result = await sendTransactional(sb, {
        templateName: 'appointment_reminder', recipientEmail: clientEmail, clientId: old.client_id || null,
        variables: { client_name: old.client_name || '', service: old.service || '',
          session_date: old.session_date || '', session_time: old.session_time ? old.session_time.slice(0, 5) : '',
          timezone: 'ET', manage_url: process.env.SITE_URL ? `${process.env.SITE_URL}/manage-appointment.html?session_id=${old.id}` : '',
          contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
          ...(/^https:\/\/meet\.google\.com\//i.test(old.google_meet_url || '') ? { google_meet_url: old.google_meet_url } : {}) },
        metadata: { trigger: 'dashboard_manual_reminder', session_id: old.id },
        idempotencyKey: `dashboard-manual-reminder:${old.id}:${old.session_date}:${String(old.session_time || '').slice(0, 5)}`,
      });
      const { data: reminded } = await sb.from('sessions')
        .update({ reminder_sent: true, reminder_sent_at: new Date().toISOString() }).eq('id', params.id).select().single();
      await log({ actor: auth.user.email, action: 'session_reminder_sent', tableName: 'sessions', recordId: params.id,
        oldData: old, newData: reminded, context: `Sent appointment reminder to ${clientEmail}`, ip });
      return respond(200, { session: reminded, reminder_sent: true, result });
    }

    // ── RESCHEDULE action — atomic slot swap ─────────────────────────
    if (body.action === 'reschedule') {
      if (!body.new_date || !body.new_time) {
        return respond(400, { error: 'new_date and new_time are required for reschedule.' });
      }

      // Validate the destination before releasing the current slot. A rejected
      // reschedule must not orphan the existing appointment.
      const timeNorm = body.new_time.length === 5 ? body.new_time + ':00' : body.new_time;
      let destinationSlot = null;
      if (body.new_slot_id) {
        const { data: newSlot, error: slotErr } = await sb
          .from('availability_slots').select('id,status').eq('id', body.new_slot_id).single();
        if (slotErr || !newSlot) return respond(404, { error: 'The selected time slot was not found.' });
        if (newSlot && newSlot.status === 'booked') {
          return respond(409, { error: 'That slot is already booked. Choose a different time.' });
        }
        destinationSlot = newSlot;
      } else {
        const { data: slotByTime, error: slotErr } = await sb
          .from('availability_slots')
          .select('id,status')
          .eq('slot_date', body.new_date)
          .eq('slot_time', timeNorm)
          .maybeSingle();
        if (slotErr) return respond(500, { error: slotErr.message });
        if (slotByTime) {
          if (slotByTime.status === 'booked') {
            return respond(409, { error: 'That time slot is already booked. Choose a different time.' });
          }
          destinationSlot = slotByTime;
        }
      }

      // Destination is safe: release the old slot, then reserve the new one.
      const { error: releaseErr } = await sb.from('availability_slots')
        .update({ status: 'available', session_id: null })
        .eq('session_id', params.id);
      if (releaseErr) return respond(500, { error: releaseErr.message });
      if (destinationSlot) {
        const { error: reserveErr } = await sb.from('availability_slots')
          .update({ status: 'booked', session_id: params.id })
          .eq('id', destinationSlot.id);
        if (reserveErr) return respond(500, { error: reserveErr.message });
      }

      // Update session record
      const reschedCount = (old?.reschedule_count || 0) + 1;
      const { data: rescheduled, error: rErr } = await sb.from('sessions')
        .update({
          session_date:          body.new_date,
          session_time:          body.new_time,
          status:                'confirmed',
          reschedule_count:      reschedCount,
          reschedule_reason:     body.reason     || null,
          last_rescheduled_at:   new Date().toISOString(),
          last_rescheduled_by:   body.requested_by === 'client'
                                   ? (old?.client_name || 'client')
                                   : auth.user.email,
          google_calendar_status: old?.google_calendar_event_id ? 'reschedule_pending' : 'pending',
          google_calendar_error:  null,
        })
        .eq('id', params.id)
        .select().single();
      if (rErr) return respond(500, { error: rErr.message });

      await log({
        actor: auth.user.email, action: 'session_rescheduled',
        tableName: 'sessions', recordId: params.id,
        oldData: { session_date: old?.session_date, session_time: old?.session_time },
        newData: { session_date: body.new_date, session_time: body.new_time, reschedule_count: reschedCount },
        context: `Session rescheduled ${old?.session_date} → ${body.new_date}. Reason: ${body.reason || 'not specified'}`,
        ip,
      });

      return respond(200, { session: rescheduled, rescheduled: true, reschedule_count: reschedCount });
    }

    if (body.action === 'retry_google_sync') {
      if (old.status === 'cancelled' && !old.google_calendar_event_id) return respond(409, { error: 'There is no Google Calendar event to cancel.' });
      const nextStatus = old.status === 'cancelled' ? 'cancel_pending' : (old.google_calendar_event_id ? 'reschedule_pending' : 'pending');
      const { data: retried, error: retryErr } = await sb.from('sessions')
        .update({ google_calendar_status: nextStatus, google_calendar_error: null }).eq('id', params.id).select().single();
      if (retryErr) return respond(500, { error: retryErr.message });
      await log({ actor: auth.user.email, action: 'google_calendar_retry_requested', tableName: 'sessions', recordId: params.id, oldData: old, newData: retried, context: 'Requested Google Calendar synchronization retry', ip });
      return respond(200, { session: retried, google_retry_requested: true });
    }

    // ── Generic field update ─────────────────────────────────────────
    const allowed = ['status','booking_status','payment_status','amount_due','amount_paid','payment_paid_at','waiver_status','waiver_completed','waiver_completed_at','session_date','session_time','service','location_type','seller_notes','square_booking_id','stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status','state_before','state_after'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    const calendarRelevantChange = ['session_date','session_time','service','location_type'].some(k => body[k] !== undefined && body[k] !== old[k]);
    const nextLocation = String(body.location_type !== undefined ? body.location_type : old.location_type || '').toLowerCase();
    const nextStatus = String(body.status !== undefined ? body.status : old.status || '').toLowerCase();
    if (nextStatus === 'cancelled' || (calendarRelevantChange && ['in_person','in-person','house-cleansing-blessing'].includes(nextLocation))) {
      updates.google_calendar_status = old.google_calendar_event_id ? 'cancel_pending' : (nextStatus === 'cancelled' ? 'cancelled' : 'not_requested');
      updates.google_calendar_error = null;
    } else if (calendarRelevantChange) {
      updates.google_calendar_status = old.google_calendar_event_id ? 'reschedule_pending' : 'pending';
      updates.google_calendar_error = null;
    }

    const { data, error } = await sb.from('sessions').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'sessions', recordId: params.id, oldData: old, newData: data, context: body._context || `Updated session ${params.id}`, ip });

    // Schedule aftercare when a session is marked completed
    if (updates.status === 'completed' && old?.status !== 'completed' && data.session_date) {
      await scheduleAftercare({ session: data, sb });
    }

    return respond(200, { session: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
