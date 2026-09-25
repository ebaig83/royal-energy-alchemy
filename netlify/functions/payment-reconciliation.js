'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const crypto = require('crypto');

const SAFE_FIELDS = 'id,provider,provider_reference_id,payer_display_name,payer_email,payer_phone,amount,transaction_at,memo,recipient_context,detected_at,status,confidence,match_reason,candidate_matches,matched_client_id,matched_session_id,amount_applied,auto_attached,resolved_at,resolved_by,resolution_note';
const VALID_ACTIONS = new Set(['attach', 'unrelated', 'ignore_duplicate']);

exports.handler = async event => {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  const sb = getClient();
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 200);
    let query = sb.from('payment_reconciliation_items').select(SAFE_FIELDS).order('detected_at', { ascending: false }).limit(limit);
    if (params.status) query = query.eq('status', params.status);
    else query = query.in('status', ['needs_reconciliation', 'matched']);
    const { data, error } = await query;
    if (error) return respond(500, { error: 'Payment reconciliation is unavailable.' });
    const rows = data || [];
    const clientIds = [...new Set(rows.map(row => row.matched_client_id).filter(Boolean))];
    const sessionIds = [...new Set(rows.flatMap(row => [row.matched_session_id, ...(Array.isArray(row.candidate_matches) ? row.candidate_matches.map(candidate => candidate.session_id) : [])]).filter(Boolean))];
    const [clients, sessions] = await Promise.all([
      clientIds.length ? sb.from('clients').select('id,full_name').in('id', clientIds) : { data: [] },
      sessionIds.length ? sb.from('sessions').select('id,client_name,session_date,session_time,payment_status,amount_due,amount_paid').in('id', sessionIds) : { data: [] },
    ]);
    const clientNames = Object.fromEntries((clients.data || []).map(client => [client.id, client.full_name]));
    const sessionRows = Object.fromEntries((sessions.data || []).map(session => [session.id, session]));
    return respond(200, { items: rows.map(row => ({ ...row, matched_client_name: clientNames[row.matched_client_id] || null, matched_session: row.matched_session_id ? sessionRows[row.matched_session_id] || null : null, candidate_matches: (row.candidate_matches || []).map(candidate => ({ ...candidate, session: sessionRows[candidate.session_id] || null })) })) });
  }
  if (event.httpMethod !== 'PATCH') return respond(405, { error: 'Method not allowed.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  if (!VALID_ACTIONS.has(body.action) || !body.id) return respond(400, { error: 'A reconciliation action and item id are required.' });
  const correlationId = crypto.randomUUID();
  if (body.action === 'attach') {
    if (!body.session_id) return respond(400, { error: 'A target session is required.' });
    const { data, error } = await sb.rpc('payment_reconciliation_attach_with_audit', {
      p_item_id: body.id, p_session_id: body.session_id,
      p_actor_type: 'practitioner', p_actor_id: auth.user.id, p_actor_email: auth.user.email,
      p_source: 'dashboard', p_correlation_id: correlationId,
      p_request_path: '/.netlify/functions/payment-reconciliation',
    });
    if (error) {
      const message = String(error.message || '');
      const safe = /amount_conflict|stripe|not_found|not_payable|session_not_found/.test(message) ? message : 'The payment could not be attached safely.';
      return respond(409, { error: safe });
    }
    return respond(200, { result: data });
  }
  const nextStatus = body.action === 'unrelated' ? 'unrelated' : 'duplicate';
  const { data, error } = await sb.rpc('practitioner_decide_payment_reconciliation_item_with_audit', {
    p_item_id: body.id, p_action: nextStatus, p_note: body.note ? String(body.note).slice(0, 500) : null,
    p_actor_id: auth.user.id, p_actor_email: auth.user.email, p_correlation_id: correlationId,
    p_request_path: '/.netlify/functions/payment-reconciliation',
  });
  if (error) return respond(409, { error: 'The reconciliation item could not be updated safely.' });
  return respond(200, { item: { id: body.id, status: data?.status || nextStatus }, duplicate: Boolean(data?.idempotent) });
};
