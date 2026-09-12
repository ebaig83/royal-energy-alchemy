'use strict';

const crypto = require('crypto');

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function logRecoveryAudit(sb, { eventType, outcome, identifier, providerMessageId = null }) {
  try {
    await sb.from('practitioner_recovery_audit').insert({
      event_type: eventType,
      outcome,
      identifier_hash: identifier ? hashIdentifier(identifier) : null,
      provider_message_id: providerMessageId || null,
    });
  } catch { /* Audit failure must not disclose recovery state. */ }
}

module.exports = { hashIdentifier, logRecoveryAudit };
