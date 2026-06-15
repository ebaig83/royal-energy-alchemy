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
        .in('status', ['pending', 'confirmed'])
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
    };

    const { data, error } = await sb.from('sessions').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'sessions', recordId: data.id, newData: data, context: `Created session for ${data.client_name || data.client_id}`, ip });

    // Auto-schedule aftercare when a completed session is created
    if (data.status === 'completed' && data.session_date) {
      await scheduleAftercare({ session: data, sb });
    }

    return respond(201, { session: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('sessions').select('*').eq('id', params.id).single();

    // ── RESCHEDULE action — atomic slot swap ─────────────────────────
    if (body.action === 'reschedule') {
      if (!body.new_date || !body.new_time) {
        return respond(400, { error: 'new_date and new_time are required for reschedule.' });
      }

      // 1. Release old slot (matched by session_id link)
      await sb.from('availability_slots')
        .update({ status: 'available', session_id: null })
        .eq('session_id', params.id);

      // 2. Reserve new slot — prefer explicit slot ID, fall back to date+time lookup
      const timeNorm = body.new_time.length === 5 ? body.new_time + ':00' : body.new_time;
      if (body.new_slot_id) {
        const { data: newSlot } = await sb
          .from('availability_slots').select('id,status').eq('id', body.new_slot_id).single();
        if (newSlot && newSlot.status === 'booked') {
          return respond(409, { error: 'That slot is already booked. Choose a different time.' });
        }
        await sb.from('availability_slots')
          .update({ status: 'booked', session_id: params.id })
          .eq('id', body.new_slot_id);
      } else {
        const { data: slotByTime } = await sb
          .from('availability_slots')
          .select('id,status')
          .eq('slot_date', body.new_date)
          .eq('slot_time', timeNorm)
          .maybeSingle();
        if (slotByTime) {
          if (slotByTime.status === 'booked') {
            return respond(409, { error: 'That time slot is already booked. Choose a different time.' });
          }
          await sb.from('availability_slots')
            .update({ status: 'booked', session_id: params.id })
            .eq('id', slotByTime.id);
        }
      }

      // 3. Update session record
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

    // ── Generic field update ─────────────────────────────────────────
    const allowed = ['status','payment_status','amount_due','amount_paid','session_date','session_time','service','location_type','seller_notes','square_booking_id','state_before','state_after'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

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
