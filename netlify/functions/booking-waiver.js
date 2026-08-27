'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');

const COMPLETE_WAIVER = 'complete';
function isDone(value) {
  return ['complete', 'completed', 'signed', 'true'].includes(String(value || '').toLowerCase());
}

async function markBookingState(sb, sessionId, updates) {
  const { data: current, error } = await sb
    .from('sessions')
    .select('id, status, payment_status, waiver_status, waiver_completed')
    .eq('id', sessionId)
    .single();

  if (error || !current) return { error: 'Session not found.' };

  const paymentPaid = String(updates.payment_status || current.payment_status || '').toLowerCase() === 'paid';
  const waiverDone = updates.waiver_completed === true || isDone(updates.waiver_status || current.waiver_status) || current.waiver_completed === true;
  const next = Object.assign({}, updates, {
    booking_status: paymentPaid && waiverDone ? 'ready' : 'waiver_complete',
    updated_at: new Date().toISOString(),
  });

  const { data, error: updateErr } = await sb
    .from('sessions')
    .update(next)
    .eq('id', sessionId)
    .select()
    .single();

  return { data, error: updateErr?.message || null };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  const sessionId = body.session_id || body.booking_id;
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();

  if (!sessionId) return respond(400, { error: 'Booking ID is required before the waiver can be saved.' });
  if (!name) return respond(400, { error: 'Client name is required.' });
  if (!email) return respond(400, { error: 'Client email is required.' });

  const sb = getClient();
  const { data: session, error: sessionErr } = await sb
    .from('sessions')
    .select('id, client_id, client_name, service, session_date, session_time, payment_status, waiver_status')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) return respond(404, { error: 'Booking was not found. Please contact Daron before submitting another waiver.' });

  const signedAt = new Date().toISOString();
  const updateResult = await markBookingState(sb, sessionId, {
    waiver_status: COMPLETE_WAIVER,
    waiver_completed: true,
    waiver_completed_at: signedAt,
  });

  if (updateResult.error) return respond(500, { error: updateResult.error });

  if (session.client_id) {
    const doc = {
      client_id: session.client_id,
      session_id: sessionId,
      document_type: 'waiver',
      title: 'Waiver / Legal Agreement',
      status: 'signed',
      signed_at: signedAt,
      signature: body.signature || null,
      metadata: {
        client_reference: body.client_reference || null,
        email,
        phone,
        source: 'public_booking_waiver',
        consents: body.consents || {},
      },
    };

    try {
      const { error: docErr } = await sb.from('client_documents').insert(doc);
      if (docErr) throw docErr;
    } catch (e) {
      console.warn('[booking-waiver] client_documents insert skipped:', e.message);
    }
  }

  try {
    await sb.from('audit_logs').insert({
      action: 'waiver_completed',
      table_name: 'sessions',
      record_id: sessionId,
      actor: email,
      new_data: { session_id: sessionId, client_name: name, signed_at: signedAt },
    });
  } catch { /* non-fatal */ }

  return respond(200, {
    saved: true,
    session_id: sessionId,
    waiver_status: COMPLETE_WAIVER,
    payment_status: updateResult.data?.payment_status || session.payment_status || 'pending',
    next: 'payment',
  });
};
