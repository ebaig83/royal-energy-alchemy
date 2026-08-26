const { chromium } = require('playwright');

const baseURL = process.env.PWA_BASE_URL || 'http://127.0.0.1:8098';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  const dashboardResponse = await context.request.get(`${baseURL}/dashboard.html`);
  if (!dashboardResponse.ok()) throw new Error('Dashboard did not load successfully');
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

  await page.goto(`${baseURL}/manifest.webmanifest`, { waitUntil: 'commit' });
  const serviceWorkerRegistered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return Boolean(registration.active || registration.waiting || registration.installing);
  });
  if (!serviceWorkerRegistered) throw new Error('Service worker did not register');

  const cacheNames = await page.evaluate(() => caches.keys());
  if (cacheNames.some((name) => name.startsWith('rea-dashboard-'))) {
    throw new Error('Dashboard service worker created an application cache');
  }

  console.log('PWA smoke test passed');
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
