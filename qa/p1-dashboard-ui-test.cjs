const path=require('path'),fs=require('fs'),assert=require('assert'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const {chromium}=require(path.join(ROOT,'qa/node_modules/playwright'));
const out=path.join(require('os').tmpdir(),'royal-energy-alchemy-p1-preview');fs.mkdirSync(out,{recursive:true});
const PREVIEW_URL='http://127.0.0.1:4387/dashboard-p1.html?preview=1';
async function waitForPreview(url,timeoutMs=10000){const deadline=Date.now()+timeoutMs;let lastError='not ready';while(Date.now()<deadline){try{const response=await fetch(url);if(response.ok)return;lastError=`HTTP ${response.status}`;}catch(error){lastError=error.message;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Preview server readiness timeout after ${timeoutMs}ms (${lastError})`);}
async function stopPreview(server){if(!server||server.killed)return;await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(force);resolve();};server.once('exit',finish);try{server.kill('SIGTERM');}catch{}const force=setTimeout(()=>{if(server.killed)return finish();try{if(process.platform==='win32')cp.spawnSync(process.env.ComSpec,['/d','/s','/c','taskkill /PID '+server.pid+' /T /F'],{windowsHide:true});else server.kill('SIGKILL');}catch{}finish();},1000);force.unref();});}
(async()=>{
 let server,serverOutput='',browser,page;
 try{
 server=cp.spawn(process.execPath,[path.join(__dirname,'p1-preview-server.cjs')],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',chunk=>{serverOutput+=chunk.toString();});server.stderr.on('data',chunk=>{serverOutput+=chunk.toString();});await waitForPreview(PREVIEW_URL);
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1512,height:1100}});page.setDefaultTimeout(10000);const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push({host:u.hostname,path:u.pathname,method:route.request().method()});if(u.hostname!=='127.0.0.1'||route.request().method()!=='GET')return route.abort();return route.continue();});
 await page.goto(PREVIEW_URL);await page.getByRole('heading',{name:'Good morning, Daron'}).waitFor();
 assert.equal(await page.locator('nav a').count(),7);assert.equal(await page.locator('nav').innerText(),'Today\nClients\nSchedule\nCommunications\nFinance\nContent Studio\nSystem');
 await page.screenshot({path:path.join(out,'today-desktop.png'),fullPage:true});
 await page.getByRole('link',{name:'Clients',exact:true}).click();await page.getByRole('searchbox').fill('Ava Martinez');assert.equal(await page.locator('.client-card').count(),2);
 await page.locator('.client-card').first().getByRole('button',{name:'Open case file'}).click();await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'Related Clients',exact:true}).click();assert((await page.getByRole('dialog').innerText()).includes('No confirmed relationships'));
 await page.getByRole('button',{name:'Sessions',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('.session-row').count(),1);
 await page.screenshot({path:path.join(out,'client-case-file.png'),fullPage:true});
 await page.getByRole('button',{name:'Close details'}).focus();await page.keyboard.press('Shift+Tab');assert(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('link',{name:'Schedule',exact:true}).click();await page.getByRole('button',{name:'Today',exact:true}).click();assert(!(await page.locator('#view').innerText()).includes('[QA]'));
 await page.getByRole('checkbox',{name:'Include QA/Test'}).check();assert((await page.locator('#view').innerText()).includes('[QA]'));await page.getByRole('checkbox',{name:'Include QA/Test'}).uncheck();
  await page.getByRole('button',{name:'View Daniel Kim',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('button:not([disabled])').filter({hasText:'Reschedule'}).count(),0);assert.equal(await page.getByRole('dialog').locator('button:not([disabled])').filter({hasText:'Join Meet'}).count(),0);await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'Communications',exact:true}).click();await page.getByLabel('Delivery',{exact:true}).selectOption('failed');assert.equal(await page.locator('tbody tr').count(),1);
 await page.getByRole('link',{name:'Finance',exact:true}).click();await page.getByText('$270.00',{exact:true}).waitFor();assert((await page.locator('#view').innerText()).includes('$270.00'));await page.screenshot({path:path.join(out,'finance-desktop.png'),fullPage:true});
 await page.getByRole('link',{name:'System',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#view')?.innerText.includes('Not checked'));assert((await page.locator('#view').innerText()).includes('Not checked'));
 await page.getByRole('link',{name:'Today',exact:true}).click();await page.getByRole('button',{name:'+ Add appointment'}).click();assert((await page.locator('#notice').innerText()).includes('No production action'));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'today-mobile.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('link',{name:'Clients',exact:true}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 const unnamed=await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.getAttribute('aria-label')&&!b.textContent.trim()).length);assert.equal(unnamed,0);
 assert.equal(errors.length,0,errors.join('\n'));assert(requests.every(r=>r.host==='127.0.0.1'&&r.method==='GET'));assert(!requests.some(r=>r.path.includes('.netlify')));
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:true,checks:['six routes','same-name clients remain separate','case tabs','ID session history','dialog focus containment','Escape','QA opt-in','planner action suppression','message filtering','revenue separation','unknown system health','no-op review actions','mobile overflow','named buttons','zero JavaScript errors','zero provider/API requests'],requests:requests.length,errors},null,2));
 console.log('PASS desktop/mobile review, case-file relationships, keyboard/dialog checks, zero API/provider requests');
 }catch(error){if(serverOutput.trim())error.message+=`\nPreview server output: ${serverOutput.trim()}`;throw error;}
 finally{if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await stopPreview(server);}
})().catch(e=>{console.error(e.message);process.exitCode=1});
