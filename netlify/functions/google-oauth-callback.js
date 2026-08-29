'use strict';

exports.handler = async () => ({ statusCode: 410, body: JSON.stringify({ error: 'Google OAuth provisioning is disabled.' }) });
