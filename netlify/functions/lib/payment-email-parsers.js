'use strict';

const PROVIDERS = ['venmo', 'paypal', 'cash_app', 'zelle', 'stripe'];
const REF_PATTERNS = [
  /(?:transaction|confirmation|reference|payment|receipt)\s*(?:id|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._-]{5,})/i,
  /\b(?:txn|tx)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._-]{5,})\b/i,
];
const AMOUNT_PATTERNS = [
  /(?:amount|total|sent|received|payment)\s*[:\-]?\s*\$\s*([0-9,]+(?:\.\d{2})?)/i,
  /\$\s*([0-9,]+\.\d{2})/,
];
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-])\d{3}[\s.-]\d{4}/;

function cleanText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
}
function safeMemo(value) {
  const memo = cleanText(value, 500);
  if (!memo) return null;
  if (/(?:card|credit|debit|cvv|cvc|routing|account|bank\s+account|password|passcode|pin)\s*[:#-]?\s*[A-Za-z0-9-]{3,}/i.test(memo) || /\b\d{13,19}\b/.test(memo)) return null;
  return memo;
}
function payerName(value) {
  let name = cleanText(value, 160);
  if (!name) return null;
  name = name.replace(/\s*(?:\(\s*)?(?:transaction details|transaction id|confirmation number|into your account|for any issues|privacy policy|customer support|support hours)[\s\S]*$/i, '').trim();
  if (!name || /^[@#]/.test(name) || /(?:privacy policy|support hours|customer support|for any issues|\baccount\b)/i.test(name)) return null;
  return name;
}
function money(value) { const n = Number(String(value || '').replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null; }
function providerFrom(input) {
  const text = `${input.from || ''} ${input.sender || ''} ${input.subject || ''} ${input.body || ''}`.toLowerCase();
  if (text.includes('venmo')) return 'venmo';
  if (text.includes('paypal')) return 'paypal';
  if (text.includes('cash app') || text.includes('cashapp')) return 'cash_app';
  if (text.includes('zelle')) return 'zelle';
  if (text.includes('stripe')) return 'stripe';
  return null;
}
function referenceFrom(text) { for (const re of REF_PATTERNS) { const m = String(text || '').match(re); if (m?.[1]) return cleanText(m[1], 240); } return null; }
function amountFrom(text) {
  const source = String(text || '');
  for (const re of AMOUNT_PATTERNS) { const m = source.match(re); const n = money(m?.[1]); if (n != null) return n; }
  const providerSubject = source.match(/(?:paid you|sent you|payment received|received payment|payment deposited)[^$]{0,80}\$\s*([0-9,]+(?:\.\d{2})?)/i);
  return money(providerSubject?.[1]);
}
function dateFrom(input, text) { const candidates = [input.transaction_at, input.date, text.match(/\b20\d{2}-\d{2}-\d{2}(?:[T ][0-9:.-]+)?(?:Z|[+-]\d{2}:?\d{2})?\b/)?.[0]]; for (const value of candidates) { if (!value) continue; const d = new Date(value); if (!Number.isNaN(d.getTime())) return d.toISOString(); } return null; }
function payerFrom(input, text) {
  const subject = String(input.subject || '');
  const providerNamed = subject.match(/^(.{2,100}?)\s+(?:paid you|sent you)\s+\$\s*[0-9,]+(?:\.\d{2})?/i)?.[1]
    || text.match(/(?:payment|paid)\s+from\s+([^\n|,.]{2,100})/i)?.[1];
  const named = input.payer_display_name || providerNamed || text.match(/(?:from|sent by|paid by|payer)\s*[:\-]?\s*([^\n|,]{2,80})/i)?.[1];
  const cleaned = payerName(named);
  if (!cleaned || /^(?:your|the|a|payment|transaction|account|venmo|paypal|cash app|zelle|stripe)\b/i.test(cleaned)) return null;
  return cleaned;
}

function parsePaymentEmail(input = {}) {
  const body = String(input.body || '');
  const headerText = `${input.subject || ''} ${input.from || ''} ${input.sender || ''}`;
  const text = `${headerText}\n${body}`;
  const provider = input.provider || providerFrom(input);
  const referenceId = cleanText(input.reference_id || referenceFrom(text), 240);
  const amount = input.amount == null ? amountFrom(text) : money(input.amount);
  const email = cleanText(input.payer_email || text.match(EMAIL)?.[0], 254);
  const phone = cleanText(input.payer_phone || text.match(PHONE)?.[0], 32);
  const memo = safeMemo(input.memo || body.match(/(?:memo|note|message)\s*[:\-]?\s*([^\n]{1,500})/i)?.[1]);
  const parsed = {
    provider: PROVIDERS.includes(provider) ? provider : null,
    provider_reference_id: referenceId,
    payer_display_name: payerFrom(input, text),
    payer_email: email ? email.toLowerCase() : null,
    payer_phone: phone,
    amount,
    transaction_at: dateFrom(input, text),
    memo,
    recipient_context: cleanText(input.recipient_context || input.to, 254),
    source_message_id: cleanText(input.message_id || input.id, 240),
  };
  parsed.valid = Boolean(parsed.provider && parsed.amount && parsed.provider_reference_id);
  parsed.reason = parsed.valid ? null : (!parsed.provider ? 'unsupported_provider' : !parsed.amount ? 'missing_or_invalid_amount' : 'missing_reliable_reference');
  parsed.auto_attach_allowed = parsed.valid && parsed.provider !== 'stripe';
  return parsed;
}

module.exports = { PROVIDERS, parsePaymentEmail, cleanText, money };
