// lead-pipeline.js — Netlify serverless function
// Royal Energy Alchemy — Sprint 9: Referral & Lead Pipeline
// Tables: leads, referral_sources
// Auth: X-Dashboard-Token header
//
// GET  ?section=dashboard          → KPIs + pipeline counts
// GET  ?section=leads              → lead list (?status= &source= &search= &referral_source_id=)
// GET  ?section=referral_sources   → referral source list (?active=)
// GET  ?section=pipeline           → leads grouped by status
// GET  ?section=analytics          → conversion rates, revenue by source, avg time to convert
// GET  ?section=lost               → lost/archived leads
// POST ?action=create_lead         → create new lead
// POST ?action=create_referral_source → create referral source
// PATCH ?action=update_lead&id=    → update lead fields
// PATCH ?action=update_status&id=  → transition lead status
// PATCH ?action=convert_lead&id=   → mark converted, link to client
// PATCH ?action=lose_lead&id=      → mark lost
// PATCH ?action=log_contact&id=    → increment contact_count, set last_contact_date
// PATCH ?action=update_referral_source&id= → update referral source
// PATCH ?action=delete_lead&id=    → soft delete
// PATCH ?action=delete_referral_source&id= → hard delete (no FK risk if no leads linked)

const { createClient } = require('@supabase/supabase-js');
const auth             = require('./lib/auth');

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function requireAdmin(event) {
  const a = auth.requireAdmin(event);
  if (a && a.error) return { error: a.error };
  return a || {};
}

function isMissingTableError(err) {
  if (!err) return false;
  const msg = (err.message || '') + (err.code || '') + (err.details || '') + (err.hint || '');
  return (
    err.code === '42P01' || err.code === 'PGRST204' ||
    err.code === 'PGRST200' || err.code === 'PGRST116' ||
    msg.includes('does not exist') || msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

const MIGRATION_WARN = {
  migration_needed: true,
  message: 'Run migration 2026-06-13-lead-pipeline.sql in Supabase SQL Editor.',
};

const VALID_STATUSES = ['new','contacted','consultation','booked','converted','lost','archived'];
const VALID_SOURCES  = ['website','facebook','instagram','tiktok','youtube','referral','workshop','event','returning_client','google','email','phone','other'];
const VALID_RS_TYPES = ['client','practitioner','business','social_media','website','event','workshop','other'];

const LEAD_COLS = [
  'id','first_name','last_name','email','phone',
  'source','source_detail','referral_source_id',
  'interested_service','status','notes','assigned_to',
  'first_contact_date','last_contact_date',
  'converted_client_id','converted_at','converted_service','converted_revenue',
  'contact_count','created_at','updated_at',
].join(', ');

const RS_COLS = 'id, name, source_type, contact_info, notes, active, created_at, updated_at';

exports.handler = async function (event) {
  const authResult = requireAdmin(event);
  if (authResult.error) return authResult.error;

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const method  = event.httpMethod;
  const params  = event.queryStringParameters || {};
  const section = params.section || '';
  const action  = params.action  || '';
  const id      = params.id      || '';

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch { body = {}; }
  }

  try {
    // ── GET ─────────────────────────────────────────────────────────────────
    if (method === 'GET') {
      if (section === 'dashboard')        return respond(200, await getDashboard(sb));
      if (section === 'leads')            return respond(200, await getLeads(sb, params));
      if (section === 'referral_sources') return respond(200, await getReferralSources(sb, params));
      if (section === 'pipeline')         return respond(200, await getPipeline(sb));
      if (section === 'analytics')        return respond(200, await getAnalytics(sb));
      if (section === 'lost')             return respond(200, await getLost(sb));
      return respond(400, { error: 'Unknown section: ' + section });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (action === 'create_lead')             return respond(201, await createLead(sb, body));
      if (action === 'create_referral_source')  return respond(201, await createReferralSource(sb, body));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (method === 'PATCH') {
      if (!id) return respond(400, { error: 'id required' });
      if (action === 'update_lead')             return respond(200, await updateLead(sb, id, body));
      if (action === 'update_status')           return respond(200, await updateStatus(sb, id, body));
      if (action === 'convert_lead')            return respond(200, await convertLead(sb, id, body));
      if (action === 'lose_lead')               return respond(200, await loseLead(sb, id, body));
      if (action === 'log_contact')             return respond(200, await logContact(sb, id, body));
      if (action === 'update_referral_source')  return respond(200, await updateReferralSource(sb, id, body));
      if (action === 'delete_lead')             return respond(200, await deleteLead(sb, id));
      if (action === 'delete_referral_source')  return respond(200, await deleteReferralSource(sb, id));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (err) {
    const status = (err && err.status) ? err.status : 500;
    const msg    = (err && err.message) ? err.message : String(err);
    if (status < 500) console.warn('[lead-pipeline]', method, action || section, status, msg);
    else              console.error('[lead-pipeline]', method, action || section, msg);
    return respond(status, { error: msg });
  }
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function getDashboard(sb) {
  const [allR, rsR] = await Promise.all([
    sb.from('leads').select('status, source, converted_revenue, created_at').is('deleted_at', null),
    sb.from('referral_sources').select('id, name, source_type, active'),
  ]);

  if (allR.error && isMissingTableError(allR.error)) return MIGRATION_WARN;
  if (allR.error) throw allR.error;

  const leads = allR.data || [];
  const total      = leads.length;
  const newLeads   = leads.filter(l => l.status === 'new').length;
  const active     = leads.filter(l => ['contacted','consultation','booked'].includes(l.status)).length;
  const converted  = leads.filter(l => l.status === 'converted').length;
  const lost       = leads.filter(l => l.status === 'lost').length;
  const convRate   = total > 0 ? Math.round((converted / total) * 100) : 0;
  const revenue    = leads.filter(l => l.status === 'converted').reduce((s, l) => s + (Number(l.converted_revenue) || 0), 0);

  const sourceCounts = {};
  for (const l of leads) {
    sourceCounts[l.source] = (sourceCounts[l.source] || 0) + 1;
  }

  return {
    kpis: {
      total_leads:       total,
      new_leads:         newLeads,
      active_leads:      active,
      converted_leads:   converted,
      lost_leads:        lost,
      conversion_rate:   convRate,
      referral_sources:  (rsR.data || []).filter(r => r.active).length,
      revenue_from_leads: revenue,
    },
    status_counts: {
      new: newLeads, contacted: leads.filter(l => l.status === 'contacted').length,
      consultation: leads.filter(l => l.status === 'consultation').length,
      booked: leads.filter(l => l.status === 'booked').length,
      converted, lost,
      archived: leads.filter(l => l.status === 'archived').length,
    },
    source_counts: sourceCounts,
  };
}

// ── Leads ─────────────────────────────────────────────────────────────────────

async function getLeads(sb, params) {
  let q = sb.from('leads').select(LEAD_COLS + ', referral_sources(name, source_type)')
    .is('deleted_at', null).order('created_at', { ascending: false });
  if (params.status)             q = q.eq('status', params.status);
  if (params.source)             q = q.eq('source', params.source);
  if (params.referral_source_id) q = q.eq('referral_source_id', params.referral_source_id);
  if (params.search) {
    q = q.or(`first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%,email.ilike.%${params.search}%`);
  }
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { ...MIGRATION_WARN, leads: [], count: 0 };
    throw error;
  }
  return { leads: data || [], count: (data || []).length };
}

async function createLead(sb, body) {
  const firstName = (body.first_name || '').trim();
  if (!firstName) throw Object.assign(new Error('first_name is required'), { status: 400 });
  const source = body.source || 'other';
  if (!VALID_SOURCES.includes(source))
    throw Object.assign(new Error('Invalid source: ' + source), { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const row = {
    first_name:         firstName,
    last_name:          body.last_name          || null,
    email:              body.email              || null,
    phone:              body.phone              || null,
    source,
    source_detail:      body.source_detail      || null,
    referral_source_id: body.referral_source_id || null,
    interested_service: body.interested_service || null,
    status:             body.status             || 'new',
    notes:              body.notes              || null,
    assigned_to:        body.assigned_to        || null,
    first_contact_date: body.first_contact_date || today,
    last_contact_date:  body.last_contact_date  || null,
    contact_count:      0,
  };
  if (!VALID_STATUSES.includes(row.status))
    throw Object.assign(new Error('Invalid status: ' + row.status), { status: 400 });

  const { data, error } = await sb.from('leads').insert(row).select(LEAD_COLS).single();
  if (error) {
    if (isMissingTableError(error)) return MIGRATION_WARN;
    throw error;
  }
  return { lead: data };
}

async function updateLead(sb, id, body) {
  const allowed = [
    'first_name','last_name','email','phone','source','source_detail',
    'referral_source_id','interested_service','notes','assigned_to',
    'first_contact_date','last_contact_date',
  ];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  if (!Object.keys(updates).length)
    throw Object.assign(new Error('No updatable fields'), { status: 400 });
  if (updates.source && !VALID_SOURCES.includes(updates.source))
    throw Object.assign(new Error('Invalid source: ' + updates.source), { status: 400 });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('leads').update(updates).eq('id', id).is('deleted_at', null).select(LEAD_COLS).single();
  if (error) throw error;
  return { lead: data };
}

async function updateStatus(sb, id, body) {
  const newStatus = body.status;
  if (!newStatus) throw Object.assign(new Error('status required'), { status: 400 });
  if (!VALID_STATUSES.includes(newStatus))
    throw Object.assign(new Error('Invalid status: ' + newStatus), { status: 400 });

  const { data, error } = await sb.from('leads')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(LEAD_COLS).single();
  if (error) throw error;
  return { lead: data };
}

async function convertLead(sb, id, body) {
  const now = new Date().toISOString();
  const updates = {
    status:             'converted',
    converted_at:       now,
    converted_client_id: body.converted_client_id || null,
    converted_service:  body.converted_service   || null,
    converted_revenue:  body.converted_revenue   !== undefined ? Number(body.converted_revenue) : null,
    updated_at:         now,
  };
  const { data, error } = await sb.from('leads').update(updates).eq('id', id).is('deleted_at', null).select(LEAD_COLS).single();
  if (error) throw error;

  // If a client_id is supplied, try to update clients.source to preserve attribution
  if (body.converted_client_id && body.source_attribution) {
    await sb.from('clients').update({ source: body.source_attribution }).eq('id', body.converted_client_id);
  }

  return { lead: data };
}

async function loseLead(sb, id, body) {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('leads')
    .update({ status: 'lost', notes: body.reason ? (body.notes || '') + '\nLost: ' + body.reason : undefined, updated_at: now })
    .eq('id', id).is('deleted_at', null).select(LEAD_COLS).single();
  if (error) throw error;
  return { lead: data };
}

async function logContact(sb, id, body) {
  const today = new Date().toISOString().slice(0, 10);
  // Increment contact_count via rpc if available, or read-modify-write
  const { data: existing, error: fetchErr } = await sb.from('leads').select('contact_count').eq('id', id).single();
  if (fetchErr) throw fetchErr;
  const updates = {
    contact_count:    (existing.contact_count || 0) + 1,
    last_contact_date: body.contact_date || today,
    updated_at:        new Date().toISOString(),
  };
  if (body.notes_append) updates.notes = body.notes_append;
  const { data, error } = await sb.from('leads').update(updates).eq('id', id).is('deleted_at', null).select(LEAD_COLS).single();
  if (error) throw error;
  return { lead: data };
}

async function deleteLead(sb, id) {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('leads')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}

// ── Referral Sources ──────────────────────────────────────────────────────────

async function getReferralSources(sb, params) {
  let q = sb.from('referral_sources').select(RS_COLS).order('name', { ascending: true });
  if (params.active !== undefined) q = q.eq('active', params.active === 'true');
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { ...MIGRATION_WARN, referral_sources: [], count: 0 };
    throw error;
  }
  return { referral_sources: data || [], count: (data || []).length };
}

async function createReferralSource(sb, body) {
  const name = (body.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  const sourceType = body.source_type || 'other';
  if (!VALID_RS_TYPES.includes(sourceType))
    throw Object.assign(new Error('Invalid source_type: ' + sourceType), { status: 400 });

  const row = {
    name,
    source_type:  sourceType,
    contact_info: body.contact_info || null,
    notes:        body.notes        || null,
    active:       body.active !== undefined ? Boolean(body.active) : true,
  };
  const { data, error } = await sb.from('referral_sources').insert(row).select(RS_COLS).single();
  if (error) {
    if (isMissingTableError(error)) return MIGRATION_WARN;
    throw error;
  }
  return { referral_source: data };
}

async function updateReferralSource(sb, id, body) {
  const allowed = ['name','source_type','contact_info','notes','active'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  if (!Object.keys(updates).length)
    throw Object.assign(new Error('No updatable fields'), { status: 400 });
  if (updates.source_type && !VALID_RS_TYPES.includes(updates.source_type))
    throw Object.assign(new Error('Invalid source_type: ' + updates.source_type), { status: 400 });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('referral_sources').update(updates).eq('id', id).select(RS_COLS).single();
  if (error) throw error;
  return { referral_source: data };
}

async function deleteReferralSource(sb, id) {
  const { data, error } = await sb.from('referral_sources').delete().eq('id', id).select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function getPipeline(sb) {
  const { data, error } = await sb.from('leads')
    .select(LEAD_COLS + ', referral_sources(name)')
    .is('deleted_at', null)
    .not('status', 'in', '("converted","lost","archived")')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { ...MIGRATION_WARN, pipeline: {} };
    throw error;
  }
  const leads = data || [];
  const pipeline = { new: [], contacted: [], consultation: [], booked: [] };
  for (const l of leads) {
    if (pipeline[l.status]) pipeline[l.status].push(l);
  }
  return { pipeline, total: leads.length };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

async function getAnalytics(sb) {
  const [leadsR, rsR] = await Promise.all([
    sb.from('leads').select('status, source, referral_source_id, converted_revenue, converted_at, first_contact_date, referral_sources(name, source_type)').is('deleted_at', null),
    sb.from('referral_sources').select('id, name, source_type'),
  ]);
  if (leadsR.error) {
    if (isMissingTableError(leadsR.error)) return { ...MIGRATION_WARN, analytics: {} };
    throw leadsR.error;
  }

  const leads     = leadsR.data || [];
  const total     = leads.length;
  const converted = leads.filter(l => l.status === 'converted');
  const lost      = leads.filter(l => l.status === 'lost');

  // Conversion rate
  const convRate = total > 0 ? (converted.length / total * 100).toFixed(1) : '0.0';

  // Revenue per lead
  const totalRev = converted.reduce((s, l) => s + (Number(l.converted_revenue) || 0), 0);
  const revPerLead = total > 0 ? (totalRev / total).toFixed(2) : '0.00';

  // Average time to convert (days)
  const convertTimes = converted
    .filter(l => l.converted_at && l.first_contact_date)
    .map(l => (new Date(l.converted_at) - new Date(l.first_contact_date)) / 86400000);
  const avgConvertDays = convertTimes.length > 0
    ? (convertTimes.reduce((a, b) => a + b, 0) / convertTimes.length).toFixed(1)
    : null;

  // Revenue by source
  const bySource = {};
  for (const l of leads) {
    if (!bySource[l.source]) bySource[l.source] = { leads: 0, clients: 0, revenue: 0 };
    bySource[l.source].leads++;
    if (l.status === 'converted') {
      bySource[l.source].clients++;
      bySource[l.source].revenue += Number(l.converted_revenue) || 0;
    }
  }

  // Revenue by referral source
  const byReferralSource = {};
  for (const l of leads) {
    if (!l.referral_source_id) continue;
    const rsName = (l.referral_sources && l.referral_sources.name) || l.referral_source_id;
    if (!byReferralSource[rsName]) byReferralSource[rsName] = { leads: 0, clients: 0, revenue: 0 };
    byReferralSource[rsName].leads++;
    if (l.status === 'converted') {
      byReferralSource[rsName].clients++;
      byReferralSource[rsName].revenue += Number(l.converted_revenue) || 0;
    }
  }

  return {
    analytics: {
      total_leads:          total,
      converted_leads:      converted.length,
      lost_leads:           lost.length,
      conversion_rate_pct:  convRate,
      total_revenue:        totalRev.toFixed(2),
      revenue_per_lead:     revPerLead,
      avg_days_to_convert:  avgConvertDays,
      lost_opportunity_rate: total > 0 ? (lost.length / total * 100).toFixed(1) : '0.0',
      by_source:            bySource,
      by_referral_source:   byReferralSource,
    },
  };
}

// ── Lost opportunities ────────────────────────────────────────────────────────

async function getLost(sb) {
  const { data, error } = await sb.from('leads')
    .select(LEAD_COLS)
    .is('deleted_at', null)
    .in('status', ['lost', 'archived'])
    .order('updated_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { ...MIGRATION_WARN, leads: [], count: 0 };
    throw error;
  }
  return { leads: data || [], count: (data || []).length };
}
