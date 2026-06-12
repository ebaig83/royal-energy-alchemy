// Data Quality Investigation Script
// Pulls full audit-detail from the live server and produces all 7 deliverables.
// Read-only. Does NOT modify any production records.
// Run: node qa/data-quality-investigation.js

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

function hr(char, len) { return (char || '─').repeat(len || 72); }
function pad(s, w) { return String(s).padEnd(w); }
function rpad(s, w) { return String(s).padStart(w); }
function fmtDate(d) { return d ? String(d).slice(0, 10) : '—'; }
function tag(severity) {
  return { Critical: '[CRIT]', High: '[HIGH]', Medium: '[MED ]', Low: '[LOW ]' }[severity] || '[    ]';
}

async function run() {
  // ── AUTH ─────────────────────────────────────────────────────────
  const auth = await req('POST', '/.netlify/functions/verify-pin', { pin: process.env.DASHBOARD_PIN });
  if (!auth.b || !auth.b.token) { console.error('AUTH FAILED'); process.exit(1); }
  _tok = auth.b.token;
  console.log('Authenticated. Pulling full audit data...\n');

  // ── FETCH BOTH ENDPOINTS IN PARALLEL ─────────────────────────────
  const [detailRes, summaryRes] = await Promise.all([
    req('GET', '/.netlify/functions/analytics?section=audit-detail'),
    req('GET', '/.netlify/functions/analytics?section=data-quality'),
  ]);

  if (detailRes.s !== 200) {
    console.error('audit-detail failed:', detailRes.s, JSON.stringify(detailRes.b).slice(0, 300));
    process.exit(1);
  }

  const D = detailRes.b;   // full detail
  const S = summaryRes.b;  // structured summary

  const out = [];
  function p(...args) { const line = args.join(' '); out.push(line); process.stdout.write(line + '\n'); }
  function section(title) { p('\n' + hr('═')); p('  ' + title); p(hr('─')); }

  const now = new Date();

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 1 — DATA QUALITY REPORT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 1 — DATA QUALITY REPORT');
  p(`Generated: ${D.generatedAt}`);
  p(`Database: clients=${D.counts.clients}  sessions=${D.counts.sessions}  recommendations=${D.counts.recommendations}  aftercare=${D.counts.aftercare}  intakes=${D.counts.intakes}`);
  p(`Overall Status: ${(S.status || 'unknown').toUpperCase()}`);
  p('');

  if (S.issues && S.issues.length > 0) {
    p(pad('Severity', 10) + pad('Table', 18) + pad('Issue', 44) + rpad('Count', 6));
    p(hr('─', 78));
    S.issues.forEach(i => {
      p(tag(i.severity) + ' ' + pad(i.table, 16) + pad(i.issue, 44) + rpad(i.count, 6));
    });
    p('');
    p('Detail:');
    S.issues.forEach(i => p(`  ${tag(i.severity)} ${i.detail}`));
  } else {
    p('  No issues found — database is clean.');
  }

  // Additional findings from detail endpoint
  const extraFindings = [];
  if (D.clients.blankNames.length)           extraFindings.push({ severity: 'High',   table: 'clients',   issue: 'Blank client names', count: D.clients.blankNames.length });
  if (D.clients.noContact.length)            extraFindings.push({ severity: 'Medium', table: 'clients',   issue: 'No email or phone on file', count: D.clients.noContact.length });
  if (D.aftercare.orphanedSession.length)    extraFindings.push({ severity: 'Medium', table: 'aftercare', issue: 'Broken session_id references', count: D.aftercare.orphanedSession.length });
  if (D.intakes.unmatched.length)            extraFindings.push({ severity: 'Low',    table: 'intake',    issue: 'Unmatched/unprocessed submissions', count: D.intakes.unmatched.length });
  if (D.recommendations.purchasedNoFeedback.length) extraFindings.push({ severity: 'Low', table: 'recommendations', issue: 'Purchased/tried >30 days, no feedback', count: D.recommendations.purchasedNoFeedback.length });

  if (extraFindings.length) {
    p('\nAdditional findings from full record scan:');
    extraFindings.forEach(f => p(`  ${tag(f.severity)} ${pad(f.table, 16)} ${pad(f.issue, 44)} ${rpad(f.count, 4)}`));
  }

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 2 — DUPLICATE REPORT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 2 — DUPLICATE REPORT');

  // ── Duplicate emails ──────────────────────────────────────────────
  p(`\nA. DUPLICATE CLIENT EMAILS (${D.duplicates.emails.length} groups)`);
  if (D.duplicates.emails.length === 0) {
    p('  None found.');
  } else {
    D.duplicates.emails.forEach((grp, gi) => {
      // Classify
      const names = grp.clients.map(c => (c.full_name || '').toLowerCase().trim());
      const nameMatch = names.every(n => n === names[0]);
      const hasArchived = grp.clients.some(c => c.status === 'archived' || c.status === 'inactive');
      const allActive = grp.clients.every(c => c.status === 'active');
      const isTestGroup = grp.clients.some(c => (c.tags || []).some(t => ['qa','test','seed','demo'].includes((t||'').toLowerCase())));

      let classification, rationale;
      if (isTestGroup) {
        classification = 'TEST DATA';
        rationale = 'At least one record has QA/test tag';
      } else if (nameMatch && hasArchived) {
        classification = 'SAFE MERGE CANDIDATE';
        rationale = 'Same name, same email, one record is archived/inactive';
      } else if (nameMatch && allActive) {
        classification = 'MANUAL REVIEW REQUIRED';
        rationale = 'Same name and email but multiple active records — possible duplicate bookings';
      } else if (!nameMatch) {
        classification = 'POSSIBLE DUPLICATE';
        rationale = 'Same email but different names — may be shared email or data entry error';
      } else {
        classification = 'MANUAL REVIEW REQUIRED';
        rationale = 'Conflicting information';
      }

      p(`\n  Group ${gi + 1}: ${grp.email} (${grp.count} records) → ${classification}`);
      p(`  Rationale: ${rationale}`);
      grp.clients.forEach(c => {
        p(`    ${c.id} | ${pad(c.full_name || '(blank)', 28)} | ${pad(c.status, 10)} | tags:${(c.tags||[]).join(',')||'none'} | created:${fmtDate(c.created_at)}`);
      });
    });
  }

  // ── Duplicate phones ──────────────────────────────────────────────
  p(`\nB. DUPLICATE CLIENT PHONES (${D.duplicates.phones.length} groups)`);
  if (D.duplicates.phones.length === 0) {
    p('  None found.');
  } else {
    D.duplicates.phones.forEach((grp, gi) => {
      const names = grp.clients.map(c => (c.full_name || '').toLowerCase().trim());
      const nameMatch = names.every(n => n === names[0]);
      const isTestGroup = grp.clients.some(c => (c.tags || []).some(t => ['qa','test','seed','demo'].includes((t||'').toLowerCase())));
      const emails = grp.clients.map(c => c.email).filter(Boolean);
      const sameEmail = emails.length > 1 && emails.every(e => e === emails[0]);

      let classification;
      if (isTestGroup)           classification = 'TEST DATA';
      else if (sameEmail)        classification = 'SAFE MERGE CANDIDATE (same email + phone)';
      else if (nameMatch)        classification = 'POSSIBLE DUPLICATE (same name, same phone, different email)';
      else                       classification = 'MANUAL REVIEW REQUIRED (different names, same phone)';

      p(`\n  Group ${gi + 1}: ${grp.phone} (${grp.count} records) → ${classification}`);
      grp.clients.forEach(c => {
        p(`    ${c.id} | ${pad(c.full_name || '(blank)', 28)} | email:${c.email || '—'} | ${c.status} | created:${fmtDate(c.created_at)}`);
      });
    });
  }

  // ── Duplicate sessions ────────────────────────────────────────────
  p(`\nC. DUPLICATE SESSIONS (${D.duplicates.sessions.length} groups — same client+date)`);
  if (D.duplicates.sessions.length === 0) {
    p('  None found.');
  } else {
    D.duplicates.sessions.forEach((grp, gi) => {
      const statuses = grp.sessions.map(s => s.status);
      const sources  = [...new Set(grp.sessions.map(s => s.source))];
      const services = [...new Set(grp.sessions.map(s => s.service || '—'))];
      const hasCompleted = statuses.includes('completed');
      const hasPending   = statuses.includes('pending');
      const mixedSources = sources.length > 1;

      let classification;
      if (mixedSources && hasCompleted && hasPending)
        classification = 'SAFE MERGE CANDIDATE (duplicate import — one completed, one pending, different sources)';
      else if (services.length === 1 && sources.length === 1)
        classification = 'MANUAL REVIEW REQUIRED (identical service + source — possible double-submit)';
      else
        classification = 'POSSIBLE DUPLICATE (review manually)';

      p(`\n  Group ${gi + 1}: ${grp.client_id} | date:${grp.session_date} (${grp.count} sessions) → ${classification}`);
      grp.sessions.forEach(s => {
        p(`    ${s.id} | ${pad(s.service || '—', 30)} | status:${pad(s.status, 12)} | pay:${pad(s.payment_status, 8)} | src:${s.source || '—'} | created:${fmtDate(s.created_at)}`);
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 3 — MISSING OUTCOME REPORT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 3 — MISSING OUTCOME REPORT (Sessions without state scores)');
  p(`Total completed sessions: ${D.analyticsReadiness.effectiveSampleSizes.completedSessions}`);
  p(`Missing state_before or state_after: ${D.sessions.missingState.length}`);
  p('');

  if (D.sessions.missingState.length === 0) {
    p('  All completed sessions have state scores. No action required.');
  } else {
    p(pad('Session ID (short)', 38) + pad('Client', 26) + pad('Date', 12) + pad('Service', 28) + 'Assessment');
    p(hr('─', 120));
    D.sessions.missingState.forEach(s => {
      // Classify reason
      const isTest = D.testData.sessions.some(t => t.id === s.id);
      const isOld  = s.session_date && new Date(s.session_date) < new Date('2025-01-01');
      const hasNotes = s.seller_notes && s.seller_notes.length > 5;

      let reason, action;
      if (isTest) {
        reason = 'Test/QA session';
        action = 'Tag as test — exclude from analytics';
      } else if (isOld) {
        reason = 'Historical — pre-dates state tracking feature';
        action = 'Accept as historical; no backfill';
      } else if (!s.service) {
        reason = 'Incomplete entry — no service type';
        action = 'Review with Daron — may be test or cancelled';
      } else {
        reason = 'Real session — state scores not entered';
        action = 'Add state scores if outcome data available; otherwise accept as gap';
      }

      p(`${s.id.slice(0, 8)}…${s.id.slice(-4)} | ${pad(s.client_name || '—', 24)} | ${fmtDate(s.session_date)} | ${pad(s.service || '—', 26)} | ${reason}`);
      p(`${' '.repeat(50)}→ ${action}`);
      p(`${' '.repeat(50)}  state_before=${s.state_before ?? 'NULL'}  state_after=${s.state_after ?? 'NULL'}`);
    });
    p('');
    p('Note: State scores must NEVER be backfilled with guesses or averages.');
    p('Only enter scores if Daron has a genuine recollection of the session outcome.');
  }

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 4 — TEST DATA REPORT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 4 — TEST DATA REPORT');
  const td = D.testData;
  p(`Test/QA clients detected:  ${td.clients.length}`);
  p(`Test sessions linked:      ${td.sessions.length}`);
  p(`Test recommendations:      ${td.recommendations.length}`);
  p(`Test follow-ups:           ${td.aftercare.length}`);
  p('');

  if (td.clients.length === 0) {
    p('  No test/QA clients detected by tag or name pattern.');
    p('  If QA workflow tests were run, those clients may not have QA tags applied.');
    p('  Recommendation: Ensure all QA scripts apply tags:["qa"] to test records.');
  } else {
    p('Test clients:');
    td.clients.forEach(c => {
      p(`  ${c.id} | ${pad(c.full_name, 30)} | email:${c.email || '—'} | tags:${(c.tags||[]).join(',')} | created:${fmtDate(c.created_at)}`);
    });
    if (td.sessions.length > 0) {
      p('\nTest sessions:');
      td.sessions.slice(0, 20).forEach(s => {
        p(`  ${s.id.slice(0,8)}… | ${pad(s.client_name || '—', 26)} | ${fmtDate(s.session_date)} | ${s.status} | src:${s.source}`);
      });
      if (td.sessions.length > 20) p(`  … and ${td.sessions.length - 20} more`);
    }
    p('');
    p('Recommended action: Confirm these are QA records, then apply tags:["qa"] to any missing.');
    p('The _filterQA() function in clients.js already excludes tagged records from analytics.');
    p('Do NOT delete test records — tag them instead for traceability.');
  }

  // Stale pending sessions
  p(`\nStale pending sessions (${D.sessions.stalePending.length} sessions pending 90+ days):`);
  if (D.sessions.stalePending.length === 0) {
    p('  None found.');
  } else {
    p(pad('Session ID (short)', 14) + pad('Client', 26) + pad('Date', 12) + pad('Days Old', 10) + pad('Service', 28) + 'Source');
    p(hr('─', 100));
    D.sessions.stalePending.forEach(s => {
      const isTest = D.testData.sessions.some(t => t.id === s.id);
      const marker = isTest ? '[TEST]' : '      ';
      p(`${marker} ${s.id.slice(0,8)}… | ${pad(s.client_name || '—', 24)} | ${fmtDate(s.session_date)} | ${rpad(s.daysOld+'d', 8)} | ${pad(s.service || '—', 26)} | ${s.source || '—'}`);
    });
    p('');
    p('Classification guide:');
    const testStale  = D.sessions.stalePending.filter(s => D.testData.sessions.some(t => t.id === s.id));
    const realStale  = D.sessions.stalePending.filter(s => !D.testData.sessions.some(t => t.id === s.id));
    const veryOld    = realStale.filter(s => s.daysOld > 365);
    const mildlyOld  = realStale.filter(s => s.daysOld <= 365);
    p(`  Test data sessions: ${testStale.length} → Classify as test, apply qa tag`);
    p(`  Real sessions >365 days old: ${veryOld.length} → Archive candidates (status=cancelled)`);
    p(`  Real sessions 90-365 days old: ${mildlyOld.length} → Manual review — confirm with Daron`);
  }

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 5 — ANALYTICS READINESS REPORT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 5 — ANALYTICS READINESS REPORT');
  const ar = D.analyticsReadiness;
  const eff = ar.effectiveSampleSizes;
  p('');
  p('SAMPLE SIZE SUMMARY');
  p(hr('─', 60));
  p(`  Total completed sessions:                    ${rpad(eff.completedSessions, 4)}`);
  p(`  Completed sessions (non-test):               ${rpad(eff.completedNonTest, 4)}`);
  p(`  Sessions with valid state scores (all):      ${rpad(eff.sessionsWithValidState, 4)}`);
  p(`  Sessions with valid state scores (non-test): ${rpad(eff.sessionsWithValidStateNonTest, 4)}`);
  p(`  Recommendations with tracked outcome:        ${rpad(eff.recsWithOutcome, 4)}`);
  p(`  Total recommendations:                       ${rpad(eff.totalRecommendations, 4)}`);
  p('');

  const MIN_OUTCOME = 3, MIN_REC = 3, MIN_RET = 3;

  function readinessLabel(actual, min) {
    if (actual >= min * 3) return 'HEALTHY    ✓';
    if (actual >= min)     return 'LIMITED    ⚠';
    if (actual > 0)        return 'BORDERLINE ⚠';
    return 'INSUFFICIENT ✗';
  }

  p('ANALYTICS READINESS BY SECTION');
  p(hr('─', 60));
  p(`  Outcome Intelligence (min ${MIN_OUTCOME}):   ${readinessLabel(eff.sessionsWithValidStateNonTest, MIN_OUTCOME)}`);
  p(`    → ${eff.sessionsWithValidStateNonTest} valid non-test scored sessions`);
  p(`    → ${D.sessions.missingState.length} completed sessions missing state scores (excluded)`);
  p('');
  p(`  Recommendation Analytics (min ${MIN_REC}): ${readinessLabel(eff.recsWithOutcome, MIN_REC)}`);
  p(`    → ${eff.recsWithOutcome} recommendations with a tracked outcome`);
  p(`    → ${D.recommendations.noOutcome.length} recommendations still at "recommended" (no outcome yet)`);
  p('');
  p(`  Retention Analytics (min ${MIN_RET} repeat clients):`);
  p(`    → Calculated live — see retention section in analytics`);
  p('');
  p('WHAT IS TRUSTWORTHY TODAY');
  p(hr('─', 60));
  const trustworthy = [];
  if (eff.sessionsWithValidStateNonTest >= MIN_OUTCOME) trustworthy.push('Outcome improvement trend');
  if (eff.sessionsWithValidStateNonTest >= MIN_OUTCOME) trustworthy.push('Service performance comparison');
  if (eff.recsWithOutcome >= MIN_REC)                  trustworthy.push('Recommendation conversion rates');
  if (eff.totalRecommendations >= 5)                   trustworthy.push('Top recommended products list');
  if (eff.completedNonTest >= 10)                      trustworthy.push('Session volume and history');
  if (trustworthy.length === 0)                        trustworthy.push('Basic session counts only');
  trustworthy.forEach(t => p(`  ✓ ${t}`));
  p('');
  p('WHAT IS NOT YET TRUSTWORTHY');
  p(hr('─', 60));
  const notReady = [];
  if (eff.sessionsWithValidStateNonTest < 9)  notReady.push('Statistical improvement trends (need 9+ scored sessions for confidence)');
  if (D.duplicates.sessions.length > 0)       notReady.push(`Session counts inflated by ${D.duplicates.sessions.length} duplicate session pairs`);
  if (D.duplicates.emails.length > 0)         notReady.push(`Client counts inflated by ${D.duplicates.emails.length} duplicate email groups`);
  if (notReady.length === 0)                  notReady.push('None — all metrics within acceptable ranges');
  notReady.forEach(n => p(`  ✗ ${n}`));

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 6 — CLEANUP PLAN
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 6 — CLEANUP PLAN');

  p('\nSAFE CLEANUP ACTIONS (can be applied with confidence)');
  p(hr('─', 60));
  const safeActions = [];

  // Test data tagging
  if (td.clients.length > 0) {
    safeActions.push({
      priority: 1,
      action: 'Apply tags:["qa"] to confirmed test clients',
      count: td.clients.length,
      rationale: '_filterQA() already excludes tagged records — just need tags applied',
      how: 'PATCH /clients?id=X with {"tags":["qa"]}',
    });
  }
  // Stale sessions from test clients
  const testStaleCount = D.sessions.stalePending.filter(s => D.testData.sessions.some(t => t.id === s.id)).length;
  if (testStaleCount > 0) {
    safeActions.push({
      priority: 2,
      action: 'Mark test-linked stale pending sessions as cancelled',
      count: testStaleCount,
      rationale: 'Confirmed test data — safe to close out',
      how: 'PATCH /sessions?id=X with {"status":"cancelled"}',
    });
  }
  // Archived/inactive duplicate email where one record has no sessions
  safeActions.push({
    priority: 3,
    action: 'Archive inactive clients in duplicate email groups (confirmed same person)',
    count: D.duplicates.emails.filter(g => g.clients.some(c => c.status === 'inactive' || c.status === 'archived')).length,
    rationale: 'Inactive record + same name = safe to archive or tag as duplicate',
    how: 'PATCH /clients?id=X with {"status":"archived"} on the older/inactive record',
  });

  if (safeActions.length === 0) safeActions.push({ priority: 1, action: 'No safe automated cleanup identified', count: 0 });
  safeActions.forEach(a => {
    p(`\n  [${a.priority}] ${a.action} (${a.count} records)`);
    p(`      Rationale: ${a.rationale}`);
    if (a.how) p(`      How: ${a.how}`);
  });

  p('\nMANUAL REVIEW ACTIONS (require Daron\'s confirmation)');
  p(hr('─', 60));

  const manualGroups = D.duplicates.emails.filter(g => {
    return !g.clients.some(c => (c.tags || []).some(t => ['qa','test','seed','demo'].includes((t||'').toLowerCase())));
  });
  if (manualGroups.length > 0) {
    p(`\n  [M1] Review ${manualGroups.length} duplicate email group(s):`);
    manualGroups.forEach(g => {
      p(`       ${g.email} — ${g.count} clients: ${g.clients.map(c => c.full_name || '—').join(' / ')}`);
      p(`       Question: Are these the same person? If yes → merge. If no → add notes.`);
    });
  }

  const dupPhoneManual = D.duplicates.phones.filter(g => {
    return !g.clients.some(c => (c.tags || []).some(t => ['qa','test','seed','demo'].includes((t||'').toLowerCase())));
  });
  if (dupPhoneManual.length > 0) {
    p(`\n  [M2] Review ${dupPhoneManual.length} duplicate phone group(s):`);
    dupPhoneManual.forEach(g => {
      p(`       Phone ending in ${g.phone.slice(-4)} — ${g.count} clients: ${g.clients.map(c => c.full_name || '—').join(' / ')}`);
    });
  }

  const realDupSessions = D.duplicates.sessions;
  if (realDupSessions.length > 0) {
    p(`\n  [M3] Review ${realDupSessions.length} duplicate session pair(s):`);
    realDupSessions.forEach(g => {
      p(`       Client ${g.client_id.slice(0,8)}… | date:${g.session_date} | ${g.count} sessions`);
      g.sessions.forEach(s => p(`         ${s.id.slice(0,8)}… status:${s.status} src:${s.source}`));
      p(`       Action: Keep the completed/paid record; cancel/delete the pending duplicate.`);
    });
  }

  const realStale = D.sessions.stalePending.filter(s => !D.testData.sessions.some(t => t.id === s.id));
  if (realStale.length > 0) {
    p(`\n  [M4] Review ${realStale.length} stale pending sessions (real clients):`);
    p(`       For each, confirm with Daron:`);
    p(`         - Did this session actually happen? → mark completed or add to history`);
    p(`         - Was it cancelled/no-show? → mark cancelled`);
    p(`         - Is it a form submission with no follow-up? → mark cancelled`);
    realStale.slice(0, 10).forEach(s => {
      p(`       ${s.id.slice(0,8)}… | ${pad(s.client_name || '—', 24)} | ${fmtDate(s.session_date)} | ${s.daysOld}d old | ${s.service || '—'}`);
    });
    if (realStale.length > 10) p(`       … and ${realStale.length - 10} more`);
  }

  if (D.sessions.missingState.length > 0) {
    const realMissing = D.sessions.missingState.filter(s => !D.testData.sessions.some(t => t.id === s.id));
    if (realMissing.length > 0) {
      p(`\n  [M5] Review ${realMissing.length} completed sessions missing state scores:`);
      p(`       For each, ask Daron if he remembers the client's starting/ending state.`);
      p(`       If yes → PATCH /sessions?id=X with {state_before, state_after}.`);
      p(`       If no  → leave as-is. Never guess.`);
    }
  }

  p('\nUNSAFE ACTIONS — DO NOT AUTOMATE');
  p(hr('─', 60));
  [
    'Hard-delete any client, session, recommendation, or aftercare record',
    'Backfill state_before / state_after with averages or guesses',
    'Merge client records without verifying with Daron that they are the same person',
    'Bulk-cancel sessions without per-record confirmation',
    'Remove intake submissions (they are source-of-truth for form data)',
    'Modify payment_status fields (financial records require manual audit)',
  ].forEach((a, i) => p(`  [U${i+1}] ${a}`));

  // ══════════════════════════════════════════════════════════════════
  // DELIVERABLE 7 — RECOMMENDED SPRINT
  // ══════════════════════════════════════════════════════════════════
  section('DELIVERABLE 7 — RECOMMENDED NEXT SPRINT');

  p('\nPriority order based on analytics impact:');
  p('');

  const sprint = [
    {
      priority: 1, title: 'Resolve duplicate session pairs',
      effort: 'Low', impact: 'High',
      why: `${D.duplicates.sessions.length} duplicate pairs inflate session counts and distort analytics. Most are likely Square-import + manual entry for the same booking.`,
      action: 'Review each pair in Deliverable 2C. Cancel the pending duplicate. Takes ~5 minutes per pair.',
    },
    {
      priority: 2, title: 'Merge or archive duplicate client records',
      effort: 'Low', impact: 'High',
      why: `${D.duplicates.emails.length} duplicate email groups mean client history is split across records. Retention and follow-up analytics are undercounting.`,
      action: 'For same-name + same-email duplicates: archive the older record after verifying no unique sessions are attached to it.',
    },
    {
      priority: 3, title: 'Add state scores to recent completed sessions',
      effort: 'Medium', impact: 'High',
      why: `${D.sessions.missingState.length} completed sessions are excluded from outcome analytics. Even adding scores to 5-10 real sessions meaningfully improves analytics confidence.`,
      action: 'Daron reviews each session in Deliverable 3. Enters scores only where he genuinely recalls the outcome. No guessing.',
    },
    {
      priority: 4, title: 'Classify and close stale pending sessions',
      effort: 'Medium', impact: 'Medium',
      why: `${D.sessions.stalePending.length} sessions stuck in "pending" for 90+ days distort capacity and retention metrics.`,
      action: 'Review Deliverable 4. Mark each as completed, cancelled, or no-show. Confirmed test sessions → apply qa tag.',
    },
    {
      priority: 5, title: 'Apply qa tags to all test/QA client records',
      effort: 'Low', impact: 'Medium',
      why: 'Test records contaminate cross-client intelligence if not properly tagged. _filterQA() works correctly — just needs tags applied.',
      action: 'PATCH each confirmed QA client with tags:["qa"]. All linked sessions are then auto-excluded.',
    },
    {
      priority: 6, title: 'Add Data Quality Score to Operations Center',
      effort: 'Medium', impact: 'Low',
      why: 'Operational visibility into data health prevents issues from accumulating silently.',
      action: 'Add a DQ card to Ops Center: score/100, duplicate count, missing outcome count, stale session count, analytics readiness.',
    },
  ];

  sprint.forEach(s => {
    p(`  [${s.priority}] ${s.title}`);
    p(`      Effort: ${s.effort}  |  Impact: ${s.impact}`);
    p(`      Why: ${s.why}`);
    p(`      Action: ${s.action}`);
    p('');
  });

  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  section('SUMMARY');
  p(`  Records audited:     ${D.counts.clients} clients, ${D.counts.sessions} sessions, ${D.counts.recommendations} recommendations, ${D.counts.aftercare} follow-ups, ${D.counts.intakes} intakes`);
  p(`  Overall DB status:   ${(S.status || 'unknown').toUpperCase()}`);
  p(`  Duplicate groups:    ${D.duplicates.emails.length} email, ${D.duplicates.phones.length} phone, ${D.duplicates.sessions.length} session`);
  p(`  Missing state scores:${D.sessions.missingState.length} completed sessions`);
  p(`  Stale pending:       ${D.sessions.stalePending.length} sessions`);
  p(`  Test records found:  ${D.testData.clients.length} clients, ${D.testData.sessions.length} sessions`);
  p(`  Outcome analytics:   ${D.analyticsReadiness.outcomeAnalytics}`);
  p(`  Rec analytics:       ${D.analyticsReadiness.recommendationAnalytics}`);
  p('');
  p('  Production data was NOT modified. This is a read-only investigation.');
  p('  Review Deliverable 6 for the cleanup plan before taking any action.');
  p('\n' + hr('═'));

  // Save to file
  const outPath = path.join(__dirname, 'data-quality-report.txt');
  fs.writeFileSync(outPath, out.join('\n'), 'utf8');
  console.log(`\nReport saved to: ${outPath}`);
}

run().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1); });
