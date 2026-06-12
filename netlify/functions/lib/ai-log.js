// Shared helper — writes one row to ai_usage_logs.
// Fire-and-forget: never throws, never blocks the response.

const { getClient } = require('./supabase');

/**
 * @param {object} opts
 * @param {string}  opts.feature          e.g. 'generate_client_summary'
 * @param {string}  [opts.model]          Claude model ID
 * @param {string}  [opts.clientId]       UUID of the client being processed
 * @param {boolean} opts.success
 * @param {number}  [opts.responseTimeMs] wall-clock ms for the AI call
 * @param {number}  [opts.tokensUsed]     total tokens from Claude response
 * @param {string}  [opts.errorMessage]   error text when success=false
 * @param {object}  [opts.metadata]       any extra jsonb context
 */
async function logAIUsage(opts) {
  try {
    const sb = getClient();
    await sb.from('ai_usage_logs').insert({
      feature:          opts.feature,
      model:            opts.model            || null,
      client_id:        opts.clientId         || null,
      success:          opts.success          ?? true,
      response_time_ms: opts.responseTimeMs   || null,
      tokens_used:      opts.tokensUsed       || null,
      error_message:    opts.errorMessage     || null,
      metadata:         opts.metadata         || null,
    });
  } catch (_) {
    // Logging must never crash the calling function
  }
}

module.exports = { logAIUsage };
