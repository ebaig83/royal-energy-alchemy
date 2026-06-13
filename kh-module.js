(function () {
  'use strict';

  const KB_API  = '/.netlify/functions/kb';
  const RN_API  = '/.netlify/functions/research';

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
    <button class="kh-snav${_section==='dashboard'   ?' active':''}" onclick="khSection('dashboard')">Dashboard</button>
    <button class="kh-snav${_section==='kb'          ?' active':''}" onclick="khSection('kb')">Knowledge Base</button>
    <button class="kh-snav${_section==='research'    ?' active':''}" onclick="khSection('research')">Research</button>
    <button class="kh-snav${_section==='patterns'    ?' active':''}" onclick="khSection('patterns')">Pattern Library</button>
    <button class="kh-snav${_section==='insights'    ?' active':''}" onclick="khSection('insights')">Insights Feed</button>
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
    const names = ['dashboard','kb','research','patterns','insights'];
    const idx = names.indexOf(name);
    const navBtns = el.querySelectorAll('.kh-snav');
    if (navBtns[idx]) navBtns[idx].classList.add('active');
    loadSection();
  };

  function loadSection() {
    const body = document.getElementById('kh-body');
    if (!body) return;
    body.innerHTML = '<div class="kh-loading">Loading…</div>';
    if (_section === 'dashboard') loadDashboard(body);
    else if (_section === 'kb')       loadKB(body);
    else if (_section === 'research') loadResearch(body);
    else if (_section === 'patterns') loadPatterns(body);
    else if (_section === 'insights') loadInsights(body);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════
  async function loadDashboard(body) {
    try {
      const [entriesRes, analyticsRes, patternsRes] = await Promise.all([
        kbFetch('?section=entries'),
        rnFetch('?section=analytics'),
        rnFetch('?section=pattern_library'),
      ]);
      const entriesData   = await entriesRes.json();
      const analyticsData = await analyticsRes.json();
      const patternsData  = await patternsRes.json();

      const entries    = entriesData.entries    || [];
      const analytics  = analyticsData.analytics || {};
      const patterns   = patternsData.patterns   || [];

      const publishedCount = entries.filter(e => e.status === 'published').length;
      const patternGroups  = patterns.length;
      const recent         = [...entries].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
      const recentNotes    = (analyticsData.recent_notes || []).slice(0,5);

      body.innerHTML = `
<div class="kh-dashboard">
  <h2 class="kh-section-title">Knowledge Hub Dashboard</h2>

  <div class="kh-kpi-row">
    <div class="kh-kpi"><span class="kh-kpi-num">${entries.length}</span><span class="kh-kpi-lbl">Total Articles</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${publishedCount}</span><span class="kh-kpi-lbl">Published</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${analytics.totalNotes || 0}</span><span class="kh-kpi-lbl">Research Notes</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${analytics.activeTags || 0}</span><span class="kh-kpi-lbl">Active Tags</span></div>
    <div class="kh-kpi"><span class="kh-kpi-num">${patternGroups}</span><span class="kh-kpi-lbl">Pattern Groups</span></div>
  </div>

  <div class="kh-dash-grid">
    <div class="kh-dash-card">
      <h3 class="kh-dash-card-title">Recent Articles</h3>
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
        <button class="kh-qa-btn" onclick="khSection('patterns')">Browse Patterns</button>
        <button class="kh-qa-btn" onclick="khSection('insights')">View Insights</button>
      </div>
    </div>
  </div>
</div>`;
    } catch (e) {
      body.innerHTML = `<div class="kh-error">Could not load dashboard: ${esc(e.message)}</div>`;
    }
  }

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

})();
