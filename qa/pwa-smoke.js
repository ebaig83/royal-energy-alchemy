const { chromium } = require('playwright');

const baseURL = process.env.PWA_BASE_URL || 'http://127.0.0.1:8098';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.removeItem('rea_resolved_issues');
    sessionStorage.setItem('rea_pin_unlocked', String(Date.now()));
    sessionStorage.setItem('rea_api_token', 'smoke-test-invalid-token');
  });

  const navigationStarted = Date.now();
  const dashboardResponse = await page.goto(`${baseURL}/dashboard.html`, { waitUntil: 'load' });
  const loadMs = Date.now() - navigationStarted;
  if (!dashboardResponse?.ok()) throw new Error('Dashboard did not load successfully');
  if (loadMs > 10000) throw new Error(`Dashboard startup regression: ${loadMs}ms`);
  const dashboardHTML = await dashboardResponse.text();

  const manifestHref = dashboardHTML.match(/<link rel="manifest" href="([^"]+)">/)?.[1];
  if (manifestHref !== '/manifest.webmanifest') throw new Error('Manifest link is missing');

  const manifestResponse = await page.request.get(`${baseURL}${manifestHref}`);
  const manifest = await manifestResponse.json();
  if (manifest.start_url !== '/dashboard.html' || manifest.display !== 'standalone') {
    throw new Error('Manifest does not launch the standalone dashboard');
  }

  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(`${baseURL}${icon.src}`);
    if (!iconResponse.ok()) throw new Error(`Icon failed to load: ${icon.src}`);
  }

  if (!dashboardHTML.includes('id="accessGate"') || !dashboardHTML.includes('src="pin-lock.js"')) {
    throw new Error('Dashboard authentication gate is missing');
  }

  const serviceWorkerSource = await (await page.request.get(`${baseURL}/service-worker.js`)).text();
  if (/addEventListener\s*\(\s*['"]fetch['"]/.test(serviceWorkerSource)) {
    throw new Error('Dashboard service worker must not register a fetch handler');
  }

  const serviceWorkerRegistered = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const registration = await navigator.serviceWorker.getRegistration('/');
    return Boolean(registration.active || registration.waiting || registration.installing);
  });
  if (!serviceWorkerRegistered) throw new Error('Service worker did not register');

  const cacheNames = await page.evaluate(() => caches.keys());
  if (cacheNames.some((name) => name.startsWith('rea-dashboard-'))) {
    throw new Error('Dashboard service worker created an application cache');
  }

  for (const tabName of ['clients', 'booking']) {
    await page.locator(`.ck-nav-item[onclick="showTab('${tabName}')"]`).click();
    const active = await page.locator(`#tab-${tabName}`).evaluate((element) =>
      element.classList.contains('active') && getComputedStyle(element).display !== 'none'
    );
    if (!active) throw new Error(`${tabName} tab did not become active`);
  }

  if (pageErrors.length) throw new Error(`Critical browser errors: ${pageErrors.join('; ')}`);

  console.log(`PWA smoke test passed (${loadMs}ms startup)`);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
