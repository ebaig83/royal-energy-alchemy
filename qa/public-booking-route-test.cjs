const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const redirects = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const booking = fs.readFileSync(path.join(root, 'book.html'), 'utf8');

assert.match(redirects, /from\s*=\s*"\/book"[\s\S]*?to\s*=\s*"\/book\.html"[\s\S]*?status\s*=\s*301/);
assert.doesNotMatch(redirects, /from\s*=\s*"\/book\.html"[\s\S]*?to\s*=\s*"\/#contact"/);
assert.match(booking, /public-service-catalog/);
assert.doesNotMatch(booking, /(?:const|let|var)\s+(?:SERVICES|SERVICE_PRICES|servicePrices)\s*=/i);

console.log('public booking route contract: ok');
