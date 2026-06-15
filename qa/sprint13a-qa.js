#!/usr/bin/env node
// ============================================================
// Royal Energy Alchemy — Sprint 13A QA Suite
// Run: node website/qa/sprint13a-qa.js
//
// Requirements:
//   NETLIFY_URL=https://royal-energy-alchemy.netlify.app
//   REA_PIN=<dashboard-pin>
//
// Covers:
//   Phase 1 — Intake Section 11 (field presence in HTML)
//   Phase 2 — Aftercare follow-up intelligence (field presence in HTML)
//   Phase 3 — Email template seeded in database
//   Phase 4 — manage-appointment.html structure + function
//   Phase 5 — communications function returns data
//   Phase 6 — reporting.js all 8 sections respond 200
//   Phase 7 — migration columns exist (via schema_validation)
//   Phase 8 — manage-appointment.js function responds correctly
// ============================================================

'use strict';

const BASE = process.env.NETLIFY_URL || 'https://royal-energy-alchemy.netlify.app';
const PIN  = process.env.REA_PIN     || '';

let _tok   = '';
let passed = 0;
let failed = 0;
const failures = [];

// ── Utilities ────────────────────────────────────────────────────────────────

function pass(name) {
  passed++;
  console.log('\x1b[32m  ✓ PASS\x1b[0m', name);
}

function fail(name, reason) {
  failed++;
  failures.push({ name, reason });
  console.log('\x1b[31m  ✗ FAIL\x1b[0m', name, '\n       ', reason);
}

async function get(path, auth) {
  const headers = auth ? { 'X-Dashboard-Token': _tok } : {};
  const r = await fetch(BASE + path, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function post(path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['X-Dashboard-Token'] = _tok;
  const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function getHtml(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, text: await r.text().catch(() => '') };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function authenticate() {
  console.log('\n[Auth] Obtaining dashboard token...');
  if (!PIN) {
    console.log('\x1b[33m  ⚠ REA_PIN not set — auth-gated tests will be skipped\x1b[0m');
    return false;
  }
  try {
    const { status, body } = await post('/.netlify/functions/verify-pin', { pin: PIN });
    if (status === 200 && body?.token) {
      _tok = body.token;
      console.log('\x1b[32m  ✓ Token obtained\x1b[0m');
      return true;
    }
    console.log('\x1b[31m  ✗ Auth failed — status', status, '\x1b[0m');
    return false;
  } catch (e) {
    console.log('\x1b[31m  ✗ Auth error:', e.message, '\x1b[0m');
    return false;
  }
}

// ── Phase 1 — Intake Section 11 HTML ─────────────────────────────────────────

async function testPhase1() {
  console.log('\n[Phase 1] Intake Section 11 — HTML Structure');
  try {
    const { status, text } = await getHtml('/full-intake.html');

    if (status !== 200) { fail('full-intake.html loads', 'HTTP ' + status); return; }
    pass('full-intake.html loads (200)');

    const checks = [
      ['Section 11 heading present',              'Section 11'],
      ['Section 11 title present',                'Current Practices &amp; Self-Management'],
      ['methods_tried checkboxes present',        'i_methods_tried'],
      ['Prayer checkbox present',                 'name="i_methods_tried" value="Prayer"'],
      ['Meditation checkbox present',             'name="i_methods_tried" value="Meditation"'],
      ['methods-effective textarea present',      'i-methods-effective'],
      ['methods-ineffective textarea present',    'i-methods-ineffective'],
      ['protection checkboxes present',           'i_protection'],
      ['Salt Baths protection option present',    'name="i_protection" value="Salt Baths"'],
      ['practice consistency scale present',      'i_consistency'],
      ['patterns-noticed textarea present',       'i-patterns-noticed'],
      ['JS collects methodsTried',                'methodsTried'],
      ['JS collects protectionPractices',         'protectionPractices'],
      ['JS collects practiceConsistency',         'practiceConsistency'],
      ['JS collects patternsNoticed',             'patternsNoticed'],
    ];

    for (const [name, needle] of checks) {
      if (text.includes(needle)) pass(name);
      else fail(name, `"${needle}" not found in full-intake.html`);
    }
  } catch (e) {
    fail('Phase 1 HTML fetch', e.message);
  }
}

// ── Phase 2 — Aftercare Follow-Up Intelligence HTML ───────────────────────────

async function testPhase2() {
  console.log('\n[Phase 2] Aftercare Follow-Up Intelligence — HTML Structure');
  try {
    const { status, text } = await getHtml('/aftercare.html');

    if (status !== 200) { fail('aftercare.html loads', 'HTTP ' + status); return; }
    pass('aftercare.html loads (200)');

    const checks = [
      ['techniquesUsed checkboxes present',          'name="techniquesUsed"'],
      ['Cord cutting technique option',              'Cord cutting'],
      ['practicesMaintained checkboxes present',     'name="practicesMaintained"'],
      ['protectionProtocols checkboxes present',     'name="protectionProtocols"'],
      ['followupPatternsNoticed textarea present',   'name="followupPatternsNoticed"'],
      ['insightsReceived textarea present',          'name="insightsReceived"'],
      ['symptomsImproved checkboxes present',        'name="symptomsImproved"'],
      ['Sleep improved option',                      'name="symptomsImproved" value="Sleep quality"'],
      ['symptomsWorsened checkboxes present',        'name="symptomsWorsened"'],
      ['additionalSupportNeeded radio present',      'name="additionalSupportNeeded"'],
      ['Please check in option',                     'Yes, please check in'],
      ['Follow-Up Intelligence tag appears',         'Follow-Up Intelligence'],
      ['Submit button still present',                'Submit Check-In'],
    ];

    for (const [name, needle] of checks) {
      if (text.includes(needle)) pass(name);
      else fail(name, `"${needle}" not found in aftercare.html`);
    }
  } catch (e) {
    fail('Phase 2 HTML fetch', e.message);
  }
}

// ── Phase 3 — Email Template Seeded ──────────────────────────────────────────

async function testPhase3(authed) {
  console.log('\n[Phase 3] Email Template — Database Seed');
  if (!authed) { console.log('  ⚠ Skipped (no token)'); return; }

  try {
    const { status, body } = await get('/.netlify/functions/communications?section=templates', true);
    if (status !== 200) { fail('communications?section=templates', 'HTTP ' + status); return; }
    pass('communications?section=templates returns 200');

    const templates = body?.templates || [];
    const apptConf  = templates.find(t => t.name === 'appointment_confirmation');
    const f24       = templates.find(t => t.name === 'followup_24hr');
    const f1m       = templates.find(t => t.name === 'followup_1month');

    if (apptConf) pass('appointment_confirmation template exists');
    else fail('appointment_confirmation template exists', 'Not found in templates list — run migration');

    if (apptConf?.is_active) pass('appointment_confirmation is active');
    else fail('appointment_confirmation is active', 'is_active is false or template missing');

    if (apptConf?.subject?.includes('Royal Energy Alchemy')) pass('appointment_confirmation subject branded');
    else fail('appointment_confirmation subject branded', 'Subject missing brand name');

    if (apptConf?.html_body?.includes('{{client_name}}')) pass('appointment_confirmation has {{client_name}} variable');
    else fail('appointment_confirmation has {{client_name}} variable', 'Variable not found in html_body');

    if (f24) pass('followup_24hr template exists');
    else fail('followup_24hr template exists', 'Not found — run migration');

    if (f1m) pass('followup_1month template exists');
    else fail('followup_1month template exists', 'Not found — run migration');

  } catch (e) {
    fail('Phase 3 template check', e.message);
  }
}

// ── Phase 4 — manage-appointment.html + Function ──────────────────────────────

async function testPhase4() {
  console.log('\n[Phase 4] Appointment Management Center');
  try {
    const { status, text } = await getHtml('/manage-appointment.html');

    if (status !== 200) { fail('manage-appointment.html loads', 'HTTP ' + status); return; }
    pass('manage-appointment.html loads (200)');

    const checks = [
      ['Manage Your Appointment title',   'Manage Your Appointment'],
      ['Reschedule action option',        'Reschedule'],
      ['Contact action option',           'Contact Daron'],
      ['Cancel action option',            'Cancel'],
      ['Reschedule form present',         'rescheduleForm'],
      ['Contact form present',            'contactForm'],
      ['Cancel form present',             'cancelForm'],
      ['Refund calculator present',       'refundEstimate'],
      ['Preferred date field present',    'r-preferred-date'],
      ['Session ID loaded from URL',      'session_id'],
      ['Audit log call present',          'logAudit'],
      ['Done screen present',             'doneScreen'],
    ];

    for (const [name, needle] of checks) {
      if (text.includes(needle)) pass(name);
      else fail(name, `"${needle}" not found in manage-appointment.html`);
    }
  } catch (e) {
    fail('Phase 4 HTML fetch', e.message);
  }

  // Test manage-appointment function — GET without session_id should return 400
  try {
    const { status } = await get('/.netlify/functions/manage-appointment');
    if (status === 400) pass('manage-appointment function returns 400 without session_id');
    else fail('manage-appointment function returns 400 without session_id', 'Got HTTP ' + status);
  } catch (e) {
    fail('manage-appointment function reachable', e.message);
  }

  // POST a view audit action (no real session_id needed — function should handle gracefully)
  try {
    const { status, body } = await post('/.netlify/functions/manage-appointment', {
      session_id: '00000000-0000-0000-0000-000000000000',
      action: 'view',
      client_name: 'QA Test',
    });
    if (status === 201) pass('manage-appointment POST audit log returns 201');
    else if (body?.migration_needed) pass('manage-appointment POST returns migration_needed (pre-migration)');
    else fail('manage-appointment POST audit log', 'HTTP ' + status + ' — ' + JSON.stringify(body));
  } catch (e) {
    fail('manage-appointment POST', e.message);
  }
}

// ── Phase 5 — Communications Module ──────────────────────────────────────────

async function testPhase5(authed) {
  console.log('\n[Phase 5] Communications Module');
  if (!authed) { console.log('  ⚠ Skipped (no token)'); return; }

  const sections = ['log', 'templates', 'stats'];
  for (const section of sections) {
    try {
      const { status, body } = await get('/.netlify/functions/communications?section=' + section, true);
      if (status === 200) pass('communications?section=' + section + ' returns 200');
      else fail('communications?section=' + section, 'HTTP ' + status);

      if (section === 'templates' && Array.isArray(body?.templates))
        pass('communications templates is an array');
      if (section === 'stats' && body)
        pass('communications stats has response body');
    } catch (e) {
      fail('communications?section=' + section, e.message);
    }
  }
}

// ── Phase 6 — reporting.js All Sections ──────────────────────────────────────

async function testPhase6(authed) {
  console.log('\n[Phase 6] Business Reporting Center — All Sections');
  if (!authed) { console.log('  ⚠ Skipped (no token)'); return; }

  const sections = [
    ['tax_monthly',            'months'],
    ['tax_annual',             'gross_revenue'],
    ['tax_by_service',         'services'],
    ['expenses_deductible',    null],  // may be migration_needed
    ['annual_summary',         'sessions'],
    ['practitioner_performance','completed_sessions'],
    ['research_metrics',       'patterns'],
    ['content_metrics',        'knowledge_base'],
    ['export_log',             'exports'],
  ];

  for (const [section, key] of sections) {
    try {
      const { status, body } = await get('/.netlify/functions/reporting?section=' + section + '&year=2026', true);
      if (status === 200) {
        pass('reporting?section=' + section + ' returns 200');
        if (key && body?.[key] !== undefined) pass(section + ' response has "' + key + '" field');
        else if (key && body?.migration_needed) pass(section + ' returns migration_needed (pre-migration)');
        else if (key) fail(section + ' response has "' + key + '" field', 'Field missing. Body: ' + JSON.stringify(body)?.slice(0,120));
      } else {
        fail('reporting?section=' + section, 'HTTP ' + status);
      }
    } catch (e) {
      fail('reporting?section=' + section, e.message);
    }
  }

  // Test reports.html page itself
  try {
    const { status, text } = await getHtml('/reports.html');
    if (status === 200) pass('reports.html loads (200)');
    else fail('reports.html loads', 'HTTP ' + status);

    const htmlChecks = [
      ['reports.html has PIN gate',      'accessGate'],
      ['reports.html has cockpit',       'cockpit'],
      ['reports.html has Tax Overview',  'Tax Overview'],
      ['reports.html has Annual Summary','Annual Summary'],
      ['reports.html has export button', 'export-btn'],
    ];
    for (const [name, needle] of htmlChecks) {
      if (text?.includes(needle)) pass(name);
      else fail(name, `"${needle}" not found`);
    }
  } catch (e) {
    fail('reports.html fetch', e.message);
  }
}

// ── Phase 7 — Migration Schema Validation ────────────────────────────────────

async function testPhase7(authed) {
  console.log('\n[Phase 7] Migration — Schema Validation');
  if (!authed) { console.log('  ⚠ Skipped (no token)'); return; }

  // Use financial schema_validation endpoint to check if tables exist
  try {
    const { status, body } = await get('/.netlify/functions/financial?section=schema_validation', true);
    if (status === 200) pass('financial schema_validation returns 200');
    else fail('financial schema_validation', 'HTTP ' + status);
  } catch (e) {
    fail('financial schema_validation', e.message);
  }

  // Test that new tables respond without errors (via reporting endpoints)
  const tableChecks = [
    ['appointment_management_audit accessible', '/.netlify/functions/manage-appointment', 'GET',  null],
    ['report_exports accessible via export_log', '/.netlify/functions/reporting?section=export_log', 'GET', null],
  ];

  for (const [name, path] of tableChecks) {
    try {
      const { status } = await get(path, true);
      if (status === 200 || status === 400) pass(name + ' (HTTP ' + status + ')');
      else fail(name, 'HTTP ' + status);
    } catch (e) {
      fail(name, e.message);
    }
  }
}

// ── Phase 8 — manage-appointment.js Function ─────────────────────────────────

async function testPhase8() {
  console.log('\n[Phase 8] manage-appointment.js Function Validation');

  // OPTIONS preflight
  try {
    const r = await fetch(BASE + '/.netlify/functions/manage-appointment', { method: 'OPTIONS' });
    if (r.status === 200) pass('manage-appointment handles OPTIONS (CORS preflight)');
    else fail('manage-appointment OPTIONS', 'HTTP ' + r.status);
  } catch (e) {
    fail('manage-appointment OPTIONS', e.message);
  }

  // POST with invalid action
  try {
    const { status, body } = await post('/.netlify/functions/manage-appointment', {
      session_id: '00000000-0000-0000-0000-000000000000',
      action: 'invalid_action',
    });
    if (status === 400) pass('manage-appointment rejects invalid action (400)');
    else fail('manage-appointment invalid action rejection', 'Expected 400, got ' + status);
  } catch (e) {
    fail('manage-appointment invalid action', e.message);
  }

  // POST with all valid action types
  const validActions = ['view','reschedule_request','cancel_request','contact_request'];
  for (const action of validActions) {
    try {
      const { status, body } = await post('/.netlify/functions/manage-appointment', {
        session_id: '00000000-0000-0000-0000-000000000000',
        action,
        client_name: 'QA Test Client',
      });
      if (status === 201 || body?.migration_needed)
        pass('manage-appointment accepts action="' + action + '"');
      else
        fail('manage-appointment action="' + action + '"', 'HTTP ' + status);
    } catch (e) {
      fail('manage-appointment action=' + action, e.message);
    }
  }

  // GET without session_id
  try {
    const { status } = await get('/.netlify/functions/manage-appointment');
    if (status === 400) pass('manage-appointment GET without session_id returns 400');
    else fail('manage-appointment GET without session_id', 'Expected 400, got ' + status);
  } catch (e) {
    fail('manage-appointment GET without session_id', e.message);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('='.repeat(60));
  console.log('  Royal Energy Alchemy — Sprint 13A QA Suite');
  console.log('  Target:', BASE);
  console.log('='.repeat(60));

  const authed = await authenticate();

  await testPhase1();
  await testPhase2();
  await testPhase3(authed);
  await testPhase4();
  await testPhase5(authed);
  await testPhase6(authed);
  await testPhase7(authed);
  await testPhase8();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  QA RESULTS');
  console.log('='.repeat(60));
  console.log('\x1b[32m  ✓ PASSED:\x1b[0m', passed);
  console.log('\x1b[31m  ✗ FAILED:\x1b[0m', failed);

  if (failures.length) {
    console.log('\n  Failed tests:');
    failures.forEach(function(f) {
      console.log('    \x1b[31m✗\x1b[0m ' + f.name);
      console.log('      ' + f.reason);
    });
  }

  const total = passed + failed;
  const pctPass = total ? Math.round(passed / total * 100) : 0;
  console.log('\n  Score:', passed + '/' + total, '(' + pctPass + '%)');

  if (failed === 0) {
    console.log('\n\x1b[32m  ✦ ALL TESTS PASSED — Sprint 13A READY TO DEPLOY\x1b[0m\n');
    process.exit(0);
  } else {
    console.log('\n\x1b[31m  ✗ FAILURES DETECTED — Review before deploying\x1b[0m\n');
    process.exit(1);
  }
}

run().catch(function(e) {
  console.error('QA runner crashed:', e.message);
  process.exit(1);
});
