const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'qa', 'node_modules', 'playwright'));
const base = 'http://127.0.0.1:4387/dashboard-p1.html?preview=1';

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
    let finished = false;
    const done = () => { if (!finished) { finished = true; resolve(); } };
    server.once('exit', done);
    try { server.kill('SIGTERM'); } catch { done(); }
    setTimeout(() => { try { server.kill('SIGKILL'); } catch {} done(); }, 1000).unref();
  });
}

const source = name => fs.readFileSync(path.join(root, name), 'utf8');

(async () => {
  const api = source('dashboard-p1/api.mjs');
  const app = source('dashboard-p1/app.mjs');
  const verifyPin = source('netlify/functions/verify-pin.js');
  const auth = source('netlify/functions/lib/auth.js');

  assert.match(api, /verify-pin'[\s\S]*method:'DELETE'/, 'client logout must use the approved endpoint with DELETE');
  assert.match(api, /credentials:'same-origin'/, 'logout must send only the protected same-origin cookie');
  assert.match(verifyPin, /method==='DELETE'/, 'server logout handler must exist');
  assert.match(verifyPin, /revoked_at/, 'server logout must revoke the current session');
  assert.match(verifyPin, /clearSessionCookie\(\)/, 'server logout must clear the session cookie');
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /Secure/);
  assert.match(auth, /SameSite=Strict/);
  assert.doesNotMatch(`${api}\n${app}`, /rea_admin_session|token_hash|document\.cookie/, 'session secrets must not enter client code');
  assert.match(app, /event\.persisted&&!preview/, 'bfcache restoration must revalidate authentication');
  assert.match(app, /if\(!data\)\{renderLogin/, 'history navigation must not render stale authenticated state');

  let server;
  let browser;
  try {
    server = cp.spawn(process.execPath, [path.join(__dirname, 'p1-preview-server.cjs')], { cwd: root, windowsHide: true, stdio: 'ignore' });
    await waitForPreview();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
    page.setDefaultTimeout(10000);
    let authenticated = true;
    let logoutCalls = 0;

    await page.route('**/.netlify/functions/**', route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith('/verify-pin') && request.method() === 'DELETE') {
        logoutCalls += 1;
        authenticated = false;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"logged_out":true}' });
      }
      if (pathname.endsWith('/p1-read-model')) {
        return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: authenticated ? '{}' : '{"error":"unauthorized"}' });
      }
      return route.abort();
    });

    await page.goto(`${base}#clients`, { waitUntil: 'domcontentloaded' });
    const trigger = page.locator('[data-profile-menu-button]');
    const menu = page.locator('#profile-account-menu');
    await trigger.waitFor();
    assert.equal(await menu.isHidden(), true, 'profile menu starts closed');

    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await menu.isVisible(), true);
    assert.equal(await page.locator(':focus').getAttribute('data-account-settings'), '');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-logout'), '');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isHidden(), true);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

    await trigger.click();
    await page.getByRole('heading', { name: 'Clients', exact: true }).click();
    assert.equal(await menu.isHidden(), true, 'click outside closes the menu');

    await trigger.click();
    await page.locator('[data-account-settings]').click();
    await page.getByRole('heading', { name: 'System', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '#system');
    await page.goBack();
    await page.getByRole('heading', { name: 'Clients', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByRole('heading', { name: 'Good morning, Daron', exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-profile-menu-button]').click();
    const box = await page.locator('#profile-account-menu').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390, 'mobile menu must stay within the viewport');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1512, height: 950 });
    await page.locator('[data-profile-menu-button]').click();
    await page.locator('[data-logout]').click();
    await page.locator('#sign-in').waitFor();
    assert.equal(logoutCalls, 1, 'logout must be submitted exactly once');
    assert.match(await page.locator('#login-error').innerText(), /signed out/i);

    await page.goBack();
    await page.locator('#sign-in').waitFor();
    assert.equal(await page.locator('aside[aria-label="Main navigation"]').count(), 0, 'Back must not restore the dashboard');
    const protectedStatus = await page.evaluate(() => fetch('/.netlify/functions/p1-read-model').then(response => response.status));
    assert.equal(protectedStatus, 401, 'protected access must be unauthorized after logout');

    console.log('PASS secure server logout, profile menu interaction, keyboard controls, responsive layout, sign-in return, and back-navigation protection');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopPreview(server);
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
