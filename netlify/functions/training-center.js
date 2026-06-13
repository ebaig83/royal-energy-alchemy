// training-center.js — Royal Energy Alchemy Training Center
//
// GET  ?section=dashboard          → KPIs
// GET  ?section=modules            → list modules (?type=&difficulty=&status=&search=)
// GET  ?section=paths              → list learning paths (?type=&status=)
// GET  ?section=certifications     → list certifications (?status=)
// GET  ?section=resources          → KB + RN + drafts available as source material
// POST ?action=create_module       → create module (manual)
// POST ?action=generate_module     → generate module from KB/RN/draft source
// PATCH ?action=update_module&id=  → edit title/summary/content/objectives/etc.
// PATCH ?action=review_module&id=  → status → review
// PATCH ?action=approve_module&id= → status → approved
// PATCH ?action=publish_module&id= → status → published
// PATCH ?action=archive_module&id= → status → archived
// PATCH ?action=delete_module&id=  → soft delete
// POST  ?action=create_path        → create learning path
// PATCH ?action=update_path&id=    → edit path
// PATCH ?action=delete_path&id=    → soft delete path
// POST  ?action=create_cert        → create certification
// PATCH ?action=update_cert&id=    → edit certification
// PATCH ?action=delete_cert&id=    → soft delete certification

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

const VALID_MODULE_TYPES = ['onboarding','practitioner','client','workshop','certification','continuing_education'];
const VALID_DIFFICULTIES = ['beginner','intermediate','advanced'];
const VALID_STATUSES     = ['draft','review','approved','published','archived'];
const VALID_PATH_TYPES   = ['practitioner','client','certification','workshop'];

const MODULE_COLS = 'id, title, summary, module_type, source_ids, content_draft_id, difficulty_level, estimated_duration, status, learning_objectives, key_concepts, discussion_questions, module_content, created_by, created_at, updated_at';
const PATH_COLS   = 'id, title, description, path_type, module_ids, status, estimated_duration, created_by, created_at, updated_at';
const CERT_COLS   = 'id, title, description, required_modules, status, created_by, created_at, updated_at';

exports.handler = async function (event) {
  const authResult = requireAdmin(event);
  if (authResult.error) return authResult.error;

  const ip = event.headers['x-forwarded-for'] || 'unknown';
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
    // ── GET routes ──────────────────────────────────────────────────────────
    if (method === 'GET') {
      if (section === 'dashboard')     return respond(200, await getDashboard(sb));
      if (section === 'modules')       return respond(200, await getModules(sb, params));
      if (section === 'paths')         return respond(200, await getPaths(sb, params));
      if (section === 'certifications')return respond(200, await getCertifications(sb, params));
      if (section === 'resources')     return respond(200, await getResources(sb));
      return respond(400, { error: 'Unknown section: ' + section });
    }

    // ── POST routes ─────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (action === 'create_module')   return respond(201, await createModule(sb, body, authResult, ip));
      if (action === 'generate_module') return respond(201, await generateModule(sb, body, authResult, ip));
      if (action === 'create_path')     return respond(201, await createPath(sb, body, authResult, ip));
      if (action === 'create_cert')     return respond(201, await createCert(sb, body, authResult, ip));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    // ── PATCH routes ────────────────────────────────────────────────────────
    if (method === 'PATCH') {
      if (!id) return respond(400, { error: 'id required' });
      if (action === 'update_module')  return respond(200, await updateModule(sb, id, body, authResult, ip));
      if (action === 'review_module')  return respond(200, await transitionModule(sb, id, 'review',    authResult, ip));
      if (action === 'approve_module') return respond(200, await transitionModule(sb, id, 'approved',  authResult, ip));
      if (action === 'publish_module') return respond(200, await transitionModule(sb, id, 'published', authResult, ip));
      if (action === 'archive_module') return respond(200, await transitionModule(sb, id, 'archived',  authResult, ip));
      if (action === 'delete_module')  return respond(200, await deleteModule(sb, id, authResult, ip));
      if (action === 'update_path')    return respond(200, await updatePath(sb, id, body, authResult, ip));
      if (action === 'delete_path')    return respond(200, await deletePath(sb, id, authResult, ip));
      if (action === 'update_cert')    return respond(200, await updateCert(sb, id, body, authResult, ip));
      if (action === 'delete_cert')    return respond(200, await deleteCert(sb, id, authResult, ip));
      return respond(400, { error: 'Unknown action: ' + action });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    const status = (err && err.status) ? err.status : 500;
    const msg    = (err && err.message) ? err.message : String(err);
    if (status < 500) console.warn('[training-center]', method, action || section, status, msg);
    else console.error('[training-center]', method, action || section, msg);
    return respond(status, { error: msg });
  }
};

function requireAdmin(event) {
  const a = auth.requireAdmin(event);
  if (a && a.error) return { error: a.error };
  return a || {};
}

// ── Dashboard ────────────────────────────────────────────────────────────────

async function getDashboard(sb) {
  try {
    const [mods, paths, certs] = await Promise.all([
      sb.from('training_modules').select('status').is('deleted_at', null),
      sb.from('learning_paths').select('status').is('deleted_at', null),
      sb.from('certifications').select('status').is('deleted_at', null),
    ]);

    if (mods.error && isMissingTableError(mods.error)) {
      return { migration_needed: true, _warn: 'Run migration 2026-06-13-training-center.sql', kpis: { total: 0, published: 0, certifications: 0, learning_paths: 0, draft: 0 } };
    }

    const allMods  = mods.data  || [];
    const allPaths = paths.data || [];
    const allCerts = certs.data || [];

    return {
      kpis: {
        total:          allMods.length,
        published:      allMods.filter(m => m.status === 'published').length,
        certifications: allCerts.filter(c => c.status !== 'archived').length,
        learning_paths: allPaths.filter(p => p.status !== 'archived').length,
        draft:          allMods.filter(m => m.status === 'draft').length,
      },
      module_counts: {
        draft:     allMods.filter(m => m.status === 'draft').length,
        review:    allMods.filter(m => m.status === 'review').length,
        approved:  allMods.filter(m => m.status === 'approved').length,
        published: allMods.filter(m => m.status === 'published').length,
        archived:  allMods.filter(m => m.status === 'archived').length,
      },
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Modules ──────────────────────────────────────────────────────────────────

async function getModules(sb, params) {
  try {
    let q = sb.from('training_modules').select(MODULE_COLS).is('deleted_at', null).order('created_at', { ascending: false });
    if (params.status)     q = q.eq('status', params.status);
    if (params.type)       q = q.eq('module_type', params.type);
    if (params.difficulty) q = q.eq('difficulty_level', params.difficulty);
    if (params.search)     q = q.ilike('title', '%' + params.search + '%');

    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { migration_needed: true, modules: [], count: 0 };
      throw error;
    }
    return { modules: data || [], count: (data || []).length };
  } catch (e) {
    return { error: e.message, modules: [], count: 0 };
  }
}

// ── Learning Paths ────────────────────────────────────────────────────────────

async function getPaths(sb, params) {
  try {
    let q = sb.from('learning_paths').select(PATH_COLS).is('deleted_at', null).order('created_at', { ascending: false });
    if (params.status) q = q.eq('status', params.status);
    if (params.type)   q = q.eq('path_type', params.type);

    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { migration_needed: true, paths: [], count: 0 };
      throw error;
    }
    return { paths: data || [], count: (data || []).length };
  } catch (e) {
    return { error: e.message, paths: [], count: 0 };
  }
}

// ── Certifications ────────────────────────────────────────────────────────────

async function getCertifications(sb, params) {
  try {
    let q = sb.from('certifications').select(CERT_COLS).is('deleted_at', null).order('created_at', { ascending: false });
    if (params.status) q = q.eq('status', params.status);

    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { migration_needed: true, certifications: [], count: 0 };
      throw error;
    }
    return { certifications: data || [], count: (data || []).length };
  } catch (e) {
    return { error: e.message, certifications: [], count: 0 };
  }
}

// ── Resources ─────────────────────────────────────────────────────────────────

async function getResources(sb) {
  try {
    const [kb, rn, drafts] = await Promise.all([
      sb.from('kb_entries').select('id, title, summary, category, tags, status').is('deleted_at', null).eq('status', 'published').order('created_at', { ascending: false }),
      sb.from('research_notes').select('id, title, summary, tags').is('deleted_at', null).order('created_at', { ascending: false }),
      sb.from('content_drafts').select('id, title, content_type, status, source_ids').is('deleted_at', null).in('status', ['approved','published']).order('created_at', { ascending: false }),
    ]);

    return {
      kb_entries:      (kb.data    || []),
      research_notes:  (rn.data    || []),
      content_drafts:  (drafts.data|| []),
      kb_count:        (kb.data    || []).length,
      rn_count:        (rn.data    || []).length,
      draft_count:     (drafts.data|| []).length,
    };
  } catch (e) {
    return { error: e.message, kb_entries: [], research_notes: [], content_drafts: [], kb_count: 0, rn_count: 0, draft_count: 0 };
  }
}

// ── Create Module ─────────────────────────────────────────────────────────────

async function createModule(sb, body, auth, ip) {
  const title    = (body.title || '').trim();
  const mtype    = body.module_type    || 'onboarding';
  const diff     = body.difficulty_level || 'beginner';
  const status   = body.status         || 'draft';

  if (!title)                         throw Object.assign(new Error('title is required'), { status: 400 });
  if (!VALID_MODULE_TYPES.includes(mtype)) throw Object.assign(new Error('Invalid module_type: ' + mtype), { status: 400 });
  if (!VALID_DIFFICULTIES.includes(diff))  throw Object.assign(new Error('Invalid difficulty_level: ' + diff), { status: 400 });

  const row = {
    title,
    summary:             body.summary          || null,
    module_type:         mtype,
    source_ids:          body.source_ids        || [],
    content_draft_id:    body.content_draft_id  || null,
    difficulty_level:    diff,
    estimated_duration:  body.estimated_duration || null,
    status,
    learning_objectives: body.learning_objectives || [],
    key_concepts:        body.key_concepts        || [],
    discussion_questions:body.discussion_questions|| [],
    module_content:      body.module_content      || null,
    created_by:          (auth && auth.user) || 'daron',
  };

  const { data, error } = await sb.from('training_modules').insert(row).select(MODULE_COLS).single();
  if (error) throw error;
  return { module: data };
}

// ── Generate Module from Sources ──────────────────────────────────────────────

async function generateModule(sb, body, auth, ip) {
  const sourceType = body.source_type || 'kb';  // 'kb' | 'rn' | 'draft'
  const sourceId   = body.source_id   || null;
  const mtype      = body.module_type || 'practitioner';
  const diff       = body.difficulty_level || 'beginner';

  if (!sourceId) throw Object.assign(new Error('source_id is required'), { status: 400 });
  if (!VALID_MODULE_TYPES.includes(mtype)) throw Object.assign(new Error('Invalid module_type'), { status: 400 });

  // Fetch the source
  let sourceTitle = '', sourceContent = '', sourceTags = [], sourceSummary = '', draftId = null;
  if (sourceType === 'kb') {
    const { data, error } = await sb.from('kb_entries').select('id, title, summary, category, tags').eq('id', sourceId).single();
    if (error || !data) throw Object.assign(new Error('KB entry not found: ' + sourceId), { status: 404 });
    sourceTitle   = data.title;
    sourceSummary = data.summary || '';
    sourceTags    = data.tags    || [];
    sourceContent = data.summary || '';
  } else if (sourceType === 'rn') {
    const { data, error } = await sb.from('research_notes').select('id, title, summary, tags').eq('id', sourceId).single();
    if (error || !data) throw Object.assign(new Error('Research note not found: ' + sourceId), { status: 404 });
    sourceTitle   = data.title;
    sourceSummary = data.summary || '';
    sourceTags    = data.tags    || [];
    sourceContent = data.summary || '';
  } else if (sourceType === 'draft') {
    const { data, error } = await sb.from('content_drafts').select('id, title, content_type, draft_content, source_ids').eq('id', sourceId).is('deleted_at', null).single();
    if (error || !data) throw Object.assign(new Error('Content draft not found: ' + sourceId), { status: 404 });
    sourceTitle   = data.title;
    sourceContent = data.draft_content || '';
    draftId       = data.id;
  }

  const generated = buildModuleContent(sourceTitle, sourceContent, sourceSummary, sourceTags, mtype, diff);
  const sourceEntry = [{ table: sourceType === 'kb' ? 'kb_entries' : sourceType === 'rn' ? 'research_notes' : 'content_drafts', id: sourceId, title: sourceTitle }];

  const row = {
    title:               generated.title,
    summary:             generated.summary,
    module_type:         mtype,
    source_ids:          sourceEntry,
    content_draft_id:    draftId,
    difficulty_level:    diff,
    estimated_duration:  generated.estimated_duration,
    status:              'draft',
    learning_objectives: generated.learning_objectives,
    key_concepts:        generated.key_concepts,
    discussion_questions:generated.discussion_questions,
    module_content:      generated.module_content,
    created_by:          (auth && auth.user) || 'daron',
  };

  const { data, error } = await sb.from('training_modules').insert(row).select(MODULE_COLS).single();
  if (error) throw error;
  return { module: data, generation_source: { type: sourceType, id: sourceId, title: sourceTitle } };
}

function buildModuleContent(title, content, summary, tags, mtype, diff) {
  const typeLabel   = { onboarding: 'Onboarding', practitioner: 'Practitioner', client: 'Client Education', workshop: 'Workshop', certification: 'Certification', continuing_education: 'Continuing Education' }[mtype] || mtype;
  const diffLabel   = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }[diff] || diff;
  const duration    = { beginner: 30, intermediate: 60, advanced: 90 }[diff] || 45;

  const topTags     = (tags || []).slice(0, 5);
  const tagBlock    = topTags.length ? '\n\nKey Topics: ' + topTags.join(', ') : '';

  const objectives  = [
    'Understand the foundational concepts of ' + title,
    'Apply ' + title.toLowerCase() + ' principles in practice',
    'Demonstrate comprehension of key protocols',
    'Evaluate personal energy alignment using learned techniques',
  ];

  const concepts    = topTags.length
    ? topTags.map(t => ({ term: t, definition: 'Core concept related to ' + t + ' within the Royal Energy Alchemy framework.' }))
    : [
        { term: 'Energy Alignment', definition: 'The practice of bringing the body\'s energy systems into harmonious balance.' },
        { term: 'Protocol Application', definition: 'Systematic application of healing protocols to achieve intended outcomes.' },
        { term: 'Practitioner Awareness', definition: 'Cultivating presence and sensitivity to energetic states.' },
      ];

  const questions   = [
    'How does ' + title + ' connect to the broader Royal Energy Alchemy framework?',
    'What personal experiences have you had with the concepts in this module?',
    'How would you explain these principles to a new client?',
    'What challenges might arise when applying these techniques, and how would you address them?',
  ];

  const moduleContent = [
    '# ' + typeLabel + ' Module: ' + title,
    '',
    '**Difficulty:** ' + diffLabel + '  |  **Duration:** ' + duration + ' minutes',
    '',
    '## Overview',
    summary || content || ('This module explores ' + title + ' within the Royal Energy Alchemy framework.'),
    tagBlock,
    '',
    '## Learning Objectives',
    objectives.map((o, i) => (i + 1) + '. ' + o).join('\n'),
    '',
    '## Key Concepts',
    concepts.map(c => '**' + c.term + '**: ' + c.definition).join('\n\n'),
    '',
    '## Module Content',
    content || summary || ('Detailed exploration of ' + title + ' — expand with practitioner knowledge, case examples, and protocol steps.'),
    '',
    '## Discussion Questions',
    questions.map((q, i) => (i + 1) + '. ' + q).join('\n'),
    '',
    '## Recommended Resources',
    '- Review related Knowledge Base articles',
    '- Practice sessions with a supervisor or peer',
    '- Journal reflections after each practice',
    '',
    '---',
    '_Generated by Royal Energy Alchemy Training Center. Review and expand before publishing._',
  ].join('\n');

  return {
    title:               typeLabel + ': ' + title,
    summary:             summary || ('A ' + diffLabel.toLowerCase() + '-level ' + typeLabel.toLowerCase() + ' module covering ' + title + '.'),
    estimated_duration:  duration,
    learning_objectives: objectives,
    key_concepts:        concepts,
    discussion_questions:questions,
    module_content:      moduleContent,
  };
}

// ── Update / Transition / Delete Module ──────────────────────────────────────

async function updateModule(sb, id, body, auth, ip) {
  const allowed = ['title','summary','module_type','difficulty_level','estimated_duration','learning_objectives','key_concepts','discussion_questions','module_content','source_ids','content_draft_id'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  if (!Object.keys(updates).length) throw Object.assign(new Error('No updatable fields provided'), { status: 400 });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('training_modules').update(updates).eq('id', id).is('deleted_at', null).select(MODULE_COLS).single();
  if (error) throw error;
  return { module: data };
}

async function transitionModule(sb, id, newStatus, auth, ip) {
  const { data, error } = await sb.from('training_modules')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null)
    .select(MODULE_COLS).single();
  if (error) throw error;
  return { module: data };
}

async function deleteModule(sb, id, auth, ip) {
  const { data, error } = await sb.from('training_modules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).is('deleted_at', null)
    .select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}

// ── Learning Path CRUD ────────────────────────────────────────────────────────

async function createPath(sb, body, auth, ip) {
  const title = (body.title || '').trim();
  const ptype = body.path_type || 'practitioner';
  if (!title) throw Object.assign(new Error('title is required'), { status: 400 });
  if (!VALID_PATH_TYPES.includes(ptype)) throw Object.assign(new Error('Invalid path_type: ' + ptype), { status: 400 });

  const row = {
    title,
    description:        body.description        || null,
    path_type:          ptype,
    module_ids:         body.module_ids          || [],
    status:             body.status              || 'draft',
    estimated_duration: body.estimated_duration  || null,
    created_by:         (auth && auth.user)      || 'daron',
  };
  const { data, error } = await sb.from('learning_paths').insert(row).select(PATH_COLS).single();
  if (error) throw error;
  return { path: data };
}

async function updatePath(sb, id, body, auth, ip) {
  const allowed = ['title','description','path_type','module_ids','status','estimated_duration'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('learning_paths').update(updates).eq('id', id).is('deleted_at', null).select(PATH_COLS).single();
  if (error) throw error;
  return { path: data };
}

async function deletePath(sb, id, auth, ip) {
  const { data, error } = await sb.from('learning_paths').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}

// ── Certification CRUD ────────────────────────────────────────────────────────

async function createCert(sb, body, auth, ip) {
  const title = (body.title || '').trim();
  if (!title) throw Object.assign(new Error('title is required'), { status: 400 });

  const row = {
    title,
    description:      body.description      || null,
    required_modules: body.required_modules  || [],
    status:           body.status            || 'draft',
    created_by:       (auth && auth.user)    || 'daron',
  };
  const { data, error } = await sb.from('certifications').insert(row).select(CERT_COLS).single();
  if (error) throw error;
  return { certification: data };
}

async function updateCert(sb, id, body, auth, ip) {
  const allowed = ['title','description','required_modules','status'];
  const updates = {};
  allowed.forEach(k => { if (k in body) updates[k] = body[k]; });
  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('certifications').update(updates).eq('id', id).is('deleted_at', null).select(CERT_COLS).single();
  if (error) throw error;
  return { certification: data };
}

async function deleteCert(sb, id, auth, ip) {
  const { data, error } = await sb.from('certifications').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id').single();
  if (error) throw error;
  return { deleted: true, id };
}
