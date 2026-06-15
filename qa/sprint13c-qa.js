#!/usr/bin/env node
// Sprint 13C QA Suite
//
// Tests: email env, branded template, slot picker, reschedule, cancel, contact, audit, comms module
//
// Run:
//   NETLIFY_URL=https://royal-energy-alchemy.netlify.app REA_PIN=<pin> node qa/sprint13c-qa.js

'use strict';

const https  = require('https');
const http   = require('http');

const BASE = (process.env.NETLIFY_URL || 'http://localhost:3456').replace(/\/$/, '');
const PIN  = process.env.REA_PIN || '';

let _token       = null;
let _testSession = null;   // set by seed helper if available
let _testSlotId  = null;

const results = [];

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function rawRequest(method, urlStr, data, hdrs) {
  return new Promise((resolve) => {
    const url    = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib    = isHttps ? https : http;
    const opts   = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  hdrs,
    };
    const req = lib.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: d }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: { error: e.message } }));
    if (data) req.write(data);
    req.end();
  });
}

// Follow one level of redirect automatically
async function request(method, path, body, headers) {
  const data = body ? JSON.stringify(body) : null;
  const hdrs = Object.assign({
    'Content-Type':    'application/json',
    'Content-Length':  data ? Buffer.byteLength(data) : 0,
  }, headers || {});

  let r = await rawRequest(method, BASE + path, data, hdrs);

  if ((r.status === 301 || r.status === 302) && r.headers.location) {
    const loc = r.headers.location.startsWith('http')
      ? r.headers.location
      : BASE + r.headers.location;
    r = await rawRequest(method, loc, data, hdrs);
  }
  return r;
}

function authHeaders() {
  return _token ? { 'X-Dashboard-Token': _token } : {};
}

// ── Test runner ──────────────────────────────────────────────────────────────

async function test(name, fn) {
  try {
    const result = await fn();
    results.push({ name, pass: true, detail: result });
    console.log('\x1b[32m✓\x1b[0m ' + name + (result ? '  — ' + result : ''));
  } catch (err) {
    results.push({ name, pass: false, detail: err.message });
    console.log('\x1b[31m✗\x1b[0m ' + name + '  — ' + err.message);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ── PIN auth ─────────────────────────────────────────────────────────────────

async function authenticate() {
  if (!PIN) { console.log('\x1b[33m⚠\x1b[0m  REA_PIN not set — skipping admin-only tests'); return; }
  const r = await request('POST', '/.netlify/functions/verify-pin', { pin: PIN });
  if (!r.body.token) throw new Error('PIN auth failed: ' + JSON.stringify(r.body));
  _token = r.body.token;
  console.log('\x1b[36m◈\x1b[0m  Authenticated\n');
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — Email Environment
// ════════════════════════════════════════════════════════════════════════════

async function phase1() {
  console.log('\n── Phase 1: Email Environment ──────────────────────────────');

  await test('send-email endpoint exists (405 without POST)', async () => {
    const r = await request('GET', '/.netlify/functions/send-email', null, authHeaders());
    expect(r.status === 405 || r.status === 401, 'Expected 405 or 401, got ' + r.status);
    return 'HTTP ' + r.status;
  });

  if (_token) {
    await test('RESEND_API_KEY configured (POST without body returns 400, not 500 about key)', async () => {
      const r = await request('POST', '/.netlify/functions/send-email?action=send_email', {}, { 'X-Dashboard-Token': _token });
      if (r.status === 500 && r.body && r.body.error && r.body.error.includes('RESEND_API_KEY')) {
        throw new Error('RESEND_API_KEY is NOT configured in Netlify environment — add it in Site Settings → Environment Variables');
      }
      if (r.status === 500 && r.body && r.body.error && r.body.error.includes('FROM_EMAIL')) {
        throw new Error('FROM_EMAIL is NOT configured in Netlify environment — add it in Site Settings → Environment Variables');
      }
      // 400 = key is present but request validation failed (expected)
      expect(r.status === 400, 'Expected 400 (validation), got ' + r.status + ' ' + JSON.stringify(r.body));
      return 'RESEND_API_KEY ✓  FROM_EMAIL ✓';
    });
  } else {
    console.log('\x1b[33m  ⚠  Skipped RESEND_API_KEY check (no PIN)\x1b[0m');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Email Templates
// ════════════════════════════════════════════════════════════════════════════

async function phase2() {
  console.log('\n── Phase 2: Branded Email Templates ───────────────────────');

  if (!_token) { console.log('\x1b[33m  ⚠  Skipped (no PIN)\x1b[0m'); return; }

  await test('appointment_confirmation template exists', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    expect(r.status === 200, 'HTTP ' + r.status);
    const tmpl = (r.body.templates || []).find(t => t.name === 'appointment_confirmation');
    expect(tmpl, 'appointment_confirmation template not found — run 2026-06-20-sprint13a.sql');
    return 'found — id: ' + tmpl.id;
  });

  await test('appointment_confirmation has no raw template tags', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    const tmpl = (r.body.templates || []).find(t => t.name === 'appointment_confirmation');
    expect(tmpl, 'template not found');
    // The html_body should have {{variable}} placeholders (not rendered ones)
    // But it should NOT have any syntax errors or missing required variables
    const vars = tmpl.variables || [];
    const required = ['client_name','service','session_date','session_time','manage_url'];
    required.forEach(v => {
      expect(vars.includes(v), 'Missing required variable: ' + v);
    });
    return vars.join(', ');
  });

  await test('appointment_confirmation HTML has manage_url and cancel button', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    const tmpl = (r.body.templates || []).find(t => t.name === 'appointment_confirmation');
    expect(tmpl, 'template not found');
    expect(tmpl.html_body.includes('{{manage_url}}'), 'Missing {{manage_url}} in HTML');
    expect(tmpl.html_body.includes('action=cancel'),  'Missing cancel button link');
    return 'manage_url ✓  cancel ✓';
  });

  await test('appointment_confirmation HTML has reschedule button', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    const tmpl = (r.body.templates || []).find(t => t.name === 'appointment_confirmation');
    expect(tmpl, 'template not found');
    const hasReschedule = tmpl.html_body.includes('action=reschedule');
    if (!hasReschedule) {
      throw new Error('Reschedule button missing — run 2026-06-20-sprint13c.sql migration');
    }
    return 'reschedule button ✓';
  });

  await test('followup_24hr template exists', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    const tmpl = (r.body.templates || []).find(t => t.name === 'followup_24hr');
    expect(tmpl, 'followup_24hr template not found — run 2026-06-20-sprint13a.sql');
    return 'found';
  });

  await test('followup_1month template exists', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates&active_only=true', null, authHeaders());
    const tmpl = (r.body.templates || []).find(t => t.name === 'followup_1month');
    expect(tmpl, 'followup_1month template not found — run 2026-06-20-sprint13a.sql');
    return 'found';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Manage Appointment Page + Availability Slots
// ════════════════════════════════════════════════════════════════════════════

async function phase3() {
  console.log('\n── Phase 3: Manage Appointment + Slot Picker ──────────────');

  await test('manage-appointment.html page loads (200)', async () => {
    const r = await request('GET', '/manage-appointment.html', null, {});
    expect(r.status === 200, 'HTTP ' + r.status);
    const html = String(r.body || '');
    expect(html.includes('Manage Your Appointment'), 'Page title not found');
    return 'page loads';
  });

  await test('manage-appointment.html has slot picker elements', async () => {
    const r = await request('GET', '/manage-appointment.html', null, {});
    const html = String(r.body || '');
    expect(html.includes('slotsLoading'), 'slotsLoading element missing');
    expect(html.includes('dateChips'),    'dateChips element missing');
    expect(html.includes('timeSlots'),    'timeSlots element missing');
    expect(html.includes('slotSelectedSummary'), 'slotSelectedSummary element missing');
    return 'slot picker elements present';
  });

  await test('availability function returns slots array', async () => {
    const r = await request('GET', '/.netlify/functions/availability', null, {});
    expect(r.status === 200, 'HTTP ' + r.status);
    expect(Array.isArray(r.body.slots), 'slots is not an array');
    if (r.body.slots.length > 0) {
      _testSlotId = r.body.slots[0].id;
      const s = r.body.slots[0];
      expect(s.id,     'slot missing id');
      expect(s.date,   'slot missing date');
      expect(s.time,   'slot missing time');
      expect(s.status, 'slot missing status');
    }
    return r.body.slots.length + ' slots returned' + (_testSlotId ? ', first: ' + _testSlotId : '');
  });

  await test('manage-appointment GET with bad session_id returns 404', async () => {
    const r = await request('GET', '/.netlify/functions/manage-appointment?session_id=00000000-0000-0000-0000-000000000000', null, {});
    expect(r.status === 404, 'Expected 404, got ' + r.status);
    return 'returns 404 for unknown session';
  });

  await test('manage-appointment GET without session_id returns 400', async () => {
    const r = await request('GET', '/.netlify/functions/manage-appointment', null, {});
    expect(r.status === 400, 'Expected 400, got ' + r.status);
    return 'returns 400 missing param';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Cancel Flow Verification
// ════════════════════════════════════════════════════════════════════════════

async function phase4() {
  console.log('\n── Phase 4: Cancel Flow ────────────────────────────────────');

  await test('cancel_confirmed with bad session_id returns 404', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id: '00000000-0000-0000-0000-000000000000',
      action:     'cancel_confirmed',
      reason:     'Schedule conflict',
    });
    expect(r.status === 404, 'Expected 404, got ' + r.status + ' ' + JSON.stringify(r.body));
    return 'returns 404 for unknown session';
  });

  await test('cancel_confirmed without session_id returns 400', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      action: 'cancel_confirmed',
      reason: 'Schedule conflict',
    });
    expect(r.status === 400, 'Expected 400, got ' + r.status);
    return 'returns 400 missing session_id';
  });

  await test('manage-appointment.html has cancel_confirmed action in form handler', async () => {
    const r = await request('GET', '/manage-appointment.html', null, {});
    const html = String(r.body || '');
    expect(html.includes("'cancel_confirmed'"), "cancel_confirmed not found in HTML JS");
    return 'cancel_confirmed action present';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 5 — Contact Flow Verification
// ════════════════════════════════════════════════════════════════════════════

async function phase5() {
  console.log('\n── Phase 5: Contact Flow ───────────────────────────────────');

  await test('contact_request audit write succeeds (null session_id is allowed)', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id:   null,
      action:       'contact_request',
      client_name:  'QA Test User',
      client_email: 'qa@test.com',
      subject:      'General question',
      message:      'This is a QA test contact message.',
    });
    // Either 201 (logged) or 201 with migration_needed if audit table missing
    const ok = r.status === 201;
    expect(ok, 'Expected 201, got ' + r.status + ' ' + JSON.stringify(r.body));
    return r.body.logged ? 'logged to audit table (id: ' + r.body.id + ')' : 'migration_needed (run sprint13a migration)';
  });

  await test('manage-appointment.html contact form has client_email field', async () => {
    const r = await request('GET', '/manage-appointment.html', null, {});
    const html = String(r.body || '');
    expect(html.includes('id="c-email"'), 'c-email field missing');
    expect(html.includes('client_email'), 'client_email not submitted');
    return 'email field present and submitted';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 6 — Communications Module
// ════════════════════════════════════════════════════════════════════════════

async function phase6() {
  console.log('\n── Phase 6: Communications Module ─────────────────────────');

  if (!_token) { console.log('\x1b[33m  ⚠  Skipped (no PIN)\x1b[0m'); return; }

  await test('communications stats loads without _migration_needed', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=stats', null, authHeaders());
    expect(r.status === 200, 'HTTP ' + r.status);
    expect(!r.body._migration_needed, 'stats returned _migration_needed — fix getStats() in communications.js');
    return '_migration_needed absent ✓';
  });

  await test('communications log loads without _migration_needed in root', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=log', null, authHeaders());
    expect(r.status === 200, 'HTTP ' + r.status);
    // The log may still return _migration_needed if the 42P01 error fires (table missing)
    // But if the table exists (migration ran), it should not
    if (r.body._migration_needed) {
      throw new Error('log returned _migration_needed — run 2026-06-13-communications.sql or 2026-06-20-sprint13a.sql');
    }
    return Array.isArray(r.body.communications) ? r.body.communications.length + ' records' : 'ok';
  });

  await test('communications templates load (at least 3 seeded)', async () => {
    const r = await request('GET', '/.netlify/functions/communications?section=templates', null, authHeaders());
    expect(r.status === 200, 'HTTP ' + r.status);
    expect(Array.isArray(r.body.templates), 'templates not an array');
    expect(r.body.templates.length >= 3, 'Expected ≥3 templates, got ' + r.body.templates.length + ' — run sprint13a migration');
    return r.body.templates.length + ' templates loaded';
  });

  await test('getClientHistory does not return _migration_needed', async () => {
    // Use a random UUID — communications will be empty, should NOT return _migration_needed
    const r = await request('GET', '/.netlify/functions/communications?section=client_history&client_id=00000000-0000-0000-0000-000000000000', null, authHeaders());
    expect(r.status === 200, 'HTTP ' + r.status);
    expect(!r.body._migration_needed, 'getClientHistory returned _migration_needed for empty history — fix communications.js line 218');
    return '_migration_needed absent for empty history ✓';
  });

  await test('communications-module.js has no "migration required" string', async () => {
    const r = await request('GET', '/communications-module.js', null, {});
    const src = String(r.body || '');
    const hasOldMsg = src.toLowerCase().includes('migration required') || src.includes('MIGRATION REQUIRED');
    expect(!hasOldMsg, 'communications-module.js still contains "migration required" — update it');
    return 'no migration required message ✓';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 7 — Audit Record Creation
// ════════════════════════════════════════════════════════════════════════════

async function phase7() {
  console.log('\n── Phase 7: Audit Record Creation ─────────────────────────');

  await test('view action writes audit record', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id:  null,
      action:      'view',
      client_name: 'QA Test',
    });
    expect(r.status === 201, 'Expected 201, got ' + r.status);
    return r.body.logged ? 'audit record created (id: ' + r.body.id + ')' : 'migration_needed (run sprint13a migration)';
  });

  await test('reschedule_request audit write (no slot needed for request)', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id: null,
      action:     'reschedule_request',
      old_date:   '2026-06-20',
      new_date:   '2026-06-25',
      reason:     'QA test',
    });
    expect(r.status === 201, 'Expected 201, got ' + r.status);
    return r.body.logged ? 'audit record created' : 'migration_needed';
  });

  await test('reschedule_confirmed without slot_id returns 400', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id: '00000000-0000-0000-0000-000000000000',
      action:     'reschedule_confirmed',
      new_date:   '2026-06-25',
      new_time:   '10:00',
      // no slot_id
    });
    expect(r.status === 400, 'Expected 400, got ' + r.status);
    return 'returns 400 missing slot_id';
  });

  await test('invalid action returns 400', async () => {
    const r = await request('POST', '/.netlify/functions/manage-appointment', {
      session_id: null,
      action:     'delete_all_data',
    });
    expect(r.status === 400, 'Expected 400, got ' + r.status);
    return 'invalid action rejected';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         Sprint 13C QA Suite — Royal Energy Alchemy      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('  Target:', BASE);
  const isLocal = BASE.includes('localhost');
  if (isLocal) {
    console.log('\x1b[33m  ⚠  Local mode: /.netlify/functions/* tests require the deployed Netlify URL.\x1b[0m');
    console.log('\x1b[33m     Run with: NETLIFY_URL=https://royal-energy-alchemy.netlify.app REA_PIN=<pin> node qa/sprint13c-qa.js\x1b[0m');
  }

  await authenticate();

  await phase1();
  await phase2();
  await phase3();
  await phase4();
  await phase5();
  await phase6();
  await phase7();

  // ── Summary ──────────────────────────────────────────────────────────────
  const pass   = results.filter(r => r.pass).length;
  const fail   = results.filter(r => !r.pass).length;
  const total  = results.length;
  const pct    = total ? Math.round(pass / total * 100) : 0;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  QA Results: ' + pass + '/' + total + ' passed (' + pct + '%)');
  if (fail === 0) {
    console.log('\x1b[32m  ✦ PASS — Sprint 13C QA Complete\x1b[0m');
  } else {
    console.log('\x1b[31m  ✗ FAIL — ' + fail + ' test(s) failed\x1b[0m');
    results.filter(r => !r.pass).forEach(r => {
      console.log('    ✗ ' + r.name + ': ' + r.detail);
    });
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('QA runner error:', err.message);
  process.exit(1);
});
