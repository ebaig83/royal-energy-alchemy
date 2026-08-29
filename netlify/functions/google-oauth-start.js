'use strict';

// OAuth provisioning is deliberately local-only (scripts/google-calendar-authorize.js).
// This tombstone prevents accidental public use of the former provisioning route.
exports.handler = async () => ({ statusCode: 410, body: JSON.stringify({ error: 'Google OAuth provisioning is disabled. Use the local administrator authorization helper.' }) });
