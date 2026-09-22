'use strict';

const { getClient } = require('./lib/supabase');

exports.handler = async function () {
  const sb = getClient();
  const { data, error } = await sb.rpc('expire_unpaid_booking_holds', { p_now: new Date().toISOString() });
  if (error) {
    console.error('[expire-payment-holds] Worker failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ expired: false }) };
  }
  return { statusCode: 200, body: JSON.stringify({ expired: true, count: Number(data?.expired_count || 0) }) };
};
