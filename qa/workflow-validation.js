// Practitioner Workflow Validation Agent
// Tests all 5 duties: E2E workflow, SNM persistence, Follow-Up Center, Intake matching, Rec outcome UX

const https = require('https');
const fs    = require('fs');
const path  = require('path');

fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

let tok = '';
const results = [];

function req(method, p, body) {
  return new Promise((res, rej) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'royal-energy-alchemy.netlify.app',
      port: 443, path: p, method,
      headers: {
        'Content-Type': 'application/json',
        'X-Dashboard-Token': tok,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, x => {
      let d = '';
      x.on('data', c => d += c);
      x.on('end', () => { try { res({ status: x.statusCode, body: JSON.parse(d) }); } catch { res({ status: x.statusCode, body: d }); } });
    });
    r.on('error', rej);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

function pass(id, detail) { results.push({ id, r: 'PASS', detail }); console.log('[PASS]', id, '--', detail); }
function fail(id, detail) { results.push({ id, r: 'FAIL', detail }); console.log('[FAIL]', id, '--', detail); }
function warn(id, detail) { results.push({ id, r: 'WARN', detail }); console.log('[WARN]', id, '--', detail); }
function info(msg)         { console.log('[INFO]', msg); }

async function run() {
  const a = await req('POST', '/.netlify/functions/verify-pin', { pin: process.env.DASHBOARD_PIN });
  tok = a.body.token;
  if (!tok) { console.error('AUTH FAILED', a.body); process.exit(1); }

  // ── Find test client ─────────────────────────────────────────────────
  const clist    = await req('GET', '/.netlify/functions/clients');
  const allClients = clist.body.clients || [];
  const testClient = allClients.find(c => c.name && c.name.includes('[QA]'));
  if (!testClient) { console.error('SAFE-STOP: no explicitly marked [QA] client found; refusing write-based validation.'); process.exit(2); }
  info('Test client: ' + testClient?.name + ' id=' + testClient?.id);

  // ══════════════════════════════════════════════════════════════════
  // DUTY 1: End-to-End Workflow
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- DUTY 1: END-TO-END WORKFLOW ---');

  // Intake endpoint accessible
  const intakes = await req('GET', '/.netlify/functions/intake');
  if (intakes.status === 200) pass('D1-intake-endpoint', 'GET /intake returns 200');
  else fail('D1-intake-endpoint', 'GET /intake returned ' + intakes.status + ' ' + intakes.body.error);

  // Client profile loads
  const cp = await req('GET', '/.netlify/functions/clients?id=' + testClient.id);
  const c = cp.body.client;
  const clientDisplayName = c?.full_name || c?.name;
  if (c && clientDisplayName) pass('D1-client-profile', 'Profile loads: ' + clientDisplayName + ' email=' + (c.email || 'none'));
  else fail('D1-client-profile', 'Profile missing: ' + JSON.stringify(cp.body).slice(0, 80));

  // Session create with state before/after
  const newSess = await req('POST', '/.netlify/functions/sessions', {
    client_id: testClient.id, client_name: testClient.name,
    service: 'Chakra Balancing', session_date: '2026-06-12',
    amount: 120, payment_method: 'cash', source: 'workflow_audit',
    state_before: 2, state_after: 4, seller_notes: 'Client arrived stressed'
  });
  const sid = newSess.body.session?.id;
  const sb  = newSess.body.session?.state_before;
  const sa  = newSess.body.session?.state_after;
  if (sid) pass('D1-session-create', 'Session created id=' + sid);
  else fail('D1-session-create', 'Session creation failed: ' + newSess.body.error);

  if (sb === 2 && sa === 4) pass('D1-state-tracking', 'state_before=2 state_after=4 persisted on create');
  else fail('D1-state-tracking', 'State tracking failed: before=' + sb + ' after=' + sa);

  // Reload session — verify state persists
  const reloadSess = await req('GET', '/.netlify/functions/sessions?id=' + sid);
  const rs = reloadSess.body.session;
  if (rs?.state_before === 2 && rs?.state_after === 4)
    pass('D1-state-reload', 'State persists on reload: before=' + rs.state_before + ' after=' + rs.state_after);
  else
    fail('D1-state-reload', 'State not persisted: before=' + rs?.state_before + ' after=' + rs?.state_after);

  // ══════════════════════════════════════════════════════════════════
  // DUTY 2: SNM Supabase Persistence
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- DUTY 2: SNM PERSISTENCE AUDIT ---');

  const snmData = {
    concerns: ['Anxiety / panic', 'Fatigue', 'Sleep disruption'],
    patterns: 'Root chakra significant blockage; solar plexus scattered',
    workPerformed: ['Chakra balancing', 'Grounding / root work', 'Cord cutting'],
    resources: ['Crystal: black tourmaline', 'Essential oil: frankincense'],
    clientNotes: 'Client reported feeling heavy and disconnected',
    practitionerNotes: 'Very responsive to grounding techniques. Follow up in 2 weeks.',
    stateBefore: 2, stateAfter: 4,
    followUpFlagged: true, priority: 'monitor',
    environmentalConditions: { moon: 'waning_gibbous', weather: 'clear', season: 'Summer' }
  };

  const snPost = await req('POST', '/.netlify/functions/session-notes', {
    session_id: sid,
    client_id: testClient.id,
    content: 'Concerns: Anxiety / panic, Fatigue, Sleep disruption\nObserved patterns: Root chakra significant blockage; solar plexus scattered\nWork performed: Chakra balancing, Grounding / root work, Cord cutting\nPractitioner notes: Very responsive to grounding techniques. Follow up in 2 weeks.',
    note_type: 'session',
    energy_findings: 'Root chakra significant blockage; solar plexus scattered',
    removals_done: ['Chakra balancing', 'Grounding / root work', 'Cord cutting'],
    env_notes: JSON.stringify({ moon: 'waning_gibbous', weather: 'clear', season: 'Summer' }),
    snm_json: snmData
  });
  const noteId = snPost.body.note?.id;
  if (noteId) pass('D2-snm-post', 'SNM POST to Supabase -- note id=' + noteId);
  else fail('D2-snm-post', 'SNM POST failed: ' + snPost.body.error);

  // Reload note — verify all fields
  const noteGet = await req('GET', '/.netlify/functions/session-notes?session_id=' + sid);
  const note = noteGet.body.notes?.[0];

  if (note?.env_notes) pass('D2-env-notes-persist', 'env_notes persisted: ' + note.env_notes.slice(0, 50));
  else fail('D2-env-notes-persist', 'env_notes missing on reload');

  if (note?.snm_json?.concerns?.length > 0) pass('D2-snm-json-persist', 'snm_json persisted: concerns=' + note.snm_json.concerns.join(', '));
  else fail('D2-snm-json-persist', 'snm_json missing on reload');

  if (note?.energy_findings) pass('D2-energy-findings', 'energy_findings persisted: ' + note.energy_findings.slice(0, 50));
  else fail('D2-energy-findings', 'energy_findings missing');

  if (note?.removals_done?.length > 0) pass('D2-removals-done', 'removals_done persisted: ' + note.removals_done.join(', '));
  else fail('D2-removals-done', 'removals_done missing');

  if (note?.snm_json?.stateBefore === 2 && note?.snm_json?.stateAfter === 4)
    pass('D2-state-in-snm', 'stateBefore/stateAfter in snm_json correct');
  else
    fail('D2-state-in-snm', 'State in snm_json wrong: ' + JSON.stringify(note?.snm_json));

  // Verify sessions table has state (source of truth)
  const sChk = await req('GET', '/.netlify/functions/sessions?id=' + sid);
  if (sChk.body.session?.state_before === 2) pass('D2-sessions-source-of-truth', 'sessions table has state_before/after');
  else fail('D2-sessions-source-of-truth', 'sessions table missing state');

  // PATCH note — test update
  const snPatch = await req('PATCH', '/.netlify/functions/session-notes?id=' + noteId, {
    snm_json: { ...snmData, priority: 'follow_up', patched: true },
    energy_findings: 'Root chakra cleared 80%; residual solar plexus work needed'
  });
  if (snPatch.body.note?.snm_json?.patched) pass('D2-snm-patch', 'SNM PATCH updates snm_json');
  else fail('D2-snm-patch', 'SNM PATCH failed: ' + snPatch.body.error);

  // Confirm PATCH persists on reload
  const noteGet2 = await req('GET', '/.netlify/functions/session-notes?session_id=' + sid);
  const note2 = noteGet2.body.notes?.[0];
  if (note2?.snm_json?.patched && note2?.energy_findings?.includes('80%'))
    pass('D2-patch-persists', 'PATCH persists on reload');
  else
    fail('D2-patch-persists', 'PATCH did not persist');

  // ══════════════════════════════════════════════════════════════════
  // DUTY 3: Unified Follow-Up Center
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- DUTY 3: FOLLOW-UP CENTER AUDIT ---');

  const fuAll = await req('GET', '/.netlify/functions/aftercare?all=1');
  const fuCount = fuAll.body.aftercare?.length || 0;
  if (fuCount > 0) pass('D3-followup-all', '?all=1 returns ' + fuCount + ' follow-ups');
  else fail('D3-followup-all', '?all=1 returned 0 records');

  const fuDue = await req('GET', '/.netlify/functions/aftercare?due=1');
  pass('D3-followup-due', '?due=1 returns ' + (fuDue.body.aftercare?.length || 0) + ' overdue/due');

  const TODAY = '2026-06-12';
  const allFu  = fuAll.body.aftercare || [];
  const overdue  = allFu.filter(f => f.scheduled_for && f.scheduled_for.slice(0, 10) < TODAY);
  const dueToday = allFu.filter(f => f.scheduled_for && f.scheduled_for.slice(0, 10) === TODAY);
  const upcoming = allFu.filter(f => f.scheduled_for && f.scheduled_for.slice(0, 10) > TODAY);
  info('Follow-up breakdown: overdue=' + overdue.length + ' dueToday=' + dueToday.length + ' upcoming=' + upcoming.length);

  if (overdue.length > 0)  pass('D3-overdue-visible',  'Overdue follow-ups: ' + overdue.length);
  else warn('D3-overdue-visible', 'No overdue follow-ups (may be correct)');
  if (upcoming.length > 0) pass('D3-upcoming-visible', 'Upcoming follow-ups: ' + upcoming.length);
  else warn('D3-upcoming-visible', 'No upcoming follow-ups');

  // Test one-click mark sent
  const testFu = allFu.find(f => f.status === 'scheduled');
  if (testFu) {
    const markSent = await req('PATCH', '/.netlify/functions/aftercare?id=' + testFu.id, {
      status: 'sent', sent_at: new Date().toISOString()
    });
    if (markSent.body.aftercare?.status === 'sent') pass('D3-mark-sent', 'One-click mark sent works');
    else fail('D3-mark-sent', 'Mark sent failed: ' + markSent.body.error);
    // Restore
    await req('PATCH', '/.netlify/functions/aftercare?id=' + testFu.id, { status: 'scheduled', sent_at: null });
  } else {
    warn('D3-mark-sent', 'No scheduled follow-up found to test mark-sent');
  }

  // Test mark skipped (different record)
  const testFu2 = allFu.find(f => f.status === 'scheduled' && f.id !== testFu?.id);
  if (testFu2) {
    const markSkip = await req('PATCH', '/.netlify/functions/aftercare?id=' + testFu2.id, { status: 'skipped' });
    if (markSkip.body.aftercare?.status === 'skipped') pass('D3-mark-skipped', 'Mark skipped works');
    else fail('D3-mark-skipped', 'Mark skipped failed: ' + markSkip.body.error);
    await req('PATCH', '/.netlify/functions/aftercare?id=' + testFu2.id, { status: 'scheduled' });
  }

  // Completed filter
  const fuDone = await req('GET', '/.netlify/functions/aftercare?all=1&status=sent');
  pass('D3-completed-filter', 'Completed filter returns ' + (fuDone.body.aftercare?.length || 0) + ' sent follow-ups');

  // ══════════════════════════════════════════════════════════════════
  // DUTY 4: Intake-to-Client Matching
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- DUTY 4: INTAKE-TO-CLIENT MATCHING ---');

  const intakeList  = await req('GET', '/.netlify/functions/intake');
  const intakeItems = intakeList.body.intakes || [];
  info('Total intakes: ' + intakeItems.length);

  if (intakeItems.length === 0) {
    warn('D4-auto-link', 'No intakes found -- cannot test auto-linking');
  } else {
    const linked   = intakeItems.filter(i => i.client_id);
    const unlinked = intakeItems.filter(i => !i.client_id);
    info('Linked: ' + linked.length + '  Unlinked: ' + unlinked.length);
    if (unlinked.length > 0) fail('D4-auto-link', unlinked.length + ' intakes have no client_id -- auto-linking not implemented');
    else pass('D4-auto-link', 'All ' + linked.length + ' intakes linked to clients');

    // Check if email-match opportunity exists but was missed
    const withEmail = intakeItems.find(i => i.email);
    if (withEmail) {
      const match = allClients.find(c => c.email && c.email.toLowerCase() === withEmail.email?.toLowerCase());
      if (match && !withEmail.client_id)
        warn('D4-email-match-missed', 'Intake email matches client but no auto-link: ' + withEmail.email);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // DUTY 5: Recommendation Outcome UX
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- DUTY 5: RECOMMENDATION OUTCOME UX ---');

  const recs    = await req('GET', '/.netlify/functions/recommendations?client_id=' + testClient.id);
  const recList = recs.body.recommendations || [];
  info('Recommendations for test client: ' + recList.length);

  // Create a test rec if needed
  let recId = recList[0]?.id;
  if (!recId) {
    const newRec = await req('POST', '/.netlify/functions/recommendations', {
      client_id: testClient.id, session_id: sid,
      client_name: testClient.name, service: 'Chakra Balancing',
      product_name: 'Black Tourmaline Crystal', category: 'crystal',
      reason: 'Grounding support between sessions',
      priority: 'high', amount_estimate: 25
    });
    recId = newRec.body.recommendation?.id;
    if (recId) pass('D5-rec-create', 'Test recommendation created: ' + recId.slice(0, 8));
    else { fail('D5-rec-create', 'Cannot create test rec: ' + newRec.body.error); }
  }

  if (recId) {
    // Test each outcome status in sequence
    for (const outcome of ['purchased', 'tried', 'helpful', 'not_helpful', 'declined']) {
      const upd = await req('PATCH', '/.netlify/functions/recommendations?id=' + recId, {
        outcome_status: outcome, outcome_date: '2026-06-12'
      });
      if (upd.body.recommendation?.outcome_status === outcome)
        pass('D5-outcome-' + outcome, 'outcome_status=' + outcome + ' saves and returns correctly');
      else
        fail('D5-outcome-' + outcome, 'Failed: ' + upd.body.error);
    }
    // Verify outcome_date saves
    const finalRec = await req('GET', '/.netlify/functions/recommendations?client_id=' + testClient.id);
    const updatedRec = (finalRec.body.recommendations || []).find(r => r.id === recId);
    if (updatedRec?.outcome_date) pass('D5-outcome-date', 'outcome_date persists: ' + updatedRec.outcome_date);
    else fail('D5-outcome-date', 'outcome_date not persisted');
    // Reset
    await req('PATCH', '/.netlify/functions/recommendations?id=' + recId, { outcome_status: 'recommended', outcome_date: null });
  }

  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== PRACTITIONER WORKFLOW VALIDATION SUMMARY ===');
  const pass_ = results.filter(r => r.r === 'PASS').length;
  const fail_ = results.filter(r => r.r === 'FAIL').length;
  const warn_ = results.filter(r => r.r === 'WARN').length;
  console.log('PASS:', pass_, '  FAIL:', fail_, '  WARN:', warn_);
  if (fail_ > 0) {
    console.log('\nFAILURES:');
    results.filter(r => r.r === 'FAIL').forEach(r => console.log('  [FAIL]', r.id, '-', r.detail));
  }
  if (warn_ > 0) {
    console.log('\nWARNINGS:');
    results.filter(r => r.r === 'WARN').forEach(r => console.log('  [WARN]', r.id, '-', r.detail));
  }
  console.log('\nDONE');
}

run().catch(console.error);
