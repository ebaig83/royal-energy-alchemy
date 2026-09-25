// /.netlify/functions/payments
// GET    ?session_id=uuid  — payments for a session
// GET    ?client_id=uuid   — all payments for a client
// GET    ?unpaid=1         — sessions with unpaid/partial payment
// POST                     — record a payment (requires idempotency_key UUID)
// PATCH  ?id=uuid          — edit/correct a payment record

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const crypto                    = require('crypto');

function requestCorrelationId(body) {
  const requested = String(body?.idempotency_key || '').trim();
  if (requested && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)) return null;
  return requested || crypto.randomUUID();
}

function hasIdempotencyKey(body) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body?.idempotency_key || '').trim());
}

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

    if (!hasIdempotencyKey(body)) return respond(400, { error: 'A UUID idempotency_key is required for payment creation.' });
    if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return respond(400, { error: 'A positive amount is required.' });
    if (!body.session_id && !body.client_id) return respond(400, { error: 'session_id or client_id is required.' });
    if (String(body.method || '').toLowerCase() === 'stripe') return respond(400, { error: 'Stripe payments can only be recorded by verified webhook processing.' });
    const correlationId = requestCorrelationId(body);
    if (!correlationId) return respond(400, { error: 'idempotency_key must be a valid UUID.' });
    const paymentInput = {
        session_id:   body.session_id   || null,
        client_id:    body.client_id    || null,
        client_name:  body.client_name  || null,
        amount:       parseFloat(body.amount),
        method:       body.method       || 'cash_app',
        reference_id: body.reference_id || null,
        status:       body.status       || 'received',
        notes:        body.notes        || null,
        excess_allocation: body.excess_allocation || null,
        paid_at:      body.paid_at      || new Date().toISOString(),
    };
    let payment;
    if (body.session_id) {
      const {data:recorded,error:recordError}=await sb.rpc('practitioner_record_manual_payment_with_audit',{
        p_session_id:body.session_id,p_payment:paymentInput,p_actor_id:auth.user.id,p_actor_email:auth.user.email,
        p_correlation_id:correlationId,p_request_path:'/.netlify/functions/payments',
      });
      if(recordError||!recorded?.payment)return respond(409,{error:'The payment could not be recorded against this appointment. Reload and review its current state.'});
      payment=recorded.payment;
      console.info('[payments] appointment mutation',JSON.stringify({session_id:body.session_id,correlation_id:correlationId,actor_type:'practitioner',source:'dashboard',action:'manual_payment_recorded'}));
    } else {
      const { data:recorded,error:recordError }=await sb.rpc('practitioner_create_standalone_payment_with_audit',{
        p_payment:paymentInput,p_actor_id:auth.user.id,p_actor_email:auth.user.email,
        p_correlation_id:correlationId,p_request_path:'/.netlify/functions/payments',
      });
      if(recordError||!recorded?.payment)return respond(409,{error:'The standalone payment could not be recorded. Reload and verify its current state.'});
      payment=recorded.payment;
      console.info('[payments] standalone mutation',JSON.stringify({payment_id:payment.id,correlation_id:correlationId,actor_type:'practitioner',source:'dashboard',action:'standalone_payment_recorded'}));
    }

    await log({ actor: auth.user.email, action: 'created', tableName: 'payments', recordId: payment.id, newData: payment, context: `Recorded $${payment.amount} via ${payment.method} for ${payment.client_name || payment.client_id}`, ip });
    return respond(201, { payment });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const allowed = ['amount','method','reference_id','status','notes','paid_at','excess_allocation'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    if (!Object.keys(updates).length) return respond(400, { error: 'At least one payment field is required.' });
    if (String(updates.method || '').toLowerCase() === 'stripe') return respond(400, { error: 'Stripe payment records cannot be edited manually.' });
    if (updates.amount !== undefined && (!Number.isFinite(Number(updates.amount)) || Number(updates.amount) <= 0)) return respond(400, { error: 'Payment amount must be positive.' });
    const correlationId = requestCorrelationId(body);
    if (!correlationId) return respond(400, { error: 'idempotency_key must be a valid UUID.' });
    const { data:recorded,error:recordError }=await sb.rpc('practitioner_update_payment_with_audit',{
      p_payment_id:params.id,p_updates:updates,p_actor_id:auth.user.id,p_actor_email:auth.user.email,
      p_correlation_id:correlationId,p_request_path:'/.netlify/functions/payments',
    });
    if(recordError||!recorded?.payment)return respond(409,{error:'The payment could not be updated. Stripe and session-linked payments require their authorized mutation workflow.'});
    const data=recorded.payment;
    console.info('[payments] payment mutation',JSON.stringify({payment_id:data.id,session_id:data.session_id||null,correlation_id:correlationId,actor_type:'practitioner',source:'dashboard',action:'payment_updated'}));
    await log({ actor: auth.user.email, action: 'updated', tableName: 'payments', recordId: params.id, newData: data, context: `Edited payment record; correlation ${correlationId}`, ip });
    return respond(200, { payment: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
