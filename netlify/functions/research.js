// /.netlify/functions/research
//
// GET  ?section=notes                    — all notes (soft-deleted excluded)
// GET  ?section=notes&session_id=uuid    — notes for a specific session
// GET  ?section=notes&search=text        — keyword filter (title + content)
//
// POST ?action=create_note               — create research note
//
// PATCH ?action=update_note&id=uuid      — edit note fields
// PATCH ?action=delete_note&id=uuid      — soft-delete note

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
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (auth.error) return respond(auth.status, { error: auth.error });

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const ip     = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // ── GET ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'notes';
    try {
      if (section === 'notes') return respond(200, await getNotes(sb, params));
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
    .select('id, title, content, source_url, tags, session_id, created_by, created_at, updated_at')
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
  const allowed = ['title', 'content', 'source_url', 'tags', 'session_id'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
  // Keep legacy body column in sync when content changes
  if (updates.content !== undefined) updates.body = updates.content || '';

  if (updates.title !== undefined && !String(updates.title).trim())
    throw userErr('title cannot be empty.');
  if (updates.title) updates.title = String(updates.title).trim();
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
