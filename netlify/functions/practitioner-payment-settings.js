'use strict';
const crypto = require('crypto');
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { configuredSettings, validateSettingsInput } = require('./lib/payment-request');

exports.handler = async event => {
  if (!['GET', 'PATCH', 'PUT'].includes(event.httpMethod)) return respond(405, { error: 'Method not allowed.' });
  const auth = await requireAdmin(event); if (auth.error) return auth.error;
  const sb = getClient();
  if (event.httpMethod === 'GET') {
    const { data, error } = await sb.from('practitioner_payment_settings').select('*').eq('practitioner_key', 'default').maybeSingle();
    if (error) return respond(500, { error: 'Payment settings are unavailable.' });
    return respond(200, { settings: configuredSettings(data || {}) });
  }
  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
  let updates; try { updates = validateSettingsInput(body); } catch (error) { return respond(400, { error: error.message }); }
  if (!Object.keys(updates).length) return respond(400, { error: 'No payment settings were supplied.' });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('practitioner_payment_settings').upsert({ practitioner_key: 'default', ...updates }, { onConflict: 'practitioner_key' }).select('*').single();
  if (error) return respond(500, { error: 'Payment settings could not be saved.' });
  return respond(200, { saved: true, request_id: crypto.randomUUID(), settings: configuredSettings(data) });
};
