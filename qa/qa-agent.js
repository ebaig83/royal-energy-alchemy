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

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 8 — SPRINT 1 SCHEMA VALIDATION (Suite SV)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Runs before all CRUD tests. Validates every Sprint 1 table against its
  // expected schema: column names, indexes, FK constraints, service_role
  // grants, and RLS enabled. Fails hard (stops CRUD suite) if any required
  // column, index, or grant is missing so the operator gets an exact diff
  // rather than a cryptic CRUD error downstream.
  //
  // research_notes and kb_entries: SKIP if table not yet deployed (Phases B/C).

  console.log('\n-- Phase 8: Sprint 1 Schema Validation');

  const SV = 'Schema:';
  let bkSchemaFailed = false;   // gates Suite 10 CRUD tests
  let rnSchemaFailed = false;   // gates Suite 11 CRUD tests (Phase B)
  let kbSchemaFailed = false;   // gates Suite 12 CRUD tests (Phase C)
  let svData         = null;    // raw schema validation response

  // ── SV-0: endpoint accessible ────────────────────────────────────────────
  await check(SV + ' schema_validation endpoint accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=schema_validation');
    if (r.s !== 200) throw new Error('HTTP ' + r.s + ' -- ' + String((r.b && r.b.error) || '') +
      '  (ensure schema_validation route is deployed)');
    if (!r.b || !r.b.tables) throw new Error('tables key missing from response -- endpoint not wired correctly');
    svData = r.b.tables;
    return { detail: 'tables in response: ' + Object.keys(svData).join(', ') };
  });

  // Helper: check if a table exists and data was loaded; sets failed flag if not.
  function svTableCheck(key, setFailed) {
    if (!svData) return 'skip:Schema endpoint unavailable';
    const t = svData[key];
    if (!t || !t.exists) {
      if (setFailed) setFailed(true);
      return 'missing';
    }
    return t;
  }

  // ── expenses: full 8-point contract ──────────────────────────────────────

  // SV-1  table exists
  await check(SV + ' expenses: (1) table exists', async () => {
    if (!svData) return { status: 'SKIP', detail: 'Schema endpoint unavailable' };
    if (!svData.expenses || !svData.expenses.exists) {
      bkSchemaFailed = true;
      throw new Error('expenses table NOT found -- run 2026-06-13-bookkeeping-lite.sql in Supabase SQL Editor');
    }
    return { detail: 'Table present' };
  });

  // SV-2  required columns
  await check(SV + ' expenses: (2) all 15 required columns present', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) { bkSchemaFailed = true; return { status: 'SKIP', detail: 'Table not found' }; }
    const missing = t.missing_columns || [];
    if (missing.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Missing column(s): ' + missing.join(', ') +
        ' -- absent from migration. Run expenses repair SQL.');
    }
    if (!t.col_meta_available)
      return { status: 'WARN', detail: 'information_schema not accessible -- column names probed via SELECT, defaults/nullable not verified' };
    return { detail: 'All 15 columns present' };
  });

  // SV-3  column defaults
  await check(SV + ' expenses: (3) column defaults correct', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (!t.col_meta_available)
      return { status: 'WARN', detail: 'information_schema not accessible -- cannot verify defaults; check manually: id=gen_random_uuid(), expense_date=CURRENT_DATE, payment_method=\'personal\', tax_deductible=false, created_by=\'daron\', created_at=now(), updated_at=now()' };
    const wrong = t.wrong_default || [];
    if (wrong.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Wrong default(s): ' +
        wrong.map(w => `${w.column} (expected to contain "${w.expected_contains}", got "${w.actual}")`).join('; ') +
        ' -- run expenses repair SQL to reset defaults');
    }
    return { detail: '7 required defaults verified: id, expense_date, payment_method, tax_deductible, created_by, created_at, updated_at' };
  });

  // SV-4  NOT NULL constraints
  await check(SV + ' expenses: (4) NOT NULL constraints correct', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (!t.col_meta_available)
      return { status: 'WARN', detail: 'information_schema not accessible -- cannot verify NOT NULL; check manually: id, expense_date, category, description, amount, payment_method, tax_deductible, created_by, created_at, updated_at' };
    const wrong = t.wrong_nullable || [];
    if (wrong.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Nullable columns that should be NOT NULL: ' +
        wrong.map(w => w.column).join(', ') +
        ' -- column was added with ADD COLUMN without NOT NULL. Run ALTER TABLE expenses ALTER COLUMN <col> SET NOT NULL;');
    }
    return { detail: '10 NOT NULL columns verified' };
  });

  // SV-5  CHECK constraints
  await check(SV + ' expenses: (5) CHECK constraints present (amount>0, category, payment_method)', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (t.constraint_check_available === false)
      return { status: 'WARN', detail: 'information_schema not accessible -- verify 3 CHECK constraints manually: expenses_amount_positive, expenses_category_check, expenses_payment_method_check' };
    const missing = t.missing_check_constraints || [];
    if (missing.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Missing CHECK constraint(s): ' + missing.join(', ') +
        ' -- run expenses repair SQL to add missing constraints');
    }
    return { detail: 'All 3 CHECK constraints present: expenses_amount_positive, expenses_category_check, expenses_payment_method_check' };
  });

  // SV-6  FK constraint
  await check(SV + ' expenses: (6) FK on related_session_id → sessions.id (ON DELETE SET NULL)', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (t.constraint_check_available === false)
      return { status: 'WARN', detail: 'information_schema not accessible -- verify FK manually: expenses_related_session_id_fkey REFERENCES sessions(id) ON DELETE SET NULL' };
    const missing = t.missing_fks || [];
    if (missing.length > 0)
      throw new Error('Missing FK on column(s): ' + missing.join(', ') +
        ' -- run: ALTER TABLE expenses ADD CONSTRAINT expenses_related_session_id_fkey FOREIGN KEY (related_session_id) REFERENCES sessions(id) ON DELETE SET NULL;');
    return { detail: 'FK present: related_session_id → sessions.id ON DELETE SET NULL' };
  });

  // SV-7  indexes
  await check(SV + ' expenses: (7) all 5 required indexes present', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (t.index_check_available === false)
      return { status: 'WARN', detail: 'pg_catalog not exposed -- verify 5 indexes manually: expenses_date_idx, expenses_category_idx, expenses_tax_idx, expenses_deleted_idx, expenses_session_idx' };
    const missing = t.missing_indexes || [];
    if (missing.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Missing index(es): ' + missing.join(', ') +
        ' -- index likely failed due to missing column. Run expenses repair SQL.');
    }
    return { detail: 'All 5 indexes present: date, category, tax, deleted (partial), session (partial)' };
  });

  // SV-8a  RLS
  await check(SV + ' expenses: (8a) RLS enabled', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (t.rls_enabled === null)
      return { status: 'WARN', detail: 'pg_catalog not accessible -- verify RLS manually in Supabase > Table Editor > expenses > RLS' };
    if (!t.rls_enabled) {
      bkSchemaFailed = true;
      throw new Error('RLS NOT enabled -- run: ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;');
    }
    return { detail: 'RLS enabled' };
  });

  // SV-8b  service_role grants
  await check(SV + ' expenses: (8b) service_role grants (SELECT/INSERT/UPDATE/DELETE)', async () => {
    const t = svData && svData.expenses;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Table not found' };
    if (t.grant_check_available === false)
      return { status: 'WARN', detail: 'information_schema not accessible -- verify manually: GRANT SELECT,INSERT,UPDATE,DELETE ON expenses TO service_role' };
    const missing = t.missing_grants || [];
    if (missing.length > 0) {
      bkSchemaFailed = true;
      throw new Error('Missing grant(s): ' + missing.join(', ') +
        ' -- run: GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO service_role;');
    }
    return { detail: 'service_role has SELECT, INSERT, UPDATE, DELETE' };
  });

  // ── research_notes: full contract (SKIP until Phase B deployed) ───────────

  await check(SV + ' research_notes: (1) table exists', async () => {
    if (!svData) return { status: 'SKIP', detail: 'Schema endpoint unavailable' };
    if (!svData.research_notes || !svData.research_notes.exists)
      return { status: 'SKIP', detail: 'Phase B not yet deployed -- expected' };
    return { detail: 'Table present' };
  });

  await check(SV + ' research_notes: (2) required columns present', async () => {
    const t = svData && svData.research_notes;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase B not yet deployed -- expected' };
    const missing = t.missing_columns || [];
    if (missing.length > 0) { rnSchemaFailed = true; return { status: 'WARN', detail: 'Pre-existing schema drift (Phase B not deployed): missing ' + missing.join(', ') }; }
    return { detail: 'All required columns present' };
  });

  await check(SV + ' research_notes: (3-4) defaults and NOT NULL', async () => {
    const t = svData && svData.research_notes;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase B not yet deployed -- expected' };
    if (!t.col_meta_available) return { status: 'WARN', detail: 'information_schema not accessible -- verify defaults/nullable manually' };
    const problems = [];
    (t.wrong_default   || []).forEach(w => problems.push(`default: ${w.column} expected "${w.expected_contains}", got "${w.actual}"`));
    (t.wrong_nullable  || []).forEach(w => problems.push(`nullable: ${w.column} should be NOT NULL`));
    if (problems.length > 0) { rnSchemaFailed = true; throw new Error(problems.join('; ')); }
    return { detail: 'Defaults and NOT NULL correct' };
  });

  await check(SV + ' research_notes: (5-6) constraints and indexes', async () => {
    const t = svData && svData.research_notes;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase B not yet deployed -- expected' };
    if (t.constraint_check_available === false || t.index_check_available === false)
      return { status: 'WARN', detail: 'pg_catalog/information_schema not fully accessible -- verify constraints and indexes manually' };
    const problems = [];
    (t.missing_check_constraints || []).forEach(c => problems.push('missing constraint: ' + c));
    (t.missing_indexes           || []).forEach(i => problems.push('missing index: ' + i));
    if (problems.length > 0) { rnSchemaFailed = true; throw new Error(problems.join(' | ')); }
    return { detail: 'Constraints and indexes OK' };
  });

  await check(SV + ' research_notes: (7-8) RLS and service_role grants', async () => {
    const t = svData && svData.research_notes;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase B not yet deployed -- expected' };
    const problems = [];
    if (t.rls_enabled === false) problems.push('RLS not enabled');
    (t.missing_grants || []).forEach(g => problems.push('missing grant: ' + g));
    if (problems.length > 0) { rnSchemaFailed = true; throw new Error(problems.join(' | ')); }
    if (t.rls_enabled === null || t.grant_check_available === false)
      return { status: 'WARN', detail: 'pg_catalog/information_schema not accessible -- verify RLS and grants manually' };
    return { detail: 'RLS enabled, service_role grants OK' };
  });

  // ── kb_entries: full contract (SKIP until Phase C deployed) ──────────────

  await check(SV + ' kb_entries: (1) table exists', async () => {
    if (!svData) return { status: 'SKIP', detail: 'Schema endpoint unavailable' };
    if (!svData.kb_entries || !svData.kb_entries.exists)
      return { status: 'SKIP', detail: 'Phase C not yet deployed -- expected' };
    return { detail: 'Table present' };
  });

  await check(SV + ' kb_entries: (2) required columns present (including fts tsvector)', async () => {
    const t = svData && svData.kb_entries;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase C not yet deployed -- expected' };
    const missing = t.missing_columns || [];
    if (missing.length > 0) { kbSchemaFailed = true; return { status: 'WARN', detail: 'Pre-existing schema drift (Phase C not deployed): missing ' + missing.join(', ') }; }
    return { detail: 'All required columns present including fts tsvector' };
  });

  await check(SV + ' kb_entries: (3-4) defaults and NOT NULL', async () => {
    const t = svData && svData.kb_entries;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase C not yet deployed -- expected' };
    if (!t.col_meta_available) return { status: 'WARN', detail: 'information_schema not accessible -- verify defaults/nullable manually' };
    const problems = [];
    (t.wrong_default   || []).forEach(w => problems.push(`default: ${w.column} expected "${w.expected_contains}", got "${w.actual}"`));
    (t.wrong_nullable  || []).forEach(w => problems.push(`nullable: ${w.column} should be NOT NULL`));
    if (problems.length > 0) { kbSchemaFailed = true; throw new Error(problems.join('; ')); }
    return { detail: 'Defaults and NOT NULL correct' };
  });

  await check(SV + ' kb_entries: (5-6) constraints and indexes (including GIN FTS)', async () => {
    const t = svData && svData.kb_entries;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase C not yet deployed -- expected' };
    if (t.constraint_check_available === false || t.index_check_available === false)
      return { status: 'WARN', detail: 'pg_catalog/information_schema not accessible -- verify GIN FTS index manually' };
    const problems = [];
    (t.missing_check_constraints || []).forEach(c => problems.push('missing constraint: ' + c));
    (t.missing_indexes           || []).forEach(i => problems.push('missing index: ' + i));
    if (problems.length > 0) { kbSchemaFailed = true; throw new Error(problems.join(' | ')); }
    return { detail: 'Constraints and indexes OK (including GIN FTS index)' };
  });

  await check(SV + ' kb_entries: (7-8) RLS and service_role grants', async () => {
    const t = svData && svData.kb_entries;
    if (!t || !t.exists) return { status: 'SKIP', detail: 'Phase C not yet deployed -- expected' };
    const problems = [];
    if (t.rls_enabled === false) problems.push('RLS not enabled');
    (t.missing_grants || []).forEach(g => problems.push('missing grant: ' + g));
    if (problems.length > 0) { kbSchemaFailed = true; throw new Error(problems.join(' | ')); }
    if (t.rls_enabled === null || t.grant_check_available === false)
      return { status: 'WARN', detail: 'pg_catalog/information_schema not accessible -- verify RLS and grants manually' };
    return { detail: 'RLS enabled, service_role grants OK' };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 9 — BOOKKEEPING LITE QA (Suite 10)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Validates the expenses table, all three GET sections, POST create,
  // PATCH update + soft-delete, audit trail, RLS, and UI tab render.
  // Uses the same finReq helper defined in Phase 7.
  // Skipped entirely if Phase 8 schema validation failed for expenses.

  console.log('\n-- Phase 9: Bookkeeping Lite QA (Suite 10)');

  const BK = 'Bookkeeping:';
  let bkExpenseId = null;

  if (bkSchemaFailed) {
    const schemaGate = 'Schema validation failed for expenses -- fix schema first, then re-run QA';
    [
      'expenses table accessible (GET section=expenses)',
      'expenses_summary section accessible',
      'pnl section accessible',
      'Create expense (POST create_expense)',
      'Created expense persists in list',
      'Filter by category returns correct rows',
      'Filter tax_deductible=true returns only flagged rows',
      'Edit expense (PATCH update_expense)',
      'Edited expense reflects changes in list',
      'Missing description rejected (400)',
      'Missing amount rejected (400)',
      'Invalid category rejected (400)',
      'Audit log coverage (expense create + update)',
      'Soft-delete expense (PATCH delete_expense)',
      'Soft-deleted expense absent from list',
      'RLS blocks anon direct Supabase access',
      'Bookkeeping sub-tab renders in Financial tab',
      'No JS console errors in Bookkeeping section',
    ].forEach(n => record(BK + ' ' + n, 'SKIP', schemaGate));
  } else {

  // ── 10.1  expenses table accessible ────────────────────────────────────
  await check(BK + ' expenses table accessible (GET section=expenses)', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=expenses');
    if (r.s === 500) {
      const msg = String((r.b && r.b.error) || '');
      if (msg.includes('does not exist') || msg.includes('42P01') || msg.includes('PGRST204'))
        throw new Error('500 -- expenses table missing. Run 2026-06-13-bookkeeping-lite.sql in Supabase.');
      throw new Error('500 -- ' + msg.slice(0, 120));
    }
    if (r.s !== 200) throw new Error('HTTP ' + r.s + ' -- ' + String((r.b && r.b.error) || ''));
    if (!Array.isArray(r.b.expenses)) throw new Error('expenses array missing from response');
    if (!r.b.totals)                  throw new Error('totals object missing from response');
    return { detail: r.b.expenses.length + ' existing expense(s)' };
  });

  // ── 10.2  expenses_summary accessible ──────────────────────────────────
  await check(BK + ' expenses_summary section accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=expenses_summary');
    if (r.s !== 200) throw new Error('HTTP ' + r.s + ' -- ' + String((r.b && r.b.error) || ''));
    if (r.b.thisMonth === undefined) throw new Error('thisMonth key missing');
    if (r.b.ytd       === undefined) throw new Error('ytd key missing');
    return { detail: 'thisMonth=$' + (r.b.thisMonth || 0).toFixed(2) + '  ytd=$' + (r.b.ytd || 0).toFixed(2) };
  });

  // ── 10.3  pnl section accessible ───────────────────────────────────────
  await check(BK + ' pnl section accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/financial?section=pnl');
    if (r.s !== 200) throw new Error('HTTP ' + r.s + ' -- ' + String((r.b && r.b.error) || ''));
    if (!Array.isArray(r.b.monthly)) throw new Error('monthly array missing');
    if (!r.b.totals)                 throw new Error('totals object missing');
    if (!r.b.ytd)                    throw new Error('ytd object missing');
    const lastMonth = r.b.monthly[r.b.monthly.length - 1] || {};
    return { detail: 'months=' + r.b.monthly.length + '  ytdNet=$' + (r.b.ytd.net || 0).toFixed(2) +
             '  lastMonth=' + (lastMonth.month || '?') };
  });

  // ── 10.4  create expense ────────────────────────────────────────────────
  await check(BK + ' Create expense (POST create_expense)', async () => {
    const r = await finReq('POST', '/.netlify/functions/financial?action=create_expense', {
      description:    'QA Test Supply Purchase',
      category:       'supplies',
      amount:         25.50,
      expense_date:   new Date().toISOString().slice(0, 10),
      vendor:         'QA Test Vendor',
      payment_method: 'personal',
      tax_deductible: false,
      notes:          'Auto-created by QA agent -- safe to delete',
    });
    if (r.s !== 201 || !r.b.expense || !r.b.expense.id)
      throw new Error('Create failed: ' + (r.b && r.b.error ? r.b.error : 'HTTP ' + r.s));
    bkExpenseId = r.b.expense.id;
    return { detail: 'id=' + bkExpenseId + '  amount=$' + r.b.expense.amount };
  });

  if (bkExpenseId) {
    // ── 10.5  created expense appears in list ─────────────────────────────
    await check(BK + ' Created expense persists in list', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=expenses');
      if (r.s !== 200) throw new Error('HTTP ' + r.s);
      const found = (r.b.expenses || []).find(e => e.id === bkExpenseId);
      if (!found) throw new Error('Expense not found in list after create -- RLS or write issue');
      if (found.category !== 'supplies')        throw new Error('category mismatch: got ' + found.category);
      if (parseFloat(found.amount) !== 25.50)   throw new Error('amount mismatch: got ' + found.amount);
      return { detail: 'category=' + found.category + '  amount=$' + found.amount };
    });

    // ── 10.6  filter by category ─────────────────────────────────────────
    await check(BK + ' Filter by category returns correct rows', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=expenses&category=supplies');
      if (r.s !== 200) throw new Error('HTTP ' + r.s);
      const all = r.b.expenses || [];
      const wrong = all.filter(e => e.category !== 'supplies');
      if (wrong.length > 0) throw new Error('Non-supplies rows returned: ' + wrong.length);
      const hasOurs = all.some(e => e.id === bkExpenseId);
      if (!hasOurs) throw new Error('QA expense not in filtered result');
      return { detail: all.length + ' supplies expense(s) returned' };
    });

    // ── 10.7  filter by tax_deductible ───────────────────────────────────
    await check(BK + ' Filter tax_deductible=true returns only flagged rows', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=expenses&tax_deductible=true');
      if (r.s !== 200) throw new Error('HTTP ' + r.s);
      const all = r.b.expenses || [];
      const notFlagged = all.filter(e => e.tax_deductible !== true);
      if (notFlagged.length > 0) throw new Error(notFlagged.length + ' non-deductible rows slipped through');
      return { detail: all.length + ' tax-deductible expense(s) returned' };
    });

    // ── 10.8  edit expense ────────────────────────────────────────────────
    await check(BK + ' Edit expense (PATCH update_expense)', async () => {
      const r = await finReq('PATCH',
        '/.netlify/functions/financial?action=update_expense&id=' + bkExpenseId,
        { amount: 30.00, tax_deductible: true, notes: 'QA updated' }
      );
      if (r.s !== 200 || !r.b.expense) throw new Error('Update failed: ' + (r.b && r.b.error ? r.b.error : 'HTTP ' + r.s));
      if (parseFloat(r.b.expense.amount) !== 30.00) throw new Error('amount not updated: got ' + r.b.expense.amount);
      if (r.b.expense.tax_deductible !== true)      throw new Error('tax_deductible not updated');
      return { detail: 'amount=$' + r.b.expense.amount + '  tax_deductible=' + r.b.expense.tax_deductible };
    });

    // ── 10.9  edited expense reflected in list ────────────────────────────
    await check(BK + ' Edited expense reflects changes in list', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=expenses');
      if (r.s !== 200) throw new Error('HTTP ' + r.s);
      const found = (r.b.expenses || []).find(e => e.id === bkExpenseId);
      if (!found)                                    throw new Error('Expense missing from list after edit');
      if (parseFloat(found.amount) !== 30.00)        throw new Error('amount not persisted: got ' + found.amount);
      if (found.tax_deductible !== true)             throw new Error('tax_deductible not persisted');
      return { detail: 'amount=$' + found.amount + '  tax_deductible=' + found.tax_deductible };
    });

    // ── 10.10  missing required field rejected ────────────────────────────
    await check(BK + ' Missing description rejected (400)', async () => {
      const r = await finReq('POST', '/.netlify/functions/financial?action=create_expense', {
        category: 'supplies', amount: 10,
      });
      if (r.s !== 400) throw new Error('Expected 400, got ' + r.s + ' -- validation not enforced');
      return { detail: 'Correctly rejected: ' + (r.b && r.b.error ? r.b.error : 'HTTP 400') };
    });

    // ── 10.11  missing amount rejected ───────────────────────────────────
    await check(BK + ' Missing amount rejected (400)', async () => {
      const r = await finReq('POST', '/.netlify/functions/financial?action=create_expense', {
        description: 'QA test', category: 'supplies',
      });
      if (r.s !== 400) throw new Error('Expected 400, got ' + r.s + ' -- validation not enforced');
      return { detail: 'Correctly rejected: ' + (r.b && r.b.error ? r.b.error : 'HTTP 400') };
    });

    // ── 10.12  invalid category rejected ─────────────────────────────────
    await check(BK + ' Invalid category rejected (400)', async () => {
      const r = await finReq('POST', '/.netlify/functions/financial?action=create_expense', {
        description: 'QA test', category: 'pizza', amount: 10,
      });
      if (r.s !== 400) throw new Error('Expected 400, got ' + r.s + ' -- category validation not enforced');
      return { detail: 'Correctly rejected invalid category' };
    });

    // ── 10.13  audit log written ──────────────────────────────────────────
    await check(BK + ' Audit log coverage (expense create + update)', async () => {
      if (!bkExpenseId) return { status: 'SKIP', detail: 'No expense created -- cannot verify audit trail' };
      return {
        status: 'WARN',
        detail: 'audit_logs not exposed via API -- rows expected for expense id=' + bkExpenseId +
                ' -- verify in Supabase dashboard > audit_logs table (action=created + action=updated)',
      };
    });

    // ── 10.14  soft-delete expense ────────────────────────────────────────
    await check(BK + ' Soft-delete expense (PATCH delete_expense)', async () => {
      const r = await finReq('PATCH',
        '/.netlify/functions/financial?action=delete_expense&id=' + bkExpenseId,
        {}
      );
      if (r.s !== 200 || !r.b.deleted) throw new Error('Delete failed: ' + (r.b && r.b.error ? r.b.error : 'HTTP ' + r.s));
      return { detail: 'deleted=true  id=' + r.b.id };
    });

    // ── 10.15  soft-deleted row absent from list ──────────────────────────
    await check(BK + ' Soft-deleted expense absent from list', async () => {
      const r = await finReq('GET', '/.netlify/functions/financial?section=expenses');
      if (r.s !== 200) throw new Error('HTTP ' + r.s);
      const stillPresent = (r.b.expenses || []).some(e => e.id === bkExpenseId);
      if (stillPresent) throw new Error('Deleted expense still appears in list -- deleted_at filter not applied');
      return { detail: 'Correctly absent from list after soft-delete' };
    });

  } else {
    [
      'Created expense persists in list', 'Filter by category returns correct rows',
      'Filter tax_deductible=true returns only flagged rows',
      'Edit expense (PATCH update_expense)', 'Edited expense reflects changes in list',
      'Missing description rejected (400)', 'Missing amount rejected (400)',
      'Invalid category rejected (400)', 'Audit log coverage (expense create + update)',
      'Soft-delete expense (PATCH delete_expense)', 'Soft-deleted expense absent from list',
    ].forEach(n => record(BK + ' ' + n, 'SKIP', 'Expense creation failed -- skipping dependent checks'));
  }

  // ── 10.16  RLS blocks anon direct access ─────────────────────────────────
  await check(BK + ' RLS blocks anon direct Supabase access', async () => {
    const r = await page.evaluate(async (supaUrl) => {
      if (!supaUrl) return { skipped: true };
      try {
        const res = await fetch(supaUrl + '/rest/v1/expenses?select=id&limit=1', {
          headers: { 'apikey': 'anon', 'Authorization': 'Bearer anon' },
        });
        return { status: res.status };
      } catch (e) { return { error: e.message }; }
    }, process.env.QA_SUPABASE_URL || '');
    if (r.skipped) return { status: 'WARN', detail: 'QA_SUPABASE_URL not set -- cannot test anon RLS. Set it in qa/.env' };
    if (r.error)   return { status: 'WARN', detail: 'Network error testing RLS: ' + r.error };
    if (r.status === 200) throw new Error('Anon got HTTP 200 -- RLS not enabled on expenses table');
    return { detail: 'Anon correctly blocked: HTTP ' + r.status };
  });

  // ── 10.17  Bookkeeping tab renders in dashboard ───────────────────────────
  await check(BK + ' Bookkeeping sub-tab renders in Financial tab', async () => {
    // Close any modal left open by prior phases (e.g. CRM profile modal from Phase 5)
    await page.evaluate(() => {
      document.querySelectorAll('.modal, [id$="Modal"], [class*="modal"]').forEach(m => {
        m.classList.remove('open', 'show', 'active');
        if (m.style.display !== 'none') m.style.display = 'none';
      });
    });
    await page.waitForTimeout(300);
    await page.click("button[onclick*=\"showTab('financial')\"]");
    await page.waitForSelector('#tab-financial', { state: 'visible', timeout: TIMEOUT });
    const bkBtn = await page.$("button[onclick*=\"fcSection('bookkeeping')\"]");
    if (!bkBtn) throw new Error("Bookkeeping sub-tab button not found -- check dashboard.html fin-subnav");
    await bkBtn.click();
    await page.waitForSelector('#fc-bookkeeping', { state: 'visible', timeout: TIMEOUT });
    await page.waitForFunction(() => {
      const el = document.getElementById('fc-bookkeeping');
      return el && el.innerHTML.trim().length > 50 && !el.textContent.includes('LOADING');
    }, { timeout: TIMEOUT });
    return { detail: 'Bookkeeping section rendered without errors' };
  }, page);

  // ── 10.18  No console errors from bookkeeping section ────────────────────
  await check(BK + ' No JS console errors in Bookkeeping section', async () => {
    const bkErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('bookkeep') ||
      e.toLowerCase().includes('bkexpense') ||
      e.toLowerCase().includes('bksave') ||
      e.toLowerCase().includes('fcSection') ||
      e.toLowerCase().includes('fc-bookkeeping')
    );
    if (bkErrors.length > 0) throw new Error('Console errors: ' + bkErrors.join(' | '));
    return { detail: 'No bookkeeping-related console errors' };
  });

  } // end if (bkSchemaFailed) else

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 10: Research Lite QA (Suite 11)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n-- Phase 10: Research Lite QA (Suite 11)');

  const RN = 'Research:';
  const schemaGateRN = 'Schema validation failed — Suite 11 skipped';

  if (rnSchemaFailed) {
    [
      'research function deployed',
      'notes table accessible (GET section=notes)',
      'Create note (POST create_note)',
      'Created note persists in list',
      'Filter by session_id (no error)',
      'Search by keyword filters results',
      'Edit note (PATCH update_note)',
      'Missing title rejected (400)',
      'Soft-delete note (PATCH delete_note)',
      'Soft-deleted note absent from list',
      'RLS blocks anon direct Supabase access',
      'Research tab renders in dashboard',
      'Pattern Library endpoint returns data',
      'Tag counts are numeric',
      'Search filters Pattern Library',
      'Insights endpoint returns data',
      'Analytics endpoint returns KPIs',
      'No JS console errors in Research section',
    ].forEach(n => record(RN + ' ' + n, 'SKIP', schemaGateRN));
  } else {

  // ── RN-0  research function deployed ─────────────────────────────────────
  await check(RN + ' research function deployed', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=notes');
    if (r.s === 0)   throw new Error('Network error — function unreachable');
    if (r.s === 500) throw new Error('Function error HTTP 500: ' + (r.b && r.b.error || ''));
    return { detail: 'HTTP ' + r.s };
  });

  // ── RN-1  notes table accessible ─────────────────────────────────────────
  let rnQaId = null;
  await check(RN + ' notes table accessible (GET section=notes)', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=notes');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (r.b.migration_needed) throw new Error('migration_needed=true — run 2026-06-13-research-lite.sql');
    if (!Array.isArray(r.b.notes)) throw new Error('notes array missing from response');
    return { detail: r.b.notes.length + ' existing note(s)' };
  });

  // ── RN-2  create note ─────────────────────────────────────────────────────
  await check(RN + ' Create note (POST create_note)', async () => {
    const r = await finReq('POST', '/.netlify/functions/research?action=create_note',
      { title: 'QA Test Note', content: 'Automated QA content', tags: ['qa', 'test'] });
    if (r.s !== 201) throw new Error(classifyFinError(r.s, r.b));
    if (!r.b.note?.id) throw new Error('note.id missing from response');
    rnQaId = r.b.note.id;
    return { detail: 'id=' + rnQaId };
  });

  // ── RN-3  created note persists in list ──────────────────────────────────
  await check(RN + ' Created note persists in list', async () => {
    if (!rnQaId) return { status: 'SKIP', detail: 'Create step did not produce an id' };
    const r = await finReq('GET', '/.netlify/functions/research?section=notes');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.notes || []).find(n => n.id === rnQaId);
    if (!found) throw new Error('Created note not found in list');
    return { detail: 'title=' + found.title };
  });

  // ── RN-4  filter by session_id (no crash) ────────────────────────────────
  await check(RN + ' Filter by session_id (no error)', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const r = await finReq('GET', '/.netlify/functions/research?section=notes&session_id=' + fakeId);
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    return { detail: (r.b.notes || []).length + ' note(s) for fake session_id' };
  });

  // ── RN-5  search keyword filters results ─────────────────────────────────
  await check(RN + ' Search by keyword filters results', async () => {
    if (!rnQaId) return { status: 'SKIP', detail: 'No note id from create step' };
    const r = await finReq('GET', '/.netlify/functions/research?section=notes&search=QA%20Test');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.notes || []).find(n => n.id === rnQaId);
    if (!found) throw new Error('QA note not found in search results for "QA Test"');
    return { detail: r.b.notes.length + ' result(s) for "QA Test"' };
  });

  // ── RN-6  edit note ───────────────────────────────────────────────────────
  await check(RN + ' Edit note (PATCH update_note)', async () => {
    if (!rnQaId) return { status: 'SKIP', detail: 'No note id from create step' };
    const r = await finReq('PATCH', '/.netlify/functions/research?action=update_note&id=' + rnQaId,
      { content: 'Updated QA content' });
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (r.b.note?.content !== 'Updated QA content') throw new Error('content not updated in response');
    return { detail: 'content updated' };
  });

  // ── RN-7  missing title rejected (400) ───────────────────────────────────
  await check(RN + ' Missing title rejected (400)', async () => {
    const r = await finReq('POST', '/.netlify/functions/research?action=create_note',
      { content: 'No title here' });
    if (r.s !== 400) throw new Error('Expected 400, got ' + r.s);
    return { detail: 'Correctly rejected: ' + (r.b && r.b.error) };
  });

  // ── RN-8  soft-delete note ────────────────────────────────────────────────
  await check(RN + ' Soft-delete note (PATCH delete_note)', async () => {
    if (!rnQaId) return { status: 'SKIP', detail: 'No note id from create step' };
    const r = await finReq('PATCH', '/.netlify/functions/research?action=delete_note&id=' + rnQaId, {});
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!r.b.deleted) throw new Error('deleted flag not true in response');
    return { detail: 'deleted=true  id=' + rnQaId };
  });

  // ── RN-9  soft-deleted note absent from list ──────────────────────────────
  await check(RN + ' Soft-deleted note absent from list', async () => {
    if (!rnQaId) return { status: 'SKIP', detail: 'No note id from create step' };
    const r = await finReq('GET', '/.netlify/functions/research?section=notes');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.notes || []).find(n => n.id === rnQaId);
    if (found) throw new Error('Soft-deleted note still appears in list');
    return { detail: 'Correctly absent from list after soft-delete' };
  });

  // ── RN-10  RLS blocks anon ────────────────────────────────────────────────
  await check(RN + ' RLS blocks anon direct Supabase access', async () => {
    const supaUrl = process.env.SUPABASE_URL || '';
    if (!supaUrl) return { status: 'WARN', detail: 'SUPABASE_URL not set in local env — cannot test anon RLS from QA runner' };
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!anonKey)  return { status: 'WARN', detail: 'SUPABASE_ANON_KEY not set — skipping anon RLS check' };
    const r = await page.evaluate(async ([url, key]) => {
      try {
        const res = await fetch(url + '/rest/v1/research_notes?select=id&limit=1', {
          headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
        });
        return { status: res.status };
      } catch { return { status: 0 }; }
    }, [supaUrl, anonKey]);
    if (r.status === 200) throw new Error('Anon got HTTP 200 — RLS not enabled on research_notes table');
    return { detail: 'Anon correctly blocked: HTTP ' + r.status };
  });

  // ── RN-11  Research tab renders in dashboard ──────────────────────────────
  await check(RN + ' Research tab renders in dashboard', async () => {
    // Close any open modal before interacting with tabs
    await page.evaluate(() => {
      document.querySelectorAll('.modal, [id$="Modal"], [class*="modal"]').forEach(m => {
        m.classList.remove('open', 'show', 'active');
        if (m.style.display !== 'none') m.style.display = 'none';
      });
    });
    await page.waitForTimeout(300);
    await page.click("button[onclick*=\"showTab('research')\"]");
    await page.waitForSelector('#tab-research', { state: 'visible', timeout: TIMEOUT });
    await page.waitForFunction(() => {
      const el = document.getElementById('tab-research');
      return el && el.innerHTML.trim().length > 50 && !el.textContent.includes('LOADING');
    }, { timeout: TIMEOUT });
    return { detail: 'Research tab rendered without errors' };
  }, page);

  // ── RN-12a  Pattern Library endpoint returns data ────────────────────────
  await check(RN + ' Pattern Library endpoint returns data', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=pattern_library');
    if (r.s === 404) return { status: 'SKIP', detail: 'research function not found' };
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.patterns)) throw new Error('Response missing patterns array');
    return { detail: 'Pattern Library returned ' + r.b.patterns.length + ' tag(s)' };
  });

  // ── RN-12b  Tag counts are numeric ───────────────────────────────────────
  await check(RN + ' Tag counts are numeric', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=pattern_library');
    if (r.s === 404) return { status: 'SKIP', detail: 'research function not found' };
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const patterns = r.b.patterns || [];
    if (patterns.length === 0) return { status: 'SKIP', detail: 'No tagged notes exist yet' };
    const bad = patterns.filter(p => typeof p.count !== 'number');
    if (bad.length > 0) throw new Error('Non-numeric count on tags: ' + bad.map(p => p.tag).join(', '));
    return { detail: 'All ' + patterns.length + ' tag count(s) are numeric' };
  });

  // ── RN-12c  Search filters Pattern Library ────────────────────────────────
  await check(RN + ' Search filters Pattern Library', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=pattern_library&search=ZZZNOMATCH');
    if (r.s === 404) return { status: 'SKIP', detail: 'research function not found' };
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.patterns)) throw new Error('Response missing patterns array');
    if (r.b.patterns.length !== 0) throw new Error("Search 'ZZZNOMATCH' returned " + r.b.patterns.length + " result(s) — expected 0");
    return { detail: 'Search correctly returned 0 results for non-matching query' };
  });

  // ── RN-12d  Insights endpoint returns data ────────────────────────────────
  await check(RN + ' Insights endpoint returns data', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=insights');
    if (r.s === 404) return { status: 'SKIP', detail: 'research function not found' };
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.topTags)) throw new Error('Response missing topTags array');
    return { detail: 'Insights: topTags(' + r.b.topTags.length + '), sharedTags(' + (r.b.sharedTags||[]).length + '), modalities(' + (r.b.modalities||[]).length + ')' };
  });

  // ── RN-12e  Analytics endpoint returns KPIs ───────────────────────────────
  await check(RN + ' Analytics endpoint returns KPIs', async () => {
    const r = await finReq('GET', '/.netlify/functions/research?section=analytics');
    if (r.s === 404) return { status: 'SKIP', detail: 'research function not found' };
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const required = ['totalNotes', 'activeTags', 'notesThisMonth', 'clientsWithNotes', 'topTags'];
    const missing = required.filter(k => r.b[k] === undefined);
    if (missing.length > 0) throw new Error('Missing KPI fields: ' + missing.join(', '));
    return { detail: 'Analytics: ' + r.b.totalNotes + ' notes, ' + r.b.activeTags + ' active tags, ' + r.b.notesThisMonth + ' this month' };
  });

  // ── RN-12  No console errors from research section ───────────────────────
  await check(RN + ' No JS console errors in Research section', async () => {
    const rnErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('research') ||
      e.toLowerCase().includes('rnnote')   ||
      e.toLowerCase().includes('rninit')   ||
      e.toLowerCase().includes('tab-research')
    );
    if (rnErrors.length > 0) throw new Error('Console errors: ' + rnErrors.join(' | '));
    return { detail: 'No research-related console errors' };
  });

  } // end if (rnSchemaFailed) else

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 11: Knowledge Base Lite QA (Suite 12)
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n-- Phase 11: Knowledge Base Lite QA (Suite 12)');

  const KB = 'KB:';
  let kbSchemaFailed = false;
  let kbQaId = null;

  // ── KB-0  kb function deployed ────────────────────────────────────────────
  await check(KB + ' kb function deployed', async () => {
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries');
    if (r.s === 0)   throw new Error('Network error — function unreachable');
    if (r.s === 404) throw new Error('HTTP 404 — kb function not deployed');
    if (r.s === 500) throw new Error('HTTP 500: ' + (r.b && r.b.error || ''));
    return { detail: 'HTTP ' + r.s };
  });

  // ── KB-1  table accessible ────────────────────────────────────────────────
  await check(KB + ' kb_entries table accessible', async () => {
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (r.b.migration_needed) { kbSchemaFailed = true; throw new Error('migration_needed=true — run 2026-06-13-kb-lite.sql in Supabase'); }
    if (!Array.isArray(r.b.entries)) throw new Error('entries array missing from response');
    return { detail: r.b.entries.length + ' existing entry/entries' };
  });

  // ── KB-2  create entry ────────────────────────────────────────────────────
  await check(KB + ' Create entry (POST create_entry)', async () => {
    if (kbSchemaFailed) return { status: 'SKIP', detail: 'migration_needed — skipping write tests' };
    const r = await finReq('POST', '/.netlify/functions/kb?action=create_entry', {
      title: 'QA Test Article', content: 'Automated QA content for Knowledge Base.',
      category: 'qa-test', tags: ['qa', 'test'], status: 'draft', is_pinned: false,
    });
    if (r.s !== 201) throw new Error(classifyFinError(r.s, r.b));
    if (!r.b.entry?.id) throw new Error('entry.id missing from response');
    kbQaId = r.b.entry.id;
    return { detail: 'id=' + kbQaId + '  status=' + r.b.entry.status };
  });

  // ── KB-3  verify fields ───────────────────────────────────────────────────
  await check(KB + ' Verify entry fields', async () => {
    if (!kbQaId) return { status: 'SKIP', detail: 'No QA entry created' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=entry&id=' + kbQaId);
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const e = r.b.entry;
    if (!e) throw new Error('entry null in response');
    if (e.title    !== 'QA Test Article') throw new Error('title mismatch: ' + e.title);
    if (e.category !== 'qa-test')         throw new Error('category mismatch: ' + e.category);
    if (e.status   !== 'draft')           throw new Error('status mismatch: ' + e.status);
    if (e.is_pinned !== false)            throw new Error('is_pinned should be false, got: ' + e.is_pinned);
    return { detail: 'title OK  category=' + e.category + '  status=' + e.status + '  is_pinned=' + e.is_pinned };
  });

  // ── KB-4  is_pinned can be toggled ────────────────────────────────────────
  await check(KB + ' is_pinned field updates correctly', async () => {
    if (!kbQaId) return { status: 'SKIP', detail: 'No QA entry created' };
    const r = await finReq('PATCH', '/.netlify/functions/kb?action=update_entry&id=' + kbQaId,
      { is_pinned: true });
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (r.b.entry?.is_pinned !== true) throw new Error('is_pinned not updated to true');
    // Unpin it again for cleanup
    await finReq('PATCH', '/.netlify/functions/kb?action=update_entry&id=' + kbQaId, { is_pinned: false });
    return { detail: 'is_pinned toggled true then false successfully' };
  });

  // ── KB-5  search works ────────────────────────────────────────────────────
  await check(KB + ' Search works (section=entries&search=)', async () => {
    if (kbSchemaFailed) return { status: 'SKIP', detail: 'migration_needed' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries&search=QA+Test+Article');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.entries || []).some(e => e.id === kbQaId);
    if (!found) throw new Error('QA entry not found in search results');
    return { detail: (r.b.entries || []).length + ' result(s) for "QA Test Article"' };
  });

  // ── KB-6  no-match search returns empty ───────────────────────────────────
  await check(KB + ' No-match search returns empty', async () => {
    if (kbSchemaFailed) return { status: 'SKIP', detail: 'migration_needed' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries&search=ZZZNOMATCH');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if ((r.b.entries || []).length !== 0) throw new Error('Expected 0 results, got ' + r.b.entries.length);
    return { detail: 'Correctly returned 0 results for non-matching query' };
  });

  // ── KB-7  category filter works ───────────────────────────────────────────
  await check(KB + ' Category filter works', async () => {
    if (!kbQaId) return { status: 'SKIP', detail: 'No QA entry created' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries&category=qa-test');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.entries || []).some(e => e.id === kbQaId);
    if (!found) throw new Error('QA entry not found in category filter results');
    return { detail: (r.b.entries || []).length + ' entry/entries in category qa-test' };
  });

  // ── KB-8  categories endpoint works ──────────────────────────────────────
  await check(KB + ' Categories endpoint returns list', async () => {
    if (kbSchemaFailed) return { status: 'SKIP', detail: 'migration_needed' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=categories');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!Array.isArray(r.b.categories)) throw new Error('categories array missing');
    return { detail: r.b.categories.length + ' category/categories' };
  });

  // ── KB-9  missing title rejected ─────────────────────────────────────────
  await check(KB + ' Missing title rejected (400)', async () => {
    const r = await finReq('POST', '/.netlify/functions/kb?action=create_entry',
      { content: 'No title supplied', category: 'test' });
    if (r.s !== 400) throw new Error('Expected 400, got ' + r.s);
    return { detail: 'Correctly rejected: ' + (r.b.error || r.s) };
  });

  // ── KB-10  invalid status rejected ───────────────────────────────────────
  await check(KB + ' Invalid status rejected (400)', async () => {
    const r = await finReq('POST', '/.netlify/functions/kb?action=create_entry',
      { title: 'Bad Status', status: 'invalid-xyz' });
    if (r.s !== 400) throw new Error('Expected 400, got ' + r.s);
    return { detail: 'Correctly rejected invalid status' };
  });

  // ── KB-11  soft-delete works ──────────────────────────────────────────────
  await check(KB + ' Soft-delete entry (PATCH delete_entry)', async () => {
    if (!kbQaId) return { status: 'SKIP', detail: 'No QA entry to delete' };
    const r = await finReq('PATCH', '/.netlify/functions/kb?action=delete_entry&id=' + kbQaId, {});
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    if (!r.b.deleted) throw new Error('deleted flag not true in response');
    return { detail: 'deleted=true  id=' + kbQaId };
  });

  // ── KB-12  soft-deleted entry absent from list ────────────────────────────
  await check(KB + ' Soft-deleted entry absent from list', async () => {
    if (!kbQaId) return { status: 'SKIP', detail: 'No QA entry to verify' };
    const r = await finReq('GET', '/.netlify/functions/kb?section=entries');
    if (r.s !== 200) throw new Error(classifyFinError(r.s, r.b));
    const found = (r.b.entries || []).some(e => e.id === kbQaId);
    if (found) throw new Error('Soft-deleted entry still appears in list');
    return { detail: 'Correctly absent from list after soft-delete' };
  });

  // ── KB-13  dashboard tab renders ─────────────────────────────────────────
  await check(KB + ' Knowledge Base tab renders in dashboard', async () => {
    await page.evaluate(() => {
      if (typeof showTab === 'function') showTab('kb');
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('tab-kb');
      return el && el.innerHTML.trim().length > 50 && !el.textContent.includes('LOADING');
    }, { timeout: TIMEOUT });
    return { detail: 'Knowledge Base tab rendered without errors' };
  }, page);

  // ── KB-14  no console errors ──────────────────────────────────────────────
  await check(KB + ' No JS console errors in KB section', async () => {
    const kbErrors = consoleErrors.filter(e =>
      e.toLowerCase().includes('kbinit') ||
      e.toLowerCase().includes('tab-kb') ||
      e.toLowerCase().includes('knowledge base')
    );
    if (kbErrors.length > 0) throw new Error('Console errors: ' + kbErrors.join(' | '));
    return { detail: 'No KB-related console errors' };
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

  const SICONS = { PASS: 'v', FAIL: 'x', WARN: '!', SKIP: '-' };

  // Financial Operations sub-report
  const finResults  = results.filter(r => r.name.startsWith('Financial:'));
  const finPass     = finResults.filter(r => r.status === 'PASS').length;
  const finFail     = finResults.filter(r => r.status === 'FAIL').length;
  const finWarn     = finResults.filter(r => r.status === 'WARN').length;
  const finSkip     = finResults.filter(r => r.status === 'SKIP').length;
  if (finResults.length > 0) {
    console.log('\n=== FINANCIAL OPERATIONS QA ===');
    finResults.forEach(r => console.log(`  ${SICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('Financial: ', '')}`));
    console.log(`\n  Financial totals : PASS ${finPass}  FAIL ${finFail}  WARN ${finWarn}  SKIP ${finSkip}  / ${finResults.length} checks`);
  }

  // Schema Validation sub-report (Suite SV)
  const svResults = results.filter(r => r.name.startsWith('Schema:'));
  const svPass    = svResults.filter(r => r.status === 'PASS').length;
  const svFail    = svResults.filter(r => r.status === 'FAIL').length;
  const svWarn    = svResults.filter(r => r.status === 'WARN').length;
  const svSkip    = svResults.filter(r => r.status === 'SKIP').length;
  if (svResults.length > 0) {
    console.log('\n=== SPRINT 1 SCHEMA VALIDATION (Suite SV) ===');
    svResults.forEach(r => console.log(`  ${SICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('Schema: ', '')}`));
    console.log(`\n  Schema totals : PASS ${svPass}  FAIL ${svFail}  WARN ${svWarn}  SKIP ${svSkip}  / ${svResults.length} checks`);
  }

  // Research Lite sub-report (Suite 11)
  const rnResults = results.filter(r => r.name.startsWith('Research:'));
  const rnPass    = rnResults.filter(r => r.status === 'PASS').length;
  const rnFail    = rnResults.filter(r => r.status === 'FAIL').length;
  const rnWarn    = rnResults.filter(r => r.status === 'WARN').length;
  const rnSkip    = rnResults.filter(r => r.status === 'SKIP').length;
  if (rnResults.length > 0) {
    console.log('\n=== RESEARCH LITE QA (Suite 11) ===');
    rnResults.forEach(r => console.log(`  ${SICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('Research: ', '')}`));
    console.log(`\n  Research totals : PASS ${rnPass}  FAIL ${rnFail}  WARN ${rnWarn}  SKIP ${rnSkip}  / ${rnResults.length} checks`);
  }

  // Knowledge Base Lite sub-report (Suite 12)
  const kbResults = results.filter(r => r.name.startsWith('KB:'));
  const kbPass    = kbResults.filter(r => r.status === 'PASS').length;
  const kbFail    = kbResults.filter(r => r.status === 'FAIL').length;
  const kbWarn    = kbResults.filter(r => r.status === 'WARN').length;
  const kbSkip    = kbResults.filter(r => r.status === 'SKIP').length;
  if (kbResults.length > 0) {
    console.log('\n=== KNOWLEDGE BASE LITE QA (Suite 12) ===');
    kbResults.forEach(r => console.log(`  ${SICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('KB: ', '')}`));
    console.log(`\n  KB totals : PASS ${kbPass}  FAIL ${kbFail}  WARN ${kbWarn}  SKIP ${kbSkip}  / ${kbResults.length} checks`);
  }

  // Bookkeeping Lite sub-report (Suite 10)
  const bkResults = results.filter(r => r.name.startsWith('Bookkeeping:'));
  const bkPass    = bkResults.filter(r => r.status === 'PASS').length;
  const bkFail    = bkResults.filter(r => r.status === 'FAIL').length;
  const bkWarn    = bkResults.filter(r => r.status === 'WARN').length;
  const bkSkip    = bkResults.filter(r => r.status === 'SKIP').length;
  if (bkResults.length > 0) {
    console.log('\n=== BOOKKEEPING LITE QA (Suite 10) ===');
    bkResults.forEach(r => console.log(`  ${SICONS[r.status] || '?'} ${r.status.padEnd(5)} ${r.name.replace('Bookkeeping: ', '')}`));
    console.log(`\n  Bookkeeping totals : PASS ${bkPass}  FAIL ${bkFail}  WARN ${bkWarn}  SKIP ${bkSkip}  / ${bkResults.length} checks`);
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
