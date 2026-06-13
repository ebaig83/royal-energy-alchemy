// /.netlify/functions/kb
//
// GET  ?section=entries                           — all entries (soft-deleted excluded)
// GET  ?section=entries&category=text             — filter by category
// GET  ?section=entries&search=text               — keyword search (title + content)
// GET  ?section=entry&id=uuid                     — single entry by id
// GET  ?section=categories                        — distinct category list
//
// POST ?action=create_entry                       — create KB article
//
// PATCH ?action=update_entry&id=uuid              — edit entry fields
// PATCH ?action=delete_entry&id=uuid              — soft-delete (no hard deletes)

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

const VALID_STATUSES = ['draft', 'published', 'archived'];

const SELECT_COLS = 'id, title, content, category, tags, is_pinned, status, created_by, created_at, updated_at';

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
    const section = params.section || 'entries';
    try {
      if (section === 'entries')    return respond(200, await getEntries(sb, params));
      if (section === 'entry')      return respond(200, await getEntry(sb, params.id));
      if (section === 'categories') return respond(200, await getCategories(sb));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[kb] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'create_entry') return respond(201, await createEntry(sb, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[kb] POST', action, err.message);
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
      if (action === 'update_entry') return respond(200, await updateEntry(sb, id, body, auth, ip));
      if (action === 'delete_entry') return respond(200, await deleteEntry(sb, id, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[kb] PATCH', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ═════════════════════════════════════════════════════════════════════════
// GET HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function getEntries(sb, params) {
  let query = sb
    .from('kb_entries')
    .select(SELECT_COLS)
    .is('deleted_at', null)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (params.category) query = query.eq('category', params.category);
  if (params.status)   query = query.eq('status',   params.status);

  const { data, error } = await query;

  if (error) {
    if (isMissingTableError(error)) return { entries: [], migration_needed: true };
    throw new Error(error.message);
  }

  let entries = data || [];

  if (params.search) {
    const q = params.search.toLowerCase();
    entries = entries.filter(e =>
      (e.title    || '').toLowerCase().includes(q) ||
      (e.content  || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q)
    );
  }

  return { entries, count: entries.length };
}

async function getEntry(sb, id) {
  if (!id) throw userErr('id is required.');
  const { data, error } = await sb
    .from('kb_entries')
    .select(SELECT_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (isMissingTableError(error)) return { entry: null, migration_needed: true };
    throw new Error(error.message);
  }
  return { entry: data };
}

async function getCategories(sb) {
  const { data, error } = await sb
    .from('kb_entries')
    .select('category')
    .is('deleted_at', null)
    .not('category', 'is', null);

  if (error) {
    if (isMissingTableError(error)) return { categories: [] };
    throw new Error(error.message);
  }

  const cats = [...new Set((data || []).map(r => r.category).filter(Boolean))].sort();
  return { categories: cats };
}

// ═════════════════════════════════════════════════════════════════════════
// POST / PATCH HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function createEntry(sb, body, auth, ip) {
  if (!body.title?.trim()) throw userErr('title is required.');

  const status = body.status || 'draft';
  if (!VALID_STATUSES.includes(status))
    throw userErr(`status must be one of: ${VALID_STATUSES.join(', ')}`);

  const insert = {
    title:      body.title.trim(),
    content:    body.content    || null,
    category:   body.category   || null,
    tags:       Array.isArray(body.tags) ? body.tags : null,
    is_pinned:  body.is_pinned === true || body.is_pinned === 'true' ? true : false,
    status,
    created_by: auth.user.email || 'daron',
  };

  const { data, error } = await sb.from('kb_entries').insert(insert).select(SELECT_COLS).single();
  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'created',
    tableName: 'kb_entries',
    recordId:  data.id,
    newData:   data,
    context:   `KB entry: ${data.title} [${data.status}]`,
    ip,
  });

  return { entry: data };
}

async function updateEntry(sb, id, body, auth, ip) {
  const allowed = ['title', 'content', 'category', 'tags', 'is_pinned', 'status'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

  if (updates.title !== undefined && !String(updates.title).trim())
    throw userErr('title cannot be empty.');
  if (updates.title) updates.title = String(updates.title).trim();

  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status))
    throw userErr(`status must be one of: ${VALID_STATUSES.join(', ')}`);

  if (updates.is_pinned !== undefined)
    updates.is_pinned = updates.is_pinned === true || updates.is_pinned === 'true';

  if (Object.keys(updates).length === 0) throw userErr('No valid fields to update.');

  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from('kb_entries')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select(SELECT_COLS)
    .single();

  if (error) throw new Error(error.message);
  if (!data)  throw new Error('Entry not found or already deleted.');

  await log({
    actor:     auth.user.email,
    action:    'updated',
    tableName: 'kb_entries',
    recordId:  id,
    newData:   updates,
    context:   `KB entry updated: ${id}`,
    ip,
  });

  return { entry: data };
}

async function deleteEntry(sb, id, auth, ip) {
  const { data: existing, error: fetchErr } = await sb
    .from('kb_entries')
    .select('id, title')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (fetchErr || !existing) throw new Error('Entry not found or already deleted.');

  const { error } = await sb
    .from('kb_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'deleted',
    tableName: 'kb_entries',
    recordId:  id,
    context:   `KB entry soft-deleted: ${existing.title}`,
    ip,
  });

  return { deleted: true, id };
}
