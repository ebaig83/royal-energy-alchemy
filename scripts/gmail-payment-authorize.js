'use strict';

// Local-only Gmail authorization helper. Do not deploy this file as a function.
// Required environment variables: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET.
// The refresh token is written to .gmail-payment-oauth.json, which is gitignored.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://127.0.0.1:8787/oauth2callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const OUTPUT = require('node:path').resolve(process.cwd(), '.gmail-payment-oauth.json');

function fail(message) { console.error(message); process.exitCode = 1; }
function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const target = new URL(url);
    const request = https.request({ hostname: target.hostname, path: target.pathname, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch { reject(new Error('Google token response was not JSON.')); } });
    });
    request.on('error', reject);
    request.end(body);
  });
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail('Separate Gmail OAuth client required. Create a Web application client with redirect URI http://127.0.0.1:8787/oauth2callback, then run:');
  console.error('$env:GMAIL_CLIENT_ID = "<gmail-client-id>"');
  console.error('$env:GMAIL_CLIENT_SECRET = "<gmail-client-secret>"');
  console.error('node scripts/gmail-payment-authorize.js');
} else {
  const state = crypto.randomBytes(24).toString('hex');
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: SCOPE, state }).toString();
  const server = http.createServer(async (request, response) => {
    try {
      const callback = new URL(request.url, REDIRECT_URI);
      if (callback.pathname !== '/oauth2callback') { response.writeHead(404); response.end('Not found'); return; }
      if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch.');
      if (callback.searchParams.get('error')) throw new Error(`Google authorization returned ${callback.searchParams.get('error')}.`);
      const code = callback.searchParams.get('code');
      if (!code) throw new Error('Google authorization did not return a code.');
      const token = await postForm('https://oauth2.googleapis.com/token', { code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
      if (token.status < 200 || token.status >= 300 || !token.body.refresh_token) throw new Error('Google did not return a refresh token. Re-run consent with prompt=consent.');
      fs.writeFileSync(OUTPUT, JSON.stringify({ client_id: CLIENT_ID, refresh_token: token.body.refresh_token, token_type: token.body.token_type || 'Bearer', obtained_at: new Date().toISOString() }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      response.end('Gmail authorization complete. You may close this window.');
      console.log(`Gmail authorization complete. Refresh token saved locally to ${OUTPUT}; token value not printed.`);
      server.close(() => process.exit(0));
    } catch (error) {
      response.statusCode = 400;
      response.end('Gmail authorization failed. Check the terminal for a sanitized error.');
      fail(String(error.message || error).slice(0, 240));
      server.close(() => process.exit(1));
    }
  });
  server.listen(8787, '127.0.0.1', () => {
    console.log('Open this URL in the Gmail account owner browser:');
    console.log(authorizationUrl.toString());
    console.log('Requested scope: gmail.readonly only. No send/modify/delete scope requested.');
    console.log('Waiting for the localhost callback on 127.0.0.1:8787 ...');
  });
}
