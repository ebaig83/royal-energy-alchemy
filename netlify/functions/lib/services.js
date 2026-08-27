'use strict';

const SERVICES = [
  { id: 'implant-parasite-removal', label: 'Implant/Parasite Removal', price: 100, duration: 60 },
  { id: 'follow-up-session', label: 'Follow-Up Session', price: 80, priceNote: 'each', duration: 60 },
  { id: 'heavy-duty-removal', label: 'Heavy Duty Removal, Exorcism or Emergency Removal Session', price: 120, duration: 60 },
  { id: 'distance-energy-session', label: 'Distance Energy Session', price: 70, duration: 60 },
  { id: 'energy-session-15-adult', label: '15 Minute Energy Session (15 yrs + up)', price: 50, duration: 15 },
  { id: 'energy-session-15-youth', label: '15 Minute Energy Session (10 - 14 yrs)', price: 40, duration: 15 },
  { id: 'energy-session-10-child', label: '10 Minute Energy Session (9 yrs + down)', price: 30, duration: 10 },
  { id: 'spiritual-coaching', label: 'Spiritual Coaching', price: 75, duration: 60 },
  { id: 'house-cleansing-blessing', label: 'House Cleansing/Blessing In-Person', price: 80, duration: 60 },
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+-\s+\$\d+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findService(value) {
  const needle = normalize(value);
  if (!needle) return null;
  return SERVICES.find(service => (
    service.id === value ||
    normalize(service.id) === needle ||
    normalize(service.label) === needle ||
    normalize(service.label).includes(needle) ||
    needle.includes(normalize(service.label))
  )) || null;
}

module.exports = { SERVICES, findService };
