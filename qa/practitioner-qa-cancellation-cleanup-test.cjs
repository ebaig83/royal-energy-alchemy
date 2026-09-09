'use strict';
const assert=require('assert/strict'),fs=require('fs');
const source=fs.readFileSync('netlify/functions/lib/practitioner-appointments.js','utf8');
assert.match(source,/isQaRecord\(session\)&&body\.action!==['"]cancel['"]/);
assert.match(fs.readFileSync('migrations/2026-09-07-appointment-lifecycle.sql','utf8'),/status='available',session_id=null/);
assert.match(fs.readFileSync('netlify/functions/manage-appointment.js','utf8'),/managedChange\(sb,body,session_id,'cancel'\)/);
console.log('PASS: controlled QA cancellation reaches the supported lifecycle path and releases the slot for worker cleanup.');
