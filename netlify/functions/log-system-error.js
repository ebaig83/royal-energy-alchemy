// /.netlify/functions/log-system-error
// POST  — stores a frontend JS error or function error in system_errors
// PATCH — marks an error resolved (or reopens it); requires X-Dashboard-Token

const { respond, requireAdmin } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

// Simple fingerprint: hash-like concat of source+message truncated
function fingerprint(source, message) {
  return (source + '|' + (message || '').slice(0, 120)).replace(/[^a-z0-9|._-]/gi, '_');
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  // ── PATCH — resolve or reopen an error ─────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const id = (event.queryStringParameters || {}).id;
    if (!id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const resolved = body.resolved !== false; // default to resolving
    try {
      const sb = getClient();
      await sb.from('system_errors').update({
        resolved,
        resolved_at: resolved ? new Date().toISOString() : null,
      }).eq('id', id);
      return respond(200, { status: 'updated' });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST or PATCH only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  const { source = 'frontend', severity = 'error', message, stack, url, function_name, client_id } = body;

  if (!message) return respond(400, { error: 'message is required.' });

  const fp = fingerprint(source, message);

  try {
    const sb = getClient();

    // Dedup: if same fingerprint in last 5 minutes, skip
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const { data: existing } = await sb
      .from('system_errors')
      .select('id')
      .eq('fingerprint', fp)
      .gte('created_at', fiveMinAgo)
      .limit(1);

    if (existing && existing.length > 0) {
      return respond(200, { status: 'deduped' });
    }

    await sb.from('system_errors').insert({
      source,
      severity,
      message:       message.slice(0, 2000),
      stack:         stack   ? stack.slice(0, 4000)   : null,
      url:           url     ? url.slice(0, 500)       : null,
      function_name: function_name || null,
      client_id:     client_id     || null,
      fingerprint:   fp,
    });

    return respond(201, { status: 'logged' });
  } catch (err) {
    // Never crash — error logging should be silent on failure
    console.error('[log-system-error] DB error:', err.message);
    return respond(200, { status: 'db_error', detail: err.message });
  }
};
