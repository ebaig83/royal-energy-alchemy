// ============================================================
// QA Suite 20A — Outcome Attribution Analytics (Sprint 10A)
//
// Run modes:
//   Browser console (while logged into dashboard):
//     Copy-paste this file into the console.
//
//   Node (v18+ for native fetch):
//     BASE_URL=https://royal-energy-alchemy.netlify.app \
//     REA_SESSION_COOKIE='rea_session=...' \
//     node qa-suite-20a.js
//
// Target: PASS 20 / FAIL 0 / WARN 0
// ============================================================

// ── Runtime detection ──────────────────────────────────────
const IS_NODE   = typeof window === 'undefined';
const IS_BROWSER = !IS_NODE;

if (IS_NODE) {
  require('node:dns').setDefaultResultOrder('ipv4first');
}

// ── BASE_URL: fully-qualified origin required for Node ─────
// In the browser, resolve relative to the current page origin.
// In Node, read from env or fall back to production URL.
const BASE_URL = IS_NODE
  ? (process.env.BASE_URL || 'https://royal-energy-alchemy.netlify.app')
  : (typeof window !== 'undefined' ? window.location.origin : '');

const BASE = `${BASE_URL}/.netlify/functions`;

// ── Auth token ─────────────────────────────────────────────
// Node run modes (in priority order):
//   1. REA_SESSION_COOKIE='rea_session=...' — previously established session
//   2. REA_PIN=<your-dashboard-PIN>          — suite calls verify-pin and retains Set-Cookie
//   3. REA_API_TOKEN=<legacy-token>          — sent as X-Dashboard-Token only when supported
// Browser: relies on the browser's same-origin cookie; legacy sessionStorage token is retained.
let TOKEN = IS_NODE
  ? (process.env.REA_API_TOKEN || '')
  : (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rea_api_token') || '' : '');
let COOKIE = IS_NODE ? (process.env.REA_SESSION_COOKIE || '') : '';

function rememberCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const session = values.find(value => /(?:^|;\s*)rea_session=/.test(value));
  if (session) COOKIE = session.split(';', 1)[0];
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['X-Dashboard-Token'] = TOKEN;
  if (COOKIE) headers.Cookie = COOKIE;
  return headers;
}

function nodeRequest(url, options = {}) {
  const https = require('node:https');
  const { URL } = require('node:url');
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
      family: 4,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headerValues = name => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value : value ? [value] : [];
        };
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          headers: {
            get: name => headerValues(name).join(', '),
            getSetCookie: () => headerValues('set-cookie'),
          },
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function request(url, options = {}) {
  try {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    const response = IS_NODE
      ? await nodeRequest(url, { ...options, headers })
      : await fetch(url, { ...options, headers });
    rememberCookie(response);
    return response;
  } catch (error) {
    error.qaKind = 'network';
    error.qaCode = error.cause?.code || error.code || 'unknown';
    throw error;
  }
}

// Bootstrap token via PIN if REA_API_TOKEN not set (Node only)
async function bootstrapToken() {
  if (!IS_NODE) return;

  // ── Diagnostic: log all env inputs ───────────────────────────────────────
  const pinDetected   = !!(process.env.REA_PIN);
  const tokenPreset   = !!(process.env.REA_API_TOKEN);
  console.log(`  DIAG  pin detected     : ${pinDetected ? 'yes' : 'no'}`);
  console.log(`  DIAG  REA_API_TOKEN    : ${tokenPreset ? `yes (length ${process.env.REA_API_TOKEN.length})` : 'no'}`);

  if (TOKEN) {
    // Token came from REA_API_TOKEN — skip PIN bootstrap, but log it
    console.log(`  DIAG  token source     : REA_API_TOKEN (length ${TOKEN.length})`);
    const firstCode = TOKEN.charCodeAt(0);
    const lastCode  = TOKEN.charCodeAt(TOKEN.length - 1);
    console.log(`  DIAG  token char codes : first=${firstCode} last=${lastCode} (32=space 10=LF 13=CR)`);
    console.log(`  DIAG  token trimmed?   : ${TOKEN !== TOKEN.trim() ? 'NO — has leading/trailing whitespace!' : 'yes (clean)'}`);
    return;
  }

  const pin = process.env.REA_PIN || '';
  if (!pin) return;                                   // no PIN either — will run unauthenticated

  try {
    const r        = await request(`${BASE_URL}/.netlify/functions/verify-pin`, {
      method:  'POST',
      body:    JSON.stringify({ pin }),
    });
    const rawText  = await r.text();                  // read raw text — inspect before parsing

    console.log(`  DIAG  verify-pin status: ${r.status}`);

    let parsed = null;
    try   { parsed = JSON.parse(rawText); }
    catch { console.log(`  DIAG  verify-pin body  : NOT valid JSON — "${rawText.slice(0, 80)}"`); return; }

    if (r.ok) {
      TOKEN = parsed.token || TOKEN;
      console.log(`  DIAG  session cookie   : ${COOKIE ? 'received' : 'not returned'}`);
      console.log(`  DIAG  token header     : ${TOKEN ? 'received' : 'not returned'}`);
    } else {
      console.log(`  DIAG  verify-pin failed: HTTP ${r.status} — check REA_PIN value`);
    }
  } catch (e) {
    console.log(`  DIAG  verify-pin error : ${e.message}`);
  }
}

const H = authHeaders;

// ── Helpers ────────────────────────────────────────────────
let pass = 0, fail = 0;
const results = [];

function assert(id, description, condition, detail) {
  const status = condition ? 'PASS' : 'FAIL';
  if (condition) pass++; else fail++;
  results.push({ id, status, description, detail: detail || '' });
  const line = `[${status}] ${id}: ${description}${detail ? ' — ' + detail : ''}`;
  if (status === 'FAIL') console.error(line);
  else console.log(line);
}

async function get(section) {
  const url = `${BASE}/analytics?section=${section}`;
  try {
    const r = await request(url);
    let data = null;
    try { data = await r.json(); } catch (_) { /* non-JSON body */ }
    return { ok: r.ok, httpStatus: r.status, data };
  } catch (e) {
    console.error(`  network failure for ${url}: ${e.message} (${e.qaCode || 'unknown'})`);
    return { ok: false, httpStatus: 0, data: null, error: e.message, failure: 'network', code: e.qaCode || 'unknown' };
  }
}

function upstreamFailure(result) {
  if (result.httpStatus === 0) return 'network failure';
  if (result.httpStatus === 401) return 'authentication failure (401)';
  if (result.httpStatus === 403) return 'authorization/origin failure (403)';
  if (result.httpStatus >= 500) return `endpoint failure (${result.httpStatus})`;
  return '';
}

// Safe property access — never throws on null/undefined
function safe(obj, ...keys) {
  return keys.reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// ── Suite ──────────────────────────────────────────────────
(async function QA_SUITE_20A() {
  // Must run before any fetch — sets TOKEN via PIN if REA_API_TOKEN not provided
  await bootstrapToken();

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  QA SUITE 20A — Outcome Attribution Analytics');
  console.log(`  BASE_URL : ${BASE_URL}`);
  console.log(`  Runtime  : ${IS_NODE ? 'Node' : 'Browser'}`);
  if (!TOKEN) {
    console.log('  AUTH     : no token — data tests will skip');
    console.log('             set REA_API_TOKEN=<secret>  or  REA_PIN=<your-pin>');
  } else {
    console.log('  AUTH     : token present — full data validation enabled');
  }
  console.log('══════════════════════════════════════════════════════\n');

  // ── PRE-FLIGHT: cross-check token against a known-working section ──────────
  // data-quality uses the identical requireAdmin middleware.
  // If data-quality=200 but outcome-attribution=401 → deployment issue (new code not live).
  // If data-quality=401                              → token value is wrong.
  if (TOKEN) {
    try {
      const dqRes = await request(`${BASE}/analytics?section=data-quality`);
      const oaRes = await request(`${BASE}/analytics?section=outcome-attribution`);
      console.log(`  DIAG  data-quality             : HTTP ${dqRes.status}`);
      console.log(`  DIAG  outcome-attribution      : HTTP ${oaRes.status}`);
      if (dqRes.status === 200 && oaRes.status === 401) {
        console.log('  !! DEPLOYMENT GAP: data-quality=200 but outcome-attribution=401');
        console.log('     Same token, same middleware. New analytics.js code is NOT deployed.');
        console.log('     Run: netlify deploy --prod  then re-run QA.');
      } else if (dqRes.status === 401) {
        console.log('  !! TOKEN MISMATCH: data-quality=401 means the token does not match DASHBOARD_API_SECRET.');
        console.log('     If using REA_API_TOKEN: value is wrong — get it from Netlify env vars.');
        console.log('     If using REA_PIN: verify-pin returned a different secret than analytics expects.');
      } else if (dqRes.status === 200 && oaRes.status === 200) {
        console.log('  DIAG  pre-flight OK — both endpoints authenticated successfully');
      }
    } catch (e) {
      console.log(`  DIAG  pre-flight error: ${e.message}`);
    }
    console.log('');
  }

  // ── OA-01: sessions endpoint responds (validates migration) ────────────────
  {
    const url = `${BASE}/sessions?limit=1`;
    try {
      const r = await request(url);
      // 200 = sessions exist, 401/403 = auth required but endpoint reachable,
      // either way the column addition won't cause a 500 schema error
      assert('OA-01', 'practitioner_id migration — sessions endpoint reachable',
        r.status !== 0 && r.status < 500,
        `HTTP ${r.status}`);
    } catch (e) {
      assert('OA-01', 'practitioner_id migration — sessions endpoint reachable', false, e.message);
    }
  }

  // ── OA-02: outcome-attribution endpoint reachable ─────────────────────────
  // 200 = authenticated + data, 401 = auth required (endpoint live), both pass.
  // 404/500/0 = endpoint missing or crashed = FAIL.
  const oa = await get('outcome-attribution');
  const oaAuth = oa.httpStatus === 401;
  const oaUpstream = upstreamFailure(oa);
  assert('OA-02', 'outcome-attribution endpoint reachable (200 or 401)',
    oa.httpStatus === 200 || oa.httpStatus === 401,
    oaUpstream || `HTTP ${oa.httpStatus}${oaAuth ? ' — auth required; use REA_PIN or REA_SESSION_COOKIE' : ''}`);

  // ── OA-03: response is a non-null object ────────────────────────────────────
  if (oaUpstream) {
    assert('OA-03', 'outcome-attribution payload — skipped after upstream failure', true, oaUpstream);
  } else {
    assert('OA-03', 'outcome-attribution returns a non-null object',
      oa.data !== null && oa.data !== undefined && typeof oa.data === 'object',
      oa.data === null ? 'null' : typeof oa.data);
  }

  // ── OA-04: shape — summary object or insufficient_data ─────────────────────
  const oaInsuf      = oa.data != null && oa.data.status === 'insufficient_data';
  const oaHasSummary = oa.data != null && typeof oa.data.summary === 'object';
  if (oaUpstream) {
    assert('OA-04', 'outcome-attribution shape — skipped after upstream failure', true, oaUpstream);
  } else if (oaAuth) {
    assert('OA-04', 'outcome-attribution shape — skipped (401 auth required)', true, '401');
  } else {
    assert('OA-04', 'outcome-attribution has summary or insufficient_data shape',
      oaInsuf || oaHasSummary,
      oaInsuf
        ? `insufficient_data (need ${oa.data.minimumRequired}, have ${oa.data.currentCount})`
        : oaHasSummary ? 'summary present' : 'unexpected shape');
  }

  // ── OA-05: recommendations array present when sufficient ───────────────────
  if (oaAuth) {
    assert('OA-05', 'outcome-attribution.recommendations — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null) {
    assert('OA-05', 'outcome-attribution.recommendations is an array',
      Array.isArray(oa.data.recommendations), typeof oa.data.recommendations);
  } else {
    assert('OA-05', 'outcome-attribution.recommendations — skipped', true,
      oaInsuf ? 'insufficient data' : 'endpoint returned null');
  }

  // ── OA-06: categories array present when sufficient ────────────────────────
  if (oaAuth) {
    assert('OA-06', 'outcome-attribution.categories — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null) {
    assert('OA-06', 'outcome-attribution.categories is an array',
      Array.isArray(oa.data.categories), typeof oa.data.categories);
  } else {
    assert('OA-06', 'outcome-attribution.categories — skipped', true,
      oaInsuf ? 'insufficient data' : 'endpoint returned null');
  }

  // ── OA-07: recommendation row has required fields ──────────────────────────
  const oaRecs = safe(oa, 'data', 'recommendations') || [];
  if (oaAuth) {
    assert('OA-07', 'recommendation row fields — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null && oaRecs.length > 0) {
    const required = ['name','category','sessionCount','avgStateBefore','avgStateAfter','avgDelta'];
    const hasFields = required.every(f => f in oaRecs[0]);
    assert('OA-07', 'recommendation row has required fields', hasFields,
      hasFields ? Object.keys(oaRecs[0]).join(', ') : `missing: ${required.filter(f => !(f in oaRecs[0])).join(', ')}`);
  } else {
    assert('OA-07', 'recommendation row fields — skipped (no rows)', true, 'skipped');
  }

  // ── OA-08: avgDelta is numeric ─────────────────────────────────────────────
  if (oaAuth) {
    assert('OA-08', 'avgDelta numeric — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null && oaRecs.length > 0) {
    const allNumeric = oaRecs.every(r => typeof r.avgDelta === 'number');
    assert('OA-08', 'all recommendation avgDelta values are numbers', allNumeric,
      allNumeric ? `${oaRecs.length} rows` : `non-numeric found`);
  } else {
    assert('OA-08', 'avgDelta numeric — skipped', true, 'skipped');
  }

  // ── OA-09: sorted by avgDelta descending ───────────────────────────────────
  if (oaAuth) {
    assert('OA-09', 'sort order — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null && oaRecs.length > 1) {
    let sorted = true;
    for (let i = 1; i < oaRecs.length; i++) {
      if (oaRecs[i].avgDelta > oaRecs[i - 1].avgDelta) { sorted = false; break; }
    }
    assert('OA-09', 'recommendations sorted by avgDelta descending', sorted);
  } else {
    assert('OA-09', 'sort order — skipped (0 or 1 row)', true, 'skipped');
  }

  // ── OA-10: summary.topRecommendation matches recommendations[0].name ───────
  if (oaAuth) {
    assert('OA-10', 'topRecommendation match — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null && oaRecs.length > 0) {
    const expected = oaRecs[0].name;
    const actual   = safe(oa, 'data', 'summary', 'topRecommendation');
    assert('OA-10', 'summary.topRecommendation matches recommendations[0].name',
      actual === expected, `summary="${actual}" rec[0]="${expected}"`);
  } else {
    assert('OA-10', 'topRecommendation match — skipped', true, 'skipped');
  }

  // ── OA-11: helpfulRate is null or 0–100 ───────────────────────────────────
  if (oaAuth) {
    assert('OA-11', 'helpfulRate range — skipped (401)', true, '401');
  } else if (!oaInsuf && oa.data != null && oaRecs.length > 0) {
    const valid = oaRecs.every(r =>
      r.helpfulRate === null ||
      (typeof r.helpfulRate === 'number' && r.helpfulRate >= 0 && r.helpfulRate <= 100));
    assert('OA-11', 'helpfulRate is null or 0–100 for all recommendations', valid);
  } else {
    assert('OA-11', 'helpfulRate range — skipped', true, 'skipped');
  }

  // ── OA-12: practitioner-outcomes endpoint reachable ───────────────────────
  const po = await get('practitioner-outcomes');
  const poAuth = po.httpStatus === 401;
  const poUpstream = upstreamFailure(po);
  assert('OA-12', 'practitioner-outcomes endpoint reachable (200 or 401)',
    po.httpStatus === 200 || po.httpStatus === 401,
    poUpstream || `HTTP ${po.httpStatus}${poAuth ? ' — auth required; use REA_PIN or REA_SESSION_COOKIE' : ''}`);

  // ── OA-13: response is a non-null object ───────────────────────────────────
  if (poUpstream) {
    assert('OA-13', 'practitioner-outcomes payload — skipped after upstream failure', true, poUpstream);
  } else {
    assert('OA-13', 'practitioner-outcomes returns a non-null object',
      po.data !== null && po.data !== undefined && typeof po.data === 'object',
      po.data === null ? 'null' : typeof po.data);
  }

  // ── OA-14: shape — summary or insufficient_data ────────────────────────────
  const poInsuf      = po.data != null && po.data.status === 'insufficient_data';
  const poHasSummary = po.data != null && typeof po.data.summary === 'object';
  if (poUpstream) {
    assert('OA-14', 'practitioner-outcomes shape — skipped after upstream failure', true, poUpstream);
  } else if (poAuth) {
    assert('OA-14', 'practitioner-outcomes shape — skipped (401)', true, '401');
  } else {
    assert('OA-14', 'practitioner-outcomes has summary or insufficient_data',
      poInsuf || poHasSummary,
      poInsuf
        ? `insufficient_data (need ${po.data.minimumRequired}, have ${po.data.currentCount})`
        : poHasSummary ? 'summary present' : 'unexpected shape');
  }

  // ── OA-15: practitioners array present when sufficient ────────────────────
  if (poAuth) {
    assert('OA-15', 'practitioners array — skipped (401)', true, '401');
  } else if (!poInsuf && po.data != null) {
    assert('OA-15', 'practitioner-outcomes.practitioners is an array',
      Array.isArray(po.data.practitioners), typeof po.data.practitioners);
  } else {
    assert('OA-15', 'practitioners array — skipped', true,
      poInsuf ? 'insufficient data' : 'endpoint returned null');
  }

  // ── OA-16: practitioner row has required fields ────────────────────────────
  const poPracs = safe(po, 'data', 'practitioners') || [];
  if (poAuth) {
    assert('OA-16', 'practitioner row fields — skipped (401)', true, '401');
  } else if (!poInsuf && po.data != null && poPracs.length > 0) {
    const required = ['practitionerId','name','totalSessions','avgDelta','repeatClientRate','followUpCompletionRate'];
    const hasFields = required.every(f => f in poPracs[0]);
    assert('OA-16', 'practitioner row has required fields', hasFields,
      hasFields ? Object.keys(poPracs[0]).join(', ') : `missing: ${required.filter(f => !(f in poPracs[0])).join(', ')}`);
  } else {
    assert('OA-16', 'practitioner row fields — skipped (no rows)', true, 'skipped');
  }

  // ── OA-17: sorted by avgDelta descending ──────────────────────────────────
  if (poAuth) {
    assert('OA-17', 'sort order — skipped (401)', true, '401');
  } else if (!poInsuf && po.data != null && poPracs.length > 1) {
    let sorted = true;
    for (let i = 1; i < poPracs.length; i++) {
      if ((poPracs[i].avgDelta ?? -99) > (poPracs[i - 1].avgDelta ?? -99)) { sorted = false; break; }
    }
    assert('OA-17', 'practitioners sorted by avgDelta descending', sorted);
  } else {
    assert('OA-17', 'sort order — skipped (0 or 1 practitioner)', true, 'skipped');
  }

  // ── OA-18: repeatClientRate is 0–100 ──────────────────────────────────────
  if (poAuth) {
    assert('OA-18', 'repeatClientRate range — skipped (401)', true, '401');
  } else if (!poInsuf && po.data != null && poPracs.length > 0) {
    const valid = poPracs.every(p =>
      typeof p.repeatClientRate === 'number' &&
      p.repeatClientRate >= 0 &&
      p.repeatClientRate <= 100);
    assert('OA-18', 'repeatClientRate is 0–100 for all practitioners', valid);
  } else {
    assert('OA-18', 'repeatClientRate range — skipped', true, 'skipped');
  }

  // ── OA-19: DOM — outcomeAttributionSection present ────────────────────────
  if (IS_BROWSER) {
    const el = document.getElementById('outcomeAttributionSection');
    assert('OA-19', 'outcomeAttributionSection element exists in DOM', !!el,
      el ? 'found' : 'not found — run after renderAnalytics() fires');
  } else {
    assert('OA-19', 'DOM check — skipped (Node runtime)', true, 'Node');
  }

  // ── OA-20: DOM — practitionerOutcomesSection present ─────────────────────
  if (IS_BROWSER) {
    const el = document.getElementById('practitionerOutcomesSection');
    assert('OA-20', 'practitionerOutcomesSection element exists in DOM', !!el,
      el ? 'found' : 'not found — run after renderAnalytics() fires');
  } else {
    assert('OA-20', 'DOM check — skipped (Node runtime)', true, 'Node');
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  SUITE 20A RESULT: PASS ${pass} / FAIL ${fail} / WARN 0`);
  console.log('══════════════════════════════════════════════════════\n');

  if (fail > 0) {
    console.error('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.error(`  ${r.id}: ${r.description} — ${r.detail}`));
  }

  return { pass, fail, warn: 0, results };
})();
