// /.netlify/functions/knowledge-hub
// GET ?section=social     — trending topics, content ideas, script vault
// GET ?section=books      — book projects, evidence vault, chapters
// GET ?section=training   — courses, modules
// GET ?section=research   — patterns, session trends, evidence categories, opportunities
// GET ?section=insights   — executive summary counts
// POST ?section=books     — create book project
// POST ?section=training  — create course
// POST ?section=script    — save script to vault
// POST ?section=content   — save content idea
// PATCH ?section=books&id=uuid    — update book project/chapter
// PATCH ?section=training&id=uuid — update course/module

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const QA_NAMES = /qa|test|seed|demo|sample|fake|automation|workflow.audit/i;
const QA_TAGS  = ['qa', 'test', 'seed', 'demo'];

async function loadQAClientIds(sb) {
  const { data: clients } = await sb.from('clients').select('id, full_name, tags');
  if (!clients) return new Set();
  return new Set(
    clients
      .filter(c => {
        const tags = (c.tags || []).map(t => (t || '').toLowerCase());
        return QA_TAGS.some(q => tags.includes(q)) || QA_NAMES.test(c.full_name || '');
      })
      .map(c => c.id)
  );
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb      = getClient();
  const params  = event.queryStringParameters || {};
  const section = params.section;
  const ip      = event.headers['x-forwarded-for'] || '';

  if (!section) {
    return respond(400, { error: 'section is required: social | books | training | research | insights' });
  }

  try {
    if (event.httpMethod === 'GET') {
      if (section === 'social')   return respond(200, await getSocial(sb));
      if (section === 'books')    return respond(200, await getBooks(sb));
      if (section === 'training') return respond(200, await getTraining(sb));
      if (section === 'research') return respond(200, await getResearch(sb));
      if (section === 'insights') return respond(200, await getInsights(sb));
      return respond(400, { error: `Unknown section: ${section}` });
    }

    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

      if (section === 'books') {
        if (!body.title?.trim()) return respond(400, { error: 'title is required.' });
        const { data, error } = await sb.from('book_projects').insert({
          title: body.title.trim(), subtitle: body.subtitle || null,
          description: body.description || null, status: body.status || 'active',
        }).select().single();
        if (error) return respond(500, { error: error.message });
        await log({ actor: auth.user.email, action: 'created', tableName: 'book_projects', recordId: data.id, newData: data, context: `Created book project: ${data.title}`, ip });
        return respond(201, { book_project: data });
      }

      if (section === 'training') {
        if (!body.title?.trim()) return respond(400, { error: 'title is required.' });
        const { data, error } = await sb.from('training_courses').insert({
          title: body.title.trim(), level: body.level || null,
          description: body.description || null, status: body.status || 'planning',
        }).select().single();
        if (error) return respond(500, { error: error.message });
        await log({ actor: auth.user.email, action: 'created', tableName: 'training_courses', recordId: data.id, newData: data, context: `Created training course: ${data.title}`, ip });
        return respond(201, { course: data });
      }

      if (section === 'script') {
        if (!body.title?.trim()) return respond(400, { error: 'title is required.' });
        const { data, error } = await sb.from('script_vault').insert({
          title: body.title.trim(), content_type: body.content_type || null,
          content: body.content || null, topic: body.topic || null, status: 'draft',
        }).select().single();
        if (error) return respond(500, { error: error.message });
        await log({ actor: auth.user.email, action: 'created', tableName: 'script_vault', recordId: data.id, newData: data, context: `Added script: ${data.title}`, ip });
        return respond(201, { script: data });
      }

      if (section === 'content') {
        if (!body.title?.trim()) return respond(400, { error: 'title is required.' });
        const { data, error } = await sb.from('content_ideas').insert({
          title: body.title.trim(), topic: body.topic || null,
          idea_type: body.idea_type || null, description: body.description || null,
          source_count: body.source_count || 0, status: 'new',
        }).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(201, { content_idea: data });
      }

      return respond(400, { error: `POST not supported for section: ${section}` });
    }

    if (event.httpMethod === 'PATCH') {
      const id = params.id;
      if (!id) return respond(400, { error: 'id is required for PATCH.' });
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

      if (section === 'books') {
        const table = body._table === 'chapter' ? 'book_chapters' : 'book_projects';
        const allowed = table === 'book_chapters'
          ? ['title','chapter_number','patterns','statistics','notes','status']
          : ['title','subtitle','description','status'];
        const updates = {};
        allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
        updates.updated_at = new Date().toISOString();
        const { data, error } = await sb.from(table).update(updates).eq('id', id).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { updated: data });
      }

      if (section === 'training') {
        const table = body._table === 'module' ? 'training_modules' : 'training_courses';
        const allowed = table === 'training_modules'
          ? ['title','module_type','content','order_index','status']
          : ['title','level','description','status'];
        const updates = {};
        allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
        updates.updated_at = new Date().toISOString();
        const { data, error } = await sb.from(table).update(updates).eq('id', id).select().single();
        if (error) return respond(500, { error: error.message });
        return respond(200, { updated: data });
      }

      return respond(400, { error: `PATCH not supported for section: ${section}` });
    }

    return respond(405, { error: 'Method not allowed.' });

  } catch (err) {
    console.error('[knowledge-hub] Error:', err.message);
    return respond(500, { error: err.message });
  }
};

// ── SOCIAL ───────────────────────────────────────────────────────────────────
async function getSocial(sb) {
  const [qaIds, notesRes, sessRes, recRes, ideasRes, scriptsRes, topicsRes] = await Promise.all([
    loadQAClientIds(sb),
    sb.from('session_notes').select('removals_done, energy_findings, content').order('created_at', { ascending: false }).limit(500),
    sb.from('sessions').select('service, client_id').order('created_at', { ascending: false }).limit(500),
    sb.from('recommendations').select('category, client_id').order('created_at', { ascending: false }).limit(500),
    sb.from('content_ideas').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('script_vault').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('knowledge_topics').select('*').is('deleted_at', null).order('frequency', { ascending: false }).limit(20),
  ]);

  const notes    = (notesRes.data || []);
  const sessions = (sessRes.data  || []).filter(s => !qaIds.has(s.client_id));
  const recs     = (recRes.data   || []).filter(r => !qaIds.has(r.client_id));

  // Aggregate trending topics from removals_done (structured array) + service
  const topicCounts = {};

  for (const n of notes) {
    const removals = Array.isArray(n.removals_done) ? n.removals_done : [];
    for (const r of removals) {
      if (!r || typeof r !== 'string') continue;
      const clean = r.trim().toLowerCase();
      if (!clean || clean.length < 3) continue;
      topicCounts[clean] = (topicCounts[clean] || 0) + 1;
    }
  }

  for (const s of sessions) {
    if (s.service) {
      const clean = s.service.trim().toLowerCase();
      topicCounts[clean] = (topicCounts[clean] || 0) + 1;
    }
  }

  const recCategoryMap = { supplement: 'supplement recommendations', crystal: 'crystal work', essential_oil: 'essential oils', book: 'reading recommendations', course: 'educational resources', protection: 'protection work', attachment: 'attachment clearing' };
  for (const r of recs) {
    if (r.category && recCategoryMap[r.category]) {
      const clean = recCategoryMap[r.category];
      topicCounts[clean] = (topicCounts[clean] || 0) + 1;
    }
  }

  // Merge with stored knowledge_topics (which may have AI-extracted or manually curated entries)
  const storedTopics = topicsRes.data || [];
  for (const t of storedTopics) {
    const key = t.topic.toLowerCase();
    if (!topicCounts[key]) topicCounts[key] = t.frequency;
  }

  // Sort and assign trend direction
  const sorted = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([topic, freq]) => ({
      topic: topic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      frequency: freq,
      trend: freq > 5 ? 'rising' : freq > 2 ? 'stable' : 'stable',
    }));

  // Total client count for content opportunity copy
  const totalClients = new Set([...sessions.map(s => s.client_id).filter(Boolean)]).size;

  return {
    trending_topics:   sorted,
    content_ideas:     ideasRes.data || [],
    script_vault:      scriptsRes.data || [],
    total_sessions:    sessions.length,
    total_clients:     totalClients,
  };
}

// ── BOOKS ────────────────────────────────────────────────────────────────────
async function getBooks(sb) {
  const [qaIds, projectsRes, evidenceRes, chaptersRes, notesRes] = await Promise.all([
    loadQAClientIds(sb),
    sb.from('book_projects').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('book_evidence').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('book_chapters').select('*').is('deleted_at', null).order('chapter_number', { ascending: true }),
    sb.from('session_notes').select('id, energy_findings, removals_done, content, client_id, session_id, created_at').order('created_at', { ascending: false }).limit(200),
  ]);

  const notes = (notesRes.data || []).filter(n => !qaIds.has(n.client_id));

  // Compute evidence vault from real session_notes (grouped by inferred category)
  const CATEGORY_KEYWORDS = {
    'Relationship Issues':    ['relationship', 'cord', 'cords', 'family', 'partner', 'marriage', 'divorce', 'ex', 'romantic'],
    'House & Space Clearing': ['house', 'home', 'space', 'room', 'clearing', 'property', 'land', 'environment', 'portal'],
    'Protection Work':        ['protection', 'shield', 'boundary', 'attack', 'psychic', 'negative energy'],
    'Attachment Work':        ['attachment', 'entity', 'spirit', 'possession', 'intrusion', 'earthbound'],
    'Emotional Healing':      ['grief', 'trauma', 'anxiety', 'depression', 'fear', 'anger', 'sadness', 'emotional'],
    'Environmental Issues':   ['emf', 'schumann', 'solar', 'geomagnetic', 'weather', 'environmental'],
  };

  const computed_evidence = {};
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matches = notes.filter(n => {
      const text = ((n.energy_findings || '') + ' ' + (n.content || '') + ' ' + (n.removals_done || []).join(' ')).toLowerCase();
      return keywords.some(k => text.includes(k));
    });
    computed_evidence[cat] = {
      count: matches.length,
      recent_finding: matches[0]?.energy_findings ? matches[0].energy_findings.slice(0, 120) : null,
    };
  }

  // Group stored evidence by category
  const storedEvidence = evidenceRes.data || [];
  const storedByCategory = {};
  for (const e of storedEvidence) {
    if (!storedByCategory[e.category]) storedByCategory[e.category] = [];
    storedByCategory[e.category].push(e);
  }

  return {
    book_projects: projectsRes.data || [],
    book_chapters: chaptersRes.data || [],
    evidence_vault_computed: computed_evidence,
    evidence_vault_stored:   storedByCategory,
    total_evidence_entries:  storedEvidence.length,
    total_notes_analyzed:    notes.length,
  };
}

// ── TRAINING ─────────────────────────────────────────────────────────────────
async function getTraining(sb) {
  const [coursesRes, modulesRes] = await Promise.all([
    sb.from('training_courses').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
    sb.from('training_modules').select('*').is('deleted_at', null).order('order_index', { ascending: true }),
  ]);

  const courses = (coursesRes.data || []);
  const modules = (modulesRes.data || []);

  // Attach modules to courses
  const coursesWithModules = courses.map(c => ({
    ...c,
    modules: modules.filter(m => m.course_id === c.id),
    module_count: modules.filter(m => m.course_id === c.id).length,
  }));

  return {
    courses: coursesWithModules,
    total_courses: courses.length,
    total_modules: modules.length,
    published_courses: courses.filter(c => c.status === 'published').length,
    in_progress_courses: courses.filter(c => c.status === 'in_progress').length,
  };
}

// ── RESEARCH ─────────────────────────────────────────────────────────────────
async function getResearch(sb) {
  const [qaIds, patternsRes, oppsRes, sessRes, notesRes] = await Promise.all([
    loadQAClientIds(sb),
    sb.from('research_patterns').select('*').is('deleted_at', null).order('frequency', { ascending: false }),
    sb.from('research_opportunities').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    sb.from('sessions').select('id, client_id, service, state_before, state_after, status, session_date, location_type').order('session_date', { ascending: false }).limit(300),
    sb.from('session_notes').select('id, client_id, removals_done, energy_findings').order('created_at', { ascending: false }).limit(300),
  ]);

  const sessions = (sessRes.data  || []).filter(s => !qaIds.has(s.client_id));
  const notes    = (notesRes.data || []).filter(n => !qaIds.has(n.client_id));
  const completed = sessions.filter(s => s.status === 'completed');

  // Compute session trends (state_before vs state_after)
  // state_before/after may be stored as objects or other non-string types — force to string
  const withOutcome = completed.filter(s => s.state_before && s.state_after);
  const outcomePositive = withOutcome.filter(s => {
    const before = String(s.state_before || '').toLowerCase();
    const after  = String(s.state_after  || '').toLowerCase();
    const posWords = ['better', 'improved', 'lighter', 'relief', 'clear', 'calm', 'peace'];
    return posWords.some(w => after.includes(w)) && !posWords.some(w => before.includes(w));
  }).length;

  // Service distribution
  const serviceCounts = {};
  for (const s of sessions) {
    if (!s.service) continue;
    serviceCounts[s.service] = (serviceCounts[s.service] || 0) + 1;
  }

  // Location split
  const distance  = sessions.filter(s => s.location_type === 'distance').length;
  const inPerson  = sessions.filter(s => s.location_type === 'in_person').length;

  // Evidence categories from notes
  const EVIDENCE_CATS = {
    'Relationship Issues':  ['relationship','cord','cords','family','partner','marriage'],
    'Environmental Issues': ['house','home','space','clearing','property','emf','portal'],
    'Emotional Concerns':   ['grief','trauma','anxiety','depression','fear','anger'],
    'Protection Work':      ['protection','shield','attack','psychic','negative'],
    'Attachment Work':      ['attachment','entity','spirit','possession','intrusion'],
  };
  const evidenceCategories = {};
  for (const [cat, kws] of Object.entries(EVIDENCE_CATS)) {
    evidenceCategories[cat] = notes.filter(n => {
      const text = ((n.energy_findings || '') + ' ' + (n.removals_done || []).join(' ')).toLowerCase();
      return kws.some(k => text.includes(k));
    }).length;
  }

  // Compute emerging patterns from notes removals_done
  const patternCounts = {};
  for (const n of notes) {
    for (const r of (n.removals_done || [])) {
      if (r && typeof r === 'string' && r.trim().length > 2) {
        const k = r.trim().toLowerCase();
        patternCounts[k] = (patternCounts[k] || 0) + 1;
      }
    }
  }
  const emergingPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, freq]) => ({
      topic: topic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      frequency: freq,
      growth_trend: freq > 5 ? 'rising' : 'stable',
    }));

  const storedPatterns = patternsRes.data || [];

  return {
    stored_patterns:    storedPatterns,
    emerging_patterns:  emergingPatterns,
    evidence_categories: evidenceCategories,
    research_opportunities: oppsRes.data || [],
    session_trends: {
      total_sessions:   sessions.length,
      completed:        completed.length,
      with_outcome:     withOutcome.length,
      outcome_positive: outcomePositive,
      distance:         distance,
      in_person:        inPerson,
      service_distribution: serviceCounts,
    },
  };
}

// ── INSIGHTS ─────────────────────────────────────────────────────────────────
async function getInsights(sb) {
  const [
    sessRes, notesRes, contentRes, evidenceRes,
    modulesRes, patternsRes, booksRes, coursesRes,
    scriptsRes, oppsRes,
  ] = await Promise.all([
    sb.from('sessions').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
    sb.from('session_notes').select('id', { count: 'exact', head: true }),
    sb.from('content_ideas').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('book_evidence').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('training_modules').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('research_patterns').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('book_projects').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status','active'),
    sb.from('training_courses').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('script_vault').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('research_opportunities').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status','open'),
  ]);

  const sessions_logged       = sessRes.count || 0;
  const content_opportunities = contentRes.count || 0;
  const book_evidence_entries = evidenceRes.count || 0;
  const training_assets       = modulesRes.count || 0;
  const research_patterns     = patternsRes.count || 0;
  const knowledge_assets_total = content_opportunities + book_evidence_entries + training_assets + research_patterns + (scriptsRes.count || 0);

  return {
    sessions_logged,
    content_opportunities,
    book_evidence_entries,
    training_assets,
    research_patterns,
    knowledge_assets_total,
    session_notes_total:    notesRes.count || 0,
    active_books:           booksRes.count || 0,
    active_courses:         coursesRes.count || 0,
    scripts_in_vault:       scriptsRes.count || 0,
    open_research_opps:     oppsRes.count || 0,
  };
}
