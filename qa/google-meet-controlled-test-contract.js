'use strict';
const fs = require('fs');
const src = fs.readFileSync('netlify/functions/booking.js', 'utf8');
const checks = [
  ['secret fail-closed', /if \(!secret \|\| !supplied \|\| !Number\.isFinite\(expiresAt\)/],
  ['expiry enforced', /Date\.now\(\) >= expiresAt/],
  ['exact test identity', /google meet test.*droyal168@gmail\.com/s],
  ['remote service only', /serviceInfo\?\.id === 'distance-energy-session'/],
  ['single-use audit guard', /controlled_google_meet_test_booking/],
  ['ordinary bookings remain pending', /controlledTest \? 'paid' : 'pending'/],
  ['test source marker', /controlled_google_meet_test/],
  ['no browser secret', !/GOOGLE_MEET_TEST_AUTH/.test(fs.readFileSync('dashboard.html', 'utf8'))],
];
for (const [name, ok] of checks) if (!(ok instanceof RegExp ? ok.test(src) : ok)) throw new Error(`failed: ${name}`);
console.log(`google-meet-controlled-test-contract: ${checks.length}/${checks.length} passed`);
