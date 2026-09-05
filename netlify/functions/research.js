// /.netlify/functions/research
//
// GET  ?section=notes                      — all notes (soft-deleted excluded)
// GET  ?section=notes&session_id=uuid      — notes for a specific session
// GET  ?section=notes&search=text          — keyword filter (title + content)
// GET  ?section=pattern_library            — tag aggregation: counts + recent excerpts
// GET  ?section=pattern_library&search=q   — filter tags by keyword
// GET  ?section=insights                   — cross-note analysis: shared tags, modalities, themes
// GET  ?section=analytics                  — dashboard KPIs: counts, top tags, this-month
//
// POST ?action=create_note                 — create research note
//
// PATCH ?action=update_note&id=uuid        — edit note fields
// PATCH ?action=delete_note&id=uuid        — soft-delete note

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

function userErr(msg) { const e = new Error(msg); e.name = 'UserError'; return e; }

function isMissingTableError(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg  = error.message || '';
  return (
    code === '42P01'    ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    code === 'PGRST116' ||   // column not found
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return respond(auth.status, { error: auth.error });

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const ip     = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // ── GET ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'notes';
    try {
      if (section === 'notes')           return respond(200, await getNotes(sb, params));
      if (section === 'pattern_library') return respond(200, await getPatternLibrary(sb, params));
      if (section === 'insights')        return respond(200, await getInsights(sb));
      if (section === 'analytics')       return respond(200, await getAnalytics(sb));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[research] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'create_note') return respond(201, await createNote(sb, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[research] POST', action, err.message);
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
      if (action === 'update_note') return respond(200, await updateNote(sb, id, body, auth, ip));
      if (action === 'delete_note') return respond(200, await deleteNote(sb, id, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[research] PATCH', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ═════════════════════════════════════════════════════════════════════════
// GET HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function getNotes(sb, params) {
  let query = sb
    .from('research_notes')
    .select('id, title, content, source_url, tags, session_id, visibility, client_id, created_by, created_at, updated_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (params.session_id) query = query.eq('session_id', params.session_id);

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) return { notes: [], migration_needed: true };
    throw new Error(error.message);
  }

  let notes = data || [];

  if (params.search) {
    const q = params.search.toLowerCase();
    notes = notes.filter(n =>
      (n.title   || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q)
    );
  }

  return { notes, count: notes.length };
}

// ── Pattern Library: group notes by tag, return counts + recent excerpts ──

async function getPatternLibrary(sb, params) {
  const { data, error } = await sb
    .from('research_notes')
    .select('id, title, content, tags, created_at')
    .is('deleted_at', null)
    .not('tags', 'is', null);

  if (error) {
    if (isMissingTableError(error)) return { patterns: [], count: 0, total_tagged_notes: 0, _migration_needed: true };
    throw new Error(error.message);
  }

  const notes = data || [];

  // Build tag → { count, recent_notes[] } map
  const tagMap = {};
  for (const note of notes) {
    for (const rawTag of (note.tags || [])) {
      const tag = rawTag.toLowerCase().trim();
      if (!tag) continue;
      if (!tagMap[tag]) tagMap[tag] = { tag, count: 0, recent_notes: [] };
      tagMap[tag].count++;
      // Keep up to 3 most recent note excerpts per tag (notes already ordered by created_at desc)
      if (tagMap[tag].recent_notes.length < 3) {
        tagMap[tag].recent_notes.push({
          id:      note.id,
          title:   note.title,
          excerpt: (note.content || '').slice(0, 120),
          created_at: note.created_at,
        });
      }
    }
  }

  let patterns = Object.values(tagMap).sort((a, b) => b.count - a.count);

  // Optional keyword filter on tag names
  if (params.search) {
    const q = params.search.toLowerCase().trim();
    patterns = patterns.filter(p => p.tag.includes(q));
  }

  return {
    patterns,
    count:             patterns.length,
    total_tagged_notes: notes.length,
  };
}

// ── Insights: cross-note analysis — shared tags, modalities, themes ───────

// Known modality keywords to surface from free-form tags
const MODALITIES = [
  'reiki', 'distance reiki', 'energy healing', 'chakra', 'meditation',
  'sound healing', 'crystal', 'breathwork', 'intuitive healing',
  'quantum', 'shamanic', 'hands-on',
];

// Known emotional-theme keywords to surface from free-form tags
const EMOTIONAL_THEMES = [
  'anxiety', 'grief', 'trauma', 'stress', 'depression', 'fear', 'anger',
  'clarity', 'peace', 'transformation', 'breakthrough', 'release',
  'healing', 'joy', 'grounding', 'protection', 'alignment',
];

async function getInsights(sb) {
  const { data, error } = await sb
    .from('research_notes')
    .select('tags, client_id, created_at')
    .is('deleted_at', null);

  if (error) {
    if (isMissingTableError(error)) {
      return { topTags: [], sharedTags: [], modalities: [], emotionalThemes: [], clientsWithNotes: 0, totalNotes: 0, _migration_needed: true };
    }
    throw new Error(error.message);
  }

  const allNotes   = data || [];
  const allTags    = [];
  const clientTags = {}; // client_id → Set<tag>

  for (const note of allNotes) {
    const tags = (note.tags || []).map(t => t.toLowerCase().trim()).filter(Boolean);
    allTags.push(...tags);
    if (note.client_id) {
      if (!clientTags[note.client_id]) clientTags[note.client_id] = new Set();
      tags.forEach(t => clientTags[note.client_id].add(t));
    }
  }

  // Global tag frequency
  const tagCounts = {};
  allTags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });

  // Top 10 tags overall
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Shared tags: tags that appear in notes linked to 2+ distinct clients
  const tagClientCount = {};
  for (const tags of Object.values(clientTags)) {
    tags.forEach(t => { tagClientCount[t] = (tagClientCount[t] || 0) + 1; });
  }
  const sharedTags = Object.entries(tagClientCount)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, client_count]) => ({ tag, client_count }));

  // Modality patterns: match known keywords against collected tags
  const modalities = MODALITIES
    .map(m => ({ modality: m, count: tagCounts[m] || 0 }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count);

  // Emotional theme patterns
  const emotionalThemes = EMOTIONAL_THEMES
    .map(t => ({ theme: t, count: tagCounts[t] || 0 }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    topTags,
    sharedTags,
    modalities,
    emotionalThemes,
    clientsWithNotes: Object.keys(clientTags).length,
    totalNotes:       allNotes.length,
  };
}

// ── Analytics: dashboard KPI metrics ─────────────────────────────────────

async function getAnalytics(sb) {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data, error } = await sb
    .from('research_notes')
    .select('tags, client_id, created_at')
    .is('deleted_at', null);

  if (error) {
    if (isMissingTableError(error)) {
      return { totalNotes: 0, activeTags: 0, mostCommonTag: null, notesThisMonth: 0, clientsWithNotes: 0, topTags: [], _migration_needed: true };
    }
    throw new Error(error.message);
  }

  const allNotes  = data || [];
  const allTags   = [];
  const clientSet = new Set();
  let   thisMonth = 0;

  for (const note of allNotes) {
    const tags = (note.tags || []).map(t => t.toLowerCase().trim()).filter(Boolean);
    allTags.push(...tags);
    if (note.client_id) clientSet.add(note.client_id);
    if (note.created_at && note.created_at >= monthStart) thisMonth++;
  }

  const tagCounts = {};
  allTags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalNotes:      allNotes.length,
    activeTags:      Object.keys(tagCounts).length,
    mostCommonTag:   topTags[0] ? topTags[0].tag : null,
    notesThisMonth:  thisMonth,
    clientsWithNotes: clientSet.size,
    topTags,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// POST / PATCH HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function createNote(sb, body, auth, ip) {
  if (!body.title?.trim()) throw userErr('title is required.');

  const insert = {
    title:      body.title.trim(),
    body:       body.content    || '',   // legacy NOT NULL column — mirrors content
    content:    body.content    || null,
    source_url: body.source_url || null,
    tags:       Array.isArray(body.tags) ? body.tags : null,
    session_id: body.session_id || null,
    visibility: body.visibility && ['private','practice_notes'].includes(body.visibility) ? body.visibility : 'private',
    client_id:  body.client_id  || null,
    created_by: auth.user.email || 'daron',
  };

  const { data, error } = await sb.from('research_notes').insert(insert).select().single();
  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'created',
    tableName: 'research_notes',
    recordId:  data.id,
    newData:   data,
    context:   `Research note: ${data.title}`,
    ip,
  });

  return { note: data };
}

async function updateNote(sb, id, body, auth, ip) {
  const allowed = ['title', 'content', 'source_url', 'tags', 'session_id', 'visibility', 'client_id'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

  // Keep legacy body column in sync when content changes
  if (updates.content !== undefined) updates.body = updates.content || '';

  if (updates.title !== undefined && !String(updates.title).trim())
    throw userErr('title cannot be empty.');
  if (updates.title) updates.title = String(updates.title).trim();

  if (updates.visibility && !['private','practice_notes'].includes(updates.visibility))
    throw userErr('visibility must be "private" or "practice_notes".');

  if (Object.keys(updates).length === 0) throw userErr('No valid fields to update.');
  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from('research_notes')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data)  throw new Error('Note not found or already deleted.');

  await log({
    actor:     auth.user.email,
    action:    'updated',
    tableName: 'research_notes',
    recordId:  id,
    newData:   updates,
    context:   `Research note updated: ${id}`,
    ip,
  });

  return { note: data };
}

async function deleteNote(sb, id, auth, ip) {
  const { data: existing, error: fetchErr } = await sb
    .from('research_notes')
    .select('id, title')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (fetchErr || !existing) throw new Error('Note not found or already deleted.');

  const { error } = await sb
    .from('research_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'deleted',
    tableName: 'research_notes',
    recordId:  id,
    context:   `Research note soft-deleted: ${existing.title}`,
    ip,
  });

  return { deleted: true, id };
}
