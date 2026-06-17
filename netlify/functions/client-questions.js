// /.netlify/functions/client-questions
//
// Client question workflow (Sprint 17 Phase B). Function-enforced ownership +
// RLS defense-in-depth; service_role never exposed to the browser.
//
// CLIENT (portal token OR Authorization: Bearer <supabase JWT>):
//   POST { token?, session_id?, question, category, priority, preferred_contact_method }
//        → creates a question for the caller's own client
//   GET  ?token=...            → list the caller's own questions
//
// ADMIN (X-Dashboard-Token):
//   GET                        → full queue (all clients)
//   PATCH ?id=<uuid> { status?, practitioner_response? }
//        → update status / add response (sets responded_at when responding)

'use strict';

const { respond, requireAdmin } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES   = ['new', 'in_review', 'responded', 'closed'];

function bearer(event) {
  const h = event.headers['authorization'] || event.headers['Authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function resolveClient(sb, { jwt, token }) {
  if (jwt) {
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data || !data.user) return { error: respond(401, { error: 'Your session has expired. Please log in again.' }) };
    const email = (data.user.email || '').toLowerCase().trim();
    const { data: rows } = await sb.from('clients').select('id').eq('email', email);
    if (!rows || rows.length !== 1) return { error: respond(403, { error: 'No single client record matches this account.' }) };
    return { client: rows[0] };
  }
  if (token && token.length >= 16) {
    const { data, error } = await sb.from('clients').select('id').eq('portal_token', token).single();
    if (error || !data) return { error: respond(404, { error: 'This access link is invalid or has expired.' }) };
    return { client: data };
  }
  return { error: respond(401, { error: 'Sign in or use your secure portal link.' }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const isAdminAttempt = !!(event.headers['x-dashboard-token'] || event.headers['X-Dashboard-Token']);

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  if (isAdminAttempt) {
    const auth = requireAdmin(event);
    if (auth.error) return auth.error;

    if (event.httpMethod === 'GET') {
      const { data, error } = await sb
        .from('client_questions')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      // attach client names
      const ids = [...new Set((data || []).map(q => q.client_id).filter(Boolean))];
      let names = {};
      if (ids.length) {
        const { data: cs } = await sb.from('clients').select('id, full_name').in('id', ids);
        (cs || []).forEach(c => { names[c.id] = c.full_name; });
      }
      const questions = (data || []).map(q => ({ ...q, client_name: names[q.client_id] || '—' }));
      return respond(200, { questions });
    }

    if (event.httpMethod === 'PATCH') {
      if (!params.id) return respond(400, { error: 'id is required.' });
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid body.' }); }
      const updates = {};
      if (body.status) {
        if (!STATUSES.includes(body.status)) return respond(400, { error: 'Invalid status.' });
        updates.status = body.status;
      }
      if (typeof body.practitioner_response === 'string') {
        updates.practitioner_response = body.practitioner_response;
        updates.responded_at = new Date().toISOString();
        if (!body.status) updates.status = 'responded';
      }
      if (!Object.keys(updates).length) return respond(400, { error: 'Nothing to update.' });
      const { data, error } = await sb.from('client_questions').update(updates).eq('id', params.id).select().single();
      if (error) return respond(500, { error: error.message });
      return respond(200, { question: data });
    }
    return respond(405, { error: 'Method not allowed.' });
  }

  // ── CLIENT ───────────────────────────────────────────────────────────────
  const jwt = bearer(event);

  if (event.httpMethod === 'GET') {
    const { client, error } = await resolveClient(sb, { jwt, token: (params.token || '').trim() });
    if (error) return error;
    const { data, err } = await sb
      .from('client_questions')
      .select('id, question, category, priority, status, practitioner_response, preferred_contact_method, submitted_at, responded_at')
      .eq('client_id', client.id)
      .order('submitted_at', { ascending: false });
    if (err) return respond(500, { error: err.message });
    return respond(200, { questions: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid body.' }); }
    const { client, error } = await resolveClient(sb, { jwt, token: (body.token || '').trim() });
    if (error) return error;

    const question = String(body.question || '').trim();
    if (!question) return respond(400, { error: 'Please enter your question.' });

    const row = {
      client_id:                client.id,
      session_id:               body.session_id || null,
      question,
      category:                 body.category || 'Other',
      priority:                 PRIORITIES.includes(body.priority) ? body.priority : 'normal',
      preferred_contact_method: body.preferred_contact_method || null,
      status:                   'new',
    };
    const { data, error: insErr } = await sb.from('client_questions').insert(row).select('id, status, submitted_at').single();
    if (insErr) {
      if (/does not exist|schema cache|relation/i.test(insErr.message)) {
        return respond(503, { error: 'Questions are not available yet. Please contact us directly.' });
      }
      return respond(500, { error: insErr.message });
    }
    return respond(200, { saved: true, question: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
