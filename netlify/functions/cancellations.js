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
const { calcRefund }            = require('./lib/policy');

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
    const refund = calcRefund(body.appointment_date, body.appointment_time);

    const correlationId=require('crypto').randomUUID();
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
      status:            'pending',
    };
    const {data:created,error}=await sb.rpc('create_client_cancellation_request_with_audit',{
      p_request:insert,p_correlation_id:correlationId,p_request_path:'/.netlify/functions/cancellations',
    });
    if(error||!created?.request)return respond(500,{error:'Cancellation request could not be recorded.'});
    const data=created.request;
    console.info('[cancellations] request recorded',JSON.stringify({request_id:data.id,correlation_id:correlationId,actor_type:'unknown',source:'public_cancellation_form'}));

    await log({
      actor:     'public_cancellation_form',
      action:    'created',
      tableName: 'cancellation_requests',
      recordId:  data.id,
      newData:   data,
      context:   `Cancellation request submitted for ${body.appointment_date}; correlation ${correlationId}`,
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

    const correlationId=require('crypto').randomUUID();
    const {data:decision,error}=await sb.rpc('practitioner_decide_cancellation_request',{
      p_request_id:params.id,p_status:body.status,p_admin_notes:body.admin_notes||null,
      p_refund_amount:body.refund_approved_amt==null?null:Number(body.refund_approved_amt),
      p_actor_id:auth.user.id,p_actor_email:auth.user.email,p_correlation_id:correlationId,
      p_request_path:'/.netlify/functions/cancellations',
    });
    if(error||!decision?.request)return respond(409,{error:'Cancellation request could not be finalized. Reload and review its current state.'});
    const data=decision.request;
    console.info('[cancellations] appointment mutation',JSON.stringify({session_id:decision.session?.id||null,correlation_id:correlationId,actor_type:'practitioner',source:'dashboard',action:body.status}));

    await log({
      actor:     auth.user.email,
      action:    'updated',
      tableName: 'cancellation_requests',
      recordId:  params.id,
      oldData:   old,
      newData:   data,
      context:   `Cancellation request ${body.status}; correlation ${correlationId}`,
      ip,
    });

    return respond(200, { request: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
