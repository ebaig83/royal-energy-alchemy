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

function normalizeEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  return email || null;
}
function normalizePhone(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const digits = (raw.match(/\d/g) || []).join('');
  if (digits.length < 7 || digits.length > 15 || !/^[+()\-\.\s\dextEXT#x]+$/.test(raw)) return null;
  return raw.startsWith('+') ? `+${digits}` : digits;
}
function isBlockedClient(client, email, phone) {
  return normalizeEmail(client?.email) === email || normalizePhone(client?.phone) === phone;
}
function validateServiceAddress(value, locationType) {
  if (!['in_person', 'in-person'].includes(String(locationType || '').toLowerCase())) return { address: null };
  const address = {
    line1: String(value?.line1 || '').trim(),
    line2: String(value?.line2 || '').trim(),
    city: String(value?.city || '').trim(),
    state: String(value?.state || '').trim(),
    postal_code: String(value?.postal_code || '').trim(),
    country: String(value?.country || '').trim(),
  };
  if (Object.values(address).some(part => !part) || Object.values(address).some(part => /^(?:n\/?a|none|unknown|test|address)$/i.test(part))) return { error: 'Complete the street address, city, state/province, ZIP/postal code, and country for this in-person service.' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s.'#,/\-]{1,199}$/u.test(address.line1) || !/^[\p{L}\p{N}][\p{L}\p{N}\s.'\-]{1,99}$/u.test(address.city) || !/^[\p{L}\p{N}][\p{L}\p{N}\s.'\-]{1,99}$/u.test(address.state) || !/^[\p{L}\p{N}][\p{L}\p{N}\s\-]{1,19}$/u.test(address.postal_code) || !/^[\p{L}][\p{L}\s.'\-]{1,99}$/u.test(address.country)) return { error: 'Check the in-person service address fields and try again.' };
  return { address };
}
function validatePublicBookingFields(body) {
  const fullName = String(body?.client_name == null ? '' : body.client_name).trim();
  const firstName = String(body?.client_first_name == null ? '' : body.client_first_name).trim();
  const lastName = String(body?.client_last_name == null ? '' : body.client_last_name).trim();
  const splitName = fullName.split(/\s+/).filter(Boolean);
  const first = firstName || splitName[0] || '';
  const last = lastName || (splitName.length > 1 ? splitName.slice(1).join(' ') : '');
  const name = [first, last].filter(Boolean).join(' ').trim();
  const email = normalizeEmail(body?.client_email);
  const phoneProvided = Object.prototype.hasOwnProperty.call(body || {}, 'client_phone');
  const phone = normalizePhone(body?.client_phone);
  if (!first) return { error: 'Your first name is required.' };
  if (!last) return { error: 'Your last name is required.' };
  if (/^(?:test|unknown|not provided|n\/?a|none|your name|first name)$/i.test(first) || /^(?:test|unknown|not provided|n\/?a|none|last name)$/i.test(last) || /^(?:john doe|jane doe|test user|test client|unknown unknown|first last)$/i.test(`${first} ${last}`)) return { error: 'Please enter your real first and last name.' };
  if (!email) return { error: 'Your email address is required.' };
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email) || /(?:example\.(?:com|org|net)|test\.com|invalid)$/i.test(email)) return { error: 'Please enter a valid email address.' };
  if (!phoneProvided || !phone) return { error: 'Your telephone number is required.' };
  const phoneDigits = (phone.match(/\d/g) || []).join('');
  if (/^(\d)\1+$/.test(phoneDigits) || /^1234567\d*$/.test(phoneDigits)) return { error: 'Please enter a valid telephone number.' };
  return { name, email, phone };
}

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

  const { slot_id, service, client_email, client_phone, preferred_contact } = body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!slot_id)       return respond(400, { error: 'Please select an available time slot.' });
  if (!service)       return respond(400, { error: 'Please select a service.' });
  const fields = validatePublicBookingFields(body);
  if (fields.error) return respond(400, { error: fields.error });
  const normalizedName = fields.name;
  const normalizedEmail = fields.email;
  const normalizedPhone = fields.phone;
  const serviceValue = String(service || '').trim();
  const serviceInfo = findService(serviceValue);
  if (!serviceInfo || serviceInfo.price == null || ![serviceInfo.id, serviceInfo.label, ...(serviceInfo.aliases || [])].some(value => String(value).trim().toLowerCase() === serviceValue.toLowerCase())) {
    return respond(400, { error: 'Selected service price could not be verified. Please choose a service again.' });
  }
  const addressResult = validateServiceAddress(body.service_address, serviceInfo.locationType || 'distance');
  if (addressResult.error) return respond(400, { error: addressResult.error });

  // Enforce rebooking blocks before claiming a slot or creating any booking/payment state.
  const { data: blockedClients, error: blockLookupError } = await sb
    .from('clients')
    .select('id,email,phone')
    .eq('booking_blocked', true)
    .is('merged_into_client_id', null);
  if (blockLookupError) return respond(503, { error: 'We’re unable to complete this booking online. Please contact Royal Energy Alchemy for assistance.' });
  const matched = (blockedClients || []).find(client => isBlockedClient(client, normalizedEmail, normalizedPhone));
  if (matched) {
    await sb.from('audit_logs').insert({
      action: 'booking_blocked_attempt',
      table_name: 'clients',
      record_id: matched.id,
      actor: 'public_booking',
      ip_address: ip,
      new_data: { matched_by: normalizeEmail(matched.email) === normalizedEmail ? 'email' : 'phone' },
    });
    return respond(409, { error: 'We’re unable to complete this booking online. Please contact Royal Energy Alchemy for assistance.' });
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
    const emailNorm = normalizedEmail;
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
      if (normalizedPhone) updates.phone = normalizedPhone;
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
          full_name:          normalizedName,
          email:              emailNorm,
          phone:              normalizedPhone,
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

  // ── Step 3: Create session, private address, slot link, and audit atomically ──
  const correlationId = crypto.randomUUID();
  const sessionInput = {
        client_id:        clientId    || null,
        client_name:      normalizedName,
        service:          serviceInfo.label,
        session_date:     sessionDate,
        session_time:     sessionTime.length === 5 ? sessionTime + ':00' : sessionTime,
        duration_minutes: serviceInfo.duration,
        location_type:    serviceInfo.locationType || 'distance',
        status:           'pending',
        payment_status:   'pending',
        payment_hold_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        amount_due:       serviceInfo.price,
        amount_paid:      0,
        client_email:     normalizedEmail,
        client_phone:     normalizedPhone,
        source:           'online',
        intake_status:    'pending',
        waiver_status:    'pending',
        waiver_completed: false,
        booking_status:   'payment_required',
        // Public bookings are never eligible for sync before payment finalization.
        google_calendar_status: 'not_requested',
      };
  let sessionId = null;
  try {
    const { data: created, error: createError } = await sb.rpc('create_website_booking_with_audit', {
      p_session: sessionInput, p_slot_id: slot_id, p_address: addressResult.address, p_correlation_id: correlationId,
    });
    if (createError || !created?.session?.id) throw createError || new Error('Booking transaction returned no session.');
    sessionId = created.session.id;
    console.info('[booking] appointment mutation', JSON.stringify({ session_id: sessionId, correlation_id: correlationId, actor_type: 'system', source: 'website_booking', action: 'booking_created' }));
  } catch (error) {
    // A transaction may have committed even if the response was lost. Only
    // release an unlinked claimed slot; never unlink a committed booking.
    await sb.from('availability_slots').update({ status: 'available', session_id: null }).eq('id', slot_id).eq('status', 'booked').is('session_id', null);
    await bookingFailure(sb, { step: 'session_create', clientId, error });
    return respond(500, { error: 'Booking could not be completed. Please try again or contact us directly.' });
  }

  // ── Step 5: Audit log ─────────────────────────────────────────────────────
  try {
    await sb.from('audit_logs').insert({
      action:     'booking_submitted',
      table_name: 'sessions',
      record_id:  sessionId,
      actor:      normalizedEmail,
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
  const intakeUrl = `${SITE_URL}/full-intake.html?session_id=${sessionId}&name=${encodeURIComponent(normalizedName)}&email=${encodeURIComponent(normalizedEmail)}`;
  const waiverUrl = `${SITE_URL}/waiver-esign.html?session_id=${sessionId}&token=${encodeURIComponent(actionToken)}&name=${encodeURIComponent(normalizedName)}&email=${encodeURIComponent(normalizedEmail)}&phone=${encodeURIComponent(normalizedPhone)}`;
  const cancelUrl = `${SITE_URL}/cancel-session.html?session_id=${sessionId}`;
  // ── Step 7: Transactional emails (fire-and-forget) ────────────────────────
  const emailVars = {
    client_name:  normalizedName,
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
    recipientEmail: normalizedEmail,
    clientId,
    sessionId,
    variables:      emailVars,
    metadata:       { trigger: 'online_booking_pending_payment', session_id: sessionId, correlation_id: correlationId },
    idempotencyKey: `pending-payment:${sessionId}`,
  }).catch(async e => {
    await emailFailure(sb, { templateName: 'booking_received_pending_payment', clientId, sessionId, error: e });
  });

  // Intake invitation
  sendWithPreferences(sb, {
    templateName:   'intake_invitation',
    recipientEmail: normalizedEmail,
    clientId,
    sessionId,
    variables:      { ...emailVars, intake_url: intakeUrl },
    metadata:       { trigger: 'booking_intake_invite', session_id: sessionId, correlation_id: correlationId },
    idempotencyKey: `booking-intake-invitation:${sessionId}`,
  }).catch(async e => {
    await emailFailure(sb, { templateName: 'intake_invitation', clientId, sessionId, error: e });
  });

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
    appointment_status: 'pending',
    payment_status: 'pending',
    waiver_status: 'pending',
  });
};

exports._test = { normalizeEmail, normalizePhone, validatePublicBookingFields, validateServiceAddress, isBlockedClient };
