// /.netlify/functions/clients
// GET    ?id=uuid          — fetch one client + their full session history
// GET    ?search=name      — search clients by name or email
// GET    (no params)       — list all clients, newest first
// POST                     — create a new client
// PATCH  ?id=uuid          — update a client

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

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

      return respond(200, { client, sessions: sessions || [], aftercare: aftercare || [] });
    }

    if (params.search) {
      const q = `%${params.search}%`;
      const { data, error } = await sb
        .from('clients')
        .select('*')
        .or(`full_name.ilike.${q},email.ilike.${q}`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) return respond(500, { error: error.message });
      return respond(200, { clients: data });
    }

    const { data, error } = await sb
      .from('clients')
      .select('id, full_name, email, phone, status, source, tags, created_at')
      .order('created_at', { ascending: false });

    if (error) return respond(500, { error: error.message });
    return respond(200, { clients: data });
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
        notes:     body.notes          || null,
        tags:      body.tags           || [],
      })
      .select()
      .single();

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'clients', recordId: data.id, newData: data, context: `Created client ${data.full_name}`, ip });
    return respond(201, { client: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('clients').select('*').eq('id', params.id).single();

    const allowed = ['full_name','email','phone','status','notes','tags','source'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    const { data, error } = await sb
      .from('clients')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'clients', recordId: params.id, oldData: old, newData: data, context: `Updated client ${data.full_name}`, ip });
    return respond(200, { client: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
