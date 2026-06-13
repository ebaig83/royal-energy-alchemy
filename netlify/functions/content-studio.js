// /.netlify/functions/content-studio
//
// ── IDEAS ──────────────────────────────────────────────────────────────────
// GET  ?section=ideas                          — all ideas (soft-deleted excluded)
// GET  ?section=ideas&status=draft             — filter by status
// GET  ?section=ideas&content_type=social_post — filter by type
// GET  ?section=ideas&priority=high            — filter by priority
// GET  ?section=ideas&search=text              — keyword search
// GET  ?section=dashboard                      — KPIs + recent activity + intelligence summary
// GET  ?section=calendar                       — ideas with scheduled_date
// GET  ?section=sources                        — internal: kb_entries + research_notes
//
// ── INTELLIGENCE ──────────────────────────────────────────────────────────
// GET  ?section=intelligence                   — trending topics, themes, gaps, pattern matches
// GET  ?section=content_sources                — external sources list
// GET  ?section=content_sources&type=article   — filter by source_type
//
// ── IDEAS MUTATIONS ───────────────────────────────────────────────────────
// POST ?action=create_idea                     — create idea (scores computed automatically)
// POST ?action=generate                        — deterministic generation with scoring
// POST ?action=generate&content_type=video     — generate for one type
//
// ── SOURCES MUTATIONS ─────────────────────────────────────────────────────
// POST ?action=create_source                   — add external source
// PATCH ?action=update_idea&id=uuid            — edit idea fields
// PATCH ?action=schedule_idea&id=uuid          — set scheduled_date
// PATCH ?action=delete_idea&id=uuid            — soft-delete idea
// PATCH ?action=update_source&id=uuid          — edit external source
// PATCH ?action=delete_source&id=uuid          — soft-delete external source

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const VALID_STATUSES     = ['draft', 'approved', 'archived'];
const VALID_TYPES        = [
  'social_post', 'video', 'newsletter', 'blog', 'training', 'book_chapter',
  'faq', 'webinar', 'workshop', 'podcast_topic', 'course_module',
  'lead_magnet', 'case_study', 'faq_series', 'certification_module',
];
const VALID_SOURCE_TYPES = ['kb_entry', 'research_note', 'pattern', 'insight', 'external'];
const VALID_EXT_TYPES    = ['search_trend', 'article', 'podcast', 'book', 'video', 'webinar', 'competitor', 'research', 'community'];
const VALID_PRIORITIES   = ['low', 'medium', 'high', 'critical'];

const IDEA_COLS = 'id, title, content_type, source_type, source_ids, topic, summary, status, scheduled_date, priority, internal_score, market_score, educational_score, business_score, created_by, created_at, updated_at';
const SRC_COLS  = 'id, source_type, source_title, source_url, source_summary, source_tags, source_date, relevance_score, created_at, updated_at';

function userErr(msg) { const e = new Error(msg); e.name = 'UserError'; return e; }

function isMissingTableError(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg  = error.message || '';
  return (
    code === '42P01'    ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const ip     = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // ── GET ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'ideas';
    try {
      if (section === 'ideas')           return respond(200, await getIdeas(sb, params));
      if (section === 'dashboard')       return respond(200, await getDashboard(sb));
      if (section === 'calendar')        return respond(200, await getCalendar(sb));
      if (section === 'sources')         return respond(200, await getSources(sb, params));
      if (section === 'intelligence')    return respond(200, await getIntelligence(sb));
      if (section === 'content_sources') return respond(200, await getContentSources(sb, params));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[content-studio] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'create_idea')   return respond(201, await createIdea(sb, body, auth, ip));
      if (action === 'generate')      return respond(200,  await generateIdeas(sb, body));
      if (action === 'create_source') return respond(201, await createSource(sb, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[content-studio] POST', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    const id     = params.id;
    if (!id) return respond(400, { error: 'id is required.' });
    try {
      if (action === 'update_idea')   return respond(200, await updateIdea(sb, id, body, auth, ip));
      if (action === 'schedule_idea') return respond(200, await scheduleIdea(sb, id, body, auth, ip));
      if (action === 'delete_idea')   return respond(200, await deleteIdea(sb, id, auth, ip));
      if (action === 'update_source') return respond(200, await updateSource(sb, id, body, auth, ip));
      if (action === 'delete_source') return respond(200, await deleteSource(sb, id, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[content-studio] PATCH', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ═════════════════════════════════════════════════════════════════════════
// SCORING ENGINE
// ═════════════════════════════════════════════════════════════════════════

// Educational value by content type (0–10)
const EDU_SCORE = {
  certification_module: 10, course_module: 10, training: 9, book_chapter: 9,
  faq_series: 8, workshop: 8, webinar: 7, faq: 7, case_study: 7,
  blog: 6, lead_magnet: 6, newsletter: 5, video: 5, podcast_topic: 5,
  social_post: 3,
};

// Business value by content type (0–10)
const BIZ_SCORE = {
  lead_magnet: 10, course_module: 9, certification_module: 9,
  webinar: 8, workshop: 8, training: 7, book_chapter: 7, case_study: 7,
  blog: 6, faq_series: 6, newsletter: 5, social_post: 5, video: 5,
  podcast_topic: 4, faq: 5,
};

function computeScore(idea, extSources, kbEntries, researchNotes) {
  const topicLower = (idea.topic || idea.title || '').toLowerCase();

  // ── Internal Relevance ─────────────────────────────────────────────────
  const kbMatch = kbEntries.filter(k =>
    (k.title || '').toLowerCase().includes(topicLower) ||
    (k.tags  || []).some(t => topicLower.includes(t.toLowerCase()) || t.toLowerCase().includes(topicLower))
  ).length;
  const rnMatch = researchNotes.filter(n =>
    (n.title || '').toLowerCase().includes(topicLower) ||
    (n.tags  || []).some(t => topicLower.includes(t.toLowerCase()) || t.toLowerCase().includes(topicLower))
  ).length;
  const internalScore = Math.min(10, Math.max(1, 2 + (kbMatch * 2) + Math.round(rnMatch * 1.5)));

  // ── Market Interest ────────────────────────────────────────────────────
  const matchedSources = extSources.filter(s => {
    const tags = (s.source_tags || []).map(t => t.toLowerCase());
    return tags.some(t => topicLower.includes(t) || t.includes(topicLower)) ||
           (s.source_title || '').toLowerCase().includes(topicLower);
  });
  const highRelevance = matchedSources.filter(s => (s.relevance_score || 0) >= 7).length;
  const marketScore   = Math.min(10, Math.max(1,
    (extSources.length === 0 ? 4 : 3) +
    Math.min(4, matchedSources.length * 1.5) +
    Math.min(3, highRelevance * 2)
  ));

  // ── Educational + Business ─────────────────────────────────────────────
  const educationalScore = EDU_SCORE[idea.content_type] || 5;
  const businessScore    = BIZ_SCORE[idea.content_type] || 5;

  const avg = (internalScore + marketScore + educationalScore + businessScore) / 4;
  const priority =
    avg >= 8.5 ? 'critical' :
    avg >= 7.0 ? 'high'     :
    avg >= 5.0 ? 'medium'   : 'low';

  return {
    internal_score:    internalScore,
    market_score:      Math.round(marketScore),
    educational_score: educationalScore,
    business_score:    businessScore,
    priority,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// GET HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function getIdeas(sb, params) {
  let query = sb
    .from('content_ideas')
    .select(IDEA_COLS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (params.status)       query = query.eq('status', params.status);
  if (params.content_type) query = query.eq('content_type', params.content_type);
  if (params.priority)     query = query.eq('priority', params.priority);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { ideas: [], count: 0, migration_needed: 'WARN' };
    throw new Error(error.message);
  }

  let ideas = data || [];
  if (params.search) {
    const q = params.search.toLowerCase();
    ideas = ideas.filter(i =>
      (i.title   || '').toLowerCase().includes(q) ||
      (i.topic   || '').toLowerCase().includes(q) ||
      (i.summary || '').toLowerCase().includes(q)
    );
  }

  return { ideas, count: ideas.length };
}

async function getDashboard(sb) {
  const [ideasRes, kbRes, rnRes, srcRes] = await Promise.all([
    sb.from('content_ideas').select('id, status, content_type, priority, created_at').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('kb_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('research_notes').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('content_sources').select('id', { count: 'exact', head: true }).is('deleted_at', null),
  ]);

  if (ideasRes.error) {
    if (isMissingTableError(ideasRes.error)) {
      return {
        kpis: { total: 0, draft: 0, approved: 0, critical: 0, high: 0, source_articles: 0, source_notes: 0, ext_sources: 0 },
        recent_generated: [], recent_approved: [], migration_needed: 'WARN',
      };
    }
    throw new Error(ideasRes.error.message);
  }

  const ideas = ideasRes.data || [];
  const kpis  = {
    total:           ideas.length,
    draft:           ideas.filter(i => i.status === 'draft').length,
    approved:        ideas.filter(i => i.status === 'approved').length,
    critical:        ideas.filter(i => i.priority === 'critical').length,
    high:            ideas.filter(i => i.priority === 'high').length,
    source_articles: kbRes.count  || 0,
    source_notes:    rnRes.count  || 0,
    ext_sources:     srcRes.count || 0,
  };

  return {
    kpis,
    recent_generated: ideas.slice(0, 5),
    recent_approved:  ideas.filter(i => i.status === 'approved').slice(0, 5),
  };
}

async function getCalendar(sb) {
  const { data, error } = await sb
    .from('content_ideas')
    .select(IDEA_COLS)
    .is('deleted_at', null)
    .not('scheduled_date', 'is', null)
    .order('scheduled_date', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return { calendar: [], migration_needed: 'WARN' };
    throw new Error(error.message);
  }
  return { calendar: data || [], count: (data || []).length };
}

async function getSources(sb, params) {
  const limit = Math.min(parseInt(params.limit || '20', 10), 50);
  const [kbRes, rnRes] = await Promise.all([
    sb.from('kb_entries').select('id, title, summary, category, tags, status, created_at').is('deleted_at', null).eq('status', 'published').order('created_at', { ascending: false }).limit(limit),
    sb.from('research_notes').select('id, title, content, tags, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(limit),
  ]);
  return {
    kb_entries:     kbRes.data  || [],
    research_notes: rnRes.data  || [],
    kb_count:       (kbRes.data  || []).length,
    rn_count:       (rnRes.data  || []).length,
  };
}

// ── Intelligence Dashboard ─────────────────────────────────────────────────
async function getIntelligence(sb) {
  const [extRes, rnRes, kbRes] = await Promise.all([
    sb.from('content_sources').select(SRC_COLS).is('deleted_at', null).order('relevance_score', { ascending: false }),
    sb.from('research_notes').select('id, title, tags, content, created_at').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('kb_entries').select('id, title, category, tags, is_pinned').is('deleted_at', null).eq('status', 'published'),
  ]);

  const extSources    = (extRes.error && isMissingTableError(extRes.error)) ? [] : (extRes.data || []);
  const researchNotes = rnRes.data || [];
  const kbEntries     = kbRes.data || [];

  // ── Trending Topics: tag frequency across external sources ──────────────
  const extTagMap = {};
  for (const src of extSources) {
    for (const rawTag of (src.source_tags || [])) {
      const t = rawTag.toLowerCase().trim();
      if (!t) continue;
      if (!extTagMap[t]) extTagMap[t] = { tag: t, count: 0, avg_score: 0, scores: [], sources: [] };
      extTagMap[t].count++;
      extTagMap[t].scores.push(src.relevance_score || 5);
      extTagMap[t].sources.push({ id: src.id, title: src.source_title, type: src.source_type });
    }
  }
  const trendingTopics = Object.values(extTagMap).map(e => ({
    ...e,
    avg_score: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
  })).sort((a, b) => b.count * b.avg_score - a.count * a.avg_score).slice(0, 10);

  // ── Internal Pattern Tags: from research_notes ──────────────────────────
  const intTagMap = {};
  for (const note of researchNotes) {
    for (const rawTag of (note.tags || [])) {
      const t = rawTag.toLowerCase().trim();
      if (!t) continue;
      if (!intTagMap[t]) intTagMap[t] = { tag: t, count: 0 };
      intTagMap[t].count++;
    }
  }
  const internalPatterns = Object.values(intTagMap).sort((a, b) => b.count - a.count).slice(0, 10);

  // ── Emerging Themes: high-score recent external sources ─────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const emergingThemes = extSources
    .filter(s => (s.source_date || '') >= thirtyDaysAgo || !s.source_date)
    .filter(s => (s.relevance_score || 0) >= 7)
    .slice(0, 8)
    .map(s => ({ id: s.id, title: s.source_title, type: s.source_type, score: s.relevance_score, tags: s.source_tags }));

  // ── High Interest Topics: top external sources by relevance ─────────────
  const highInterest = extSources
    .filter(s => (s.relevance_score || 0) >= 8)
    .slice(0, 8)
    .map(s => ({ id: s.id, title: s.source_title, type: s.source_type, score: s.relevance_score, url: s.source_url }));

  // ── Competitor Gaps: competitor-type sources ─────────────────────────────
  const competitorGaps = extSources
    .filter(s => s.source_type === 'competitor')
    .slice(0, 6)
    .map(s => ({ id: s.id, title: s.source_title, score: s.relevance_score, summary: s.source_summary, tags: s.source_tags }));

  // ── Underserved Topics: high ext interest but low internal coverage ──────
  const underserved = trendingTopics.filter(extTopic => {
    const hasInternal = researchNotes.some(n => (n.tags || []).some(t => t.toLowerCase().includes(extTopic.tag))) ||
                        kbEntries.some(k => (k.tags || []).some(t => t.toLowerCase().includes(extTopic.tag)) || (k.category || '').toLowerCase().includes(extTopic.tag));
    return !hasInternal;
  }).slice(0, 5);

  // ── Internal→External Pattern Matches: cross-reference ──────────────────
  const patternMatches = internalPatterns
    .map(intPat => {
      const matches = extSources.filter(s => (s.source_tags || []).some(t => t.toLowerCase().includes(intPat.tag) || intPat.tag.includes(t.toLowerCase())));
      return { pattern: intPat.tag, internal_count: intPat.count, external_matches: matches.length, opportunity: matches.length > 0 ? 'supported' : 'internal-only' };
    })
    .filter(p => p.internal_count > 0)
    .sort((a, b) => b.external_matches - a.external_matches)
    .slice(0, 8);

  // ── FAQ Opportunities: search_trend + community sources ─────────────────
  const faqOpportunities = extSources
    .filter(s => s.source_type === 'search_trend' || s.source_type === 'community')
    .slice(0, 6)
    .map(s => ({ id: s.id, title: s.source_title, type: s.source_type, tags: s.source_tags, score: s.relevance_score }));

  return {
    trending_topics:    trendingTopics,
    emerging_themes:    emergingThemes,
    high_interest:      highInterest,
    competitor_gaps:    competitorGaps,
    underserved_topics: underserved,
    internal_patterns:  internalPatterns,
    pattern_matches:    patternMatches,
    faq_opportunities:  faqOpportunities,
    summary: {
      ext_sources_count:   extSources.length,
      internal_notes_count: researchNotes.length,
      kb_count:            kbEntries.length,
      trending_count:      trendingTopics.length,
      competitor_gap_count: competitorGaps.length,
      underserved_count:   underserved.length,
    },
  };
}

async function getContentSources(sb, params) {
  let query = sb
    .from('content_sources')
    .select(SRC_COLS)
    .is('deleted_at', null)
    .order('relevance_score', { ascending: false });

  if (params.type) query = query.eq('source_type', params.type);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { sources: [], count: 0, migration_needed: 'WARN' };
    throw new Error(error.message);
  }
  return { sources: data || [], count: (data || []).length };
}

// ═════════════════════════════════════════════════════════════════════════
// POST — IDEAS
// ═════════════════════════════════════════════════════════════════════════

async function createIdea(sb, body, auth, ip) {
  if (!body.title)        throw userErr('title is required.');
  if (!body.content_type) throw userErr('content_type is required.');
  if (!VALID_TYPES.includes(body.content_type)) throw userErr(`Invalid content_type. Must be one of: ${VALID_TYPES.join(', ')}`);

  // Fetch sources for scoring
  const [extRes, kbRes, rnRes] = await Promise.all([
    sb.from('content_sources').select('source_tags, relevance_score, source_title').is('deleted_at', null),
    sb.from('kb_entries').select('title, tags').is('deleted_at', null).eq('status', 'published'),
    sb.from('research_notes').select('title, tags').is('deleted_at', null),
  ]);

  const scores = computeScore(
    { title: body.title, topic: body.topic, content_type: body.content_type },
    extRes.data || [],
    kbRes.data  || [],
    rnRes.data  || []
  );

  const row = {
    title:        body.title.trim(),
    content_type: body.content_type,
    source_type:  VALID_SOURCE_TYPES.includes(body.source_type) ? body.source_type : null,
    source_ids:   Array.isArray(body.source_ids) ? body.source_ids : [],
    topic:        body.topic         || null,
    summary:      body.summary       || null,
    status:       VALID_STATUSES.includes(body.status) ? body.status : 'draft',
    scheduled_date: body.scheduled_date || null,
    created_by:   auth.user || 'daron',
    ...scores,
  };

  const { data, error } = await sb.from('content_ideas').insert(row).select(IDEA_COLS).single();
  if (error) throw new Error(error.message);

  await log(sb, { action: 'created', table: 'content_ideas', record_id: data.id, actor: auth.user, ip });
  return { idea: data };
}

// ── Deterministic Idea Generation Engine ──────────────────────────────────
async function generateIdeas(sb, body) {
  const targetType = body.content_type || null;
  const limit      = Math.min(parseInt(body.limit || '20', 10), 60);

  // Fetch all source data in parallel
  const [kbRes, rnRes, extRes] = await Promise.all([
    sb.from('kb_entries').select('id, title, summary, category, tags, content, is_pinned').is('deleted_at', null).eq('status', 'published').order('is_pinned', { ascending: false }).limit(15),
    sb.from('research_notes').select('id, title, content, tags').is('deleted_at', null).order('created_at', { ascending: false }).limit(15),
    sb.from('content_sources').select('id, source_type, source_title, source_url, source_tags, relevance_score, source_summary').is('deleted_at', null).order('relevance_score', { ascending: false }),
  ]);

  const kbEntries     = kbRes.data || [];
  const researchNotes = rnRes.data || [];
  const extSources    = (extRes.error && isMissingTableError(extRes.error)) ? [] : (extRes.data || []);

  const raw = [];

  // ── KB → Social Posts ─────────────────────────────────────────────────
  if (!targetType || targetType === 'social_post') {
    for (const kb of kbEntries) {
      raw.push(
        { title: `Common misconceptions about ${kb.title}`, content_type: 'social_post', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Myth-busting post based on "${kb.title}". Address what clients get wrong and reveal the truth.` },
        { title: `What clients experience during ${kb.title}`, content_type: 'social_post', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `First-person client perspective post for "${kb.title}".` }
      );
    }
    // External trend → social
    for (const src of extSources.filter(s => s.source_type === 'search_trend').slice(0, 4)) {
      raw.push({ title: `Trending: ${src.source_title}`, content_type: 'social_post', source_type: 'external', source_ids: [{ table: 'content_sources', id: src.id, title: src.source_title }], topic: (src.source_tags || [])[0] || src.source_title, summary: `Social post responding to trending topic "${src.source_title}". Share a practitioner perspective.` });
    }
  }

  // ── KB → FAQ / FAQ Series ─────────────────────────────────────────────
  if (!targetType || targetType === 'faq') {
    for (const kb of kbEntries) {
      raw.push({ title: `FAQ: Everything about ${kb.title}`, content_type: 'faq', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Q&A format from "${kb.title}". Convert key knowledge into questions clients actually ask.` });
    }
    for (const src of extSources.filter(s => s.source_type === 'community' || s.source_type === 'search_trend').slice(0, 4)) {
      raw.push({ title: `FAQ Series: ${src.source_title}`, content_type: 'faq_series', source_type: 'external', source_ids: [{ table: 'content_sources', id: src.id, title: src.source_title }], topic: (src.source_tags || [])[0] || src.source_title, summary: `Multi-part FAQ series addressing "${src.source_title}" based on real community questions.` });
    }
  }

  // ── KB → Training / Certification ────────────────────────────────────
  if (!targetType || targetType === 'training') {
    for (const kb of kbEntries) {
      raw.push({ title: `Training module: ${kb.title}`, content_type: 'training', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Practitioner training module for "${kb.title}". Key concepts + practical exercises.` });
    }
  }
  if (!targetType || targetType === 'certification_module') {
    for (const kb of kbEntries.slice(0, 4)) {
      raw.push({ title: `Certification module: ${kb.title}`, content_type: 'certification_module', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Formal certification content on "${kb.title}". Structured for assessment and credentialing.` });
    }
  }

  // ── Research Notes → Book Chapters ────────────────────────────────────
  if (!targetType || targetType === 'book_chapter') {
    for (const rn of researchNotes) {
      raw.push({ title: `Book chapter: ${rn.title}`, content_type: 'book_chapter', source_type: 'research_note', source_ids: [{ table: 'research_notes', id: rn.id, title: rn.title }], topic: (rn.tags || [])[0] || rn.title, summary: `Chapter exploring "${rn.title}". Expand with practitioner stories, case examples, and lessons learned.` });
    }
  }

  // ── Research Notes → Video / Podcast ──────────────────────────────────
  if (!targetType || targetType === 'video') {
    for (const rn of researchNotes) {
      raw.push({ title: `Video: Deep dive into ${rn.title}`, content_type: 'video', source_type: 'research_note', source_ids: [{ table: 'research_notes', id: rn.id, title: rn.title }], topic: (rn.tags || []).slice(0, 2).join(', ') || rn.title, summary: `Educational video on "${rn.title}". Cover findings, practitioner insights, and client implications.` });
    }
    for (const src of extSources.filter(s => s.source_type === 'video').slice(0, 3)) {
      raw.push({ title: `Video response: ${src.source_title}`, content_type: 'video', source_type: 'external', source_ids: [{ table: 'content_sources', id: src.id, title: src.source_title }], topic: (src.source_tags || [])[0] || src.source_title, summary: `Video responding to trending content "${src.source_title}" with a practitioner's perspective.` });
    }
  }
  if (!targetType || targetType === 'podcast_topic') {
    for (const src of extSources.filter(s => s.source_type === 'podcast').slice(0, 4)) {
      raw.push({ title: `Podcast: Practitioner perspective on ${src.source_title}`, content_type: 'podcast_topic', source_type: 'external', source_ids: [{ table: 'content_sources', id: src.id, title: src.source_title }], topic: (src.source_tags || [])[0] || src.source_title, summary: `Episode exploring themes from "${src.source_title}" — energy practitioner angle.` });
    }
    for (const rn of researchNotes.slice(0, 3)) {
      raw.push({ title: `Podcast: The science behind ${rn.title}`, content_type: 'podcast_topic', source_type: 'research_note', source_ids: [{ table: 'research_notes', id: rn.id, title: rn.title }], topic: (rn.tags || [])[0] || rn.title, summary: `Solo episode or guest conversation exploring "${rn.title}".` });
    }
  }

  // ── Newsletter ────────────────────────────────────────────────────────
  if (!targetType || targetType === 'newsletter') {
    const tagGroups = {};
    for (const rn of researchNotes) {
      for (const tag of (rn.tags || [])) {
        if (!tagGroups[tag]) tagGroups[tag] = [];
        tagGroups[tag].push(rn);
      }
    }
    for (const [tag, notes] of Object.entries(tagGroups).slice(0, 5)) {
      raw.push({ title: `Newsletter: ${tag} — Insights from the Practice`, content_type: 'newsletter', source_type: 'research_note', source_ids: notes.slice(0, 3).map(n => ({ table: 'research_notes', id: n.id, title: n.title })), topic: tag, summary: `Newsletter on "${tag}" from ${notes.length} note(s). Synthesize patterns and share practitioner perspective.` });
    }
    if (Object.keys(tagGroups).length === 0 && researchNotes.length > 0) {
      raw.push({ title: `Newsletter: Practitioner Insights — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, content_type: 'newsletter', source_type: 'research_note', source_ids: researchNotes.slice(0, 3).map(n => ({ table: 'research_notes', id: n.id, title: n.title })), topic: 'practitioner insights', summary: 'Monthly newsletter synthesizing recent research and practitioner observations.' });
    }
  }

  // ── Blog (KB + Research cross-reference) ──────────────────────────────
  if (!targetType || targetType === 'blog') {
    for (const kb of kbEntries.slice(0, 5)) {
      const kbTags  = (kb.tags || []).map(t => t.toLowerCase());
      const related = researchNotes.filter(rn => (rn.tags || []).some(t => kbTags.includes(t.toLowerCase())));
      const srcIds  = [{ table: 'kb_entries', id: kb.id, title: kb.title }, ...related.slice(0, 2).map(rn => ({ table: 'research_notes', id: rn.id, title: rn.title }))];
      raw.push({ title: `Blog: The practitioner's guide to ${kb.title}`, content_type: 'blog', source_type: 'kb_entry', source_ids: srcIds, topic: kb.category || kb.title, summary: `Long-form blog on "${kb.title}"${related.length > 0 ? ` + ${related.length} research observation(s)` : ''}. Target: prospective clients and practitioners.` });
    }
  }

  // ── Case Study ────────────────────────────────────────────────────────
  if (!targetType || targetType === 'case_study') {
    for (const rn of researchNotes.slice(0, 4)) {
      raw.push({ title: `Case study: ${rn.title}`, content_type: 'case_study', source_type: 'research_note', source_ids: [{ table: 'research_notes', id: rn.id, title: rn.title }], topic: (rn.tags || [])[0] || rn.title, summary: `Anonymized case study from "${rn.title}". Present context, approach, outcome, and practitioner reflection.` });
    }
  }

  // ── Lead Magnet ───────────────────────────────────────────────────────
  if (!targetType || targetType === 'lead_magnet') {
    for (const kb of kbEntries.slice(0, 3)) {
      raw.push({ title: `Lead magnet: ${kb.title} — Free Guide`, content_type: 'lead_magnet', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Downloadable guide based on "${kb.title}". Offer practical value to attract prospective clients.` });
    }
  }

  // ── Course Module ─────────────────────────────────────────────────────
  if (!targetType || targetType === 'course_module') {
    for (const kb of kbEntries.slice(0, 3)) {
      raw.push({ title: `Course module: ${kb.title}`, content_type: 'course_module', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Online course module on "${kb.title}". Include video, workbook, and self-assessment.` });
    }
  }

  // ── Webinar / Workshop ────────────────────────────────────────────────
  if (!targetType || targetType === 'webinar') {
    const webinarSrc = kbEntries.filter(k => k.is_pinned || k.category === 'Protocol').slice(0, 3);
    for (const kb of (webinarSrc.length > 0 ? webinarSrc : kbEntries.slice(0, 3))) {
      raw.push({ title: `Webinar: ${kb.title} — Live Session`, content_type: 'webinar', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Live webinar on "${kb.title}". Q&A, live demo, downloadable summary.` });
    }
    for (const src of extSources.filter(s => s.source_type === 'webinar').slice(0, 2)) {
      raw.push({ title: `Webinar: Practitioner perspective on ${src.source_title}`, content_type: 'webinar', source_type: 'external', source_ids: [{ table: 'content_sources', id: src.id, title: src.source_title }], topic: (src.source_tags || [])[0] || src.source_title, summary: `Webinar responding to trending topic "${src.source_title}" — energy healing angle.` });
    }
  }
  if (!targetType || targetType === 'workshop') {
    for (const kb of kbEntries.slice(0, 3)) {
      raw.push({ title: `Workshop: Hands-on ${kb.title}`, content_type: 'workshop', source_type: 'kb_entry', source_ids: [{ table: 'kb_entries', id: kb.id, title: kb.title }], topic: kb.category || kb.title, summary: `Interactive workshop on "${kb.title}". Practical exercises, small-group format, take-home practice.` });
    }
  }

  // ── Score all generated ideas ──────────────────────────────────────────
  const generated = raw.slice(0, limit).map(idea => ({
    ...idea,
    ...computeScore(idea, extSources, kbEntries, researchNotes),
  })).sort((a, b) => {
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    return (order[b.priority] || 0) - (order[a.priority] || 0);
  });

  return {
    generated,
    count:   generated.length,
    sources: { kb_count: kbEntries.length, rn_count: researchNotes.length, ext_count: extSources.length },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// POST — SOURCES
// ═════════════════════════════════════════════════════════════════════════

async function createSource(sb, body, auth, ip) {
  if (!body.source_type)  throw userErr('source_type is required.');
  if (!body.source_title) throw userErr('source_title is required.');
  if (!VALID_EXT_TYPES.includes(body.source_type)) throw userErr(`Invalid source_type. Must be one of: ${VALID_EXT_TYPES.join(', ')}`);

  const score = typeof body.relevance_score === 'number' ? Math.min(10, Math.max(1, body.relevance_score)) : 5;

  const row = {
    source_type:    body.source_type,
    source_title:   body.source_title.trim(),
    source_url:     body.source_url     || null,
    source_summary: body.source_summary || null,
    source_tags:    Array.isArray(body.source_tags) ? body.source_tags : [],
    source_date:    body.source_date    || null,
    relevance_score: score,
  };

  const { data, error } = await sb.from('content_sources').insert(row).select(SRC_COLS).single();
  if (error) throw new Error(error.message);

  await log(sb, { action: 'created', table: 'content_sources', record_id: data.id, actor: auth.user, ip });
  return { source: data };
}

// ═════════════════════════════════════════════════════════════════════════
// PATCH — IDEAS
// ═════════════════════════════════════════════════════════════════════════

async function updateIdea(sb, id, body, auth, ip) {
  const allowed  = ['title', 'content_type', 'source_type', 'source_ids', 'topic', 'summary', 'status'];
  const updates  = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'status' && !VALID_STATUSES.includes(body[key])) throw userErr(`Invalid status: ${body[key]}`);
      if (key === 'content_type' && !VALID_TYPES.includes(body[key])) throw userErr(`Invalid content_type: ${body[key]}`);
      updates[key] = body[key];
    }
  }

  const { data, error } = await sb.from('content_ideas').update(updates).eq('id', id).is('deleted_at', null).select(IDEA_COLS).single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'updated', table: 'content_ideas', record_id: id, actor: auth.user, ip });
  return { idea: data };
}

async function scheduleIdea(sb, id, body, auth, ip) {
  if (body.scheduled_date === undefined) throw userErr('scheduled_date is required (or null to clear).');

  const { data, error } = await sb.from('content_ideas').update({ scheduled_date: body.scheduled_date, updated_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select(IDEA_COLS).single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'scheduled', table: 'content_ideas', record_id: id, actor: auth.user, ip, meta: { date: body.scheduled_date } });
  return { idea: data };
}

async function deleteIdea(sb, id, auth, ip) {
  const { data, error } = await sb.from('content_ideas').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'deleted', table: 'content_ideas', record_id: id, actor: auth.user, ip });
  return { deleted: true, id };
}

// ═════════════════════════════════════════════════════════════════════════
// PATCH — SOURCES
// ═════════════════════════════════════════════════════════════════════════

async function updateSource(sb, id, body, auth, ip) {
  const allowed = ['source_title', 'source_url', 'source_summary', 'source_tags', 'source_date', 'relevance_score'];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'relevance_score') updates[key] = Math.min(10, Math.max(1, body[key]));
      else updates[key] = body[key];
    }
  }

  const { data, error } = await sb.from('content_sources').update(updates).eq('id', id).is('deleted_at', null).select(SRC_COLS).single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Source not found.');

  await log(sb, { action: 'updated', table: 'content_sources', record_id: id, actor: auth.user, ip });
  return { source: data };
}

async function deleteSource(sb, id, auth, ip) {
  const { data, error } = await sb.from('content_sources').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Source not found.');

  await log(sb, { action: 'deleted', table: 'content_sources', record_id: id, actor: auth.user, ip });
  return { deleted: true, id };
}
