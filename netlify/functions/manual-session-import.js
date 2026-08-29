'use strict';

// Authenticated, silent, one-record-at-a-time historical session import.
// This function intentionally has no communications, Stripe, payment, refund,
// booking-workflow, or availability_slots dependencies.

const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { log } = require('./lib/audit');
const {
  DEFAULT_DURATION_MINUTES,
  findSessionConflicts,
  normalizeDuration,
  timeToMinutes,
} = require('./lib/session-overlap');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTABLE_STATUSES = new Set(['pending', 'ready', 'confirmed', 'completed']);

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  const clientName = String(body.client_name || '').trim().replace(/\s+/g, ' ');
  const sessionDate = String(body.session_date || '');
  const rawTime = String(body.session_time || '');
  const startMinutes = timeToMinutes(rawTime);
  if (!clientName) return respond(400, { error: 'client_name is required.' });
  if (!validDate(sessionDate)) return respond(400, { error: 'session_date must be a valid YYYY-MM-DD date.' });
  if (startMinutes == null) return respond(400, { error: 'session_time must be a valid 24-hour time.' });
  if (body.explicitly_paid !== true && body.explicitly_paid !== false) {
    return respond(400, { error: 'explicitly_paid must be true or false.' });
  }

  const durationMinutes = normalizeDuration(body.duration_minutes, DEFAULT_DURATION_MINUTES);
  const amountDue = body.amount_due == null || body.amount_due === '' ? null : Number(body.amount_due);
  if (amountDue != null && (!Number.isFinite(amountDue) || amountDue < 0)) {
    return respond(400, { error: 'amount_due must be a non-negative number or null.' });
  }
  const status = String(body.status || 'confirmed').toLowerCase();
  if (!IMPORTABLE_STATUSES.has(status)) return respond(400, { error: 'Unsupported session status.' });

  const sb = getClient();
  let clientId = null;
  if (body.client_id) {
    const { data: client, error: clientError } = await sb
      .from('clients').select('id').eq('id', body.client_id).single();
    if (clientError || !client) return respond(400, { error: 'The explicit client_id was not found.' });
    clientId = client.id;
  }

  // Conservative matching: only an explicitly supplied client_id is linked.
  // Similar handwritten names are never guessed or merged automatically.
  const { data: existing, error: existingError } = await sb
    .from('sessions')
    .select('id,client_name,session_date,session_time,duration_minutes,status')
    .eq('session_date', sessionDate);
  if (existingError) return respond(500, { error: 'Could not validate session occupancy.' });

  const normalizedTime = `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}:00`;
  const exactDuplicate = (existing || []).find(session => (
    !['cancelled', 'no_show'].includes(String(session.status || '').toLowerCase()) &&
    normalizeName(session.client_name) === normalizeName(clientName) &&
    timeToMinutes(session.session_time) === startMinutes
  ));
  if (exactDuplicate) {
    return respond(200, {
      created: false,
      duplicate: true,
      session: { id: exactDuplicate.id, session_date: sessionDate, session_time: normalizedTime },
    });
  }

  const conflicts = findSessionConflicts(existing || [], {
    date: sessionDate,
    time: normalizedTime,
    duration_minutes: durationMinutes,
  });
  if (conflicts.length) {
    return respond(409, {
      created: false,
      error: 'The proposed session overlaps an existing session.',
      conflicting_session_ids: conflicts.map(session => session.id),
    });
  }

  const row = {
    client_id: clientId,
    client_name: clientName,
    service: String(body.service || 'Historical manual appointment').trim(),
    session_date: sessionDate,
    session_time: normalizedTime,
    duration_minutes: durationMinutes,
    location_type: String(body.location_type || 'distance'),
    status,
    payment_status: body.explicitly_paid ? 'paid' : 'unpaid',
    amount_due: amountDue,
    amount_paid: body.explicitly_paid && amountDue != null ? amountDue : 0,
    source: 'historical_manual_import',
    seller_notes: body.notes ? String(body.notes).trim() : null,
  };

  // One database insert is the operation boundary. A failure creates nothing;
  // a success always returns the exact created session id for reconciliation.
  const { data: session, error: insertError } = await sb
    .from('sessions')
    .insert(row)
    .select('id,session_date,session_time,duration_minutes,payment_status')
    .single();
  if (insertError || !session) return respond(500, { created: false, error: 'Session import failed.' });

  await log({
    actor: auth.user.email,
    action: 'historical_session_imported',
    tableName: 'sessions',
    recordId: session.id,
    newData: { session_date: sessionDate, session_time: normalizedTime, source: row.source },
    context: 'Silent administrative historical session import',
    ip: event.headers['x-forwarded-for'] || '',
  });

  return respond(201, { created: true, duplicate: false, session });
};

exports._test = { normalizeName, validDate };
