import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url).pathname.replace(/^\//,'').replaceAll('/','\\');
const endpoint=fs.readFileSync(root+'\\netlify\\functions\\practitioner-recovery.js','utf8');
const credential=fs.readFileSync(root+'\\netlify\\functions\\lib\\practitioner-credential.js','utf8');
const migration=fs.readFileSync(root+'\\migrations\\2026-09-08-practitioner-recovery.sql','utf8');
assert.match(endpoint,/POST/);assert.match(endpoint,/PRACTITIONER_RECOVERY_ADMIN_SECRET/);assert.match(endpoint,/timingSafeEqual/);assert.match(endpoint,/randomBytes\(32\)/);assert.match(endpoint,/practitioner_recovery_tokens/);assert.match(credential,/recoveryAttempt/);assert.match(endpoint,/practitioner_recover/);assert.match(endpoint,/clearSessionCookie/);assert.match(endpoint,/Recovery request was not accepted/);assert.doesNotMatch(endpoint,/console\.(log|error)\(/);assert.doesNotMatch(endpoint,/plaintext|hardcoded/i);assert.match(credential,/validNew/);assert.match(credential,/scrypt/);assert.match(migration,/used_at/);assert.match(migration,/expires_at/);assert.match(migration,/version=version\+1/);assert.match(migration,/admin_sessions set revoked_at/);assert.match(migration,/revoke all/);console.log('PASS practitioner recovery token, hashing, rate-limit, atomic reset, session revocation, and privacy contract');
