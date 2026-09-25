'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const state = require(path.join(root, 'netlify/functions/lib/booking-state.js'));
const completeWebsite = { source:'online', client_name:'Ada Lovelace', client_email:'ada@sample.org', client_phone:'8145550199', service:'Distance Energy Session', session_date:'2099-01-01', session_time:'11:00:00', location_type:'distance', payment_status:'paid', status:'confirmed', booking_status:'confirmed', waiver_completed:true };
assert.equal(state.isOperationalWebsiteBooking(completeWebsite), true);
for (const patch of [{client_name:'Ada'},{client_email:''},{client_phone:''},{service:''},{session_date:'bad'},{session_time:'25:00'},{payment_status:'pending'},{booking_status:'payment_received_incomplete'},{status:'expired'}]) assert.equal(state.isOperationalWebsiteBooking({...completeWebsite,...patch}), false);
assert.equal(state.isOperationalWebsiteBooking({...completeWebsite,location_type:'in_person',service:'House Cleansing/Blessing In-Person'}), false);
assert.equal(state.isOperationalWebsiteBooking({...completeWebsite,location_type:'in_person',service:'House Cleansing/Blessing In-Person',service_address_line1:'1 Main St',service_city:'Erie',service_state:'PA',service_postal_code:'16501',service_country:'US'}), true);
assert.equal(state.isWebsiteBooking({ source: 'online' }), true);
assert.equal(state.websiteAppointmentStatus({ source: 'online', status: 'confirmed', payment_status: 'pending' }), 'pending');
assert.equal(state.websiteAppointmentStatus({ source: 'online', status: 'pending', payment_status: 'paid' }), 'pending');
assert.equal(state.safeWebsiteStatusLabel({ source: 'online', status: 'confirmed', payment_status: 'pending' }), 'Payment required');
assert.equal(state.safeWebsiteStatusLabel(completeWebsite), 'Confirmed');

const booking = read('netlify/functions/booking.js');
assert.match(booking, /status:\s+'pending'/);
assert.match(booking, /payment_status:\s+'pending'/);
assert.match(booking, /payment_hold_expires_at/);
assert.match(booking, /booking_status:\s+'payment_required'/);
assert.doesNotMatch(booking, /templateName:\s+'appointment_confirmation'/);

const webhook = read('netlify/functions/stripe-webhook.js');
assert.match(webhook, /verifyStripeSignature/);
assert.match(webhook, /status: websiteBooking \? \(complete \? 'confirmed' : 'pending'\)/);
assert.match(webhook, /payment_status:\s+'paid'/);
assert.match(webhook, /payment_hold_expires_at:\s+null/);

const sessions = read('netlify/functions/sessions.js');
assert.match(sessions, /websiteAppointmentStatus\(old\)/);
assert.match(sessions, /practitioner_update_session_with_audit/);
assert.match(sessions, /Use the dedicated audited appointment lifecycle or payment workflow/);
assert.match(sessions, /websiteAppointmentStatus\(old\)/);

const payments = read('netlify/functions/payments.js');
assert.match(payments, /practitioner_record_manual_payment_with_audit/);

const calendar = read('netlify/functions/lib/google-calendar.js');
assert.match(calendar, /!isWebsiteBooking\(session\) \|\| isOperationalWebsiteBooking\(session\)/);

const expiry = read('netlify/functions/expire-website-bookings.js');
assert.match(expiry, /expire_unpaid_booking_holds/);
const holdMigration = read('supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql');
assert.match(holdMigration, /payment_hold_expires_at<=p_now/);
assert.match(holdMigration, /status='expired',booking_status='payment_expired'/);
assert.match(holdMigration, /set status='available',session_id=null,held_until=null,held_for=null/);
assert.match(holdMigration, /appointment_action_audit/);
assert.match(read('netlify.toml'), /expire-website-bookings/);

const model = read('dashboard-p1/model.mjs');
assert.match(model, /Payment required/);

console.log('payment-gated booking state machine checks passed');
