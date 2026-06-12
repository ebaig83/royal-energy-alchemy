// /.netlify/functions/store-qa-result
// POST — stores a qa-agent.js run result in qa_results table
// Protected: requires X-Dashboard-Token

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

  const { overall, summary, checks, console_errors, network_fails, url, git_sha, triggered_by } = body;
  if (!overall) return respond(400, { error: 'overall is required.' });

  try {
    const sb = getClient();
    const { data, error } = await sb.from('qa_results').insert({
      overall,
      summary:        summary       || null,
      checks:         checks        || null,
      console_errors: console_errors || null,
      network_fails:  network_fails  || null,
      url:            url           || null,
      git_sha:        git_sha       || null,
      triggered_by:   triggered_by  || 'manual',
    }).select().single();

    if (error) return respond(500, { error: error.message });
    return respond(201, { id: data.id });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
