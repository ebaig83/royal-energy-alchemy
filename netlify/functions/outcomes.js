// /.netlify/functions/outcomes
//
// Session Outcomes
// GET  ?session_id=uuid        — outcomes for a session
// GET  ?client_id=uuid         — all outcomes for a client
// GET  ?research=1             — research-flagged outcomes (all)
// POST (body includes session_id) — create session outcome
// PATCH ?id=uuid               — update session outcome
//
// Client Goals
// GET  ?goals=1&client_id=uuid — goals for a client
// POST (body includes goal:true + client_id) — create goal
// PATCH ?goal_id=uuid          — update goal

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = event.headers['x-forwarded-for'] || '';

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {

    // Research flags
    if (params.research) {
      const { data, error } = await sb
        .from('session_outcomes')
        .select('*')
        .eq('research_flag', true)
        .order('created_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { research_flags: data || [] });
    }

    // Goals
    if (params.goals) {
      if (!params.client_id) return respond(400, { error: 'client_id is required for goals.' });
      const { data, error } = await sb
        .from('client_goals')
        .select('*')
        .eq('client_id', params.client_id)
        .order('created_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { goals: data || [] });
    }

    // Session outcomes by session
    if (params.session_id) {
      const { data, error } = await sb
        .from('session_outcomes')
        .select('*')
        .eq('session_id', params.session_id)
        .order('created_at', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { outcomes: data || [] });
    }

    // Session outcomes by client
    if (params.client_id) {
      const { data, error } = await sb
        .from('session_outcomes')
        .select('*')
        .eq('client_id', params.client_id)
        .order('session_date', { ascending: false });
      if (error) return respond(500, { error: error.message });
      return respond(200, { outcomes: data || [] });
    }

    return respond(400, { error: 'Provide session_id, client_id, research=1, or goals=1&client_id.' });
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Create client goal
    if (body.goal === true) {
      if (!body.client_id) return respond(400, { error: 'client_id is required.' });
      if (!body.goal_text) return respond(400, { error: 'goal_text is required.' });

      const insert = {
        client_id:        body.client_id,
        client_name:      body.client_name    || null,
        goal_text:        body.goal_text,
        goal_category:    body.goal_category  || 'general',
        expected_outcome: body.expected_outcome || null,
        target_date:      body.target_date    || null,
        status:           body.status         || 'active',
        outcome_notes:    body.outcome_notes  || null,
      };

      const { data, error } = await sb.from('client_goals').insert(insert).select().single();
      if (error) return respond(500, { error: error.message });
      await log({ actor: auth.user.email, action: 'created', tableName: 'client_goals', recordId: data.id, newData: data, context: `Goal created for ${body.client_name || body.client_id}`, ip });
      return respond(201, { goal: data });
    }

    // Create session outcome
    if (!body.session_id && !body.client_id) return respond(400, { error: 'session_id or client_id is required.' });
    if (!body.outcome_category) return respond(400, { error: 'outcome_category is required.' });

    const validCategories = ['improved','no_change','worse','mixed'];
    if (!validCategories.includes(body.outcome_category)) {
      return respond(400, { error: `outcome_category must be one of: ${validCategories.join(', ')}` });
    }

    // Sync state_before/state_after to session if provided
    if (body.session_id && (body.state_before != null || body.state_after != null)) {
      const stateUpdate = {};
      if (body.state_before != null) stateUpdate.state_before = body.state_before;
      if (body.state_after  != null) stateUpdate.state_after  = body.state_after;
      if (body.mark_completed) stateUpdate.status = 'completed';
      if (Object.keys(stateUpdate).length) {
        await sb.from('sessions').update(stateUpdate).eq('id', body.session_id);
      }
    }

    const insert = {
      session_id:         body.session_id       || null,
      client_id:          body.client_id        || null,
      client_name:        body.client_name      || null,
      session_date:       body.session_date     || null,
      outcome_category:   body.outcome_category,
      improvement_level:  body.improvement_level || null,
      energy_shift:       body.energy_shift     || null,
      practitioner_notes: body.practitioner_notes || null,
      notable_findings:   body.notable_findings || null,
      research_flag:      body.research_flag === true || body.research_flag === 'true',
      research_notes:     body.research_notes   || null,
    };

    const { data, error } = await sb.from('session_outcomes').insert(insert).select().single();
    if (error) return respond(500, { error: error.message });
    await log({ actor: auth.user.email, action: 'created', tableName: 'session_outcomes', recordId: data.id, newData: data, context: `Outcome recorded for session ${body.session_id || body.client_id}`, ip });
    return respond(201, { outcome: data });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Update goal
    if (params.goal_id) {
      const { data: old } = await sb.from('client_goals').select('*').eq('id', params.goal_id).single();
      if (!old) return respond(404, { error: 'Goal not found.' });

      const allowed = ['goal_text','goal_category','expected_outcome','target_date','status','outcome_notes','achieved_at'];
      const updates = {};
      allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
      updates.updated_at = new Date().toISOString();
      if (body.status === 'achieved' && !updates.achieved_at) updates.achieved_at = new Date().toISOString();

      const { data, error } = await sb.from('client_goals').update(updates).eq('id', params.goal_id).select().single();
      if (error) return respond(500, { error: error.message });
      await log({ actor: auth.user.email, action: 'updated', tableName: 'client_goals', recordId: params.goal_id, oldData: old, newData: data, context: `Goal updated: ${data.status}`, ip });
      return respond(200, { goal: data });
    }

    // Update session outcome
    if (!params.id) return respond(400, { error: 'id or goal_id is required.' });

    const { data: old } = await sb.from('session_outcomes').select('*').eq('id', params.id).single();
    if (!old) return respond(404, { error: 'Outcome not found.' });

    const allowed = ['outcome_category','improvement_level','energy_shift','practitioner_notes','notable_findings','research_flag','research_notes'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await sb.from('session_outcomes').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });
    await log({ actor: auth.user.email, action: 'updated', tableName: 'session_outcomes', recordId: params.id, oldData: old, newData: data, context: 'Session outcome updated', ip });
    return respond(200, { outcome: data });
  }

  return respond(405, { error: 'Method not allowed.' });
};
