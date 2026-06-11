// /.netlify/functions/audit-log
// GET  ?table=clients      — filter by table
// GET  ?actor=email        — filter by who did it
// GET  ?limit=50&offset=0  — paginate
// GET  (no params)         — last 100 entries across all tables

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const limit  = Math.min(parseInt(params.limit)  || 100, 500);
  const offset = parseInt(params.offset) || 0;

  let query = sb
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.table)  query = query.eq('table_name', params.table);
  if (params.actor)  query = query.eq('actor', params.actor);
  if (params.action) query = query.eq('action', params.action);

  const { data, error, count } = await query;
  if (error) return respond(500, { error: error.message });

  return respond(200, { logs: data, limit, offset, returned: (data || []).length });
};
