'use strict';

const { getClient } = require('./lib/supabase');
const { respond } = require('./lib/auth');
const { observeWorker } = require('./lib/worker-health');

exports.config = { schedule: '*/15 * * * *' };

exports.handler = async event => {
  if (event?.httpMethod && event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  const sb = getClient();
  try {
    const result = await observeWorker(sb, 'website-booking-consistency', async () => {
      const { data, error } = await sb.rpc('website_booking_consistency_check');
      if (error) throw error;
      const findings = (data || []).map(row => ({ session_id: row.session_id, issue_codes: row.issue_codes }));
      if (findings.length) console.error('[website-booking-consistency] findings', JSON.stringify({ count: findings.length, findings }));
      return { scanned: data?.length || 0, processed: 0, failed: findings };
    });
    return respond(200, { read_only: true, findings: result.failed || [], count: (result.failed || []).length });
  } catch (error) {
    console.error('[website-booking-consistency]', error.message);
    return respond(500, { error: 'Website booking consistency check failed.' });
  }
};
