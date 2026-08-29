'use strict';

const SITE_URL = process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';
const SUPPRESSED = new Set(['cancelled', 'no_show']);

function sessionStart(session) {
  if (!session?.session_date || !session?.session_time) return null;
  const value = `${session.session_date}T${String(session.session_time).slice(0, 8)}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sessionDuration(session) {
  const n = Number(session?.duration_minutes);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function isActiveSession(session) {
  return !!session && !SUPPRESSED.has(String(session.status || '').toLowerCase());
}

function isDue(start, now, minutes, toleranceMinutes = 5) {
  if (!start) return false;
  const delta = (start.getTime() - now.getTime()) / 60000;
  return delta >= minutes - toleranceMinutes && delta <= minutes + toleranceMinutes;
}

function followupDue(session, now, toleranceMinutes = 10) {
  const start = sessionStart(session);
  if (!start) return false;
  const completion = new Date(start.getTime() + sessionDuration(session) * 60000);
  const delta = (now.getTime() - completion.getTime()) / 60000;
  return delta >= 72 * 60 - toleranceMinutes && delta <= 72 * 60 + toleranceMinutes;
}

function followupUrl(aftercareId, template = 'C') {
  return `${SITE_URL}/aftercare.html?aid=${encodeURIComponent(aftercareId)}&tmpl=${encodeURIComponent(template)}&t=72hr`;
}

module.exports = { SUPPRESSED, sessionStart, sessionDuration, isActiveSession, isDue, followupDue, followupUrl };
