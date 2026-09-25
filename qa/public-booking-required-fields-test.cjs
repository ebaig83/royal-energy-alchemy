const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _test } = require('../netlify/functions/booking');

const valid = { client_name: 'Ada Example', client_email: ' ADA@sample.org ', client_phone: '(814) 555-0199' };
assert.deepEqual(_test.validatePublicBookingFields(valid), {
  name: 'Ada Example', email: 'ada@sample.org', phone: '8145550199',
});
for (const body of [
  { ...valid, client_phone: undefined },
  { ...valid, client_phone: '' },
  { ...valid, client_phone: '   ' },
  { ...valid, client_phone: '123' },
  { ...valid, client_email: 'not-an-email' },
  { ...valid, client_name: '   ' },
]) assert.match(_test.validatePublicBookingFields(body).error, /required|valid/i);
assert.match(_test.validatePublicBookingFields({ client_name: valid.client_name, client_email: valid.client_email }).error, /telephone/i);
assert.equal(_test.isBlockedClient({ email: 'blocked@sample.org', phone: '(814) 555-0199' }, 'blocked@sample.org', '8145550199'), true);
assert.equal(_test.isBlockedClient({ email: 'other@sample.org', phone: '5555555555' }, 'blocked@sample.org', '8145550199'), false);

const bookingSource = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/booking.js'), 'utf8');
assert.ok(bookingSource.indexOf("eq('booking_blocked', true)") < bookingSource.indexOf(".from('availability_slots')"), 'block gate must precede slot mutation');
assert.match(bookingSource, /booking_blocked_attempt/);
console.log('public booking required-field and block-gate tests passed');
