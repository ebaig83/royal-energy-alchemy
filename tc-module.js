(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  var MODULE_TYPES = [
    { value: 'onboarding',           label: 'Onboarding' },
    { value: 'practitioner',         label: 'Practitioner' },
    { value: 'client',               label: 'Client Education' },
    { value: 'workshop',             label: 'Workshop' },
    { value: 'certification',        label: 'Certification' },
    { value: 'continuing_education', label: 'Continuing Education' },
  ];
  var DIFFICULTY_LEVELS = [
    { value: 'beginner',     label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced',     label: 'Advanced' },
  ];
  var PATH_TYPES = [
    { value: 'practitioner',  label: 'Practitioner' },
    { value: 'client',        label: 'Client' },
    { value: 'certification', label: 'Certification' },
    { value: 'workshop',      label: 'Workshop' },
  ];
  var TYPE_COLORS = {
    onboarding:           '#7c6f9a',
    practitioner:         '#2e7d32',
    client:               '#1565c0',
    workshop:             '#e65100',
    certification:        '#6a1b9a',
    continuing_education: '#00695c',
  };
  var DIFF_COLORS = { beginner: '#388e3c', intermediate: '#f57c00', advanced: '#c62828' };

  // ── Auth / request helper ─────────────────────────────────────────────────
  function tok() { return sessionStorage.getItem('rea_api_token') || ''; }

  function tcReq(method, url, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': tok() } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmt(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch { return ts; } }
  function shimmer(n) {
    var s = '<div class="tc-shimmer-row">' + Array(4).join('<div class="tc-shimmer-cell"></div>') + '</div>';
    var out = '<div class="tc-shimmer">';
    for (var i = 0; i < (n||3); i++) out += s;
    return out + '</div>';
  }
  function toast(msg, isErr) {
    var el = document.createElement('div');
    el.className = 'tc-toast' + (isErr ? ' tc-toast-err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }
  function typeBadge(t) {
    var label = (MODULE_TYPES.find(function(x){return x.value===t;})||{label:t}).label;
    var color = TYPE_COLORS[t] || '#7a7060';
    return '<span class="tc-type-badge" style="background:' + color + '20;color:' + color + ';border-color:' + color + '40">' + esc(label) + '</span>';
  }
  function diffBadge(d) {
    var label = (DIFFICULTY_LEVELS.find(function(x){return x.value===d;})||{label:d}).label;
    var color = DIFF_COLORS[d] || '#7a7060';
    return '<span class="tc-diff-badge" style="background:' + color + '18;color:' + color + ';border-color:' + color + '35">' + esc(label) + '</span>';
  }
  function statusBadge(s) {
    var colors = { draft:'#7a7060', review:'#1976d2', approved:'#2e7d32', published:'#6a1b9a', archived:'#424242' };
    return '<span class="tc-status-badge" style="background:' + (colors[s]||'#7a7060') + '">' + esc((s||'').toUpperCase()) + '</span>';
  }
  function renderSourceTrace(sourceIds) {
    var ids = Array.isArray(sourceIds) ? sourceIds : [];
    if (!ids.length) return '';
    var chips = ids.map(function (src) {
      var tableLabel = { kb_entries: 'KB', research_notes: 'RN', content_drafts: 'DRAFT' }[src.table] || src.table;
      return '<span class="tc-trace-chip">' + esc(tableLabel) + ': ' + esc(src.title || src.id) + '</span>';
    }).join('');
    return '<div class="tc-trace"><span class="tc-trace-lbl">SOURCES</span>' + chips + '</div>';
  }

  // ── Section navigation ────────────────────────────────────────────────────
  var _currentSection = 'dashboard';

  window.tcSection = function (name) {
    _currentSection = name;
    var body = document.getElementById('tc-body');
    if (!body) return;
    document.querySelectorAll('#tab-tc .tc-snav').forEach(function (b) {
      b.classList.toggle('tc-snav-active', b.dataset.section === name);
    });
    body.innerHTML = shimmer(3);
    if (name === 'dashboard')      loadDashboard(body);
    else if (name === 'modules')   loadModules(body);
    else if (name === 'paths')     loadPaths(body);
    else if (name === 'certs')     loadCerts(body);
    else if (name === 'resources') loadResources(body);
    else body.innerHTML = '<div class="tc-empty">Section not found.</div>';
  };

  // ── Init ─────────────────────────────────────────────────────────────────
  window.tcInit = function () {
    var tab = document.getElementById('tab-tc');
    if (!tab || tab.dataset.tcInit) return;
    tab.dataset.tcInit = '1';

    var sections = [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'modules',   label: 'Modules' },
      { key: 'paths',     label: 'Learning Paths' },
      { key: 'certs',     label: 'Certifications' },
      { key: 'resources', label: 'Resources' },
    ];

    tab.innerHTML = [
      '<div class="tc-wrap">',
      '  <div class="tc-subnav">',
      sections.map(function (s) {
        return '    <button class="tc-snav' + (s.key === 'dashboard' ? ' tc-snav-active' : '') + '" data-section="' + s.key + '" onclick="tcSection(\'' + s.key + '\')">' + s.label + '</button>';
      }).join(''),
      '  </div>',
      '  <div id="tc-body" class="tc-body"></div>',
      '</div>',
    ].join('');

    tcSection('dashboard');
  };

  // ════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════════════

  function loadDashboard(body) {
    body.innerHTML = shimmer(2);
    tcReq('GET', '/.netlify/functions/training-center?section=dashboard').then(function (d) {
      var kpis = d.kpis || {};
      var mc   = d.module_counts || {};
      var warn = d.migration_needed ? '<div class="tc-warn">Run migration 2026-06-13-training-center.sql in Supabase to enable the Training Center.</div>' : '';

      body.innerHTML = warn + [
        '<div class="tc-dash-header">',
        '  <div class="tc-dash-title">🎓 Training Center</div>',
        '  <button class="tc-btn-primary" onclick="tcSection(\'modules\')">View All Modules</button>',
        '</div>',

        '<div class="tc-kpi-row">',
        tcKpi('Total Modules',   kpis.total          || 0, '📚'),
        tcKpi('Published',       kpis.published       || 0, '✅'),
        tcKpi('Certifications',  kpis.certifications  || 0, '🏆'),
        tcKpi('Learning Paths',  kpis.learning_paths  || 0, '🗺️'),
        tcKpi('Drafts',          kpis.draft           || 0, '✏️'),
        '</div>',

        '<div class="tc-dash-grid">',
        '  <div class="tc-dash-card">',
        '    <div class="tc-dash-card-title">Module Pipeline</div>',
        '    <div class="tc-pipeline">',
        tcPipeItem('Draft',     mc.draft     || 0, '#7a7060'),
        tcPipeItem('Review',    mc.review    || 0, '#1976d2'),
        tcPipeItem('Approved',  mc.approved  || 0, '#2e7d32'),
        tcPipeItem('Published', mc.published || 0, '#6a1b9a'),
        tcPipeItem('Archived',  mc.archived  || 0, '#424242'),
        '    </div>',
        '  </div>',
        '  <div class="tc-dash-card">',
        '    <div class="tc-dash-card-title">Quick Actions</div>',
        '    <div class="tc-quick-actions">',
        '      <button class="tc-quick-btn" onclick="tcSection(\'modules\');tcNewModuleForm()">+ New Module</button>',
        '      <button class="tc-quick-btn" onclick="tcSection(\'modules\');tcShowGenForm()">⚡ Generate from KB</button>',
        '      <button class="tc-quick-btn" onclick="tcSection(\'paths\')">+ Learning Path</button>',
        '      <button class="tc-quick-btn" onclick="tcSection(\'certs\')">+ Certification</button>',
        '    </div>',
        '  </div>',
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="tc-error">Failed to load dashboard: ' + esc(e.message) + '</div>';
    });
  }

  function tcKpi(label, val, icon) {
    return '<div class="tc-kpi"><div class="tc-kpi-icon">' + icon + '</div><div class="tc-kpi-num">' + val + '</div><div class="tc-kpi-lbl">' + esc(label) + '</div></div>';
  }
  function tcPipeItem(label, count, color) {
    return '<div class="tc-pipe-item"><span class="tc-pipe-dot" style="background:' + color + '"></span><span class="tc-pipe-lbl">' + label + '</span><span class="tc-pipe-count">' + count + '</span></div>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // MODULES
  // ════════════════════════════════════════════════════════════════════════

  var _modTypeFilter   = '';
  var _modStatusFilter = '';
  var _modSearch       = '';
  var _editModuleId    = null;

  function loadModules(body) {
    body.innerHTML = shimmer(3);
    var qs = '?section=modules';
    if (_modTypeFilter)   qs += '&type=' + _modTypeFilter;
    if (_modStatusFilter) qs += '&status=' + _modStatusFilter;
    if (_modSearch)       qs += '&search=' + encodeURIComponent(_modSearch);

    tcReq('GET', '/.netlify/functions/training-center' + qs).then(function (d) {
      var warn = d.migration_needed ? '<div class="tc-warn">Run migration 2026-06-13-training-center.sql to enable modules.</div>' : '';

      body.innerHTML = warn + [
        '<div class="tc-section-header">',
        '  <div class="tc-section-title">📚 Training Modules</div>',
        '  <div class="tc-header-actions">',
        '    <button class="tc-btn-primary" onclick="tcNewModuleForm()">+ New Module</button>',
        '    <button class="tc-btn-secondary" onclick="tcShowGenForm()">⚡ Generate</button>',
        '  </div>',
        '</div>',

        '<div class="tc-filters">',
        '  <input id="tc-mod-search" class="tc-search" placeholder="Search modules…" oninput="tcModSearch()" value="' + esc(_modSearch) + '">',
        '  <select class="tc-filter-select" onchange="tcModTypeFilter(this.value)">',
        '    <option value="">All Types</option>',
        MODULE_TYPES.map(function (t) { return '<option value="' + t.value + '"' + (_modTypeFilter===t.value?' selected':'') + '>' + t.label + '</option>'; }).join(''),
        '  </select>',
        '  <select class="tc-filter-select" onchange="tcModStatusFilter(this.value)">',
        '    <option value="">All Statuses</option>',
        ['draft','review','approved','published','archived'].map(function (s) { return '<option value="' + s + '"' + (_modStatusFilter===s?' selected':'') + '>' + s.charAt(0).toUpperCase()+s.slice(1) + '</option>'; }).join(''),
        '  </select>',
        '</div>',

        '<div id="tc-mod-form-wrap"></div>',
        '<div id="tc-gen-form-wrap"></div>',

        '<div id="tc-mod-list">',
        renderModuleList(d.modules || []),
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="tc-error">Failed to load modules: ' + esc(e.message) + '</div>';
    });
  }

  function renderModuleList(modules) {
    if (!modules.length) return '<div class="tc-empty">No training modules yet. Create one or generate from your Knowledge Base.</div>';
    return modules.map(renderModuleCard).join('');
  }

  function renderModuleCard(m) {
    var preview = m.module_content ? m.module_content.replace(/#+\s/g,'').replace(/\*\*/g,'').slice(0, 200) : (m.summary || '');
    var objectives = Array.isArray(m.learning_objectives) ? m.learning_objectives : [];
    return [
      '<div class="tc-module-card" id="tc-mod-' + m.id + '">',
      '  <div class="tc-mod-top">',
      '    ' + typeBadge(m.module_type),
      '    ' + diffBadge(m.difficulty_level),
      '    ' + statusBadge(m.status),
      m.estimated_duration ? '<span class="tc-duration">⏱ ' + m.estimated_duration + ' min</span>' : '',
      '    <div class="tc-mod-actions">',
      moduleWorkflowBtns(m),
      '      <button class="tc-btn-edit" onclick="tcEditModule(\'' + m.id + '\')">Edit</button>',
      '      <button class="tc-btn-delete" onclick="tcDeleteModule(\'' + m.id + '\')">Delete</button>',
      '    </div>',
      '  </div>',
      '  <div class="tc-mod-title">' + esc(m.title) + '</div>',
      preview ? '<div class="tc-mod-preview">' + esc(preview) + (preview.length >= 200 ? '…' : '') + '</div>' : '',
      objectives.length ? '<div class="tc-objectives"><span class="tc-objectives-lbl">Objectives:</span> ' + esc(objectives.slice(0,2).join(' · ')) + (objectives.length>2?' +' + (objectives.length-2) + ' more':'') + '</div>' : '',
      renderSourceTrace(m.source_ids),
      '<div class="tc-mod-meta">Created ' + fmt(m.created_at) + '</div>',
      '</div>',
    ].join('');
  }

  function moduleWorkflowBtns(m) {
    var html = '';
    if (m.status === 'draft')    html += '<button class="tc-btn-workflow" onclick="tcModReview(\'' + m.id + '\')">Send to Review</button>';
    if (m.status === 'review')   html += '<button class="tc-btn-workflow tc-btn-approve" onclick="tcModApprove(\'' + m.id + '\')">Approve</button>';
    if (m.status === 'approved') html += '<button class="tc-btn-workflow tc-btn-publish" onclick="tcModPublish(\'' + m.id + '\')">Publish</button>';
    if (m.status !== 'archived') html += '<button class="tc-btn-workflow tc-btn-archive" onclick="tcModArchive(\'' + m.id + '\')">Archive</button>';
    return html;
  }

  // ── Module form ──────────────────────────────────────────────────────────

  window.tcNewModuleForm = function () {
    _editModuleId = null;
    var genWrap = document.getElementById('tc-gen-form-wrap');
    if (genWrap) genWrap.innerHTML = '';
    renderModuleForm({});
  };

  window.tcEditModule = function (id) {
    _editModuleId = id;
    tcReq('GET', '/.netlify/functions/training-center?section=modules').then(function (d) {
      var m = (d.modules || []).find(function (x) { return x.id === id; });
      if (m) renderModuleForm(m);
    }).catch(function (e) { toast(e.message, true); });
  };

  function renderModuleForm(m) {
    var wrap = document.getElementById('tc-mod-form-wrap');
    if (!wrap) return;
    var typeOpts = MODULE_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + (m.module_type === t.value ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');
    var diffOpts = DIFFICULTY_LEVELS.map(function (d) {
      return '<option value="' + d.value + '"' + (m.difficulty_level === d.value ? ' selected' : '') + '>' + d.label + '</option>';
    }).join('');
    wrap.innerHTML = [
      '<div class="tc-form tc-mod-form" id="tc-mod-form">',
      '  <div class="tc-form-title">' + (_editModuleId ? 'Edit Module' : 'New Module') + '</div>',
      '  <div class="tc-form-row"><label class="tc-label">Title *</label>',
      '    <input class="tc-input" id="tcModTitle" value="' + esc(m.title||'') + '" placeholder="Module title…"></div>',
      '  <div class="tc-form-row tc-form-row-2">',
      '    <div><label class="tc-label">Module Type</label><select class="tc-input" id="tcModType"><option value="">— select —</option>' + typeOpts + '</select></div>',
      '    <div><label class="tc-label">Difficulty</label><select class="tc-input" id="tcModDiff"><option value="">— select —</option>' + diffOpts + '</select></div>',
      '  </div>',
      '  <div class="tc-form-row"><label class="tc-label">Summary</label>',
      '    <textarea class="tc-input tc-textarea-sm" id="tcModSummary" rows="3" placeholder="Short description…">' + esc(m.summary||'') + '</textarea></div>',
      '  <div class="tc-form-row"><label class="tc-label">Estimated Duration (minutes)</label>',
      '    <input class="tc-input tc-input-sm" id="tcModDuration" type="number" min="5" max="480" value="' + esc(m.estimated_duration||'') + '" placeholder="e.g. 45"></div>',
      '  <div class="tc-form-row"><label class="tc-label">Module Content</label>',
      '    <textarea class="tc-input tc-mod-textarea" id="tcModContent" rows="20" placeholder="Full module content (Markdown supported)…">' + esc(m.module_content||'') + '</textarea></div>',
      '  <div class="tc-form-row"><label class="tc-label">Learning Objectives (one per line)</label>',
      '    <textarea class="tc-input tc-textarea-sm" id="tcModObjectives" rows="4" placeholder="Students will be able to…">' + esc((m.learning_objectives||[]).join('\n')) + '</textarea></div>',
      '  <div class="tc-form-row"><label class="tc-label">Key Concepts (JSON array or leave blank)</label>',
      '    <textarea class="tc-input tc-textarea-sm" id="tcModConcepts" rows="3" placeholder=\'[{"term":"...","definition":"..."}]\'>' + esc(JSON.stringify(m.key_concepts||[])) + '</textarea></div>',
      '  <div class="tc-form-actions">',
      '    <button class="tc-btn-primary" onclick="tcModSave()">Save Module</button>',
      '    <button class="tc-btn-cancel" onclick="tcModCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.tcModSave = function () {
    var title    = (document.getElementById('tcModTitle')      || {}).value || '';
    var mtype    = (document.getElementById('tcModType')       || {}).value || '';
    var diff     = (document.getElementById('tcModDiff')       || {}).value || '';
    var summary  = (document.getElementById('tcModSummary')    || {}).value || '';
    var duration = (document.getElementById('tcModDuration')   || {}).value || '';
    var content  = (document.getElementById('tcModContent')    || {}).value || '';
    var objRaw   = (document.getElementById('tcModObjectives') || {}).value || '';
    var conceptsRaw = (document.getElementById('tcModConcepts')|| {}).value || '';

    if (!title.trim()) { toast('Title is required.', true); return; }
    var objectives = objRaw.trim() ? objRaw.split('\n').map(function(l){return l.trim();}).filter(Boolean) : [];
    var concepts   = [];
    if (conceptsRaw.trim()) {
      try { concepts = JSON.parse(conceptsRaw); } catch { toast('Key Concepts must be valid JSON.', true); return; }
    }
    var body = {
      title:               title.trim(),
      summary:             summary || undefined,
      module_content:      content || undefined,
      learning_objectives: objectives,
      key_concepts:        concepts,
    };
    if (!_editModuleId) {
      if (!mtype) { toast('Module Type is required.', true); return; }
      body.module_type      = mtype;
      body.difficulty_level = diff || 'beginner';
    }
    if (duration) body.estimated_duration = parseInt(duration, 10);

    var isNew = !_editModuleId;
    var req = isNew
      ? tcReq('POST', '/.netlify/functions/training-center?action=create_module', body)
      : tcReq('PATCH', '/.netlify/functions/training-center?action=update_module&id=' + _editModuleId, body);

    req.then(function () {
      toast(isNew ? 'Module created.' : 'Module saved.');
      tcModCancel();
      refreshModList();
    }).catch(function (e) { toast(e.message, true); });
  };

  window.tcModCancel = function () {
    var wrap = document.getElementById('tc-mod-form-wrap');
    if (wrap) wrap.innerHTML = '';
    _editModuleId = null;
  };

  // ── Generate form ────────────────────────────────────────────────────────

  window.tcShowGenForm = function () {
    var formWrap = document.getElementById('tc-mod-form-wrap');
    if (formWrap) formWrap.innerHTML = '';
    var wrap = document.getElementById('tc-gen-form-wrap');
    if (!wrap) return;

    tcReq('GET', '/.netlify/functions/training-center?section=resources').then(function (res) {
      var kbOpts = (res.kb_entries || []).map(function (e) {
        return '<option value="' + e.id + '" data-src="kb">' + esc(e.title) + '</option>';
      }).join('');
      var rnOpts = (res.research_notes || []).map(function (n) {
        return '<option value="' + n.id + '" data-src="rn">' + esc(n.title) + '</option>';
      }).join('');
      var draftOpts = (res.content_drafts || []).map(function (d) {
        return '<option value="' + d.id + '" data-src="draft">' + esc(d.title) + ' [' + esc(d.content_type) + ']</option>';
      }).join('');

      var hasAnySources = kbOpts || rnOpts || draftOpts;
      var typeOpts = MODULE_TYPES.map(function (t) {
        return '<option value="' + t.value + '">' + t.label + '</option>';
      }).join('');
      var diffOpts = DIFFICULTY_LEVELS.map(function (d) {
        return '<option value="' + d.value + '">' + d.label + '</option>';
      }).join('');

      wrap.innerHTML = [
        '<div class="tc-form tc-gen-form" id="tc-gen-form">',
        '  <div class="tc-form-title">⚡ Generate Module from Source</div>',
        hasAnySources ? '' : '<div class="tc-warn">No published KB articles or approved drafts available. Add content to the Knowledge Base first.</div>',
        '  <div class="tc-form-row"><label class="tc-label">Source Type</label>',
        '    <select class="tc-input" id="tcGenSrcType" onchange="tcGenUpdateSources()">',
        '      <option value="kb">Knowledge Base Article</option>',
        rnOpts   ? '<option value="rn">Research Note</option>'   : '',
        draftOpts? '<option value="draft">Content Draft</option>': '',
        '    </select></div>',
        '  <div class="tc-form-row"><label class="tc-label">Select Source *</label>',
        '    <select class="tc-input" id="tcGenSrcId">',
        kbOpts || '<option value="">— no KB articles available —</option>',
        '    </select></div>',
        '  <div class="tc-form-row tc-form-row-2">',
        '    <div><label class="tc-label">Module Type</label><select class="tc-input" id="tcGenModType">' + typeOpts + '</select></div>',
        '    <div><label class="tc-label">Difficulty</label><select class="tc-input" id="tcGenDiff">' + diffOpts + '</select></div>',
        '  </div>',
        '  <div class="tc-form-actions">',
        '    <button class="tc-btn-primary" onclick="tcGenerate()" ' + (hasAnySources?'':'disabled') + '>Generate Module</button>',
        '    <button class="tc-btn-cancel" onclick="tcGenCancel()">Cancel</button>',
        '  </div>',
        '</div>',
      ].join('');

      // Store source lists for switching
      wrap._kbOpts    = kbOpts;
      wrap._rnOpts    = rnOpts;
      wrap._draftOpts = draftOpts;
    }).catch(function (e) {
      wrap.innerHTML = '<div class="tc-error">Failed to load resources: ' + esc(e.message) + '</div>';
    });
  };

  window.tcGenUpdateSources = function () {
    var typeEl = document.getElementById('tcGenSrcType');
    var srcEl  = document.getElementById('tcGenSrcId');
    if (!typeEl || !srcEl) return;
    var wrap = document.getElementById('tc-gen-form-wrap');
    var opts  = typeEl.value === 'kb' ? wrap._kbOpts : typeEl.value === 'rn' ? wrap._rnOpts : wrap._draftOpts;
    srcEl.innerHTML = opts || '<option value="">— none available —</option>';
  };

  window.tcGenerate = function () {
    var srcType = (document.getElementById('tcGenSrcType') || {}).value || 'kb';
    var srcId   = (document.getElementById('tcGenSrcId')   || {}).value || '';
    var mtype   = (document.getElementById('tcGenModType') || {}).value || 'practitioner';
    var diff    = (document.getElementById('tcGenDiff')    || {}).value || 'beginner';

    if (!srcId) { toast('Select a source first.', true); return; }

    var btn = document.querySelector('#tc-gen-form .tc-btn-primary');
    if (btn) { btn.textContent = '⏳ Generating…'; btn.disabled = true; }

    tcReq('POST', '/.netlify/functions/training-center?action=generate_module', {
      source_type: srcType, source_id: srcId, module_type: mtype, difficulty_level: diff,
    }).then(function (d) {
      toast('Module generated: ' + (d.module ? d.module.title : ''));
      tcGenCancel();
      refreshModList();
    }).catch(function (e) {
      toast(e.message, true);
      if (btn) { btn.textContent = 'Generate Module'; btn.disabled = false; }
    });
  };

  window.tcGenCancel = function () {
    var wrap = document.getElementById('tc-gen-form-wrap');
    if (wrap) wrap.innerHTML = '';
  };

  // ── Module workflow ──────────────────────────────────────────────────────

  function modTransition(id, action, label) {
    tcReq('PATCH', '/.netlify/functions/training-center?action=' + action + '&id=' + id)
      .then(function () { toast('Module → ' + label); refreshModList(); })
      .catch(function (e) { toast(e.message, true); });
  }

  window.tcModReview  = function (id) { modTransition(id, 'review_module',  'Review');    };
  window.tcModApprove = function (id) { modTransition(id, 'approve_module', 'Approved');  };
  window.tcModPublish = function (id) { modTransition(id, 'publish_module', 'Published'); };
  window.tcModArchive = function (id) { modTransition(id, 'archive_module', 'Archived');  };
  window.tcDeleteModule = function (id) {
    if (!confirm('Delete this module?')) return;
    tcReq('PATCH', '/.netlify/functions/training-center?action=delete_module&id=' + id)
      .then(function () { toast('Module deleted.'); refreshModList(); })
      .catch(function (e) { toast(e.message, true); });
  };

  window.tcModSearch = function () {
    _modSearch = (document.getElementById('tc-mod-search') || {}).value || '';
    refreshModList();
  };
  window.tcModTypeFilter = function (v) { _modTypeFilter = v; refreshModList(); };
  window.tcModStatusFilter = function (v) { _modStatusFilter = v; refreshModList(); };

  function refreshModList() {
    var qs = '?section=modules';
    if (_modTypeFilter)   qs += '&type=' + _modTypeFilter;
    if (_modStatusFilter) qs += '&status=' + _modStatusFilter;
    if (_modSearch)       qs += '&search=' + encodeURIComponent(_modSearch);
    var el = document.getElementById('tc-mod-list');
    if (!el) return;
    el.innerHTML = shimmer(2);
    tcReq('GET', '/.netlify/functions/training-center' + qs).then(function (d) {
      el.innerHTML = renderModuleList(d.modules || []);
    }).catch(function (e) { el.innerHTML = '<div class="tc-error">' + esc(e.message) + '</div>'; });
  }

  // ════════════════════════════════════════════════════════════════════════
  // LEARNING PATHS
  // ════════════════════════════════════════════════════════════════════════

  var _editPathId = null;

  function loadPaths(body) {
    body.innerHTML = shimmer(2);
    tcReq('GET', '/.netlify/functions/training-center?section=paths').then(function (d) {
      var warn = d.migration_needed ? '<div class="tc-warn">Run migration 2026-06-13-training-center.sql to enable learning paths.</div>' : '';
      body.innerHTML = warn + [
        '<div class="tc-section-header">',
        '  <div class="tc-section-title">🗺️ Learning Paths</div>',
        '  <button class="tc-btn-primary" onclick="tcNewPathForm()">+ New Path</button>',
        '</div>',
        '<div id="tc-path-form-wrap"></div>',
        '<div id="tc-path-list">',
        renderPathList(d.paths || []),
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="tc-error">Failed to load paths: ' + esc(e.message) + '</div>';
    });
  }

  function renderPathList(paths) {
    if (!paths.length) return '<div class="tc-empty">No learning paths yet. Create one to organize your training modules into structured sequences.</div>';
    return paths.map(function (p) {
      var modCount = Array.isArray(p.module_ids) ? p.module_ids.length : 0;
      var typeColor = TYPE_COLORS[p.path_type] || '#7a7060';
      return [
        '<div class="tc-path-card">',
        '  <div class="tc-mod-top">',
        '    <span class="tc-type-badge" style="background:' + typeColor + '20;color:' + typeColor + ';border-color:' + typeColor + '40">' + esc((p.path_type||'').replace('_',' ').toUpperCase()) + '</span>',
        '    ' + statusBadge(p.status),
        p.estimated_duration ? '<span class="tc-duration">⏱ ' + p.estimated_duration + ' min</span>' : '',
        '    <div class="tc-mod-actions">',
        '      <button class="tc-btn-edit" onclick="tcEditPath(\'' + p.id + '\')">Edit</button>',
        '      <button class="tc-btn-delete" onclick="tcDeletePath(\'' + p.id + '\')">Delete</button>',
        '    </div>',
        '  </div>',
        '  <div class="tc-mod-title">' + esc(p.title) + '</div>',
        p.description ? '<div class="tc-mod-preview">' + esc(p.description) + '</div>' : '',
        '  <div class="tc-path-modules"><span class="tc-trace-lbl">MODULES</span> <span class="tc-path-mod-count">' + modCount + ' module' + (modCount !== 1 ? 's' : '') + '</span></div>',
        '<div class="tc-mod-meta">Created ' + fmt(p.created_at) + '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  window.tcNewPathForm = function () {
    _editPathId = null;
    renderPathForm({});
  };
  window.tcEditPath = function (id) {
    _editPathId = id;
    tcReq('GET', '/.netlify/functions/training-center?section=paths').then(function (d) {
      var p = (d.paths || []).find(function (x) { return x.id === id; });
      if (p) renderPathForm(p);
    }).catch(function (e) { toast(e.message, true); });
  };

  function renderPathForm(p) {
    var wrap = document.getElementById('tc-path-form-wrap');
    if (!wrap) return;
    var typeOpts = PATH_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + (p.path_type === t.value ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');
    wrap.innerHTML = [
      '<div class="tc-form">',
      '  <div class="tc-form-title">' + (_editPathId ? 'Edit Learning Path' : 'New Learning Path') + '</div>',
      '  <div class="tc-form-row"><label class="tc-label">Title *</label>',
      '    <input class="tc-input" id="tcPathTitle" value="' + esc(p.title||'') + '" placeholder="Path title…"></div>',
      '  <div class="tc-form-row"><label class="tc-label">Path Type</label>',
      '    <select class="tc-input" id="tcPathType"><option value="">— select —</option>' + typeOpts + '</select></div>',
      '  <div class="tc-form-row"><label class="tc-label">Description</label>',
      '    <textarea class="tc-input tc-textarea-sm" id="tcPathDesc" rows="3" placeholder="Describe this learning path…">' + esc(p.description||'') + '</textarea></div>',
      '  <div class="tc-form-row"><label class="tc-label">Estimated Duration (minutes)</label>',
      '    <input class="tc-input tc-input-sm" id="tcPathDuration" type="number" value="' + esc(p.estimated_duration||'') + '" placeholder="Total minutes"></div>',
      '  <div class="tc-form-actions">',
      '    <button class="tc-btn-primary" onclick="tcPathSave()">Save Path</button>',
      '    <button class="tc-btn-cancel" onclick="tcPathCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.tcPathSave = function () {
    var title    = (document.getElementById('tcPathTitle')    || {}).value || '';
    var ptype    = (document.getElementById('tcPathType')     || {}).value || '';
    var desc     = (document.getElementById('tcPathDesc')     || {}).value || '';
    var duration = (document.getElementById('tcPathDuration') || {}).value || '';
    if (!title.trim()) { toast('Title is required.', true); return; }
    var body = { title: title.trim(), description: desc || undefined };
    if (ptype) body.path_type = ptype;
    if (duration) body.estimated_duration = parseInt(duration, 10);

    var req = _editPathId
      ? tcReq('PATCH', '/.netlify/functions/training-center?action=update_path&id=' + _editPathId, body)
      : tcReq('POST',  '/.netlify/functions/training-center?action=create_path', body);
    req.then(function () {
      toast(_editPathId ? 'Path saved.' : 'Path created.');
      tcPathCancel();
      tcSection('paths');
    }).catch(function (e) { toast(e.message, true); });
  };

  window.tcPathCancel = function () {
    var wrap = document.getElementById('tc-path-form-wrap');
    if (wrap) wrap.innerHTML = '';
    _editPathId = null;
  };
  window.tcDeletePath = function (id) {
    if (!confirm('Delete this learning path?')) return;
    tcReq('PATCH', '/.netlify/functions/training-center?action=delete_path&id=' + id)
      .then(function () { toast('Path deleted.'); tcSection('paths'); })
      .catch(function (e) { toast(e.message, true); });
  };

  // ════════════════════════════════════════════════════════════════════════
  // CERTIFICATIONS
  // ════════════════════════════════════════════════════════════════════════

  var _editCertId = null;

  function loadCerts(body) {
    body.innerHTML = shimmer(2);
    tcReq('GET', '/.netlify/functions/training-center?section=certifications').then(function (d) {
      var warn = d.migration_needed ? '<div class="tc-warn">Run migration 2026-06-13-training-center.sql to enable certifications.</div>' : '';
      body.innerHTML = warn + [
        '<div class="tc-section-header">',
        '  <div class="tc-section-title">🏆 Certifications</div>',
        '  <button class="tc-btn-primary" onclick="tcNewCertForm()">+ New Certification</button>',
        '</div>',
        '<div id="tc-cert-form-wrap"></div>',
        '<div id="tc-cert-list">',
        renderCertList(d.certifications || []),
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="tc-error">Failed to load certifications: ' + esc(e.message) + '</div>';
    });
  }

  function renderCertList(certs) {
    if (!certs.length) return '<div class="tc-empty">No certifications yet. Create one to define the requirements for practitioner certification.</div>';
    return certs.map(function (c) {
      var modCount = Array.isArray(c.required_modules) ? c.required_modules.length : 0;
      return [
        '<div class="tc-cert-card">',
        '  <div class="tc-mod-top">',
        '    <span class="tc-type-badge" style="background:#6a1b9a20;color:#6a1b9a;border-color:#6a1b9a40">🏆 CERTIFICATION</span>',
        '    ' + statusBadge(c.status),
        '    <div class="tc-mod-actions">',
        '      <button class="tc-btn-edit" onclick="tcEditCert(\'' + c.id + '\')">Edit</button>',
        '      <button class="tc-btn-delete" onclick="tcDeleteCert(\'' + c.id + '\')">Delete</button>',
        '    </div>',
        '  </div>',
        '  <div class="tc-mod-title">' + esc(c.title) + '</div>',
        c.description ? '<div class="tc-mod-preview">' + esc(c.description) + '</div>' : '',
        '  <div class="tc-path-modules"><span class="tc-trace-lbl">REQUIRED MODULES</span> <span class="tc-path-mod-count">' + modCount + ' module' + (modCount !== 1 ? 's' : '') + '</span></div>',
        '<div class="tc-mod-meta">Created ' + fmt(c.created_at) + '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  window.tcNewCertForm = function () { _editCertId = null; renderCertForm({}); };
  window.tcEditCert = function (id) {
    _editCertId = id;
    tcReq('GET', '/.netlify/functions/training-center?section=certifications').then(function (d) {
      var c = (d.certifications || []).find(function (x) { return x.id === id; });
      if (c) renderCertForm(c);
    }).catch(function (e) { toast(e.message, true); });
  };

  function renderCertForm(c) {
    var wrap = document.getElementById('tc-cert-form-wrap');
    if (!wrap) return;
    wrap.innerHTML = [
      '<div class="tc-form">',
      '  <div class="tc-form-title">' + (_editCertId ? 'Edit Certification' : 'New Certification') + '</div>',
      '  <div class="tc-form-row"><label class="tc-label">Title *</label>',
      '    <input class="tc-input" id="tcCertTitle" value="' + esc(c.title||'') + '" placeholder="Certification title…"></div>',
      '  <div class="tc-form-row"><label class="tc-label">Description</label>',
      '    <textarea class="tc-input tc-textarea-sm" id="tcCertDesc" rows="3" placeholder="What does this certification represent?">' + esc(c.description||'') + '</textarea></div>',
      '  <div class="tc-form-actions">',
      '    <button class="tc-btn-primary" onclick="tcCertSave()">Save Certification</button>',
      '    <button class="tc-btn-cancel" onclick="tcCertCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.tcCertSave = function () {
    var title = (document.getElementById('tcCertTitle') || {}).value || '';
    var desc  = (document.getElementById('tcCertDesc')  || {}).value || '';
    if (!title.trim()) { toast('Title is required.', true); return; }
    var body = { title: title.trim(), description: desc || undefined };
    var req = _editCertId
      ? tcReq('PATCH', '/.netlify/functions/training-center?action=update_cert&id=' + _editCertId, body)
      : tcReq('POST',  '/.netlify/functions/training-center?action=create_cert', body);
    req.then(function () {
      toast(_editCertId ? 'Certification saved.' : 'Certification created.');
      tcCertCancel();
      tcSection('certs');
    }).catch(function (e) { toast(e.message, true); });
  };

  window.tcCertCancel = function () {
    var wrap = document.getElementById('tc-cert-form-wrap');
    if (wrap) wrap.innerHTML = '';
    _editCertId = null;
  };
  window.tcDeleteCert = function (id) {
    if (!confirm('Delete this certification?')) return;
    tcReq('PATCH', '/.netlify/functions/training-center?action=delete_cert&id=' + id)
      .then(function () { toast('Certification deleted.'); tcSection('certs'); })
      .catch(function (e) { toast(e.message, true); });
  };

  // ════════════════════════════════════════════════════════════════════════
  // RESOURCES
  // ════════════════════════════════════════════════════════════════════════

  function loadResources(body) {
    body.innerHTML = shimmer(2);
    tcReq('GET', '/.netlify/functions/training-center?section=resources').then(function (d) {
      body.innerHTML = [
        '<div class="tc-section-header">',
        '  <div class="tc-section-title">📖 Source Resources</div>',
        '  <button class="tc-btn-secondary" onclick="tcSection(\'modules\');tcShowGenForm()">⚡ Generate Module</button>',
        '</div>',

        '<div class="tc-res-section">',
        '  <div class="tc-res-header">📚 Knowledge Base Articles (' + (d.kb_count || 0) + ')</div>',
        (d.kb_entries || []).length ? [
          '<div class="tc-res-list">',
          (d.kb_entries || []).map(function (e) {
            return '<div class="tc-res-item"><div class="tc-res-title">' + esc(e.title) + '</div>' +
              (e.summary ? '<div class="tc-res-summary">' + esc(e.summary.slice(0,120)) + '…</div>' : '') +
              ((e.tags||[]).length ? '<div class="tc-res-tags">' + e.tags.map(function(t){return '<span class="tc-res-tag">'+esc(t)+'</span>';}).join('') + '</div>' : '') +
              '</div>';
          }).join(''),
          '</div>',
        ].join('') : '<div class="tc-empty">No published KB articles yet.</div>',
        '</div>',

        '<div class="tc-res-section">',
        '  <div class="tc-res-header">🔬 Research Notes (' + (d.rn_count || 0) + ')</div>',
        (d.research_notes || []).length ? [
          '<div class="tc-res-list">',
          (d.research_notes || []).map(function (n) {
            return '<div class="tc-res-item"><div class="tc-res-title">' + esc(n.title) + '</div>' +
              (n.summary ? '<div class="tc-res-summary">' + esc(n.summary.slice(0,120)) + '…</div>' : '') + '</div>';
          }).join(''),
          '</div>',
        ].join('') : '<div class="tc-empty">No research notes yet.</div>',
        '</div>',

        '<div class="tc-res-section">',
        '  <div class="tc-res-header">📄 Approved Content Drafts (' + (d.draft_count || 0) + ')</div>',
        (d.content_drafts || []).length ? [
          '<div class="tc-res-list">',
          (d.content_drafts || []).map(function (dr) {
            return '<div class="tc-res-item"><div class="tc-res-title">' + esc(dr.title) + '</div>' +
              '<span class="tc-res-type">' + esc(dr.content_type) + '</span>' +
              '<span class="tc-res-status">' + esc(dr.status) + '</span></div>';
          }).join(''),
          '</div>',
        ].join('') : '<div class="tc-empty">No approved or published drafts yet.</div>',
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="tc-error">Failed to load resources: ' + esc(e.message) + '</div>';
    });
  }

})();
