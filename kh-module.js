(function () {
  'use strict';

  const KB_API  = '/.netlify/functions/kb';
  const RN_API  = '/.netlify/functions/research';
  const KE_API  = '/.netlify/functions/knowledge-engine';

  const KB_CATEGORIES = ['Protocol','FAQ','Training','Practitioner Guide','Procedure','Reference'];
  const KB_STATUSES   = ['draft','published','archived'];

  function token() { return sessionStorage.getItem('rea_api_token') || ''; }

  function apiFetch(base, path, opts) {
    return fetch(base + path, Object.assign({
      headers: { 'X-Dashboard-Token': token(), 'Content-Type': 'application/json' },
    }, opts));
  }

  function kbFetch(path, opts)  { return apiFetch(KB_API,  path, opts); }
  function rnFetch(path, opts)  { return apiFetch(RN_API,  path, opts); }
  function keFetch(path, opts)  { return apiFetch(KE_API,  path, opts); }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let _section        = 'dashboard';
  let _kbEntries      = [];
  let _kbCategories   = [];
  let _kbSearch       = '';
  let _kbCatFilter    = '';
  let _kbStatusFilter = '';
  let _rnNotes        = [];
  let _rnSearch       = '';

  // ── Entry point ───────────────────────────────────────────────────────────
  window.khInit = function () {
    _section        = 'dashboard';
    _kbEntries      = [];
    _kbCategories   = [];
    _kbSearch       = '';
    _kbCatFilter    = '';
    _kbStatusFilter = '';
    _rnNotes        = [];
    _rnSearch       = '';
    renderHub();
  };

  // ── Shell ──────────────────────────────────────────────────────────────────
  function renderHub() {
    const el = document.getElementById('tab-kh');
    if (!el) return;
    el.innerHTML = `
<div class="kh-wrap">
  <div class="kh-subnav">
    <button class="kh-snav${_section==='dashboard'        ?' active':''}" onclick="khSection('dashboard')">Dashboard</button>
    <button class="kh-snav${_section==='kb'               ?' active':''}" onclick="khSection('kb')">Knowledge Base</button>
    <button class="kh-snav${_section==='research'         ?' active':''}" onclick="khSection('research')">Research Notes</button>
    <button class="kh-snav${_section==='patterns'         ?' active':''}" onclick="khSection('patterns')">Pattern Library</button>
    <button class="kh-snav${_section==='insights'         ?' active':''}" onclick="khSection('insights')">Insights Feed</button>
    <button class="kh-snav${_section==='ke_insights'      ?' active':''}" onclick="khSection('ke_insights')">Research Insights</button>
    <button class="kh-snav${_section==='case_studies'     ?' active':''}" onclick="khSection('case_studies')">Case Studies</button>
    <button class="kh-snav${_section==='rec_intelligence' ?' active':''}" onclick="khSection('rec_intelligence')">Rec Intelligence</button>
    <button class="kh-snav${_section==='service_intel'    ?' active':''}" onclick="khSection('service_intel')">Service Intel</button>
  </div>
  <div id="kh-body"></div>
</div>`;
    loadSection();
  }

  window.khSection = function (name) {
    _section = name;
    const el = document.getElementById('tab-kh');
    if (!el) return;
    el.querySelectorAll('.kh-snav').forEach(b => b.classList.remove('active'));
    const names = ['dashboard','kb','research','patterns','insights','ke_insights','case_studies','rec_intelligence','service_intel'];
    const idx = names.indexOf(name);
    const navBtns = el.querySelectorAll('.kh-snav');
    if (navBtns[idx]) navBtns[idx].classList.add('active');
    loadSection();
  };

  function loadSection() {
    const body = document.getElementById('kh-body');
    if (!body) return;
    body.innerHTML = '<div class="kh-loading">Loading…</div>';
    if (_section === 'dashboard')        loadDashboard(body);
    else if (_section === 'kb')              loadKB(body);
    else if (_section === 'research')        loadResearch(body);
    else if (_section === 'patterns')        loadPatterns(body);
    else if (_section === 'insights')        loadInsights(body);
    else if (_section === 'ke_insights')     loadKeInsights(body);
    else if (_section === 'case_studies')    loadCaseStudies(body);
    else if (_section === 'rec_intelligence') loadRecIntelligence(body);
    else if (_section === 'service_intel')   loadServiceIntelligence(body);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════
  async function loadDashboard(body) {
    try {
      const [entriesRes, analyticsRes, patternsRes, keRes] = await Promise.all([
        kbFetch('?section=entries'),
        rnFetch('?section=analytics'),
        rnFetch('?section=pattern_library'),
        keFetch('?section=dashboard'),
      ]);
      const entriesData   = await entriesRes.json();
      const analyticsData = await analyticsRes.json();
      const patternsData  = await patternsRes.json();
      const keData        = keRes.ok ? await keRes.json() : {};

      const entries    = entriesData.entries    || [];
      const analytics  = analyticsData.analytics || {};
      const patterns   = patternsData.patterns   || [];
      const km         = keData.metrics          || {};

      const publishedCount = entries.filter(e => e.status === 'published').length;
      const patternGroups  = patterns.length;
      const recent         = [...entries].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,5);

      const CONF_COLOR = { strong:'#22c98a', moderate:'#e8b84b', emerging:'#9b7fe8', candidate:'#4488ff', confirmed:'#22c98a', dismissed:'#cc4455' };

      body.innerHTML = `
<div class="kh-dashboard">
  <h2 class="kh-section-title">Knowledge Hub Dashboard</h2>

  <div class="kh-kpi-row">
    <div class="kh-kpi"><span class="kh-kpi-num">${entries.length}</span><span class="kh-kpi-lbl">KB Articles</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${publishedCount}</span><span class="kh-kpi-lbl">Published</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${analytics.totalNotes || 0}</span><span class="kh-kpi-lbl">Research Notes</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${patternGroups}</span><span class="kh-kpi-lbl">Tag Patterns</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${km.pattern_candidates ?? '—'}</span><span class="kh-kpi-lbl">Pattern Candidates</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${km.published_insights ?? '—'}</span><span class="kh-kpi-lbl">Published Insights</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${km.case_studies ?? '—'}</span><span class="kh-kpi-lbl">Case Studies</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${km.research_flags ?? '—'}</span><span class="kh-kpi-lbl">Research Flags</span></div>
    ${km.improvement_rate != null ? `<div class="kh-kpi"><span class="kh-kpi-num" style="color:#22c98a">${km.improvement_rate}%</span><span class="kh-kpi-lbl">Improvement Rate</span></div>` : ''}
  </div>

  <div class="kh-dash-grid">
    <div class="kh-dash-card">
      <h3 class="kh-dash-card-title">Recent KB Articles</h3>
      ${recent.length ? recent.map(e => `
        <div class="kh-recent-item">
          <span class="kh-recent-title">${esc(e.title)}</span>
          <span class="kh-status-badge kh-status-${esc(e.status)}">${esc(e.status)}</span>
        </div>`).join('') : '<div class="kh-empty-sm">No articles yet.</div>'}
    </div>
    <div class="kh-dash-card">
      <h3 class="kh-dash-card-title">Quick Actions</h3>
      <div class="kh-quick-actions">
        <button class="kh-qa-btn" onclick="khSection('kb');setTimeout(()=>window.khKbNewForm&&window.khKbNewForm(),300)">+ New Article</button>
        <button class="kh-qa-btn" onclick="khSection('research');setTimeout(()=>window.khRnNewForm&&window.khRnNewForm(),300)">+ New Research Note</button>
        <button class="kh-qa-btn" onclick="khSection('ke_insights');setTimeout(()=>window.khKeInsightNewForm&&window.khKeInsightNewForm(),300)">+ New Insight</button>
        <button class="kh-qa-btn" onclick="khSection('case_studies')">Case Studies</button>
        <button class="kh-qa-btn" onclick="khKeDetectPatterns()">⬡ Detect Patterns</button>
        <button class="kh-qa-btn" onclick="khSection('rec_intelligence')">Rec Intelligence</button>
      </div>
    </div>
    <div class="kh-dash-card">
      <h3 class="kh-dash-card-title">Pattern Pipeline</h3>
      ${(keData.recentPatterns||[]).length ? keData.recentPatterns.map(p => `
        <div class="kh-recent-item">
          <span class="kh-recent-title" style="font-size:12px">${esc(p.title||p.id)}</span>
          <span class="kh-status-badge" style="background:${CONF_COLOR[p.confidence_level]||'#aaa'}22;color:${CONF_COLOR[p.confidence_level]||'#aaa'}">${esc(p.confidence_level||'')}</span>
        </div>`).join('') : '<div class="kh-empty-sm">No patterns yet — click Detect Patterns.</div>'}
    </div>
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load dashboard: ${esc(e.message)}</div>`;
    }
  }

  window.khKeDetectPatterns = async function () {
    const body = document.getElementById('kh-body');
    if (body) body.innerHTML = '<div class="kh-loading">Running pattern detection…</div>';
    try {
      const res  = await keFetch('?section=detect');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Detection failed');
      alert(`Pattern detection complete: ${data.detected} patterns found, ${data.saved} saved.`);
      loadDashboard(document.getElementById('kh-body'));
    } catch (e) {
      alert('Pattern detection error: ' + e.message);
      loadDashboard(document.getElementById('kh-body'));
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE
  // ══════════════════════════════════════════════════════════════════════════
  async function loadKB(body) {
    try {
      const [entriesRes, catsRes] = await Promise.all([
        kbFetch('?section=entries'),
        kbFetch('?section=categories'),
      ]);
      const eData = await entriesRes.json();
      const cData = await catsRes.json();
      if (!entriesRes.ok) throw new Error(eData.error || 'API error');
      _kbEntries    = eData.entries    || [];
      _kbCategories = cData.categories || [];
      body.innerHTML = kbHTML();
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Knowledge Base: ${esc(e.message)}</div>`;
    }
  }

  function kbHTML() {
    const cats = [...new Set([...KB_CATEGORIES, ..._kbCategories])].sort();
    return `
<div class="kh-kb-wrap">
  <div class="kh-kb-header">
    <div class="kh-kb-title-row">
      <span class="kh-section-title">Knowledge Base</span>
      <button class="kh-btn-primary" onclick="khKbNewForm()">+ New Article</button>
    </div>
    <div class="kh-controls">
      <input class="kh-search" id="khKbSearch" type="text" placeholder="Search articles…"
        value="${esc(_kbSearch)}" oninput="khKbApplySearch(this.value)">
      <div class="kh-filters">
        <select class="kh-select" id="khKbCatFilter" onchange="khKbApplyFilters()">
          <option value="">All Categories</option>
          ${cats.map(c => `<option value="${esc(c)}"${_kbCatFilter===c?' selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="kh-select" id="khKbStatusFilter" onchange="khKbApplyFilters()">
          <option value="">All Statuses</option>
          ${KB_STATUSES.map(s => `<option value="${s}"${_kbStatusFilter===s?' selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>
  <div id="khKbFormWrap" style="display:none"></div>
  <div id="khKbListWrap">${kbListHTML(_kbEntries)}</div>
</div>`;
  }

  function kbListHTML(entries) {
    if (!entries.length) return '<div class="kh-empty">No articles yet. Create your first article.</div>';
    return '<div class="kh-kb-list" id="khKbList">' + entries.map(kbCardHTML).join('') + '</div>';
  }

  function kbCardHTML(e) {
    const tags    = (e.tags || []).map(t => `<span class="kh-tag">${esc(t)}</span>`).join('');
    const date    = e.created_at ? new Date(e.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    const preview = e.summary || (e.content ? e.content.slice(0,160).replace(/\n/g,' ') + (e.content.length>160?'…':'') : '');
    const pin     = e.is_pinned ? '<span class="kh-pin-badge">📌 Pinned</span>' : '';
    return `
<div class="kh-kb-card" id="khKbCard-${e.id}"
  data-category="${esc(e.category||'')}" data-status="${esc(e.status||'')}" data-pinned="${e.is_pinned?'1':'0'}">
  <div class="kh-kb-card-header">
    <span class="kh-kb-card-title">${esc(e.title)}</span>
    <div class="kh-kb-card-meta">
      ${pin}
      ${e.category?`<span class="kh-cat-badge">${esc(e.category)}</span>`:''}
      <span class="kh-status-badge kh-status-${esc(e.status||'draft')}">${esc(e.status||'draft')}</span>
      <span class="kh-card-date">${date}</span>
    </div>
  </div>
  ${preview?`<div class="kh-kb-card-preview">${esc(preview)}</div>`:''}
  ${tags?`<div class="kh-kb-card-tags">${tags}</div>`:''}
  <div class="kh-kb-card-actions">
    <button class="kh-btn-edit"   onclick="khKbStartEdit('${e.id}')">Edit</button>
    <button class="kh-btn-delete" onclick="khKbDelete('${e.id}','${esc(e.title)}')">Delete</button>
  </div>
</div>`;
  }

  function kbFormHTML(entry) {
    const e      = entry || {};
    const editId = e.id || '';
    const cats   = [...new Set([...KB_CATEGORIES, ..._kbCategories])].sort();
    const selCat = e.category || '';
    const selSt  = e.status || 'draft';
    const pinned = e.is_pinned ? ' checked' : '';
    return `
<form class="kh-form" onsubmit="khKbSave(event,'${editId}')">
  <div class="kh-form-row">
    <label class="kh-label">Title <span class="kh-req">*</span></label>
    <input class="kh-input" id="khKbTitle" type="text" placeholder="Article title" value="${esc(e.title||'')}" required>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Summary <span class="kh-hint">(short blurb shown on cards)</span></label>
    <input class="kh-input" id="khKbSummary" type="text" placeholder="Brief description…" value="${esc(e.summary||'')}">
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Content</label>
    <textarea class="kh-textarea" id="khKbContent" rows="6" placeholder="Full article content…">${esc(e.content||'')}</textarea>
  </div>
  <div class="kh-form-row kh-form-row--2col">
    <div>
      <label class="kh-label">Category</label>
      <select class="kh-select" id="khKbCategory">
        <option value="">— Select —</option>
        ${cats.map(c=>`<option value="${esc(c)}"${selCat===c?' selected':''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label class="kh-label">Status</label>
      <select class="kh-select" id="khKbStatus">
        ${KB_STATUSES.map(s=>`<option value="${s}"${s===selSt?' selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Tags <span class="kh-hint">(comma-separated)</span></label>
    <input class="kh-input" id="khKbTags" type="text" placeholder="e.g. clearing, protection"
      value="${esc((e.tags||[]).join(', '))}">
  </div>
  <div class="kh-form-row">
    <label class="kh-pin-label">
      <input type="checkbox" id="khKbIsPinned"${pinned}> Pin to top
    </label>
  </div>
  <div class="kh-form-actions">
    <button type="submit" class="kh-btn-primary">${editId?'Save Changes':'Create Article'}</button>
    <button type="button" class="kh-btn-cancel" onclick="khKbCancelForm()">Cancel</button>
  </div>
</form>`;
  }

  window.khKbNewForm = function () {
    const wrap = document.getElementById('khKbFormWrap');
    if (!wrap) return;
    wrap.innerHTML = kbFormHTML();
    wrap.style.display = 'block';
    const t = document.getElementById('khKbTitle');
    if (t) t.focus();
  };

  window.khKbCancelForm = function () {
    const wrap = document.getElementById('khKbFormWrap');
    if (wrap) wrap.style.display = 'none';
  };

  window.khKbStartEdit = function (id) {
    const card = document.getElementById('khKbCard-' + id);
    if (!card) return;
    const entry = {
      id,
      title:     (card.querySelector('.kh-kb-card-title')||{}).textContent || '',
      summary:   '',
      content:   '',
      category:  card.dataset.category || '',
      status:    card.dataset.status   || 'draft',
      is_pinned: card.dataset.pinned   === '1',
      tags:      Array.from(card.querySelectorAll('.kh-tag')).map(t => t.textContent),
    };
    const wrap = document.getElementById('khKbFormWrap');
    if (!wrap) return;
    wrap.innerHTML = kbFormHTML(entry);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.khKbSave = async function (evt, editId) {
    evt.preventDefault();
    const title    = (document.getElementById('khKbTitle')    ||{}).value || '';
    const summary  = (document.getElementById('khKbSummary')  ||{}).value || '';
    const content  = (document.getElementById('khKbContent')  ||{}).value || '';
    const category = (document.getElementById('khKbCategory') ||{}).value || '';
    const status   = (document.getElementById('khKbStatus')   ||{}).value || 'draft';
    const tagsRaw  = (document.getElementById('khKbTags')     ||{}).value || '';
    const isPinned = !!(document.getElementById('khKbIsPinned')||{}).checked;
    const tags     = tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
    if (!title.trim()) { alert('Title is required.'); return; }
    const body = { title:title.trim(), summary:summary||null, content:content||null,
                   category:category||null, status, is_pinned:isPinned, tags:tags.length?tags:null };
    try {
      const res = editId
        ? await kbFetch('?action=update_entry&id='+editId, {method:'PATCH', body:JSON.stringify(body)})
        : await kbFetch('?action=create_entry',            {method:'POST',  body:JSON.stringify(body)});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      window.khKbCancelForm();
      loadKB(document.getElementById('kh-body'));
    } catch (e) { alert('Error saving: ' + e.message); }
  };

  window.khKbDelete = async function (id, title) {
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    try {
      const res  = await kbFetch('?action=delete_entry&id='+id, {method:'PATCH', body:'{}'});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      loadKB(document.getElementById('kh-body'));
    } catch (e) { alert('Error deleting: ' + e.message); }
  };

  window.khKbApplySearch = function (q) {
    _kbSearch = q.toLowerCase();
    khKbFilterCards();
  };

  window.khKbApplyFilters = function () {
    _kbCatFilter    = (document.getElementById('khKbCatFilter')    ||{}).value || '';
    _kbStatusFilter = (document.getElementById('khKbStatusFilter') ||{}).value || '';
    khKbFilterCards();
  };

  function khKbFilterCards() {
    const list = document.getElementById('khKbList');
    if (!list) return;
    let visible = 0;
    list.querySelectorAll('.kh-kb-card').forEach(card => {
      const text     = card.textContent.toLowerCase();
      const matchS   = !_kbSearch       || text.includes(_kbSearch);
      const matchC   = !_kbCatFilter    || card.dataset.category === _kbCatFilter;
      const matchSt  = !_kbStatusFilter || card.dataset.status   === _kbStatusFilter;
      const show = matchS && matchC && matchSt;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    let empty = document.getElementById('khKbEmptyFilter');
    if (!visible && !empty) {
      empty = document.createElement('div');
      empty.id = 'khKbEmptyFilter'; empty.className = 'kh-empty';
      empty.textContent = 'No articles match the current filters.';
      list.appendChild(empty);
    } else if (visible && empty) { empty.remove(); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESEARCH NOTES
  // ══════════════════════════════════════════════════════════════════════════
  async function loadResearch(body) {
    try {
      const url = _rnSearch ? `?section=notes&search=${encodeURIComponent(_rnSearch)}` : '?section=notes';
      const res  = await rnFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      _rnNotes = data.notes || [];
      body.innerHTML = rnHTML();
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load research notes: ${esc(e.message)}</div>`;
    }
  }

  function rnHTML() {
    return `
<div class="kh-rn-wrap">
  <div class="kh-rn-header">
    <div class="kh-rn-title-row">
      <span class="kh-section-title">Research Notes</span>
      <button class="kh-btn-primary" onclick="khRnNewForm()">+ New Note</button>
    </div>
    <input class="kh-search" id="khRnSearch" type="text" placeholder="Search notes…"
      value="${esc(_rnSearch)}" oninput="khRnSearch(this.value)">
  </div>
  <div id="khRnFormWrap" style="display:none"></div>
  <div id="khRnList">${rnListHTML(_rnNotes)}</div>
</div>`;
  }

  function rnListHTML(notes) {
    if (!notes.length) return '<div class="kh-empty">No research notes yet.</div>';
    return notes.map(n => {
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
      const tags = (n.tags||[]).map(t=>`<span class="kh-tag">${esc(t)}</span>`).join('');
      return `
<div class="kh-rn-card" id="khRnCard-${n.id}" data-tags="${esc((n.tags||[]).join(','))}">
  <div class="kh-rn-header-row">
    <span class="kh-rn-title">${esc(n.title)}</span>
    <span class="kh-card-date">${date}</span>
  </div>
  ${n.content?`<div class="kh-rn-preview">${esc(n.content.slice(0,200))}${n.content.length>200?'…':''}</div>`:''}
  ${tags?`<div class="kh-rn-tags">${tags}</div>`:''}
  <div class="kh-kb-card-actions">
    <button class="kh-btn-edit"   onclick="khRnStartEdit('${n.id}')">Edit</button>
    <button class="kh-btn-delete" onclick="khRnDelete('${n.id}','${esc(n.title)}')">Delete</button>
  </div>
</div>`;
    }).join('');
  }

  function rnFormHTML(note) {
    const n = note || {};
    const editId = n.id || '';
    return `
<form class="kh-form" onsubmit="khRnSave(event,'${editId}')">
  <div class="kh-form-row">
    <label class="kh-label">Title <span class="kh-req">*</span></label>
    <input class="kh-input" id="khRnTitle" type="text" placeholder="Note title" value="${esc(n.title||'')}" required>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Content</label>
    <textarea class="kh-textarea" id="khRnContent" rows="6" placeholder="Note content…">${esc(n.content||'')}</textarea>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Tags <span class="kh-hint">(comma-separated)</span></label>
    <input class="kh-input" id="khRnTags" type="text" placeholder="e.g. clearing, protection"
      value="${esc((n.tags||[]).join(', '))}">
  </div>
  <div class="kh-form-actions">
    <button type="submit" class="kh-btn-primary">${editId?'Save Changes':'Create Note'}</button>
    <button type="button" class="kh-btn-cancel" onclick="khRnCancelForm()">Cancel</button>
  </div>
</form>`;
  }

  window.khRnNewForm = function () {
    const wrap = document.getElementById('khRnFormWrap');
    if (!wrap) return;
    wrap.innerHTML = rnFormHTML();
    wrap.style.display = 'block';
    const t = document.getElementById('khRnTitle');
    if (t) t.focus();
  };

  window.khRnCancelForm = function () {
    const wrap = document.getElementById('khRnFormWrap');
    if (wrap) wrap.style.display = 'none';
  };

  window.khRnStartEdit = function (id) {
    const card = document.getElementById('khRnCard-' + id);
    if (!card) return;
    const note = {
      id,
      title:   (card.querySelector('.kh-rn-title')||{}).textContent || '',
      content: '',
      tags:    (card.dataset.tags||'').split(',').filter(Boolean),
    };
    const wrap = document.getElementById('khRnFormWrap');
    if (!wrap) return;
    wrap.innerHTML = rnFormHTML(note);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.khRnSave = async function (evt, editId) {
    evt.preventDefault();
    const title   = (document.getElementById('khRnTitle')   ||{}).value || '';
    const content = (document.getElementById('khRnContent') ||{}).value || '';
    const tagsRaw = (document.getElementById('khRnTags')    ||{}).value || '';
    const tags    = tagsRaw.split(',').map(t=>t.trim()).filter(Boolean);
    if (!title.trim()) { alert('Title is required.'); return; }
    const body = { title:title.trim(), content:content||null, tags:tags.length?tags:null };
    try {
      const res = editId
        ? await rnFetch('?action=update_note&id='+editId, {method:'PATCH', body:JSON.stringify(body)})
        : await rnFetch('?action=create_note',            {method:'POST',  body:JSON.stringify(body)});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      window.khRnCancelForm();
      loadResearch(document.getElementById('kh-body'));
    } catch (e) { alert('Error saving note: ' + e.message); }
  };

  window.khRnDelete = async function (id, title) {
    if (!confirm('Delete "'+title+'"? This cannot be undone.')) return;
    try {
      const res  = await rnFetch('?action=delete_note&id='+id, {method:'PATCH', body:'{}'});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      loadResearch(document.getElementById('kh-body'));
    } catch (e) { alert('Error deleting: ' + e.message); }
  };

  window.khRnSearch = function (q) {
    _rnSearch = q;
    loadResearch(document.getElementById('kh-body'));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PATTERN LIBRARY
  // ══════════════════════════════════════════════════════════════════════════
  async function loadPatterns(body) {
    const search = (document.getElementById('khPlSearch')||{}).value || '';
    try {
      const url = search ? `?section=pattern_library&search=${encodeURIComponent(search)}` : '?section=pattern_library';
      const res  = await rnFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      body.innerHTML = plHTML(data.patterns || []);
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Pattern Library: ${esc(e.message)}</div>`;
    }
  }

  function plHTML(patterns) {
    return `
<div class="kh-pl-wrap">
  <div class="kh-pl-header">
    <span class="kh-section-title">Pattern Library</span>
    <input class="kh-search" id="khPlSearch" type="text" placeholder="Filter patterns…"
      oninput="khPlFilter(this.value)">
  </div>
  ${patterns.length ? `
  <div class="kh-pl-grid">
    ${patterns.map(p => `
    <div class="kh-pl-card">
      <div class="kh-pl-tag">${esc(p.tag)}</div>
      <div class="kh-pl-count">${p.count} note${p.count!==1?'s':''}</div>
      ${(p.excerpts||[]).length ? `<div class="kh-pl-excerpts">${p.excerpts.slice(0,2).map(x=>`<div class="kh-pl-excerpt">"${esc(x)}"</div>`).join('')}</div>` : ''}
    </div>`).join('')}
  </div>` : '<div class="kh-empty">No patterns found.</div>'}
</div>`;
  }

  window.khPlFilter = function (q) {
    const body = document.getElementById('kh-body');
    if (!body) return;
    const oldInput = q;
    loadPatterns({ innerHTML: '' }).then ? undefined : undefined;
    const bWrap = document.getElementById('kh-body');
    if (bWrap) {
      bWrap.innerHTML = '<div class="kh-loading">Loading…</div>';
      loadPatterns(bWrap);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // INSIGHTS FEED
  // ══════════════════════════════════════════════════════════════════════════
  async function loadInsights(body) {
    try {
      const res  = await rnFetch('?section=insights');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      body.innerHTML = insightsHTML(data);
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Insights: ${esc(e.message)}</div>`;
    }
  }

  function barHTML(label, count, max) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return `
<div class="kh-bar-row">
  <span class="kh-bar-label">${esc(label)}</span>
  <div class="kh-bar-track"><div class="kh-bar-fill" style="width:${pct}%"></div></div>
  <span class="kh-bar-val">${count}</span>
</div>`;
  }

  function insightsHTML(data) {
    const topTags    = data.top_tags      || [];
    const sharedTags = data.shared_tags   || [];
    const modalities = data.modalities    || [];
    const emotions   = data.emotional_themes || [];
    const maxTT = topTags.reduce((m,t)=>Math.max(m,t.count),0);
    const maxST = sharedTags.reduce((m,t)=>Math.max(m,t.count),0);
    const maxMo = modalities.reduce((m,t)=>Math.max(m,t.count),0);
    const maxEm = emotions.reduce((m,t)=>Math.max(m,t.count),0);
    return `
<div class="kh-insights-wrap">
  <h2 class="kh-section-title">Insights Feed</h2>
  <div class="kh-insights-grid">
    <div class="kh-insight-card">
      <h3 class="kh-insight-title">Top Tags</h3>
      ${topTags.length ? topTags.map(t=>barHTML(t.tag,t.count,maxTT)).join('') : '<div class="kh-empty-sm">No data yet.</div>'}
    </div>
    <div class="kh-insight-card">
      <h3 class="kh-insight-title">Cross-Client Tags</h3>
      ${sharedTags.length ? sharedTags.map(t=>barHTML(t.tag,t.count,maxST)).join('') : '<div class="kh-empty-sm">No cross-client data.</div>'}
    </div>
    <div class="kh-insight-card">
      <h3 class="kh-insight-title">Modalities Mentioned</h3>
      ${modalities.length ? modalities.map(t=>barHTML(t.modality,t.count,maxMo)).join('') : '<div class="kh-empty-sm">No modalities detected.</div>'}
    </div>
    <div class="kh-insight-card">
      <h3 class="kh-insight-title">Emotional Themes</h3>
      ${emotions.length ? emotions.map(t=>barHTML(t.theme,t.count,maxEm)).join('') : '<div class="kh-empty-sm">No emotional themes detected.</div>'}
    </div>
  </div>
</div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESEARCH INSIGHTS (structured, from knowledge-engine)
  // ══════════════════════════════════════════════════════════════════════════
  const CONF_COLORS = { emerging:'#9b7fe8', moderate:'#e8b84b', strong:'#22c98a' };
  const CONTENT_TAG_LABELS = { book_idea:'📖 Book Idea', training_material:'🎓 Training', youtube_content:'▶ YouTube', social_media:'◎ Social', research_publication:'◈ Research' };

  async function loadKeInsights(body) {
    try {
      const res  = await keFetch('?section=insights');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      const insights = data.insights || [];
      body.innerHTML = `
<div class="kh-ke-wrap">
  <div class="kh-kb-header">
    <div class="kh-kb-title-row">
      <span class="kh-section-title">Research Insights</span>
      <button class="kh-btn-primary" onclick="khKeInsightNewForm()">+ New Insight</button>
    </div>
    <div style="font-size:12px;color:#dddaee55;margin-top:4px">Structured insights derived from session outcomes and patterns. Tag for content use.</div>
  </div>
  <div id="khKeInsightFormWrap" style="display:none"></div>
  <div id="khKeInsightList">
    ${insights.length ? insights.map(ins => keInsightCardHTML(ins)).join('') : '<div class="kh-empty">No research insights yet. Create your first insight or run Pattern Detection to generate candidates.</div>'}
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Research Insights: ${esc(e.message)}</div>`;
    }
  }

  function keInsightCardHTML(ins) {
    const confColor  = CONF_COLORS[ins.confidence_level] || '#dddaee';
    const ctags      = (ins.content_tags || []).map(t => `<span class="kh-tag" style="color:#9b7fe8;border-color:#9b7fe855">${CONTENT_TAG_LABELS[t]||esc(t)}</span>`).join('');
    const statusColor = ins.status === 'published' ? '#22c98a' : ins.status === 'under_review' ? '#e8b84b' : '#dddaee44';
    const date = ins.created_at ? new Date(ins.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `
<div class="kh-ke-card" id="khKeInsight-${ins.id}">
  <div class="kh-kb-card-header">
    <span class="kh-kb-card-title">${esc(ins.title)}</span>
    <div class="kh-kb-card-meta">
      <span class="kh-cat-badge">${esc(ins.category)}</span>
      <span class="kh-status-badge" style="color:${confColor};background:${confColor}22">${esc(ins.confidence_level)}</span>
      <span class="kh-status-badge" style="color:${statusColor}">${esc(ins.status)}</span>
      <span class="kh-card-date">${date}</span>
    </div>
  </div>
  <div class="kh-kb-card-preview">${esc(ins.description)}</div>
  ${ins.practitioner_notes ? `<div class="kh-rn-preview" style="color:#dddaee66;font-style:italic">${esc(ins.practitioner_notes)}</div>` : ''}
  ${ctags ? `<div class="kh-kb-card-tags">${ctags}</div>` : ''}
  <div class="kh-kb-card-actions">
    <button class="kh-btn-edit"   onclick="khKeInsightEdit(${JSON.stringify(ins).replace(/"/g,'&quot;')})">Edit</button>
    <button class="kh-btn-edit"   onclick="khKeInsightPublish('${ins.id}','${ins.status}')" style="color:#22c98a">${ins.status==='published'?'Unpublish':'Publish'}</button>
  </div>
</div>`;
  }

  window.khKeInsightNewForm = function () {
    const wrap = document.getElementById('khKeInsightFormWrap');
    if (!wrap) return;
    wrap.innerHTML = keInsightFormHTML({});
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  window.khKeInsightEdit = function (ins) {
    const wrap = document.getElementById('khKeInsightFormWrap');
    if (!wrap) return;
    wrap.innerHTML = keInsightFormHTML(ins);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  window.khKeInsightPublish = async function (id, currentStatus) {
    const newStatus = currentStatus === 'published' ? 'draft' : 'published';
    try {
      const res = await keFetch('?id='+id+'&type=insight', { method:'PATCH', body: JSON.stringify({ status: newStatus }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed');
      loadKeInsights(document.getElementById('kh-body'));
    } catch (e) { alert('Error: ' + e.message); }
  };

  function keInsightFormHTML(ins) {
    const CATEGORIES = ['outcome','recommendation','retention','service','client_pattern','intervention','other'];
    const STATUSES   = ['draft','under_review','published','archived'];
    const CTAG_OPTS  = Object.entries(CONTENT_TAG_LABELS);
    const selCat  = ins.category || 'other';
    const selSt   = ins.status   || 'draft';
    const selConf = ins.confidence_level || 'emerging';
    const editId  = ins.id || '';
    const ctags   = ins.content_tags || [];
    return `
<form class="kh-form" onsubmit="khKeInsightSave(event,'${editId}')">
  <div class="kh-form-row">
    <label class="kh-label">Title <span class="kh-req">*</span></label>
    <input class="kh-input" id="khKeInsTitle" type="text" value="${esc(ins.title||'')}" required placeholder="E.g. Grounding practices improve outcomes for energetically overwhelmed clients">
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Description <span class="kh-req">*</span></label>
    <textarea class="kh-textarea" id="khKeInsDesc" rows="4" required placeholder="Full description of the insight…">${esc(ins.description||'')}</textarea>
  </div>
  <div class="kh-form-row kh-form-row--2col">
    <div>
      <label class="kh-label">Category</label>
      <select class="kh-select" id="khKeInsCat">
        ${CATEGORIES.map(c=>`<option value="${c}"${c===selCat?' selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div>
      <label class="kh-label">Confidence</label>
      <select class="kh-select" id="khKeInsConf">
        <option value="emerging"${selConf==='emerging'?' selected':''}>Emerging (3+ sessions)</option>
        <option value="moderate"${selConf==='moderate'?' selected':''}>Moderate (6+ sessions)</option>
        <option value="strong"${selConf==='strong'?' selected':''}>Strong (10+ sessions)</option>
      </select>
    </div>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Status</label>
    <select class="kh-select" id="khKeInsSt">
      ${STATUSES.map(s=>`<option value="${s}"${s===selSt?' selected':''}>${s}</option>`).join('')}
    </select>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Content Tags <span class="kh-hint">(what can this become?)</span></label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
      ${CTAG_OPTS.map(([val,lbl])=>`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#dddaee"><input type="checkbox" name="ke_ctag" value="${val}"${ctags.includes(val)?' checked':''}> ${lbl}</label>`).join('')}
    </div>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Practitioner Notes</label>
    <textarea class="kh-textarea" id="khKeInsNotes" rows="2" placeholder="Optional notes for Daron…">${esc(ins.practitioner_notes||'')}</textarea>
  </div>
  <div class="kh-form-actions">
    <button type="submit" class="kh-btn-primary">${editId?'Save Changes':'Create Insight'}</button>
    <button type="button" class="kh-btn-cancel" onclick="document.getElementById('khKeInsightFormWrap').style.display='none'">Cancel</button>
  </div>
</form>`;
  }

  window.khKeInsightSave = async function (evt, editId) {
    evt.preventDefault();
    const title   = (document.getElementById('khKeInsTitle') ||{}).value || '';
    const desc    = (document.getElementById('khKeInsDesc')  ||{}).value || '';
    const cat     = (document.getElementById('khKeInsCat')   ||{}).value || 'other';
    const conf    = (document.getElementById('khKeInsConf')  ||{}).value || 'emerging';
    const st      = (document.getElementById('khKeInsSt')    ||{}).value || 'draft';
    const notes   = (document.getElementById('khKeInsNotes') ||{}).value || '';
    const ctags   = Array.from(document.querySelectorAll('input[name="ke_ctag"]:checked')).map(cb => cb.value);
    if (!title.trim() || !desc.trim()) { alert('Title and description are required.'); return; }
    const body = { type:'insight', title:title.trim(), description:desc.trim(), category:cat, confidence_level:conf, status:st, practitioner_notes:notes||null, content_tags:ctags.length?ctags:null };
    try {
      const res = editId
        ? await keFetch('?id='+editId+'&type=insight', { method:'PATCH', body:JSON.stringify(body) })
        : await keFetch('', { method:'POST', body:JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      document.getElementById('khKeInsightFormWrap').style.display = 'none';
      loadKeInsights(document.getElementById('kh-body'));
    } catch (e) { alert('Error saving: ' + e.message); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // CASE STUDIES
  // ══════════════════════════════════════════════════════════════════════════
  async function loadCaseStudies(body) {
    try {
      const res  = await keFetch('?section=case_studies');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      const studies = data.case_studies || [];
      body.innerHTML = `
<div class="kh-ke-wrap">
  <div class="kh-kb-header">
    <div class="kh-kb-title-row">
      <span class="kh-section-title">Case Studies</span>
      <button class="kh-btn-primary" onclick="khCsNewForm()">+ New Case Study</button>
    </div>
    <div style="font-size:12px;color:#dddaee55;margin-top:4px">Generated from session + outcome data. All anonymized by default. Export for training, content, or research.</div>
  </div>
  <div id="khCsFormWrap" style="display:none"></div>
  <div id="khCsList">
    ${studies.length ? studies.map(cs => keCsCardHTML(cs)).join('') : '<div class="kh-empty">No case studies yet. Generate one from a completed session outcome, or create manually.</div>'}
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Case Studies: ${esc(e.message)}</div>`;
    }
  }

  function keCsCardHTML(cs) {
    const statusColor = cs.status === 'published' ? '#22c98a' : cs.status === 'under_review' ? '#e8b84b' : '#dddaee44';
    const catColor    = {improved:'#22c98a',no_change:'#e8b84b',worse:'#ff4455',mixed:'#9b7fe8'}[cs.outcome_category] || '#dddaee44';
    const ctags       = (cs.content_tags||[]).map(t=>`<span class="kh-tag" style="color:#9b7fe8;border-color:#9b7fe855">${CONTENT_TAG_LABELS[t]||esc(t)}</span>`).join('');
    const date        = cs.created_at ? new Date(cs.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `
<div class="kh-ke-card" id="khCs-${cs.id}">
  <div class="kh-kb-card-header">
    <span class="kh-kb-card-title">${esc(cs.title || cs.client_alias || 'Untitled Case Study')}</span>
    <div class="kh-kb-card-meta">
      ${cs.service ? `<span class="kh-cat-badge">${esc(cs.service)}</span>` : ''}
      ${cs.outcome_category ? `<span class="kh-status-badge" style="color:${catColor}">${esc(cs.outcome_category.replace('_',' '))}</span>` : ''}
      ${cs.improvement_level ? `<span class="kh-status-badge" style="color:#4488ff">Level ${cs.improvement_level}/10</span>` : ''}
      <span class="kh-status-badge" style="color:${statusColor}">${esc(cs.status)}</span>
      <span class="kh-card-date">${date}</span>
    </div>
  </div>
  ${cs.problem     ? `<div class="kh-cs-section"><span class="kh-cs-label">Problem:</span> ${esc(cs.problem.slice(0,180))}${cs.problem.length>180?'…':''}</div>` : ''}
  ${cs.intervention? `<div class="kh-cs-section"><span class="kh-cs-label">Intervention:</span> ${esc(cs.intervention.slice(0,120))}${cs.intervention.length>120?'…':''}</div>` : ''}
  ${cs.outcome     ? `<div class="kh-cs-section"><span class="kh-cs-label">Outcome:</span> ${esc(cs.outcome.slice(0,120))}${cs.outcome.length>120?'…':''}</div>` : ''}
  ${ctags ? `<div class="kh-kb-card-tags">${ctags}</div>` : ''}
  <div class="kh-kb-card-actions">
    <button class="kh-btn-edit" onclick="khCsEdit(${JSON.stringify(cs).replace(/"/g,'&quot;')})">Edit</button>
    <button class="kh-btn-edit" onclick="khCsPublish('${cs.id}','${cs.status}')" style="color:#22c98a">${cs.status==='published'?'Unpublish':'Publish'}</button>
  </div>
</div>`;
  }

  window.khCsNewForm = function () {
    const wrap = document.getElementById('khCsFormWrap');
    if (!wrap) return;
    wrap.innerHTML = keCsFormHTML({});
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  window.khCsEdit = function (cs) {
    const wrap = document.getElementById('khCsFormWrap');
    if (!wrap) return;
    wrap.innerHTML = keCsFormHTML(cs);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  window.khCsPublish = async function (id, currentStatus) {
    const newStatus = currentStatus === 'published' ? 'draft' : 'published';
    try {
      const res = await keFetch('?id='+id+'&type=case_study', { method:'PATCH', body:JSON.stringify({ status:newStatus }) });
      if (!res.ok) throw new Error((await res.json()).error||'Update failed');
      loadCaseStudies(document.getElementById('kh-body'));
    } catch (e) { alert('Error: '+e.message); }
  };

  function keCsFormHTML(cs) {
    const STATUSES = ['draft','under_review','published','archived'];
    const CTAG_OPTS = Object.entries(CONTENT_TAG_LABELS);
    const editId = cs.id || '';
    const ctags  = cs.content_tags || [];
    return `
<form class="kh-form" onsubmit="khCsSave(event,'${editId}')">
  <div class="kh-form-row kh-form-row--2col">
    <div>
      <label class="kh-label">Title</label>
      <input class="kh-input" id="khCsTitle" type="text" value="${esc(cs.title||'')}" placeholder="Case study title">
    </div>
    <div>
      <label class="kh-label">Client Alias</label>
      <input class="kh-input" id="khCsAlias" type="text" value="${esc(cs.client_alias||'')}" placeholder="e.g. Client 247">
    </div>
  </div>
  <div class="kh-form-row kh-form-row--2col">
    <div>
      <label class="kh-label">Service</label>
      <input class="kh-input" id="khCsService" type="text" value="${esc(cs.service||'')}" placeholder="e.g. Distance Healing">
    </div>
    <div>
      <label class="kh-label">Outcome Category</label>
      <select class="kh-select" id="khCsOutcome">
        <option value="">— Select —</option>
        ${['improved','no_change','worse','mixed'].map(o=>`<option value="${o}"${cs.outcome_category===o?' selected':''}>${o}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Problem</label>
    <textarea class="kh-textarea" id="khCsProblem" rows="3" placeholder="What was the client's presenting issue or energetic concern?">${esc(cs.problem||'')}</textarea>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Intervention</label>
    <textarea class="kh-textarea" id="khCsIntervention" rows="3" placeholder="What service, protocol, or approach was used?">${esc(cs.intervention||'')}</textarea>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Outcome</label>
    <textarea class="kh-textarea" id="khCsOutcomeText" rows="3" placeholder="What results were observed or reported?">${esc(cs.outcome||'')}</textarea>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Lessons Learned</label>
    <textarea class="kh-textarea" id="khCsLessons" rows="2" placeholder="What would you do differently or recommend to other practitioners?">${esc(cs.lessons_learned||'')}</textarea>
  </div>
  <div class="kh-form-row kh-form-row--2col">
    <div>
      <label class="kh-label">Status</label>
      <select class="kh-select" id="khCsStatus">
        ${STATUSES.map(s=>`<option value="${s}"${s===(cs.status||'draft')?' selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div>
      <label class="kh-label">Improvement Level (1–10)</label>
      <input class="kh-input" id="khCsLevel" type="number" min="1" max="10" value="${cs.improvement_level||''}" placeholder="1–10">
    </div>
  </div>
  <div class="kh-form-row">
    <label class="kh-label">Content Tags</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
      ${CTAG_OPTS.map(([val,lbl])=>`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#dddaee"><input type="checkbox" name="cs_ctag" value="${val}"${ctags.includes(val)?' checked':''}> ${lbl}</label>`).join('')}
    </div>
  </div>
  <div class="kh-form-actions">
    <button type="submit" class="kh-btn-primary">${editId?'Save Changes':'Create Case Study'}</button>
    <button type="button" class="kh-btn-cancel" onclick="document.getElementById('khCsFormWrap').style.display='none'">Cancel</button>
  </div>
</form>`;
  }

  window.khCsSave = async function (evt, editId) {
    evt.preventDefault();
    const ctags = Array.from(document.querySelectorAll('input[name="cs_ctag"]:checked')).map(cb=>cb.value);
    const level = parseInt(document.getElementById('khCsLevel')?.value||'');
    const body = {
      type:             'case_study',
      title:            document.getElementById('khCsTitle')?.value.trim()       || null,
      client_alias:     document.getElementById('khCsAlias')?.value.trim()       || null,
      service:          document.getElementById('khCsService')?.value.trim()     || null,
      problem:          document.getElementById('khCsProblem')?.value.trim()     || null,
      intervention:     document.getElementById('khCsIntervention')?.value.trim()|| null,
      outcome:          document.getElementById('khCsOutcomeText')?.value.trim() || null,
      lessons_learned:  document.getElementById('khCsLessons')?.value.trim()     || null,
      outcome_category: document.getElementById('khCsOutcome')?.value            || null,
      status:           document.getElementById('khCsStatus')?.value             || 'draft',
      improvement_level: isNaN(level) ? null : level,
      content_tags:     ctags.length ? ctags : null,
    };
    try {
      const res = editId
        ? await keFetch('?id='+editId+'&type=case_study', { method:'PATCH', body:JSON.stringify(body) })
        : await keFetch('', { method:'POST', body:JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error||'Save failed');
      document.getElementById('khCsFormWrap').style.display = 'none';
      loadCaseStudies(document.getElementById('kh-body'));
    } catch (e) { alert('Error: '+e.message); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RECOMMENDATION INTELLIGENCE
  // ══════════════════════════════════════════════════════════════════════════
  async function loadRecIntelligence(body) {
    try {
      const res  = await keFetch('?section=rec_intelligence');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'API error');
      const top  = data.topRecommendations || [];
      const cats = data.byCategory || [];
      const s    = data.summary    || {};

      function bar(pct, color) {
        return `<div style="flex:1;height:5px;background:#e8b84b0f;border-radius:1px"><div style="height:5px;width:${Math.max(pct,2)}%;background:${color};border-radius:1px"></div></div>`;
      }

      body.innerHTML = `
<div class="kh-ke-wrap">
  <h2 class="kh-section-title">Recommendation Intelligence</h2>
  <div style="font-size:13px;color:#dddaee55;margin-bottom:16px">Which recommendations are clients actually adopting and finding helpful? Track every product recommendation to completion.</div>

  <div class="kh-kpi-row" style="margin-bottom:24px">
    <div class="kh-kpi"><span class="kh-kpi-num">${s.total || 0}</span><span class="kh-kpi-lbl">Total Recs</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num" style="color:#e8b84b">${esc(s.topProduct||'—')}</span><span class="kh-kpi-lbl">Top Product</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num" style="color:#9b7fe8">${esc(s.topCategory||'—')}</span><span class="kh-kpi-lbl">Top Category</span></div>
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:28px">
    <div class="kh-dash-card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-family:'Cinzel',serif;font-size:10px;letter-spacing:.2em;color:#e8b84b88;text-transform:uppercase;border-bottom:1px solid #e8b84b08">Top Recommendations by Helpfulness</div>
      ${top.slice(0,12).map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #e8b84b08">
          <div style="flex:1">
            <div style="font-family:'Cinzel',serif;font-size:12px;color:#f0ecff">${esc(r.name)}</div>
            <div style="font-size:11px;color:#dddaee55">${esc(r.category||'—')} · ${r.total} recs</div>
          </div>
          ${bar(r.helpfulRate,'#22c98a')}
          <span style="font-family:'Cinzel',serif;font-size:13px;color:#22c98a;width:36px;text-align:right">${r.helpfulRate}%</span>
        </div>`).join('')}
    </div>
    <div class="kh-dash-card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;font-family:'Cinzel',serif;font-size:10px;letter-spacing:.2em;color:#e8b84b88;text-transform:uppercase;border-bottom:1px solid #e8b84b08">By Category</div>
      ${cats.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #e8b84b08">
          <div style="flex:1;font-family:'Cinzel',serif;font-size:12px;color:#dddaee">${esc(c.category)}</div>
          ${bar(c.helpfulRate,'#9b7fe8')}
          <span style="font-family:'Cinzel',serif;font-size:13px;color:#9b7fe8;width:36px;text-align:right">${c.helpfulRate}%</span>
        </div>`).join('')}
    </div>
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Recommendation Intelligence: ${esc(e.message)}</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SERVICE INTELLIGENCE
  // ══════════════════════════════════════════════════════════════════════════
  async function loadServiceIntelligence(body) {
    try {
      const res  = await keFetch('?section=service_intelligence');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'API error');
      const services = data.services || [];
      const s        = data.summary  || {};

      const maxSessions = Math.max(1, ...services.map(sv=>sv.totalSessions));

      body.innerHTML = `
<div class="kh-ke-wrap">
  <h2 class="kh-section-title">Service Intelligence</h2>
  <div style="font-size:13px;color:#dddaee55;margin-bottom:16px">How does each service type perform on outcomes, retention, and follow-ups?</div>

  <div class="kh-kpi-row" style="margin-bottom:24px">
    <div class="kh-kpi"><span class="kh-kpi-num">${s.totalServices || 0}</span><span class="kh-kpi-lbl">Services</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num" style="color:#22c98a">${esc(s.topByImprovement||'—')}</span><span class="kh-kpi-lbl">Best Outcomes</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num" style="color:#9b7fe8">${esc(s.topByRetention||'—')}</span><span class="kh-kpi-lbl">Highest Retention</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num" style="color:#4488ff">${esc(s.topByFollowUp||'—')}</span><span class="kh-kpi-lbl">Most Follow-Ups</span></div>
  </div>

  <div class="kh-dash-card" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.2em;color:#e8b84b88;text-transform:uppercase;border-bottom:1px solid #e8b84b22">
      <span>Service</span><span style="text-align:center">Sessions</span><span style="text-align:center">Improvement</span><span style="text-align:center">Repeat Rate</span><span style="text-align:center">State Delta</span><span style="text-align:center">Follow-Up</span>
    </div>
    ${services.map(sv => {
      const impColor  = (sv.improvementRate||0) >= 70 ? '#22c98a' : (sv.improvementRate||0) >= 40 ? '#e8b84b' : '#dddaee55';
      const retColor  = (sv.repeatRate||0)      >= 40 ? '#9b7fe8' : '#dddaee55';
      const deltaColor = (sv.avgStateDelta||0)  >  0  ? '#22c98a' : (sv.avgStateDelta||0) < 0 ? '#ff4455' : '#dddaee44';
      return `<div style="padding:12px 16px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;align-items:center;border-bottom:1px solid #e8b84b08">
        <span style="font-family:'Cinzel',serif;font-size:12px;color:#f0ecff">${esc(sv.service)}</span>
        <span style="text-align:center;font-family:'Cinzel',serif;font-size:13px;color:#dddaee">${sv.totalSessions}</span>
        <span style="text-align:center;font-family:'Cinzel',serif;font-size:13px;color:${impColor}">${sv.improvementRate != null ? sv.improvementRate+'%' : '—'}</span>
        <span style="text-align:center;font-family:'Cinzel',serif;font-size:13px;color:${retColor}">${sv.repeatRate}%</span>
        <span style="text-align:center;font-family:'Cinzel',serif;font-size:13px;color:${deltaColor}">${sv.avgStateDelta != null ? (sv.avgStateDelta>0?'+':'')+sv.avgStateDelta : '—'}</span>
        <span style="text-align:center;font-family:'Cinzel',serif;font-size:13px;color:#4488ff">${sv.followUpRate != null ? sv.followUpRate+'%' : '—'}</span>
      </div>`;
    }).join('')}
    ${!services.length ? '<div style="padding:24px;text-align:center;color:#dddaee44;font-style:italic">No session data yet.</div>' : ''}
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load Service Intelligence: ${esc(e.message)}</div>`;
    }
  }

})();
