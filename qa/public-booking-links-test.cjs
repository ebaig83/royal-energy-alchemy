const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'site-nav.js', 'client-portal.html', 'pay.html'];
const contents = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

assert.match(contents, /\/book\.html/);
assert.doesNotMatch(contents, /href=["']\/?#contact["']/);
assert.doesNotMatch(contents, /href=["']\/?\/\#contact["']/);

console.log('public booking links contract: ok');
