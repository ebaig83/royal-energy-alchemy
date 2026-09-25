'use strict';

const WEBSITE_SOURCES = new Set(['online', 'website', 'website_booking', 'website booking', 'website_form', 'booking']);
const { findService } = require('./services');
const { easternInstant } = require('./business-time');
function normalized(value) { return String(value || '').trim().toLowerCase(); }
function isWebsiteBooking(session) { return WEBSITE_SOURCES.has(normalized(session?.source)); }
function isPaid(session) { return normalized(session?.payment_status) === 'paid'; }
function attachServiceAddress(session, address) {
  if (!session || !address) return session;
  return { ...session, service_address_line1: address.address_line1 || null, service_address_line2: address.address_line2 || null, service_city: address.city || null, service_state: address.state || null, service_postal_code: address.postal_code || null, service_country: address.country || null };
}
function waiverComplete(session) { return session?.waiver_completed === true || ['complete','completed','signed'].includes(normalized(session?.waiver_status)); }
function completeWebsiteDetails(session) {
  const name = String(session?.client_name || '').trim().split(/\s+/).filter(Boolean);
  const email = String(session?.client_email || '').trim();
  const phone = String(session?.client_phone || '').replace(/\D/g, '');
  const service = findService(session?.service);
  const serviceValue = normalized(session?.service);
  const serviceValid = !!service && [service.id, service.label, ...(service.aliases || [])].some(value => normalized(value) === serviceValue);
  const location = normalized(session?.location_type);
  const address = ['service_address_line1','service_city','service_state','service_postal_code','service_country'].every(key => String(session?.[key] || '').trim());
  const locationValid = ['distance','remote'].includes(location)
    ? !service?.locationType || service.locationType === location
    : ['in_person','in-person'].includes(location) && service?.locationType === 'in_person' && address;
  const placeholderName = /^(?:test|unknown|not provided|n\/?a|none|your name|first name|last name)$/i;
  const placeholderPhone = /^(\d)\1+$/.test(phone) || /^1234567\d*$/.test(phone);
  return name.length >= 2 && !name.some(part=>placeholderName.test(part)) && !/^(?:john doe|jane doe|test user|test client|unknown unknown|first last)$/i.test(name.join(' ')) && String(session?.service || '').trim().length > 0 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email) &&
    !/(?:example\.(?:com|org|net)|test\.com|invalid)$/i.test(email) && phone.length >= 7 && phone.length <= 15 &&
    serviceValid && !!easternInstant(session?.session_date, session?.session_time) && locationValid &&
    !placeholderPhone;
}
function isOperationalWebsiteBooking(session, { allowCompleted = false } = {}) {
  const status = normalized(session?.status);
  return isWebsiteBooking(session) && isPaid(session) &&
    (status === 'confirmed' || (allowCompleted && status === 'completed')) &&
    normalized(session?.booking_status) === 'confirmed' &&
    waiverComplete(session) && completeWebsiteDetails(session) &&
    !['cancelled', 'expired', 'no_show'].includes(status);
}
function isOperationalAppointment(session, { allowCompleted = false } = {}) {
  if (!session || ['cancelled', 'expired', 'no_show'].includes(normalized(session.status)) || (!allowCompleted && normalized(session.status)==='completed')) return false;
  return isWebsiteBooking(session) ? isOperationalWebsiteBooking(session,{allowCompleted}) : true;
}
function isPendingWebsiteBooking(session) {
  return isWebsiteBooking(session) && !isPaid(session) &&
    !['cancelled', 'expired', 'completed', 'no_show'].includes(normalized(session?.status));
}
function isExpiredWebsiteBooking(session) {
  return isWebsiteBooking(session) && !['cancelled','completed','no_show'].includes(normalized(session?.status)) && (normalized(session?.status) === 'expired' || normalized(session?.booking_status) === 'payment_expired');
}
function websiteAppointmentStatus(session) {
  if (isWebsiteBooking(session) && !isPaid(session) && !['cancelled', 'expired', 'completed', 'no_show'].includes(normalized(session?.status))) return 'pending';
  return session?.status || 'pending';
}
function safeWebsiteStatusLabel(session) {
  if (isExpiredWebsiteBooking(session)) return 'Hold expired / Payment not completed';
  if (isWebsiteBooking(session) && !isPaid(session) && !['cancelled', 'expired', 'completed', 'no_show'].includes(normalized(session?.status))) return 'Payment required';
  if (isWebsiteBooking(session) && isPaid(session) && !isOperationalWebsiteBooking(session)) return 'Payment received — booking needs review';
  return isWebsiteBooking(session) && isOperationalWebsiteBooking(session) ? 'Confirmed' : (session?.status || 'Review appointment');
}
module.exports = { WEBSITE_SOURCES, normalized, isWebsiteBooking, isPaid, attachServiceAddress, waiverComplete, completeWebsiteDetails, isOperationalWebsiteBooking, isOperationalAppointment, isPendingWebsiteBooking, isExpiredWebsiteBooking, websiteAppointmentStatus, safeWebsiteStatusLabel };
