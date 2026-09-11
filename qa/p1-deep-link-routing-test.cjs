const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'qa', 'node_modules', 'playwright'));
const base = 'http://127.0.0.1:4387/dashboard-p1.html';

async function waitForPreview(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview server did not become ready.');
}

async function stopPreview(server) {
  if (!server || server.killed) return;
  await new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    server.once('exit', finish);
    try { server.kill('SIGTERM'); } catch { finish(); }
    setTimeout(() => { try { server.kill('SIGKILL'); } catch {} finish(); }, 1000).unref();
  });
}

const agentState = {
  agents: [
    { agentKey: 'manager', agentName: 'Spirit', agentRole: 'Manager', avatar: '/assets/agent-spirit.svg', branch: 'agent/manager', status: 'idle', staleness: { label: 'No heartbeat', ageMinutes: null }, currentTaskSummary: 'Manager task', latestHandoffSummary: 'Manager handoff', blockerSummary: null, lastTestSummary: 'Passed', lastAgentCommit: 'abcdef1', managerReviewStatus: 'approved', productionStatus: 'deployed' },
    { agentKey: 'dashboard', agentName: 'Stuart', agentRole: 'Dashboard', avatar: '/assets/agent-stuart.svg', branch: 'agent/dashboard', status: 'working', staleness: { label: 'Live/Recent', ageMinutes: 2 }, currentTaskSummary: 'Dashboard task', latestHandoffSummary: 'Dashboard handoff', blockerSummary: null, lastTestSummary: 'Passed', lastAgentCommit: 'abcdef2', managerReviewStatus: 'pending', productionStatus: 'not-deployed' },
    { agentKey: 'website', agentName: 'Kevin', agentRole: 'Website', avatar: '/assets/agent-kevin.svg', branch: 'agent/website', status: 'idle', staleness: { label: 'Stale', ageMinutes: 30 }, currentTaskSummary: 'Website task', latestHandoffSummary: 'Website handoff', blockerSummary: null, lastTestSummary: 'Passed', lastAgentCommit: 'abcdef3', managerReviewStatus: 'approved', productionStatus: 'deployed' },
  ],
  recentHandoffs: [], activeBlockers: [], approvalsPending: 0, releaseAuthority: 'Manager Agent', daronStatus: 'All systems operational.',
  managerState: { releaseApproval: 'approved', deployStatus: 'ready', productionHealthSummary: 'Healthy', finalBlockerSummary: null },
  managerCommunication: { unreadCount: 0, newest: null, history: [] },
};

(async () => {
  const { sampleData } = await import(pathToFileURL(path.join(root, 'dashboard-p1', 'fixture.mjs')).href);
  const sample = sampleData();
  const readModel = { ...sample, now: sample.now.toISOString() };
  let server, browser;
  const writes = [];

  async function openRoute(hash, initiallyAuthenticated = false) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    let authenticated = initiallyAuthenticated;
    await page.route('**/.netlify/functions/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method().toUpperCase();
      if (method !== 'GET' && !(method === 'POST' && pathname.endsWith('/verify-pin'))) writes.push(`${method} ${pathname}`);
      if (pathname.endsWith('/verify-pin')) {
        authenticated = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"authenticated":true}' });
      }
      if (!authenticated) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
      if (pathname.endsWith('/p1-read-model')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(readModel) });
      if (pathname.endsWith('/agent-operations')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentState) });
      return route.abort();
    });
    await page.goto(`${base}${hash}`, { waitUntil: 'domcontentloaded' });
    if (!initiallyAuthenticated) {
      await page.locator('#sign-in').waitFor();
      await page.locator('#admin-pin').fill('local-auth-fixture');
      await page.locator('#sign-in button[type="submit"]').click();
      await page.locator('aside[aria-label="Main navigation"]').waitFor();
    }
    return { context, page };
  }

  async function expectRoute(page, key, heading) {
    await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
    const active = page.locator('nav a[aria-current="page"]');
    assert.equal(await active.count(), 1);
    assert.equal((await active.innerText()).trim().replace(/^✦\s*/, ''), heading === 'Good morning, Daron' ? 'Today' : heading);
    if (key === 'agent-operations') await page.locator('.agent-operations-cards').waitFor();
  }

  try {
    server = cp.spawn(process.execPath, [path.join(__dirname, 'p1-preview-server.cjs')], { cwd: root, windowsHide: true, stdio: 'ignore' });
    await waitForPreview();
    browser = await chromium.launch({ channel: 'msedge', headless: true });

    for (const [hash, key, heading] of [['#agent-operations', 'agent-operations', 'Agent Operations'], ['#schedule', 'schedule', 'Schedule'], ['#clients', 'clients', 'Clients']]) {
      const { context, page } = await openRoute(hash, false);
      await expectRoute(page, key, heading);
      await context.close();
    }

    const direct = await openRoute('#agent-operations', true);
    await expectRoute(direct.page, 'agent-operations', 'Agent Operations');
    await direct.page.reload({ waitUntil: 'domcontentloaded' });
    await expectRoute(direct.page, 'agent-operations', 'Agent Operations');
    await direct.context.close();

    const unknown = await openRoute('#not-a-dashboard-route', true);
    await expectRoute(unknown.page, 'today', 'Good morning, Daron');
    await unknown.context.close();

    const normal = await openRoute('', true);
    await expectRoute(normal.page, 'today', 'Good morning, Daron');
    for (const [label, key] of [['Clients', 'clients'], ['Schedule', 'schedule'], ['Agent Operations', 'agent-operations']]) {
      const link = key === 'agent-operations' ? normal.page.locator('a[data-agent-operations-nav]') : normal.page.getByRole('link', { name: label, exact: true });
      await link.click();
      await expectRoute(normal.page, key, label);
    }
    await normal.context.close();

    assert.deepEqual(writes, []);
    console.log('PASS signed-out/authenticated deep links, refresh persistence, unknown fallback, active navigation sync, and normal routing with zero production writes');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopPreview(server);
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
