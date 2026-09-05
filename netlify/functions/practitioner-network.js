// practitioner-network.js — Royal Energy Alchemy Practitioner Network
//
// GET  ?section=dashboard              → KPIs
// GET  ?section=applications           → application list (?status=)
// GET  ?section=practitioners          → practitioner list (?status= &search= &specialty= &certification_level=)
// GET  ?section=certifications         → cert assignments (?practitioner_id=)
// GET  ?section=referrals              → referral list (?status= &practitioner_id=)
// GET  ?section=directory              → visible directory (?search= &specialty= &location=)
// POST ?action=create_application      → create practitioner + application
// POST ?action=create_practitioner     → create practitioner directly
// POST ?action=assign_certification    → link practitioner to training cert
// POST ?action=create_referral         → create client routing referral
// PATCH ?action=update_application&id= → edit application
// PATCH ?action=approve_application&id=→ status → approved (also sets practitioner.status=approved)
// PATCH ?action=reject_application&id= → status → rejected
// PATCH ?action=update_practitioner&id=→ edit practitioner fields
// PATCH ?action=suspend_practitioner&id=→ status → suspended
// PATCH ?action=activate_practitioner&id=→ status → active
// PATCH ?action=renew_certification&id= → update expiration_date, status=active
// PATCH ?action=expire_certification&id= → status → expired
// PATCH ?action=accept_referral&id=    → status → accepted
// PATCH ?action=complete_referral&id=  → status → completed
// PATCH ?action=decline_referral&id=   → status → declined
// PATCH ?action=delete_practitioner&id=→ soft delete
// PATCH ?action=delete_application&id= → soft delete
// PATCH ?action=delete_referral&id=    → soft delete

const { createClient } = require('@supabase/supabase-js');
const auth             = require('./lib/auth');

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function isMissingTableError(err) {
  if (!err) return false;
  const msg = (err.message || '') + (err.code || '') + (err.details || '') + (err.hint || '');
  return (
    err.code === '42P01' ||
    err.code === 'PGRST204' ||
    err.code === 'PGRST200' ||
    err.code === 'PGRST116' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

const VALID_STATUSES      = ['applied','review','approved','active','suspended','archived'];
const VALID_CERT_LEVELS   = ['none','foundation','practitioner','advanced','master'];
const VALID_APP_STATUSES  = ['pending','review','approved','rejected','withdrawn'];
const VALID_CERT_STATUSES = ['active','expired','revoked','pending'];
const VALID_REF_STATUSES  = ['pending','accepted','completed','declined','archived'];

const PRAC_COLS = 'id, name, email, phone, location, specialties, bio, status, application_date, approval_date, certification_level, directory_visible, created_at, updated_at';
const APP_COLS  = 'id, practitioner_id, application_text, experience, training_history, reference_notes, review_notes, status, created_at, updated_at';
const CERT_COLS = 'id, practitioner_id, training_certification_id, completion_date, expiration_date, status, created_at, updated_at';
const REF_COLS  = 'id, client_id, practitioner_id, reason, status, created_at, updated_at';

async function requireAdmin(event) {
  const a = await auth.requireAdmin(event);
  if (a && a.error) return { error: a.error };
  return a || {};
}

exports.handler = async function (event) {
  const authResult = await requireAdmin(event);
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
      if (section === 'dashboard')     return respond(200, await getDashboard(sb));
      if (section === 'applications')  return respond(200, await getApplications(sb, params));
      if (section === 'practitioners') return respond(200, await getPractitioners(sb, params));
      if (section === 'certifications')return respond(200, await getCertifications(sb, params));
      if (section === 'referrals')     return respond(200, await getReferrals(sb, params));
      if (section === 'directory')     return respond(200, await getDirectory(sb, params));
      return respond(400, { error: 'Unknown section: ' + section });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (action === 'create_application')  return respond(201, await createApplication(sb, body, authResult));
      if (action === 'create_practitioner') return respond(201, await createPractitioner(sb, body, authResult));
      if (action === 'assign_certification')return respond(201, await assignCertification(sb, body, authResult));
      if (action === 'create_referral')     return respond(201, await createReferral(sb, body, authResult));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (method === 'PATCH') {
      if (!id) return respond(400, { error: 'id required' });
      if (action === 'update_application')    return respond(200, await updateApplication(sb, id, body));
      if (action === 'approve_application')   return respond(200, await approveApplication(sb, id, body));
      if (action === 'reject_application')    return respond(200, await rejectApplication(sb, id));
      if (action === 'update_practitioner')   return respond(200, await updatePractitioner(sb, id, body));
      if (action === 'suspend_practitioner')  return respond(200, await transitionPractitioner(sb, id, 'suspended'));
      if (action === 'activate_practitioner') return respond(200, await transitionPractitioner(sb, id, 'active'));
      if (action === 'renew_certification')   return respond(200, await renewCertification(sb, id, body));
      if (action === 'expire_certification')  return respond(200, await expireCertification(sb, id));
      if (action === 'accept_referral')       return respond(200, await transitionReferral(sb, id, 'accepted'));
      if (action === 'complete_referral')     return respond(200, await transitionReferral(sb, id, 'completed'));
      if (action === 'decline_referral')      return respond(200, await transitionReferral(sb, id, 'declined'));
      if (action === 'delete_practitioner')   return respond(200, await softDelete(sb, 'practitioners', id));
      if (action === 'delete_application')    return respond(200, await softDelete(sb, 'practitioner_applications', id));
      if (action === 'delete_referral')       return respond(200, await softDelete(sb, 'practitioner_referrals', id));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    const status = (err && err.status) ? err.status : 500;
    const msg    = (err && err.message) ? err.message : String(err);
    if (status < 500) console.warn('[practitioner-network]', method, action || section, status, msg);
    else console.error('[practitioner-network]', method, action || section, msg);
    return respond(status, { error: msg });
  }
};

// ── Dashboard ────────────────────────────────────────────────────────────────

async function getDashboard(sb) {
  const [pracs, apps, certs, refs] = await Promise.all([
    sb.from('practitioners').select('status, directory_visible').is('deleted_at', null),
    sb.from('practitioner_applications').select('status').is('deleted_at', null),
    sb.from('practitioner_certifications').select('status').is('deleted_at', null),
    sb.from('practitioner_referrals').select('status').is('deleted_at', null),
  ]);

  if (pracs.error && isMissingTableError(pracs.error)) {
    return { migration_needed: true, _warn: 'Run migration 2026-06-13-practitioner-network.sql', kpis: {} };
  }

  const allPracs = pracs.data || [];
  const allApps  = apps.data  || [];
  const allCerts = certs.data || [];
  const allRefs  = refs.data  || [];

  return {
    kpis: {
      total_practitioners:   allPracs.length,
      pending_applications:  allApps.filter(a => a.status === 'pending').length,
      active_practitioners:  allPracs.filter(p => p.status === 'active').length,
      active_certifications: allCerts.filter(c => c.status === 'active').length,
      pending_referrals:     allRefs.filter(r => r.status === 'pending').length,
      directory_listings:    allPracs.filter(p => p.directory_visible && p.status === 'active').length,
    },
    practitioner_counts: {
      applied:   allPracs.filter(p => p.status === 'applied').length,
      review:    allPracs.filter(p => p.status === 'review').length,
      approved:  allPracs.filter(p => p.status === 'approved').length,
      active:    allPracs.filter(p => p.status === 'active').length,
      suspended: allPracs.filter(p => p.status === 'suspended').length,
    },
  };
}

// ── Applications ──────────────────────────────────────────────────────────────

async function getApplications(sb, params) {
  let q = sb.from('practitioner_applications').select(APP_COLS + ', practitioners(name, email, status)')
    .is('deleted_at', null).order('created_at', { ascending: false });
  if (params.status) q = q.eq('status', params.status);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { migration_needed: true, applications: [], count: 0 };
    throw error;
  }
  return { applications: data || [], count: (data || []).length };
}

async function createApplication(sb, body, auth) {
  const name = (body.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });

  // Create practitioner record first
  const pracRow = {
    name,
    email:  body.email  || null,
    phone:  body.phone  || null,
    location: body.location || null,
    specialties: body.specialties || [],
    bio:    body.bio    || null,
    status: 'applied',
    application_date: new Date().toISOString().slice(0, 10),
  };
  const { data: prac, error: pracErr } = await sb.from('practitioners').insert(pracRow).select(PRAC_COLS).single();
  if (pracErr) throw pracErr;

  // Create application record
  const appRow = {
    practitioner_id:  prac.id,
    application_text: body.application_text || null,
    experience:       body.experience       || null,
    training_history: body.training_history || null,
    reference_notes:  body.reference_notes  || null,
    status: 'pending',
  };
  const { data: app, error: appErr } = await sb.from('practitioner_applications').insert(appRow).select(APP_COLS).single();
  if (appErr) throw appErr;

  return { practitioner: prac, application: app };
}

async function updateApplication(sb, id, body) {
  const allowed = ['application_text','experience','training_history','reference_notes','review_notes','status'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  if (!Object.keys(updates).length) throw Object.assign(new Error('No updatable fields'), { status: 400 });
  if (updates.status && !VALID_APP_STATUSES.includes(updates.status))
    throw Object.assign(new Error('Invalid status: ' + updates.status), { status: 400 });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('practitioner_applications').update(updates).eq('id', id).is('deleted_at', null).select(APP_COLS).single();
  if (error) throw error;
  return { application: data };
}

async function approveApplication(sb, id, body) {
  // Update application status
  const { data: app, error: appErr } = await sb.from('practitioner_applications')
    .update({ status: 'approved', review_notes: body.review_notes || null, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(APP_COLS).single();
  if (appErr) throw appErr;

  // Advance practitioner to approved
  if (app && app.practitioner_id) {
    await sb.from('practitioners')
      .update({ status: 'approved', approval_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq('id', app.practitioner_id).is('deleted_at', null);
  }
  return { application: app };
}

async function rejectApplication(sb, id) {
  const { data, error } = await sb.from('practitioner_applications')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(APP_COLS).single();
  if (error) throw error;
  return { application: data };
}

// ── Practitioners ─────────────────────────────────────────────────────────────

async function getPractitioners(sb, params) {
  let q = sb.from('practitioners').select(PRAC_COLS).is('deleted_at', null).order('created_at', { ascending: false });
  if (params.status)              q = q.eq('status', params.status);
  if (params.certification_level) q = q.eq('certification_level', params.certification_level);
  if (params.search)              q = q.ilike('name', '%' + params.search + '%');
  if (params.specialty)           q = q.contains('specialties', [params.specialty]);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { migration_needed: true, practitioners: [], count: 0 };
    throw error;
  }
  return { practitioners: data || [], count: (data || []).length };
}

async function createPractitioner(sb, body, auth) {
  const name = (body.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  const status = body.status || 'applied';
  if (!VALID_STATUSES.includes(status)) throw Object.assign(new Error('Invalid status: ' + status), { status: 400 });
  const certLevel = body.certification_level || 'none';
  if (!VALID_CERT_LEVELS.includes(certLevel)) throw Object.assign(new Error('Invalid certification_level: ' + certLevel), { status: 400 });

  const row = {
    name,
    email:              body.email     || null,
    phone:              body.phone     || null,
    location:           body.location  || null,
    specialties:        body.specialties || [],
    bio:                body.bio       || null,
    status,
    certification_level: certLevel,
    directory_visible:  body.directory_visible || false,
    application_date:   new Date().toISOString().slice(0, 10),
  };
  const { data, error } = await sb.from('practitioners').insert(row).select(PRAC_COLS).single();
  if (error) throw error;
  return { practitioner: data };
}

async function updatePractitioner(sb, id, body) {
  const allowed = ['name','email','phone','location','specialties','bio','status','certification_level','directory_visible','approval_date'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  if (!Object.keys(updates).length) throw Object.assign(new Error('No updatable fields'), { status: 400 });
  if (updates.status && !VALID_STATUSES.includes(updates.status))
    throw Object.assign(new Error('Invalid status: ' + updates.status), { status: 400 });
  if (updates.certification_level && !VALID_CERT_LEVELS.includes(updates.certification_level))
    throw Object.assign(new Error('Invalid certification_level: ' + updates.certification_level), { status: 400 });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('practitioners').update(updates).eq('id', id).is('deleted_at', null).select(PRAC_COLS).single();
  if (error) throw error;
  return { practitioner: data };
}

async function transitionPractitioner(sb, id, newStatus) {
  const { data, error } = await sb.from('practitioners')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(PRAC_COLS).single();
  if (error) throw error;
  return { practitioner: data };
}

// ── Certifications ────────────────────────────────────────────────────────────

async function getCertifications(sb, params) {
  let q = sb.from('practitioner_certifications').select(CERT_COLS + ', practitioners(name, email)')
    .is('deleted_at', null).order('created_at', { ascending: false });
  if (params.practitioner_id) q = q.eq('practitioner_id', params.practitioner_id);
  if (params.status)          q = q.eq('status', params.status);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { migration_needed: true, certifications: [], count: 0 };
    throw error;
  }
  return { certifications: data || [], count: (data || []).length };
}

async function assignCertification(sb, body, auth) {
  const practitionerId = body.practitioner_id;
  if (!practitionerId) throw Object.assign(new Error('practitioner_id is required'), { status: 400 });

  const row = {
    practitioner_id:           practitionerId,
    training_certification_id: body.training_certification_id || null,
    completion_date:           body.completion_date  || null,
    expiration_date:           body.expiration_date  || null,
    status:                    body.status           || 'active',
  };
  if (!VALID_CERT_STATUSES.includes(row.status))
    throw Object.assign(new Error('Invalid status: ' + row.status), { status: 400 });

  const { data, error } = await sb.from('practitioner_certifications').insert(row).select(CERT_COLS).single();
  if (error) throw error;

  // Update practitioner certification_level if provided
  if (body.certification_level && VALID_CERT_LEVELS.includes(body.certification_level)) {
    await sb.from('practitioners')
      .update({ certification_level: body.certification_level, updated_at: new Date().toISOString() })
      .eq('id', practitionerId).is('deleted_at', null);
  }

  return { certification: data };
}

async function renewCertification(sb, id, body) {
  const updates = {
    status:          'active',
    expiration_date: body.expiration_date || null,
    updated_at:      new Date().toISOString(),
  };
  const { data, error } = await sb.from('practitioner_certifications').update(updates).eq('id', id).is('deleted_at', null).select(CERT_COLS).single();
  if (error) throw error;
  return { certification: data };
}

async function expireCertification(sb, id) {
  const { data, error } = await sb.from('practitioner_certifications')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(CERT_COLS).single();
  if (error) throw error;
  return { certification: data };
}

// ── Referrals ─────────────────────────────────────────────────────────────────

async function getReferrals(sb, params) {
  let q = sb.from('practitioner_referrals').select(REF_COLS + ', practitioners(name)')
    .is('deleted_at', null).order('created_at', { ascending: false });
  if (params.status)          q = q.eq('status', params.status);
  if (params.practitioner_id) q = q.eq('practitioner_id', params.practitioner_id);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { migration_needed: true, referrals: [], count: 0 };
    throw error;
  }
  return { referrals: data || [], count: (data || []).length };
}

async function createReferral(sb, body, auth) {
  const practitionerId = body.practitioner_id;
  if (!practitionerId) throw Object.assign(new Error('practitioner_id is required'), { status: 400 });

  const row = {
    client_id:       body.client_id || null,
    practitioner_id: practitionerId,
    reason:          body.reason    || null,
    status:          'pending',
  };
  const { data, error } = await sb.from('practitioner_referrals').insert(row).select(REF_COLS).single();
  if (error) throw error;
  return { referral: data };
}

async function transitionReferral(sb, id, newStatus) {
  const { data, error } = await sb.from('practitioner_referrals')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select(REF_COLS).single();
  if (error) throw error;
  return { referral: data };
}

// ── Directory ─────────────────────────────────────────────────────────────────

async function getDirectory(sb, params) {
  let q = sb.from('practitioners').select(PRAC_COLS)
    .is('deleted_at', null).eq('directory_visible', true).eq('status', 'active')
    .order('name', { ascending: true });
  if (params.search)    q = q.ilike('name', '%' + params.search + '%');
  if (params.specialty) q = q.contains('specialties', [params.specialty]);
  if (params.location)  q = q.ilike('location', '%' + params.location + '%');
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { migration_needed: true, practitioners: [], count: 0 };
    throw error;
  }
  return { practitioners: data || [], count: (data || []).length };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function softDelete(sb, table, id) {
  const { data, error } = await sb.from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}
