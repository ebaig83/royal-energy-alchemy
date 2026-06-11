// Shared Supabase client for all Netlify Functions.
// Uses the service_role key — bypasses RLS, full DB access.
// Never expose this key to the browser.

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Netlify environment variables.');
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

module.exports = { getClient };
