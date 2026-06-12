// Sprint 3 Phase 9 — Analytics & Intelligence QA Suite
// Tests all 4 analytics sections, dashboard card fields, and merged attention flags
// Run: node qa/analytics-validation.js

const fs   = require('fs');
const path = require('path');
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

// ── HELPERS ──────────────────────────────────────────────────────────────────
function checkShape(label, obj, requiredKeys) {
  if (!obj || typeof obj !== 'object') { fail(label + '-shape', 'response is not an object'); return false; }
  let ok = true;
  requiredKeys.forEach(k => {
    if (!(k in obj)) { fail(label + '-' + k, 'missing key: ' + k); ok = false; }
  });
  if (ok) pass(label + '-shape', 'all required keys present: ' + requiredKeys.join(', '));
  return ok;
}

function checkArray(label, val, minLen) {
  if (!Array.isArray(val)) { fail(label, 'expected array, got ' + typeof val); return false; }
  if (minLen !== undefined && val.length < minLen) {
    warn(label, 'array length ' + val.length + ' (expected >= ' + minLen + ', may be empty data)');
    return false;
  }
  pass(label, 'array length=' + val.length);
  return true;
}

function checkNumber(label, val, opts) {
  if (val === null || val === undefined) {
    if (opts && opts.nullable) { pass(label, 'null (acceptable — no data)'); return true; }
    fail(label, 'null/undefined'); return false;
  }
  if (typeof val !== 'number') { fail(label, 'expected number, got ' + typeof val + ' (' + val + ')'); return false; }
  if (opts && opts.min !== undefined && val < opts.min) { fail(label, 'value ' + val + ' below min ' + opts.min); return false; }
  if (opts && opts.max !== undefined && val > opts.max) { fail(label, 'value ' + val + ' above max ' + opts.max); return false; }
  pass(label, 'value=' + val);
  return true;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  const auth = await req('POST', '/.netlify/functions/verify-pin', { pin: process.env.DASHBOARD_PIN });
  if (!auth.b || !auth.b.token) { fail('AUTH', 'Could not get token'); process.exit(1); }
  _tok = auth.b.token;
  pass('AUTH', 'token acquired');

  // ── SECTION: RECOMMENDATIONS ─────────────────────────────────────────────
  console.log('\n=== PHASE 2: Recommendation Intelligence ===');
  const recRes = await req('GET', '/.netlify/functions/analytics?section=recommendations');
  if (recRes.s !== 200) { fail('REC-status', 'HTTP ' + recRes.s); }
  else {
    pass('REC-status', 'HTTP 200');
    checkShape('REC', recRes.b, ['topRecommendations', 'conversionRates', 'successRates', 'trendData', 'summary']);
    if (Array.isArray(recRes.b.topRecommendations) && recRes.b.topRecommendations.length > 0) {
      const top = recRes.b.topRecommendations[0];
      checkShape('REC-top-item', top, ['name', 'recommendedCount', 'purchased', 'helpful', 'notHelpful', 'declined', 'conversionRate']);
      checkNumber('REC-conversionRate-range', top.conversionRate, { min: 0, max: 100 });
    } else {
      warn('REC-topRecommendations', 'empty — no recommendation data yet');
    }
    checkArray('REC-trendData', recRes.b.trendData, 8);
    if (recRes.b.trendData && recRes.b.trendData.length === 8) {
      const t = recRes.b.trendData[0];
      if ('week' in t && 'count' in t) pass('REC-trendData-shape', 'week+count present');
      else fail('REC-trendData-shape', 'missing week or count');
    }
    const s = recRes.b.summary;
    if (s) checkShape('REC-summary', s, ['totalRecommendations', 'avgDaysToOutcome']);
  }

  // ── SECTION: OUTCOMES ────────────────────────────────────────────────────
  console.log('\n=== PHASE 3: Outcome Intelligence ===');
  const outRes = await req('GET', '/.netlify/functions/analytics?section=outcomes');
  if (outRes.s !== 200) { fail('OUT-status', 'HTTP ' + outRes.s); }
  else {
    pass('OUT-status', 'HTTP 200');
    checkShape('OUT', outRes.b, ['avgImprovement', 'servicePerformance', 'locationPerformance', 'trends', 'totalCompleted']);
    checkNumber('OUT-avgImprovement', outRes.b.avgImprovement, { nullable: true, min: -4, max: 4 });
    checkArray('OUT-servicePerformance', outRes.b.servicePerformance);
    if (Array.isArray(outRes.b.servicePerformance) && outRes.b.servicePerformance.length > 0) {
      const svc = outRes.b.servicePerformance[0];
      checkShape('OUT-svc-item', svc, ['service', 'sessionsWithState', 'avgImprovement', 'improvingRate']);
      checkNumber('OUT-svc-improvingRate', svc.improvingRate, { min: 0, max: 100 });
    }
    checkArray('OUT-trends', outRes.b.trends, 8);
    checkNumber('OUT-totalCompleted', outRes.b.totalCompleted, { nullable: false, min: 0 });
  }

  // ── SECTION: RETENTION ───────────────────────────────────────────────────
  console.log('\n=== PHASE 4: Retention Intelligence ===');
  const retRes = await req('GET', '/.netlify/functions/analytics?section=retention');
  if (retRes.s !== 200) { fail('RET-status', 'HTTP ' + retRes.s); }
  else {
    pass('RET-status', 'HTTP 200');
    checkShape('RET', retRes.b, ['repeatRate', 'avgSessions', 'followUpCompletion', 'retentionScores', 'totalClients']);
    checkNumber('RET-repeatRate', retRes.b.repeatRate, { min: 0, max: 100 });
    checkNumber('RET-avgSessions', retRes.b.avgSessions, { min: 0 });
    checkNumber('RET-followUpCompletion', retRes.b.followUpCompletion, { min: 0, max: 100 });
    checkNumber('RET-rebookingRate', retRes.b.rebookingRate, { nullable: true, min: 0, max: 100 });
    checkArray('RET-retentionScores', retRes.b.retentionScores);
    if (Array.isArray(retRes.b.retentionScores) && retRes.b.retentionScores.length > 0) {
      const sc = retRes.b.retentionScores[0];
      checkShape('RET-score-item', sc, ['client_id', 'sessionCount', 'spanDays', 'sessionsPerMonth']);
    }
  }

  // ── SECTION: CROSS-CLIENT ────────────────────────────────────────────────
  console.log('\n=== PHASE 5: Cross-Client Intelligence ===');
  const ccRes = await req('GET', '/.netlify/functions/analytics?section=cross-client');
  if (ccRes.s !== 200) { fail('CC-status', 'HTTP ' + ccRes.s); }
  else {
    pass('CC-status', 'HTTP 200');
    checkShape('CC', ccRes.b, ['topConcerns', 'topServices', 'topRecommendations', 'effectivenessMetrics', 'followupTypeDistribution']);
    // Verify NO PII fields in response
    const bodyStr = JSON.stringify(ccRes.b);
    const piiFields = ['email', 'phone', 'full_name', 'client_name'];
    piiFields.forEach(f => {
      if (bodyStr.includes('"' + f + '"')) fail('CC-no-PII-' + f, 'PII field "' + f + '" found in cross-client response');
      else pass('CC-no-PII-' + f, '"' + f + '" absent from response');
    });
    checkArray('CC-topServices', ccRes.b.topServices);
    checkArray('CC-topRecommendations', ccRes.b.topRecommendations);
    checkArray('CC-effectivenessMetrics', ccRes.b.effectivenessMetrics);
    if (Array.isArray(ccRes.b.effectivenessMetrics) && ccRes.b.effectivenessMetrics.length > 0) {
      const em = ccRes.b.effectivenessMetrics[0];
      checkShape('CC-effectiveness-item', em, ['service', 'measuredSessions', 'avgImprovement', 'positiveOutcomeRate']);
    }
  }

  // ── UNKNOWN SECTION ──────────────────────────────────────────────────────
  console.log('\n=== Analytics Error Handling ===');
  const badRes = await req('GET', '/.netlify/functions/analytics?section=bogus');
  if (badRes.s === 400) pass('ANALYTICS-unknown-section', 'returns 400 for unknown section');
  else fail('ANALYTICS-unknown-section', 'expected 400, got ' + badRes.s);

  const noSec = await req('GET', '/.netlify/functions/analytics');
  if (noSec.s === 400) pass('ANALYTICS-no-section', 'returns 400 when section omitted');
  else fail('ANALYTICS-no-section', 'expected 400, got ' + noSec.s);

  // ── PHASE 7: MERGE LAYER ─────────────────────────────────────────────────
  console.log('\n=== PHASE 7: Attention Flag Merge Layer ===');

  // When AI key present: response source should be 'merged' (not 'ai' or 'deterministic' alone)
  // We'll test the merge layer via unit-style checks on the function source
  const flagSrc = fs.readFileSync(path.join(__dirname, '../netlify/functions/client-attention-flags.js'), 'utf8');
  if (flagSrc.includes('mergeFlags')) pass('MERGE-function-exists', 'mergeFlags() defined in client-attention-flags.js');
  else fail('MERGE-function-exists', 'mergeFlags() not found');
  if (flagSrc.includes("source: 'merged'")) pass('MERGE-source-label', "source:'merged' returned on AI path");
  else fail('MERGE-source-label', "source:'merged' label missing");
  if (flagSrc.includes('buildFallbackFlags(payload), parsed.flags')) pass('MERGE-always-deterministic', 'deterministic flags always passed to merge');
  else fail('MERGE-always-deterministic', 'deterministic flags not always used');

  // Live merge test: call flags endpoint (if AI key present, should return merged)
  const cl = await req('GET', '/.netlify/functions/clients');
  const clients = cl.b && cl.b.clients ? cl.b.clients : [];
  if (clients.length > 0) {
    const tc = clients[0];
    const cp = await req('GET', '/.netlify/functions/clients?id=' + tc.id);
    const sessions = cp.b.sessions || [];
    const recs     = cp.b.recommendations || [];
    const followUps = cp.b.aftercare || [];
    const notes    = cp.b.notes || [];
    const flagRes  = await req('POST', '/.netlify/functions/client-attention-flags', {
      clientName: tc.name || tc.full_name, clientId: tc.id,
      sessions, recommendations: recs, followUps, clientTags: tc.tags || [], notes,
    });
    if (flagRes.s === 200) {
      pass('MERGE-live-status', 'HTTP 200');
      const src = flagRes.b.source;
      if (src === 'merged' || src === 'deterministic') pass('MERGE-live-source', 'source=' + src);
      else fail('MERGE-live-source', 'unexpected source: ' + src);
      if (Array.isArray(flagRes.b.flags) && flagRes.b.flags.length > 0) {
        pass('MERGE-live-flags', flagRes.b.flags.length + ' flags returned');
        const severities = ['urgent', 'warning', 'info', 'success'];
        const badSev = flagRes.b.flags.filter(f => !severities.includes(f.severity));
        if (badSev.length === 0) pass('MERGE-live-severity-values', 'all severities valid');
        else fail('MERGE-live-severity-values', 'invalid severity: ' + badSev.map(f => f.severity).join(', '));
        // Check flags are sorted urgent→warning→info→success
        const order = { urgent: 0, warning: 1, info: 2, success: 3 };
        let sorted = true;
        for (let i = 1; i < flagRes.b.flags.length; i++) {
          if ((order[flagRes.b.flags[i].severity] || 0) < (order[flagRes.b.flags[i-1].severity] || 0)) { sorted = false; break; }
        }
        if (sorted) pass('MERGE-sort-order', 'flags sorted urgent→warning→info→success');
        else warn('MERGE-sort-order', 'flags not fully sorted by severity');
      } else {
        warn('MERGE-live-flags', 'zero flags (client may have no issues — check manually)');
      }
    } else {
      fail('MERGE-live-status', 'HTTP ' + flagRes.s);
    }
  } else {
    warn('MERGE-live', 'no clients available for live merge test');
  }

  // ── DASHBOARD CARDS ──────────────────────────────────────────────────────
  console.log('\n=== PHASE 6: Dashboard Intelligence Cards ===');
  const dashSrc = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
  const checks = [
    ['DASH-intelligenceCards-div',  dashSrc.includes('id="intelligenceCards"'),      'intelligenceCards div present'],
    ['DASH-loadAnalyticsIntelligence', dashSrc.includes('loadAnalyticsIntelligence'), 'loadAnalyticsIntelligence() function defined'],
    ['DASH-retention-fetch',        dashSrc.includes('section=retention'),             'fetches retention section'],
    ['DASH-recommendations-fetch',  dashSrc.includes('section=recommendations'),       'fetches recommendations section'],
    ['DASH-outcomes-fetch',         dashSrc.includes('section=outcomes'),              'fetches outcomes section'],
    ['DASH-6-cards',                (dashSrc.match(/Avg Session Improvement|Repeat Client|Follow-Up Completion|Top Recommendation|Recommendation Success Rate|Most Effective Service/g)||[]).length >= 6, '6 intelligence card labels present'],
    ['DASH-auto-fit-grid',          dashSrc.includes('repeat(auto-fit,minmax(200px'), 'responsive grid layout present'],
    ['DASH-no-placeholder-metrics', !dashSrc.includes('123%') && !dashSrc.includes('$999'), 'no hardcoded placeholder metrics'],
  ];
  checks.forEach(([label, ok, desc]) => {
    if (ok) pass(label, desc);
    else fail(label, desc + ' — NOT FOUND');
  });

  // ── PERFORMANCE ──────────────────────────────────────────────────────────
  console.log('\n=== Performance ===');
  const sections = ['recommendations', 'outcomes', 'retention', 'cross-client'];
  for (const section of sections) {
    const t0 = Date.now();
    const r  = await req('GET', '/.netlify/functions/analytics?section=' + section);
    const ms = Date.now() - t0;
    if (ms < 3000) pass('PERF-' + section, ms + 'ms');
    else warn('PERF-' + section, ms + 'ms — over 3s threshold');
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - results.start) / 1000).toFixed(1);
  console.log('\n════════════════════════════════════════════════════');
  console.log('  Sprint 3 Analytics QA Results');
  console.log('────────────────────────────────────────────────────');
  console.log(`  PASS  ${results.pass}`);
  console.log(`  FAIL  ${results.fail}`);
  console.log(`  WARN  ${results.warn}`);
  console.log(`  Time  ${elapsed}s`);
  console.log('────────────────────────────────────────────────────');
  if (results.fail === 0) console.log('  STATUS: PASS');
  else console.log('  STATUS: FAIL — ' + results.fail + ' test(s) failed');
  console.log('════════════════════════════════════════════════════');
}

run().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
