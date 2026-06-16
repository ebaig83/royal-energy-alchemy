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

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

const SERVICES = [
  { id: 'energy-clearing',     label: 'Energy Clearing',            duration: 60 },
  { id: 'cord-cutting',        label: 'Cord Cutting',               duration: 60 },
  { id: 'ancestral-healing',   label: 'Ancestral Healing',          duration: 90 },
  { id: 'parasite-removal',    label: 'Energetic Parasite Removal', duration: 90 },
  { id: 'spiritual-protection',label: 'Spiritual Protection',       duration: 60 },
  { id: 'full-assessment',     label: 'Full Assessment',            duration: 120 },
  { id: 'soul-retrieval',      label: 'Soul Retrieval',             duration: 90 },
  { id: 'remote-session',      label: 'Remote Distance Session',    duration: 60 },
];

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
  const serviceInfo = SERVICES.find(s => s.id === service) || { label: service, duration: 60 };

  // ── Step 2: Upsert client record (match by email) ─────────────────────────
  let clientId = null;
  try {
    const emailNorm = client_email.toLowerCase().trim();
    const { data: existing } = await sb
      .from('clients')
      .select('id, email_consent, preferred_contact')
      .eq('email', emailNorm)
      .single();

    if (existing) {
      clientId = existing.id;
      // Update phone / preferred_contact if newly provided
      const updates = {};
      if (client_phone) updates.phone = client_phone;
      if (preferred_contact) updates.preferred_contact = preferred_contact;
      if (Object.keys(updates).length) {
        await sb.from('clients').update(updates).eq('id', clientId);
      }
    } else {
      const { data: newClient, error: clientErr } = await sb
        .from('clients')
        .insert({
          name:              client_name.trim(),
          email:             emailNorm,
          phone:             client_phone  || null,
          preferred_contact: preferred_contact || 'email',
          email_consent:     true,
          source:            'booking',
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
        payment_status:   'unpaid',
        source:           body.source  || 'online',
        intake_status:    'pending',
        waiver_status:    'pending',
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
  const manageUrl = `${SITE_URL}/manage-appointment.html?session_id=${sessionId}`;
  const intakeUrl = `${SITE_URL}/full-intake.html?session_id=${sessionId}&name=${encodeURIComponent(client_name.trim())}&email=${encodeURIComponent(client_email.trim())}`;
  // Waiver URL — placeholder until waiver.html exists
  const waiverUrl = `${SITE_URL}/waiver.html?session_id=${sessionId}&email=${encodeURIComponent(client_email.trim())}`;

  // ── Step 7: Transactional emails (fire-and-forget) ────────────────────────
  const emailVars = {
    client_name:  client_name.trim(),
    service:      serviceInfo.label,
    session_date: sessionDate,
    session_time: sessionTime,
    timezone:     'ET',
    manage_url:   manageUrl,
    intake_url:   intakeUrl,
    contact_email: process.env.ADMIN_EMAIL || 'royalenergyalchemy@gmail.com',
  };

  // Booking confirmation
  sendWithPreferences(sb, {
    templateName:   'appointment_confirmation',
    recipientEmail: client_email.trim(),
    clientId,
    sessionId,
    variables:      emailVars,
    metadata:       { trigger: 'online_booking', session_id: sessionId },
  }).catch(async e => {
    await emailFailure(sb, { templateName: 'appointment_confirmation', clientId, sessionId, error: e });
  });

  // Intake invitation
  sendWithPreferences(sb, {
    templateName:   'intake_received',
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
    slot: {
      date:  sessionDate,
      time:  sessionTime,
      label: slot.label,
    },
    service: serviceInfo.label,
  });
};
