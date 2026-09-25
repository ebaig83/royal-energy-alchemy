'use strict';

const { getClient } = require('./lib/supabase');

exports.handler = async function () {
  const sb = getClient();
  const { data, error } = await sb.rpc('expire_unpaid_booking_holds', { p_now: new Date().toISOString() });
  if (error) {
    console.error('[expire-payment-holds] Worker failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ expired: false }) };
  }
  for (const action of data?.actions || []) {
    console.info('[expire-payment-holds] appointment mutation', JSON.stringify({ session_id: action.session_id, correlation_id: action.correlation_id, actor_type: 'system', source: 'expire-payment-holds', action: 'payment_hold_expired' }));
  }
  return { statusCode: 200, body: JSON.stringify({ expired: true, count: Number(data?.expired_count || 0) }) };
};
