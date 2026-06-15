#!/usr/bin/env node
'use strict';
// Sprint 11 QA Suite — Knowledge Engine & Outcome Tracking
// Covers all 12 phases: data verification, CRUD, pattern detection,
// recommendation intelligence, service intelligence, analytics, dashboard.
//
// Usage: node qa/sprint11-qa.js
// Requires qa/.env with: DASHBOARD_PIN, QA_URL (optional)

const fs   = require('fs');
const path = require('path');
const https = require('https');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

const BASE    = (process.env.QA_URL || 'https://royal-energy-alchemy.netlify.app').replace(/\/$/, '');
const PIN     = process.env.DASHBOARD_PIN;
if (!PIN) { console.error('\nERROR: DASHBOARD_PIN required in qa/.env\n'); process.exit(2); }

let _tok = '';
const stats = { pass: 0, fail: 0, warn: 0, skip: 0, start: Date.now() };
const CREATED = {}; // track IDs created during this run for cleanup / cross-test use

// ── HTTP Helpers ──────────────────────────────────────────────────────────────
function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const b   = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + urlPath);
    const opts = {
      hostname: url.hostname, port: 443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':      'application/json',
        'X-Dashboard-Token': _tok,
        ...(b ? { 'Content-Length': Buffer.byteLength(b) } : {}),
      },
    };
    const r = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

const get  = (p)    => req('GET',   p);
const post = (p, b) => req('POST',  p, b);
const patch = (p, b) => req('PATCH', p, b);

// ── Reporters ─────────────────────────────────────────────────────────────────
function pass(t, d)  { stats.pass++;  console.log(`  \x1b[32m✓\x1b[0m PASS  ${t}${d ? '  — ' + d : ''}`); }
function fail(t, d)  { stats.fail++;  console.log(`  \x1b[31m✗\x1b[0m FAIL  ${t}${d ? '  — ' + d : ''}`); }
function warn(t, d)  { stats.warn++;  console.log(`  \x1b[33m!\x1b[0m WARN  ${t}${d ? '  — ' + d : ''}`); }
function skip(t, d)  { stats.skip++;  console.log(`  \x1b[90m-\x1b[0m SKIP  ${t}${d ? '  — ' + d : ''}`); }
function header(s)   { console.log(`\n\x1b[1m\x1b[34m── ${s}\x1b[0m`); }

function checkOk(label, res, expectStatus) {
  const expected = expectStatus || 200;
  if (res.s !== expected) { fail(label, `HTTP ${res.s} (expected ${expected}): ${JSON.stringify(res.b).slice(0,120)}`); return false; }
  pass(label, `HTTP ${res.s}`); return true;
}

function checkField(label, obj, field, type) {
  if (!obj || obj[field] === undefined || obj[field] === null) { fail(label + '.' + field, 'missing or null'); return false; }
  if (type && typeof obj[field] !== type) { fail(label + '.' + field, `expected ${type}, got ${typeof obj[field]}`); return false; }
  pass(label + '.' + field, JSON.stringify(obj[field]).slice(0, 60)); return true;
}

function checkMin(label, arr, min, what) {
  if (!Array.isArray(arr)) { fail(label, `expected array, got ${typeof arr}`); return false; }
  if (arr.length < min) { warn(label, `${arr.length} ${what||'records'} (expected ≥ ${min})`); return arr.length > 0; }
  pass(label, `${arr.length} ${what||'records'}`); return true;
}

function checkNum(label, val, opts) {
  if (val === null || val === undefined) {
    if (opts?.nullable) { pass(label, 'null (acceptable)'); return true; }
    fail(label, 'null/undefined'); return false;
  }
  if (typeof val !== 'number') { fail(label, `not a number: ${typeof val} (${val})`); return false; }
  if (opts?.min !== undefined && val < opts.min) { fail(label, `${val} < min ${opts.min}`); return false; }
  if (opts?.max !== undefined && val > opts.max) { fail(label, `${val} > max ${opts.max}`); return false; }
  pass(label, `${val}`); return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASES
// ══════════════════════════════════════════════════════════════════════════════

// Phase 1 — Verify seed data counts via analytics
async function phase1_seedVerification() {
  header('Phase 1: Seed Data Verification');

  const r = await get('/.netlify/functions/analytics?section=data-quality');
  if (!checkOk('data-quality-endpoint', r)) return;
  const b = r.b;

  const clientCount  = b.metrics?.find(m => m.table === 'clients' || m.label?.toLowerCase().includes('client'))?.count
                     || b.clientCount || b.total_clients;
  const sessionCount = b.metrics?.find(m => m.table === 'sessions')?.count
                     || b.sessionCount || b.total_sessions;

  // Cross-validate: fetch KE dashboard which also shows outcome count
  const kd = await get('/.netlify/functions/knowledge-engine?section=dashboard');
  if (!checkOk('ke-dashboard', kd)) return;
  const km = kd.b.metrics || {};

  checkNum('seed.outcomes_tracked', km.outcomes_tracked, { min: 30 });
  checkNum('seed.case_studies',     km.case_studies,     { min: 5 });
  checkNum('seed.pattern_candidates', km.pattern_candidates + (km.confirmed_patterns||0), { min: 5 });
  checkNum('seed.draft_insights',   km.draft_insights,   { min: 5 });
  checkNum('seed.research_flags',   km.research_flags,   { min: 10 });

  // Rec intelligence has data
  const ri = await get('/.netlify/functions/knowledge-engine?section=rec_intelligence');
  checkOk('rec_intelligence-endpoint', ri);
  checkMin('rec_intelligence.products', ri.b.topRecommendations, 3, 'products');
  checkMin('rec_intelligence.categories', ri.b.byCategory, 1, 'categories');
  checkNum('rec_intelligence.total',  ri.b.summary?.total, { min: 20 });

  // Service intelligence has data
  const si = await get('/.netlify/functions/knowledge-engine?section=service_intelligence');
  checkOk('service_intelligence-endpoint', si);
  checkMin('service_intelligence.services', si.b.services, 1, 'services');
}

// Phase 2 — Outcome create / read / patch
async function phase2_outcomeValidation() {
  header('Phase 2: Outcome Validation (CRUD)');

  // POST: create outcome for a known seeded session
  const sess = '22222222-0001-0000-0000-000000000024'; // Tamsin Blake session 1
  const client = '11111111-0024-0000-0000-000000000024';

  const createRes = await post('/.netlify/functions/outcomes', {
    session_id:        sess,
    client_id:         client,
    client_name:       'QA Test Client',
    session_date:      '2026-06-15',
    outcome_category:  'improved',
    improvement_level: 8,
    energy_shift:      'Significant clearing of mental field.',
    practitioner_notes: 'QA-generated test outcome. Safe to delete.',
    research_flag:     false,
  });
  if (!checkOk('outcome.create', createRes, 201)) return;
  const outcomeId = createRes.b.outcome?.id;
  checkField('outcome.create', createRes.b.outcome, 'id', 'string');
  checkField('outcome.create', createRes.b.outcome, 'outcome_category', 'string');
  CREATED.outcomeId = outcomeId;

  // GET by session
  const getBySession = await get(`/.netlify/functions/outcomes?session_id=${sess}`);
  checkOk('outcome.get-by-session', getBySession);
  checkMin('outcome.get-by-session.results', getBySession.b.outcomes, 1, 'outcomes');

  // GET by client
  const getByClient = await get(`/.netlify/functions/outcomes?client_id=${client}`);
  checkOk('outcome.get-by-client', getByClient);
  checkMin('outcome.get-by-client.results', getByClient.b.outcomes, 1, 'outcomes');

  // PATCH
  if (outcomeId) {
    const patchRes = await patch(`/.netlify/functions/outcomes?id=${outcomeId}`, {
      improvement_level: 9,
      practitioner_notes: 'QA-updated note.',
    });
    checkOk('outcome.patch', patchRes);
    if (patchRes.b.outcome?.improvement_level === 9) {
      pass('outcome.patch.value-verified', 'improvement_level updated to 9');
    } else {
      fail('outcome.patch.value-verified', `got ${patchRes.b.outcome?.improvement_level}`);
    }
  }

  // Validate all 4 categories accepted
  const categories = ['improved','no_change','worse','mixed'];
  for (const cat of categories) {
    const r = await post('/.netlify/functions/outcomes', {
      client_id:        client,
      session_date:     '2026-06-15',
      outcome_category: cat,
    });
    if (r.s === 201) pass(`outcome.category.${cat}`, 'accepted');
    else fail(`outcome.category.${cat}`, `HTTP ${r.s}: ${JSON.stringify(r.b).slice(0,80)}`);
  }

  // Validate invalid category rejected
  const badCat = await post('/.netlify/functions/outcomes', {
    client_id:        client,
    session_date:     '2026-06-15',
    outcome_category: 'amazing',
  });
  if (badCat.s === 400) pass('outcome.invalid-category-rejected', 'HTTP 400 as expected');
  else fail('outcome.invalid-category-rejected', `HTTP ${badCat.s} — should be 400`);
}

// Phase 3 — Recommendation intelligence validation
async function phase3_recIntelligence() {
  header('Phase 3: Recommendation Intelligence Validation');

  const r = await get('/.netlify/functions/knowledge-engine?section=rec_intelligence');
  if (!checkOk('rec_intel.endpoint', r)) return;

  const top  = r.b.topRecommendations || [];
  const cats = r.b.byCategory || [];
  const sum  = r.b.summary    || {};

  checkMin('rec_intel.topRecommendations', top, 3, 'products');
  checkMin('rec_intel.byCategory',         cats, 2, 'categories');

  if (top.length > 0) {
    const t = top[0];
    checkField('rec_intel.top[0]', t, 'name',        'string');
    checkField('rec_intel.top[0]', t, 'total',       'number');
    checkField('rec_intel.top[0]', t, 'helpfulRate', 'number');
    checkNum('rec_intel.top[0].helpfulRate', t.helpfulRate, { min: 0, max: 100 });

    // Grounding Meditation should rank highly given seed data
    const gm = top.find(p => p.name === 'Grounding Meditation Practice');
    if (gm) {
      pass('rec_intel.grounding-present', `helpfulRate=${gm.helpfulRate}%`);
      checkNum('rec_intel.grounding.helpfulRate', gm.helpfulRate, { min: 70 });
    } else {
      warn('rec_intel.grounding-present', 'Grounding Meditation Practice not in top 15 (check seed data)');
    }
  }

  checkField('rec_intel.summary', sum, 'total', 'number');
  checkNum('rec_intel.summary.total', sum.total, { min: 20 });
  if (sum.topProduct) pass('rec_intel.summary.topProduct', sum.topProduct);
  else warn('rec_intel.summary.topProduct', 'null — may need more data');

  // Categories cover books, crystals, practices
  const catNames = cats.map(c => c.category);
  ['book','crystal','practice','meditation'].forEach(cat => {
    if (catNames.includes(cat)) pass(`rec_intel.category.${cat}`, 'present');
    else warn(`rec_intel.category.${cat}`, `not found in ${JSON.stringify(catNames)}`);
  });
}

// Phase 4 — Client Goal validation
async function phase4_goalValidation() {
  header('Phase 4: Client Goal Validation');

  const clientId = '11111111-0005-0000-0000-000000000005'; // Simone Hayes

  // GET existing goals
  const getRes = await get(`/.netlify/functions/outcomes?goals=1&client_id=${clientId}`);
  checkOk('goals.get', getRes);
  checkMin('goals.get.results', getRes.b.goals, 1, 'goals');

  if (getRes.b.goals?.[0]) {
    const g = getRes.b.goals[0];
    checkField('goals.item', g, 'id',          'string');
    checkField('goals.item', g, 'goal_text',   'string');
    checkField('goals.item', g, 'status',      'string');
    checkField('goals.item', g, 'goal_category', 'string');
  }

  // POST: create new goal
  const createRes = await post('/.netlify/functions/outcomes', {
    goal:          true,
    client_id:     clientId,
    client_name:   'QA Test',
    goal_text:     'QA test goal — maintain energetic stability for 30 days',
    goal_category: 'energy',
    status:        'active',
  });
  if (!checkOk('goals.create', createRes, 201)) return;
  const goalId = createRes.b.goal?.id;
  CREATED.goalId = goalId;
  checkField('goals.create', createRes.b.goal, 'id', 'string');

  // PATCH: achieve the goal
  if (goalId) {
    const patchRes = await patch(`/.netlify/functions/outcomes?goal_id=${goalId}`, {
      status:        'achieved',
      outcome_notes: 'QA validation — goal achieved.',
    });
    checkOk('goals.patch', patchRes);
    if (patchRes.b.goal?.status === 'achieved') {
      pass('goals.patch.status-verified', 'status=achieved');
    } else {
      fail('goals.patch.status-verified', `got ${patchRes.b.goal?.status}`);
    }
    if (patchRes.b.goal?.achieved_at) {
      pass('goals.patch.achieved_at-auto-set', patchRes.b.goal.achieved_at);
    } else {
      fail('goals.patch.achieved_at-auto-set', 'achieved_at not set automatically');
    }
  }

  // Validate all goal categories accepted
  const goalCategories = ['healing','energy','mental','physical','spiritual','emotional','general'];
  for (const cat of goalCategories) {
    const r = await post('/.netlify/functions/outcomes', {
      goal: true, client_id: clientId, client_name: 'QA',
      goal_text: `QA goal — ${cat}`, goal_category: cat,
    });
    if (r.s === 201) pass(`goals.category.${cat}`, 'accepted');
    else fail(`goals.category.${cat}`, `HTTP ${r.s}`);
  }
}

// Phase 5 — Research flag validation
async function phase5_researchFlags() {
  header('Phase 5: Research Flag Validation');

  // GET research flags
  const r = await get('/.netlify/functions/outcomes?research=1');
  checkOk('research_flags.endpoint', r);
  checkMin('research_flags.results', r.b.research_flags, 10, 'research-flagged outcomes');

  if (r.b.research_flags?.length) {
    const flag = r.b.research_flags[0];
    checkField('research_flag.item', flag, 'id',               'string');
    checkField('research_flag.item', flag, 'outcome_category', 'string');
    if (flag.research_flag !== true) fail('research_flag.item.flag', 'research_flag should be true');
    else pass('research_flag.item.flag', 'true');
  }

  // POST: create research-flagged outcome
  const createRes = await post('/.netlify/functions/outcomes', {
    client_id:         '11111111-0015-0000-0000-000000000015',
    client_name:       'QA Research Flag Test',
    session_date:      '2026-06-15',
    outcome_category:  'improved',
    improvement_level: 10,
    research_flag:     true,
    research_notes:    'QA-generated research flag. Documenting exceptional outcome for research.',
  });
  checkOk('research_flags.create', createRes, 201);
  if (createRes.b.outcome?.research_flag === true) {
    pass('research_flags.create.flag-persisted', 'research_flag=true confirmed');
  } else {
    fail('research_flags.create.flag-persisted', `got ${createRes.b.outcome?.research_flag}`);
  }

  // Verify it appears in GET research=1
  const r2 = await get('/.netlify/functions/outcomes?research=1');
  const newCount = r2.b.research_flags?.length || 0;
  if (newCount > (r.b.research_flags?.length || 0)) {
    pass('research_flags.count-increased', `${newCount} > ${r.b.research_flags?.length}`);
  } else {
    warn('research_flags.count-increased', `count did not increase (${newCount})`);
  }

  // KE dashboard research_flags count
  const kd = await get('/.netlify/functions/knowledge-engine?section=dashboard');
  checkOk('research_flags.ke-dashboard', kd);
  checkNum('research_flags.ke-dashboard.count', kd.b.metrics?.research_flags, { min: 10 });
}

// Phase 6 — Pattern engine validation
async function phase6_patternEngine() {
  header('Phase 6: Pattern Engine Validation');

  // GET existing patterns
  const listRes = await get('/.netlify/functions/knowledge-engine?section=patterns');
  checkOk('patterns.list', listRes);
  checkMin('patterns.list.results', listRes.b.patterns, 5, 'patterns');

  if (listRes.b.patterns?.length) {
    const p = listRes.b.patterns[0];
    checkField('patterns.item', p, 'id',               'string');
    checkField('patterns.item', p, 'title',            'string');
    checkField('patterns.item', p, 'pattern_type',     'string');
    checkField('patterns.item', p, 'supporting_count', 'number');
    checkField('patterns.item', p, 'confidence_level', 'string');
    checkField('patterns.item', p, 'status',           'string');
    if (!['emerging','moderate','strong'].includes(p.confidence_level)) {
      fail('patterns.item.confidence_level-valid', `got "${p.confidence_level}"`);
    } else {
      pass('patterns.item.confidence_level-valid', p.confidence_level);
    }
  }

  // Filter by status
  const candidateRes = await get('/.netlify/functions/knowledge-engine?section=patterns&status=candidate');
  checkOk('patterns.filter-candidate', candidateRes);
  if (Array.isArray(candidateRes.b.patterns)) {
    const allCandidate = candidateRes.b.patterns.every(p => p.status === 'candidate');
    if (allCandidate) pass('patterns.filter-candidate.status-correct', `${candidateRes.b.patterns.length} records`);
    else fail('patterns.filter-candidate.status-correct', 'returned non-candidate records');
  }

  // Run pattern detection
  const detectRes = await get('/.netlify/functions/knowledge-engine?section=detect');
  checkOk('patterns.detect', detectRes);
  checkField('patterns.detect.response', detectRes.b, 'detected', 'number');
  checkField('patterns.detect.response', detectRes.b, 'saved',    'number');
  checkNum('patterns.detect.detected', detectRes.b.detected, { min: 1 });
  checkNum('patterns.detect.saved',    detectRes.b.saved,    { min: 1 });

  if (detectRes.b.detected > 0) {
    checkMin('patterns.detect.patterns-array', detectRes.b.patterns, 1, 'patterns');
    const p = detectRes.b.patterns?.[0];
    if (p) {
      checkField('patterns.detect.item', p, 'id',           'string');
      checkField('patterns.detect.item', p, 'title',        'string');
      checkField('patterns.detect.item', p, 'pattern_type', 'string');
    }
  }

  // POST: manual pattern creation
  const createRes = await post('/.netlify/functions/knowledge-engine', {
    type:             'pattern',
    pattern_type:     'outcome',
    title:            'QA Test Pattern — High improvement in first session for grounded clients',
    description:      'QA validation record.',
    supporting_count: 5,
    confidence_level: 'emerging',
    status:           'candidate',
  });
  if (!checkOk('patterns.create', createRes, 201)) return;
  CREATED.patternId = createRes.b.pattern?.id;
  checkField('patterns.create', createRes.b.pattern, 'id', 'string');

  // PATCH: confirm the pattern
  if (CREATED.patternId) {
    const patchRes = await patch(`/.netlify/functions/knowledge-engine?id=${CREATED.patternId}&type=pattern`, {
      status: 'confirmed',
    });
    checkOk('patterns.patch', patchRes);
    if (patchRes.b.pattern?.status === 'confirmed') {
      pass('patterns.patch.status-confirmed', 'confirmed');
    } else {
      fail('patterns.patch.status-confirmed', `got ${patchRes.b.pattern?.status}`);
    }
  }
}

// Phase 7 — Research insight validation
async function phase7_researchInsights() {
  header('Phase 7: Research Insight Validation');

  // GET existing insights
  const listRes = await get('/.netlify/functions/knowledge-engine?section=insights');
  checkOk('insights.list', listRes);
  checkMin('insights.list.results', listRes.b.insights, 5, 'insights');

  if (listRes.b.insights?.length) {
    const ins = listRes.b.insights[0];
    checkField('insights.item', ins, 'id',               'string');
    checkField('insights.item', ins, 'title',            'string');
    checkField('insights.item', ins, 'description',      'string');
    checkField('insights.item', ins, 'category',         'string');
    checkField('insights.item', ins, 'confidence_level', 'string');
    checkField('insights.item', ins, 'status',           'string');
  }

  // Filter by status=draft
  const draftRes = await get('/.netlify/functions/knowledge-engine?section=insights&status=draft');
  checkOk('insights.filter-draft', draftRes);
  checkMin('insights.filter-draft.results', draftRes.b.insights, 1, 'draft insights');

  // POST: create new insight
  const createRes = await post('/.netlify/functions/knowledge-engine', {
    type:             'insight',
    title:            'QA Test Insight — Grounding meditation reduces session recovery time',
    category:         'recommendation',
    description:      'QA validation record. Clients adopting grounding practice report faster energetic stabilization after sessions.',
    confidence_level: 'emerging',
    status:           'draft',
    content_tags:     ['training_material','youtube_content'],
    practitioner_notes: 'QA-generated record. Safe to delete.',
  });
  if (!checkOk('insights.create', createRes, 201)) return;
  CREATED.insightId = createRes.b.insight?.id;
  checkField('insights.create', createRes.b.insight, 'id',               'string');
  checkField('insights.create', createRes.b.insight, 'title',            'string');
  checkField('insights.create', createRes.b.insight, 'confidence_level', 'string');

  // PATCH: promote to under_review
  if (CREATED.insightId) {
    const patchRes = await patch(`/.netlify/functions/knowledge-engine?id=${CREATED.insightId}&type=insight`, {
      status: 'under_review',
    });
    checkOk('insights.patch', patchRes);
    if (patchRes.b.insight?.status === 'under_review') {
      pass('insights.patch.status-updated', 'under_review');
    } else {
      fail('insights.patch.status-updated', `got ${patchRes.b.insight?.status}`);
    }
  }

  // Content tags preserved
  if (createRes.b.insight?.content_tags) {
    const tags = createRes.b.insight.content_tags;
    if (tags.includes('training_material')) pass('insights.content_tags.training_material', 'present');
    else fail('insights.content_tags.training_material', `tags=${JSON.stringify(tags)}`);
    if (tags.includes('youtube_content')) pass('insights.content_tags.youtube_content', 'present');
    else fail('insights.content_tags.youtube_content', `tags=${JSON.stringify(tags)}`);
  }
}

// Phase 8 — Case study validation
async function phase8_caseStudies() {
  header('Phase 8: Case Study Validation');

  // GET existing case studies
  const listRes = await get('/.netlify/functions/knowledge-engine?section=case_studies');
  checkOk('case_studies.list', listRes);
  checkMin('case_studies.list.results', listRes.b.case_studies, 5, 'case studies');

  if (listRes.b.case_studies?.length) {
    const cs = listRes.b.case_studies[0];
    checkField('case_studies.item', cs, 'id',             'string');
    checkField('case_studies.item', cs, 'status',         'string');
    if (cs.anonymized !== true) fail('case_studies.item.anonymized', 'should be true');
    else pass('case_studies.item.anonymized', 'true');
  }

  // GET published only
  const pubRes = await get('/.netlify/functions/knowledge-engine?section=case_studies&status=published');
  checkOk('case_studies.filter-published', pubRes);
  checkMin('case_studies.filter-published.results', pubRes.b.case_studies, 3, 'published case studies');

  // POST: manual case study creation
  const createRes = await post('/.netlify/functions/knowledge-engine', {
    type:             'case_study',
    title:            'QA Test Case Study — Distance Healing for Test Client',
    client_alias:     'Client 999',
    service:          'Distance Healing',
    problem:          'QA validation: client presenting with energetic overwhelm.',
    intervention:     'Distance Healing session with chakra clearing focus.',
    outcome:          'Category: improved. Improvement level: 8/10.',
    lessons_learned:  'QA test — validate case study persistence.',
    outcome_category: 'improved',
    improvement_level: 8,
    status:           'draft',
    content_tags:     ['research_publication'],
    anonymized:       true,
  });
  if (!checkOk('case_studies.create', createRes, 201)) return;
  CREATED.caseStudyId = createRes.b.case_study?.id;
  checkField('case_studies.create', createRes.b.case_study, 'id',             'string');
  checkField('case_studies.create', createRes.b.case_study, 'client_alias',   'string');
  if (createRes.b.case_study?.anonymized !== true) {
    fail('case_studies.create.anonymized', 'not true');
  } else {
    pass('case_studies.create.anonymized', 'true');
  }

  // Auto-generate from session
  const sessId = '22222222-0002-0000-0000-000000000005'; // Simone Hayes session 2 (has outcome + notes)
  const genRes = await post('/.netlify/functions/knowledge-engine', {
    generate_case_study: true,
    session_id: sessId,
  });
  checkOk('case_studies.auto-generate', genRes, 201);
  if (genRes.b.case_study) {
    const cs = genRes.b.case_study;
    checkField('case_studies.auto-generate', cs, 'id',             'string');
    checkField('case_studies.auto-generate', cs, 'client_alias',   'string');
    if (cs.client_alias?.includes('Client ')) {
      pass('case_studies.auto-generate.anonymized-alias', cs.client_alias);
    } else {
      fail('case_studies.auto-generate.anonymized-alias', `got: ${cs.client_alias}`);
    }
    if (cs.problem && cs.problem.length > 5)      pass('case_studies.auto-generate.problem',      cs.problem.slice(0,60));
    else fail('case_studies.auto-generate.problem', 'empty or missing');
    if (cs.intervention && cs.intervention.length > 5) pass('case_studies.auto-generate.intervention', cs.intervention.slice(0,60));
    else fail('case_studies.auto-generate.intervention', 'empty or missing');
    if (cs.anonymized !== true) fail('case_studies.auto-generate.anonymized', 'should be true');
    else pass('case_studies.auto-generate.anonymized', 'true');
    CREATED.autoGenCaseStudyId = cs.id;
  }

  // PATCH: publish a case study
  if (CREATED.caseStudyId) {
    const patchRes = await patch(`/.netlify/functions/knowledge-engine?id=${CREATED.caseStudyId}&type=case_study`, {
      status: 'under_review',
    });
    checkOk('case_studies.patch', patchRes);
    if (patchRes.b.case_study?.status === 'under_review') {
      pass('case_studies.patch.status-updated', 'under_review');
    } else {
      fail('case_studies.patch.status-updated', `got ${patchRes.b.case_study?.status}`);
    }
  }
}

// Phase 9 — Service intelligence validation
async function phase9_serviceIntelligence() {
  header('Phase 9: Service Intelligence Validation');

  const r = await get('/.netlify/functions/knowledge-engine?section=service_intelligence');
  if (!checkOk('service_intel.endpoint', r)) return;

  const services = r.b.services || [];
  const summary  = r.b.summary  || {};

  checkMin('service_intel.services', services, 2, 'services');

  // Distance Healing should be present (most seeded sessions)
  const dh = services.find(s => s.service === 'Distance Healing');
  if (dh) {
    pass('service_intel.distance-healing-present', `${dh.totalSessions} sessions`);
    checkNum('service_intel.dh.totalSessions', dh.totalSessions, { min: 30 });
    checkNum('service_intel.dh.improvementRate', dh.improvementRate, { min: 60, nullable: true });
    checkNum('service_intel.dh.repeatRate', dh.repeatRate, { min: 0, max: 100 });
  } else {
    warn('service_intel.distance-healing-present', 'not found — check seed data loaded');
  }

  // Sacred Autonomy Assessment
  const sa = services.find(s => s.service === 'Sacred Autonomy Assessment');
  if (sa) {
    pass('service_intel.assessment-present', `${sa.totalSessions} sessions`);
  } else {
    warn('service_intel.assessment-present', 'not found');
  }

  // Summary fields
  if (summary.totalServices) pass('service_intel.summary.totalServices', `${summary.totalServices}`);
  else warn('service_intel.summary.totalServices', 'null');

  // Validate calculated fields are sane
  services.forEach(s => {
    if (s.repeatRate < 0 || s.repeatRate > 100) {
      fail(`service_intel.${s.service}.repeatRate-range`, `${s.repeatRate} out of 0-100`);
    }
    if (s.improvementRate !== null && s.improvementRate !== undefined) {
      if (s.improvementRate < 0 || s.improvementRate > 100) {
        fail(`service_intel.${s.service}.improvementRate-range`, `${s.improvementRate}`);
      }
    }
  });
  pass('service_intel.field-ranges-valid', `checked ${services.length} services`);
}

// Phase 10 — Knowledge Hub Dashboard validation
async function phase10_keDashboard() {
  header('Phase 10: Knowledge Hub Dashboard Validation');

  const r = await get('/.netlify/functions/knowledge-engine?section=dashboard');
  if (!checkOk('ke-dashboard.endpoint', r)) return;

  const m = r.b.metrics || {};

  // All KPI fields present and non-null
  const fields = ['research_flags','pattern_candidates','confirmed_patterns',
                  'published_insights','draft_insights','case_studies',
                  'published_case_studies','outcomes_tracked'];
  fields.forEach(f => {
    if (m[f] !== undefined && m[f] !== null) pass(`ke-dashboard.metrics.${f}`, `${m[f]}`);
    else warn(`ke-dashboard.metrics.${f}`, 'null or missing');
  });

  // improvement_rate may be null if no outcomes — acceptable
  if (m.improvement_rate !== null && m.improvement_rate !== undefined) {
    checkNum('ke-dashboard.metrics.improvement_rate', m.improvement_rate, { min: 0, max: 100 });
  } else {
    warn('ke-dashboard.metrics.improvement_rate', 'null (acceptable if no completed outcomes with improved category)');
  }

  // Populated data check
  checkNum('ke-dashboard.outcomes_tracked',    m.outcomes_tracked,    { min: 30 });
  checkNum('ke-dashboard.research_flags',      m.research_flags,      { min: 10 });
  checkNum('ke-dashboard.case_studies',        m.case_studies,        { min: 5 });

  // recentPatterns and recentInsights arrays
  if (Array.isArray(r.b.recentPatterns)) {
    pass('ke-dashboard.recentPatterns', `${r.b.recentPatterns.length} records`);
  } else {
    fail('ke-dashboard.recentPatterns', 'not an array');
  }
  if (Array.isArray(r.b.recentInsights)) {
    pass('ke-dashboard.recentInsights', `${r.b.recentInsights.length} records`);
  } else {
    fail('ke-dashboard.recentInsights', 'not an array');
  }
}

// Phase 11 — Analytics endpoint verification
async function phase11_analytics() {
  header('Phase 11: Analytics Endpoint Verification');

  const sections = [
    { path: '/.netlify/functions/analytics?section=recommendations', key: null, label: 'analytics.recommendations' },
    { path: '/.netlify/functions/analytics?section=outcomes',        key: null, label: 'analytics.outcomes' },
    { path: '/.netlify/functions/analytics?section=retention',       key: null, label: 'analytics.retention' },
    { path: '/.netlify/functions/analytics?section=cross-client',    key: null, label: 'analytics.cross-client' },
    { path: '/.netlify/functions/analytics?section=data-quality',    key: null, label: 'analytics.data-quality' },
    { path: '/.netlify/functions/analytics?section=outcome-attribution', key: null, label: 'analytics.outcome-attribution' },
    { path: '/.netlify/functions/analytics?section=practitioner-outcomes', key: null, label: 'analytics.practitioner-outcomes' },
  ];

  for (const s of sections) {
    const r = await get(s.path);
    if (r.s === 200) {
      pass(s.label, `HTTP 200 — keys: ${Object.keys(r.b).join(', ').slice(0, 80)}`);
    } else if (r.s === 400 && r.b?.status === 'insufficient_data') {
      warn(s.label, `insufficient_data (min=${r.b.minimumRequired}, current=${r.b.currentCount})`);
    } else {
      fail(s.label, `HTTP ${r.s}: ${JSON.stringify(r.b).slice(0, 120)}`);
    }
  }

  // outcomes?research=1
  const rf = await get('/.netlify/functions/outcomes?research=1');
  checkOk('analytics.research-flags-endpoint', rf);
  if (Array.isArray(rf.b.research_flags)) {
    pass('analytics.research-flags-array', `${rf.b.research_flags.length} records`);
  }

  // Verify improvement_rate sanity from KE dashboard
  const kd = await get('/.netlify/functions/knowledge-engine?section=dashboard');
  if (kd.b.metrics?.improvement_rate !== null && kd.b.metrics?.improvement_rate !== undefined) {
    checkNum('analytics.improvement_rate', kd.b.metrics.improvement_rate, { min: 50, max: 100 });
  } else {
    warn('analytics.improvement_rate', 'null from KE dashboard');
  }
}

// Phase 12 — Full QA summary + edge cases
async function phase12_edgeCases() {
  header('Phase 12: Edge Cases & Guard Rails');

  // Missing required fields — outcome
  const missingCat = await post('/.netlify/functions/outcomes', {
    client_id: '11111111-0001-0000-0000-000000000001',
    session_date: '2026-06-15',
    // outcome_category missing
  });
  if (missingCat.s === 400) pass('edge.outcome-missing-category', 'HTTP 400 as expected');
  else fail('edge.outcome-missing-category', `HTTP ${missingCat.s}`);

  // Missing client_id for outcome
  const missingClient = await post('/.netlify/functions/outcomes', {
    outcome_category: 'improved',
    session_date: '2026-06-15',
  });
  if (missingClient.s === 400) pass('edge.outcome-missing-client', 'HTTP 400 as expected');
  else fail('edge.outcome-missing-client', `HTTP ${missingClient.s}`);

  // Missing goal_text for goal
  const missingGoalText = await post('/.netlify/functions/outcomes', {
    goal: true, client_id: '11111111-0001-0000-0000-000000000001',
  });
  if (missingGoalText.s === 400) pass('edge.goal-missing-goal_text', 'HTTP 400 as expected');
  else fail('edge.goal-missing-goal_text', `HTTP ${missingGoalText.s}`);

  // Missing title for insight
  const missingTitle = await post('/.netlify/functions/knowledge-engine', {
    type: 'insight', description: 'No title provided.',
  });
  if (missingTitle.s === 400) pass('edge.insight-missing-title', 'HTTP 400 as expected');
  else fail('edge.insight-missing-title', `HTTP ${missingTitle.s}`);

  // Unknown KE section
  const unknownSection = await get('/.netlify/functions/knowledge-engine?section=does_not_exist');
  if (unknownSection.s === 400) pass('edge.unknown-ke-section', 'HTTP 400 as expected');
  else fail('edge.unknown-ke-section', `HTTP ${unknownSection.s}`);

  // PATCH non-existent ID
  const badId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const patchBad = await patch(`/.netlify/functions/knowledge-engine?id=${badId}&type=insight`, {
    status: 'published',
  });
  if (patchBad.s === 404) pass('edge.patch-nonexistent-insight', 'HTTP 404 as expected');
  else warn('edge.patch-nonexistent-insight', `HTTP ${patchBad.s} (expected 404)`);

  // Goals require client_id
  const goalNoClient = await post('/.netlify/functions/outcomes', {
    goal: true, goal_text: 'Test',
  });
  if (goalNoClient.s === 400) pass('edge.goal-missing-client_id', 'HTTP 400 as expected');
  else fail('edge.goal-missing-client_id', `HTTP ${goalNoClient.s}`);

  // generate_case_study with missing session_id
  const noSessId = await post('/.netlify/functions/knowledge-engine', {
    generate_case_study: true,
  });
  if (noSessId.s === 400) pass('edge.generate-case-study-no-session', 'HTTP 400 as expected');
  else fail('edge.generate-case-study-no-session', `HTTP ${noSessId.s}`);

  // generate_case_study with non-existent session_id
  const badSess = await post('/.netlify/functions/knowledge-engine', {
    generate_case_study: true,
    session_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  });
  if (badSess.s === 404 || badSess.s === 500) pass('edge.generate-case-study-bad-session', `HTTP ${badSess.s} as expected`);
  else warn('edge.generate-case-study-bad-session', `HTTP ${badSess.s}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log('\n\x1b[1mRoyal Energy Alchemy — Sprint 11 QA Suite\x1b[0m');
  console.log(`Target: ${BASE}`);
  console.log(`Date:   ${new Date().toISOString()}\n`);

  // Authenticate
  header('Authentication');
  const authRes = await req('POST', '/.netlify/functions/verify-pin', { pin: PIN });
  if (!authRes.b?.token) {
    fail('AUTH', `no token — status=${authRes.s}`);
    process.exit(1);
  }
  _tok = authRes.b.token;
  pass('AUTH', 'token acquired');

  await phase1_seedVerification();
  await phase2_outcomeValidation();
  await phase3_recIntelligence();
  await phase4_goalValidation();
  await phase5_researchFlags();
  await phase6_patternEngine();
  await phase7_researchInsights();
  await phase8_caseStudies();
  await phase9_serviceIntelligence();
  await phase10_keDashboard();
  await phase11_analytics();
  await phase12_edgeCases();

  // ── Summary ─────────────────────────────────────────────────
  const elapsed = ((Date.now() - stats.start) / 1000).toFixed(1);
  const total   = stats.pass + stats.fail + stats.warn + stats.skip;
  const verdict = stats.fail === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';

  console.log('\n' + '─'.repeat(60));
  console.log(`\x1b[1mResults: ${verdict}\x1b[0m`);
  console.log(`  ✓ PASS  ${stats.pass}`);
  console.log(`  ✗ FAIL  ${stats.fail}`);
  console.log(`  ! WARN  ${stats.warn}`);
  console.log(`  - SKIP  ${stats.skip}`);
  console.log(`  Total   ${total}  (${elapsed}s)`);
  console.log('─'.repeat(60) + '\n');

  if (stats.fail > 0) {
    console.log('ACTION REQUIRED: Fix failing checks before marking Sprint 11 complete.\n');
  } else if (stats.warn > 0) {
    console.log('PASS with warnings. Review WARN items — most require seed data to be present in Supabase.\n');
  } else {
    console.log('All checks passed. Sprint 11 QA COMPLETE.\n');
  }

  process.exit(stats.fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
