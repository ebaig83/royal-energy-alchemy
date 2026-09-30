'use strict';

const { getClient } = require('./lib/supabase');
const { observeWorker } = require('./lib/worker-health');
const { retryFailedMeetingReady } = require('./session-calendar-sync');

// Retry-only worker. It never calls Google Calendar; it only reclaims failed
// meeting-ready notification reservations whose rendering failed with the
// known invalid-management-URL error.
exports.config = { schedule: '*/5 * * * *' };
exports.handler = async () => {
  try {
    const sb = getClient();
    const result = await observeWorker(sb, 'communications', () => retryFailedMeetingReady({ sb }));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[meeting-ready-retry]', String(error?.message || 'unknown error').replace(/(token|secret|key|password)=?\S*/gi, '$1=[redacted]'));
    return { statusCode: 500, body: JSON.stringify({ error: 'Meeting-ready retry job failed.' }) };
  }
};
