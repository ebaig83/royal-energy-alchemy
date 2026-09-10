'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'book.html'), 'utf8');
assert.match(source, /public-service-catalog/);
assert.match(source, /loadCatalog\(\)/);
assert.match(source, /Retry loading services/);
assert.match(source, /service\.publicBookable === true/);
assert.match(source, /grid\.children\.length !== 11/);
assert.match(source, /state\.service = svc\.id/);
assert.match(source, /Number\(svc\.price\)\.toFixed\(2\)/);
assert.doesNotMatch(source, /const SERVICES\s*=\s*\[/);
assert.doesNotMatch(source, /implant-parasite-removal.*\$100/);
assert.doesNotMatch(source, /heavy-duty-removal.*Exorcism.*Emergency/);
assert.match(source, /failed|invalid|Unable to load services/);
console.log('PASS public booking catalog loading, rendering, failure, retry, and no-hardcoded-map contract');
