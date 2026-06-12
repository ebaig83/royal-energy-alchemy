// /.netlify/functions/health-check-functions
// POST — triggers a live health check of all critical functions, stores results
// Protected: requires X-Dashboard-Token

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const https                     = require('https');

const SITE_URL = process.env.URL || process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

const FUNCTIONS_TO_CHECK = [
  'verify-pin', 'clients', 'sessions', 'daily-briefing',
  'session-prep-brief', 'client-attention-flags', 'client-practitioner-timeline',
  'generate-client-summary', 'timeline', 'aftercare', 'recommendations',
  'session-notes', 'audit-log', 'log-system-error', 'operations-health',
];

function pingOne(name) {
  return new Promise(resolve => {
    const start = Date.now();
    const url   = `${SITE_URL}/.netlify/functions/${name}`;
    const req   = https.get(url, { headers: { 'X-Health-Probe': '1' } }, res => {
      res.resume();
      const ms     = Date.now() - start;
      const status = res.statusCode === 404 ? 'missing' : 'ok';
      resolve({ function_name: name, status, http_status: res.statusCode, response_time_ms: ms });
    });
    req.on('error', err => resolve({
      function_name: name, status: 'error', http_status: 0,
      response_time_ms: Date.now() - start, error_message: err.message,
    }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ function_name: name, status: 'timeout', http_status: 0, response_time_ms: 8000 }); });
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only.' });

  const results = await Promise.all(FUNCTIONS_TO_CHECK.map(pingOne));

  // Persist to DB
  try {
    const sb = getClient();
    await sb.from('function_health_logs').insert(results);
  } catch (e) {
    console.error('[health-check-functions] DB error:', e.message);
  }

  await log({ actor: auth.user.email, action: 'health_check_run', tableName: 'function_health_logs', context: `checked ${results.length} functions` });

  const summary = {
    ok:      results.filter(r => r.status === 'ok').length,
    missing: results.filter(r => r.status === 'missing').length,
    error:   results.filter(r => r.status === 'error' || r.status === 'timeout').length,
    total:   results.length,
  };

  return respond(200, { results, summary, checked_at: new Date().toISOString() });
};
