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
// ── DRAFTS / LIBRARY ──────────────────────────────────────────────────────
// GET  ?section=drafts                         — all drafts (filterable)
// GET  ?section=drafts&status=approved         — filter by status
// GET  ?section=drafts&content_type=blog       — filter by type
// GET  ?section=drafts&search=text             — keyword search
// GET  ?section=library                        — draft counts by status + recent per status
//
// ── IDEAS MUTATIONS ───────────────────────────────────────────────────────
// POST ?action=create_idea                     — create idea (scores computed automatically)
// POST ?action=generate                        — deterministic generation with scoring
// POST ?action=generate&content_type=video     — generate for one type
//
// ── SOURCES MUTATIONS ─────────────────────────────────────────────────────
// POST ?action=create_source                   — add external source
//
// ── DRAFT MUTATIONS ───────────────────────────────────────────────────────
// POST  ?action=generate_draft                 — generate structured draft from approved idea
// POST  ?action=create_draft                   — manually create draft
// PATCH ?action=update_draft&id=uuid           — edit draft title/content
// PATCH ?action=review_draft&id=uuid           — move draft → review
// PATCH ?action=approve_draft&id=uuid          — move review → approved
// PATCH ?action=publish_draft&id=uuid          — move approved → published
// PATCH ?action=archive_draft&id=uuid          — archive draft
// PATCH ?action=delete_draft&id=uuid           — soft-delete draft
//
// ── IDEAS MUTATIONS (continued) ───────────────────────────────────────────
// PATCH ?action=update_idea&id=uuid            — edit idea fields
// PATCH ?action=schedule_idea&id=uuid          — set scheduled_date
// PATCH ?action=delete_idea&id=uuid            — soft-delete idea
// PATCH ?action=update_source&id=uuid          — edit external source
// PATCH ?action=delete_source&id=uuid          — soft-delete external source

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const VALID_STATUSES       = ['draft', 'approved', 'archived'];
const VALID_DRAFT_STATUSES = ['draft', 'review', 'approved', 'published', 'archived'];
const VALID_METHODS        = ['generated', 'manual'];
const VALID_TYPES        = [
  'social_post', 'video', 'newsletter', 'blog', 'training', 'book_chapter',
  'faq', 'webinar', 'workshop', 'podcast_topic', 'course_module',
  'lead_magnet', 'case_study', 'faq_series', 'certification_module',
];
const VALID_SOURCE_TYPES = ['kb_entry', 'research_note', 'pattern', 'insight', 'external'];
const VALID_EXT_TYPES    = ['search_trend', 'article', 'podcast', 'book', 'video', 'webinar', 'competitor', 'research', 'community'];
const VALID_PRIORITIES   = ['low', 'medium', 'high', 'critical'];

const IDEA_COLS  = 'id, title, content_type, source_type, source_ids, topic, summary, status, scheduled_date, priority, internal_score, market_score, educational_score, business_score, created_by, created_at, updated_at';
const SRC_COLS   = 'id, source_type, source_title, source_url, source_summary, source_tags, source_date, relevance_score, created_at, updated_at';
const DRAFT_COLS = 'id, content_idea_id, title, content_type, draft_content, source_ids, generation_method, status, created_by, created_at, updated_at';

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

  const auth = await requireAdmin(event);
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
      if (section === 'drafts')          return respond(200, await getDrafts(sb, params));
      if (section === 'library')         return respond(200, await getLibrary(sb));
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
      if (action === 'create_idea')     return respond(201, await createIdea(sb, body, auth, ip));
      if (action === 'generate')        return respond(200, await generateIdeas(sb, body));
      if (action === 'create_source')   return respond(201, await createSource(sb, body, auth, ip));
      if (action === 'generate_draft')  return respond(201, await generateDraft(sb, body, auth, ip));
      if (action === 'create_draft')    return respond(201, await createDraft(sb, body, auth, ip));
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
      if (action === 'update_idea')    return respond(200, await updateIdea(sb, id, body, auth, ip));
      if (action === 'schedule_idea')  return respond(200, await scheduleIdea(sb, id, body, auth, ip));
      if (action === 'delete_idea')    return respond(200, await deleteIdea(sb, id, auth, ip));
      if (action === 'update_source')  return respond(200, await updateSource(sb, id, body, auth, ip));
      if (action === 'delete_source')  return respond(200, await deleteSource(sb, id, auth, ip));
      if (action === 'update_draft')   return respond(200, await updateDraft(sb, id, body, auth, ip));
      if (action === 'review_draft')   return respond(200, await transitionDraft(sb, id, 'review',    auth, ip));
      if (action === 'approve_draft')  return respond(200, await transitionDraft(sb, id, 'approved',  auth, ip));
      if (action === 'publish_draft')  return respond(200, await transitionDraft(sb, id, 'published', auth, ip));
      if (action === 'archive_draft')  return respond(200, await transitionDraft(sb, id, 'archived',  auth, ip));
      if (action === 'delete_draft')   return respond(200, await deleteDraft(sb, id, auth, ip));
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

// ═════════════════════════════════════════════════════════════════════════
// DRAFTS — GET
// ═════════════════════════════════════════════════════════════════════════

async function getDrafts(sb, params) {
  let query = sb
    .from('content_drafts')
    .select(DRAFT_COLS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (params.status)       query = query.eq('status', params.status);
  if (params.content_type) query = query.eq('content_type', params.content_type);

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return { drafts: [], count: 0, migration_needed: 'WARN' };
    throw new Error(error.message);
  }

  let drafts = data || [];
  if (params.search) {
    const q = params.search.toLowerCase();
    drafts = drafts.filter(d =>
      (d.title        || '').toLowerCase().includes(q) ||
      (d.draft_content || '').toLowerCase().includes(q)
    );
  }
  return { drafts, count: drafts.length };
}

async function getLibrary(sb) {
  const { data, error } = await sb
    .from('content_drafts')
    .select('id, title, content_type, status, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return {
      counts: { draft: 0, review: 0, approved: 0, published: 0, archived: 0, total: 0 },
      recent: { draft: [], approved: [], published: [] },
      migration_needed: 'WARN',
    };
    throw new Error(error.message);
  }

  const drafts = data || [];
  const byStatus = (s) => drafts.filter(d => d.status === s);
  return {
    counts: {
      total:     drafts.length,
      draft:     byStatus('draft').length,
      review:    byStatus('review').length,
      approved:  byStatus('approved').length,
      published: byStatus('published').length,
      archived:  byStatus('archived').length,
    },
    recent: {
      draft:     byStatus('draft').slice(0, 5),
      approved:  byStatus('approved').slice(0, 5),
      published: byStatus('published').slice(0, 5),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// DRAFT GENERATION ENGINE
// ═════════════════════════════════════════════════════════════════════════

async function generateDraft(sb, body, auth, ip) {
  if (!body.content_idea_id) throw userErr('content_idea_id is required.');

  // Fetch the parent idea
  const { data: idea, error: ideaErr } = await sb
    .from('content_ideas')
    .select(IDEA_COLS)
    .eq('id', body.content_idea_id)
    .is('deleted_at', null)
    .single();
  if (ideaErr) throw new Error(ideaErr.message);
  if (!idea)   throw userErr('Idea not found.');

  // Resolve source records referenced in idea.source_ids
  const sourceIds = Array.isArray(idea.source_ids) ? idea.source_ids : [];
  const kbIds  = sourceIds.filter(s => s.table === 'kb_entries').map(s => s.id);
  const rnIds  = sourceIds.filter(s => s.table === 'research_notes').map(s => s.id);
  const extIds = sourceIds.filter(s => s.table === 'content_sources').map(s => s.id);

  const [kbRes, rnRes, extRes] = await Promise.all([
    kbIds.length  ? sb.from('kb_entries').select('id, title, summary, content, category, tags').in('id', kbIds)       : { data: [] },
    rnIds.length  ? sb.from('research_notes').select('id, title, content, tags').in('id', rnIds)                       : { data: [] },
    extIds.length ? sb.from('content_sources').select('id, source_title, source_summary, source_tags').in('id', extIds): { data: [] },
  ]);

  const kbEntries     = kbRes.data  || [];
  const researchNotes = rnRes.data  || [];
  const extSources    = extRes.data || [];

  // Generate structured draft content
  const draftContent = buildDraftContent(idea, kbEntries, researchNotes, extSources);
  const title        = body.title || idea.title;

  const row = {
    content_idea_id:   idea.id,
    title:             title.trim(),
    content_type:      idea.content_type,
    draft_content:     draftContent,
    source_ids:        idea.source_ids || [],
    generation_method: 'generated',
    status:            'draft',
    created_by:        auth.user?.email || 'daron',
  };

  const { data: draft, error: insertErr } = await sb.from('content_drafts').insert(row).select(DRAFT_COLS).single();
  if (insertErr) throw new Error(insertErr.message);

  await log(sb, { action: 'generated', tableName: 'content_drafts', recordId: draft.id, actor: auth.user?.email, ip });
  return { draft };
}

async function createDraft(sb, body, auth, ip) {
  if (!body.title)        throw userErr('title is required.');
  if (!body.content_type) throw userErr('content_type is required.');
  if (!VALID_TYPES.includes(body.content_type)) throw userErr(`Invalid content_type.`);

  const row = {
    content_idea_id:   body.content_idea_id || null,
    title:             body.title.trim(),
    content_type:      body.content_type,
    draft_content:     body.draft_content  || '',
    source_ids:        Array.isArray(body.source_ids) ? body.source_ids : [],
    generation_method: 'manual',
    status:            'draft',
    created_by:        auth.user?.email || 'daron',
  };

  const { data: draft, error } = await sb.from('content_drafts').insert(row).select(DRAFT_COLS).single();
  if (error) throw new Error(error.message);

  await log(sb, { action: 'created', tableName: 'content_drafts', recordId: draft.id, actor: auth.user?.email, ip });
  return { draft };
}

// ── Content-type template engine ──────────────────────────────────────────

function buildDraftContent(idea, kbEntries, researchNotes, extSources) {
  const title   = idea.title   || 'Untitled';
  const topic   = idea.topic   || title;
  const summary = idea.summary || '';

  // Collect talking points from sources
  const kbPoints  = kbEntries.map(k => `- ${k.title}${k.summary ? ': ' + k.summary.slice(0, 120) : ''}`).join('\n');
  const rnPoints  = researchNotes.map(n => `- ${n.title}${n.content ? ': ' + n.content.slice(0, 100) : ''}`).join('\n');
  const extPoints = extSources.map(e => `- ${e.source_title}${e.source_summary ? ': ' + e.source_summary.slice(0, 100) : ''}`).join('\n');

  const allTags   = [
    ...kbEntries.flatMap(k => k.tags || []),
    ...researchNotes.flatMap(n => n.tags || []),
  ].filter((t, i, a) => a.indexOf(t) === i).slice(0, 8);

  const traceBlock = buildTraceBlock(kbEntries, researchNotes, extSources);

  switch (idea.content_type) {
    case 'social_post':   return buildSocialPost(title, topic, summary, allTags, kbPoints, traceBlock);
    case 'newsletter':    return buildNewsletter(title, topic, summary, kbPoints, rnPoints, traceBlock);
    case 'blog':          return buildBlog(title, topic, summary, kbPoints, rnPoints, extPoints, traceBlock);
    case 'faq':
    case 'faq_series':    return buildFaq(title, topic, kbEntries, researchNotes, traceBlock);
    case 'webinar':       return buildWebinarOutline(title, topic, summary, kbEntries, researchNotes, traceBlock);
    case 'workshop':      return buildWorkshopOutline(title, topic, summary, kbEntries, researchNotes, traceBlock);
    case 'training':
    case 'course_module':
    case 'certification_module': return buildTrainingModule(title, topic, summary, kbEntries, researchNotes, traceBlock);
    case 'book_chapter':  return buildBookChapter(title, topic, summary, kbEntries, researchNotes, extSources, traceBlock);
    case 'podcast_topic': return buildPodcastOutline(title, topic, summary, kbEntries, researchNotes, extSources, traceBlock);
    case 'case_study':    return buildCaseStudy(title, topic, summary, kbEntries, researchNotes, traceBlock);
    case 'lead_magnet':   return buildLeadMagnet(title, topic, summary, kbEntries, traceBlock);
    case 'video':         return buildVideoOutline(title, topic, summary, kbEntries, researchNotes, traceBlock);
    default:              return buildGenericDraft(title, topic, summary, kbPoints, rnPoints, traceBlock);
  }
}

function buildTraceBlock(kbEntries, researchNotes, extSources) {
  const lines = [];
  kbEntries.forEach(k    => lines.push(`  • KB Article: ${k.title}`));
  researchNotes.forEach(n => lines.push(`  • Research Note: ${n.title}`));
  extSources.forEach(e   => lines.push(`  • External Source: ${e.source_title}`));
  return lines.length ? '─── SOURCE KNOWLEDGE ───────────────────────────\n' + lines.join('\n') + '\n────────────────────────────────────────────────' : '';
}

function buildSocialPost(title, topic, summary, tags, kbPoints, trace) {
  const hook = summary ? summary.slice(0, 140) : `Most people don't realize the power of ${topic}.`;
  const hashtags = tags.length ? tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ') : `#energyhealing #${topic.replace(/\s+/g, '').toLowerCase()}`;
  return `📌 HOOK
${hook}

💡 KEY INSIGHT
[Insert the single most important truth about ${topic} that your audience needs to hear.]

🌟 WHAT THIS MEANS FOR YOU
[Translate the insight into a practical, relatable outcome for the reader.]

✨ PRACTITIONER PERSPECTIVE
[Add a brief personal insight or observation from your sessions.]

📞 CALL TO ACTION
[e.g., "Book your session," "Download the guide," "Reply with your question."]

${hashtags}

─── TALKING POINTS (from source knowledge) ───
${kbPoints || '[Add key points from KB articles]'}

${trace}`;
}

function buildNewsletter(title, topic, summary, kbPoints, rnPoints, trace) {
  return `SUBJECT LINE: ${title}

───────────────────────────────────────────────
ROYAL ENERGY ALCHEMY — PRACTITIONER NEWSLETTER
───────────────────────────────────────────────

Hi [First Name],

This week I want to share something I've been observing in my practice around ${topic}.

${summary || '[Open with a compelling observation or client story (anonymized) that connects to ' + topic + '.]\n'}

─── SECTION 1: BACKGROUND ──────────────────────
[What is the context? Why does ${topic} matter right now?]

${kbPoints ? '(Key knowledge assets to draw from:)\n' + kbPoints : '[Draw from your KB articles on this topic.]'}

─── SECTION 2: KEY INSIGHTS ────────────────────
[What have you observed? What do the patterns tell you?]

${rnPoints ? '(Research observations to reference:)\n' + rnPoints : '[Reference your research notes here.]'}

─── SECTION 3: PRACTICAL STEPS ─────────────────
1. [First actionable step related to ${topic}]
2. [Second actionable step]
3. [Third actionable step]

─── SECTION 4: THIS WEEK'S INVITATION ──────────
[Soft CTA: What can the reader do, explore, or reflect on this week?]

─── CLOSING ─────────────────────────────────────
Until next time,
Daron
Royal Energy Alchemy

P.S. [Add a brief personal note or teaser for next week.]

${trace}`;
}

function buildBlog(title, topic, summary, kbPoints, rnPoints, extPoints, trace) {
  return `# ${title}

**Topic:** ${topic}
**Type:** Long-form Blog Post
**Audience:** Prospective clients + practitioners

---

## Introduction

${summary || '[Open with a story, surprising fact, or question that draws the reader into the topic of ' + topic + '.]'}

[Transition: "In this post, we'll explore..."]

---

## What Is [${topic}] and Why It Matters

[Provide foundational context. What is ${topic}? Who does it affect? What problem does it solve?]

${kbPoints ? '**Knowledge assets to draw from:**\n' + kbPoints : ''}

---

## The Practitioner Perspective

[What do you see in your sessions? What patterns emerge? What do most clients misunderstand?]

${rnPoints ? '**Research observations:**\n' + rnPoints : ''}

---

## What the Research and Community Are Saying

${extPoints ? extPoints : '[Reference external sources, trends, or community questions here.]'}

---

## Step-by-Step: How to [Apply / Understand / Work With] ${topic}

1. **Step 1:** [Action + brief explanation]
2. **Step 2:** [Action + brief explanation]
3. **Step 3:** [Action + brief explanation]
4. **Step 4:** [Action + brief explanation]

---

## Common Misconceptions

- **Misconception 1:** [State it] → **Reality:** [Correct it]
- **Misconception 2:** [State it] → **Reality:** [Correct it]
- **Misconception 3:** [State it] → **Reality:** [Correct it]

---

## Conclusion

[Restate the core insight. End with an empowering message for the reader.]

**Ready to go deeper?** [CTA — book a session, download a guide, join the community, etc.]

---

*Have questions about ${topic}? [Contact / book / reply to this post.]*

${trace}`;
}

function buildFaq(title, topic, kbEntries, researchNotes, trace) {
  const kbContext = kbEntries.map(k => k.title).join(', ') || topic;
  return `FAQ: ${title}
Topic: ${topic}

─── FORMAT ──────────────────────────────────────
Audience: Clients, prospective clients, practitioners
Style: Direct, clear, accessible — no jargon without explanation

─── QUESTIONS & ANSWERS ─────────────────────────

Q1: What is ${topic} and how does it work?
A: [Provide a clear, jargon-free answer. Keep it under 100 words. Reference: ${kbContext}]

Q2: Who is ${topic} for?
A: [Describe the ideal client or situation. Who benefits most?]

Q3: What can I expect during a session focused on ${topic}?
A: [Walk the reader through the experience step by step.]

Q4: How many sessions does it take to see results?
A: [Be honest and realistic. Manage expectations.]

Q5: Is ${topic} safe? Are there any contraindications?
A: [Address safety clearly. Note when to consult a doctor.]

Q6: How is this different from [common alternative]?
A: [Differentiate clearly and without putting down alternatives.]

Q7: What should I do to prepare?
A: [Give 3–5 practical preparation steps.]

Q8: What happens after the session?
A: [Integration, follow-up, self-care guidance.]

─── ADDITIONAL QUESTIONS (add as needed) ────────
- [What results have your clients reported?]
- [Can I combine this with other healing modalities?]
- [Do you offer remote / distance sessions?]
- [What is your training and background?]

─── CALL TO ACTION ──────────────────────────────
[End with: "Ready to experience ${topic} for yourself? Book a session / Download our guide / Join our community."]

${trace}`;
}

function buildWebinarOutline(title, topic, summary, kbEntries, researchNotes, trace) {
  const kbTitles = kbEntries.map(k => k.title).join(', ') || 'key knowledge base resources';
  const duration = '60–90 minutes';
  return `WEBINAR OUTLINE: ${title}

Duration: ${duration}
Format: Live + Q&A | Recorded for replay
Audience: [Clients / Practitioners / General public]

─── OVERVIEW ────────────────────────────────────
${summary || '[Brief description of what attendees will learn and why they should attend.]'}

─── LEARNING OBJECTIVES ─────────────────────────
By the end of this webinar, attendees will be able to:
1. [Understand the core concept of ${topic}]
2. [Identify how ${topic} applies to their own life or practice]
3. [Take one practical step toward [desired outcome]]
4. [Ask better questions about their own energy health]

─── AGENDA ──────────────────────────────────────
[00:00–05:00] Welcome + housekeeping
  • Introduce yourself and Royal Energy Alchemy
  • Set the tone: what makes this session different

[05:00–20:00] Segment 1: What Is ${topic}?
  • Core definition and context
  • Why this matters right now
  • Knowledge sources: ${kbTitles}
  [SLIDE IDEAS: Definition, diagram, personal story]

[20:00–35:00] Segment 2: How It Works in Practice
  • What happens in the body/energy field
  • Common experiences + what to expect
  • Client patterns and observations
  [SLIDE IDEAS: Before/after descriptions, client archetypes]

[35:00–50:00] Segment 3: Practical Tools + Techniques
  • 2–3 techniques attendees can try immediately
  • Demonstration or guided exercise
  • What to track and notice afterward
  [SLIDE IDEAS: Step-by-step visual, live demo]

[50:00–60:00] Q&A Session
  • Open Q&A
  • Address common misconceptions live
  • Point to additional resources

[60:00–65:00] Close + Next Steps
  • Recap the 3 key takeaways
  • CTA: Book a session / Download the guide / Join the program
  • Share replay / resource links

─── SLIDE DECK NOTES ────────────────────────────
- Keep slides visual, minimal text
- Include a slide for each segment header
- End with a clear, single CTA slide

─── DOWNLOADABLE RESOURCE (for attendees) ────────
[Offer a 1-page summary, checklist, or practice guide related to ${topic}]

─── POST-WEBINAR FOLLOW-UP ──────────────────────
- Email replay link within 24 hours
- Include resource download
- Soft CTA to book a session

${trace}`;
}

function buildWorkshopOutline(title, topic, summary, kbEntries, researchNotes, trace) {
  return `WORKSHOP OUTLINE: ${title}

Format: In-person or virtual small group (max 12 participants)
Duration: 2–3 hours
Materials: Provided list below

─── OVERVIEW ────────────────────────────────────
${summary || '[What will participants experience and take away from this workshop?]'}

─── LEARNING OBJECTIVES ─────────────────────────
Participants will:
1. [Gain understanding of ${topic} through direct experience]
2. [Practice [specific technique] in a supported group setting]
3. [Leave with a personalized practice or tool]
4. [Connect with a community of like-minded practitioners / seekers]

─── MODULE 1: FOUNDATION (30 min) ──────────────
Opening circle + check-in
• Welcome, ground rules, intentions
• Brief overview of ${topic}
${kbEntries.length ? '• Key concepts: ' + kbEntries.map(k => k.title).join(', ') : '• [Insert foundational concepts]'}
• Group reflection: "What brought you here today?"

─── MODULE 2: CORE TEACHING (45 min) ───────────
Instruction + demonstration
• Teach the core principle or technique
• Live demonstration
• Q&A after demonstration

─── MODULE 3: PRACTICE (45 min) ────────────────
Guided group practice
• Pairs or small group activity
• Guided experience (meditation, movement, energy work)
• Debrief: What did you notice?

─── MODULE 4: INTEGRATION (30 min) ─────────────
Bringing it home
• Personal reflection journaling (10 min)
• Share-out: 1 insight from the practice
• How to continue practicing at home
• Take-home practice sheet

─── CLOSING CIRCLE (15 min) ────────────────────
• Each participant shares one word or intention
• Gratitude close
• Resources + next steps

─── MATERIALS LIST ──────────────────────────────
□ Participant workbook / handout
□ Pens / journals
□ [Any props: crystals, oils, mats, etc.]
□ Music playlist
□ Timer

─── CALL TO ACTION ──────────────────────────────
[Offer a follow-up session, program, or individual consultation.]

${trace}`;
}

function buildTrainingModule(title, topic, summary, kbEntries, researchNotes, trace) {
  const kbTitles = kbEntries.map(k => k.title).join('; ') || 'core reference materials';
  return `TRAINING MODULE: ${title}

Module Type: ${topic}
Format: Self-paced online / Live cohort / Practitioner certification
Estimated Time: 60–90 minutes

─── MODULE OVERVIEW ─────────────────────────────
${summary || '[Describe what this module covers and how it fits into the larger training.]\n'}

─── PREREQUISITES ───────────────────────────────
[What should the learner know or have completed before this module?]

─── LEARNING OBJECTIVES ─────────────────────────
After completing this module, learners will be able to:
1. [Define and explain ${topic} in their own words]
2. [Demonstrate [specific skill or technique]]
3. [Apply [concept] in a client or self-care context]
4. [Identify when to use and when NOT to use [technique]]

─── CONTENT OUTLINE ─────────────────────────────
SECTION 1 — Introduction (10 min)
• What is ${topic}?
• Why this matters in energy healing practice
• Historical or theoretical context
[Knowledge base: ${kbTitles}]

SECTION 2 — Core Concepts (20 min)
• Concept 1: [Define and explain]
• Concept 2: [Define and explain]
• Concept 3: [Define and explain]
• Common student questions at this stage

SECTION 3 — Demonstration (15 min)
• Watch: [Video or live demonstration title]
• Notice: What to observe during the demonstration
• Reflection prompt: "What surprised you?"

SECTION 4 — Practice (20 min)
• Guided practice exercise (solo or pairs)
• Step-by-step instructions
• Safety considerations
• What to track / journal

SECTION 5 — Integration (10 min)
• Summary of key points
• Self-assessment checklist
• Connection to next module

─── ASSESSMENT ──────────────────────────────────
□ Knowledge check: [3–5 multiple choice or short answer questions]
□ Practical demonstration: [Describe what the learner must demonstrate]
□ Reflection journal: [Prompt for written reflection]

─── SUPPLEMENTARY RESOURCES ─────────────────────
• [KB Article / Reading]
• [External resource]
• [Practice guide / cheat sheet]

─── INSTRUCTOR NOTES ────────────────────────────
[Any special considerations, common misconceptions to address proactively, or facilitation tips.]

${trace}`;
}

function buildBookChapter(title, topic, summary, kbEntries, researchNotes, extSources, trace) {
  const researchRef = researchNotes.map(n => `"${n.title}"`).join(', ') || '[research observations]';
  const extRef      = extSources.map(e => e.source_title).join(', ') || '[external sources]';
  return `BOOK CHAPTER OUTLINE: ${title}

Chapter Topic: ${topic}

─── CHAPTER OVERVIEW ────────────────────────────
${summary || '[What is the central argument or journey of this chapter? What will the reader understand by the end?]'}

─── OPENING SCENE / HOOK ────────────────────────
[Start with a vivid client story (anonymized), a striking question, or a moment from your own practice that embodies the theme of ${topic}.]

─── THESIS / CORE ARGUMENT ──────────────────────
[One paragraph — what is the single most important idea this chapter makes? What is the reader meant to walk away believing?]

─── SECTION 1: Setting the Stage (800–1,200 words) ──
1.1 [Background: What context does the reader need?]
1.2 [Why most people misunderstand ${topic}]
1.3 [The turning point — what changes when you understand this]

─── SECTION 2: The Practitioner's Discovery (1,000–1,500 words) ──
2.1 [How you encountered this truth in your practice]
2.2 [Pattern across multiple clients / situations]
     (Research references: ${researchRef})
2.3 [The moment you knew this was significant]
${kbEntries.length ? '\n[Draw from: ' + kbEntries.map(k => k.title).join(', ') + ']' : ''}

─── SECTION 3: The Framework (1,000–1,500 words) ───
3.1 [Name and explain the model or framework]
3.2 [Walk through each component]
3.3 [How they interact / the system view]
3.4 [Diagram or visual suggestion]

─── SECTION 4: Application (800–1,200 words) ───────
4.1 [How the reader can apply this to their own life]
4.2 [Step-by-step practice or exercise]
4.3 [What to watch for / track]
4.4 [Client case example (anonymized)]

─── SECTION 5: What This Changes (500–800 words) ───
5.1 [How does understanding ${topic} shift the reader's perspective?]
5.2 [Long-term implications for health, relationships, energy]

─── CHAPTER CLOSE ───────────────────────────────
• Restate the core insight in one sentence
• End with an invitation or reflection question
• Bridge to the next chapter: "[Chapter N+1 explores...]"

─── KEY EXERCISES ───────────────────────────────
□ End-of-chapter reflection: "[Reflection question]"
□ Practice: [What the reader does this week]
□ Journal prompt: [Specific writing prompt]

─── EXTERNAL CONTEXT ────────────────────────────
${extRef ? 'Sources referenced: ' + extRef : '[Reference external research, books, or community insight here.]'}

─── WORD COUNT TARGET ───────────────────────────
4,000–6,000 words (for a full chapter)

${trace}`;
}

function buildPodcastOutline(title, topic, summary, kbEntries, researchNotes, extSources, trace) {
  const guestPrompt = extSources.length ? `Consider referencing: ${extSources.map(e => e.source_title).join(', ')}` : '[Consider inviting a guest expert or sharing a client story (anonymized).]';
  return `PODCAST EPISODE OUTLINE: ${title}

Episode Type: Solo / Guest Interview / Panel
Topic: ${topic}
Estimated Length: 30–45 minutes

─── EPISODE OVERVIEW ────────────────────────────
${summary || '[What is the central conversation of this episode? What will listeners understand or feel by the end?]'}

─── SHOW NOTES SUMMARY ──────────────────────────
[2–3 sentence description for podcast platforms. Keyword-rich, listener-focused.]

─── INTRO (3–5 min) ─────────────────────────────
• Music / intro jingle
• Host intro: "Welcome to [Show Name]. I'm Daron Royal..."
• Episode teaser: "Today we're exploring ${topic} — and by the end of this episode you'll understand [key takeaway]."
• Guest introduction (if applicable): [Name, credentials, why they're on the show]

─── SEGMENT 1: SETTING THE SCENE (5–8 min) ──────
• What is ${topic}?
• Why are you talking about it now?
• The question that opens the conversation
${kbEntries.length ? '\n[Reference: ' + kbEntries.map(k => k.title).join(', ') + ']' : ''}

─── SEGMENT 2: THE CORE CONVERSATION (15–20 min) ─
• Main talking point 1: [State + explore + example]
• Main talking point 2: [State + explore + example]
• Main talking point 3: [State + explore + example]
• If guest: key interview questions:
  1. "What first drew you to [topic]?"
  2. "What do most people misunderstand about [topic]?"
  3. "What has surprised you most in your work?"
${researchNotes.length ? '\n[Research context: ' + researchNotes.map(n => n.title).join(', ') + ']' : ''}

─── SEGMENT 3: PRACTICAL TAKEAWAYS (5–7 min) ────
• 3 things listeners can do this week
• A practice, question, or reflection prompt
• ${guestPrompt}

─── OUTRO (3–5 min) ─────────────────────────────
• Recap: "So today we covered..."
• Gratitude (guest or listener)
• Where to find the guest (if applicable)
• CTA: "If this episode resonated, [subscribe / share / book a session / leave a review]"
• Teaser for next episode: "Next time we'll be exploring..."

─── SHOW NOTES STRUCTURE ────────────────────────
• Episode title + 2-sentence summary
• Timestamps for each segment
• Key resources mentioned
• Guest bio + links (if applicable)
• Links to book a session + newsletter signup

${trace}`;
}

function buildCaseStudy(title, topic, summary, kbEntries, researchNotes, trace) {
  return `CASE STUDY OUTLINE: ${title}

Topic: ${topic}
Format: Anonymized client case study for educational / marketing use

─── OVERVIEW ────────────────────────────────────
${summary || '[What is the central challenge and transformation in this case study?]'}

─── DISCLAIMER ──────────────────────────────────
[All identifying details have been changed to protect client privacy. Results are individual and not guaranteed.]

─── CLIENT CONTEXT ──────────────────────────────
• Background: [Age range, general life situation — no identifying info]
• Primary concern: [What brought them to you?]
• Duration of concern: [How long had this been an issue?]
• Previous attempts to address it: [What had they already tried?]

─── INITIAL ASSESSMENT ──────────────────────────
• Energy observations: [What did you notice energetically?]
• Root pattern identified: [What was underneath the presenting concern?]
• Relevant knowledge context:
${kbEntries.length ? kbEntries.map(k => '  • ' + k.title).join('\n') : '  [Reference KB articles applied in this case]'}

─── APPROACH & SESSION WORK ─────────────────────
Session 1:
• Technique used: [Name + brief description]
• What happened during the session
• Client's immediate experience

Session 2 (if applicable):
• Follow-up observations
• Adjustments made
• Emerging patterns

Session 3+ (if applicable):
• Progression and integration

─── OUTCOMES ─────────────────────────────────────
• What shifted? [Energy, symptoms, mindset, relationships, etc.]
• Client's own words (paraphrased): "[What they reported]"
• Timeframe for change
• Unexpected benefits

─── KEY LEARNING ─────────────────────────────────
• What does this case reveal about ${topic}?
• Pattern observed across similar cases:
${researchNotes.length ? researchNotes.map(n => '  • ' + n.title).join('\n') : '  [Reference research notes]'}
• What would you do differently now?

─── PRACTITIONER REFLECTION ─────────────────────
[Personal insight or teaching moment from this case]

─── CALL TO ACTION ──────────────────────────────
[Are you experiencing something similar? Here's how to explore this work: [CTA]]

${trace}`;
}

function buildLeadMagnet(title, topic, summary, kbEntries, trace) {
  const steps = kbEntries.length >= 3
    ? kbEntries.slice(0, 5).map((k, i) => `Step ${i + 1}: ${k.title}\n[${k.summary ? k.summary.slice(0, 120) : 'Expand on this from KB article.'}]\n`)
    : ['Step 1: [Action]\n[Explain what the reader does and why]\n', 'Step 2: [Action]\n[Explain what the reader does and why]\n', 'Step 3: [Action]\n[Explain what the reader does and why]\n'];

  return `LEAD MAGNET: ${title}

Type: Downloadable Guide / Checklist / Mini-Course
Topic: ${topic}
Format: PDF (2–4 pages)

─── COVER PAGE ──────────────────────────────────
Title: ${title}
Subtitle: [A concise benefit statement: "Discover how to [outcome] in [timeframe]"]
Author: Daron Royal | Royal Energy Alchemy
Contact: [website / email / social]

─── INTRODUCTION (½ page) ───────────────────────
${summary || '[Why should the reader care about ' + topic + '? Open with their pain point or desire. Connect it to what this guide will give them.]'}

─── WHAT YOU'LL GET FROM THIS GUIDE ─────────────
• [Benefit 1]
• [Benefit 2]
• [Benefit 3]

─── THE GUIDE ───────────────────────────────────
${steps.join('\n')}
─── QUICK-REFERENCE CHECKLIST ───────────────────
□ [Action item 1]
□ [Action item 2]
□ [Action item 3]
□ [Action item 4]
□ [Action item 5]

─── WHAT TO DO NEXT ─────────────────────────────
[Bridge to the next step in the client journey:]
✦ Book a complimentary discovery call
✦ Join the [program/community name]
✦ Sign up for the newsletter
✦ Follow on [social platform]

─── ABOUT DARON ROYAL ───────────────────────────
[3–4 sentence bio. Focus on your credentials, calling, and who you serve.]

─── DISCLAIMER ──────────────────────────────────
This guide is for educational purposes only and does not constitute medical advice.

${trace}`;
}

function buildVideoOutline(title, topic, summary, kbEntries, researchNotes, trace) {
  return `VIDEO OUTLINE: ${title}

Topic: ${topic}
Format: Educational / YouTube / Social / Training
Recommended Length: 8–15 minutes

─── HOOK (0:00–0:30) ────────────────────────────
[Open with a question, bold claim, or striking statement. Do NOT start with "Hey guys." Start in the middle of the action.]
Example: "If you've ever felt drained after being around certain people, what you're experiencing is [${topic}]..."

─── INTRO (0:30–1:30) ───────────────────────────
• Briefly introduce yourself: "I'm Daron Royal..."
• State what the video will cover
• Why this matters: "[Viewer benefit]"
• Subscribe / like hook: "If you want more on this, make sure you subscribe."

─── MAIN CONTENT ─────────────────────────────────
SECTION 1 (1:30–4:00): What Is ${topic}?
• Core definition (accessible language)
• Why most people have it wrong
${kbEntries.length ? '[Knowledge source: ' + kbEntries.map(k => k.title).join(', ') + ']' : ''}

SECTION 2 (4:00–7:00): How It Works
• The mechanism or process
• What it looks / feels like in real life
• Client example (anonymized)
${researchNotes.length ? '[Research reference: ' + researchNotes.map(n => n.title).join(', ') + ']' : ''}

SECTION 3 (7:00–11:00): What You Can Do
• Practical technique 1: [Name + demo]
• Practical technique 2: [Name + demo]
• What to notice / track

─── CLOSE (11:00–12:00) ─────────────────────────
• Recap the 3 key points
• Invitation: "If you found this helpful, [subscribe / like / share]"
• CTA: "To go deeper, [book a session / download the guide / join the program]"
• Tease next video: "Next week I'll be covering..."

─── B-ROLL / VISUAL NOTES ───────────────────────
• [Suggest visuals for each section]
• Text overlays for key terms
• Include a "chapters" description for YouTube

─── DESCRIPTION (YouTube/Social) ────────────────
[SEO-friendly description. Include: topic keyword, what viewers learn, CTA, links.]
Tags: [energy healing, ${topic.toLowerCase()}, royal energy alchemy, ...]

${trace}`;
}

function buildGenericDraft(title, topic, summary, kbPoints, rnPoints, trace) {
  return `CONTENT DRAFT: ${title}

Topic: ${topic}

─── OVERVIEW ────────────────────────────────────
${summary || '[Describe the core message or purpose of this content piece.]'}

─── KEY TALKING POINTS ──────────────────────────
${kbPoints || '[List main points from your knowledge base]'}

─── RESEARCH CONTEXT ────────────────────────────
${rnPoints || '[Reference relevant research notes and observations]'}

─── OUTLINE ─────────────────────────────────────
1. Introduction: [Hook + context]
2. Main Point 1: [State + evidence + example]
3. Main Point 2: [State + evidence + example]
4. Main Point 3: [State + evidence + example]
5. Practical Application: [What can the audience do?]
6. Conclusion: [Restate + CTA]

─── CALL TO ACTION ──────────────────────────────
[What do you want the reader/viewer/listener to do next?]

${trace}`;
}

// ═════════════════════════════════════════════════════════════════════════
// DRAFT MUTATIONS
// ═════════════════════════════════════════════════════════════════════════

async function updateDraft(sb, id, body, auth, ip) {
  const allowed = ['title', 'draft_content'];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await sb.from('content_drafts').update(updates).eq('id', id).is('deleted_at', null).select(DRAFT_COLS).single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Draft not found.');

  await log(sb, { action: 'updated', tableName: 'content_drafts', recordId: id, actor: auth.user?.email, ip });
  return { draft: data };
}

async function transitionDraft(sb, id, newStatus, auth, ip) {
  if (!VALID_DRAFT_STATUSES.includes(newStatus)) throw userErr(`Invalid status: ${newStatus}`);

  const { data, error } = await sb.from('content_drafts').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select(DRAFT_COLS).single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Draft not found.');

  await log(sb, { action: newStatus, tableName: 'content_drafts', recordId: id, actor: auth.user?.email, ip });
  return { draft: data };
}

async function deleteDraft(sb, id, auth, ip) {
  const { data, error } = await sb.from('content_drafts').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw new Error(error.message);
  if (!data) throw userErr('Draft not found.');

  await log(sb, { action: 'deleted', tableName: 'content_drafts', recordId: id, actor: auth.user?.email, ip });
  return { deleted: true, id };
}
