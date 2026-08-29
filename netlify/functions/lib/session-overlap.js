'use strict';

const DEFAULT_DURATION_MINUTES = 60;

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeDuration(value, fallback = DEFAULT_DURATION_MINUTES) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function intervalsOverlap(firstStart, firstDuration, secondStart, secondDuration) {
  return firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration;
}

function isActiveSession(session) {
  return !['cancelled', 'no_show'].includes(String(session?.status || '').toLowerCase());
}

function sessionOverlapsInterval(session, interval) {
  if (!isActiveSession(session) || session.session_date !== interval.date) return false;
  const sessionStart = timeToMinutes(session.session_time);
  const intervalStart = timeToMinutes(interval.time);
  if (sessionStart == null || intervalStart == null) return false;
  return intervalsOverlap(
    sessionStart,
    normalizeDuration(session.duration_minutes),
    intervalStart,
    normalizeDuration(interval.duration_minutes)
  );
}

function findSessionConflicts(sessions, interval) {
  return (sessions || []).filter(session => sessionOverlapsInterval(session, interval));
}

function filterSlotsAgainstSessions(slots, sessions, slotDurationMinutes = DEFAULT_DURATION_MINUTES) {
  return (slots || []).filter(slot => {
    if (slot.status !== 'available') return true;
    return findSessionConflicts(sessions, {
      date: slot.slot_date,
      time: slot.slot_time,
      duration_minutes: slotDurationMinutes,
    }).length === 0;
  });
}

module.exports = {
  DEFAULT_DURATION_MINUTES,
  timeToMinutes,
  normalizeDuration,
  intervalsOverlap,
  isActiveSession,
  sessionOverlapsInterval,
  findSessionConflicts,
  filterSlotsAgainstSessions,
};
