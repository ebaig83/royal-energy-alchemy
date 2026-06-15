// /.netlify/functions/cancellations
//
// PUBLIC  POST (no auth) — client submits cancellation request
// ADMIN   GET  (auth)    — list cancellation requests
//   ?status=pending|approved|denied
//   ?id=uuid             — get single request
// ADMIN   PATCH ?id=uuid (auth) — approve / deny / reschedule / mark no-show

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

// ── Refund policy ─────────────────────────────────────────────────────────────
// 72+ hours before appointment: eligible for 50% refund or session credit
// < 72 hours before appointment: non-refundable
// No-show / no-call: non-refundable, must prepay to rebook

function calcRefundEligibility(appointmentDate, appointmentTime) {
  if (!appointmentDate) return { eligible: false, pct: 0, estimate: 'Non-refundable — appointment date not provided.', hours: null };

  const timeStr  = appointmentTime ? appointmentTime.slice(0, 5) : '12:00';
  const [h, m]   = timeStr.split(':').map(Number);
  const [y, mo, d] = appointmentDate.split('-').map(Number);
  const apptMs   = new Date(y, mo - 1, d, h, m).getTime();
  const nowMs    = Date.now();
  const hoursUntil = (apptMs - nowMs) / 3600000;

  if (hoursUntil >= 72) {
    return {
      eligible: true,
      pct:      50,
      estimate: 'Eligible for 50% refund or session credit.',
      hours:    Math.round(hoursUntil),
    };
  } else if (hoursUntil > 0) {
    return {
      eligible: false,
      pct:      0,
      estimate: `Non-refundable — appointment is within ${Math.round(hoursUntil)} hours (policy requires 72+ hours notice).`,
      hours:    Math.round(hoursUntil),
    };
  } else {
    return {
      eligible: false,
      pct:      0,
      estimate: 'Non-refundable — appointment has already passed or no-show policy may apply.',
      hours:    Math.round(hoursUntil),
    };
  }
}

// ── handler ───────────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── PUBLIC POST — submit cancellation request ────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { client_name, email, appointment_date, reason } = body;
    if (!client_name) return respond(400, { error: 'client_name is required.' });
    if (!email)       return respond(400, { error: 'email is required.' });
    if (!appointment_date) return respond(400, { error: 'appointment_date is required.' });
    if (!reason)      return respond(400, { error: 'reason is required.' });

    // Calculate refund eligibility server-side
    const refund = calcRefundEligibility(body.appointment_date, body.appointment_time);

    // Try to find matching session by email + date
    let session_id = null;
    const { data: sessions } = await sb
      .from('sessions')
      .select('id')
      .eq('session_date', body.appointment_date)
      .ilike('client_name', `%${client_name.split(' ')[0]}%`)
      .in('status', ['pending', 'confirmed'])
      .limit(1);
    if (sessions && sessions.length) session_id = sessions[0].id;

    const insert = {
      client_name:       body.client_name,
      email:             body.email,
      phone:             body.phone             || null,
      appointment_date:  body.appointment_date,
      appointment_time:  body.appointment_time  ? body.appointment_time.slice(0,8) : null,
      service:           body.service           || null,
      payment_method:    body.payment_method    || null,
      reason:            body.reason,
      wants_reschedule:  body.wants_reschedule  === true || body.wants_reschedule === 'true',
      additional_notes:  body.additional_notes  || null,
      hours_until_appt:  refund.hours,
      refund_eligible:   refund.eligible,
      refund_estimate:   refund.estimate,
      refund_pct:        refund.pct,
      session_id,
      status:            'pending',
    };

    const { data, error } = await sb.from('cancellation_requests').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    // Mark linked session as cancellation requested
    if (session_id) {
      await sb.from('sessions').update({
        cancel_reason:       body.reason,
        cancel_requested_at: new Date().toISOString(),
      }).eq('id', session_id);
    }

    await log({
      actor:     body.email,
      action:    'created',
      tableName: 'cancellation_requests',
      recordId:  data.id,
      newData:   data,
      context:   `Client cancellation request from ${body.client_name} for ${body.appointment_date}`,
      ip,
    });

    return respond(201, {
      request_id:      data.id,
      refund_eligible: refund.eligible,
      refund_estimate: refund.estimate,
      message:         'Your cancellation request has been submitted. Royal Energy Alchemy will review your request and confirm any refund or reschedule details.',
    });
  }

  // ── ADMIN — require auth for all other methods ────────────────────────────
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  // ── ADMIN GET ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.id) {
      const { data, error } = await sb.from('cancellation_requests').select('*').eq('id', params.id).single();
      if (error) return respond(404, { error: 'Request not found.' });
      return respond(200, { request: data });
    }

    let query = sb.from('cancellation_requests').select('*');
    if (params.status) query = query.eq('status', params.status);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { requests: data || [] });
  }

  // ── ADMIN PATCH — approve / deny / reschedule / no-show ──────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('cancellation_requests').select('*').eq('id', params.id).single();
    if (!old) return respond(404, { error: 'Request not found.' });

    const allowed = ['status','admin_notes','refund_approved_amt'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    if (body.status && ['approved','denied','rescheduled','no_show'].includes(body.status)) {
      updates.approved_by = auth.user.email;
      updates.approved_at = new Date().toISOString();
    }

    const { data, error } = await sb.from('cancellation_requests').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    // Cascade to the linked session
    if (old.session_id) {
      const sessionUpdates = {};

      if (body.status === 'approved') {
        sessionUpdates.status         = 'cancelled';
        sessionUpdates.cancel_reason  = old.reason;
        if (body.refund_approved_amt != null) {
          sessionUpdates.refund_status = body.refund_approved_amt > 0 ? 'approved' : 'denied';
          sessionUpdates.refund_amount = body.refund_approved_amt;
          sessionUpdates.payment_status = 'refunded';
        }
      } else if (body.status === 'no_show') {
        sessionUpdates.status        = 'no_show';
        sessionUpdates.cancel_reason = 'No-show / no-call';
        sessionUpdates.refund_status = 'denied';
      } else if (body.status === 'denied') {
        sessionUpdates.refund_status = 'denied';
      }

      if (Object.keys(sessionUpdates).length) {
        await sb.from('sessions').update(sessionUpdates).eq('id', old.session_id);
      }
    }

    // Mark the availability slot as available again if session cancelled
    if (body.status === 'approved' && old.appointment_date && old.appointment_time) {
      const timeNorm = old.appointment_time.slice(0,8);
      await sb.from('availability_slots')
        .update({ status: 'cancelled' })
        .eq('slot_date', old.appointment_date)
        .eq('slot_time', timeNorm);
    }

    await log({
      actor:     auth.user.email,
      action:    'updated',
      tableName: 'cancellation_requests',
      recordId:  params.id,
      oldData:   old,
      newData:   data,
      context:   `Cancellation request ${body.status} for ${old.client_name} on ${old.appointment_date}`,
      ip,
    });

    return respond(200, { request: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
