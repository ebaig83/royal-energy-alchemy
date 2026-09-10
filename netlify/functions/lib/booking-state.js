'use strict';

const WEBSITE_SOURCES = new Set(['online', 'website', 'website_booking', 'website booking', 'website_form', 'booking']);
function normalized(value) { return String(value || '').trim().toLowerCase(); }
function isWebsiteBooking(session) { return WEBSITE_SOURCES.has(normalized(session?.source)); }
function isPaid(session) { return normalized(session?.payment_status) === 'paid'; }
function websiteAppointmentStatus(session) {
  if (isWebsiteBooking(session) && !isPaid(session) && !['cancelled', 'expired', 'completed', 'no_show'].includes(normalized(session?.status))) return 'pending';
  return session?.status || 'pending';
}
function safeWebsiteStatusLabel(session) {
  if (isWebsiteBooking(session) && !isPaid(session) && !['cancelled', 'expired', 'completed', 'no_show'].includes(normalized(session?.status))) return 'Payment required';
  return normalized(session?.status) === 'confirmed' ? 'Confirmed' : (session?.status || 'Review appointment');
}
module.exports = { WEBSITE_SOURCES, normalized, isWebsiteBooking, isPaid, websiteAppointmentStatus, safeWebsiteStatusLabel };
