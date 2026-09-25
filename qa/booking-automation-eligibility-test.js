'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const state = require('../netlify/functions/lib/booking-state');
const comms = require('../netlify/functions/lib/session-communications');
const { sendMeetingReady } = require('../netlify/functions/session-calendar-sync');
const read = p => fs.readFileSync(p, 'utf8');

const paid = {
  id: 's1', source: 'online', client_name: 'Ada Lovelace', client_email: 'ada@sample.org', client_phone: '8145550199',
  service: 'Distance Energy Session', session_date: '2099-01-01', session_time: '11:00:00', location_type: 'distance',
  status: 'confirmed', booking_status: 'confirmed', payment_status: 'paid', waiver_completed: true,
};
const pending = { ...paid, status: 'pending', booking_status: 'payment_required', payment_status: 'pending' };
const incomplete = { ...paid, booking_status: 'payment_received_incomplete', waiver_completed: false };
const expired = { ...pending, status: 'expired', booking_status: 'payment_expired' };
for (const row of [pending, incomplete, expired]) {
  assert.equal(state.isOperationalAppointment(row), false);
  assert.equal(comms.isActiveSession(row), false);
}
assert.equal(state.isOperationalAppointment(paid), true);
assert.equal(comms.isActiveSession(paid), true);

const inPerson = { ...paid, service: 'House Cleansing/Blessing In-Person', location_type: 'in_person' };
assert.equal(state.isOperationalAppointment(inPerson), false, 'missing in-person address is ineligible');
const withAddress = state.attachServiceAddress(inPerson, {
  address_line1: '1 Main St', city: 'Erie', state: 'PA', postal_code: '16501', country: 'US',
});
assert.equal(state.isOperationalAppointment(withAddress), true, 'complete address enables valid in-person booking');
assert.equal(state.isOperationalAppointment(paid), true, 'remote booking does not require service address');

const start = comms.sessionStart({ session_date: '2026-09-19', session_time: '10:00:00' });
assert.ok(start);
const completion = new Date(start.getTime() + 60 * 60000);
const after72h = new Date(completion.getTime() + 72 * 60 * 60000);
assert.equal(comms.followupDue({ ...paid, session_date: '2026-09-19', session_time: '10:00:00' }, after72h), true);
for (const row of [pending, incomplete, expired]) assert.equal(comms.isActiveSession(row), false, 'unconfirmed website rows cannot follow up');
assert.equal(comms.isActiveSession({ source: 'manual_practitioner', status: 'completed' }), true, 'manual completed appointments follow their own policy');

(async () => {
  let sends = 0;
  const send = async () => { sends += 1; return { sent: true }; };
  for (const row of [pending, incomplete, expired]) {
    const result = await sendMeetingReady({}, { ...row, google_meet_url: 'https://meet.google.com/abc-defg-hij' }, send);
    assert.equal(result.skipped, true);
  }
  assert.equal(sends, 0, 'ineligible website bookings receive no Meet-ready communication');
  const result = await sendMeetingReady({}, { ...paid, google_meet_url: 'https://meet.google.com/abc-defg-hij' }, send);
  assert.equal(result.sent, true);
  assert.equal(sends, 1, 'eligible paid confirmed website booking can receive Meet-ready communication');

  const sessions = read('netlify/functions/sessions.js');
  assert.match(sessions, /session_service_addresses/);
  assert.match(sessions, /sessions = sessions\.filter\(isOperationalAppointment\)/);
  const calendar = read('netlify/functions/session-calendar-sync.js');
  assert.match(calendar, /session_service_addresses/);
  assert.match(calendar, /attachServiceAddress/);
  assert.match(calendar, /isOperationalWebsiteBooking\(session\)/);
  const reminder = read('netlify/functions/reminder.js');
  assert.match(reminder, /session_service_addresses/);
  assert.match(reminder, /isOperationalAppointment\(s\)/);
  const scheduledComms = read('netlify/functions/session-communications.js');
  assert.match(scheduledComms, /session_service_addresses/);
  assert.match(scheduledComms, /isActiveSession\(session,\{allowCompletedWebsiteFollowup:followup&&!reminder\}\)/);
  assert.match(read('netlify/functions/stripe-webhook.js'), /completeWebsiteDetails\(session\)/);
  const inPersonMeeting = await sendMeetingReady({}, { ...withAddress, google_meet_url: 'https://meet.google.com/abc-defg-hij' }, send);
  assert.equal(inPersonMeeting.sent, true, 'in-person Meet-ready requires and accepts the private address');
  assert.equal(sends, 2);
  console.log('booking automation eligibility, private address loading, follow-up and Meet-ready gates passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
