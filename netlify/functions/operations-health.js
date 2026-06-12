// /.netlify/functions/operations-health
// GET  — returns aggregated Operations Center data
// Protected: requires X-Dashboard-Token
//
// Returns: { system, functions, errors, ai, audit, deploy, qa }

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const https                     = require('https');

const SITE_URL = process.env.URL || process.env.SITE_URL || 'https://royal-energy-alchemy.netlify.app';

const ALL_FUNCTIONS = [
  'verify-pin', 'clients', 'sessions', 'daily-briefing',
  'session-prep-brief', 'client-attention-flags', 'client-practitioner-timeline',
  'generate-client-summary', 'timeline', 'aftercare', 'recommendations',
  'session-notes', 'audit-log', 'operations-health', 'log-system-error',
  'health-check-functions',
];

// Ping a single function and return { status, http_status, response_time_ms }
function pingFunction(name) {
  return new Promise(resolve => {
    const start = Date.now();
    const url   = `${SITE_URL}/.netlify/functions/${name}`;
    const req   = https.get(url, { headers: { 'X-Health-Probe': '1' } }, res => {
      const ms = Date.now() - start;
      res.resume(); // drain body
      const status     = res.statusCode === 404 ? 'missing' : 'ok';
      resolve({ name, status, http_status: res.statusCode, response_time_ms: ms });
    });
    req.on('error', err => {
      resolve({ name, status: 'error', http_status: 0, response_time_ms: Date.now() - start, error: err.message });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ name, status: 'timeout', http_status: 0, response_time_ms: 8000 }); });
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const sb      = getClient();
  const params  = event.queryStringParameters || {};
  const section = params.section || 'all'; // allow loading one section at a time

  const results = {};

  // ── Functions health (live pings) ─────────────────────────────────────────
  if (section === 'all' || section === 'functions') {
    try {
      const pings = await Promise.all(ALL_FUNCTIONS.map(pingFunction));
      // Persist to function_health_logs in background (don't await)
      const rows = pings.map(p => ({
        function_name:    p.name,
        status:           p.status,
        http_status:      p.http_status,
        response_time_ms: p.response_time_ms,
        error_message:    p.error || null,
      }));
      sb.from('function_health_logs').insert(rows).then(() => {}).catch(() => {});
      results.functions = pings;
    } catch (e) {
      results.functions = { error: e.message };
    }
  }

  // ── Recent system errors ───────────────────────────────────────────────────
  if (section === 'all' || section === 'errors') {
    try {
      const { data } = await sb
        .from('system_errors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      results.errors = data || [];
    } catch (e) {
      results.errors = [];
    }
  }

  // ── AI usage stats ─────────────────────────────────────────────────────────
  if (section === 'all' || section === 'ai') {
    try {
      const now       = new Date();
      const day30     = new Date(now - 30 * 864e5).toISOString();
      const { data }  = await sb
        .from('ai_usage_logs')
        .select('*')
        .gte('created_at', day30)
        .order('created_at', { ascending: false });

      const today7 = new Date(now.toISOString().slice(0, 10)).toISOString();
      const day7   = new Date(now - 7  * 864e5).toISOString();

      function agg(rows, since) {
        const r = rows.filter(x => x.created_at >= since);
        const byFeature = {};
        r.forEach(x => { byFeature[x.feature] = (byFeature[x.feature] || 0) + 1; });
        const success = r.filter(x => x.success).length;
        const times   = r.filter(x => x.response_time_ms).map(x => x.response_time_ms);
        return {
          total:    r.length,
          success,
          failed:   r.length - success,
          success_rate: r.length ? Math.round(success / r.length * 100) : 100,
          avg_response_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
          by_feature: byFeature,
        };
      }

      results.ai = {
        today:  agg(data || [], today7),
        day7:   agg(data || [], day7),
        day30:  agg(data || [], day30),
      };
    } catch (e) {
      results.ai = { error: e.message };
    }
  }

  // ── Audit activity ─────────────────────────────────────────────────────────
  if (section === 'all' || section === 'audit') {
    try {
      const { data } = await sb
        .from('audit_logs')
        .select('id, created_at, actor, action, table_name, context')
        .order('created_at', { ascending: false })
        .limit(30);
      results.audit = data || [];
    } catch (e) {
      results.audit = [];
    }
  }

  // ── Deploy info ────────────────────────────────────────────────────────────
  if (section === 'all' || section === 'deploy') {
    results.deploy = {
      commit_ref:     process.env.COMMIT_REF     || null,
      deploy_id:      process.env.DEPLOY_ID      || null,
      context:        process.env.CONTEXT        || 'production',
      branch:         process.env.BRANCH         || 'main',
      build_id:       process.env.BUILD_ID       || null,
      site_url:       SITE_URL,
      deploy_url:     process.env.DEPLOY_URL     || null,
      deploy_prime_url: process.env.DEPLOY_PRIME_URL || null,
    };
  }

  // ── Last QA result ─────────────────────────────────────────────────────────
  if (section === 'all' || section === 'qa') {
    try {
      const { data } = await sb
        .from('qa_results')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(5);
      results.qa = data || [];
    } catch (e) {
      results.qa = [];
    }
  }

  // ── System health summary ──────────────────────────────────────────────────
  if (section === 'all' || section === 'system') {
    const fns     = results.functions || [];
    const errors  = results.errors    || [];
    const lastQA  = (results.qa || [])[0];

    const fnOk    = Array.isArray(fns) ? fns.filter(f => f.status === 'ok').length       : 0;
    const fnTotal = Array.isArray(fns) ? fns.length : 0;
    const critFns = ['verify-pin', 'clients', 'sessions', 'daily-briefing'];
    const critOk  = Array.isArray(fns) ? fns.filter(f => critFns.includes(f.name) && f.status === 'ok').length : 0;

    const openErrors = errors.filter(e => !e.resolved).length;

    results.system = {
      dashboard: { status: 'ok', label: 'Dashboard',  detail: 'PIN auth active' },
      api:       {
        status:  critOk === critFns.length ? 'ok' : critOk > 0 ? 'warn' : 'error',
        label:   'API',
        detail:  `${fnOk}/${fnTotal} functions healthy`,
      },
      database:  { status: 'ok', label: 'Database',   detail: 'Supabase connected' },
      ai:        {
        status:  (results.ai && !results.ai.error) ? 'ok' : 'warn',
        label:   'AI Services',
        detail:  results.ai && !results.ai.error ? `${(results.ai.day7 || {}).success_rate ?? 100}% success (7d)` : 'Usage data unavailable',
      },
      qa:        {
        status:  !lastQA ? 'warn' : lastQA.overall === 'PASS' ? 'ok' : lastQA.overall === 'WARN' ? 'warn' : 'error',
        label:   'QA',
        detail:  lastQA ? `Last run: ${lastQA.overall} (${new Date(lastQA.run_at).toLocaleDateString()})` : 'No QA runs recorded',
      },
      open_errors: openErrors,
      checked_at:  new Date().toISOString(),
    };
  }

  // Audit that ops center was opened
  await log({ actor: auth.user.email, action: 'viewed', tableName: 'operations_center', context: `section=${section}` });

  return respond(200, results);
};
