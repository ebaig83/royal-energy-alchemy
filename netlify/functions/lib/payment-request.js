'use strict';

const PROVIDERS = ['stripe', 'venmo', 'cash_app', 'paypal', 'zelle', 'other'];
const OFF_PLATFORM = ['venmo', 'cash_app', 'paypal', 'zelle', 'other'];
const LABELS = { stripe: 'Stripe secure Checkout', venmo: 'Venmo', cash_app: 'Cash App', paypal: 'PayPal', zelle: 'Zelle', other: 'Other / manual' };
const FIELDS = {
  venmo: ['venmo_enabled', 'venmo_label', 'venmo_destination'],
  cash_app: ['cash_app_enabled', 'cash_app_label', 'cash_app_destination'],
  paypal: ['paypal_enabled', 'paypal_label', 'paypal_destination'],
  zelle: ['zelle_enabled', 'zelle_label', 'zelle_destination'],
  other: ['other_enabled', 'other_label', 'other_destination'],
};
const SENSITIVE = /(?:password|passcode|secret|token|cvv|cvc|card\s*number|bank\s*account|routing\s*number|\bpin\b)/i;

function configuredSettings(row = {}) {
  return Object.fromEntries(Object.entries(FIELDS).map(([provider, [enabled, label, destination]]) => [provider, {
    enabled: row[enabled] === true,
    configured: Boolean(String(row[destination] || '').trim()),
    label: String(row[label] || LABELS[provider]).trim().slice(0, 120),
    destination: String(row[destination] || '').trim().slice(0, 1000),
  }]));
}

function validateSettingsInput(input = {}) {
  const out = {};
  for (const [provider, [enabled, label, destination]] of Object.entries(FIELDS)) {
    if (input[enabled] !== undefined) out[enabled] = input[enabled] === true;
    for (const key of [label, destination]) {
      if (input[key] === undefined) continue;
      const value = String(input[key] || '').trim();
      if (value.length > (key.endsWith('_label') ? 120 : 1000)) throw Error(`${key} is too long.`);
      if (SENSITIVE.test(value)) throw Error('Payment destinations may not contain passwords, tokens, card, bank, PIN, or secret data.');
      out[key] = value || null;
    }
  }
  return out;
}

function validateProvider(provider, settings) {
  const value = String(provider || '').trim().toLowerCase();
  if (!OFF_PLATFORM.includes(value)) throw Error('Payment method is not an off-platform provider.');
  const config = settings?.[value];
  if (!config?.enabled || !config.configured) throw Error(`${LABELS[value]} is not enabled and configured.`);
  return value;
}

function amount(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
function formatAmount(value) { return `$${Number(value || 0).toFixed(2)}`; }
function isSafeReference(value) { return /^REA-[A-Z0-9]{6,12}$/.test(String(value || '')); }

module.exports = { PROVIDERS, OFF_PLATFORM, LABELS, configuredSettings, validateSettingsInput, validateProvider, amount, formatAmount, isSafeReference, _test: { SENSITIVE, FIELDS } };
