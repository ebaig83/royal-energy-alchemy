'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const state = require(path.join(root, 'netlify/functions/lib/booking-state.js'));
assert.equal(state.isWebsiteBooking({ source: 'online' }), true);
assert.equal(state.websiteAppointmentStatus({ source: 'online', status: 'confirmed', payment_status: 'pending' }), 'pending');
assert.equal(state.websiteAppointmentStatus({ source: 'online', status: 'pending', payment_status: 'paid' }), 'pending');
assert.equal(state.safeWebsiteStatusLabel({ source: 'online', status: 'confirmed', payment_status: 'pending' }), 'Payment required');
assert.equal(state.safeWebsiteStatusLabel({ source: 'online', status: 'confirmed', payment_status: 'paid' }), 'Confirmed');

const booking = read('netlify/functions/booking.js');
assert.match(booking, /status:\s+'pending'/);
assert.match(booking, /payment_status:\s+'pending'/);
assert.match(booking, /payment_hold_expires_at/);
assert.match(booking, /booking_status:\s+'payment_required'/);
assert.doesNotMatch(booking, /templateName:\s+'appointment_confirmation'/);

const webhook = read('netlify/functions/stripe-webhook.js');
assert.match(webhook, /verifyStripeSignature/);
assert.match(webhook, /status: websiteBooking \? 'confirmed'/);
assert.match(webhook, /payment_status:\s+'paid'/);
assert.match(webhook, /payment_hold_expires_at:\s+null/);

const sessions = read('netlify/functions/sessions.js');
assert.match(sessions, /Website bookings require verified Stripe payment/);
assert.match(sessions, /Website bookings become confirmed\/paid only through verified Stripe webhook processing/);
assert.match(sessions, /websiteAppointmentStatus\(old\)/);

const payments = read('netlify/functions/payments.js');
assert.match(payments, /Website bookings become paid only through verified Stripe webhook processing/);

const calendar = read('netlify/functions/lib/google-calendar.js');
assert.match(calendar, /!isWebsiteBooking\(session\) \|\| isPaid\(session\)/);

const expiry = read('netlify/functions/expire-website-bookings.js');
assert.match(expiry, /payment_hold_expires_at/);
assert.match(expiry, /status:'expired'/);
assert.match(expiry, /booking_status:'payment_expired'/);
assert.match(expiry, /status:'available', session_id:null/);
assert.match(read('netlify.toml'), /expire-website-bookings/);

const model = read('dashboard-p1/model.mjs');
assert.match(model, /Payment required/);

console.log('payment-gated booking state machine checks passed');
