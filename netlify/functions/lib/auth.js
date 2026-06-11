// Auth middleware for Netlify Functions.
// Verifies the Supabase JWT sent in the Authorization header.
// Every admin-only function calls requireAdmin(event) first.

const { createClient } = require('@supabase/supabase-js');

async function requireAdmin(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { error: respond(401, { error: 'No authorization token provided.' }) };
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { error: respond(500, { error: 'Auth configuration missing.' }) };
  }

  // Use the anon key client just to verify the JWT — not to query data
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);

  if (error || !data?.user) {
    return { error: respond(401, { error: 'Invalid or expired session. Please log in again.' }) };
  }

  // Only allow the admin email (Daron's account)
  const adminEmail = process.env.ADMIN_EMAIL || 'droyal168@gmail.com';
  if (data.user.email !== adminEmail) {
    return { error: respond(403, { error: 'Access denied.' }) };
  }

  return { user: data.user };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
    },
    body: JSON.stringify(body),
  };
}

module.exports = { requireAdmin, respond };
