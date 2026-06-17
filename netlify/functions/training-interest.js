// /.netlify/functions/training-interest
//
// Routes training class interest into the practitioner dashboard.
//
// PUBLIC:
//   POST { first_name, email, interested_courses, levels, source? }
//        → records a training lead
//
// ADMIN (X-Dashboard-Token):
//   GET                       → list leads (newest first)
//   PATCH ?id=<uuid> { status }  → update lead status

'use strict';

const { respond, requireAdmin } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

const STATUSES = ['new', 'contacted', 'enrolled', 'closed'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  const sb = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const isAdmin = !!(event.headers['x-dashboard-token'] || event.headers['X-Dashboard-Token']);

  // ── ADMIN ────────────────────────────────────────────────────────────────
  if (isAdmin) {
    const auth = requireAdmin(event);
    if (auth.error) return auth.error;

    if (event.httpMethod === 'GET') {
      const { data, error } = await sb
        .from('training_interest')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { leads: data || [] });
    }
    if (event.httpMethod === 'PATCH') {
      if (!params.id) return respond(400, { error: 'id is required.' });
      let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid body.' }); }
      if (!STATUSES.includes(body.status)) return respond(400, { error: 'Invalid status.' });
      const { data, error } = await sb.from('training_interest').update({ status: body.status }).eq('id', params.id).select().single();
      if (error) return respond(500, { error: error.message });
      return respond(200, { lead: data });
    }
    return respond(405, { error: 'Method not allowed.' });
  }

  // ── PUBLIC: record a lead ──────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  if (event.body && event.body.includes('"bot-field"')) { /* fallthrough; honeypot handled by caller */ }

  let body; try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid body.' }); }
  if (body.bot_field || body['bot-field']) return respond(200, { saved: true }); // silent honeypot

  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return respond(400, { error: 'A valid email is required.' });
  }

  const row = {
    first_name:         (body.first_name || body.firstName || '').trim() || null,
    email,
    interested_courses: (body.interested_courses || '').trim() || null,
    levels:             (body.levels || '').trim() || null,
    source:             body.source || 'training_waitlist',
    status:             'new',
  };
  const { error } = await sb.from('training_interest').insert(row);
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) {
      return respond(503, { error: 'Training interest is not available yet.' });
    }
    return respond(500, { error: error.message });
  }
  return respond(200, { saved: true });
};
