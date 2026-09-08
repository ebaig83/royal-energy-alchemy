'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { log } = require('./lib/audit');
const { findSessionConflicts, normalizeDuration, timeToMinutes } = require('./lib/session-overlap');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = new Set(['pending', 'ready', 'confirmed', 'completed']);

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function sameName(a, b) { return String(a || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

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
  if (!clientName) return respond(400, { error: 'client_name is required.' });
  if (!validDate(date)) return respond(400, { error: 'session_date must be a valid YYYY-MM-DD date.' });
  if (timeToMinutes(time) == null) return respond(400, { error: 'session_time must be a valid 24-hour time.' });
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
  const row = { client_id: body.client_id || null, client_name: clientName, service: String(body.service || '').trim() || 'Practitioner appointment', session_date: date, session_time: `${time}:00`, duration_minutes: duration, location_type: 'distance', status: 'pending', payment_status: 'unpaid', source: 'manual_practitioner', google_calendar_status: 'not_requested', seller_notes: null };
  const { data: session, error: insertError } = await sb.from('sessions').insert(row).select('id,session_date,session_time,client_name,source,google_calendar_status').single();
  if (insertError || !session) return respond(500, { error: 'Appointment creation failed.' });
  const { data: reserved, error: reserveError } = await sb.from('availability_slots').update({ status: 'booked', session_id: session.id }).eq('id', slot.id).eq('status', 'available').is('session_id', null).select('id').maybeSingle();
  if (reserveError || !reserved) { await sb.from('sessions').delete().eq('id', session.id); return respond(409, { error: 'That availability slot was claimed by another appointment.' }); }
  await log({ actor: auth.user.email, action: 'practitioner_session_created', tableName: 'sessions', recordId: session.id, newData: { session_date: date, session_time: `${time}:00`, source: row.source, google_calendar_status: row.google_calendar_status }, context: 'Practitioner appointment creation; communications and Calendar suppressed', ip: event.headers['x-forwarded-for'] || '' });
  return respond(201, { created: true, duplicate: false, session });
};

exports._test = { validDate, sameName };
