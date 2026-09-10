'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { readOperations } = require('./lib/agent-telemetry');

exports.handler = async event => {
  const auth = await requireAdmin(event, { touch: false });
  if (auth.error) return auth.error;
  if (String(event.httpMethod || '').toUpperCase() !== 'GET') return respond(405, { error: 'Agent Operations is read-only.' });
  try { return respond(200, await readOperations()); }
  catch { return respond(503, { error: 'Agent Operations telemetry is unavailable.' }); }
};
