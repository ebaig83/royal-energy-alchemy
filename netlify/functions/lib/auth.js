// Auth middleware for Netlify Functions.
// Verifies the X-Dashboard-Token header against DASHBOARD_API_SECRET.
// The token is issued by verify-pin on successful PIN entry and stored
// client-side in sessionStorage (rea_api_token). DASHBOARD_API_SECRET
// never leaves the server — the PIN never appears in API requests.

function requireAdmin(event) {
  const secret = process.env.DASHBOARD_API_SECRET;
  if (!secret) {
    return { error: respond(500, { error: 'Server configuration error.' }) };
  }

  const token = (
    event.headers['x-dashboard-token'] ||
    event.headers['X-Dashboard-Token'] ||
    ''
  ).trim();

  if (!token || token !== secret) {
    return { error: respond(401, { error: 'Unauthorized.' }) };
  }

  return { user: { email: process.env.ADMIN_EMAIL } };
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
