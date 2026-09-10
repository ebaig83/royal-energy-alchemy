'use strict';
const { getClient } = require('./lib/supabase');
const { respond } = require('./lib/auth');
const { observeWorker } = require('./lib/worker-health');
const { WEBSITE_SOURCES } = require('./lib/booking-state');
async function processExpired({ sb, now = () => new Date() } = {}) {
  if (!sb) throw new Error('Supabase client required');
  const cutoff = now().toISOString();
  const { data, error } = await sb.from('sessions').select('id,status,payment_status,booking_status').in('source', [...WEBSITE_SOURCES]).neq('payment_status','paid').lte('payment_hold_expires_at',cutoff).not('payment_hold_expires_at','is',null).not('status','in','(cancelled,expired,completed,no_show)').limit(100);
  if (error) throw error;
  const expired = [];
  for (const row of data || []) {
    const { error: updateError } = await sb.from('sessions').update({ status:'expired', booking_status:'payment_expired', google_calendar_status:'not_requested', updated_at:cutoff }).eq('id',row.id).neq('payment_status','paid');
    if (updateError) throw updateError;
    const { error: slotError } = await sb.from('availability_slots').update({ status:'available', session_id:null }).eq('session_id',row.id);
    if (slotError) throw slotError;
    expired.push(row.id);
  }
  return { expired: expired.length, session_ids: expired };
}
exports.processExpired = processExpired;
exports.config = { schedule: '*/10 * * * *' };
exports.handler = async event => { if (event?.httpMethod && event.httpMethod !== 'POST') return respond(405,{error:'Method not allowed.'}); try { return respond(200, await observeWorker(getClient(),'website-booking-expiration', () => processExpired({sb:getClient()}))); } catch (error) { console.error('[expire-website-bookings]', error.message); return respond(500,{error:'Website booking expiration failed.'}); } };
