#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Royal Energy Alchemy — QA Agent
//
// Usage:
//   node qa/qa-agent.js
//   npm run qa
//
// Required — copy qa/.env.example → qa/.env and fill in values:
//   QA_SITE_URL       e.g. https://royal-energy-alchemy.netlify.app
//   QA_SUPABASE_URL   your Supabase project URL
//   QA_SUPABASE_ANON  Supabase anon key (public)
//   QA_ADMIN_EMAIL    Daron's login email
//   QA_ADMIN_PASSWORD Daron's login password
//
// Optional:
//   QA_VERBOSE=1      print full response bodies on failure
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

// ── Load qa/.env ──────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
}

const SITE_URL    = (process.env.QA_SITE_URL    || '').replace(/\/$/, '');
const SB_URL      = process.env.QA_SUPABASE_URL  || '';
const SB_ANON     = process.env.QA_SUPABASE_ANON || '';
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL    || '';
const ADMIN_PASS  = process.env.QA_ADMIN_PASSWORD || '';
const VERBOSE     = process.env.QA_VERBOSE === '1';

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

// ── Result store ──────────────────────────────────────────────────────────────
const results = [];

function record(name, status, detail) {
  detail = detail || {};
  results.push(Object.assign({ name, status }, detail));

  const icon = status === 'pass'
    ? `${C.green}${C.bold}PASS${C.reset}`
    : status === 'skip'
      ? `${C.yellow}${C.bold}SKIP${C.reset}`
      : `${C.red}${C.bold}FAIL${C.reset}`;

  console.log(`  ${icon}  ${C.bold}${name}${C.reset}`);

  if (status !== 'pass') {
    if (detail.error)       console.log(`        ${C.red}Error:${C.reset}        ${detail.error}`);
    if (detail.likelyCause) console.log(`        ${C.yellow}Likely cause:${C.reset} ${detail.likelyCause}`);
    if (detail.file)        console.log(`        ${C.cyan}File/table:${C.reset}   ${detail.file}`);
    if (detail.fix)         console.log(`        ${C.grey}Fix:${C.reset}          ${detail.fix}`);
  }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiCall(urlPath, opts, token) {
  opts  = opts  || {};
  token = token || '';
  const url = SITE_URL + '/.netlify/functions' + urlPath;
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {},
      opts.headers || {}
    ),
  }));
  let body;
  try { body = await res.json(); } catch (e) { body = {}; }
  if (VERBOSE && res.status >= 400) {
    console.log(`        ${C.grey}Response (${res.status}):${C.reset}`, JSON.stringify(body));
  }
  return { status: res.status, body };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  Royal Energy Alchemy — QA Agent${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}\n`);

  // ── [0] Pre-flight ──────────────────────────────────────────────────────────
  console.log(`${C.bold}[0] Pre-flight — env vars${C.reset}`);
  const missing = [
    ['QA_SITE_URL',       SITE_URL],
    ['QA_SUPABASE_URL',   SB_URL],
    ['QA_SUPABASE_ANON',  SB_ANON],
    ['QA_ADMIN_EMAIL',    ADMIN_EMAIL],
    ['QA_ADMIN_PASSWORD', ADMIN_PASS],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    missing.forEach(k => record(`Env var: ${k}`, 'fail', {
      error:       `${k} is not set`,
      likelyCause: 'Missing qa/.env or export',
      file:        'qa/.env  (copy from qa/.env.example)',
      fix:         `Add ${k}=<value> to qa/.env`,
    }));
    return printSummary();
  }
  record('All env vars present', 'pass');

  // ── [1] Auth gate ───────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[1] Auth gate${C.reset}`);
  let token = '';

  try {
    const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    if (error) throw new Error(error.message);
    token = data.session.access_token;
    record('Supabase sign-in succeeds', 'pass');
  } catch (e) {
    record('Supabase sign-in', 'fail', {
      error:       e.message,
      likelyCause: 'Wrong credentials, or user not in Supabase Auth',
      file:        'Supabase → Authentication → Users',
      fix:         'Confirm droyal168@gmail.com exists in Supabase Auth with correct password',
    });
    return printSummary();
  }

  try {
    const { status } = await apiCall('/clients');
    assert(status === 401, `Expected 401, got ${status}`);
    record('Unauthenticated request blocked (401)', 'pass');
  } catch (e) {
    record('Unauthenticated request blocked (401)', 'fail', {
      error:       e.message,
      likelyCause: 'requireAdmin() not enforcing auth header check',
      file:        'netlify/functions/lib/auth.js',
      fix:         'Verify requireAdmin() returns 401 when Authorization header is absent',
    });
  }

  // ── [2] Load clients ────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[2] Clients API — load${C.reset}`);
  try {
    const { status, body } = await apiCall('/clients', {}, token);
    if (body.error && body.error.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not set in Netlify env vars');
    }
    assert(status === 200, `HTTP ${status} — ${body.error || JSON.stringify(body)}`);
    assert(Array.isArray(body.clients), 'Response missing clients array');
    record(`Load clients — ${body.clients.length} returned`, 'pass');
  } catch (e) {
    const isPermDenied = e.message.toLowerCase().includes('permission denied');
    record('Load clients (GET /clients)', 'fail', {
      error:       e.message,
      likelyCause: isPermDenied
        ? 'service_role lacks table-level GRANTs on clients'
        : 'API error or missing env var',
      file:        isPermDenied
        ? 'supabase/fix_service_role_grants.sql'
        : 'Netlify → Site config → Environment variables',
      fix:         isPermDenied
        ? 'Run supabase/fix_service_role_grants.sql in Supabase SQL Editor'
        : 'Check SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Netlify env vars',
    });
  }

  // ── [3] Table permissions ───────────────────────────────────────────────────
  console.log(`\n${C.bold}[3] Table permissions${C.reset}`);
  try {
    const { status, body } = await apiCall('/clients', {}, token);
    assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
    record('service_role has SELECT on clients', 'pass');
  } catch (e) {
    record('service_role has SELECT on clients', 'fail', {
      error:       e.message,
      likelyCause: 'GRANT not applied to service_role',
      file:        'supabase/fix_service_role_grants.sql',
      fix:         'Run fix_service_role_grants.sql in Supabase SQL Editor, then re-test',
    });
  }

  // ── [4] Create client ───────────────────────────────────────────────────────
  console.log(`\n${C.bold}[4] Create client${C.reset}`);
  const testName = `QA Test Client ${Date.now()}`;
  let createdId  = null;

  try {
    const { status, body } = await apiCall('/clients', {
      method: 'POST',
      body:   JSON.stringify({ full_name: testName, email: 'qa-test@rea.local', source: 'manual', tags: ['qa'] }),
    }, token);
    assert(status === 201, `HTTP ${status} — ${body.error || JSON.stringify(body)}`);
    assert(body.client && body.client.id, 'Response missing client.id');
    createdId = body.client.id;
    record(`Create client — id ${createdId.slice(0, 8)}…`, 'pass');
  } catch (e) {
    record('Create client (POST /clients)', 'fail', {
      error:       e.message,
      likelyCause: 'INSERT denied or validation error',
      file:        'netlify/functions/clients.js / Supabase clients table',
      fix:         'Run fix_service_role_grants.sql; confirm full_name column exists',
    });
  }

  // ── [5] Persistence ─────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[5] Supabase persistence${C.reset}`);
  if (createdId) {
    try {
      const { status, body } = await apiCall(`/clients?id=${createdId}`, {}, token);
      assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
      assert(body.client && body.client.full_name === testName,
        `Name mismatch — got "${body.client && body.client.full_name}"`);
      record('Created client persists in Supabase', 'pass');
    } catch (e) {
      record('Created client persists in Supabase', 'fail', {
        error:       e.message,
        likelyCause: 'Row not written, or SELECT failing after INSERT',
        file:        'Supabase → Table Editor → clients',
        fix:         'Check clients table directly in Supabase to confirm row exists',
      });
    }
  } else {
    record('Persistence check (skipped — create failed)', 'skip');
  }

  // ── [6] Edit client ─────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[6] Edit client${C.reset}`);
  if (createdId) {
    try {
      const updatedName = testName + ' EDITED';
      const { status, body } = await apiCall(`/clients?id=${createdId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ full_name: updatedName, notes: 'QA edit test' }),
      }, token);
      assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
      assert(body.client && body.client.full_name === updatedName,
        `Name not updated — got "${body.client && body.client.full_name}"`);
      record('Edit client (PATCH /clients)', 'pass');
    } catch (e) {
      record('Edit client (PATCH /clients)', 'fail', {
        error:       e.message,
        likelyCause: 'UPDATE denied or PATCH handler error',
        file:        'netlify/functions/clients.js',
        fix:         'Confirm PATCH handler and service_role UPDATE grant',
      });
    }
  } else {
    record('Edit client (skipped — create failed)', 'skip');
  }

  // ── [7] Archive client ──────────────────────────────────────────────────────
  console.log(`\n${C.bold}[7] Archive client (soft-delete)${C.reset}`);
  if (createdId) {
    try {
      const { status, body } = await apiCall(`/clients?id=${createdId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ status: 'archived' }),
      }, token);
      assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
      assert(body.client && body.client.status === 'archived',
        `Expected status=archived, got "${body.client && body.client.status}"`);

      // Confirm row still exists (not hard-deleted)
      const { status: s2, body: b2 } = await apiCall(`/clients?id=${createdId}`, {}, token);
      assert(s2 === 200, `Row gone after archive — expected 200, got ${s2}`);
      assert(b2.client && b2.client.status === 'archived', 'Row exists but status wrong');
      record('Archive is soft-delete — row persists with status=archived', 'pass');
    } catch (e) {
      record('Archive client', 'fail', {
        error:       e.message,
        likelyCause: 'UPDATE failing or row unexpectedly deleted',
        file:        'netlify/functions/clients.js / Supabase clients table',
        fix:         'Verify PATCH handler sets status; confirm no hard-delete path',
      });
    }
  } else {
    record('Archive client (skipped — create failed)', 'skip');
  }

  // ── [8] Timeline API ────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[8] Timeline API${C.reset}`);
  if (createdId) {
    try {
      const { status, body } = await apiCall(`/timeline?client_id=${createdId}`, {}, token);
      assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
      assert(body.client,             'Missing client object in response');
      assert(Array.isArray(body.timeline), 'Missing timeline array');
      assert(body.stats && typeof body.stats === 'object', 'Missing stats object');
      record(`Timeline API — ${body.timeline.length} events, stats present`, 'pass');
    } catch (e) {
      record('Timeline API (GET /timeline)', 'fail', {
        error:       e.message,
        likelyCause: 'timeline function error or service_role lacks grants on related tables',
        file:        'netlify/functions/timeline.js',
        fix:         'Run fix_service_role_grants.sql; check function logs in Netlify dashboard',
      });
    }
  } else {
    record('Timeline API (skipped — create failed)', 'skip');
  }

  // ── [9] Audit log ───────────────────────────────────────────────────────────
  console.log(`\n${C.bold}[9] Audit log${C.reset}`);
  try {
    const { status, body } = await apiCall('/audit-log?limit=5', {}, token);
    assert(status === 200, `HTTP ${status} — ${body.error || ''}`);
    assert(Array.isArray(body.logs), 'Missing logs array in response');
    const entry = body.logs.find(l => l.record_id === createdId);
    if (entry) {
      record(`Audit log — create entry found (actor: ${entry.actor})`, 'pass');
    } else {
      record('Audit log readable — create entry not in top 5 (normal if table has history)', 'pass');
    }
  } catch (e) {
    record('Audit log (GET /audit-log)', 'fail', {
      error:       e.message,
      likelyCause: 'audit_logs table lacks service_role grant, or /audit-log function missing',
      file:        'netlify/functions/audit-log.js / Supabase audit_logs table',
      fix:         'Run fix_service_role_grants.sql; confirm audit-log.js exists in netlify/functions/',
    });
  }

  // ── [10] RLS lockdown ───────────────────────────────────────────────────────
  console.log(`\n${C.bold}[10] RLS / server-role access${C.reset}`);
  try {
    const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
    const { data, error } = await sb.from('clients').select('id').limit(1);
    if (error) {
      record(`RLS blocks anon direct DB access — "${error.message.slice(0, 55)}…"`, 'pass');
    } else if (!data || data.length === 0) {
      record('RLS blocks anon direct DB access (empty result — policies active)', 'pass');
    } else {
      record('RLS blocks anon direct DB access', 'fail', {
        error:       `Anon key returned ${data.length} row(s) directly from clients`,
        likelyCause: 'deny_all RLS policy missing or not restrictive',
        file:        'supabase/schema.sql — deny_all_clients policy',
        fix:         'Re-run the deny_all block in schema.sql; confirm AS RESTRICTIVE is present',
      });
    }
  } catch (e) {
    record('RLS lockdown check', 'fail', {
      error:       e.message,
      likelyCause: 'Supabase client error during direct DB check',
      file:        'qa/qa-agent.js',
      fix:         'Verify QA_SUPABASE_URL and QA_SUPABASE_ANON are correct',
    });
  }

  printSummary();
}

// ─────────────────────────────────────────────────────────────────────────────
function printSummary() {
  const passed  = results.filter(r => r.status === 'pass').length;
  const failed  = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Summary${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}`);
  console.log(`  ${C.green}${C.bold}${passed} passed${C.reset}  |  ${C.red}${C.bold}${failed} failed${C.reset}  |  ${C.yellow}${skipped} skipped${C.reset}`);

  if (failed > 0) {
    console.log(`\n${C.red}${C.bold}  ✗ Blockers found — do not advance to next milestone${C.reset}`);
    console.log(`\n${C.bold}  Failed tests:${C.reset}`);
    results
      .filter(r => r.status === 'fail')
      .forEach(r => {
        console.log(`    ${C.red}✗${C.reset} ${r.name}`);
        if (r.fix) console.log(`      ${C.grey}→ ${r.fix}${C.reset}`);
      });
    console.log('');
    process.exit(1);
  } else {
    console.log(`\n${C.green}${C.bold}  ✓ All checks passed — ready for next milestone${C.reset}\n`);
    process.exit(0);
  }
}

run().catch(e => {
  console.error(`\n${C.red}${C.bold}QA Agent crashed:${C.reset}`, e.message);
  process.exit(1);
});
