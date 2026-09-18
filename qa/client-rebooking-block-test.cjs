const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/2026-09-18-client-rebooking-block.sql'), 'utf8');
const clients = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/clients.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'dashboard-p1/app.mjs'), 'utf8');
const booking = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/booking.js'), 'utf8');

for (const field of ['booking_blocked boolean', 'booking_blocked_at timestamptz', 'booking_block_reason text']) assert.match(migration, new RegExp(field.replace(' ', '\\s+')));
assert.match(clients, /booking_blocked_at = body\.booking_blocked \? new Date\(\)\.toISOString\(\) : null/);
assert.match(app, /Block Rebooking/);
assert.match(app, /Allow Rebooking/);
assert.match(booking, /We’re unable to complete this booking online/);
assert.ok(booking.indexOf('booking_blocked_attempt') < booking.indexOf(".update({ status: 'booked'"), 'blocked attempts must not claim a slot');
console.log('client rebooking block contract tests passed');
