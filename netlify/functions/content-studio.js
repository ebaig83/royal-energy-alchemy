// /.netlify/functions/content-studio
//
// GET  ?section=ideas                         — all ideas (soft-deleted excluded)
// GET  ?section=ideas&status=draft            — filter by status
// GET  ?section=ideas&content_type=social_post — filter by type
// GET  ?section=ideas&search=text             — keyword search
// GET  ?section=dashboard                     — KPIs + recent activity
// GET  ?section=calendar                      — ideas with scheduled_date
// GET  ?section=sources                       — kb_entries + research_notes for sourcing
//
// POST ?action=create_idea                    — create idea
// POST ?action=generate                       — deterministic idea generation from sources
//
// PATCH ?action=update_idea&id=uuid           — edit idea fields
// PATCH ?action=schedule_idea&id=uuid         — set scheduled_date
// PATCH ?action=delete_idea&id=uuid           — soft-delete

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const VALID_STATUSES     = ['draft', 'approved', 'archived'];
const VALID_TYPES        = ['social_post', 'video', 'newsletter', 'blog', 'training', 'book_chapter', 'faq', 'webinar'];
const VALID_SOURCE_TYPES = ['kb_entry', 'research_note', 'pattern', 'insight'];

const SELECT_COLS = 'id, title, content_type, source_type, source_ids, topic, summary, status, scheduled_date, created_by, created_at, updated_at';

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
  if (auth.error) return respond(auth.status, { error: auth.error });

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const ip     = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // ── GET ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'ideas';
    try {
      if (section === 'ideas')     return respond(200, await getIdeas(sb, params));
      if (section === 'dashboard') return respond(200, await getDashboard(sb));
      if (section === 'calendar')  return respond(200, await getCalendar(sb));
      if (section === 'sources')   return respond(200, await getSources(sb, params));
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
      if (action === 'create_idea') return respond(201, await createIdea(sb, body, auth, ip));
      if (action === 'generate')    return respond(200, await generateIdeas(sb, body));
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
// GET HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function getIdeas(sb, params) {
  let query = sb
    .from('content_ideas')
    .select(SELECT_COLS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (params.status)       query = query.eq('status', params.status);
  if (params.content_type) query = query.eq('content_type', params.content_type);

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
  const { data: all, error } = await sb
    .from('content_ideas')
    .select('id, status, content_type, created_at, updated_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return {
        kpis: { total: 0, draft: 0, approved: 0, source_articles: 0, source_notes: 0 },
        recent_generated: [], recent_approved: [], migration_needed: 'WARN',
      };
    }
    throw new Error(error.message);
  }

  const ideas = all || [];

  // Parallel: source counts
  const [kbRes, rnRes] = await Promise.all([
    sb.from('kb_entries').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('research_notes').select('id', { count: 'exact', head: true }).is('deleted_at', null),
  ]);

  const kpis = {
    total:           ideas.length,
    draft:           ideas.filter(i => i.status === 'draft').length,
    approved:        ideas.filter(i => i.status === 'approved').length,
    source_articles: kbRes.count || 0,
    source_notes:    rnRes.count || 0,
  };

  const recent_generated = ideas.slice(0, 5);
  const recent_approved  = ideas.filter(i => i.status === 'approved').slice(0, 5);

  return { kpis, recent_generated, recent_approved };
}

async function getCalendar(sb) {
  const { data, error } = await sb
    .from('content_ideas')
    .select(SELECT_COLS)
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
  const limit = parseInt(params.limit || '20', 10);

  const [kbRes, rnRes] = await Promise.all([
    sb.from('kb_entries')
      .select('id, title, summary, category, tags, status, created_at')
      .is('deleted_at', null)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(limit),
    sb.from('research_notes')
      .select('id, title, content, tags, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  return {
    kb_entries:     (kbRes.data || []),
    research_notes: (rnRes.data || []),
    kb_count:       (kbRes.data || []).length,
    rn_count:       (rnRes.data || []).length,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// POST HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function createIdea(sb, body, auth, ip) {
  if (!body.title)        throw userErr('title is required.');
  if (!body.content_type) throw userErr('content_type is required.');
  if (!VALID_TYPES.includes(body.content_type)) {
    throw userErr(`Invalid content_type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  const row = {
    title:        body.title.trim(),
    content_type: body.content_type,
    source_type:  VALID_SOURCE_TYPES.includes(body.source_type) ? body.source_type : null,
    source_ids:   Array.isArray(body.source_ids) ? body.source_ids : [],
    topic:        body.topic   || null,
    summary:      body.summary || null,
    status:       VALID_STATUSES.includes(body.status) ? body.status : 'draft',
    scheduled_date: body.scheduled_date || null,
    created_by:   auth.user || 'daron',
  };

  const { data, error } = await sb.from('content_ideas').insert(row).select(SELECT_COLS).single();
  if (error) throw new Error(error.message);

  await log(sb, { action: 'created', table: 'content_ideas', record_id: data.id, actor: auth.user, ip });
  return { idea: data };
}

// ── Deterministic Idea Generation Engine ──────────────────────────────────
//
// Pulls sources from KB + research_notes + pattern library and generates
// structured content opportunity ideas using template-based logic.
// No LLMs — fully deterministic.

async function generateIdeas(sb, body) {
  const targetType = body.content_type || null; // optional filter
  const limit      = Math.min(parseInt(body.limit || '20', 10), 50);

  // Fetch sources in parallel
  const [kbRes, rnRes] = await Promise.all([
    sb.from('kb_entries')
      .select('id, title, summary, category, tags, content')
      .is('deleted_at', null)
      .eq('status', 'published')
      .order('is_pinned', { ascending: false })
      .limit(15),
    sb.from('research_notes')
      .select('id, title, content, tags')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  const kbEntries    = kbRes.data || [];
  const researchNotes = rnRes.data || [];

  const generated = [];

  // ── KB → Social Posts ─────────────────────────────────────────────────
  if (!targetType || targetType === 'social_post') {
    for (const kb of kbEntries) {
      const topic = kb.category || kb.title;
      generated.push(...[
        {
          title:        `Common misconceptions about ${kb.title}`,
          content_type: 'social_post',
          source_type:  'kb_entry',
          source_ids:   [{ table: 'kb_entries', id: kb.id, title: kb.title }],
          topic,
          summary: `Myth-busting post based on "${kb.title}". Address what clients get wrong and what the truth is.`,
        },
        {
          title:        `What clients experience during ${kb.title}`,
          content_type: 'social_post',
          source_type:  'kb_entry',
          source_ids:   [{ table: 'kb_entries', id: kb.id, title: kb.title }],
          topic,
          summary: `First-person perspective post describing the client experience for "${kb.title}".`,
        },
      ]);
    }
  }

  // ── KB → FAQ ──────────────────────────────────────────────────────────
  if (!targetType || targetType === 'faq') {
    for (const kb of kbEntries) {
      generated.push({
        title:        `FAQ: Everything you need to know about ${kb.title}`,
        content_type: 'faq',
        source_type:  'kb_entry',
        source_ids:   [{ table: 'kb_entries', id: kb.id, title: kb.title }],
        topic:        kb.category || kb.title,
        summary:      `Comprehensive FAQ derived from "${kb.title}". Convert key knowledge points into Q&A format.`,
      });
    }
  }

  // ── KB → Training ─────────────────────────────────────────────────────
  if (!targetType || targetType === 'training') {
    for (const kb of kbEntries) {
      generated.push({
        title:        `Training module: ${kb.title}`,
        content_type: 'training',
        source_type:  'kb_entry',
        source_ids:   [{ table: 'kb_entries', id: kb.id, title: kb.title }],
        topic:        kb.category || kb.title,
        summary:      `Practitioner training module based on "${kb.title}". Structure as a lesson with key concepts and practical exercises.`,
      });
    }
  }

  // ── Research Notes → Book Chapters ────────────────────────────────────
  if (!targetType || targetType === 'book_chapter') {
    for (const rn of researchNotes) {
      generated.push({
        title:        `Book chapter: ${rn.title}`,
        content_type: 'book_chapter',
        source_type:  'research_note',
        source_ids:   [{ table: 'research_notes', id: rn.id, title: rn.title }],
        topic:        (rn.tags || [])[0] || rn.title,
        summary:      `Chapter exploring themes from research note "${rn.title}". Expand into practitioner stories, case examples, and lessons learned.`,
      });
    }
  }

  // ── Research Notes → Video Topics ─────────────────────────────────────
  if (!targetType || targetType === 'video') {
    for (const rn of researchNotes) {
      const tags = (rn.tags || []).slice(0, 2).join(', ');
      generated.push({
        title:        `Video: Deep dive into ${rn.title}`,
        content_type: 'video',
        source_type:  'research_note',
        source_ids:   [{ table: 'research_notes', id: rn.id, title: rn.title }],
        topic:        tags || rn.title,
        summary:      `Educational video exploring "${rn.title}". Cover key findings, practitioner insights, and client implications.`,
      });
    }
  }

  // ── Research Notes → Newsletter ───────────────────────────────────────
  if (!targetType || targetType === 'newsletter') {
    // Group notes by shared tags for newsletter angles
    const tagGroups = {};
    for (const rn of researchNotes) {
      for (const tag of (rn.tags || [])) {
        if (!tagGroups[tag]) tagGroups[tag] = [];
        tagGroups[tag].push(rn);
      }
    }

    // Generate newsletter idea per tag group (up to 5 tags)
    for (const [tag, notes] of Object.entries(tagGroups).slice(0, 5)) {
      generated.push({
        title:        `Newsletter: ${tag} — Insights from the Practice`,
        content_type: 'newsletter',
        source_type:  'research_note',
        source_ids:   notes.slice(0, 3).map(n => ({ table: 'research_notes', id: n.id, title: n.title })),
        topic:        tag,
        summary:      `Newsletter covering "${tag}" themes from ${notes.length} research note(s). Synthesize patterns and share practitioner perspective.`,
      });
    }

    // Fallback if no tagged notes
    if (Object.keys(tagGroups).length === 0 && researchNotes.length > 0) {
      generated.push({
        title:        `Newsletter: Practitioner Insights — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        content_type: 'newsletter',
        source_type:  'research_note',
        source_ids:   researchNotes.slice(0, 3).map(n => ({ table: 'research_notes', id: n.id, title: n.title })),
        topic:        'practitioner insights',
        summary:      `Monthly newsletter synthesizing recent research notes and practitioner observations.`,
      });
    }
  }

  // ── Blog from KB + Research cross-reference ───────────────────────────
  if (!targetType || targetType === 'blog') {
    for (const kb of kbEntries.slice(0, 5)) {
      // Find research notes that share tags with this KB entry
      const kbTags  = (kb.tags || []).map(t => t.toLowerCase());
      const related = researchNotes.filter(rn =>
        (rn.tags || []).some(t => kbTags.includes(t.toLowerCase()))
      );

      const sourceIds = [{ table: 'kb_entries', id: kb.id, title: kb.title }];
      for (const rn of related.slice(0, 2)) {
        sourceIds.push({ table: 'research_notes', id: rn.id, title: rn.title });
      }

      generated.push({
        title:        `Blog: The practitioner's guide to ${kb.title}`,
        content_type: 'blog',
        source_type:  'kb_entry',
        source_ids:   sourceIds,
        topic:        kb.category || kb.title,
        summary:      `Long-form blog post synthesizing KB article "${kb.title}"${related.length > 0 ? ` with ${related.length} related research observation(s)` : ''}. Target: prospective clients and practitioners.`,
      });
    }
  }

  // ── Webinar from high-value KB entries ────────────────────────────────
  if (!targetType || targetType === 'webinar') {
    const pinnedKb = kbEntries.filter(k => k.is_pinned || k.category === 'Protocol');
    const webinarSources = pinnedKb.length > 0 ? pinnedKb : kbEntries.slice(0, 3);

    for (const kb of webinarSources.slice(0, 3)) {
      generated.push({
        title:        `Webinar: ${kb.title} — A Live Practitioner Session`,
        content_type: 'webinar',
        source_type:  'kb_entry',
        source_ids:   [{ table: 'kb_entries', id: kb.id, title: kb.title }],
        topic:        kb.category || kb.title,
        summary:      `Live webinar based on "${kb.title}". Include Q&A, live demo, and downloadable summary for attendees.`,
      });
    }
  }

  return {
    generated: generated.slice(0, limit),
    count:     Math.min(generated.length, limit),
    sources:   { kb_count: kbEntries.length, rn_count: researchNotes.length },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// PATCH HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function updateIdea(sb, id, body, auth, ip) {
  const allowed = ['title', 'content_type', 'source_type', 'source_ids', 'topic', 'summary', 'status'];
  const updates = { updated_at: new Date().toISOString() };

  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'status' && !VALID_STATUSES.includes(body[key])) {
        throw userErr(`Invalid status: ${body[key]}`);
      }
      if (key === 'content_type' && !VALID_TYPES.includes(body[key])) {
        throw userErr(`Invalid content_type: ${body[key]}`);
      }
      updates[key] = body[key];
    }
  }

  const { data, error } = await sb
    .from('content_ideas')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select(SELECT_COLS)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'updated', table: 'content_ideas', record_id: id, actor: auth.user, ip });
  return { idea: data };
}

async function scheduleIdea(sb, id, body, auth, ip) {
  if (!body.scheduled_date && body.scheduled_date !== null) {
    throw userErr('scheduled_date is required (or null to clear).');
  }

  const { data, error } = await sb
    .from('content_ideas')
    .update({ scheduled_date: body.scheduled_date, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select(SELECT_COLS)
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'scheduled', table: 'content_ideas', record_id: id, actor: auth.user, ip, meta: { date: body.scheduled_date } });
  return { idea: data };
}

async function deleteIdea(sb, id, auth, ip) {
  const { data, error } = await sb
    .from('content_ideas')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw userErr('Idea not found.');

  await log(sb, { action: 'deleted', table: 'content_ideas', record_id: id, actor: auth.user, ip });
  return { deleted: true, id };
}
