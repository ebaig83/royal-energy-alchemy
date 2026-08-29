'use strict';

const PUBLIC_HORIZON_MONTHS = 6;
const STANDARD_SLOT_TIMES = ['10:00', '12:00', '14:00', '16:00', '18:00'];
const OFFERED_WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Monday-Friday

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseDateKey(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addCalendarMonthsClamped(value, months) {
  const source = value instanceof Date ? new Date(value.getTime()) : parseDateKey(value);
  if (!source) return null;
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function publicHorizonDate(todayKey) {
  return dateKey(addCalendarMonthsClamped(todayKey, PUBLIC_HORIZON_MONTHS));
}

function isWithinPublicHorizon(date, today) {
  const horizon = publicHorizonDate(today);
  return Boolean(date && today && date >= today && date <= horizon);
}

function generationStartDate(today, latestSlotDate) {
  if (!latestSlotDate || latestSlotDate < today) return today;
  return dateKey(addDays(latestSlotDate, 1));
}

function buildStandardSlotRows(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || start > end) return [];
  const rows = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (!OFFERED_WEEKDAYS.has(cursor.getUTCDay())) continue;
    const slotDate = dateKey(cursor);
    const weekday = cursor.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const month = cursor.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const day = cursor.getUTCDate();
    for (const time of STANDARD_SLOT_TIMES) {
      const [hours, minutes] = time.split(':').map(Number);
      const displayHour = hours % 12 || 12;
      const displayTime = `${displayHour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
      rows.push({
        slot_date: slotDate,
        slot_time: `${time}:00`,
        status: 'available',
        label: `${weekday}, ${month} ${day} at ${displayTime}`,
        display_time: displayTime,
      });
    }
  }
  return rows;
}

async function ensureRollingAvailability(sb, today, horizon) {
  const { data: latest, error: latestError } = await sb.from('availability_slots')
    .select('slot_date').gte('slot_date', today)
    .order('slot_date', { ascending: false }).limit(1);
  if (latestError) return { generated: 0, error: latestError };
  const start = generationStartDate(today, latest?.[0]?.slot_date);
  const rows = buildStandardSlotRows(start, horizon);
  if (!rows.length) return { generated: 0, start, horizon };
  const { error } = await sb.from('availability_slots')
    .upsert(rows, { onConflict: 'slot_date,slot_time', ignoreDuplicates: true });
  return error ? { generated: 0, start, horizon, error } : { generated: rows.length, start, horizon };
}

module.exports = {
  PUBLIC_HORIZON_MONTHS,
  STANDARD_SLOT_TIMES,
  OFFERED_WEEKDAYS,
  parseDateKey,
  dateKey,
  addDays,
  addCalendarMonthsClamped,
  publicHorizonDate,
  isWithinPublicHorizon,
  generationStartDate,
  buildStandardSlotRows,
  ensureRollingAvailability,
};
