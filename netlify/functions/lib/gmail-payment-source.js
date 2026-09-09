'use strict';

const { parsePaymentEmail } = require('./payment-email-parsers');

function requiredConfig(env = process.env) {
  return ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_ACCOUNT'].filter(key => !env[key]);
}
async function accessToken(env = process.env) {
  const body = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Gmail OAuth refresh failed.');
  const json = await response.json();
  if (!json.access_token) throw new Error('Gmail OAuth refresh returned no access token.');
  return json.access_token;
}
async function gmailGet(path, token, params = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Gmail API request failed (${response.status}).`);
  return response.json();
}
function headers(message) { return Object.fromEntries((message.payload?.headers || []).map(header => [String(header.name || '').toLowerCase(), header.value || ''])); }
function decodePart(part) { if (!part?.body?.data) return ''; try { return Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; } }
function htmlText(value) { return String(value || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim(); }
function textParts(part, output = []) { if (!part) return output; if (part.mimeType === 'text/plain') output.push(decodePart(part)); else if (part.mimeType === 'text/html') output.push(htmlText(decodePart(part))); for (const child of part.parts || []) textParts(child, output); return output; }
async function listPaymentMessages({ token, after }) {
  const query = `newer_than:30d {venmo paypal "cash app" zelle stripe}${after ? ` after:${Math.max(0, Math.floor(new Date(after).getTime() / 1000))}` : ''}`;
  const list = await gmailGet('messages', token, { q: query, maxResults: 100 });
  const messages = [];
  for (const row of list.messages || []) {
    const message = await gmailGet(`messages/${encodeURIComponent(row.id)}`, token, { format: 'full' });
    const h = headers(message);
    const input = { message_id: message.id, from: h.from, to: h.to, subject: h.subject, date: h.date, body: textParts(message.payload).join('\n') };
    const parsed = parsePaymentEmail(input);
    messages.push({ parsed, internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : input.date });
  }
  return messages;
}
module.exports = { requiredConfig, accessToken, listPaymentMessages };
