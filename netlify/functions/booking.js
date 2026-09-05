'use strict';

// ── /.netlify/functions/booking ───────────────────────────────────────────────
// PUBLIC POST — client submits booking from book.html.
// No auth required. Secured by slot atomicity + rate limiting + honeypot.
//
// GET /.netlify/functions/booking?services=1  — return service list (public)
//
// POST body:
//   { slot_id, service, client_name, client_email, client_phone,
//     preferred_contact, source?, bot_field? }

const { respond }              = require('./lib/auth');
const { getClient }            = require('./lib/supabase');
const { sendWithPreferences }  = require('./lib/comms');
const { bookingFailure, emailFailure } = require('./lib/ops-alert');
const { SERVICES, findService } = require('./lib/services');
const { findSessionConflicts }  = require('./lib/session-overlap');
const { isWithinPublicHorizon } = require('./lib/scheduling-horizon');
const crypto                   = require('crypto');
const { appointmentManageUrl, createAppointmentToken } = require('./lib/appointment-token');

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

// Secure, URL-safe portal token (48 hex chars) — gives the client token-based
// access to their document hub without a dashboard login.
function newPortalToken() { return crypto.randomBytes(24).toString('hex'); }

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = (event.headers['x-forwarded-for'] || '').split(',')[0].trim();

  // ── GET ?services=1 — public service list ────────────────────────────────
  if (event.httpMethod === 'GET' && params.services) {
    return respond(200, { services: SERVICES });
  }

  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  // Honeypot — silent 200 for bots
  if (body.bot_field || body['bot-field']) return respond(200, { booked: true });

  const { slot_id, service, client_name, client_email, client_phone, preferred_contact } = body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!slot_id)       return respond(400, { error: 'Please select an available time slot.' });
  if (!service)       return respond(400, { error: 'Please select a service.' });
  if (!client_name?.trim())  return respond(400, { error: 'Your name is required.' });
  if (!client_email?.trim()) return respond(400, { error: 'Your email address is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) {
    return respond(400, { error: 'Please enter a valid email address.' });
  }
  const serviceInfo = findService(service);
  if (!serviceInfo || serviceInfo.price == null) {
    return respond(400, { error: 'Selected service price could not be verified. Please choose a service again.' });
  }

  // ── Rate limiting (5 bookings per IP per hour) ────────────────────────────
  try {
    const windowStart = new Date(Date.now() - 3600000).toISOString();
    const { count } = await sb
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'booking_submitted')
      .eq('ip_address', ip)
      .gte('created_at', windowStart);
    if (count >= 5) return respond(429, { error: 'Too many booking requests. Please try again later.' });
  } catch { /* non-fatal */ }

  // ── Step 1: Atomically claim the slot ─────────────────────────────────────
  const { data: slot, error: slotErr } = await sb
    .from('availability_slots')
    .update({ status: 'booked' })
    .eq('id', slot_id)
    .eq('status', 'available')   // prevents double booking
    .select('id, slot_date, slot_time, label')
    .single();

  if (slotErr || !slot) {
    return respond(409, { error: 'This time slot was just booked by someone else. Please select another time.' });
  }

  const sessionDate = slot.slot_date;
  const sessionTime = slot.slot_time ? slot.slot_time.slice(0, 5) : '';

  const today = new Date().toISOString().slice(0, 10);
  if (!isWithinPublicHorizon(sessionDate, today)) {
    await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('id', slot_id);
    return respond(400, { error: 'This time is outside the public booking horizon.' });
  }

  // The slot row prevents two public requests from claiming the same slot.
  // Sessions are independently authoritative for occupancy, including manual
  // and off-grid appointments that have no availability_slots row.
  const { data: occupiedSessions, error: occupancyError } = await sb
    .from('sessions')
    .select('id,session_date,session_time,duration_minutes,status')
    .eq('session_date', sessionDate);

  if (occupancyError || findSessionConflicts(occupiedSessions || [], {
    date: sessionDate,
    time: sessionTime,
    duration_minutes: serviceInfo.duration,
  }).length) {
    await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('id', slot_id);
    return respond(409, { error: 'This time is no longer available. Please select another time.' });
  }

  // ── Step 2: Upsert client record (match by email) ─────────────────────────
  let clientId = null;
  let portalToken = null;
  try {
    const emailNorm = client_email.toLowerCase().trim();
    const { data: existing } = await sb
      .from('clients')
      .select('id, email_consent, preferred_contact, portal_token')
      .eq('email', emailNorm)
      .single();

    if (existing) {
      clientId    = existing.id;
      portalToken = existing.portal_token || null;
      // Update phone / preferred_contact if newly provided
      const updates = {};
      if (client_phone) updates.phone = client_phone;
      if (preferred_contact) updates.preferred_contact = preferred_contact;
      // Issue a portal token if this client doesn't have one yet.
      if (!portalToken) {
        portalToken = newPortalToken();
        updates.portal_token = portalToken;
        updates.portal_token_issued = new Date().toISOString();
      }
      if (Object.keys(updates).length) {
        await sb.from('clients').update(updates).eq('id', clientId);
      }
    } else {
      portalToken = newPortalToken();
      const { data: newClient, error: clientErr } = await sb
        .from('clients')
        .insert({
          full_name:          client_name.trim(),
          email:              emailNorm,
          phone:              client_phone  || null,
          preferred_contact:  preferred_contact || 'email',
          email_consent:      true,
          source:             'booking',
          portal_token:        portalToken,
          portal_token_issued: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (clientErr) {
        await bookingFailure(sb, { step: 'client_upsert', error: clientErr });
      } else {
        clientId = newClient.id;
      }
    }
  } catch (e) {
    await bookingFailure(sb, { step: 'client_upsert', error: e });
    // Non-fatal — continue without clientId
  }

  // ── Step 3: Create session record ─────────────────────────────────────────
  let sessionId = null;
  try {
    const { data: session, error: sessionErr } = await sb
      .from('sessions')
      .insert({
        client_id:        clientId    || null,
        client_name:      client_name.trim(),
        service:          serviceInfo.label,
        session_date:     sessionDate,
        session_time:     sessionTime.length === 5 ? sessionTime + ':00' : sessionTime,
        duration_minutes: serviceInfo.duration,
        location_type:    'distance',
        status:           'pending',
        payment_status:   'pending',
        amount_due:       serviceInfo.price,
        amount_paid:      0,
        source:           body.source || 'online',
        intake_status:    'pending',
        waiver_status:    'pending',
        waiver_completed: false,
        booking_status:   'booking_received',
        // Public bookings are never eligible for sync before payment finalization.
        google_calendar_status: 'not_requested',
      })
      .select('id')
      .single();

    if (sessionErr) {
      await bookingFailure(sb, { step: 'session_create', clientId, error: sessionErr });
      // Release slot since session creation failed
      await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('id', slot_id);
      return respond(500, { error: 'Booking could not be completed. Please try again or contact us directly.' });
    }
    sessionId = session.id;
  } catch (e) {
    await bookingFailure(sb, { step: 'session_create', clientId, error: e });
    await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('id', slot_id);
    return respond(500, { error: 'Booking could not be completed. Please try again or contact us directly.' });
  }

  // ── Step 4: Link slot to session ──────────────────────────────────────────
  await sb.from('availability_slots').update({ session_id: sessionId }).eq('id', slot_id);

  // ── Step 5: Audit log ─────────────────────────────────────────────────────
  try {
    await sb.from('audit_logs').insert({
      action:     'booking_submitted',
      table_name: 'sessions',
      record_id:  sessionId,
      actor:      client_email.toLowerCase().trim(),
      ip_address: ip,
      new_data: {
        session_id:        sessionId,
        client_id:         clientId,
        service:           serviceInfo.label,
        session_date:      sessionDate,
        session_time:      sessionTime,
        slot_id,
        preferred_contact: preferred_contact || 'email',
        submitted_at:      new Date().toISOString(),
      },
    });
  } catch { /* non-fatal */ }


  // ── Step 6: Build client-facing URLs ──────────────────────────────────────
  const actionToken = createAppointmentToken(sessionId);
  const manageUrl = appointmentManageUrl(sessionId, { siteUrl: SITE_URL });
  const intakeUrl = `${SITE_URL}/full-intake.html?session_id=${sessionId}&name=${encodeURIComponent(client_name.trim())}&email=${encodeURIComponent(client_email.trim())}`;
  const waiverUrl = `${SITE_URL}/waiver-esign.html?session_id=${sessionId}&token=${encodeURIComponent(actionToken)}&name=${encodeURIComponent(client_name.trim())}&email=${encodeURIComponent(client_email.trim())}&phone=${encodeURIComponent(client_phone || '')}`;
  const cancelUrl = `${SITE_URL}/cancel-session.html?session_id=${sessionId}`;
  // ── Step 7: Transactional emails (fire-and-forget) ────────────────────────
  const emailVars = {
    client_name:  client_name.trim(),
    service:      serviceInfo.label,
    service_name: serviceInfo.label,
    session_date: sessionDate,
    session_time: sessionTime,
    timezone:     'EST',
    manage_url:   manageUrl,
    intake_url:   intakeUrl,
    waiver_url:   waiverUrl,
    cancel_url:   cancelUrl,
    session_reference: sessionId,
    documents_message: 'Please complete your required client documents before your appointment.',
    contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
  };

  // Receipt only: payment has not happened yet, so this must not imply that
  // the appointment is confirmed. Final confirmation comes from Stripe webhook.
  sendWithPreferences(sb, {
    templateName:   'booking_received_pending_payment',
    recipientEmail: client_email.trim(),
    clientId,
    sessionId,
    variables:      emailVars,
    metadata:       { trigger: 'online_booking_pending_payment', session_id: sessionId },
  }).catch(async e => {
    await emailFailure(sb, { templateName: 'booking_received_pending_payment', clientId, sessionId, error: e });
  });

  // Intake invitation
  sendWithPreferences(sb, {
    templateName:   'intake_invitation',
    recipientEmail: client_email.trim(),
    clientId,
    sessionId,
    variables:      { ...emailVars, intake_url: intakeUrl },
    metadata:       { trigger: 'booking_intake_invite', session_id: sessionId },
  }).catch(async e => {
    await emailFailure(sb, { templateName: 'intake_invitation', clientId, sessionId, error: e });
  });

  // Mark intake_sent_at on session
  sb.from('sessions').update({ intake_sent_at: new Date().toISOString() }).eq('id', sessionId).then(() => {}).catch(() => {});

  // ── Step 8: Return to client ──────────────────────────────────────────────
  return respond(200, {
    booked:      true,
    session_id:  sessionId,
    manage_url:  manageUrl,
    intake_url:  intakeUrl,
    waiver_url:  waiverUrl,
    cancel_url:  cancelUrl,
    slot: {
      date:  sessionDate,
      time:  sessionTime,
      label: slot.label,
    },
    service:    serviceInfo.label,
    amount_due: serviceInfo.price,
    payment_status: 'pending',
    waiver_status: 'pending',
  });
};
