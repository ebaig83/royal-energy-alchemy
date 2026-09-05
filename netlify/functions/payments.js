// /.netlify/functions/payments
// GET    ?session_id=uuid  — payments for a session
// GET    ?client_id=uuid   — all payments for a client
// GET    ?unpaid=1         — sessions with unpaid/partial payment
// POST                     — record a payment, update session.payment_status
// PATCH  ?id=uuid          — edit/correct a payment record

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { isCalendarEligible }    = require('./lib/record-policy');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.unpaid) {
      const { data, error } = await sb
        .from('sessions')
        .select('id, client_name, session_date, service, amount_due, amount_paid, payment_status')
        .in('payment_status', ['unpaid', 'partial'])
        .not('session_date', 'is', null)
        .order('session_date', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { sessions: data });
    }

    if (params.all) {
      const limit = Math.min(Math.max(parseInt(params.limit, 10) || 200, 1), 500);
      const { data: payments, error } = await sb
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false })
        .limit(limit);
      if (error) return respond(500, { error: error.message });

      const sessionIds = [...new Set((payments || []).map(p => p.session_id).filter(Boolean))];
      let sessions = [];
      if (sessionIds.length) {
        const result = await sb
          .from('sessions')
          .select('id, client_name, service, session_date, payment_status')
          .in('id', sessionIds);
        if (result.error) return respond(500, { error: result.error.message });
        sessions = result.data || [];
      }
      const bySession = Object.fromEntries(sessions.map(s => [s.id, s]));
      return respond(200, {
        payments: (payments || []).map(p => Object.assign({}, p, { session: bySession[p.session_id] || null }))
      });
    }

    let query = sb.from('payments').select('*');
    if (params.session_id) {
      query = query.eq('session_id', params.session_id);
    } else if (params.client_id) {
      query = query.eq('client_id', params.client_id);
    } else {
      return respond(400, { error: 'session_id, client_id, or unpaid=1 is required.' });
    }

    const { data, error } = await query.order('paid_at', { ascending: false });
    if (error) return respond(500, { error: error.message });
    return respond(200, { payments: data });
  }

  // ── POST — record a payment ───────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.amount || isNaN(body.amount)) return respond(400, { error: 'amount is required.' });
    if (!body.session_id && !body.client_id) return respond(400, { error: 'session_id or client_id is required.' });

    const { data: payment, error: payErr } = await sb
      .from('payments')
      .insert({
        session_id:   body.session_id   || null,
        client_id:    body.client_id    || null,
        client_name:  body.client_name  || null,
        amount:       parseFloat(body.amount),
        method:       body.method       || 'cash_app',
        reference_id: body.reference_id || null,
        status:       body.status       || 'received',
        notes:        body.notes        || null,
        paid_at:      body.paid_at      || new Date().toISOString(),
      })
      .select()
      .single();

    if (payErr) return respond(500, { error: payErr.message });

    // Update session.amount_paid and payment_status
    if (body.session_id) {
      const { data: session } = await sb
        .from('sessions')
        .select('id,amount_due,amount_paid,service,session_date,session_time,location_type,status,source,google_calendar_status,google_calendar_event_id')
        .eq('id', body.session_id)
        .single();

      if (session) {
        const totalPaid = (session.amount_paid || 0) + parseFloat(body.amount);
        const due       = session.amount_due || 0;
        const newStatus = totalPaid >= due && due > 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';

        const sessionPatch = { amount_paid: totalPaid, payment_status: newStatus };
        if (newStatus === 'paid' && isCalendarEligible({ ...session, payment_status: newStatus }) && !session.google_calendar_event_id && session.google_calendar_status === 'not_requested') {
          sessionPatch.google_calendar_status = 'pending';
          sessionPatch.google_calendar_error = null;
        }
        await sb.from('sessions')
          .update(sessionPatch)
          .eq('id', body.session_id);
      }
    }

    await log({ actor: auth.user.email, action: 'created', tableName: 'payments', recordId: payment.id, newData: payment, context: `Recorded $${payment.amount} via ${payment.method} for ${payment.client_name || payment.client_id}`, ip });
    return respond(201, { payment });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['amount','method','reference_id','status','notes','paid_at'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    const { data, error } = await sb.from('payments').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'payments', recordId: params.id, newData: data, context: `Edited payment record`, ip });
    return respond(200, { payment: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
