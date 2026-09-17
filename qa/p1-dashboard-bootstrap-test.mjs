import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const api=fs.readFileSync(path.join(root,'dashboard-p1','api.mjs'),'utf8');
const app=fs.readFileSync(path.join(root,'dashboard-p1','app.mjs'),'utf8');

assert.match(api,/AbortController/);
assert.match(api,/setTimeout\(\(\)=>controller\.abort\(\),10000\)/);
assert.match(api,/credentials:'same-origin'/);
assert.match(api,/r\.status===401/);
assert.match(api,/r\.status===403/);
assert.match(api,/finally\{clearTimeout\(timeout\);\}/);
assert.match(app,/function renderLogin/);
assert.match(app,/Password or PIN/);
assert.match(app,/Forgot password\?/);
assert.match(app,/error\.status===401\|\|error\.status===403/);
assert.match(app,/id="retry-bootstrap"/);
assert.match(app,/addEventListener\('click',\(\)=>\{app\.innerHTML=.*start\(\)/);
console.log('PASS bounded bootstrap, stale-session sign-in fallback, 403 handling, retry action, and password label');
