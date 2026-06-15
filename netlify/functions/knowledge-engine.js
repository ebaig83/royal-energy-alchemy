// /.netlify/functions/knowledge-engine
//
// GET  ?section=dashboard          — research metrics (KPIs)
// GET  ?section=patterns           — list patterns (with optional ?status=candidate|confirmed)
// GET  ?section=detect             — run pattern detection, upsert candidates, return results
// GET  ?section=insights           — list research_insights (with optional ?status=)
// GET  ?section=case_studies       — list case studies
// GET  ?section=rec_intelligence   — recommendation effectiveness (top performers, content-tagged)
// GET  ?section=service_intelligence — service outcomes, retention, follow-up rates
//
// POST type='pattern'|'insight'|'case_study' — create record
// POST generate_case_study=true&session_id=  — auto-generate from session data
//
// PATCH ?id=&type='pattern'|'insight'|'case_study' — update record

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const CONFIDENCE_THRESHOLDS = { emerging: 3, moderate: 6, strong: 10 };

function confidenceLevel(count) {
  if (count >= CONFIDENCE_THRESHOLDS.strong)   return 'strong';
  if (count >= CONFIDENCE_THRESHOLDS.moderate) return 'moderate';
  return 'emerging';
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'dashboard';
    try {
      if (section === 'dashboard')            return respond(200, await getDashboard(sb));
      if (section === 'patterns')             return respond(200, await getPatterns(sb, params));
      if (section === 'detect')               return respond(200, await detectPatterns(sb, auth.user.email, ip));
      if (section === 'insights')             return respond(200, await getInsights(sb, params));
      if (section === 'case_studies')         return respond(200, await getCaseStudies(sb, params));
      if (section === 'rec_intelligence')     return respond(200, await getRecIntelligence(sb));
      if (section === 'service_intelligence') return respond(200, await getServiceIntelligence(sb));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[knowledge-engine] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Auto-generate case study from session data
    if (body.generate_case_study) {
      if (!body.session_id) return respond(400, { error: 'session_id required.' });
      try {
        const cs = await generateCaseStudy(sb, body.session_id, body);
        const { data, error } = await sb.from('case_studies').insert(cs).select().single();
        if (error) return respond(500, { error: error.message });
        await log({ actor: auth.user.email, action: 'created', tableName: 'case_studies', recordId: data.id, newData: data, context: `Auto-generated case study for session ${body.session_id}`, ip });
        return respond(201, { case_study: data });
      } catch (err) {
        return respond(500, { error: err.message });
      }
    }

    const type = body.type;
    if (!type) return respond(400, { error: 'type (pattern|insight|case_study) is required.' });

    if (type === 'pattern') {
      if (!body.title) return respond(400, { error: 'title is required.' });
      const insert = {
        pattern_type:     body.pattern_type     || 'other',
        title:            body.title,
        description:      body.description      || null,
        supporting_count: body.supporting_count || 0,
        confidence_level: body.confidence_level || 'emerging',
        status:           body.status           || 'candidate',
        data_snapshot:    body.data_snapshot    || null,
        content_tags:     body.content_tags     || null,
      };
      const { data, error } = await sb.from('patterns').insert(insert).select().single();
      if (error) {
        if (error.code === '23505') return respond(409, { error: 'Pattern with this title already exists.', duplicate: true });
        return respond(500, { error: error.message });
      }
      await log({ actor: auth.user.email, action: 'created', tableName: 'patterns', recordId: data.id, newData: data, context: `Pattern created: ${data.title}`, ip });
      return respond(201, { pattern: data });
    }

    if (type === 'insight') {
      if (!body.title || !body.description) return respond(400, { error: 'title and description are required.' });
      const insert = {
        title:                  body.title,
        category:               body.category               || 'other',
        description:            body.description,
        supporting_pattern_ids: body.supporting_pattern_ids || null,
        confidence_level:       body.confidence_level       || 'emerging',
        status:                 body.status                 || 'draft',
        content_tags:           body.content_tags           || null,
        practitioner_notes:     body.practitioner_notes     || null,
      };
      const { data, error } = await sb.from('research_insights').insert(insert).select().single();
      if (error) return respond(500, { error: error.message });
      await log({ actor: auth.user.email, action: 'created', tableName: 'research_insights', recordId: data.id, newData: data, context: `Research insight created: ${data.title}`, ip });
      return respond(201, { insight: data });
    }

    if (type === 'case_study') {
      const insert = {
        session_id:       body.session_id       || null,
        outcome_id:       body.outcome_id       || null,
        title:            body.title            || null,
        client_alias:     body.client_alias     || null,
        service:          body.service          || null,
        problem:          body.problem          || null,
        intervention:     body.intervention     || null,
        outcome:          body.outcome          || null,
        lessons_learned:  body.lessons_learned  || null,
        outcome_category: body.outcome_category || null,
        improvement_level: body.improvement_level || null,
        status:           body.status           || 'draft',
        content_tags:     body.content_tags     || null,
        anonymized:       body.anonymized !== false,
      };
      const { data, error } = await sb.from('case_studies').insert(insert).select().single();
      if (error) return respond(500, { error: error.message });
      await log({ actor: auth.user.email, action: 'created', tableName: 'case_studies', recordId: data.id, newData: data, context: `Case study created: ${data.title || data.id}`, ip });
      return respond(201, { case_study: data });
    }

    return respond(400, { error: `Unknown type: ${type}` });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id || !params.type) return respond(400, { error: 'id and type are required.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const table = params.type === 'pattern' ? 'patterns' : params.type === 'insight' ? 'research_insights' : 'case_studies';
    const ALLOWED = {
      pattern:     ['pattern_type','title','description','supporting_count','confidence_level','status','data_snapshot','content_tags'],
      insight:     ['title','category','description','supporting_pattern_ids','confidence_level','status','content_tags','practitioner_notes'],
      case_study:  ['title','client_alias','service','problem','intervention','outcome','lessons_learned','outcome_category','improvement_level','status','content_tags','anonymized'],
    };

    const { data: old } = await sb.from(table).select('*').eq('id', params.id).single();
    if (!old) return respond(404, { error: `${params.type} not found.` });

    const updates = {};
    (ALLOWED[params.type] || []).forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await sb.from(table).update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });
    await log({ actor: auth.user.email, action: 'updated', tableName: table, recordId: params.id, oldData: old, newData: data, context: `${params.type} updated`, ip });
    return respond(200, { [params.type]: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ── GET: Research Dashboard Metrics ─────────────────────────────────────────────
async function getDashboard(sb) {
  const [pRes, iRes, csRes, rfRes, outRes] = await Promise.all([
    sb.from('patterns').select('id,status,confidence_level', { count: 'exact' }),
    sb.from('research_insights').select('id,status', { count: 'exact' }),
    sb.from('case_studies').select('id,status', { count: 'exact' }),
    sb.from('session_outcomes').select('id').eq('research_flag', true),
    sb.from('session_outcomes').select('id,outcome_category'),
  ]);

  const patterns  = pRes.data  || [];
  const insights  = iRes.data  || [];
  const caseStudies = csRes.data || [];
  const researchFlags = rfRes.data || [];
  const outcomes  = outRes.data || [];

  return {
    metrics: {
      research_flags:      researchFlags.length,
      pattern_candidates:  patterns.filter(p => p.status === 'candidate').length,
      confirmed_patterns:  patterns.filter(p => p.status === 'confirmed').length,
      published_insights:  insights.filter(i => i.status === 'published').length,
      draft_insights:      insights.filter(i => i.status === 'draft').length,
      case_studies:        caseStudies.length,
      published_case_studies: caseStudies.filter(c => c.status === 'published').length,
      outcomes_tracked:    outcomes.length,
      improvement_rate:    outcomes.length > 0
        ? Math.round(outcomes.filter(o => o.outcome_category === 'improved').length / outcomes.length * 100)
        : null,
    },
    recentPatterns:  patterns.slice(0, 5),
    recentInsights:  insights.filter(i => i.status !== 'archived').slice(0, 5),
  };
}

// ── GET: Patterns ────────────────────────────────────────────────────────────────
async function getPatterns(sb, params) {
  let query = sb.from('patterns').select('*').order('supporting_count', { ascending: false });
  if (params.status) query = query.eq('status', params.status);
  if (params.type)   query = query.eq('pattern_type', params.type);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { patterns: data || [] };
}

// ── GET: Research Insights ────────────────────────────────────────────────────────
async function getInsights(sb, params) {
  let query = sb.from('research_insights').select('*').order('created_at', { ascending: false });
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { insights: data || [] };
}

// ── GET: Case Studies ────────────────────────────────────────────────────────────
async function getCaseStudies(sb, params) {
  let query = sb.from('case_studies').select('*').order('created_at', { ascending: false });
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { case_studies: data || [] };
}

// ── GET: Recommendation Intelligence ─────────────────────────────────────────────
async function getRecIntelligence(sb) {
  const { data: recs, error } = await sb
    .from('recommendations')
    .select('id, product_name, category, outcome_status, client_id, recommended_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const HELPFUL_STATUSES = ['helpful','tried','purchased'];
  const productMap = {};

  (recs || []).forEach(r => {
    const name = r.product_name || 'Unknown';
    if (!productMap[name]) productMap[name] = { category: r.category, total: 0, helpful: 0, purchased: 0, declined: 0, recommended: 0 };
    productMap[name].total++;
    const s = r.outcome_status || 'recommended';
    // Track specific status buckets (not 'helpful' — that's tracked via HELPFUL_STATUSES to avoid double-counting)
    if (s === 'purchased') productMap[name].purchased++;
    else if (s === 'declined') productMap[name].declined++;
    else if (s === 'recommended') productMap[name].recommended++;
    // Helpful aggregate — counts helpful, tried, and purchased
    if (HELPFUL_STATUSES.includes(s)) productMap[name].helpful++;
  });

  const ranked = Object.entries(productMap)
    .map(([name, d]) => ({
      name,
      category:    d.category,
      total:       d.total,
      purchased:   d.purchased,
      helpful:     d.helpful,
      declined:    d.declined,
      helpfulRate: d.total > 0 ? Math.max(0, Math.min(100, Math.round(d.helpful / d.total * 100))) : 0,
      adoptionRate: d.total > 0 ? Math.round(d.purchased / d.total * 100) : 0,
    }))
    .sort((a, b) => b.helpfulRate - a.helpfulRate || b.total - a.total);

  const byCategory = {};
  (recs || []).forEach(r => {
    const cat = r.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, helpful: 0 };
    byCategory[cat].total++;
    if (HELPFUL_STATUSES.includes(r.outcome_status)) byCategory[cat].helpful++;
  });

  const categories = Object.entries(byCategory).map(([cat, d]) => ({
    category:    cat,
    total:       d.total,
    helpful:     d.helpful,
    helpfulRate: d.total > 0 ? Math.round(d.helpful / d.total * 100) : 0,
  })).sort((a, b) => b.helpfulRate - a.helpfulRate);

  return {
    topRecommendations: ranked.slice(0, 15),
    byCategory: categories,
    summary: {
      total:     (recs || []).length,
      topProduct: ranked[0]?.name  || null,
      topCategory: categories[0]?.category || null,
    },
  };
}

// ── GET: Service Intelligence ─────────────────────────────────────────────────────
async function getServiceIntelligence(sb) {
  const [sessRes, outRes, acRes] = await Promise.all([
    sb.from('sessions').select('id, service, client_id, status, state_before, state_after, session_date'),
    sb.from('session_outcomes').select('session_id, outcome_category, improvement_level'),
    sb.from('aftercare').select('session_id, status'),
  ]);

  if (sessRes.error) throw new Error(sessRes.error.message);

  const sessions = sessRes.data || [];
  const outcomes = outRes.data  || [];
  const aftercare = acRes.data  || [];

  const outcomeBySession  = {};
  outcomes.forEach(o => { if (o.session_id) outcomeBySession[o.session_id] = o; });
  const aftercareBySess   = {};
  aftercare.forEach(a => { if (a.session_id) aftercareBySess[a.session_id] = a; });

  const serviceMap = {};
  sessions.forEach(s => {
    const svc = s.service || 'General';
    if (!serviceMap[svc]) serviceMap[svc] = { total: 0, completed: 0, improved: 0, withState: 0, deltaSum: 0, clientIds: new Set(), aftercareSent: 0, aftercareTotal: 0 };
    const m = serviceMap[svc];
    m.total++;
    if (s.client_id) m.clientIds.add(s.client_id);
    if (s.status === 'completed') {
      m.completed++;
      const oc = outcomeBySession[s.id];
      if (oc?.outcome_category === 'improved') m.improved++;
      if (s.state_before != null && s.state_after != null) {
        m.withState++;
        m.deltaSum += (s.state_after - s.state_before);
      }
    }
    if (aftercareBySess[s.id]) {
      m.aftercareTotal++;
      if (aftercareBySess[s.id].status === 'sent') m.aftercareSent++;
    }
  });

  // Repeat client counts per service
  const clientSessionCount = {};
  sessions.forEach(s => {
    if (!s.client_id || !s.service) return;
    const key = `${s.service}::${s.client_id}`;
    clientSessionCount[key] = (clientSessionCount[key] || 0) + 1;
  });

  const services = Object.entries(serviceMap).map(([service, m]) => {
    const repeatClients = [...m.clientIds].filter(cid => (clientSessionCount[`${service}::${cid}`] || 0) > 1).length;
    return {
      service,
      totalSessions:     m.total,
      completedSessions: m.completed,
      improvementRate:   m.completed > 0 ? Math.round(m.improved / m.completed * 100) : null,
      avgStateDelta:     m.withState > 0  ? Math.round(m.deltaSum / m.withState * 100) / 100 : null,
      uniqueClients:     m.clientIds.size,
      repeatClients,
      repeatRate:        m.clientIds.size > 0 ? Math.round(repeatClients / m.clientIds.size * 100) : 0,
      followUpRate:      m.aftercareTotal > 0 ? Math.round(m.aftercareSent / m.aftercareTotal * 100) : null,
    };
  }).sort((a, b) => (b.improvementRate ?? -1) - (a.improvementRate ?? -1));

  return {
    services,
    summary: {
      totalServices:    services.length,
      topByImprovement: services[0]?.service     || null,
      topByRetention:   [...services].sort((a,b) => b.repeatRate - a.repeatRate)[0]?.service || null,
      topByFollowUp:    [...services].sort((a,b) => (b.followUpRate??-1)-(a.followUpRate??-1))[0]?.service || null,
    },
  };
}

// ── Pattern Detection ────────────────────────────────────────────────────────────
async function detectPatterns(sb, actor, ip) {
  const [outRes, recRes, notesRes, sessRes] = await Promise.all([
    sb.from('session_outcomes').select('session_id, outcome_category, improvement_level, energy_shift, practitioner_notes'),
    sb.from('recommendations').select('product_name, category, outcome_status, session_id, client_id'),
    sb.from('session_notes').select('chief_concern, energy_findings'),
    sb.from('sessions').select('id, client_id, service, status, state_before, state_after'),
  ]);

  const outcomes  = outRes.data  || [];
  const recs      = recRes.data  || [];
  const notes     = notesRes.data || [];
  const sessions  = sessRes.data || [];

  const candidates = [];

  // 1. Recurring Chief Concerns
  const concernCounts = {};
  notes.forEach(n => {
    if (!n.chief_concern) return;
    const key = n.chief_concern.trim().toLowerCase();
    concernCounts[key] = (concernCounts[key] || 0) + 1;
  });
  Object.entries(concernCounts)
    .filter(([, cnt]) => cnt >= CONFIDENCE_THRESHOLDS.emerging)
    .forEach(([concern, cnt]) => {
      candidates.push({
        pattern_type:     'concern',
        title:            `Recurring concern: "${concern}"`,
        description:      `"${concern}" has appeared as the chief concern in ${cnt} sessions.`,
        supporting_count: cnt,
        confidence_level: confidenceLevel(cnt),
        data_snapshot:    { concern, count: cnt },
      });
    });

  // 2. High-Improvement Recommendations
  const highImproveSessions = new Set(
    outcomes.filter(o => (o.improvement_level || 0) >= 7).map(o => o.session_id).filter(Boolean)
  );
  const recInHighImprove = {};
  recs.filter(r => highImproveSessions.has(r.session_id)).forEach(r => {
    const name = r.product_name || 'Unknown';
    recInHighImprove[name] = (recInHighImprove[name] || 0) + 1;
  });
  Object.entries(recInHighImprove)
    .filter(([, cnt]) => cnt >= CONFIDENCE_THRESHOLDS.emerging)
    .forEach(([name, cnt]) => {
      candidates.push({
        pattern_type:     'intervention',
        title:            `High-improvement intervention: "${name}"`,
        description:      `"${name}" was recommended in ${cnt} sessions with improvement level 7+.`,
        supporting_count: cnt,
        confidence_level: confidenceLevel(cnt),
        data_snapshot:    { product: name, high_improve_sessions: cnt },
      });
    });

  // 3. High Recommendation Effectiveness
  const recEffectiveness = {};
  const HELPFUL = ['helpful','tried','purchased'];
  recs.forEach(r => {
    const name = r.product_name || 'Unknown';
    if (!recEffectiveness[name]) recEffectiveness[name] = { total: 0, helpful: 0 };
    recEffectiveness[name].total++;
    if (HELPFUL.includes(r.outcome_status)) recEffectiveness[name].helpful++;
  });
  Object.entries(recEffectiveness)
    .filter(([, d]) => d.total >= CONFIDENCE_THRESHOLDS.emerging && d.total > 0 && (d.helpful / d.total) >= 0.6)
    .forEach(([name, d]) => {
      const rate = Math.round(d.helpful / d.total * 100);
      candidates.push({
        pattern_type:     'recommendation',
        title:            `High-effectiveness recommendation: "${name}"`,
        description:      `"${name}" has a ${rate}% helpful rate across ${d.total} recommendations.`,
        supporting_count: d.total,
        confidence_level: confidenceLevel(d.total),
        data_snapshot:    { product: name, helpful_rate: rate, total: d.total, helpful: d.helpful },
      });
    });

  // 4. Service Outcome Patterns
  const serviceOutcomes = {};
  sessions.filter(s => s.status === 'completed').forEach(s => {
    const svc = s.service || 'General';
    if (!serviceOutcomes[svc]) serviceOutcomes[svc] = { total: 0, improved: 0 };
  });
  outcomes.forEach(o => {
    const sess = sessions.find(s => s.id === o.session_id);
    if (!sess) return;
    const svc = sess.service || 'General';
    if (!serviceOutcomes[svc]) serviceOutcomes[svc] = { total: 0, improved: 0 };
    serviceOutcomes[svc].total++;
    if (o.outcome_category === 'improved') serviceOutcomes[svc].improved++;
  });
  Object.entries(serviceOutcomes)
    .filter(([, d]) => d.total >= CONFIDENCE_THRESHOLDS.emerging && (d.improved / d.total) >= 0.65)
    .forEach(([svc, d]) => {
      const rate = Math.round(d.improved / d.total * 100);
      candidates.push({
        pattern_type:     'service',
        title:            `High-outcome service: "${svc}"`,
        description:      `"${svc}" shows a ${rate}% improvement rate across ${d.total} tracked sessions.`,
        supporting_count: d.total,
        confidence_level: confidenceLevel(d.total),
        data_snapshot:    { service: svc, improvement_rate: rate, total: d.total },
      });
    });

  // 5. Repeat Client Patterns
  const clientSessions = {};
  sessions.forEach(s => {
    if (!s.client_id) return;
    clientSessions[s.client_id] = (clientSessions[s.client_id] || 0) + 1;
  });
  const repeatCount = Object.values(clientSessions).filter(c => c >= 3).length;
  if (repeatCount >= CONFIDENCE_THRESHOLDS.emerging) {
    candidates.push({
      pattern_type:     'retention',
      title:            `Strong repeat client base — ${repeatCount} clients with 3+ sessions`,
      description:      `${repeatCount} clients have completed 3 or more sessions, indicating strong retention.`,
      supporting_count: repeatCount,
      confidence_level: confidenceLevel(repeatCount),
      data_snapshot:    { repeat_clients: repeatCount, threshold: 3 },
    });
  }

  // Upsert candidates (conflict on title — update count if higher)
  const saved = [];
  for (const candidate of candidates) {
    const { data: existing } = await sb.from('patterns').select('*').eq('title', candidate.title).maybeSingle();
    if (existing) {
      if (candidate.supporting_count > existing.supporting_count) {
        const { data } = await sb.from('patterns').update({
          supporting_count: candidate.supporting_count,
          confidence_level: candidate.confidence_level,
          data_snapshot:    candidate.data_snapshot,
          description:      candidate.description,
          updated_at:       new Date().toISOString(),
        }).eq('id', existing.id).select().single();
        if (data) saved.push(data);
      } else {
        saved.push(existing);
      }
    } else {
      const { data } = await sb.from('patterns').insert(candidate).select().single();
      if (data) saved.push(data);
    }
  }

  await log({ actor, action: 'pattern_detection_run', tableName: 'patterns', context: `Pattern detection found ${candidates.length} candidates, saved ${saved.length}`, ip });

  return { detected: candidates.length, saved: saved.length, patterns: saved };
}

// ── Case Study Generator ──────────────────────────────────────────────────────────
async function generateCaseStudy(sb, sessionId, opts = {}) {
  const [sessRes, outcomeRes, notesRes, aftercareRes] = await Promise.all([
    sb.from('sessions').select('*').eq('id', sessionId).single(),
    sb.from('session_outcomes').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('session_notes').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('aftercare').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const sess     = sessRes.data;
  const outcome  = outcomeRes.data;
  const notes    = notesRes.data;
  const aftercare = aftercareRes.data;

  if (!sess) throw new Error('Session not found: ' + sessionId);

  // Generate a numbered client alias to protect privacy
  const alias = opts.client_alias || `Client ${Math.floor(Math.random() * 900) + 100}`;

  // Problem: pulled from chief_concern (notes) or seller_notes (session)
  const problem = [
    notes?.chief_concern ? `Chief concern: ${notes.chief_concern}.` : '',
    notes?.energy_findings ? `Energy findings: ${notes.energy_findings}.` : '',
    sess.seller_notes ? sess.seller_notes : '',
  ].filter(Boolean).join(' ') || 'Not documented.';

  // Intervention: service + session notes
  const intervention = [
    sess.service ? `Service: ${sess.service}.` : '',
    notes?.removals_done ? `Removals: ${notes.removals_done}.` : '',
  ].filter(Boolean).join(' ') || 'Not documented.';

  // Outcome: from outcome record or state scores
  const outcomeText = outcome
    ? [
        `Category: ${outcome.outcome_category || 'not specified'}.`,
        outcome.improvement_level ? `Improvement level: ${outcome.improvement_level}/10.` : '',
        outcome.energy_shift       ? `Energy shift: ${outcome.energy_shift}.` : '',
        outcome.practitioner_notes ? outcome.practitioner_notes : '',
      ].filter(Boolean).join(' ')
    : sess.state_before != null && sess.state_after != null
      ? `State score moved from ${sess.state_before} to ${sess.state_after} (delta: ${sess.state_after - sess.state_before > 0 ? '+' : ''}${sess.state_after - sess.state_before}).`
      : 'Outcome data not yet recorded.';

  // Lessons: aftercare notes or placeholder
  const lessons = aftercare?.notes || 'To be documented.';

  return {
    session_id:       sessionId,
    outcome_id:       outcome?.id || null,
    title:            opts.title || `${sess.service || 'Energy Session'} — ${alias}`,
    client_alias:     alias,
    service:          sess.service || null,
    problem,
    intervention,
    outcome:          outcomeText,
    lessons_learned:  lessons,
    outcome_category: outcome?.outcome_category || null,
    improvement_level: outcome?.improvement_level || null,
    status:           'draft',
    anonymized:       true,
    content_tags:     opts.content_tags || null,
  };
}
