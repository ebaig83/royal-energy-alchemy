'use strict';

const NORMAL_HOURS = 8;
const REMEMBERED_DAYS = 30;
const REMEMBERED_IDLE_DAYS = 7;

function isRemembered(value) { return value === true; }
function cookieMaxAge(remembered) { return (remembered ? REMEMBERED_DAYS * 24 : NORMAL_HOURS) * 3600; }
function idleExpired(row, now = Date.now()) {
  if (!isRemembered(row?.remembered)) return false;
  const seen = Date.parse(row.last_seen_at || row.created_at || '');
  return !Number.isFinite(seen) || now - seen > REMEMBERED_IDLE_DAYS * 86400000;
}

module.exports = { NORMAL_HOURS, REMEMBERED_DAYS, REMEMBERED_IDLE_DAYS, isRemembered, cookieMaxAge, idleExpired };
