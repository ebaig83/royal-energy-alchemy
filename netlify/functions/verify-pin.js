const { getClient } = require('./lib/supabase');
const { log }       = require('./lib/audit');

const MAX_ATTEMPTS = 5;
const WINDOW_SECS  = 900; // 15 minutes

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const sb = getClient();

    // Rate limit: count failed PIN attempts from this IP in the last 15 minutes
    const windowStart = new Date(Date.now() - WINDOW_SECS * 1000).toISOString();
    const { count } = await sb
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'pin_attempt_failed')
      .eq('ip_address', ip)
      .gte('created_at', windowStart);

    if (count >= MAX_ATTEMPTS) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: "Too many attempts. Try again later." })
      };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) };
    }

    const { pin } = body;

    if (!pin || pin !== process.env.DASHBOARD_PIN) {
      await log({ actor: 'anonymous', action: 'pin_attempt_failed', tableName: 'auth', ip });
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid PIN" }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, token: process.env.DASHBOARD_API_SECRET || '' })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) };
  }
};
