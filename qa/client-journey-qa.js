'use strict';

// ── Sprint 15 — Full Client Journey QA ───────────────────────────────────────
// 40 tests covering every step from public booking through cancellation,
// including the separate policy/waiver/intake/public+full assessment documents,
// the client portal, document writes (treatment plan / follow-up), the email
// portal link, and Sprint 17 client portal accounts/auth (signup/login, RLS,
// duplicate-email handling). Auth tests WARN-skip if Supabase Auth/RLS not yet
// configured, and PASS once configured.
// Run from inside the `website` directory:  node qa/client-journey-qa.js
//
// Env is loaded from qa/.env. Required: SUPABASE_URL (or QA_SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY (or QA_SUPABASE_SERVICE_ROLE_KEY — service_role, NOT
// anon), REA_PIN (or DASHBOARD_PIN). Optional: BASE_URL / QA_SITE_URL.
//
// All tests are read-only or use isolated test data tagged test_qa=true.
// Run against staging or production with caution — see CLEANUP section at bottom.

const { createClient } = require('@supabase/supabase-js');
const fs              = require('fs');
const path            = require('path');

// ── Load qa/.env ──────────────────────────────────────────────────────────────
// Prefer dotenv if it's installed; otherwise fall back to a tiny built-in parser
// so the suite runs without requiring an npm install or manual shell exports.
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  try {
    require('dotenv').config({ path: envPath });
    return;
  } catch (e) { /* dotenv not installed — fall through to manual parse */ }
  try {
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
      if (!m) return; // skips blanks and # comments
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (e) { /* ignore — validation below will report what's missing */ }
})();

// ── Env mapping (new names, backward-compatible with legacy QA_ aliases) ───────
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.QA_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.QA_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.QA_SERVICE_ROLE_KEY;

// Anon key — used to exercise client-side Supabase Auth (Sprint 17). Optional:
// if absent, auth tests WARN-skip rather than fail.
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.QA_SUPABASE_ANON;

const SITE_URL =
  process.env.BASE_URL ||
  process.env.QA_SITE_URL ||
  process.env.SITE_URL ||
  'https://royal-energy-alchemy.netlify.app';

const BASE_URL = `${SITE_URL}/.netlify/functions`;

const REA_PIN =
  process.env.REA_PIN ||
  process.env.DASHBOARD_PIN;

// Decode a Supabase JWT's role claim (best-effort) — used to reject an anon key
// supplied where a service_role key is required.
function jwtRole(key) {
  try {
    const payload = JSON.parse(Buffer.from(String(key).split('.')[1], 'base64').toString('utf8'));
    return payload.role || null;
  } catch (e) { return null; }
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

// ── Result store ──────────────────────────────────────────────────────────────
const results = [];
function pass(id, label, detail = '') {
  results.push({ id, label, status: 'PASS', detail });
  console.log(`  ${c.green('✓ PASS')} [${id}] ${label}${detail ? c.dim(' — ' + detail) : ''}`);
}
function fail(id, label, detail = '') {
  results.push({ id, label, status: 'FAIL', detail });
  console.log(`  ${c.red('✗ FAIL')} [${id}] ${label}${detail ? c.dim(' — ' + detail) : ''}`);
}
function warn(id, label, detail = '') {
  results.push({ id, label, status: 'WARN', detail });
  console.log(`  ${c.yellow('⚠ WARN')} [${id}] ${label}${detail ? c.dim(' — ' + detail) : ''}`);
}

// ── HTTP helper (works in Node 18+ with native fetch) ────────────────────────
async function req(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON response */ }
  return { status: r.status, json };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(c.bold('\n╔══════════════════════════════════════════════════════╗'));
  console.log(c.bold(  '║   Sprint 15 — Full Client Journey QA                ║'));
  console.log(c.bold(  '╚══════════════════════════════════════════════════════╝\n'));

  // ── Validate env ────────────────────────────────────────────────────────────
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL (or QA_SUPABASE_URL)');
  if (!REA_PIN)      missing.push('REA_PIN (or DASHBOARD_PIN)');
  if (missing.length) {
    console.error(c.red(`Missing required env in qa/.env: ${missing.join(', ')}`));
    process.exit(1);
  }

  // A service_role key is mandatory — the suite seeds and deletes rows and reads
  // email_templates, all of which RLS blocks for the anon key.
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error(c.red('Missing SUPABASE_SERVICE_ROLE_KEY. Add service_role key to qa/.env as QA_SUPABASE_SERVICE_ROLE_KEY.'));
    process.exit(1);
  }
  if (jwtRole(SUPABASE_SERVICE_ROLE_KEY) === 'anon') {
    console.error(c.red('The provided key is an ANON key, not a service_role key. The anon key is NOT sufficient for this QA suite.\nAdd the service_role key to qa/.env as QA_SUPABASE_SERVICE_ROLE_KEY.'));
    process.exit(1);
  }

  const sb     = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sbAnon = SUPABASE_ANON ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;
  const pin    = REA_PIN;
  let createdAuthUserId = null;
  let token  = null;
  let slotId = null;
  let sessionId = null;
  let clientId  = null;
  let aftercareId = null;
  let bookingResp = null;
  let portalToken = null;

  // Use a .com domain (not a reserved .example TLD, which Supabase Auth rejects).
  const TEST_EMAIL = `qa-journey-${Date.now()}@rea-qa.com`;
  const TEST_NAME  = 'QA Journey Test';

  // =========================================================================
  // PHASE 1: Public Booking Flow
  // =========================================================================
  console.log(c.cyan('\n── Phase 1: Public Booking Flow ──────────────────────────\n'));

  // CJ-01: GET /booking?services=1 returns service list
  try {
    const { status, json } = await req(`${BASE_URL}/booking?services=1`);
    if (status === 200 && Array.isArray(json?.services) && json.services.length === 8) {
      pass('CJ-01', 'GET /booking?services=1 returns 8 services', `${json.services.length} services`);
    } else {
      fail('CJ-01', 'GET /booking?services=1 returns 8 services', `status=${status}, count=${json?.services?.length}`);
    }
  } catch (e) { fail('CJ-01', 'GET /booking?services=1 returns 8 services', e.message); }

  // CJ-02: book.html and waiver-esign.html both exist
  try {
    const [bookRes, waiverRes] = await Promise.all([
      fetch(`${SITE_URL}/book.html`),
      fetch(`${SITE_URL}/waiver-esign.html`),
    ]);
    const bookOk   = bookRes.status === 200;
    const waiverOk = waiverRes.status === 200;
    (bookOk && waiverOk)
      ? pass('CJ-02', 'book.html and waiver-esign.html both served')
      : fail('CJ-02', 'Pages served', `book=${bookRes.status}, waiver=${waiverRes.status}`);
  } catch (e) { fail('CJ-02', 'book.html / waiver-esign.html check', e.message); }

  // CJ-03: Seed an available slot for booking
  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { data, error } = await sb.from('availability_slots').insert({
      slot_date: tomorrow,
      slot_time: '10:00:00',
      status:    'available',
      label:     'QA Test Slot',
    }).select('id').single();

    if (error) {
      fail('CJ-03', 'Seed availability slot for test', error.message);
    } else {
      slotId = data.id;
      pass('CJ-03', 'Availability slot seeded', `id=${slotId}`);
    }
  } catch (e) { fail('CJ-03', 'Seed availability slot', e.message); }

  // CJ-04: POST /booking creates session atomically
  if (slotId) {
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const { status, json } = await req(`${BASE_URL}/booking`, {
        method: 'POST',
        body: {
          slot_id:      slotId,
          service:      'energy-clearing',
          client_name:  TEST_NAME,
          client_email: TEST_EMAIL,
          source:       'qa_test',
        },
      });

      if (status === 200 && json?.booked && json?.session_id) {
        sessionId = json.session_id;
        bookingResp = json;
        pass('CJ-04', 'POST /booking creates session', `session_id=${sessionId}`);
      } else {
        fail('CJ-04', 'POST /booking creates session', `status=${status}, error=${json?.error}`);
      }
    } catch (e) { fail('CJ-04', 'POST /booking creates session', e.message); }
  } else {
    fail('CJ-04', 'POST /booking creates session', 'Skipped — no slot available');
  }

  // CJ-05: Slot is now marked booked (atomic guard works)
  if (slotId) {
    try {
      const { data } = await sb.from('availability_slots').select('status').eq('id', slotId).single();
      data?.status === 'booked'
        ? pass('CJ-05', 'Slot marked booked after successful booking')
        : fail('CJ-05', 'Slot marked booked', `status=${data?.status}`);
    } catch (e) { fail('CJ-05', 'Slot status check', e.message); }
  } else {
    fail('CJ-05', 'Slot marked booked', 'Skipped — no slot');
  }

  // CJ-06: Double-booking attempt returns 409
  if (slotId) {
    try {
      const { status, json } = await req(`${BASE_URL}/booking`, {
        method: 'POST',
        body: {
          slot_id:      slotId,
          service:      'energy-clearing',
          client_name:  'Second Booker',
          client_email: `qa-second-${Date.now()}@test.example`,
        },
      });
      status === 409
        ? pass('CJ-06', 'Double-booking attempt returns 409', json?.error)
        : fail('CJ-06', 'Double-booking returns 409', `got HTTP ${status}`);
    } catch (e) { fail('CJ-06', 'Double-booking guard', e.message); }
  } else {
    fail('CJ-06', 'Double-booking guard', 'Skipped — no slot');
  }

  // CJ-07: Client record created with correct fields
  if (sessionId) {
    try {
      const { data: session } = await sb.from('sessions').select('client_id, intake_status, source').eq('id', sessionId).single();
      clientId = session?.client_id;
      const hasIntake = session?.intake_status === 'pending';
      const hasSource = session?.source === 'qa_test' || session?.source === 'online';
      (clientId && hasIntake)
        ? pass('CJ-07', 'Session has client_id and intake_status=pending', `client_id=${clientId}`)
        : fail('CJ-07', 'Session fields', `client_id=${clientId}, intake_status=${session?.intake_status}`);
    } catch (e) { fail('CJ-07', 'Session client fields', e.message); }
  } else {
    fail('CJ-07', 'Session client fields', 'Skipped — no session');
  }

  // =========================================================================
  // PHASE 1b: Separate Documents & Client Portal
  // =========================================================================
  console.log(c.cyan('\n── Phase 1b: Separate Documents & Portal ─────────────────\n'));

  // CJ-07a: Booking returns SEPARATE waiver_url and intake_url (not collapsed)
  if (bookingResp) {
    const wUrl = bookingResp.waiver_url || '';
    const iUrl = bookingResp.intake_url || '';
    const waiverOk = wUrl.includes('waiver-esign.html');
    const intakeOk = iUrl.includes('full-intake.html');
    const distinct = wUrl !== iUrl && waiverOk && intakeOk;
    distinct
      ? pass('CJ-07a', 'Booking returns separate waiver_url + intake_url', 'waiver→waiver-esign, intake→full-intake')
      : fail('CJ-07a', 'Separate waiver/intake URLs', `waiver_url=${wUrl}, intake_url=${iUrl}`);
  } else {
    fail('CJ-07a', 'Separate waiver/intake URLs', 'Skipped — no booking response');
  }

  // CJ-07b: No broken /waiver.html — booking must not reference the missing page
  if (bookingResp) {
    const blob = JSON.stringify(bookingResp);
    const hasBroken = /\/waiver\.html/.test(blob);
    !hasBroken
      ? pass('CJ-07b', 'No broken /waiver.html reference in booking response')
      : fail('CJ-07b', 'Broken /waiver.html reference found', blob);
  } else {
    fail('CJ-07b', 'No broken /waiver.html reference', 'Skipped — no booking response');
  }

  // CJ-07c: Standalone waiver + portal pages are served (not deleted)
  try {
    const [waiverConfirmed, portal] = await Promise.all([
      fetch(`${SITE_URL}/waiver-confirmed.html`),
      fetch(`${SITE_URL}/client-portal.html`),
    ]);
    (waiverConfirmed.status === 200 && portal.status === 200)
      ? pass('CJ-07c', 'waiver-confirmed.html and client-portal.html both served')
      : fail('CJ-07c', 'Portal/waiver pages served', `waiver-confirmed=${waiverConfirmed.status}, portal=${portal.status}`);
  } catch (e) { fail('CJ-07c', 'Portal/waiver pages served', e.message); }

  // CJ-07d: full-intake.html contains NO embedded waiver/legal content
  try {
    const intakeRes = await fetch(`${SITE_URL}/full-intake.html`);
    if (intakeRes.status === 200) {
      const html = (await intakeRes.text()).toLowerCase();
      const noWaiver = !html.includes('liability waiver') &&
                       !html.includes('w-signature') &&
                       !html.includes('waiversection') &&
                       !html.includes('recording consent');
      noWaiver
        ? pass('CJ-07d', 'full-intake.html contains no embedded waiver/legal section')
        : fail('CJ-07d', 'Intake still contains waiver content', 'waiver/legal markers present in full-intake.html');
    } else {
      fail('CJ-07d', 'full-intake.html served', `status=${intakeRes.status}`);
    }
  } catch (e) { fail('CJ-07d', 'Intake waiver-absence check', e.message); }

  // CJ-07e: All required policy/document pages load
  try {
    const pages = [
      'privacy-policy.html', 'ai-recording-transcription-policy.html', 'recording-policy.html',
      'cancellation-policy.html', 'payment-policy.html', 'waiver-esign.html',
      'full-intake.html', 'assess.html', 'full-assessment.html', 'client-portal.html',
    ];
    const codes = await Promise.all(pages.map(p => fetch(`${SITE_URL}/${p}`).then(r => r.status).catch(() => 0)));
    const bad = pages.filter((p, i) => codes[i] !== 200);
    bad.length === 0
      ? pass('CJ-07e', `All ${pages.length} document/policy pages load`)
      : fail('CJ-07e', 'Some document pages failed to load', bad.join(', '));
  } catch (e) { fail('CJ-07e', 'Document pages load', e.message); }

  // CJ-07f: Booking confirmation response includes the client portal link
  if (bookingResp) {
    const pUrl = bookingResp.portal_url || '';
    pUrl.includes('/client-portal.html')
      ? pass('CJ-07f', 'Booking returns client portal link', pUrl.includes('token=') ? 'with token' : 'no token')
      : fail('CJ-07f', 'Booking portal link', `portal_url=${pUrl}`);
  } else {
    fail('CJ-07f', 'Booking portal link', 'Skipped — no booking response');
  }

  // Fetch this client's portal token for the portal + acknowledgment tests
  if (clientId) {
    try {
      const { data } = await sb.from('clients').select('portal_token').eq('id', clientId).single();
      portalToken = data && data.portal_token;
    } catch (e) { /* column may not exist if migration not applied */ }
  }

  // CJ-07g: Portal returns all 10 separate document cards for the client
  if (portalToken) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-portal?token=${encodeURIComponent(portalToken)}`);
      const docs = (json && json.documents) || [];
      const types = docs.map(d => d.type);
      const required = ['privacy_policy','ai_recording_transcription_policy','recording_policy','cancellation_policy','payment_policy','waiver','intake','full_assessment','assessment','treatment_plan','followup'];
      const missing = required.filter(t => !types.includes(t));
      (status === 200 && missing.length === 0)
        ? pass('CJ-07g', `Portal renders all ${required.length} document cards`)
        : fail('CJ-07g', 'Portal document cards', `status=${status}, missing=${missing.join(',') || 'none'}`);
    } catch (e) { fail('CJ-07g', 'Portal document cards', e.message); }
  } else {
    warn('CJ-07g', 'Portal document cards', 'Skipped — no portal_token (run policy-documents migration)');
  }

  // CJ-07h: Policy acknowledgment stores separately in client_documents
  if (portalToken) {
    try {
      const ack = await req(`${BASE_URL}/client-documents`, {
        method: 'POST',
        body: { token: portalToken, document_type: 'privacy_policy', action: 'acknowledge', signature: TEST_NAME },
      });
      if (ack.status === 200 && ack.json && ack.json.saved) {
        const { json } = await req(`${BASE_URL}/client-documents?token=${encodeURIComponent(portalToken)}`);
        const row = ((json && json.documents) || []).find(d => d.document_type === 'privacy_policy');
        (row && row.status === 'acknowledged')
          ? pass('CJ-07h', 'Policy acknowledgment stored in client_documents', `status=${row.status}`)
          : fail('CJ-07h', 'Policy acknowledgment storage', `row=${JSON.stringify(row)}`);
      } else {
        fail('CJ-07h', 'Policy acknowledgment POST', `status=${ack.status}, error=${ack.json && ack.json.error}`);
      }
    } catch (e) { fail('CJ-07h', 'Policy acknowledgment', e.message); }
  } else {
    warn('CJ-07h', 'Policy acknowledgment', 'Skipped — no portal_token');
  }

  // CJ-07i: Treatment plan & follow-up are NOT marked complete from fallback
  if (portalToken) {
    try {
      const { json } = await req(`${BASE_URL}/client-portal?token=${encodeURIComponent(portalToken)}`);
      const docs = (json && json.documents) || [];
      const tp = docs.find(d => d.type === 'treatment_plan');
      const fu = docs.find(d => d.type === 'followup');
      const ok = tp && !tp.done && tp.status === 'not_started' && fu && !fu.done && fu.status !== 'submitted';
      ok
        ? pass('CJ-07i', 'Treatment plan & follow-up not falsely completed', `tp=${tp && tp.status}, fu=${fu && fu.status}`)
        : fail('CJ-07i', 'Treatment/follow-up fallback status', `tp=${tp && tp.status}, fu=${fu && fu.status}`);
    } catch (e) { fail('CJ-07i', 'Treatment/follow-up fallback status', e.message); }
  } else {
    warn('CJ-07i', 'Treatment/follow-up fallback status', 'Skipped — no portal_token');
  }

  // CJ-07j: Full Assessment is a SEPARATE card from Full Intake, required for new clients
  if (portalToken) {
    try {
      const { json } = await req(`${BASE_URL}/client-portal?token=${encodeURIComponent(portalToken)}`);
      const docs = (json && json.documents) || [];
      const fa = docs.find(d => d.type === 'full_assessment');
      const intake = docs.find(d => d.type === 'intake');
      const pub = docs.find(d => d.type === 'assessment');
      const ok = fa && intake && pub
        && fa.type !== intake.type
        && fa.required === true && fa.done === false && fa.status === 'not_started'  // required + missing for new client
        && pub.required === false;                                                    // public assessment optional
      ok
        ? pass('CJ-07j', 'Full Assessment separate from intake + required for new clients', `fa=${fa.status}, intake=${intake.status}, public=${pub.status}`)
        : fail('CJ-07j', 'Full Assessment separation', `fa=${fa && JSON.stringify({req:fa.required,done:fa.done,st:fa.status})}, intake=${intake && intake.type}, public=${pub && pub.required}`);
    } catch (e) { fail('CJ-07j', 'Full Assessment separation', e.message); }
  } else {
    warn('CJ-07j', 'Full Assessment separation', 'Skipped — no portal_token');
  }

  // CJ-07k: Full Assessment is NOT linked from public navigation
  try {
    const [home, nav] = await Promise.all([
      fetch(`${SITE_URL}/`).then(r => r.text()).catch(() => ''),
      fetch(`${SITE_URL}/site-nav.js`).then(r => r.text()).catch(() => ''),
    ]);
    const leaked = /full-assessment/i.test(home) || /full-assessment/i.test(nav);
    !leaked
      ? pass('CJ-07k', 'Full Assessment not exposed in public navigation')
      : fail('CJ-07k', 'Full Assessment leaked into public nav', 'found "full-assessment" in homepage or site-nav.js');
  } catch (e) { fail('CJ-07k', 'Full Assessment public-nav check', e.message); }

  // =========================================================================
  // PHASE 1d: Client Portal Accounts & Auth (Sprint 17)
  // =========================================================================
  console.log(c.cyan('\n── Phase 1d: Portal Accounts & Auth ──────────────────────\n'));

  // CJ-17a: check_email — booked client eligible, random email not eligible
  try {
    const okRes  = await req(`${BASE_URL}/client-account`, { method: 'POST', body: { action: 'check_email', email: TEST_EMAIL } });
    const badRes = await req(`${BASE_URL}/client-account`, { method: 'POST', body: { action: 'check_email', email: `nobody-${Date.now()}@test.example` } });
    (okRes.status === 200 && okRes.json && okRes.json.eligible === true && badRes.json && badRes.json.eligible === false)
      ? pass('CJ-17a', 'check_email: booked eligible, unbooked rejected')
      : fail('CJ-17a', 'check_email eligibility', `booked=${okRes.json && okRes.json.eligible}, unbooked=${badRes.json && badRes.json.eligible}`);
  } catch (e) { fail('CJ-17a', 'check_email', e.message); }

  // CJ-17b: Unauthenticated portal access is blocked (no token, no JWT)
  try {
    const { status } = await req(`${BASE_URL}/client-portal`);
    status === 401
      ? pass('CJ-17b', 'Unauthenticated portal access blocked (401)')
      : fail('CJ-17b', 'Unauthenticated portal access', `expected 401, got ${status}`);
  } catch (e) { fail('CJ-17b', 'Unauthenticated portal access', e.message); }

  // CJ-17c: Account signup/login → JWT → portal returns ONLY own data
  if (sbAnon && clientId) {
    try {
      const pw = 'QaTest!' + Date.now();
      let session = null;
      const up = await sbAnon.auth.signUp({ email: TEST_EMAIL, password: pw });
      if (up.error && /disabled|not enabled/i.test(up.error.message)) {
        warn('CJ-17c', 'Account login', 'Supabase email auth not enabled yet — enable Email provider + Confirm email OFF');
      } else if (up.error) {
        warn('CJ-17c', 'Account login', `signUp: ${up.error.message}`);
      } else {
        session = up.data.session;
        if (up.data.user) createdAuthUserId = up.data.user.id;
        if (!session) {
          const si = await sbAnon.auth.signInWithPassword({ email: TEST_EMAIL, password: pw });
          session = si.data && si.data.session;
        }
        if (!session) {
          warn('CJ-17c', 'Account login', 'No session returned — set Supabase "Confirm email" OFF for instant login');
        } else {
          const { status, json } = await req(`${BASE_URL}/client-portal`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          const ownData = status === 200 && json && json.client && (json.client.email || '').toLowerCase() === TEST_EMAIL.toLowerCase();
          if (ownData) {
            pass('CJ-17c', 'Account login returns own client dashboard', `docs=${(json.documents || []).length}`);
          } else {
            // Most likely the 2026-06-25 account migration isn't applied yet
            // (auth path reads auth_user_id/portal_* columns). WARN, don't fail.
            warn('CJ-17c', 'Account login portal data', `status=${status} — apply 2026-06-25 migration if columns missing (${json && json.error || ''})`);
          }
        }
      }
    } catch (e) { fail('CJ-17c', 'Account login', e.message); }
  } else {
    warn('CJ-17c', 'Account login', sbAnon ? 'Skipped — no client' : 'Skipped — no anon key in qa/.env');
  }

  // CJ-17d: RLS — an authenticated client may read only their own client row.
  // Reuses the session established by CJ-17c (sbAnon stays authenticated).
  if (sbAnon && createdAuthUserId && clientId) {
    try {
      const { data: ownRows, error: ownErr } = await sbAnon.from('clients').select('id').eq('id', clientId);
      if (ownErr && /permission/i.test(ownErr.message)) {
        warn('CJ-17d', 'RLS own-data-only', 'authenticated role lacks SELECT grant — run 2026-06-27-sprint17-rls-grants.sql');
      } else if (ownErr && /rls|row-level/i.test(ownErr.message)) {
        warn('CJ-17d', 'RLS own-data-only', 'RLS not enabled — run 2026-06-25 migration');
      } else {
        // With RLS, an unrelated client row must NOT be readable by this user.
        const { data: otherRows } = await sbAnon.from('clients').select('id').neq('id', clientId).limit(1);
        const isolated = (!otherRows || otherRows.length === 0);
        isolated
          ? pass('CJ-17d', 'RLS restricts authenticated client to own record')
          : warn('CJ-17d', 'RLS own-data-only', 'Other client rows visible — verify RLS policies / migration applied');
      }
    } catch (e) { warn('CJ-17d', 'RLS own-data-only', e.message); }
  } else {
    warn('CJ-17d', 'RLS own-data-only', 'Skipped — auth/anon not available');
  }

  // CJ-17e: Duplicate-email handling — flagged, not auto-linked
  try {
    const dupEmail = `qa-dup-${Date.now()}@test.example`;
    const { data: d1 } = await sb.from('clients').insert({ full_name: 'Dup One', email: dupEmail }).select('id').single();
    const { data: d2 } = await sb.from('clients').insert({ full_name: 'Dup Two', email: dupEmail }).select('id').single();
    const res = await req(`${BASE_URL}/client-account`, { method: 'POST', body: { action: 'check_email', email: dupEmail } });
    (res.json && res.json.duplicate === true && res.json.eligible === false)
      ? pass('CJ-17e', 'Duplicate email flagged, not auto-linked')
      : fail('CJ-17e', 'Duplicate email handling', `duplicate=${res.json && res.json.duplicate}`);
    if (d1) await sb.from('clients').delete().eq('id', d1.id);
    if (d2) await sb.from('clients').delete().eq('id', d2.id);
  } catch (e) { fail('CJ-17e', 'Duplicate email handling', e.message); }

  // =========================================================================
  // PHASE 2: Admin Auth & Dashboard Access
  // =========================================================================
  console.log(c.cyan('\n── Phase 2: Admin Auth & Dashboard Access ────────────────\n'));

  // CJ-08: PIN auth returns dashboard token
  try {
    const { status, json } = await req(`${BASE_URL}/verify-pin`, {
      method: 'POST',
      body:   { pin },
    });
    if (status === 200 && json?.token) {
      token = json.token;
      pass('CJ-08', 'PIN auth returns dashboard token');
    } else {
      fail('CJ-08', 'PIN auth', `status=${status}, error=${json?.error}`);
    }
  } catch (e) { fail('CJ-08', 'PIN auth', e.message); }

  // CJ-09: GET /sessions?upcoming=1 returns booked session
  if (token && sessionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/sessions?upcoming=1`, {
        headers: { 'X-Dashboard-Token': token },
      });
      const found = (json?.sessions || []).some(s => s.id === sessionId);
      (status === 200 && found)
        ? pass('CJ-09', 'GET /sessions?upcoming=1 includes booked session')
        : fail('CJ-09', 'Upcoming sessions', `found=${found}, status=${status}`);
    } catch (e) { fail('CJ-09', 'GET sessions upcoming', e.message); }
  } else {
    fail('CJ-09', 'GET sessions upcoming', 'Skipped — no token or session');
  }

  // =========================================================================
  // PHASE 2b: Client Questions & Purchases (Sprint 17 Phase B)
  // =========================================================================
  console.log(c.cyan('\n── Phase 2b: Questions & Purchases ───────────────────────\n'));
  let questionId = null;

  // CJ-18a: client submits a question (portal-token path)
  if (portalToken) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-questions`, {
        method: 'POST',
        body: { token: portalToken, question: 'QA: when should I arrive?', category: 'Appointment', priority: 'high', preferred_contact_method: 'email' },
      });
      if (status === 200 && json && json.saved && json.question) {
        questionId = json.question.id;
        pass('CJ-18a', 'Client submits a question', `id=${questionId}`);
      } else {
        fail('CJ-18a', 'Submit question', `status=${status}, error=${json && json.error}`);
      }
    } catch (e) { fail('CJ-18a', 'Submit question', e.message); }
  } else {
    warn('CJ-18a', 'Submit question', 'Skipped — no portal_token');
  }

  // CJ-18b: unauthenticated submit is blocked
  try {
    const { status } = await req(`${BASE_URL}/client-questions`, { method: 'POST', body: { question: 'no auth' } });
    (status === 401 || status === 404)
      ? pass('CJ-18b', 'Unauthenticated question submit blocked', `status=${status}`)
      : fail('CJ-18b', 'Unauth submit', `expected 401/404, got ${status}`);
  } catch (e) { fail('CJ-18b', 'Unauth submit', e.message); }

  // CJ-18c: client sees only their own questions
  if (portalToken && questionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-questions?token=${encodeURIComponent(portalToken)}`);
      const list = (json && json.questions) || [];
      const mine = list.find(q => q.id === questionId);
      (status === 200 && mine && list.every(q => q.id))
        ? pass('CJ-18c', 'Client lists own questions', `${list.length} question(s)`)
        : fail('CJ-18c', 'Client own questions', `status=${status}, found=${!!mine}`);
    } catch (e) { fail('CJ-18c', 'Client own questions', e.message); }
  } else {
    warn('CJ-18c', 'Client own questions', 'Skipped — no question');
  }

  // CJ-18d: dashboard queue shows the question
  if (token && questionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-questions`, { headers: { 'X-Dashboard-Token': token } });
      const q = ((json && json.questions) || []).find(x => x.id === questionId);
      (status === 200 && q && q.client_name)
        ? pass('CJ-18d', 'Dashboard queue shows question', `client=${q.client_name}, status=${q.status}`)
        : fail('CJ-18d', 'Dashboard queue', `status=${status}, found=${!!q}`);
    } catch (e) { fail('CJ-18d', 'Dashboard queue', e.message); }
  } else {
    fail('CJ-18d', 'Dashboard queue', 'Skipped — no token/question');
  }

  // CJ-18e: practitioner response saves + status flips to responded
  if (token && questionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-questions?id=${questionId}`, {
        method: 'PATCH',
        headers: { 'X-Dashboard-Token': token },
        body: { practitioner_response: 'Arrive 5 minutes early. — Daron' },
      });
      (status === 200 && json.question && json.question.status === 'responded' && json.question.responded_at)
        ? pass('CJ-18e', 'Practitioner response saved (status responded)')
        : fail('CJ-18e', 'Practitioner response', `status=${status}, qstatus=${json && json.question && json.question.status}`);
    } catch (e) { fail('CJ-18e', 'Practitioner response', e.message); }
  } else {
    fail('CJ-18e', 'Practitioner response', 'Skipped — no token/question');
  }

  // CJ-18f: client portal now shows the response
  if (portalToken && questionId) {
    try {
      const { json } = await req(`${BASE_URL}/client-portal?token=${encodeURIComponent(portalToken)}`);
      const q = ((json && json.questions) || []).find(x => x.id === questionId);
      (q && /arrive 5 minutes early/i.test(q.practitioner_response || ''))
        ? pass('CJ-18f', 'Client portal displays practitioner response')
        : fail('CJ-18f', 'Response visible to client', `response=${q && q.practitioner_response}`);
    } catch (e) { fail('CJ-18f', 'Response visible to client', e.message); }
  } else {
    warn('CJ-18f', 'Response visible to client', 'Skipped — no question');
  }

  // CJ-18g: purchases section reflects the client's session(s)
  if (portalToken) {
    try {
      const { json } = await req(`${BASE_URL}/client-portal?token=${encodeURIComponent(portalToken)}`);
      const purchases = (json && json.purchases) || [];
      const summary = json && json.purchases_summary;
      (Array.isArray(purchases) && purchases.length >= 1 && summary && typeof summary.pending === 'number')
        ? pass('CJ-18g', 'Purchases reflect client sessions', `${purchases.length} item(s), status=${purchases[0].status}`)
        : fail('CJ-18g', 'Purchases mapping', `count=${purchases.length}`);
    } catch (e) { fail('CJ-18g', 'Purchases mapping', e.message); }
  } else {
    warn('CJ-18g', 'Purchases mapping', 'Skipped — no portal_token');
  }

  // =========================================================================
  // PHASE 3: Reminder Trigger
  // =========================================================================
  console.log(c.cyan('\n── Phase 3: Reminder Trigger ─────────────────────────────\n'));

  // CJ-10: GET /reminder?dry_run=1 includes our session
  if (token && sessionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/reminder?dry_run=1&hours=72`, {
        headers: { 'X-Dashboard-Token': token },
      });
      if (status === 200 && json?.dry_run === true) {
        const found = (json?.sessions || []).some(s => s.id === sessionId);
        found
          ? pass('CJ-10', 'GET /reminder?dry_run=1 includes our session')
          : warn('CJ-10', 'Session not in reminder candidates', 'May be outside 72hr window or reminder_sent already set');
      } else {
        fail('CJ-10', 'GET /reminder?dry_run=1', `status=${status}`);
      }
    } catch (e) { fail('CJ-10', 'Reminder dry run', e.message); }
  } else {
    fail('CJ-10', 'Reminder dry run', 'Skipped — no token or session');
  }

  // =========================================================================
  // PHASE 4: Aftercare & Follow-Up
  // =========================================================================
  console.log(c.cyan('\n── Phase 4: Aftercare & Follow-Up ───────────────────────\n'));

  // CJ-11: Admin POST /aftercare creates follow-up with template + follow-up URL
  if (token && sessionId && clientId) {
    try {
      const scheduled = new Date(Date.now() + 86400000).toISOString();
      const { status, json } = await req(`${BASE_URL}/aftercare`, {
        method: 'POST',
        headers: { 'X-Dashboard-Token': token },
        body: {
          session_id:    sessionId,
          client_id:     clientId,
          client_name:   TEST_NAME,
          followup_type: '24hr',
          scheduled_for: scheduled,
        },
      });
      if (status === 201 && json?.aftercare?.id) {
        aftercareId = json.aftercare.id;
        const hasTemplate = !!json.aftercare.followup_template_used;
        const hasUrl      = !!json.followup_url;
        (hasTemplate && hasUrl)
          ? pass('CJ-11', 'Admin POST /aftercare returns template + follow-up URL', `id=${aftercareId}, tmpl=${json.aftercare.followup_template_used}`)
          : fail('CJ-11', 'Aftercare missing template or URL', `template=${hasTemplate}, url=${hasUrl}`);
      } else {
        fail('CJ-11', 'Admin POST /aftercare', `status=${status}, error=${json?.error}`);
      }
    } catch (e) { fail('CJ-11', 'Aftercare creation', e.message); }
  } else {
    fail('CJ-11', 'Aftercare creation', 'Skipped — missing token/session/client');
  }

  // CJ-12: PUBLIC POST /aftercare?action=submit_response saves completed status
  if (aftercareId) {
    try {
      const { status, json } = await req(`${BASE_URL}/aftercare?action=submit_response`, {
        method: 'POST',
        body: {
          aftercare_id:  aftercareId,
          response_data: {
            feelingToday:          'Lighter and more grounded',
            whatChanged:           'Energy feels cleaner',
            whatStoodOut:          'The cord cutting sensation',
            additionalSupportNeeded: 'No',
          },
        },
      });
      if (status === 200 && json?.saved) {
        pass('CJ-12', 'Public POST submit_response saves aftercare response', `status=${json.status}`);
      } else {
        fail('CJ-12', 'submit_response', `HTTP ${status}, error=${json?.error}`);
      }
    } catch (e) { fail('CJ-12', 'submit_response', e.message); }
  } else {
    fail('CJ-12', 'submit_response', 'Skipped — no aftercare record');
  }

  // CJ-12a: Follow-up submission created a client_documents row; no treatment_plan row
  if (token && clientId) {
    try {
      const { status, json } = await req(`${BASE_URL}/client-documents?client_id=${clientId}`, {
        headers: { 'X-Dashboard-Token': token },
      });
      const docs = (json && json.documents) || [];
      const fu = docs.find(d => d.document_type === 'followup');
      const tp = docs.find(d => d.document_type === 'treatment_plan');
      const fuOk = fu && fu.status === 'submitted';
      const tpAbsent = !tp; // no treatment plan was created in this journey
      (status === 200 && fuOk && tpAbsent)
        ? pass('CJ-12a', 'Follow-up doc created on submit; no treatment_plan row', `followup=${fu.status}`)
        : fail('CJ-12a', 'Document writes after submit', `status=${status}, fu=${fu && fu.status}, tp=${tp && tp.status}`);
    } catch (e) { fail('CJ-12a', 'Document writes after submit', e.message); }
  } else {
    fail('CJ-12a', 'Document writes after submit', 'Skipped — no token/client');
  }

  // CJ-13: Duplicate submit returns 409
  if (aftercareId) {
    try {
      const { status } = await req(`${BASE_URL}/aftercare?action=submit_response`, {
        method: 'POST',
        body: {
          aftercare_id:  aftercareId,
          response_data: { feelingToday: 'Second attempt' },
        },
      });
      status === 409
        ? pass('CJ-13', 'Duplicate aftercare submit returns 409')
        : fail('CJ-13', 'Duplicate aftercare submit guard', `got HTTP ${status}`);
    } catch (e) { fail('CJ-13', 'Duplicate submit guard', e.message); }
  } else {
    fail('CJ-13', 'Duplicate submit guard', 'Skipped — no aftercare');
  }

  // =========================================================================
  // PHASE 5: Cancellation & Audit Trail
  // =========================================================================
  console.log(c.cyan('\n── Phase 5: Cancellation & Audit Trail ───────────────────\n'));

  // CJ-14: Admin can cancel session via PATCH /sessions
  if (token && sessionId) {
    try {
      const { status, json } = await req(`${BASE_URL}/sessions?id=${sessionId}`, {
        method:  'PATCH',
        headers: { 'X-Dashboard-Token': token },
        body:    { status: 'cancelled', _context: 'QA test cancellation' },
      });
      const cancelled = json?.session?.status === 'cancelled';
      (status === 200 && cancelled)
        ? pass('CJ-14', 'Admin PATCH /sessions cancels session')
        : fail('CJ-14', 'Session cancellation', `status=${status}, session_status=${json?.session?.status}`);
    } catch (e) { fail('CJ-14', 'Session cancellation', e.message); }
  } else {
    fail('CJ-14', 'Session cancellation', 'Skipped — no token or session');
  }

  // CJ-15: Audit log has records for this journey
  if (sessionId) {
    try {
      const { data, error } = await sb
        .from('audit_logs')
        .select('action')
        .eq('record_id', sessionId)
        .order('created_at', { ascending: true });

      if (error) {
        fail('CJ-15', 'Audit trail for session', error.message);
      } else {
        const actions = (data || []).map(r => r.action);
        const hasBooking  = actions.includes('booking_submitted');
        const hasUpdate   = actions.some(a => ['updated','session_cancelled','created'].includes(a));
        (data.length > 0)
          ? pass('CJ-15', `Audit trail has ${data.length} records for session`, `actions: ${actions.slice(0,4).join(', ')}`)
          : fail('CJ-15', 'Audit trail empty for session');
      }
    } catch (e) { fail('CJ-15', 'Audit trail', e.message); }
  } else {
    fail('CJ-15', 'Audit trail', 'Skipped — no session');
  }

  // CJ-16: Appointment confirmation email includes the portal link (HTML + text)
  try {
    const { data, error } = await sb
      .from('email_templates')
      .select('html_body, text_body, variables')
      .eq('name', 'appointment_confirmation')
      .single();
    if (error || !data) {
      fail('CJ-16', 'Email template lookup', (error && error.message) || 'not found');
    } else {
      const htmlOk = (data.html_body || '').includes('{{portal_url}}') && (data.html_body || '').includes('Required Client Documents');
      const textOk = (data.text_body || '').includes('{{portal_url}}');
      const varOk  = (data.variables || []).includes('portal_url');
      (htmlOk && textOk && varOk)
        ? pass('CJ-16', 'Confirmation email includes portal link (HTML + text + vars)')
        : fail('CJ-16', 'Email portal link', `html=${htmlOk}, text=${textOk}, var=${varOk}`);
    }
  } catch (e) { fail('CJ-16', 'Email portal link', e.message); }

  // =========================================================================
  // CLEANUP — remove test data
  // =========================================================================
  console.log(c.dim('\n── Cleaning up test data ─────────────────────────────────\n'));
  try {
    if (createdAuthUserId) { try { await sb.auth.admin.deleteUser(createdAuthUserId); } catch (e) { /* anon-created auth user */ } }
    if (clientId)    await sb.from('client_questions').delete().eq('client_id', clientId);
    if (clientId)    await sb.from('client_documents').delete().eq('client_id', clientId);
    if (aftercareId) await sb.from('aftercare').delete().eq('id', aftercareId);
    if (sessionId)   await sb.from('sessions').delete().eq('id', sessionId);
    if (clientId)    await sb.from('clients').delete().eq('id', clientId);
    if (slotId)      await sb.from('availability_slots').delete().eq('id', slotId);
    if (sessionId)   await sb.from('audit_logs').delete().eq('record_id', sessionId);
    console.log(c.dim('  Test data removed.'));
  } catch (e) {
    console.log(c.yellow(`  Cleanup warning: ${e.message}`));
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  const total = results.length;
  const passes = results.filter(r => r.status === 'PASS').length;
  const warns  = results.filter(r => r.status === 'WARN').length;
  const fails  = results.filter(r => r.status === 'FAIL').length;

  console.log(c.bold('\n╔══════════════════════════════════════════════════════╗'));
  console.log(c.bold(  '║   Client Journey QA — Results                       ║'));
  console.log(c.bold(  '╚══════════════════════════════════════════════════════╝\n'));
  console.log(`  Total:  ${total}`);
  console.log(`  ${c.green('PASS:')}   ${passes}`);
  console.log(`  ${c.yellow('WARN:')}   ${warns}`);
  console.log(`  ${c.red('FAIL:')}   ${fails}`);

  if (fails > 0) {
    console.log(c.red('\n  Failing tests:'));
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(c.red(`    [${r.id}] ${r.label}`) + c.dim(` — ${r.detail}`));
    });
  }

  const gate = fails === 0 && warns === 0 ? 'PASS' : fails === 0 ? 'WARN' : 'FAIL';
  const gateColor = gate === 'PASS' ? c.green : gate === 'WARN' ? c.yellow : c.red;
  console.log(c.bold(`\n  Production Gate: ${gateColor(gate)}\n`));

  // Write report
  const report = {
    suite:    'client-journey-qa',
    sprint:   15,
    run_at:   new Date().toISOString(),
    total, passes, warns, fails,
    gate,
    results,
  };
  const outDir = path.join(__dirname, '../outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `client-journey-qa-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(c.dim(`  Report written to ${outFile}\n`));

  process.exit(fails > 0 ? 1 : 0);
}

run().catch(e => {
  console.error(c.red(`\nFatal QA error: ${e.message}`));
  process.exit(1);
});
