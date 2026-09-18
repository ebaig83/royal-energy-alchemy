'use strict';

// Real-browser route-precedence regression. Run with:
//   RECOVERY_ROUTE_BASE_URL=https://www.daronroyal.com node qa/practitioner-recovery-browser-test.cjs
// The test uses a synthetic fragment only; it never requests or prints a real token.
const assert=require('assert');
const {chromium}=require('playwright');

const baseURL=process.env.RECOVERY_ROUTE_BASE_URL||'http://127.0.0.1:8098';
const token='SyntheticTokenForBrowserRouteRegression_1234567890';

(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 let bootstrapRequests=0;
 page.on('request',request=>{if(request.url().includes('/.netlify/functions/p1-read-model'))bootstrapRequests++;});
 await page.goto(`${baseURL}/dashboard.html#reset=${token}`,{waitUntil:'networkidle'});
 await page.locator('#recovery-panel').waitFor({state:'visible'});
 assert.strictEqual(await page.locator('#reset-password-form').count(),1,'reset form must render for a valid synthetic token');
 assert.strictEqual(await page.locator('.main').count(),0,'authenticated dashboard must not render behind recovery');
 assert.strictEqual(new URL(page.url()).hash,'','reset fragment must be removed from browser URL');
 assert.strictEqual(bootstrapRequests,0,'recovery route must not bootstrap authenticated dashboard data');

 await page.goto(`${baseURL}/dashboard.html#reset=malformed`,{waitUntil:'networkidle'});
 await page.locator('#recovery-panel').waitFor({state:'visible'});
 assert.match(await page.locator('#recovery-panel').innerText(),/Reset link unavailable/);
 assert.strictEqual(await page.locator('.main').count(),0,'malformed reset route must not fall through to dashboard');
 assert.strictEqual(new URL(page.url()).hash,'','malformed reset fragment must be removed');
 console.log('PASS real-browser recovery route precedence: valid and malformed fragments suppress dashboard bootstrap and clear URL');
 await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
