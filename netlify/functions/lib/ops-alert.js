'use strict';

// ── lib/ops-alert.js ──────────────────────────────────────────────────────────
// Operational failure logging — replaces silent console.warn for critical errors.
// Writes to audit_logs with action 'system_failure' so dashboard can surface them.
// Always non-throwing — failures in error logging must not cascade.

async function logFailure(sb, { type, clientId, sessionId, errorMessage, context, retryRecommended }) {
  if (!sb) return;
  try {
    await sb.from('audit_logs').insert({
      action:     'system_failure',
      table_name: 'system',
      actor:      'system',
      record_id:  sessionId || clientId || null,
      new_data: {
        failure_type:       type,
        client_id:          clientId         || null,
        session_id:         sessionId        || null,
        error_message:      errorMessage     || 'unknown error',
        context:            context          || null,
        retry_recommended:  retryRecommended !== false,
        failed_at:          new Date().toISOString(),
      },
    });
  } catch (e) {
    // Last-resort: at minimum log to stdout so Netlify function logs capture it
    console.error('[ops-alert] FAILED to log failure — original:', type, errorMessage, '— meta error:', e.message);
  }
}

// Convenience wrappers for the most common failure types

function emailFailure(sb, { templateName, clientId, sessionId, error }) {
  console.error(`[ops-alert] Email failure: ${templateName} for client ${clientId}:`, error);
  return logFailure(sb, {
    type:             'email_send_failure',
    clientId,
    sessionId,
    errorMessage:     error?.message || String(error),
    context:          `Template: ${templateName}`,
    retryRecommended: true,
  });
}

function processingFailure(sb, { processor, clientId, sessionId, error }) {
  console.error(`[ops-alert] Processing failure: ${processor} for client ${clientId}:`, error);
  return logFailure(sb, {
    type:             'processing_failure',
    clientId,
    sessionId,
    errorMessage:     error?.message || String(error),
    context:          `Processor: ${processor}`,
    retryRecommended: true,
  });
}

function bookingFailure(sb, { step, clientId, sessionId, error }) {
  console.error(`[ops-alert] Booking failure at step '${step}':`, error);
  return logFailure(sb, {
    type:             'booking_failure',
    clientId,
    sessionId,
    errorMessage:     error?.message || String(error),
    context:          `Step: ${step}`,
    retryRecommended: false,  // booking failures need manual review
  });
}

function reminderFailure(sb, { clientId, sessionId, error }) {
  console.error(`[ops-alert] Reminder failure for session ${sessionId}:`, error);
  return logFailure(sb, {
    type:             'reminder_failure',
    clientId,
    sessionId,
    errorMessage:     error?.message || String(error),
    context:          'appointment_reminder send',
    retryRecommended: true,
  });
}

module.exports = { logFailure, emailFailure, processingFailure, bookingFailure, reminderFailure };
