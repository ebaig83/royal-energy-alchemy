'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { log } = require('./lib/audit');
const { findSessionConflicts, normalizeDuration, timeToMinutes } = require('./lib/session-overlap');
const { findService } = require('./lib/services');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = new Set(['pending', 'ready', 'confirmed', 'completed']);

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function sameName(a, b) { return String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function normalizeEmail(value) { const email=String(value||'').trim().toLowerCase(); return email || null; }
function normalizePhone(value) { const raw=String(value||'').trim(); if(!raw)return null; const digits=(raw.match(/\d/g)||[]).join(''); if(digits.length<7||digits.length>15)return null; return raw.startsWith('+')?`+${digits}`:digits; }
function validEmail(value) { return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
const PAYMENT_STATUSES = new Set(['unpaid', 'pending', 'partial', 'paid', 'complimentary']);
const PAYMENT_METHODS = new Set(['none', 'cash', 'venmo', 'zelle', 'stripe', 'other']);
const REQUEST_PAYMENT_METHODS = new Set(['stripe', 'venmo', 'cash_app', 'paypal', 'zelle', 'other']);
const SENSITIVE_PAYMENT_NOTE = /(?:cvv|cvc|credit\s*card|debit\s*card|card\s*number|bank\s*account|routing\s*number|account\s*number|\bpin\b|\b\d{13,19}\b)/i;
function normalizeMoney(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}
function paymentMetadata(body, canonicalDue) {
  const requested = String(body.payment_status || 'unpaid').trim().toLowerCase();
  const status = requested === 'not_requested' ? 'unpaid' : requested === 'payment_requested' ? 'pending' : requested;
  const amountPaid = normalizeMoney(body.amount_paid, 0);
  const method = String(body.payment_method || 'none').trim().toLowerCase();
  const reference = String(body.payment_reference || '').trim();
  const note = String(body.payment_note || '').trim();
  if (!PAYMENT_STATUSES.has(status)) return { error: 'Payment status is invalid.' };
  if (amountPaid === null || amountPaid < 0 || amountPaid > 100000 || amountPaid > canonicalDue) return { error: 'Amount paid must be a valid non-negative amount no greater than the canonical amount due.' };
  if (!PAYMENT_METHODS.has(method)) return { error: 'Payment method is invalid.' };
  if (reference.length > 120 || note.length > 500) return { error: 'Payment reference or note is too long.' };
  if (SENSITIVE_PAYMENT_NOTE.test(`${reference} ${note}`)) return { error: 'Payment notes may not contain card, bank, PIN, or CVV information.' };
  if (status === 'paid' && amountPaid !== canonicalDue) return { error: 'Paid status requires amount paid to equal the canonical amount due.' };
  if (status === 'partial' && (amountPaid <= 0 || amountPaid >= canonicalDue)) return { error: 'Partial payment must be greater than zero and less than the canonical amount due.' };
  if (status === 'complimentary' && amountPaid !== 0) return { error: 'Complimentary appointments must have amount paid set to zero.' };
  if (['paid', 'partial'].includes(status) && method === 'none') return { error: 'A payment method is required for a manual paid or partial payment.' };
  if (['paid', 'partial'].includes(status) && method === 'stripe') return { error: 'Stripe payment state must come from the Stripe webhook.' };
  if (body.request_payment === true && !['unpaid', 'pending'].includes(status)) return { error: 'Payment requests cannot be combined with a manual payment status.' };
  return { status, amountPaid, method: status === 'unpaid' || status === 'pending' ? (method === 'none' ? null : method) : method, reference: reference || null, note: note || null, source: status === 'complimentary' ? 'complimentary' : ['paid', 'partial'].includes(status) ? 'manual_off_platform' : 'none' };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  const clientName = String(body.client_name || '').trim().replace(/\s+/g, ' ');
  const date = String(body.session_date || '');
  const time = String(body.session_time || '').slice(0, 5);
  const duration = normalizeDuration(body.duration_minutes, 60);
  const serviceInfo = findService(body.service);
  const email = normalizeEmail(body.client_email);
  const phone = normalizePhone(body.client_phone);
  if (!clientName) return respond(400, { error: 'client_name is required.' });
  if (!serviceInfo) return respond(400, { error: 'A valid service is required.' });
  const payment = paymentMetadata(body, serviceInfo.price);
  if (!validDate(date)) return respond(400, { error: 'session_date must be a valid YYYY-MM-DD date.' });
  if (timeToMinutes(time) == null) return respond(400, { error: 'session_time must be a valid 24-hour time.' });
  if (!validEmail(email)) return respond(400, { error: 'Client email must be a valid email address.' });
  if (payment.error) return respond(400, { error: payment.error });
  if (body.client_phone && !phone) return respond(400, { error: 'Client telephone must be a valid phone number.' });
  if (body.send_waiver === true && !email) return respond(400, { error: 'Client email is required to send the waiver.' });
  if (body.request_payment === true && !email) return respond(400, { error: 'Client email is required to send the waiver or payment request.' });
  if (body.request_payment === true && !REQUEST_PAYMENT_METHODS.has(String(body.request_payment_method || 'stripe').trim().toLowerCase())) return respond(400, { error: 'Payment request method is invalid.' });
  if (!body.slot_id) return respond(400, { error: 'An available slot is required.' });
  const sb = getClient();
  const { data: existing, error: existingError } = await sb.from('sessions').select('id,client_id,client_name,session_date,session_time,duration_minutes,status').eq('session_date', date);
  if (existingError) return respond(500, { error: 'Could not validate appointment conflicts.' });
  const duplicate = (existing || []).find(s => ACTIVE.has(String(s.status || '').toLowerCase()) && sameName(s.client_name, clientName) && timeToMinutes(s.session_time) === timeToMinutes(time));
  if (duplicate) return respond(200, { created: false, duplicate: true, session: { id: duplicate.id, session_date: duplicate.session_date, session_time: duplicate.session_time } });
  const conflicts = findSessionConflicts(existing || [], { date, time: `${time}:00`, duration_minutes: duration });
  if (conflicts.length) return respond(409, { error: 'The proposed appointment overlaps an existing session.', conflicting_session_ids: conflicts.map(s => s.id) });
  if (body.client_id) { const { data: client } = await sb.from('clients').select('id').eq('id', body.client_id).single(); if (!client) return respond(400, { error: 'The selected client was not found.' }); }
  const { data: slot, error: slotError } = await sb.from('availability_slots').select('id,status,session_id,slot_date,slot_time').eq('id', body.slot_id).single();
  if (slotError || !slot || slot.status !== 'available' || slot.session_id || slot.slot_date !== date || String(slot.slot_time || '').slice(0, 5) !== time) return respond(409, { error: 'That availability slot is no longer available.' });
  const wantsMeet = body.create_google_meet === true;
  const row = { client_id: body.client_id || null, client_name: clientName, client_email: email, client_phone: phone, service: serviceInfo.id, session_date: date, session_time: `${time}:00`, duration_minutes: duration, amount_due: serviceInfo.price, amount_paid: payment.amountPaid, payment_status: payment.status, payment_method: payment.method, payment_reference: payment.reference, payment_note: payment.note, payment_source: payment.source, location_type: 'distance', status: 'pending', source: wantsMeet ? 'manual_practitioner_calendar' : 'manual_practitioner', google_calendar_status: wantsMeet ? 'pending' : 'not_requested', seller_notes: null };
  const { data: session, error: insertError } = await sb.from('sessions').insert(row).select('id,session_date,session_time,client_name,source,google_calendar_status').single();
  if (insertError || !session) return respond(500, { error: 'Appointment creation failed.' });
  const { data: reserved, error: reserveError } = await sb.from('availability_slots').update({ status: 'booked', session_id: session.id }).eq('id', slot.id).eq('status', 'available').is('session_id', null).select('id').maybeSingle();
  if (reserveError || !reserved) { await sb.from('sessions').delete().eq('id', session.id); return respond(409, { error: 'That availability slot was claimed by another appointment.' }); }
  await log({ actor: auth.user.email, action: 'practitioner_session_created', tableName: 'sessions', recordId: session.id, newData: { session_date: date, session_time: `${time}:00`, source: row.source, google_calendar_status: row.google_calendar_status }, context: 'Practitioner appointment creation; communications and Calendar suppressed', ip: event.headers['x-forwarded-for'] || '' });
  return respond(201, { created: true, duplicate: false, session });
};

exports._test = { validDate, sameName, normalizeEmail, normalizePhone, validEmail, paymentMetadata, REQUEST_PAYMENT_METHODS };
