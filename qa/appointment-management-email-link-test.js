'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const sessions = read('netlify/functions/sessions.js');
const booking = read('netlify/functions/booking.js');
const stripe = read('netlify/functions/stripe-webhook.js');
const page = read('manage-appointment.html');
const endpoint = read('netlify/functions/manage-appointment.js');

assert(sessions.includes('/manage-appointment.html?session_id=${data.id}'));
assert(booking.includes('/manage-appointment.html?session_id=${sessionId}'));
assert(stripe.includes('/manage-appointment.html?session_id=${encodeURIComponent(session.id)}'));
assert(page.includes("params.get('session_id') || params.get('id')"));
assert(page.includes("manage-appointment?session_id=' + encodeURIComponent(sessionId)"));
assert(page.includes("session_id:   _sessionId") && page.includes("action:       'reschedule_confirmed'"));
assert(page.includes("session_id:  _sessionId") && page.includes("action:      'cancel_confirmed'"));
assert(endpoint.includes(".eq('id', sessionId)") && endpoint.includes(".eq('id', session_id)"));
assert(endpoint.includes("Public-facing endpoint — no auth required"));
assert(!sessions.includes('session_id=undefined') && !booking.includes('session_id=undefined'));

console.log('appointment management email link contract: 10/10 passed');
