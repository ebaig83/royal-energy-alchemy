'use strict';
// Post-lifecycle contract: the temporary bypass must stay removed.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'netlify/functions/booking.js'), 'utf8');
const checks = [
  ['no temporary authorization', !/GOOGLE_MEET_TEST_AUTH|GOOGLE_MEET_TEST_EXPIRES_AT|controlledTestAuthorized/.test(src)],
  ['no public health indicator', !/test_health|env_probe/.test(src)],
  ['all bookings pending', /status:\s*'pending'/.test(src) && /payment_status:\s*'pending'/.test(src)],
  ['no payment fabricated', /amount_paid:\s*0/.test(src) && !/controlledTest/.test(src)],
  ['waiver remains required', /waiver_status:\s*'pending'/.test(src) && /waiver_completed:\s*false/.test(src)],
  ['no automatic unpaid sync', /google_calendar_status:\s*'not_requested'/.test(src)],
  ['observer removed', !fs.existsSync(path.join(root,'netlify/functions/google-meet-test-observe.js'))],
  ['no browser authorization', !/GOOGLE_MEET_TEST_AUTH/.test(fs.readFileSync(path.join(root,'dashboard.html'),'utf8'))],
];
for(const [name,ok] of checks) if(!ok) throw new Error(name);
console.log('google-meet-controlled-test removal contract: 8/8 passed');
