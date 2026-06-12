#!/usr/bin/env node
'use strict';

// Load .env from the qa/ directory if present
const fs   = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

const { chromium } = require('playwright');

const PIN        = process.env.DASHBOARD_PIN;
const BASE_URL   = (process.env.QA_URL || 'https://royal-energy-alchemy.netlify.app/dashboard.html')
                     .replace(/\/dashboard\.html$/, '');
const DASH_URL   = BASE_URL + '/dashboard.html';
const SHOTS_DIR  = process.env.QA_SCREENSHOTS_DIR || path.join(__dirname, 'qa-screenshots');
const HEADLESS   = process.env.QA_HEADLESS !== 'false';
const TIMEOUT    = parseInt(process.env.QA_TIMEOUT_MS    || '20000', 10);
const AI_TIMEOUT = parseInt(process.env.QA_AI_TIMEOUT_MS || '35000', 10);

if (!PIN) {
  console.error('\nERROR: DASHBOARD_PIN environment variable is required.\n');
  process.exit(2);
}

const results       = [];
const consoleErrors = [];
const networkFails  = [];

function record(name, status, detail, screenshotPath) {
  results.push({ name, status, detail: detail || '', screenshot: screenshotPath || null });
  const ICONS = { PASS: 'v', FAIL: 'x', WARN: '!', SKIP: '-' };
  console.log(`  ${ICONS[status] || '?'} ${status.padEnd(5)} ${name}${detail ? '  --  ' + detail : ''}`);
}

async function screenshot(page, name) {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const file = path.join(SHOTS_DIR, `${String(results.length + 1).padStart(2, '0')}-${slug}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

async function check(name, fn, page, opts) {
  const timeoutMs = (opts && opts.aiCheck) ? AI_TIMEOUT : TIMEOUT;
  let screenshotPath = null;
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      ),
    ]);
    if (page) screenshotPath = await screenshot(page, name);
    record(name, result.status || 'PASS', result.detail || '', screenshotPath);
  } catch (err) {
    if (page) screenshotPath = await screenshot(page, name + '-fail').catch(() => null);
    record(name, 'FAIL', err.message, screenshotPath);
  }
}

async function run() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const page    = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('net::ERR_ABORTED') &&
          !text.includes('Content-Security-Policy') && !text.includes('Non-Error promise rejection') &&
          // Phase 6 health pings return 4xx for validation/method reasons — not real errors
          !text.includes('Failed to load resource: the server responded with a status of 4')) {
        consoleErrors.push(text.slice(0, 200));
      }
    }
  });
  page.on('pageerror', err => consoleErrors.push('PAGE_ERR: ' + err.message.slice(0, 200)));
  page.on('response', res => {
    const url = res.url(); const status = res.status();
    // 400 = validation error (deployed, correct behavior); 401 = auth; 405 = method not allowed
    if (url.includes('/.netlify/functions/') && status >= 400 && status !== 400 && status !== 401 && status !== 405) {
      networkFails.push(`${status} ${url.replace(/^.*\.netlify\/functions\//, 'fn/')}`);
    }
  });

  console.log('\n=== Royal Energy Alchemy -- Post-Deploy QA Agent ===');
  console.log(`  URL     : ${DASH_URL}`);
  console.log(`  Started : ${new Date().toISOString()}\n`);

  // PHASE 1 -- Page Load
  console.log('-- Phase 1: Page Load');

  await check('Dashboard page returns HTTP 200', async () => {
    const res = await page.goto(DASH_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    if (!res || !res.ok()) throw new Error('HTTP ' + (res ? res.status() : 'no response'));
    return { detail: 'HTTP ' + res.status() };
  }, page);

  await check('Page title contains Royal Energy Alchemy', async () => {
    const title = await page.title();
    if (!title.includes('Royal Energy Alchemy')) throw new Error('Got: ' + title);
    return { detail: title };
  });

  await check('Access gate visible before PIN', async () => {
    const gate = await page.$('#accessGate');
    if (!gate) throw new Error('#accessGate not found');
    if (!await gate.isVisible()) throw new Error('Gate hidden -- PIN lock not loading');
    return {};
  });

  // PHASE 2 -- PIN Authentication
  console.log('\n-- Phase 2: PIN Authentication');

  await check('PIN input accepts characters', async () => {
    const input = await page.$('#gatePass');
    if (!input) throw new Error('#gatePass not found');
    await input.fill(PIN);
    const val = await input.inputValue();
    if (!val) throw new Error('Input empty after fill');
    return { detail: val.length + ' chars' };
  });

  await check('PIN unlock hides gate', async () => {
    await page.press('#gatePass', 'Enter');
    // Wait for gate to be truly hidden — do NOT use !g.offsetParent because
    // position:fixed elements always have offsetParent===null even when visible.
    await page.waitForFunction(() => {
      const g = document.getElementById('accessGate');
      return !g || g.classList.contains('hidden') || g.style.display === 'none';
    }, { timeout: TIMEOUT });
    // Give initDashboard() one event-loop tick to start rendering
    await page.waitForTimeout(500);
    return {};
  }, page);

  await check('rea_api_token in sessionStorage', async () => {
    const token = await page.evaluate(() => sessionStorage.getItem('rea_api_token'));
    if (!token) throw new Error('Token null -- verify-pin failed');
    return { detail: 'length ' + token.length };
  });

  await check('No legacy rea_sb_token present', async () => {
    const old = await page.evaluate(() => sessionStorage.getItem('rea_sb_token'));
    if (old) throw new Error('rea_sb_token found -- auth migration incomplete');
    return { detail: 'Clean' };
  });

  // PHASE 3 -- Tab Navigation
  console.log('\n-- Phase 3: Tab Navigation');

  await check('Home tab is active by default', async () => {
    const tab = await page.$('#tab-home');
    if (!tab) throw new Error('#tab-home not in DOM');
    if (!await tab.isVisible()) throw new Error('Home tab hidden');
    return {};
  }, page);

  await check('Home: 5 action stats render', async () => {
    await page.waitForSelector('.action-stats', { timeout: TIMEOUT });
    const stats = await page.$$('.action-stat');
    if (stats.length < 5) throw new Error('Expected >=5, got ' + stats.length);
    return { detail: stats.length + ' stats' };
  });

  await check("Home: Schedule panel settles", async () => {
    await page.waitForFunction(() => { const e = document.getElementById('homeSched'); return e && !e.querySelector('.hshimmer'); }, { timeout: TIMEOUT });
    return {};
  });

  await check('Home: Urgent Attention panel settles', async () => {
    await page.waitForFunction(() => { const e = document.getElementById('homeFlags'); return e && !e.querySelector('.hshimmer'); }, { timeout: TIMEOUT });
    return {};
  });

  await check('Home: Recent Activity renders', async () => {
    await page.waitForFunction(() => { const e = document.getElementById('homeActivity'); return e && !e.querySelector('.hshimmer'); }, { timeout: TIMEOUT });
    return {};
  });

  await check('Home: Business Metrics visible', async () => {
    if (!await page.$('.biz-grid')) throw new Error('.biz-grid not found');
    const cells = await page.$$('.biz-metric');
    if (cells.length < 5) throw new Error('Expected >=5, got ' + cells.length);
    return { detail: cells.length + ' cells' };
  });

  await check('Check-In Responses tab loads', async () => {
    await page.click("button[onclick*=\"showTab('checkins')\"]");
    await page.waitForSelector('#tab-checkins', { state: 'visible', timeout: TIMEOUT });
    const cards = await page.$$('#tab-checkins .card');
    if (!cards.length) throw new Error('No check-in cards found');
    return { detail: cards.length + ' card(s)' };
  }, page);

  await check('Session Log tab renders', async () => {
    await page.click("button[onclick*=\"showTab('sessions')\"]");
    await page.waitForSelector('#tab-sessions', { state: 'visible', timeout: TIMEOUT });
    await page.waitForFunction(() => { const l = document.getElementById('sessionLog'); return l && l.innerHTML.trim().length > 10; }, { timeout: TIMEOUT });
    return {};
  }, page);

  let hasClients = false;
  await check('Clients tab: active filter default', async () => {
    await page.click("button[onclick*=\"showTab('clients')\"]");
    await page.waitForSelector('#tab-clients', { state: 'visible', timeout: TIMEOUT });
    await page.waitForFunction(() => {
      const r = document.getElementById('clientRoster');
      return r && (r.innerText || '').trim().length > 0 && !(r.innerText || '').includes('LOADING CLIENTS');
    }, { timeout: TIMEOUT });
    const filterVal = await page.$eval('#clientFilter', el => el.value);
    if (filterVal !== 'active') return { status: 'WARN', detail: 'Filter was "' + filterVal + '" not "active"' };
    const cards = await page.$$('#clientRoster .client-card');
    hasClients = cards.length > 0;
    return { detail: cards.length + ' client card(s)' };
  }, page);

  // PHASE 4 -- Button Interactions
  console.log('\n-- Phase 4: Button Interactions');

  await page.click("button[onclick*=\"showTab('checkins')\"]");
  await page.waitForSelector('#tab-checkins', { state: 'visible' });

  await check('View Full Response toggles label', async () => {
    const btn = await page.$('#tab-checkins button[onclick*="viewCheckinResponse"]');
    if (!btn) throw new Error('viewCheckinResponse button not found');
    const before = await btn.innerText();
    await btn.click();
    await page.waitForTimeout(300);
    const after = await btn.innerText();
    if (after === before && !after.includes('Collapse')) throw new Error('Label unchanged: "' + after + '"');
    return { detail: before + ' -> ' + after };
  }, page);

  await check('Schedule Follow-Up switches to Clients tab', async () => {
    await page.click("button[onclick*=\"showTab('checkins')\"]");
    await page.waitForSelector('#tab-checkins', { state: 'visible' });
    const btn = await page.$('#tab-checkins button[onclick*="scheduleCheckinFollowUp"]');
    if (!btn) throw new Error('scheduleCheckinFollowUp button not found');
    await btn.click();
    await page.waitForTimeout(600);
    const ok = await page.$eval('#tab-clients', el => el.style.display !== 'none' && el.classList.contains('active')).catch(() => false);
    if (!ok) throw new Error('Clients tab not visible after click');
    return {};
  }, page);

  // PHASE 5 -- AI Features
  console.log('\n-- Phase 5: Client Profile & AI Features');

  // If no production clients visible, create a minimal QA test client via API
  // so AI feature checks can always run (QA clients are filtered from the UI list
  // but can be opened directly via window.crmOpenProfile(id))
  let qaAutoClientId = null;
  if (!hasClients) {
    const created = await page.evaluate(async (baseUrl) => {
      const tok = sessionStorage.getItem('rea_api_token') || '';
      try {
        const cr = await fetch(baseUrl + '/.netlify/functions/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': tok },
          body: JSON.stringify({ full_name: 'QA Auto-Test [QA]', tags: ['qa', 'waiver'], source: 'qa_auto', notes: 'Auto-created by QA agent — safe to delete' }),
        });
        const cd = await cr.json();
        if (cr.status !== 201 || !cd.client?.id) return null;
        const clientId = cd.client.id;
        await fetch(baseUrl + '/.netlify/functions/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': tok },
          body: JSON.stringify({ client_id: clientId, client_name: 'QA Auto-Test [QA]', service: 'Distance Reiki', session_date: new Date().toISOString().slice(0, 10), status: 'completed', payment_status: 'paid', amount_due: 111, source: 'qa_auto' }),
        });
        return clientId;
      } catch { return null; }
    }, BASE_URL);
    if (created) { qaAutoClientId = created; hasClients = true; }
  }

  if (!hasClients) {
    const msg = 'No active clients and QA client creation failed -- check API';
    ['Client profile modal opens', 'Session Prep Brief generates', 'Attention Flags generate', 'Practitioner Timeline generates', 'AI Summary element present'].forEach(n => record(n, 'SKIP', msg));
  } else {
    // Open profile: use direct JS call for QA auto-client, click card for real clients
    await check('Client profile modal opens', async () => {
      if (qaAutoClientId) {
        await page.click("button[onclick*=\"showTab('clients')\"]");
        await page.waitForSelector('#tab-clients', { state: 'visible', timeout: TIMEOUT });
        await page.evaluate((id) => window.crmOpenProfile && window.crmOpenProfile(id), qaAutoClientId);
      } else {
        await page.click("button[onclick*=\"showTab('clients')\"]");
        await page.waitForSelector('#tab-clients', { state: 'visible' });
        await page.waitForFunction(() => document.querySelector('#clientRoster .client-card'), { timeout: TIMEOUT });
        const btn = await page.$('#clientRoster .client-card button[onclick*="crmOpenProfile"]');
        if (!btn) throw new Error('No Case File button found');
        await btn.click();
      }
      await page.waitForFunction(() => { const m = document.getElementById('crmProfileModal'); return m && m.classList.contains('open'); }, { timeout: TIMEOUT });
      return {};
    }, page);

    await check('Session Prep Brief generates', async () => {
      await page.waitForFunction(() => {
        const el = document.getElementById('crmPrepBriefWrap');
        return el && el.innerText.trim().length > 20 && !el.innerText.includes('Generating') && !el.querySelector('[class*="shimmer"]');
      }, { timeout: AI_TIMEOUT });
      const txt = await page.$eval('#crmPrepBriefWrap', e => e.innerText.trim());
      const err = /error|unavailable|failed/i.test(txt);
      return { status: err ? 'WARN' : 'PASS', detail: err ? 'Error state -- check ANTHROPIC_API_KEY' : txt.slice(0, 80) };
    }, page, { aiCheck: true });

    await check('Attention Flags generate', async () => {
      await page.waitForFunction(() => { const e = document.getElementById('crmAttentionFlagsWrap'); return e && e.innerText.trim().length > 10 && !e.querySelector('[class*="shimmer"]'); }, { timeout: AI_TIMEOUT });
      const txt = await page.$eval('#crmAttentionFlagsWrap', e => e.innerText.trim());
      const err = /^error|failed to load/i.test(txt);
      return { status: err ? 'WARN' : 'PASS', detail: err ? 'Error (deterministic fallback should work)' : txt.slice(0, 80) };
    }, page, { aiCheck: true });

    await check('Practitioner Timeline generates', async () => {
      await page.waitForFunction(() => { const e = document.getElementById('crmPractitionerTimelineWrap'); return e && e.innerText.trim().length > 10 && !e.querySelector('[class*="shimmer"]'); }, { timeout: AI_TIMEOUT });
      const txt = await page.$eval('#crmPractitionerTimelineWrap', e => e.innerText.trim());
      const err = /^error|failed to load/i.test(txt);
      return { status: err ? 'WARN' : 'PASS', detail: err ? 'Error (deterministic fallback should work)' : txt.slice(0, 80) };
    }, page, { aiCheck: true });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Check for AI Summary panel in the DOM (rendered by session log cards).
    // Use a short timeout — if not present, skip rather than fail; this UI feature
    // only renders when session cards exist and is covered by workflow-test.js.
    await check('AI Summary panel present in session log', async () => {
      const el = await page.$('.ai-summary-panel, .ai-summary-title, .ai-summary-actions');
      if (!el) return { status: 'SKIP', detail: 'No session cards in DOM — panel requires sessions in log' };
      return { detail: 'Found' };
    });
  }

  // PHASE 6 -- Netlify Function Health
  console.log('\n-- Phase 6: API & Function Health');

  const REQUIRED_FUNCTIONS = [
    'verify-pin', 'clients', 'sessions', 'daily-briefing',
    'session-prep-brief', 'client-attention-flags', 'client-practitioner-timeline',
    'generate-client-summary', 'timeline', 'aftercare', 'recommendations', 'session-notes',
  ];

  const token = await page.evaluate(() => sessionStorage.getItem('rea_api_token') || '');

  for (const fn of REQUIRED_FUNCTIONS) {
    await check('Function deployed: ' + fn, async () => {
      const fnUrl = BASE_URL + '/.netlify/functions/' + fn;
      const status = await page.evaluate(async ([url, tok]) => {
        try { return (await fetch(url, { headers: { 'X-Dashboard-Token': tok } })).status; }
        catch { return 0; }
      }, [fnUrl, token]);
      if (status === 0)   throw new Error('Network error -- unreachable');
      if (status === 404) throw new Error('404 -- not deployed');
      if (status === 500) throw new Error('500 -- function threw (check logs)');
      return { detail: 'HTTP ' + status };
    });
  }

  await check('No uncaught JS errors', async () => {
    if (!consoleErrors.length) return { detail: 'Console clean' };
    throw new Error(consoleErrors.length + ' error(s): ' + consoleErrors.slice(0, 3).map(e => e.slice(0, 80)).join(' | '));
  });

  await check('No unexpected function failures', async () => {
    if (!networkFails.length) return { detail: 'All OK' };
    throw new Error(networkFails.slice(0, 5).join(', '));
  });

  await browser.close();

  // Final report
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  const overall = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';

  console.log('\n=== QA Report ===');
  console.log(`  Overall : ${overall}`);
  console.log(`  Results : PASS ${pass}  FAIL ${fail}  WARN ${warn}  SKIP ${skip}  / ${results.length} checks`);
  console.log(`  Time    : ${new Date().toISOString()}`);
  if (fail > 0) { console.log('\n  FAILURES:'); results.filter(r => r.status === 'FAIL').forEach(r => console.log(`    x ${r.name}  --  ${r.detail}`)); }
  if (warn > 0) { console.log('\n  WARNINGS:'); results.filter(r => r.status === 'WARN').forEach(r => console.log(`    ! ${r.name}  --  ${r.detail}`)); }
  if (skip > 0) { console.log('\n  SKIPPED:'); results.filter(r => r.status === 'SKIP').forEach(r => console.log(`    - ${r.name}`)); }

  const report = {
    timestamp: new Date().toISOString(), url: DASH_URL, overall,
    summary: { pass, fail, warn, skip, total: results.length },
    checks: results, consoleErrors, networkFails,
  };
  const reportFile = path.join(SHOTS_DIR, 'qa-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n  Screenshots : ${SHOTS_DIR}`);
  console.log(`  Report JSON : ${reportFile}`);

  // Persist result to Supabase via store-qa-result function
  const storeToken = process.env.DASHBOARD_API_SECRET || '';
  if (storeToken) {
    try {
      const https = require('https');
      const body  = JSON.stringify({
        overall, summary: report.summary, checks: results,
        console_errors: consoleErrors, network_fails: networkFails,
        url: DASH_URL, git_sha: process.env.GITHUB_SHA || null,
        triggered_by: process.env.GITHUB_ACTIONS ? 'github_actions' : 'manual',
      });
      const storeUrl = (BASE_URL + '/.netlify/functions/store-qa-result').replace('https://', '');
      const [host, ...pathParts] = storeUrl.split('/');
      const reqPath = '/' + pathParts.join('/');
      await new Promise((resolve) => {
        const req = https.request({ hostname: host, path: reqPath, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': storeToken, 'Content-Length': Buffer.byteLength(body) }
        }, res => { res.resume(); resolve(); });
        req.on('error', () => resolve());
        req.write(body); req.end();
      });
      console.log('  QA result stored in Supabase\n');
    } catch (e) {
      console.log('  Could not store QA result:', e.message, '\n');
    }
  } else {
    console.log('  DASHBOARD_API_SECRET not set -- skipping Supabase persist\n');
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('\nQA Agent crashed:\n', err); process.exit(2); });
