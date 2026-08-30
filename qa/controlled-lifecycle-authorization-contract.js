'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'sessions.js'), 'utf8');
const checks = [
  ['dashboard auth retained', /requireAdmin\(event\)/],
  ['constant-time secret compare', /timingSafeEqual/],
  ['expiration required', /GOOGLE_MEET_TEST_EXPIRES_AT/],
  ['actions limited', /\['reschedule', 'cancel'\]/],
  ['controlled source required', /controlled_google_meet_test/],
  ['identity required', /google meet test/],
  ['email required', /droyal168@gmail\.com/],
  ['service required', /Distance Energy Session/],
  ['single-use marker required', /markerCount !== 1/],
  ['body allowlist enforced', /Object\.keys\(body\)\.some/],
  ['controlled reschedule audited', /controlled_google_meet_test_rescheduled/],
  ['controlled cancellation audited', /controlled_google_meet_test_cancelled/],
  ['unauthorized response generic', /respond\(401, \{ error: 'Unauthorized\.' \}\)/],
];
for (const [name, pattern] of checks) if (!pattern.test(source)) throw new Error(`Missing contract: ${name}`);
console.log(`controlled-lifecycle-authorization-contract: ${checks.length}/${checks.length} passed`);
