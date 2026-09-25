'use strict';
const { getClient } = require('./lib/supabase');
const { respond } = require('./lib/auth');
const { observeWorker } = require('./lib/worker-health');

// Compatibility schedule delegates to the same guarded, auditable RPC as the
// five-minute worker; it contains no independent eligibility or mutation path.
async function processExpired({ sb, now = () => new Date() } = {}) {
  if (!sb) throw new Error('Supabase client required');
  const { data, error } = await sb.rpc('expire_unpaid_booking_holds', { p_now: now().toISOString() });
  if (error) throw error;
  for (const action of data?.actions || []) {
    console.info('[expire-website-bookings] appointment mutation', JSON.stringify({ session_id: action.session_id, correlation_id: action.correlation_id, actor_type: 'system', source: 'expire-payment-holds', action: 'payment_hold_expired' }));
  }
  return { expired: Number(data?.expired_count || 0), released_slot_count: Number(data?.released_slot_count || 0), session_ids: data?.session_ids || [] };
}

exports.processExpired = processExpired;
exports.config = { schedule: '*/10 * * * *' };
exports.handler = async event => {
  if (event?.httpMethod && event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  try { return respond(200, await observeWorker(getClient(), 'website-booking-expiration', () => processExpired({ sb: getClient() }))); }
  catch (error) { console.error('[expire-website-bookings]', error.message); return respond(500, { error: 'Website booking expiration failed.' }); }
};
