(function () {
  'use strict';

  const API = '/.netlify/functions/research';

  function token() { return sessionStorage.getItem('rea_api_token') || ''; }

  function apiFetch(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { 'X-Dashboard-Token': token(), 'Content-Type': 'application/json' },
    }, opts));
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Active sub-nav section: 'notes' | 'patterns' | 'insights'
  let _section = 'notes';
  // Cached analytics for KPI bar
  let _analytics = null;

  // ── Entry point (called by showTab) ─────────────────────────────────────
  window.rnInit = function () {
    _section = 'notes';
    renderShell();
    loadAnalytics();
    renderSection();
  };

  // ── Shell: outer layout with sub-nav ─────────────────────────────────────
  function renderShell() {
    const el = document.getElementById('tab-research');
    if (!el) return;
    el.innerHTML = `
<div class="rn-wrap">
  <div class="rn-header">
    <div class="rn-title-row">
      <span class="rn-title">Research</span>
    </div>
    <div class="rn-kpi-bar" id="rnKpiBar"><div class="rn-empty" style="font-size:12px">Loading analytics…</div></div>
  </div>

  <nav class="rn-subnav">
    <button class="rn-snav active" id="rnSnav-notes"     onclick="rnSection('notes')">Notes</button>
    <button class="rn-snav"        id="rnSnav-patterns"  onclick="rnSection('patterns')">Pattern Library</button>
    <button class="rn-snav"        id="rnSnav-insights"  onclick="rnSection('insights')">Insights Feed</button>
  </nav>

  <div id="rnSectionBody"></div>
</div>`;
  }

  // ── Sub-nav routing ───────────────────────────────────────────────────────
  window.rnSection = function (name) {
    _section = name;
    document.querySelectorAll('.rn-snav').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('rnSnav-' + name);
    if (btn) btn.classList.add('active');
    renderSection();
  };

  function renderSection() {
    if (_section === 'notes')    renderNotes();
    if (_section === 'patterns') renderPatterns();
    if (_section === 'insights') renderInsights();
  }

  // ── Analytics KPI bar (non-blocking) ─────────────────────────────────────
  async function loadAnalytics() {
    try {
      const res  = await apiFetch('?section=analytics');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      _analytics = data;
      renderKpiBar(data);
    } catch (e) {
      const bar = document.getElementById('rnKpiBar');
      if (bar) bar.innerHTML = '<div class="rn-empty" style="font-size:12px">Analytics unavailable.</div>';
    }
  }

  function renderKpiBar(d) {
    const bar = document.getElementById('rnKpiBar');
    if (!bar) return;
    const topTag = d.mostCommonTag ? `<span class="rn-kpi-val">${esc(d.mostCommonTag)}</span>` : '<span class="rn-kpi-val">—</span>';
    bar.innerHTML = `
<div class="rn-kpi-row">
  <div class="rn-kpi"><span class="rn-kpi-val">${d.totalNotes || 0}</span><span class="rn-kpi-label">Total Notes</span></div>
  <div class="rn-kpi"><span class="rn-kpi-val">${d.activeTags || 0}</span><span class="rn-kpi-label">Active Tags</span></div>
  <div class="rn-kpi">${topTag}<span class="rn-kpi-label">Top Tag</span></div>
  <div class="rn-kpi"><span class="rn-kpi-val">${d.notesThisMonth || 0}</span><span class="rn-kpi-label">This Month</span></div>
  <div class="rn-kpi"><span class="rn-kpi-val">${d.clientsWithNotes || 0}</span><span class="rn-kpi-label">Clients Linked</span></div>
</div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NOTES SECTION (existing CRUD, unchanged logic)
  // ═══════════════════════════════════════════════════════════════════════

  async function renderNotes() {
    const body = document.getElementById('rnSectionBody');
    if (!body) return;
    body.innerHTML = `
<div class="rn-notes-wrap">
  <div class="rn-notes-toolbar">
    <button class="rn-btn-primary" onclick="rnToggleForm()">+ New Note</button>
    <input class="rn-search" id="rnSearchInput" type="text" placeholder="Search notes…" oninput="rnSearch(this.value)">
  </div>
  <div id="rnFormWrap" style="display:none"></div>
  <div id="rnListWrap"><div class="rn-empty">Loading…</div></div>
</div>`;
    try {
      const res  = await apiFetch('?section=notes');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      document.getElementById('rnListWrap').innerHTML = rnListHTML(data.notes || []);
    } catch (e) {
      const lw = document.getElementById('rnListWrap');
      if (lw) lw.innerHTML = '<div class="rn-error">Could not load notes: ' + esc(e.message) + '</div>';
    }
  }

  function rnListHTML(notes) {
    if (!notes.length) return '<div class="rn-empty">No research notes yet. Create your first note above.</div>';
    return `<div class="rn-list" id="rnList">` + notes.map(rnCardHTML).join('') + `</div>`;
  }

  function rnCardHTML(n) {
    const tags = (n.tags || []).map(t => `<span class="rn-tag">${esc(t)}</span>`).join('');
    const date = n.created_at ? new Date(n.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    return `
<div class="rn-card" id="rnCard-${n.id}">
  <div class="rn-card-header">
    <span class="rn-card-title">${esc(n.title)}</span>
    <span class="rn-card-date">${date}</span>
  </div>
  ${n.content ? `<div class="rn-card-content">${esc(n.content).replace(/\n/g,'<br>')}</div>` : ''}
  ${n.source_url ? `<a class="rn-card-link" href="${esc(n.source_url)}" target="_blank" rel="noopener">↗ Source</a>` : ''}
  ${tags ? `<div class="rn-card-tags">${tags}</div>` : ''}
  <div class="rn-card-actions">
    <button class="rn-btn-edit" onclick="rnStartEdit('${n.id}')">Edit</button>
    <button class="rn-btn-delete" onclick="rnDeleteNote('${n.id}','${esc(n.title)}')">Delete</button>
  </div>
</div>`;
  }

  function rnFormHTML(note) {
    const n = note || {};
    const editId = n.id || '';
    return `
<form class="rn-form" onsubmit="rnSaveNote(event,'${editId}')">
  <div class="rn-form-row">
    <label class="rn-label">Title <span class="rn-req">*</span></label>
    <input class="rn-input" id="rnTitle" type="text" placeholder="Note title" value="${esc(n.title || '')}" required>
  </div>
  <div class="rn-form-row">
    <label class="rn-label">Content</label>
    <textarea class="rn-textarea" id="rnContent" rows="4" placeholder="Note content…">${esc(n.content || '')}</textarea>
  </div>
  <div class="rn-form-row">
    <label class="rn-label">Source URL</label>
    <input class="rn-input" id="rnSourceUrl" type="url" placeholder="https://…" value="${esc(n.source_url || '')}">
  </div>
  <div class="rn-form-row">
    <label class="rn-label">Tags <span class="rn-hint">(comma-separated)</span></label>
    <input class="rn-input" id="rnTags" type="text" placeholder="e.g. chakra, reiki, client" value="${esc((n.tags || []).join(', '))}">
  </div>
  <div class="rn-form-actions">
    <button type="submit" class="rn-btn-primary">${editId ? 'Save Changes' : 'Create Note'}</button>
    <button type="button" class="rn-btn-cancel" onclick="rnCancelForm()">Cancel</button>
  </div>
</form>`;
  }

  window.rnToggleForm = function () {
    const wrap = document.getElementById('rnFormWrap');
    if (!wrap) return;
    if (wrap.style.display !== 'none') {
      wrap.style.display = 'none';
    } else {
      wrap.innerHTML = rnFormHTML();
      wrap.style.display = 'block';
      const t = document.getElementById('rnTitle');
      if (t) t.focus();
    }
  };

  window.rnCancelForm = function () {
    const wrap = document.getElementById('rnFormWrap');
    if (wrap) wrap.style.display = 'none';
  };

  window.rnStartEdit = function (id) {
    const card = document.getElementById('rnCard-' + id);
    if (!card) return;
    const note = {
      id,
      title:      (card.querySelector('.rn-card-title')   || {}).textContent || '',
      content:    (card.querySelector('.rn-card-content') || {}).textContent || '',
      source_url: card.querySelector('.rn-card-link') ? card.querySelector('.rn-card-link').getAttribute('href') : '',
      tags:       Array.from(card.querySelectorAll('.rn-tag')).map(t => t.textContent),
    };
    const wrap = document.getElementById('rnFormWrap');
    if (!wrap) return;
    wrap.innerHTML = rnFormHTML(note);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.rnSaveNote = async function (evt, editId) {
    evt.preventDefault();
    const title      = (document.getElementById('rnTitle')     || {}).value || '';
    const content    = (document.getElementById('rnContent')   || {}).value || '';
    const source_url = (document.getElementById('rnSourceUrl') || {}).value || '';
    const tagsRaw    = (document.getElementById('rnTags')      || {}).value || '';
    const tags       = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    if (!title.trim()) { alert('Title is required.'); return; }

    const body = { title: title.trim(), content: content || null, source_url: source_url || null, tags: tags.length ? tags : null };

    try {
      let res;
      if (editId) {
        res = await apiFetch('?action=update_note&id=' + editId, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        res = await apiFetch('?action=create_note', { method: 'POST', body: JSON.stringify(body) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      window.rnCancelForm();
      renderNotes();
      loadAnalytics();
    } catch (e) {
      alert('Error saving note: ' + e.message);
    }
  };

  window.rnDeleteNote = async function (id, title) {
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    try {
      const res  = await apiFetch('?action=delete_note&id=' + id, { method: 'PATCH', body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      renderNotes();
      loadAnalytics();
    } catch (e) {
      alert('Error deleting note: ' + e.message);
    }
  };

  window.rnSearch = function (q) {
    const list = document.getElementById('rnList');
    if (!list) return;
    const term = q.toLowerCase();
    list.querySelectorAll('.rn-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(term) ? '' : 'none';
    });
  };

  // ═══════════════════════════════════════════════════════════════════════
  // PATTERN LIBRARY SECTION
  // ═══════════════════════════════════════════════════════════════════════

  async function renderPatterns(search) {
    const body = document.getElementById('rnSectionBody');
    if (!body) return;

    const url = '?section=pattern_library' + (search ? '&search=' + encodeURIComponent(search) : '');

    body.innerHTML = `
<div class="rn-pl-wrap">
  <div class="rn-pl-toolbar">
    <input class="rn-search" id="rnPlSearch" type="text" placeholder="Search tags…"
      value="${esc(search || '')}" oninput="rnPlFilter(this.value)">
  </div>
  <div id="rnPlBody"><div class="rn-empty">Loading patterns…</div></div>
</div>`;

    try {
      const res  = await apiFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      renderPlBody(data);
    } catch (e) {
      const pb = document.getElementById('rnPlBody');
      if (pb) pb.innerHTML = '<div class="rn-error">Could not load patterns: ' + esc(e.message) + '</div>';
    }
  }

  function renderPlBody(data) {
    const pb = document.getElementById('rnPlBody');
    if (!pb) return;
    const patterns = data.patterns || [];
    if (!patterns.length) {
      pb.innerHTML = '<div class="rn-empty">No tagged notes found. Add tags to notes to build the Pattern Library.</div>';
      return;
    }
    pb.innerHTML = `
<p class="rn-pl-meta">${patterns.length} tag${patterns.length !== 1 ? 's' : ''} across ${data.total_tagged_notes || 0} note${(data.total_tagged_notes || 0) !== 1 ? 's' : ''}</p>
<div class="rn-pl-grid">
  ${patterns.map(p => `
  <div class="rn-pl-card">
    <div class="rn-pl-tag-row">
      <span class="rn-pl-tag">${esc(p.tag)}</span>
      <span class="rn-pl-count">${p.count} note${p.count !== 1 ? 's' : ''}</span>
    </div>
    ${p.recent_notes.length ? `
    <ul class="rn-pl-notes">
      ${p.recent_notes.map(n => `
      <li class="rn-pl-note">
        <span class="rn-pl-note-title">${esc(n.title)}</span>
        ${n.excerpt ? `<span class="rn-pl-note-excerpt">${esc(n.excerpt)}${(n.excerpt || '').length >= 120 ? '…' : ''}</span>` : ''}
      </li>`).join('')}
    </ul>` : ''}
  </div>`).join('')}
</div>`;
  }

  window.rnPlFilter = function (q) {
    renderPatterns(q.trim());
  };

  // ═══════════════════════════════════════════════════════════════════════
  // INSIGHTS FEED SECTION
  // ═══════════════════════════════════════════════════════════════════════

  async function renderInsights() {
    const body = document.getElementById('rnSectionBody');
    if (!body) return;
    body.innerHTML = '<div class="rn-insights-wrap"><div class="rn-empty">Loading insights…</div></div>';

    try {
      const res  = await apiFetch('?section=insights');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      renderInsightsBody(data);
    } catch (e) {
      body.innerHTML = '<div class="rn-insights-wrap"><div class="rn-error">Could not load insights: ' + esc(e.message) + '</div></div>';
    }
  }

  function barHTML(label, count, max) {
    const pct = max > 0 ? Math.round((count / max) * 100) : 0;
    return `
<div class="rn-bar-row">
  <span class="rn-bar-label">${esc(label)}</span>
  <div class="rn-bar-track"><div class="rn-bar-fill" style="width:${pct}%"></div></div>
  <span class="rn-bar-count">${count}</span>
</div>`;
  }

  function renderInsightsBody(data) {
    const body = document.getElementById('rnSectionBody');
    if (!body) return;

    const topTags       = data.topTags       || [];
    const sharedTags    = data.sharedTags    || [];
    const modalities    = data.modalities    || [];
    const themes        = data.emotionalThemes || [];

    const maxTopCount    = topTags[0]    ? topTags[0].count        : 1;
    const maxSharedCount = sharedTags[0] ? sharedTags[0].client_count : 1;
    const maxModCount    = modalities[0] ? modalities[0].count     : 1;
    const maxThemeCount  = themes[0]     ? themes[0].count         : 1;

    const noData = (arr) => arr.length === 0;

    body.innerHTML = `
<div class="rn-insights-wrap">
  <div class="rn-insights-meta">
    ${data.totalNotes || 0} total notes · ${data.clientsWithNotes || 0} clients linked
  </div>

  <div class="rn-insights-grid">

    <section class="rn-insights-card">
      <h3 class="rn-insights-heading">Top Tags</h3>
      ${noData(topTags)
        ? '<div class="rn-empty">No tags yet.</div>'
        : topTags.map(t => barHTML(t.tag, t.count, maxTopCount)).join('')}
    </section>

    <section class="rn-insights-card">
      <h3 class="rn-insights-heading">Shared Across Clients</h3>
      ${noData(sharedTags)
        ? '<div class="rn-empty">No cross-client patterns yet. Link notes to clients to surface shared themes.</div>'
        : sharedTags.map(t => barHTML(t.tag, t.client_count, maxSharedCount)).join('')}
    </section>

    <section class="rn-insights-card">
      <h3 class="rn-insights-heading">Modalities</h3>
      ${noData(modalities)
        ? '<div class="rn-empty">No modality tags detected yet.</div>'
        : modalities.map(m => barHTML(m.modality, m.count, maxModCount)).join('')}
    </section>

    <section class="rn-insights-card">
      <h3 class="rn-insights-heading">Emotional Themes</h3>
      ${noData(themes)
        ? '<div class="rn-empty">No emotional theme tags detected yet.</div>'
        : themes.map(t => barHTML(t.theme, t.count, maxThemeCount)).join('')}
    </section>

  </div>
</div>`;
  }

})();
