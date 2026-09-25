'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { isWebsiteBooking, isOperationalWebsiteBooking, attachServiceAddress } = require('./lib/booking-state');
const { sendTransactional } = require('./lib/mailer');
const { appointmentManageUrl } = require('./lib/appointment-token');
const { verifyAppointmentToken } = require('./lib/appointment-token');

const COMPLETE_WAIVER = 'complete';
function isDone(value) {
  return ['complete', 'completed', 'signed', 'true'].includes(String(value || '').toLowerCase());
}

async function markBookingState(sb, sessionId, updates, trustedContext) {
  const { data: current, error } = await sb
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error || !current) return { error: 'Session not found.' };
  let currentSession=current;
  if(['in_person','in-person'].includes(String(current.location_type||'').toLowerCase())){
    const {data:address,error:addressError}=await sb.from('session_service_addresses').select('address_line1,address_line2,city,state,postal_code,country').eq('session_id',current.id).maybeSingle();
    if(addressError)return {error:'Unable to verify the in-person service address.'};
    currentSession=attachServiceAddress(current,address);
  }

  const paymentPaid = String(updates.payment_status || current.payment_status || '').toLowerCase() === 'paid';
  const waiverDone = updates.waiver_completed === true || isDone(updates.waiver_status || current.waiver_status) || current.waiver_completed === true;
  const website = isWebsiteBooking(currentSession);
  const holdActive = !!currentSession.payment_hold_expires_at && Date.parse(currentSession.payment_hold_expires_at) > Date.now() && String(currentSession.status || '').toLowerCase() === 'pending';
  const candidate = { ...currentSession, ...updates, payment_status: paymentPaid ? 'paid' : currentSession.payment_status, waiver_status: waiverDone ? COMPLETE_WAIVER : currentSession.waiver_status, waiver_completed: waiverDone };
  const confirmed = website && holdActive && paymentPaid && waiverDone && isOperationalWebsiteBooking({ ...candidate, status: 'confirmed', booking_status: 'confirmed' });
  const next = Object.assign({}, updates, {
    ...(website ? { status: confirmed ? 'confirmed' : 'pending', booking_status: confirmed ? 'confirmed' : paymentPaid ? 'payment_received_incomplete' : 'payment_required', google_calendar_status: confirmed ? 'pending' : 'not_requested' } : {}),
    ...(!website ? { booking_status: paymentPaid && waiverDone ? 'ready' : paymentPaid ? 'payment_paid' : 'payment_required' } : {}),
    updated_at: new Date().toISOString(),
  });

  const { data: result, error: updateErr } = await sb.rpc('trusted_session_update_with_audit', {
    p_id: sessionId, p_updates: next, p_actor_type: 'client', p_actor_id: trustedContext.actorId,
    p_actor_email: trustedContext.actorEmail, p_source: 'signed_waiver', p_action: 'waiver_completed',
    p_correlation_id: trustedContext.correlationId, p_request_path: '/.netlify/functions/booking-waiver',
  });

  return { data: result?.session || null, error: updateErr?.message || null };
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
  const tokenResult = verifyAppointmentToken(body.token, sessionId, 'waiver');
  if (!tokenResult.ok) return respond(401, { error: 'This waiver link is invalid or has expired.', code: tokenResult.reason });
  if (!name) return respond(400, { error: 'Client name is required.' });
  if (!email) return respond(400, { error: 'Client email is required.' });

  const sb = getClient();
  const { data: session, error: sessionErr } = await sb
    .from('sessions')
    .select('id, client_id, client_name, client_email, client_phone, service, session_date, session_time, location_type, source, status, booking_status, payment_status, waiver_status, waiver_completed')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) return respond(404, { error: 'Booking was not found. Please contact Daron before submitting another waiver.' });

  const signedAt = new Date().toISOString();
  const correlationId = require('crypto').randomUUID();
  let actorEmail = session.client_email || null;
  if (session.client_id) {
    const { data: canonicalClient } = await sb.from('clients').select('email').eq('id', session.client_id).maybeSingle();
    actorEmail = canonicalClient?.email || actorEmail;
  }
  const updateResult = await markBookingState(sb, sessionId, {
    waiver_status: COMPLETE_WAIVER,
    waiver_completed: true,
    waiver_completed_at: signedAt,
  }, { actorId: session.client_id || null, actorEmail, correlationId });

  if (updateResult.error) return respond(500, { error: updateResult.error });
  console.info('[booking-waiver] appointment mutation',JSON.stringify({session_id:sessionId,correlation_id:correlationId,actor_type:'client',source:'signed_waiver',action:'waiver_completed'}));

  if (updateResult.data?.status === 'confirmed' && updateResult.data?.booking_status === 'confirmed') {
    let recipient = updateResult.data.client_email || null;
    if (!recipient && updateResult.data.client_id) {
      const { data: client } = await sb.from('clients').select('email').eq('id', updateResult.data.client_id).maybeSingle();
      recipient = client?.email || null;
    }
    if (recipient) {
      const confirmationCorrelationId = `booking-confirmed:${sessionId}`;
      await sendTransactional(sb, {
        templateName: 'appointment_confirmation', recipientEmail: recipient,
        clientId: updateResult.data.client_id || null, sessionId,
        variables: { client_name: updateResult.data.client_name || name, service: updateResult.data.service || '', session_date: updateResult.data.session_date || '', session_time: String(updateResult.data.session_time || '').slice(0, 5), timezone: 'ET', duration_minutes: updateResult.data.duration_minutes || null, location_type: updateResult.data.location_type || 'distance', contact_email: process.env.ADMIN_EMAIL || 'droyal168@gmail.com', manage_url: appointmentManageUrl(sessionId) },
        metadata: { trigger: 'website_booking_confirmed_after_waiver', session_id: sessionId, correlation_id: correlationId },
        idempotencyKey: confirmationCorrelationId,
      }).catch(error => console.warn('[booking-waiver] confirmation notification failed', JSON.stringify({ session_id: sessionId, correlation_id: confirmationCorrelationId, error: String(error?.message || 'unknown').slice(0, 160) })));
    }
  }

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
