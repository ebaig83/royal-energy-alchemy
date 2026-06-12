// Sprint 3 Addendum — Analytics Safety, Risk Definitions & Data Quality QA Suite
// Run: node qa/analytics-validation.js

const fs    = require('fs');
const path  = require('path');
const https = require('https');

fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});

let _tok = '';
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: 'royal-energy-alchemy.netlify.app', port: 443, path: p, method,
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': _tok,
        ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}) }
    }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve({ s: resp.statusCode, b: JSON.parse(d) }); } catch { resolve({ s: resp.statusCode, b: d }); } });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

const results = { pass: 0, fail: 0, warn: 0, start: Date.now() };
function pass(t, d) { results.pass++; console.log('[PASS]', t, d ? '-- ' + d : ''); }
function fail(t, d) { results.fail++; console.log('[FAIL]', t, d ? '-- ' + d : ''); }
function warn(t, d) { results.warn++; console.log('[WARN]', t, d ? '-- ' + d : ''); }

function checkShape(label, obj, keys) {
  if (!obj || typeof obj !== 'object') { fail(label + '-shape', 'not an object'); return false; }
  let ok = true;
  keys.forEach(k => { if (!(k in obj)) { fail(label + '-' + k, 'missing key: ' + k); ok = false; } });
  if (ok) pass(label + '-shape', keys.join(', '));
  return ok;
}

function checkNum(label, val, opts) {
  if (val === null || val === undefined) {
    if (opts && opts.nullable) { pass(label, 'null (acceptable)'); return true; }
    fail(label, 'null/undefined'); return false;
  }
  if (typeof val !== 'number') { fail(label, 'not a number: ' + typeof val + ' (' + val + ')'); return false; }
  if (opts && opts.min !== undefined && val < opts.min) { fail(label, val + ' below min ' + opts.min); return false; }
  if (opts && opts.max !== undefined && val > opts.max) { fail(label, val + ' above max ' + opts.max); return false; }
  pass(label, 'value=' + val); return true;
}

function checkArray(label, val, min) {
  if (!Array.isArray(val)) { fail(label, 'expected array, got ' + typeof val); return false; }
  if (min !== undefined && val.length < min) { warn(label, 'length=' + val.length + ' (expected >=' + min + ')'); return false; }
  pass(label, 'length=' + val.length); return true;
}

function checkInsufficient(label, data, section) {
  if (!data || typeof data !== 'object') { fail(label + '-insufficient-shape', 'null or not object'); return false; }
  if (data.status !== 'insufficient_data') { warn(label + '-insufficient-status', 'status=' + data.status + ' (may have enough data in live DB)'); return true; }
  const ok = checkShape(label + '-insufficient', data, ['status', 'minimumRequired', 'currentCount']);
  if (ok) {
    pass(label + '-insufficient-values', 'min=' + data.minimumRequired + ' current=' + data.currentCount);
    if (data.currentCount > data.minimumRequired) fail(label + '-insufficient-logic', 'currentCount > minimumRequired but still insufficient');
  }
  return ok;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  const auth = await req('POST', '/.netlify/functions/verify-pin', { pin: process.env.DASHBOARD_PIN });
  if (!auth.b || !auth.b.token) { fail('AUTH', 'no token'); process.exit(1); }
  _tok = auth.b.token;
  pass('AUTH', 'token acquired');

  // ── PHASE 2: RECOMMENDATION INTELLIGENCE ─────────────────────────────────
  console.log('\n=== PHASE 2: Recommendation Intelligence ===');
  const recRes = await req('GET', '/.netlify/functions/analytics?section=recommendations');
  if (recRes.s !== 200) { fail('REC-status', 'HTTP ' + recRes.s); }
  else {
    pass('REC-status', 'HTTP 200');
    const rec = recRes.b;
    if (rec.status === 'insufficient_data') {
      checkInsufficient('REC', rec, 'recommendations with outcomes');
      pass('REC-safety-guard', 'insufficient_data returned correctly — no fabricated metrics');
    } else {
      checkShape('REC', rec, ['topRecommendations', 'conversionRates', 'successRates', 'trendData', 'summary']);
      if (Array.isArray(rec.topRecommendations) && rec.topRecommendations.length) {
        const top = rec.topRecommendations[0];
        checkShape('REC-top', top, ['name', 'recommendedCount', 'purchased', 'helpful', 'notHelpful', 'declined', 'conversionRate']);
        checkNum('REC-conversionRate', top.conversionRate, { min: 0, max: 100 });
      }
      checkArray('REC-trendData', rec.trendData, 8);
      if (Array.isArray(rec.trendData) && rec.trendData.length) {
        const t = rec.trendData[0];
        if ('week' in t && 'count' in t) pass('REC-trend-shape', 'week+count present');
        else fail('REC-trend-shape', JSON.stringify(t));
      }
    }
  }

  // ── PHASE 3: OUTCOME INTELLIGENCE ────────────────────────────────────────
  console.log('\n=== PHASE 3: Outcome Intelligence ===');
  const outRes = await req('GET', '/.netlify/functions/analytics?section=outcomes');
  if (outRes.s !== 200) { fail('OUT-status', 'HTTP ' + outRes.s); }
  else {
    pass('OUT-status', 'HTTP 200');
    const out = outRes.b;
    if (out.status === 'insufficient_data') {
      checkInsufficient('OUT', out, 'sessions');
      if (out.minimumRequired === 3) pass('OUT-minimum-3', 'minimum_required=3 correct');
      else fail('OUT-minimum-3', 'expected 3, got ' + out.minimumRequired);
      if ('message' in out) pass('OUT-message', 'human-readable message present');
      else fail('OUT-message', 'missing "message" field for dashboard empty state');
      if ('totalCompleted' in out) pass('OUT-totalCompleted-present', 'totalCompleted available even when insufficient');
      else fail('OUT-totalCompleted-present', 'totalCompleted missing from insufficient_data response');
      pass('OUT-safety-guard', 'no avgImprovement/0/null fabricated — insufficient_data correctly returned');
    } else {
      checkShape('OUT', out, ['avgImprovement', 'servicePerformance', 'locationPerformance', 'trends', 'totalCompleted', 'sessionsWithStateData']);
      checkNum('OUT-avgImprovement', out.avgImprovement, { nullable: false, min: -4, max: 4 });
      if (out.sessionsWithStateData < 3) fail('OUT-min-sample', 'sessionsWithStateData=' + out.sessionsWithStateData + ' below minimum 3');
      else pass('OUT-min-sample', 'sessionsWithStateData=' + out.sessionsWithStateData + ' >= 3');
      checkArray('OUT-servicePerformance', out.servicePerformance);
      checkArray('OUT-trends', out.trends, 8);
      if (Array.isArray(out.servicePerformance) && out.servicePerformance.length) {
        const svc = out.servicePerformance[0];
        checkShape('OUT-svc', svc, ['service', 'sessionsWithState', 'avgImprovement', 'improvingRate']);
        checkNum('OUT-svc-improvingRate', svc.improvingRate, { min: 0, max: 100 });
      }
    }
  }

  // ── PHASE 4: RETENTION INTELLIGENCE ─────────────────────────────────────
  console.log('\n=== PHASE 4: Retention Intelligence ===');
  const retRes = await req('GET', '/.netlify/functions/analytics?section=retention');
  if (retRes.s !== 200) { fail('RET-status', 'HTTP ' + retRes.s); }
  else {
    pass('RET-status', 'HTTP 200');
    const ret = retRes.b;
    checkShape('RET', ret, ['repeatRate', 'avgSessions', 'followUpCompletion', 'retentionScores', 'totalClients']);
    checkNum('RET-repeatRate', ret.repeatRate, { min: 0, max: 100 });
    checkNum('RET-followUpCompletion', ret.followUpCompletion, { min: 0, max: 100 });
    // retentionScores may be an array or an insufficient_data object
    if (Array.isArray(ret.retentionScores)) {
      pass('RET-scores-array', 'retentionScores is array length=' + ret.retentionScores.length);
      if (ret.repeatClients < 3) warn('RET-scores-guard', 'repeatClients=' + ret.repeatClients + ' < 3 but array returned — expected insufficient_data object');
    } else if (ret.retentionScores && ret.retentionScores.status === 'insufficient_data') {
      checkInsufficient('RET-scores', ret.retentionScores, 'clients');
      if (ret.retentionScores.minimumRequired === 3) pass('RET-scores-minimum-3', 'minimumRequired=3');
      else fail('RET-scores-minimum-3', 'expected 3, got ' + ret.retentionScores.minimumRequired);
      pass('RET-scores-safety-guard', 'insufficient_data returned for retention scores correctly');
    } else {
      fail('RET-scores-shape', 'retentionScores is neither array nor insufficient_data: ' + typeof ret.retentionScores);
    }
    checkNum('RET-rebookingRate', ret.rebookingRate, { nullable: true, min: 0, max: 100 });
  }

  // ── PHASE 5: CROSS-CLIENT INTELLIGENCE ───────────────────────────────────
  console.log('\n=== PHASE 5: Cross-Client Intelligence ===');
  const ccRes = await req('GET', '/.netlify/functions/analytics?section=cross-client');
  if (ccRes.s !== 200) { fail('CC-status', 'HTTP ' + ccRes.s); }
  else {
    pass('CC-status', 'HTTP 200');
    const cc = ccRes.b;
    if (cc.status === 'insufficient_data') {
      checkInsufficient('CC', cc, 'sessions');
      if (cc.minimumRequired === 5) pass('CC-minimum-5', 'minimumRequired=5 correct');
      else fail('CC-minimum-5', 'expected 5, got ' + cc.minimumRequired);
    } else {
      checkShape('CC', cc, ['topConcerns', 'topServices', 'topRecommendations', 'effectivenessMetrics', 'followupTypeDistribution']);
      // PII checks — none of these fields should appear in aggregate output
      const body = JSON.stringify(cc);
      ['email', 'phone', 'full_name', 'client_name'].forEach(f => {
        if (body.includes('"' + f + '"')) fail('CC-no-PII-' + f, '"' + f + '" found in cross-client response');
        else pass('CC-no-PII-' + f, '"' + f + '" absent');
      });
      checkArray('CC-topServices', cc.topServices);
      checkArray('CC-effectivenessMetrics', cc.effectivenessMetrics);
    }
  }

  // ── ERROR HANDLING ────────────────────────────────────────────────────────
  console.log('\n=== Error Handling ===');
  const badRes = await req('GET', '/.netlify/functions/analytics?section=bogus');
  if (badRes.s === 400) pass('ANALYTICS-unknown-section', '400 for unknown section');
  else fail('ANALYTICS-unknown-section', 'expected 400, got ' + badRes.s);
  const noSec = await req('GET', '/.netlify/functions/analytics');
  if (noSec.s === 400) pass('ANALYTICS-no-section', '400 when section omitted');
  else fail('ANALYTICS-no-section', 'expected 400, got ' + noSec.s);

  // ── PHASE 8: DATA QUALITY AUDIT ──────────────────────────────────────────
  console.log('\n=== PHASE 8: Data Quality Audit ===');
  const dqRes = await req('GET', '/.netlify/functions/analytics?section=data-quality');
  if (dqRes.s !== 200) { fail('DQ-status', 'HTTP ' + dqRes.s + ' ' + JSON.stringify(dqRes.b).slice(0, 200)); }
  else {
    pass('DQ-status', 'HTTP 200');
    const dq = dqRes.b;
    checkShape('DQ', dq, ['auditedAt', 'summary', 'issues', 'exclusions', 'status']);
    checkShape('DQ-summary', dq.summary, ['totalIssues', 'Critical', 'High', 'Medium', 'Low']);
    if (checkArray('DQ-issues', dq.issues)) {
      if (dq.issues.length > 0) {
        const issue = dq.issues[0];
        checkShape('DQ-issue-shape', issue, ['severity', 'table', 'issue', 'count', 'detail']);
        const validSev = ['Critical', 'High', 'Medium', 'Low'];
        if (validSev.includes(issue.severity)) pass('DQ-severity-valid', issue.severity);
        else fail('DQ-severity-valid', 'invalid: ' + issue.severity);
        // Issues should be sorted Critical first
        const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
        let sorted = true;
        for (let i = 1; i < dq.issues.length; i++) {
          if ((sevOrder[dq.issues[i].severity] || 0) < (sevOrder[dq.issues[i-1].severity] || 0)) { sorted = false; break; }
        }
        if (sorted) pass('DQ-issues-sorted', 'sorted Critical→High→Medium→Low');
        else fail('DQ-issues-sorted', 'not sorted by severity');
      } else {
        pass('DQ-issues-empty', 'no issues found (clean database)');
      }
    }
    checkShape('DQ-exclusions', dq.exclusions, ['totalExcluded', 'records']);
    const validStatuses = ['clean', 'critical', 'degraded', 'acceptable'];
    if (validStatuses.includes(dq.status)) pass('DQ-status-value', 'status=' + dq.status);
    else fail('DQ-status-value', 'invalid status: ' + dq.status);
    console.log('  Data Quality: ' + dq.status.toUpperCase() + ' — ' + dq.summary.totalIssues + ' issues (' +
      'Critical:' + dq.summary.Critical + ' High:' + dq.summary.High + ' Medium:' + dq.summary.Medium + ' Low:' + dq.summary.Low + ')');
    if (dq.summary.totalIssues > 0) {
      dq.issues.forEach(i => console.log('  [' + i.severity + '] ' + i.table + ' — ' + i.issue + ' (' + i.count + ')'));
    }
  }

  // ── PHASE 7: MERGE LAYER (source definitions) ─────────────────────────────
  console.log('\n=== PHASE 7: Attention Flag Merge Layer ===');
  const flagSrc = fs.readFileSync(path.join(__dirname, '../netlify/functions/client-attention-flags.js'), 'utf8');

  // Source code checks
  [
    ['MERGE-mergeFlags-defined',      flagSrc.includes('function mergeFlags'),             'mergeFlags() defined'],
    ['MERGE-sources-array',           flagSrc.includes("sources: ['deterministic']"),       "sources:['deterministic'] on all det flags"],
    ['MERGE-sources-push-ai',         flagSrc.includes("match.sources.push('ai')"),         "AI matched flags get 'ai' appended to sources"],
    ['MERGE-sources-ai-only',         flagSrc.includes("sources: ['ai']"),                  "AI-only flags get sources:['ai']"],
    ['MERGE-followup-risk-trigger-2', flagSrc.includes('overdue.length >= 2'),              'Follow-Up Risk triggers at 2+ overdue'],
    ['MERGE-no-improvement-3',        flagSrc.includes('sessionsWithState.length >= 3'),    'No Improvement requires 3 sessions'],
    ['MERGE-rec-feedback-tried',      flagSrc.includes("status !== 'purchased' && status !== 'tried'"), 'Recommendation Feedback Gap covers purchased + tried'],
    ['MERGE-severity-merged-source',  flagSrc.includes("source: 'merged'"),                 "source:'merged' on AI path response"],
  ].forEach(([label, ok, desc]) => { if (ok) pass(label, desc); else fail(label, desc + ' — NOT FOUND'); });

  // Live merge test
  const cl = await req('GET', '/.netlify/functions/clients');
  const clients = (cl.b && cl.b.clients) ? cl.b.clients : [];
  if (clients.length > 0) {
    const tc = clients[0];
    const cp = await req('GET', '/.netlify/functions/clients?id=' + tc.id);
    const sessions    = cp.b.sessions        || [];
    const recs        = cp.b.recommendations || [];
    const followUps   = cp.b.aftercare       || [];
    const notes       = cp.b.notes           || [];
    const flagRes = await req('POST', '/.netlify/functions/client-attention-flags', {
      clientName: tc.name || tc.full_name, clientId: tc.id,
      sessions, recommendations: recs, followUps, clientTags: tc.tags || [], notes,
    });
    if (flagRes.s === 200) {
      pass('MERGE-live-status', 'HTTP 200');
      const src = flagRes.b.source;
      if (src === 'merged' || src === 'deterministic') pass('MERGE-live-source', 'source=' + src);
      else fail('MERGE-live-source', 'unexpected source: ' + src);

      const flags = flagRes.b.flags || [];
      pass('MERGE-live-flag-count', flags.length + ' flags');

      // Every flag must have a sources array
      const missingSources = flags.filter(f => !Array.isArray(f.sources));
      if (missingSources.length === 0) pass('MERGE-sources-present-all', 'all flags have sources[]');
      else fail('MERGE-sources-present-all', missingSources.length + ' flag(s) missing sources[]: ' + missingSources.map(f => f.label).join(', '));

      // All sources entries must be 'deterministic' or 'ai'
      const validSources = new Set(['deterministic', 'ai']);
      const badSrc = flags.filter(f => Array.isArray(f.sources) && f.sources.some(s => !validSources.has(s)));
      if (badSrc.length === 0) pass('MERGE-sources-values-valid', 'all sources values are deterministic or ai');
      else fail('MERGE-sources-values-valid', 'invalid source values: ' + badSrc.map(f => f.label + '=' + f.sources).join(', '));

      // Severity values valid
      const validSev = ['urgent', 'warning', 'info', 'success'];
      const badSev = flags.filter(f => !validSev.includes(f.severity));
      if (badSev.length === 0) pass('MERGE-severity-valid', 'all severities valid');
      else fail('MERGE-severity-valid', 'bad: ' + badSev.map(f => f.severity).join(', '));

      // Sort check
      const order = { urgent: 0, warning: 1, info: 2, success: 3 };
      let sorted = true;
      for (let i = 1; i < flags.length; i++) {
        if ((order[flags[i].severity] || 0) < (order[flags[i-1].severity] || 0)) { sorted = false; break; }
      }
      if (sorted) pass('MERGE-sort-order', 'urgent→warning→info→success');
      else warn('MERGE-sort-order', 'not fully sorted by severity');

      // No duplicate labels (merged duplicates should produce 1 entry with sources:['deterministic','ai'])
      const labels = flags.map(f => (f.label || '').toLowerCase());
      const dupLabels = labels.filter((l, i) => labels.indexOf(l) !== i);
      if (dupLabels.length === 0) pass('MERGE-no-dup-labels', 'no duplicate labels');
      else fail('MERGE-no-dup-labels', 'duplicate labels: ' + dupLabels.join(', '));
    } else {
      fail('MERGE-live-status', 'HTTP ' + flagRes.s);
    }
  } else {
    warn('MERGE-live', 'no clients in DB — skipping live merge test');
  }

  // ── RISK DEFINITIONS ─────────────────────────────────────────────────────
  console.log('\n=== Risk Signal Definitions (unit-style source checks) ===');
  [
    ['RISK-followup-trigger-2',   flagSrc.includes('overdue.length >= 2'),           'Follow-Up Risk: trigger at 2+ overdue (not 3)'],
    ['RISK-followup-sev-warning', flagSrc.includes("severity: 'warning'") && flagSrc.includes("'Follow-Up Risk'"), 'Follow-Up Risk: severity warning (medium)'],
    ['RISK-no-improve-3',         flagSrc.includes('sessionsWithState.length >= 3'), 'No Improvement: requires 3 sessions'],
    ['RISK-no-improve-sev-urgent',flagSrc.includes("severity: 'urgent'") && flagSrc.includes("'No Measurable Improvement'"), 'No Improvement: severity urgent (high)'],
    ['RISK-feedback-gap-tried',   flagSrc.includes("status !== 'purchased' && status !== 'tried'"), 'Feedback Gap: covers tried as well as purchased'],
    ['RISK-feedback-gap-14',      flagSrc.includes('>= 14'),                          'Feedback Gap: 14-day threshold'],
    ['RISK-feedback-gap-warning', flagSrc.includes("'Recommendation Feedback Gap'") && flagSrc.includes("severity: 'warning'"), 'Feedback Gap: severity warning (medium)'],
  ].forEach(([label, ok, desc]) => { if (ok) pass(label, desc); else fail(label, desc + ' — NOT FOUND'); });

  // ── PHASE 6: DASHBOARD INTELLIGENCE CARDS ────────────────────────────────
  console.log('\n=== PHASE 6: Dashboard Intelligence Cards ===');
  const dashSrc = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
  [
    ['DASH-intelligenceCards',      dashSrc.includes('id="intelligenceCards"'),             'intelligenceCards div present'],
    ['DASH-loadAnalytics',          dashSrc.includes('loadAnalyticsIntelligence'),           'loadAnalyticsIntelligence() defined'],
    ['DASH-insufficient-handler',   dashSrc.includes('isInsufficient'),                      'isInsufficient() handler defined'],
    ['DASH-insufficient-sub',       dashSrc.includes('insufficientSub'),                     'insufficientSub() message helper defined'],
    ['DASH-retention-fetch',        dashSrc.includes('section=retention'),                   'fetches retention section'],
    ['DASH-recommendations-fetch',  dashSrc.includes('section=recommendations'),             'fetches recommendations section'],
    ['DASH-outcomes-fetch',         dashSrc.includes('section=outcomes'),                    'fetches outcomes section'],
    ['DASH-6-labels',               (dashSrc.match(/Avg Session Improvement|Repeat Client|Follow-Up Completion|Top Recommendation|Recommendation Success Rate|Most Effective Service/g)||[]).length >= 6, '6 metric card labels present'],
    ['DASH-auto-fit-grid',          dashSrc.includes('repeat(auto-fit,minmax(200px'),        'responsive grid present'],
    ['DASH-no-placeholder-values',  !dashSrc.includes('123%') && !dashSrc.includes('$999'), 'no hardcoded placeholder values'],
    ['DASH-empty-state-message',    dashSrc.includes('Need ') && dashSrc.includes('have '), 'insufficient_data empty state wording present'],
  ].forEach(([label, ok, desc]) => { if (ok) pass(label, desc); else fail(label, desc + ' — NOT FOUND'); });

  // ── ANALYTICS SAFETY (source code) ───────────────────────────────────────
  console.log('\n=== Analytics Safety Rules (source code) ===');
  const analyticsSrc = fs.readFileSync(path.join(__dirname, '../netlify/functions/analytics.js'), 'utf8');
  [
    ['SAFETY-insufficient-fn',      analyticsSrc.includes('function insufficientData'),      'insufficientData() helper defined'],
    ['SAFETY-min-outcome-3',        analyticsSrc.includes('OUTCOME_SESSIONS:    3'),          'OUTCOME_SESSIONS minimum = 3'],
    ['SAFETY-min-rec-3',            analyticsSrc.includes('REC_WITH_OUTCOME:    3'),           'REC_WITH_OUTCOME minimum = 3'],
    ['SAFETY-min-retention-3',      analyticsSrc.includes('RETENTION_CLIENTS:   3'),           'RETENTION_CLIENTS minimum = 3'],
    ['SAFETY-min-crossclient-5',    analyticsSrc.includes('CROSS_CLIENT_RECORDS: 5'),          'CROSS_CLIENT_RECORDS minimum = 5'],
    ['SAFETY-no-fabricate-null',    !analyticsSrc.includes('avgImprovement: null'),            'no null avgImprovement returned as metric (uses insufficient_data instead)'],
    ['SAFETY-message-field',        analyticsSrc.includes("message: 'Outcome analytics"),     'human-readable message in outcome insufficient_data response'],
    ['SAFETY-invalid-state-guard',  analyticsSrc.includes('state_before >= 1 && s.state_before <= 5'), 'invalid state range guard in outcome/cross-client'],
    ['SAFETY-data-quality-section', analyticsSrc.includes("section === 'data-quality'"),       'data-quality section exists'],
    ['SAFETY-exclusions',           analyticsSrc.includes('exclusions'),                       'exclusions list in data quality audit'],
  ].forEach(([label, ok, desc]) => { if (ok) pass(label, desc); else fail(label, desc + ' — NOT FOUND'); });

  // ── PERFORMANCE ──────────────────────────────────────────────────────────
  console.log('\n=== Performance ===');
  const sections = ['recommendations', 'outcomes', 'retention', 'cross-client', 'data-quality'];
  for (const section of sections) {
    const t0 = Date.now();
    await req('GET', '/.netlify/functions/analytics?section=' + section);
    const ms = Date.now() - t0;
    if (ms < 3000) pass('PERF-' + section, ms + 'ms');
    else warn('PERF-' + section, ms + 'ms over 3s');
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - results.start) / 1000).toFixed(1);
  console.log('\n════════════════════════════════════════════════════');
  console.log('  Sprint 3 Addendum QA Results');
  console.log('────────────────────────────────────────────────────');
  console.log('  PASS  ' + results.pass);
  console.log('  FAIL  ' + results.fail);
  console.log('  WARN  ' + results.warn);
  console.log('  Time  ' + elapsed + 's');
  console.log('────────────────────────────────────────────────────');
  console.log('  STATUS: ' + (results.fail === 0 ? 'PASS' : 'FAIL — ' + results.fail + ' test(s) failed'));
  console.log('════════════════════════════════════════════════════');
}

run().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
