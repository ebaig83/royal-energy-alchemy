#!/usr/bin/env node
'use strict';

// Read-only post-deploy smoke suite for the current P1 dashboard.
// It never submits booking, payment, appointment, client-edit, Calendar, or
// communication forms.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PIN = process.env.DASHBOARD_PIN;
const DASH_URL = (process.env.QA_URL || 'https://www.daronroyal.com/dashboard-p1.html').replace(/\/$/, '');
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS || 20000);
const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-p1-qa-'));
const failures = [];
let browser;
let page;

function report(ok, name, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push({ name, detail });
}

async function check(name, fn) {
  try { await fn(); report(true, name); }
  catch (error) { report(false, name, error.message); }
}

async function run() {
  if (!PIN) {
    console.error('ERROR: DASHBOARD_PIN environment variable is required.');
    process.exitCode = 2;
    return;
  }
  console.log('\n=== Royal Energy Alchemy -- P1 read-only QA ===');
  console.log(`  URL: ${DASH_URL}`);

  browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(TIMEOUT);
  const unexpectedWrites = [];
  page.on('request', request => {
    const method = request.method().toUpperCase();
    const pathname = new URL(request.url()).pathname;
    if (method !== 'GET' && !(method === 'POST' && pathname.endsWith('/verify-pin'))) {
      unexpectedWrites.push(`${method} ${pathname}`);
    }
  });

  await check('Dashboard page loads successfully', async () => {
    const response = await page.goto(DASH_URL, { waitUntil: 'domcontentloaded' });
    if (!response || !response.ok()) throw new Error(`HTTP ${response?.status() || 'unknown'}`);
    if (!(await page.title()).includes('Royal Energy Alchemy')) throw new Error('unexpected page title');
  });

  await check('Current P1 login gate is visible', async () => {
    await page.locator('#sign-in').waitFor();
    await page.locator('#admin-pin').waitFor();
  });

  await check('P1 authentication succeeds without exposing the PIN', async () => {
    await page.locator('#admin-pin').fill(PIN);
    await page.locator('#sign-in button[type="submit"]').click();
    await page.locator('aside[aria-label="Main navigation"] .nav').waitFor();
    await page.locator('#sign-in').waitFor({ state: 'detached' });
  });

  await check('Home dashboard renders', async () => {
    await page.getByRole('heading', { name: 'Good morning, Daron' }).waitFor();
    await page.locator('#view .metrics').waitFor();
    await page.locator('#view .today-layout').waitFor();
  });

  await check('Current navigation links work', async () => {
    for (const label of ['Today', 'Clients', 'Schedule', 'Communications', 'Finance', 'Content Studio', 'System']) {
      if (!(await page.getByRole('link', { name: label, exact: true }).count())) throw new Error(`missing ${label} navigation link`);
    }
    await page.getByRole('link', { name: 'System', exact: true }).click();
    await page.getByRole('heading', { name: 'System', exact: true }).waitFor();
  });

  await check('Agent Operations navigation and page work', async () => {
    const nav = page.locator('a[data-agent-operations-nav]');
    await nav.waitFor();
    await nav.click();
    await page.locator('#agent-operations-panel').waitFor();
    await page.locator('.agent-operations-cards').waitFor();
    if (!(await page.locator('#agent-operations-panel').innerText()).includes('Agent Operations')) throw new Error('Agent Operations content missing');
  });

  await check('Schedule page renders', async () => {
    await page.getByRole('link', { name: 'Schedule', exact: true }).click();
    await page.locator('#view .toolbar').waitFor();
    if (!(await page.locator('#view').innerText()).includes('appointments')) throw new Error('schedule content missing');
  });

  await check('QA performed no production mutations', async () => {
    if (unexpectedWrites.length) throw new Error(`unexpected write request(s): ${unexpectedWrites.join(', ')}`);
  });

  if (failures.length) await page.screenshot({ path: path.join(shotsDir, 'p1-qa-failure.png'), fullPage: true }).catch(() => {});
  console.log(`\nP1 read-only QA: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length ? `${failures.length} failure(s)` : 'all checks passed'})`);
  if (failures.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(`QA harness error: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
});
