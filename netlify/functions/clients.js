// /.netlify/functions/clients
// GET    ?id=uuid          — fetch one client + their full session history
// GET    ?search=name      — search clients by name or email
// GET    (no params)       — list all clients, newest first
// POST                     — create a new client
// PATCH  ?id=uuid          — update a client

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');
const { isQaRecord }            = require('./lib/record-policy');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function optionalText(value) { return value == null || String(value).trim() === '' ? null : String(value).trim(); }
function validDateOnly(value) {
  if (value == null || String(value).trim() === '') return true;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text && date <= new Date();
}
function validPhone(value) {
  if (value == null || String(value).trim() === '') return true;
  const text = String(value).trim();
  const digits = text.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+()\-\.\s\dextEXT#x]+$/.test(text);
}

// Strip QA/test seed clients from production responses unless ?include_qa=true
function _filterQA(rows, params) {
  if (!rows) return [];
  if (params && params.include_qa === 'true') return rows;
  return rows.filter(function(c) { return !isQaRecord(c); });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return respond(500, { error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Netlify environment variables.' });
  }

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    if (params.id) {
      const { data: client, error } = await sb
        .from('clients')
        .select('*')
        .eq('id', params.id)
        .single();

      if (error) return respond(404, { error: 'Client not found.' });
      if (client.merged_into_client_id) return respond(410, { error: 'Client profile was merged.', primary_client_id: client.merged_into_client_id });
      if (params.include_qa !== 'true' && isQaRecord(client)) return respond(404, { error: 'Client not found.' });

      const { data: sessions } = await sb
        .from('sessions')
        .select('*, session_notes(*), payments(*)')
        .eq('client_id', params.id)
        .order('session_date', { ascending: false });

      const { data: aftercare } = await sb
        .from('aftercare')
        .select('*')
        .eq('client_id', params.id)
        .order('scheduled_for', { ascending: false });

      const { data: outgoingRelationships, error: outgoingError } = await sb
        .from('client_relationships')
        .select('id,relationship_type,relationship_label,source,notes,related_client:clients!client_relationships_related_client_id_fkey(id,full_name,status)')
        .eq('client_id', params.id)
        .order('created_at', { ascending: true });

      const { data: incomingRelationships, error: incomingError } = await sb
        .from('client_relationships')
        .select('id,relationship_type,relationship_label,source,notes,anchor_client:clients!client_relationships_client_id_fkey(id,full_name,status)')
        .eq('related_client_id', params.id)
        .order('created_at', { ascending: true });

      // Keep profiles usable during a staged rollout before the migration lands.
      const reciprocalLabel = type => ({
        child: 'Parent', parent: 'Child', grandchild: 'Grandparent',
        grandparent: 'Grandchild', sibling: 'Sibling', friend: 'Friend',
        uncle: 'Related family', associated: 'Associated',
      })[type] || 'Related';
      const relationships = (outgoingError || incomingError) ? [] : [
        ...(outgoingRelationships || []).map(r => ({ ...r, direction: 'outgoing', client: r.related_client })),
        ...(incomingRelationships || []).map(r => ({ ...r, direction: 'incoming', relationship_label: reciprocalLabel(r.relationship_type), client: r.anchor_client })),
      ];

      const visibleSessions = params.include_qa === 'true' ? (sessions || []) : (sessions || []).filter(s => !isQaRecord(s));
      return respond(200, { client, sessions: visibleSessions, aftercare: aftercare || [], relationships });
    }

    if (params.search) {
      const q = `%${params.search}%`;
      let q2 = sb
        .from('clients')
        .select('*')
        .or(`full_name.ilike.${q},email.ilike.${q}`)
        .order('created_at', { ascending: false })
        .limit(50);
      // Exclude archived unless caller explicitly requests it
      if (params.include_archived !== 'true') q2 = q2.not('status', 'eq', 'archived');
      q2 = q2.is('merged_into_client_id', null);
      const { data, error } = await q2;
      if (error) return respond(500, { error: error.message });
      return respond(200, { clients: _filterQA(data, params) });
    }

    // List all — exclude archived and QA/test clients by default
    let query = sb
      .from('clients')
      .select('id, full_name, email, phone, status, source, tags, created_at, merged_into_client_id')
      .order('created_at', { ascending: false });

    // If a specific status filter is requested, apply it server-side
    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    } else if (params.include_archived !== 'true') {
      // Default: hide archived
      query = query.not('status', 'eq', 'archived');
    }

    query = query.is('merged_into_client_id', null);
    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { clients: _filterQA(data, params) });
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    if (!body.full_name?.trim()) return respond(400, { error: 'full_name is required.' });

    const { data, error } = await sb
      .from('clients')
      .insert({
        full_name: body.full_name.trim(),
        email:     body.email?.trim()  || null,
        phone:     body.phone?.trim()  || null,
        source:    body.source         || 'manual',
        notes:     optionalText(body.notes),
        tags:      Array.isArray(body.tags) ? body.tags : [],
      })
      .select()
      .single();

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'clients', recordId: data.id, newData: { id: data.id, changed_fields: ['full_name', 'email', 'phone', 'notes', 'tags'] }, context: 'Created client profile', ip });
    return respond(201, { client: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('clients').select('*').eq('id', params.id).single();
    if (!old) return respond(404, { error: 'Client not found.' });

    if (body.full_name !== undefined && !String(body.full_name || '').trim()) return respond(400, { error: 'Client name cannot be empty.' });
    if (body.email !== undefined && body.email && !EMAIL_RE.test(String(body.email).trim())) return respond(400, { error: 'Enter a valid email address.' });
    if (body.phone !== undefined && !validPhone(body.phone)) return respond(400, { error: 'Enter a valid phone number or leave it blank.' });
    if (body.date_of_birth !== undefined && !validDateOnly(body.date_of_birth)) return respond(400, { error: 'Date of birth must be a valid past date in YYYY-MM-DD format.' });

    const allowed = ['full_name','email','phone','status','notes','tags','source','address','date_of_birth','emergency_contact','additional_information','preferred_contact'];
    const updates = {};
    allowed.forEach(k => {
      if (body[k] === undefined) return;
      if (k === 'tags') updates[k] = Array.isArray(body[k]) ? body[k].map(v => String(v).trim()).filter(Boolean).slice(0, 50) : [];
      else if (['full_name','email','phone','notes','address','emergency_contact','additional_information','date_of_birth'].includes(k)) updates[k] = optionalText(body[k]);
      else if (k === 'preferred_contact') updates[k] = optionalText(body[k])?.toLowerCase();
      else updates[k] = body[k];
    });
    if (!Object.keys(updates).length) return respond(400, { error: 'No client fields were supplied.' });

    const { data, error } = await sb
      .from('clients')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'clients', recordId: params.id, oldData: { id: old.id, changed_fields: Object.keys(updates) }, newData: { id: data.id, changed_fields: Object.keys(updates) }, context: 'Updated client profile fields', ip });
    return respond(200, { client: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
