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
    // Open profile: always use window.crmOpenProfile(id) directly — never rely on DOM
    // button clicks or search filter state left by prior phases.
    // Phase 4's scheduleCheckinFollowUp sets clientSearch="Jordan L." + rerenders,
    // leaving 0 client cards. Clearing the filter + fetching ID via API is deterministic.
    await check('Client profile modal opens', async () => {
      await page.click("button[onclick*=\"showTab('clients')\"]");
      await page.waitForSelector('#tab-clients', { state: 'visible', timeout: TIMEOUT });

      // Clear any stale search filter (scheduleCheckinFollowUp sets clientSearch to a
      // hardcoded name that has no DB match, producing 0 client cards)
      await page.evaluate(() => {
        const s = document.getElementById('clientSearch');
        if (s && s.value) { s.value = ''; if (typeof window.renderClients === 'function') window.renderClients(); }
      });

      // Resolve the client ID to open — prefer QA auto-client; otherwise fetch first
      // active client from the API rather than relying on DOM state
      let openId = qaAutoClientId;
      if (!openId) {
        openId = await page.evaluate(async (base) => {
          const tok = sessionStorage.getItem('rea_api_token') || '';
          try {
            const r = await fetch(base + '/.netlify/functions/clients', { headers: { 'X-Dashboard-Token': tok } });
            const d = await r.json();
            return (d.clients || [])[0]?.id || null;
          } catch { return null; }
        }, BASE_URL);
      }
      if (!openId) throw new Error('No client available -- API returned no clients');

      // Open modal directly via JS — independent of search filter or card DOM state
      await page.evaluate(async (id) => { if (typeof window.crmOpenProfile === 'function') await window.crmOpenProfile(id); }, openId);

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

    // Close modal — wrapped in try/catch so a crash from a prior timed-out
    // waitForFunction inside the page doesn't abort the rest of the suite
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } catch (_) {}

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
    'financial', 'communications', 'send-email',
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

  // PHASE 7 -- Financial Operations QA
  // QA Agent skills covered here:
  //   - schema validation   : all 7 financial tables reachable via API
  //   - API validation      : create/read endpoints respond with correct shapes
  //   - workflow validation : package → invoice → payment → ledger end-to-end
  //   - financial operations: packages, invoices, ledger, alerts, client summary
  //   - cleanup/isolation   : every QA record soft-deleted after the run
  //   - clear reporting     : PASS/FAIL/WARN/SKIP per check with actionable detail
  //
  // Project rule: every major module is validated across
  //   1. database (table accessible)   2. API/function (correct response shape)
  //   3. dashboard workflow (create → verify)   4. audit log   5. cleanup
  console.log('\n-- Phase 7: Financial Operations QA');

  const FIN = 'Financial:';

  function classifyFinError(status, body) {
    if (status === 0)   return 'Network error -- function unreachable';
    if (status === 404) return '404 -- function not deployed (check Netlify deployment)';
    if (status === 401) return '401 -- auth failed (RLS or service-role issue)';
    if (status === 500) {
      const msg = String((body && body.error) || '');
      if (msg.includes('does not exist') || msg.includes('PGRST204') || msg.includes('42P01'))
        return '500 -- missing table (run financial SQL migration in Supabase)';
      return '500 -- server error (check Netlify function logs): ' + msg.slice(0, 100);
    }
    return 'HTTP ' + status + ' -- ' + String((body && body.error) || '').slice(0, 80);
  }

  // Make authenticated API calls from within the Playwright browser context.
  // Parameters are serialized (no closure capture) — BASE_URL and token are passed explicitly.
  async function finReq(method, path, body) {
    return page.evaluate(async ([m, p, b, base, tok]) => {
      try {
        const opts = { method: m, headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': tok } };
        if (b) opts.body = JSON.stringify(b);
        const res = await fetch(base + p, opts);
        let data;
        try { data = await res.json(); } catch { data = {}; }
        return { s: res.status, b: data };
      } catch (e) { return { s: 0, b: { error: e.message } }; }
    }, [method, path, body || null, BASE_URL, token]);
  }

  let finClientId  = null;
  let finPackageId = null;
  let finInvoiceId = null;

  // ── A. Schema health ─────────────────────────────────────────────────────

  await check(FIN + ' Financial API deployed (overview)', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=overview');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!r.b.revenue || !r.b.packages || !r.b.invoices)
      throw new Error('overview missing revenue/packages/invoices keys -- dashboard wiring issue');
    return { detail: 'HTTP 200  migration_needed=' + !!r.b._migration_needed };
  });

  await check(FIN + ' packages table accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=packages');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.packages)) throw new Error('packages array missing -- API wiring issue');
    return { detail: r.b.packages.length + ' existing package(s)' };
  });

  await check(FIN + ' invoices table accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=invoices');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.invoices)) throw new Error('invoices array missing -- API wiring issue');
    return { detail: r.b.invoices.length + ' existing invoice(s)' };
  });

  await check(FIN + ' ledger_entries table accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=ledger');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.entries)) throw new Error('entries array missing -- API wiring issue');
    return { detail: r.b.entries.length + ' existing entry/entries' };
  });

  await check(FIN + ' financial_alerts table accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=alerts');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.alerts)) throw new Error('alerts array missing -- API wiring issue');
    return { detail: r.b.count + ' unread alert(s)' };
  });

  // ── B. Package workflow ───────────────────────────────────────────────────

  await check(FIN + ' Create QA financial test client', async () => {
    const r = await finReq('POST', '/.netlify/functions/clients', {
      full_name: 'QA Financial Test Client', tags: ['qa'], source: 'qa_financial',
      notes: 'Auto-created by financial QA -- safe to delete',
    });
    if (r.s !== 201 || !r.b.client || !r.b.client.id)
      throw new Error('Client creation failed: ' + (r.b.error || classifyFinError(r.s, r.b)));
    finClientId = r.b.client.id;
    return { detail: 'id=' + finClientId };
  });

  if (finClientId) {
    await check(FIN + ' Create QA test package', async () => {
      const r = await finReq('POST', '/.netlify/functions/financial?action=create_package', {
        client_id: finClientId, client_name: 'QA Financial Test Client',
        package_type: '3_session', purchase_price: 0,
        notes: 'QA Test Package -- auto-created by financial QA',
      });
      if (r.s !== 201 || !r.b.package || !r.b.package.id)
        throw new Error('Package creation failed: ' + (r.b.error || classifyFinError(r.s, r.b)));
      finPackageId = r.b.package.id;
      return { detail: 'id=' + finPackageId + '  type=' + r.b.package.package_type };
    });

    if (finPackageId) {
      await check(FIN + ' Verify package row and fields', async () => {
        const r = await finReq('GET', '/.netlify/functions/financial?section=packages&client_id=' + finClientId);
        if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
        const pkg = (r.b.packages || []).find(p => p.id === finPackageId);
        if (!pkg) throw new Error('Package row not found in response -- missing table or RLS issue');
        if (pkg.client_id !== finClientId) throw new Error('client_id mismatch -- data integrity issue');
        if (pkg.package_type !== '3_session') throw new Error('package_type mismatch -- data integrity issue');
        const rem = pkg.sessions_remaining !== undefined
          ? pkg.sessions_remaining
          : (pkg.sessions_included - pkg.sessions_used);
        return { detail: 'status=' + pkg.status + '  sessions_remaining=' + rem };
      });
    } else {
      record(FIN + ' Verify package row and fields', 'SKIP', 'Package creation failed -- skipping row verification');
    }

    // ── C. Invoice workflow ───────────────────────────────────────────────

    await check(FIN + ' Create QA test invoice', async () => {
      const r = await finReq('POST', '/.netlify/functions/financial?action=create_invoice', {
        client_id: finClientId, client_name: 'QA Financial Test Client',
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        notes: 'QA Test Invoice -- auto-created by financial QA',
      });
      if (r.s !== 201 || !r.b.invoice || !r.b.invoice.id)
        throw new Error('Invoice creation failed: ' + (r.b.error || classifyFinError(r.s, r.b)));
      finInvoiceId = r.b.invoice.id;
      return { detail: 'id=' + finInvoiceId + '  number=' + r.b.invoice.invoice_number + '  status=' + r.b.invoice.status };
    });

    if (finInvoiceId) {
      await check(FIN + ' Add invoice item', async () => {
        const r = await finReq('POST', '/.netlify/functions/financial?action=add_invoice_item', {
          invoice_id: finInvoiceId, description: 'QA Test Service Item', quantity: 1, unit_price: 75,
        });
        if (r.s !== 201 || !r.b.item || !r.b.item.id)
          throw new Error('Add item failed: ' + (r.b.error || classifyFinError(r.s, r.b)) + ' -- missing invoice_items table or column issue');
        return { detail: 'item id=' + r.b.item.id + '  new subtotal=$' + r.b.subtotal };
      });

      await check(FIN + ' Verify invoice row and nested items', async () => {
        const r = await finReq('GET', '/.netlify/functions/financial?section=invoices&client_id=' + finClientId);
        if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
        const inv = (r.b.invoices || []).find(i => i.id === finInvoiceId);
        if (!inv) throw new Error('Invoice not found in response -- RLS issue or missing table');
        if (inv.client_id !== finClientId) throw new Error('client_id mismatch -- data integrity issue');
        const items = inv.invoice_items || inv.items || [];
        if (items.length === 0) return { status: 'WARN', detail: 'invoice_items join returned 0 items -- check Supabase FK relationship wiring' };
        return { detail: 'subtotal=$' + inv.subtotal + '  items=' + items.length + '  status=' + inv.status };
      });

      // ── D. Ledger / payment workflow ──────────────────────────────────

      await check(FIN + ' Record payment on invoice', async () => {
        const r = await finReq('POST', '/.netlify/functions/financial?action=record_payment', {
          client_id: finClientId, client_name: 'QA Financial Test Client',
          invoice_id: finInvoiceId, amount: 75,
          notes: 'QA test payment -- auto-created by financial QA',
        });
        if (r.s !== 200 || !r.b.entry || !r.b.entry.id)
          throw new Error('Record payment failed: ' + (r.b.error || classifyFinError(r.s, r.b)) + ' -- missing ledger_entries table or column issue');
        return { detail: 'ledger entry id=' + r.b.entry.id + '  amount=$' + r.b.entry.amount + '  invoice_status=' + (r.b.invoice ? r.b.invoice.status : 'n/a') };
      });

      await check(FIN + ' Verify ledger entry exists and has correct fields', async () => {
        const r = await finReq('GET', '/.netlify/functions/financial?section=ledger&client_id=' + finClientId);
        if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
        const entries = r.b.entries || [];
        const payment = entries.find(e => e.entry_type === 'payment' && e.client_id === finClientId);
        if (!payment) throw new Error('Payment ledger entry not found -- missing row or RLS issue');
        if (typeof payment.amount !== 'number') throw new Error('amount field is not a number -- missing column or schema mismatch');
        if (typeof payment.balance_impact !== 'number')
          return { status: 'WARN', detail: 'balance_impact is not a number -- schema issue; entry_type=' + payment.entry_type };
        return { detail: 'amount=$' + payment.amount + '  balance_impact=' + payment.balance_impact + '  entry_type=' + payment.entry_type };
      });

    } else {
      ['Add invoice item', 'Verify invoice row and nested items',
       'Record payment on invoice', 'Verify ledger entry exists and has correct fields'
      ].forEach(n => record(FIN + ' ' + n, 'SKIP', 'Invoice creation failed -- skipping dependent checks'));
    }

    // ── E. Client financial summary ───────────────────────────────────────

    await check(FIN + ' Client financial summary', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=client_summary&client_id=' + finClientId);
      if (r.s === 400 && String((r.b && r.b.error) || '').toLowerCase().includes('section'))
        return { status: 'SKIP', detail: 'client_summary section not implemented -- not a blocking failure' };
      if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
      if (!r.b.financial) return { status: 'WARN', detail: 'financial key missing from summary response -- partial implementation' };
      const f = r.b.financial;
      return { detail: 'currentBalance=' + f.currentBalance + '  outstanding=$' + f.outstandingCharges + '  packages=' + (r.b.packages || []).length };
    });

    // ── F. Audit logging ─────────────────────────────────────────────────
    // audit_logs are written by financial.js but not exposed via a public API endpoint.
    // If financial records were created successfully we know the audit paths ran.
    // Mark WARN so the operator knows to confirm in Supabase dashboard.

    await check(FIN + ' Audit log coverage (financial actions)', async () => {
      if (!finPackageId && !finInvoiceId)
        return { status: 'SKIP', detail: 'No financial records were created -- cannot verify audit trail' };
      return {
        status: 'WARN',
        detail: 'audit_logs not exposed via API -- records expected for package=' + (finPackageId || 'n/a') +
                ' invoice=' + (finInvoiceId || 'n/a') + ' -- verify in Supabase dashboard > audit_logs table',
      };
    });

    // ── G. Cleanup ───────────────────────────────────────────────────────

    await check(FIN + ' Cleanup QA test data', async () => {
      const problems = [];

      if (finInvoiceId) {
        const r = await finReq('PATCH', '/.netlify/functions/financial?action=update_invoice&id=' + finInvoiceId,
          { status: 'cancelled', notes: 'QA test invoice -- cancelled by cleanup' });
        if (r.s !== 200) problems.push('invoice PATCH→cancelled failed HTTP ' + r.s + ' -- cleanup issue');
      }

      if (finPackageId) {
        const r = await finReq('PATCH', '/.netlify/functions/financial?action=update_package&id=' + finPackageId,
          { status: 'expired', notes: 'QA test package -- expired by cleanup' });
        if (r.s !== 200) problems.push('package PATCH→expired failed HTTP ' + r.s + ' -- cleanup issue');
      }

      if (finClientId) {
        // Try DELETE first; fall back to PATCH archive
        const rd = await finReq('DELETE', '/.netlify/functions/clients?id=' + finClientId, null);
        if (rd.s !== 200 && rd.s !== 204) {
          const rp = await finReq('PATCH', '/.netlify/functions/clients?id=' + finClientId, { status: 'archived' });
          if (rp.s !== 200) problems.push('QA client cleanup failed (DELETE=' + rd.s + ' PATCH=' + rp.s + ') -- set deleted_at manually in Supabase');
        }
      }

      // invoice_items and ledger_entries have no direct delete endpoint.
      // They are soft-isolated: parent invoice is cancelled, parent client is archived.
      const note = 'invoice_items + ledger_entries remain in DB (no delete API) -- acceptable; clear with next DB maintenance';

      if (problems.length > 0) return { status: 'WARN', detail: problems.join('; ') + '  |  ' + note };
      return { detail: 'invoice→cancelled  package→archived  client→soft-deleted.  ' + note };
    });

  } else {
    // QA client creation failed — skip all dependent financial checks
    const skipMsg = 'QA financial test client creation failed -- check clients API and Supabase connectivity';
    [
      'Create QA test package', 'Verify package row and fields',
      'Create QA test invoice', 'Add invoice item', 'Verify invoice row and nested items',
      'Record payment on invoice', 'Verify ledger entry exists and has correct fields',
      'Client financial summary', 'Audit log coverage (financial actions)', 'Cleanup QA test data',
    ].forEach(n => record(FIN + ' ' + n, 'SKIP', skipMsg));
  }

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

  // Financial Operations sub-report
  const finResults  = results.filter(r => r.name.startsWith('Financial:'));
  const finPass     = finResults.filter(r => r.status === 'PASS').length;
  const finFail     = finResults.filter(r => r.status === 'FAIL').length;
  const finWarn     = finResults.filter(r => r.status === 'WARN').length;
  const finSkip     = finResults.filter(r => r.status === 'SKIP').length;
  const FICONS      = { PASS: 'v', FAIL: 'x', WARN: '!', SKIP: '-' };
  if (finResults.length > 0) {
    console.log('\n=== FINANCIAL OPERATIONS QA ===');
    finResults.forEach(r => console.log(`  ${FICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('Financial: ', '')}`));
    console.log(`\n  Financial totals : PASS ${finPass}  FAIL ${finFail}  WARN ${finWarn}  SKIP ${finSkip}  / ${finResults.length} checks`);
  }

  const report = {
    timestamp: new Date().toISOString(), url: DASH_URL, overall,
    summary: { pass, fail, warn, skip, total: results.length },
    checks: results, consoleErrors, networkFails,
  };
  const reportFile = path.join(SHOTS_DIR, 'qa-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n  Screenshots : ${SHOTS_DIR}`);
  console.log(`  Report JSON : ${reportFile}`);

  // Persist result to Supabase via store-qa-result function.
  // Prefer the token acquired during PIN auth (already in sessionStorage, extracted at Phase 6).
  // Fall back to DASHBOARD_API_SECRET env var if set (CI environments with pre-set secrets).
  const storeToken = token || process.env.DASHBOARD_API_SECRET || '';
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
      const storeStatus = await new Promise((resolve) => {
        const req = https.request({ hostname: host, path: reqPath, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': storeToken, 'Content-Length': Buffer.byteLength(body) }
        }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', err => resolve({ status: 0, body: err.message }));
        req.write(body); req.end();
      });
      if (storeStatus.status === 201) {
        console.log('  QA result stored in Supabase  [HTTP 201]\n');
      } else {
        console.log(`  store-qa-result returned HTTP ${storeStatus.status}: ${storeStatus.body}\n`);
      }
    } catch (e) {
      console.log('  Could not store QA result:', e.message, '\n');
    }
  } else {
    console.log('  No auth token available -- PIN auth may have failed, skipping Supabase persist\n');
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('\nQA Agent crashed:\n', err); process.exit(2); });
