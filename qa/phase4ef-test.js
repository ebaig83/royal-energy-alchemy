// Phase 4E+4F: Session Prep Brief + Attention Flags E2E test
const fs   = require('fs');
const path = require('path');
const https = require('https');

fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

let _tok = '';
function req(method, p, body) {
  return new Promise((res, rej) => {
    const b = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'royal-energy-alchemy.netlify.app', port: 443, path: p, method,
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': _tok,
        ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}) }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { res({ s: resp.statusCode, b: JSON.parse(d) }); } catch { res({ s: resp.statusCode, b: d }); } });
    });
    r.on('error', rej);
    if (b) r.write(b);
    r.end();
  });
}

function pass(t, d) { console.log('[PASS]', t, '--', d || ''); }
function fail(t, d) { console.log('[FAIL]', t, '--', d || ''); }
function warn(t, d) { console.log('[WARN]', t, '--', d || ''); }

async function run() {
  const auth = await req('POST', '/.netlify/functions/verify-pin', { pin: process.env.DASHBOARD_PIN });
  _tok = auth.b.token;

  const cl = await req('GET', '/.netlify/functions/clients');
  const clients = cl.b && cl.b.clients ? cl.b.clients : [];
  const tc = clients[0];

  const cp = await req('GET', '/.netlify/functions/clients?id=' + tc.id);
  const sessions = cp.b.sessions || [];
  const recs = cp.b.recommendations || [];
  const followUps = cp.b.aftercare || [];
  const notes = cp.b.notes || [];
  console.log('Client:', tc.name || tc.full_name, '| sessions:', sessions.length, '| recs:', recs.length, '| followUps:', followUps.length);

  // PHASE 4E: SESSION PREP BRIEF
  console.log('\n=== PHASE 4E: SESSION PREP BRIEF INTELLIGENCE ===');
  const brief = await req('POST', '/.netlify/functions/session-prep-brief', {
    clientName: tc.name || tc.full_name, clientId: tc.id,
    sessions: sessions, recommendations: recs, followUps: followUps, notes: notes, status: 'active'
  });

  if (brief.s === 200 && brief.b.brief) {
    const b = brief.b.brief;
    if (b.lastSessionDate !== undefined)    pass('PREP-lastSessionDate', 'value=' + b.lastSessionDate);
    else                                    fail('PREP-lastSessionDate', 'field missing');
    if (b.improvementTrend !== undefined)   pass('PREP-improvementTrend', 'trend=' + b.improvementTrend);
    else                                    fail('PREP-improvementTrend', 'field missing');
    if (b.lastSessionOutcome !== undefined) pass('PREP-lastSessionOutcome', 'outcome=' + b.lastSessionOutcome);
    else                                    fail('PREP-lastSessionOutcome', 'field missing');
    if (b.environmentalStatus !== undefined) pass('PREP-environmentalStatus', 'env=' + b.environmentalStatus);
    else                                    fail('PREP-environmentalStatus', 'field missing');
    if (Array.isArray(b.discussionTopics) && b.discussionTopics.length >= 3)
      pass('PREP-discussionTopics', b.discussionTopics.length + ' topics');
    else
      fail('PREP-discussionTopics', 'count=' + (b.discussionTopics ? b.discussionTopics.length : 'null'));

    const stateCount = sessions.filter(function(s) { return s.state_before != null && s.state_after != null; }).length;
    if (stateCount >= 2) {
      if (['Improving', 'Stable', 'Declining'].indexOf(b.improvementTrend) >= 0)
        pass('PREP-trend-computed', 'trend=' + b.improvementTrend + ' from ' + stateCount + ' sessions');
      else
        fail('PREP-trend-computed', 'unexpected trend: ' + b.improvementTrend);
    } else {
      if (b.improvementTrend === 'Insufficient Data')
        pass('PREP-trend-insufficient', 'correctly returns Insufficient Data');
      else
        warn('PREP-trend-insufficient', 'trend=' + b.improvementTrend + ' (' + stateCount + ' state sessions)');
    }
  } else {
    fail('PREP-endpoint', 'status=' + brief.s + ' error=' + (brief.b && brief.b.error ? brief.b.error : ''));
  }

  // PHASE 4F: ATTENTION FLAGS — 3 NEW TRIGGERS
  console.log('\n=== PHASE 4F: ATTENTION FLAGS — NEW TRIGGERS ===');
  const today = '2026-06-12';

  // Test 1: No Measurable Improvement
  const noImproveSessions = [
    { session_date: '2026-06-01', state_before: 3, state_after: 3, status: 'completed' },
    { session_date: '2026-05-15', state_before: 4, state_after: 3, status: 'completed' },
    { session_date: '2026-05-01', state_before: 3, state_after: 2, status: 'completed' }
  ];
  const f1 = await req('POST', '/.netlify/functions/client-attention-flags', {
    clientName: 'Flag Test Client', clientId: tc.id, today: today,
    sessions: noImproveSessions, recommendations: [], followUps: [], clientTags: ['waiver'], notes: []
  });
  if (f1.s === 200) {
    const noImprove = (f1.b.flags || []).filter(function(f) { return f.label === 'No Measurable Improvement'; })[0];
    if (noImprove) pass('FLAG-no-improvement', 'severity=' + noImprove.severity);
    else           fail('FLAG-no-improvement', 'Not triggered. Flags: ' + (f1.b.flags || []).map(function(f) { return f.label; }).join(', '));
  } else {
    fail('FLAG-no-improvement', 'status=' + f1.s);
  }

  // Test 2: Recommendation Feedback Gap (purchased 15 days ago)
  const oldRec = {
    product_name: 'Test Crystal',
    purchased: 'yes',
    outcome_status: 'purchased',
    recommended_at: new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10)
  };
  const f2 = await req('POST', '/.netlify/functions/client-attention-flags', {
    clientName: 'Flag Test Client', clientId: tc.id, today: today,
    sessions: [{ session_date: '2026-05-01', status: 'completed' }],
    recommendations: [oldRec], followUps: [], clientTags: ['waiver'], notes: []
  });
  if (f2.s === 200) {
    const gap = (f2.b.flags || []).filter(function(f) { return f.label === 'Recommendation Feedback Gap'; })[0];
    if (gap) pass('FLAG-rec-feedback-gap', 'severity=' + gap.severity);
    else     fail('FLAG-rec-feedback-gap', 'Not triggered. Flags: ' + (f2.b.flags || []).map(function(f) { return f.label; }).join(', '));
  } else {
    fail('FLAG-rec-feedback-gap', 'status=' + f2.s);
  }

  // Test 3: Follow-Up Risk (3+ overdue)
  const overdueFollowUps = [
    { scheduled_for: '2026-05-01', date: '2026-05-01', status: 'scheduled' },
    { scheduled_for: '2026-04-15', date: '2026-04-15', status: 'scheduled' },
    { scheduled_for: '2026-03-20', date: '2026-03-20', status: 'scheduled' }
  ];
  const f3 = await req('POST', '/.netlify/functions/client-attention-flags', {
    clientName: 'Flag Test Client', clientId: tc.id, today: today,
    sessions: [{ session_date: '2026-05-01', status: 'completed' }],
    recommendations: [], followUps: overdueFollowUps, clientTags: ['waiver'], notes: []
  });
  if (f3.s === 200) {
    const risk = (f3.b.flags || []).filter(function(f) { return f.label === 'Follow-Up Risk'; })[0];
    if (risk) pass('FLAG-followup-risk', 'severity=' + risk.severity);
    else      fail('FLAG-followup-risk', 'Not triggered. Flags: ' + (f3.b.flags || []).map(function(f) { return f.label; }).join(', '));
  } else {
    fail('FLAG-followup-risk', 'status=' + f3.s);
  }

  console.log('\nPhase 4E-4F complete.');
}

run().catch(function(e) { console.error(e); });
