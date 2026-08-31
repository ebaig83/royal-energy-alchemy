'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const SITE_ID = '1e40c2ba-a615-4fd1-a149-6ee4e78c5ebc';
const SITE_NAME = 'royal-energy-alchemy';
const SITE_URL = 'https://www.daronroyal.com';
const API = 'https://api.netlify.com/api/v1';
const HEALTH_URL = `${SITE_URL}/.netlify/functions/booking?test_health=1`;
const PROBE_KEY = 'GOOGLE_MEET_ENV_PROBE';
const REQUEST_TIMEOUT_MS = 30_000;
const DEPLOY_TIMEOUT_MS = 12 * 60_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sanitize = error => ({ name: error?.name || 'Error', message: String(error?.message || error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') });

function loadNetlifyToken() {
  const configPath = path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const user = config.users?.[config.userId] || Object.values(config.users || {})[0];
  const token = user?.auth?.token;
  if (!token) throw new Error('Authenticated Netlify token not found.');
  return token;
}

async function requestJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; } }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data?.message || response.statusText}`);
    return { status: response.status, data };
  } finally { clearTimeout(timer); }
}

async function requestText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}
  finally{clearTimeout(timer);}
}

async function applicationRequest(route, { method = 'GET', body, testAuth } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (testAuth) headers['x-google-meet-test-auth'] = testAuth;
  return requestJson(`${SITE_URL}/.netlify/functions/${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

function reconcileBooking(matches) {
  if (matches.length === 1) return { applied: true, sessionId: matches[0].id };
  if (matches.length === 0) return { applied: false, reason: 'not_created' };
  throw new Error('Ambiguous booking reconciliation found multiple controlled sessions.');
}

function reconcileReschedule(before, intended, current) {
  const moved = current.session_date === intended.date && String(current.session_time || '').slice(0, 5) === intended.time;
  const sameEvent = current.google_calendar_event_id === before.google_calendar_event_id;
  if (moved && sameEvent) return { applied: true };
  const unchanged = current.session_date === before.session_date && String(current.session_time || '').slice(0, 5) === String(before.session_time || '').slice(0, 5);
  if (unchanged) return { applied: false, reason: 'not_applied' };
  throw new Error('Ambiguous reschedule reconciliation found partial or inconsistent state.');
}

function reconcileCancellation(before, current) {
  const cancelState = ['cancel_pending', 'cancelled'].includes(current.google_calendar_status);
  if (current.status === 'cancelled' && cancelState && current.google_calendar_event_id === before.google_calendar_event_id) return { applied: true };
  if (current.status === before.status && current.google_calendar_status === before.google_calendar_status) return { applied: false, reason: 'not_applied' };
  throw new Error('Ambiguous cancellation reconciliation found partial or inconsistent state.');
}

function isTransportAmbiguity(error) {
  return error?.name === 'AbortError' || /fetch failed|socket|connection|network|timeout/i.test(String(error?.message || ''));
}

async function runLifecycle(deps, options = {}) {
  const state = { authCreated:false, expiryCreated:false, bookingRequestIssued:false, rescheduleIssued:false, cancellationIssued:false, cleanupCompleted:false };
  let primaryError = null, cleanupError = null, session = null;
  const phase = async (name, fn) => { if (options.failAt === name) throw new Error(`injected:${name}`); return fn ? fn() : undefined; };
  try {
    await phase('beforeAuth');
    await phase('createAuth', deps.createAuth); state.authCreated = true;
    await phase('createExpiry', deps.createExpiry); state.expiryCreated = true;
    await phase('authDeployCreate', deps.createAuthDeploy);
    await phase('authDeployPoll', deps.pollAuthDeploy);
    await phase('authActive');
    await phase('healthActive', deps.verifyHealthActive);
    await phase('beforeBooking');
    state.bookingRequestIssued = true; await phase('booking', deps.booking);
    session = await phase('bookingReconciled', deps.reconcileBooking);
    state.sessionId = session.id;
    await phase('syncPolling', deps.pollSync);
    await phase('eventObserved', deps.verifyEvent);
    await phase('meetObserved', deps.verifyMeet);
    await phase('dashboard', deps.verifyDashboard);
    await phase('communication', deps.verifyCommunication);
    await phase('reminder', deps.verifyReminder);
    await phase('beforeReschedule');
    state.rescheduleIssued = true; await phase('reschedule', deps.reschedule);
    await phase('afterReschedule', deps.verifyReschedule);
    await phase('beforeCancellation');
    state.cancellationIssued = true; await phase('cancellation', deps.cancel);
    await phase('afterCancellation', deps.verifyCancellation);
  } catch (error) { primaryError = error; }
  finally {
    try {
      if (state.authCreated) await phase('deleteAuth', deps.deleteAuth);
      if (state.expiryCreated) await phase('deleteExpiry', deps.deleteExpiry);
      if (state.authCreated || state.expiryCreated) {
        await phase('cleanupDeployCreate', deps.createCleanupDeploy);
        await phase('cleanupDeployPoll', deps.pollCleanupDeploy);
        await phase('healthClosed', deps.verifyHealthClosed);
      }
      state.cleanupCompleted = true;
    } catch (error) { cleanupError = error; }
  }
  if (primaryError || cleanupError) {
    const error = new Error(primaryError?.message || 'Lifecycle cleanup failed.');
    error.cleanupError = cleanupError ? sanitize(cleanupError) : null;
    error.state = state;
    throw error;
  }
  return { state, session };
}

async function submitControlledBooking(state, auth, slot) {
  if (state.bookingRequestIssued) throw new Error('Controlled booking request has already been issued.');
  state.bookingRequestIssued = true;
  const body = { slot_id: slot.id, service: 'distance-energy-session', client_name: 'Google Meet Test', client_email: 'droyal168@gmail.com', preferred_contact: 'email', source: 'controlled_google_meet_test', bot_field: '' };
  const response = await applicationRequest('booking', { method: 'POST', body, testAuth: auth });
  if (!response.data?.booked || !response.data?.controlled_test || !response.data?.session_id) throw new Error('Controlled booking response was not finalized.');
  state.sessionId = response.data.session_id;
  return response.data;
}

async function controlledSessionAction(state, auth, action, body) {
  if (!state.sessionId) throw new Error('Controlled session ID is not established.');
  const flag = action === 'reschedule' ? 'rescheduleIssued' : 'cancellationIssued';
  if (state[flag]) throw new Error(`${action} request has already been issued.`);
  state[flag] = true;
  return (await applicationRequest(`sessions?id=${encodeURIComponent(state.sessionId)}`, { method: 'PATCH', body: { action, ...body }, testAuth: auth })).data;
}

function createNetlifyClient(token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = (route, options = {}) => requestJson(`${API}${route}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  return {
    getSite: () => call(`/sites/${SITE_ID}`),
    getDeploy: id => call(`/deploys/${id}`),
    createEnv: (accountId, key, value, isSecret = false) => call(`/accounts/${accountId}/env?site_id=${SITE_ID}`, { method: 'POST', body: JSON.stringify([{ key, values: [{ value, context: 'production' }], is_secret: isSecret, ...(isSecret ? { scopes: ['builds', 'functions', 'runtime'] } : {}) }]) }),
    getEnv: (accountId, key) => call(`/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${SITE_ID}`),
    deleteEnv: async (accountId, key) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try { const r = await fetch(`${API}/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${SITE_ID}`, { method: 'DELETE', headers, signal: controller.signal }); if (r.status !== 204 && r.status !== 404) throw new Error(`Env delete HTTP ${r.status}`); return r.status; }
      finally { clearTimeout(timer); }
    },
    triggerBuild: () => call(`/sites/${SITE_ID}/builds`, { method: 'POST', body: '{}' }),
    getBuild: id => call(`/builds/${id}`),
  };
}

async function pollBuild(client, buildId, deployId, timeoutMs = DEPLOY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const build = (await client.getBuild(buildId)).data;
    if (build?.error) throw new Error(`Hosted build failed: ${build.error}`);
    if (build?.done) {
      const targetDeploy = build.deploy_id || deployId;
      if (!targetDeploy) throw new Error('Completed build did not provide a deploy ID.');
      while (Date.now() < deadline) {
        const deploy = (await client.getDeploy(targetDeploy)).data;
        if (deploy?.state === 'ready') {
          const site = (await client.getSite()).data;
          if (site?.published_deploy?.id !== targetDeploy) { await sleep(5_000); continue; }
          return { buildId, deployId: targetDeploy, state: deploy.state };
        }
        if (['error', 'failed'].includes(deploy?.state)) throw new Error(`Deploy failed: ${deploy.state}`);
        await sleep(5_000);
      }
    }
    await sleep(5_000);
  }
  throw new Error('Timed out waiting for hosted production deploy.');
}

async function pollHealth(expected, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = (await requestJson(HEALTH_URL, { headers: { Accept: 'application/json' } }, 20_000)).data;
      if (Object.entries(expected).every(([key, value]) => health?.[key] === value)) return health;
    } catch (_) {}
    await sleep(5_000);
  }
  throw new Error(`Health did not reach expected state: ${JSON.stringify(expected)}`);
}

async function triggerAndWait(client) {
  const build = (await client.triggerBuild()).data;
  if (!build?.id) throw new Error('Hosted build response did not contain an ID.');
  return pollBuild(client, build.id, build.deploy_id || null);
}

async function supabaseQuery(sql) {
  const escaped = sql.replace(/"/g, '`"');
  const command = `supabase db query --linked \"${escaped}\"`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout.trim());
  return parsed.rows || [];
}

async function runProbeCycle() {
  let token = loadNetlifyToken();
  const client = createNetlifyClient(token);
  const state = { probeCreated: false, activation: null, cleanup: null, activeHealth: null, finalHealth: null };
  let accountId;
  try {
    const site = (await client.getSite()).data;
    if (site?.name !== SITE_NAME || site?.ssl_url !== SITE_URL || !site?.account_id) throw new Error('Netlify site identity mismatch.');
    accountId = site.account_id;
    await client.createEnv(accountId, PROBE_KEY, 'enabled', false);
    state.probeCreated = true;
    const stored = (await client.getEnv(accountId, PROBE_KEY)).data;
    if (stored?.key !== PROBE_KEY || !stored?.values?.some(v => v.context === 'production' && v.value === 'enabled')) throw new Error('Probe persistence verification failed.');
    state.activation = await triggerAndWait(client);
    state.activeHealth = await pollHealth({ env_probe: true });
  } finally {
    if (accountId && state.probeCreated) {
      await client.deleteEnv(accountId, PROBE_KEY);
      try { await client.getEnv(accountId, PROBE_KEY); throw new Error('Probe still exists after deletion.'); } catch (error) { if (!/HTTP 404/.test(error.message)) throw error; }
      state.cleanup = await triggerAndWait(client);
      state.finalHealth = await pollHealth({ env_probe: false });
    }
    token = null;
  }
  return state;
}

async function pollSession(id, predicate, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await supabaseQuery(`select id,client_id,client_name,service,source,status,payment_status,session_date,session_time,google_calendar_status,google_calendar_event_id,google_meet_url,google_calendar_error,google_calendar_synced_at from public.sessions where id='${id}';`);
    if (rows[0] && predicate(rows[0])) return rows[0];
    await sleep(5_000);
  }
  throw new Error('Timed out polling controlled session state.');
}

async function createProductionAdapters() {
  let token = loadNetlifyToken();
  const client = createNetlifyClient(token);
  const site = (await client.getSite()).data;
  if (site?.name !== SITE_NAME || site?.ssl_url !== SITE_URL || !site?.account_id) throw new Error('Netlify authentication or site identity validation failed.');
  await supabaseQuery('select 1 as runner_capability;');
  const abandoned=(await supabaseQuery(`select id,payment_status,google_calendar_status,google_calendar_event_id,google_meet_url from public.sessions where id='aa44296f-1d20-42c2-b062-1f5811bfa12c';`))[0];
  if(!abandoned||abandoned.payment_status!=='pending'||abandoned.google_calendar_status!=='not_requested'||abandoned.google_calendar_event_id||abandoned.google_meet_url)throw new Error('Abandoned session prerequisite verification failed.');
  const ctx = { token, client, accountId:site.account_id, auth:crypto.randomBytes(48).toString('base64url'), expires:new Date(Date.now()+30*60_000).toISOString(), authBuild:null, cleanupBuild:null, slot:null, replacement:null, bookingResponse:null, session:null, beforeReschedule:null, beforeCancellation:null, eventIds:new Set() };
  const chooseSlots = async () => {
    const rows=await supabaseQuery(`select a.id,a.slot_date as date,left(a.slot_time::text,5) as time from public.availability_slots a where a.status='available' and a.slot_date>=current_date and not (a.slot_date='2026-08-31' and left(a.slot_time::text,5)='12:00') and not exists(select 1 from public.sessions s where s.session_date=a.slot_date and s.status not in('cancelled','completed') and left(s.session_time::text,5)=left(a.slot_time::text,5)) order by a.slot_date,a.slot_time limit 2;`);
    if(rows.length<2) throw new Error('Two non-colliding controlled lifecycle slots are required.');
    [ctx.slot,ctx.replacement]=rows;
  };
  await chooseSlots();
  const adapters = {
    createAuth:async()=>{await client.deleteEnv(ctx.accountId,'GOOGLE_MEET_TEST_AUTH');await client.createEnv(ctx.accountId,'GOOGLE_MEET_TEST_AUTH',ctx.auth,true);},
    createExpiry:async()=>{await client.deleteEnv(ctx.accountId,'GOOGLE_MEET_TEST_EXPIRES_AT');await client.createEnv(ctx.accountId,'GOOGLE_MEET_TEST_EXPIRES_AT',ctx.expires,false);},
    createAuthDeploy:async()=>{ctx.authBuild=(await client.triggerBuild()).data;if(!ctx.authBuild?.id)throw new Error('Authorization build creation failed.');},
    pollAuthDeploy:async()=>pollBuild(client,ctx.authBuild.id,ctx.authBuild.deploy_id||null),
    verifyHealthActive:async()=>pollHealth({has_auth:true,auth_unexpired:true}),
    booking:async()=>{try{ctx.bookingResponse=(await applicationRequest('booking',{method:'POST',testAuth:ctx.auth,body:{slot_id:ctx.slot.id,service:'distance-energy-session',client_name:'Google Meet Test',client_email:'droyal168@gmail.com',preferred_contact:'email',source:'controlled_google_meet_test',bot_field:''}})).data;}catch(error){if(!isTransportAmbiguity(error))throw error;ctx.bookingAmbiguous=true;}},
    reconcileBooking:async()=>{if(ctx.bookingResponse?.session_id){ctx.session={id:ctx.bookingResponse.session_id};return ctx.session;}const rows=await supabaseQuery(`select s.id from public.sessions s join public.clients c on c.id=s.client_id where s.source='controlled_google_meet_test' and lower(s.client_name)='google meet test' and lower(c.email)='droyal168@gmail.com' and s.service='Distance Energy Session' and s.session_date='${ctx.slot.date}' and left(s.session_time::text,5)='${ctx.slot.time}';`);const result=reconcileBooking(rows);if(!result.applied)throw new Error('Controlled booking was not created.');ctx.session={id:result.sessionId};return ctx.session;},
    pollSync:async()=>{ctx.session=await pollSession(ctx.session.id,s=>['ready','failed'].includes(s.google_calendar_status));if(ctx.session.google_calendar_status!=='ready')throw new Error(`Google synchronization failed: ${ctx.session.google_calendar_error||'unknown'}`);},
    verifyEvent:async()=>{if(!ctx.session.google_calendar_event_id)throw new Error('Google event ID missing.');ctx.eventIds.add(ctx.session.google_calendar_event_id);},
    verifyMeet:async()=>{if(!/^https:\/\/meet\.google\.com\//.test(ctx.session.google_meet_url||''))throw new Error('Valid Google Meet URL missing.');},
    verifyDashboard:async()=>{const html=await requestText(`${SITE_URL}/dashboard.html`);if(!/JOIN GOOGLE MEET/i.test(html)||!html.includes('google_meet_url'))throw new Error('Dashboard Meet rendering contract failed.');},
    verifyCommunication:async()=>{const rows=await supabaseQuery(`select id,recipient,message_type,metadata from public.communications where metadata @> '{"session_id":"${ctx.session.id}"}'::jsonb and message_type='appointment_meeting_ready';`);if(rows.length!==1||String(rows[0].recipient).toLowerCase()!=='droyal168@gmail.com')throw new Error('Meeting-ready communication verification failed.');},
    verifyReminder:async()=>{const rows=await supabaseQuery(`select html_body,text_body,variables from public.email_templates where name='session_30_minute_reminder';`);const text=JSON.stringify(rows[0]||{});if((text.match(/google_meet_url/g)||[]).length<3)throw new Error('Reminder Meet URL contract missing.');},
    reschedule:async()=>{ctx.beforeReschedule=ctx.session;try{await applicationRequest(`sessions?id=${ctx.session.id}`,{method:'PATCH',testAuth:ctx.auth,body:{action:'reschedule',new_date:ctx.replacement.date,new_time:ctx.replacement.time,new_slot_id:ctx.replacement.id,reason:'Controlled Google Meet lifecycle test'}});}catch(error){if(!isTransportAmbiguity(error))throw error;ctx.rescheduleAmbiguous=true;}},
    verifyReschedule:async()=>{if(ctx.rescheduleAmbiguous){const current=(await supabaseQuery(`select session_date,session_time,google_calendar_event_id,google_calendar_status from public.sessions where id='${ctx.session.id}';`))[0];const reconciled=reconcileReschedule(ctx.beforeReschedule,ctx.replacement,current);if(!reconciled.applied)throw new Error('Ambiguous reschedule was not applied; no retry issued.');}ctx.session=await pollSession(ctx.session.id,s=>s.session_date===ctx.replacement.date&&String(s.session_time).slice(0,5)===ctx.replacement.time&&s.google_calendar_status==='ready');if(ctx.session.google_calendar_event_id!==ctx.beforeReschedule.google_calendar_event_id)throw new Error('Reschedule created a different Google event.');ctx.eventIds.add(ctx.session.google_calendar_event_id);},
    cancel:async()=>{ctx.beforeCancellation=ctx.session;try{await applicationRequest(`sessions?id=${ctx.session.id}`,{method:'PATCH',testAuth:ctx.auth,body:{action:'cancel',reason:'Controlled Google Meet lifecycle test complete'}});}catch(error){if(!isTransportAmbiguity(error))throw error;ctx.cancellationAmbiguous=true;}},
    verifyCancellation:async()=>{if(ctx.cancellationAmbiguous){const current=(await supabaseQuery(`select status,google_calendar_status,google_calendar_event_id,google_meet_url from public.sessions where id='${ctx.session.id}';`))[0];const reconciled=reconcileCancellation(ctx.beforeCancellation,current);if(!reconciled.applied)throw new Error('Ambiguous cancellation was not applied; no retry issued.');}ctx.session=await pollSession(ctx.session.id,s=>s.status==='cancelled'&&s.google_calendar_status==='cancelled');if(ctx.session.google_calendar_event_id||ctx.session.google_meet_url)throw new Error('Cancelled Calendar data was not cleared.');if(ctx.eventIds.size!==1)throw new Error('Duplicate Google event observed.');},
    deleteAuth:async()=>client.deleteEnv(ctx.accountId,'GOOGLE_MEET_TEST_AUTH'),
    deleteExpiry:async()=>client.deleteEnv(ctx.accountId,'GOOGLE_MEET_TEST_EXPIRES_AT'),
    createCleanupDeploy:async()=>{ctx.cleanupBuild=(await client.triggerBuild()).data;if(!ctx.cleanupBuild?.id)throw new Error('Cleanup build creation failed.');},
    pollCleanupDeploy:async()=>pollBuild(client,ctx.cleanupBuild.id,ctx.cleanupBuild.deploy_id||null),
    verifyHealthClosed:async()=>pollHealth({has_auth:false,auth_unexpired:false}),
  };
  return { adapters, dispose:()=>{ctx.auth='';ctx.token='';token='';}, summary:()=>({sessionId:ctx.session?.id||null,eventCount:ctx.eventIds.size}) };
}

async function runCli(argv, runtime = {}) {
  const write = runtime.write || (()=>{});
  // The one production lifecycle is complete and its endpoints are retired.
  // Preserve injected local tests, but never create another production booking.
  if (!runtime.createAdapters && !runtime.runProbeCycle) throw new Error('Production controlled lifecycle is retired; only injected local tests are allowed.');
  if (argv.includes('--probe-cycle')) { const result=await (runtime.runProbeCycle||runProbeCycle)();write({ok:true,mode:'probe-cycle',result});return 0; }
  if (!argv.includes('--controlled-production') || !argv.includes('--confirm-single-production-lifecycle')) throw new Error('Controlled production mode requires both explicit safety flags.');
  const factory=runtime.createAdapters||createProductionAdapters;
  const bundle=await factory();
  if(!bundle?.adapters)throw new Error('Production adapters are unavailable.');
  try { const result=await (runtime.lifecycle||runLifecycle)(bundle.adapters);write({ok:true,mode:'controlled-production',state:result.state,summary:bundle.summary?.()||{}});return 0; }
  finally { bundle.dispose?.(); }
}

async function main() {
  return runCli(process.argv.slice(2),{write:value=>console.log(JSON.stringify(value))});
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ ok: false, error: sanitize(error) })); process.exitCode = 1; });

module.exports = { requestJson, requestText, applicationRequest, submitControlledBooking, controlledSessionAction, reconcileBooking, reconcileReschedule, reconcileCancellation, isTransportAmbiguity, runLifecycle, createProductionAdapters, runCli, createNetlifyClient, pollBuild, pollHealth, runProbeCycle };
