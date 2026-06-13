(function () {
  'use strict';

  const API = '/.netlify/functions/kb';

  const VALID_STATUSES = ['draft', 'published', 'archived'];

  function token() { return sessionStorage.getItem('rea_api_token') || ''; }

  function apiFetch(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { 'X-Dashboard-Token': token(), 'Content-Type': 'application/json' },
    }, opts));
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let _activeCategory = '';
  let _activeStatus   = '';
  let _searchTerm     = '';
  let _allEntries     = [];
  let _categories     = [];

  // ── Entry point (called by showTab) ──────────────────────────────────────
  window.kbInit = function () {
    _activeCategory = '';
    _activeStatus   = '';
    _searchTerm     = '';
    renderKB();
  };

  // ── Main render ───────────────────────────────────────────────────────────
  async function renderKB() {
    const el = document.getElementById('tab-kb');
    if (!el) return;
    el.innerHTML = '<div class="kb-wrap"><div class="kb-empty">Loading Knowledge Base…</div></div>';
    try {
      const [entriesRes, catsRes] = await Promise.all([
        apiFetch('?section=entries'),
        apiFetch('?section=categories'),
      ]);
      const entriesData = await entriesRes.json();
      const catsData    = await catsRes.json();
      if (!entriesRes.ok) throw new Error(entriesData.error || 'API error');
      _allEntries = entriesData.entries || [];
      _categories = catsData.categories || [];
      el.innerHTML = kbHTML(_allEntries, _categories);
    } catch (e) {
      el.innerHTML = '<div class="kb-wrap"><div class="kb-error">Could not load Knowledge Base: ' + esc(e.message) + '</div></div>';
    }
  }

  // ── HTML builders ─────────────────────────────────────────────────────────
  function kbHTML(entries, categories) {
    return `
<div class="kb-wrap">
  <div class="kb-header">
    <div class="kb-title-row">
      <span class="kb-title">Knowledge Base</span>
      <button class="kb-btn-primary" onclick="kbToggleForm()">+ New Article</button>
    </div>
    <div class="kb-controls">
      <input class="kb-search" id="kbSearchInput" type="text" placeholder="Search articles…"
        value="${esc(_searchTerm)}" oninput="kbApplySearch(this.value)">
      <div class="kb-filters">
        <select class="kb-select" id="kbCatFilter" onchange="kbApplyFilters()">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${esc(c)}"${_activeCategory===c?' selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="kb-select" id="kbStatusFilter" onchange="kbApplyFilters()">
          <option value="">All Statuses</option>
          ${VALID_STATUSES.map(s => `<option value="${esc(s)}"${_activeStatus===s?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>
    </div>
  </div>

  <div id="kbFormWrap" style="display:none"></div>

  <div id="kbListWrap">${kbListHTML(entries)}</div>
</div>`;
  }

  function kbFormHTML(entry) {
    const e      = entry || {};
    const editId = e.id || '';
    const selStatus = e.status || 'draft';
    const pinned    = e.is_pinned ? ' checked' : '';
    return `
<form class="kb-form" onsubmit="kbSaveEntry(event,'${editId}')">
  <div class="kb-form-row">
    <label class="kb-label">Title <span class="kb-req">*</span></label>
    <input class="kb-input" id="kbTitle" type="text" placeholder="Article title"
      value="${esc(e.title || '')}" required>
  </div>
  <div class="kb-form-row">
    <label class="kb-label">Content</label>
    <textarea class="kb-textarea" id="kbContent" rows="6"
      placeholder="Article content…">${esc(e.content || '')}</textarea>
  </div>
  <div class="kb-form-row kb-form-row--2col">
    <div>
      <label class="kb-label">Category</label>
      <input class="kb-input" id="kbCategory" type="text"
        placeholder="e.g. protection" value="${esc(e.category || '')}">
    </div>
    <div>
      <label class="kb-label">Status</label>
      <select class="kb-select" id="kbStatus">
        ${VALID_STATUSES.map(s => `<option value="${s}"${s===selStatus?' selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="kb-form-row">
    <label class="kb-label">Tags <span class="kb-hint">(comma-separated)</span></label>
    <input class="kb-input" id="kbTags" type="text"
      placeholder="e.g. clearing, protection"
      value="${esc((e.tags || []).join(', '))}">
  </div>
  <div class="kb-form-row kb-form-pin-row">
    <label class="kb-pin-label">
      <input type="checkbox" id="kbIsPinned"${pinned}> Pin this article to the top
    </label>
  </div>
  <div class="kb-form-actions">
    <button type="submit" class="kb-btn-primary">${editId ? 'Save Changes' : 'Create Article'}</button>
    <button type="button" class="kb-btn-cancel" onclick="kbCancelForm()">Cancel</button>
  </div>
</form>`;
  }

  function kbListHTML(entries) {
    if (!entries.length) return '<div class="kb-empty">No articles yet. Create your first article above.</div>';
    return '<div class="kb-list" id="kbList">' + entries.map(kbCardHTML).join('') + '</div>';
  }

  function kbCardHTML(e) {
    const tags    = (e.tags || []).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('');
    const date    = e.created_at ? new Date(e.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    const preview = e.content ? e.content.slice(0, 160).replace(/\n/g, ' ') + (e.content.length > 160 ? '…' : '') : '';
    const pin     = e.is_pinned ? '<span class="kb-pin-badge">📌 Pinned</span>' : '';
    return `
<div class="kb-card" id="kbCard-${e.id}"
  data-category="${esc(e.category||'')}"
  data-status="${esc(e.status||'')}"
  data-pinned="${e.is_pinned ? '1' : '0'}">
  <div class="kb-card-header">
    <span class="kb-card-title">${esc(e.title)}</span>
    <div class="kb-card-meta">
      ${pin}
      ${e.category ? `<span class="kb-cat-badge">${esc(e.category)}</span>` : ''}
      <span class="kb-status-badge kb-status-${esc(e.status||'draft')}">${esc(e.status||'draft')}</span>
      <span class="kb-card-date">${date}</span>
    </div>
  </div>
  ${preview ? `<div class="kb-card-preview">${esc(preview)}</div>` : ''}
  ${tags ? `<div class="kb-card-tags">${tags}</div>` : ''}
  <div class="kb-card-actions">
    <button class="kb-btn-edit"   onclick="kbStartEdit('${e.id}')">Edit</button>
    <button class="kb-btn-delete" onclick="kbDeleteEntry('${e.id}','${esc(e.title)}')">Delete</button>
  </div>
</div>`;
  }

  // ── Form wiring ───────────────────────────────────────────────────────────
  window.kbToggleForm = function () {
    const wrap = document.getElementById('kbFormWrap');
    if (!wrap) return;
    if (wrap.style.display !== 'none') {
      wrap.style.display = 'none';
    } else {
      wrap.innerHTML = kbFormHTML();
      wrap.style.display = 'block';
      const t = document.getElementById('kbTitle');
      if (t) t.focus();
    }
  };

  window.kbCancelForm = function () {
    const wrap = document.getElementById('kbFormWrap');
    if (wrap) wrap.style.display = 'none';
  };

  window.kbStartEdit = function (id) {
    const card = document.getElementById('kbCard-' + id);
    if (!card) return;
    const entry = {
      id,
      title:     (card.querySelector('.kb-card-title') || {}).textContent || '',
      content:   '',
      category:  card.dataset.category || '',
      status:    card.dataset.status   || 'draft',
      is_pinned: card.dataset.pinned === '1',
      tags:      Array.from(card.querySelectorAll('.kb-tag')).map(t => t.textContent),
    };
    const wrap = document.getElementById('kbFormWrap');
    if (!wrap) return;
    wrap.innerHTML = kbFormHTML(entry);
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.kbSaveEntry = async function (evt, editId) {
    evt.preventDefault();
    const title    = (document.getElementById('kbTitle')    || {}).value || '';
    const content  = (document.getElementById('kbContent')  || {}).value || '';
    const category = (document.getElementById('kbCategory') || {}).value || '';
    const status   = (document.getElementById('kbStatus')   || {}).value || 'draft';
    const tagsRaw  = (document.getElementById('kbTags')     || {}).value || '';
    const isPinned = !!(document.getElementById('kbIsPinned') || {}).checked;
    const tags     = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    if (!title.trim()) { alert('Title is required.'); return; }

    const body = {
      title:     title.trim(),
      content:   content   || null,
      category:  category  || null,
      status,
      is_pinned: isPinned,
      tags:      tags.length ? tags : null,
    };

    try {
      let res;
      if (editId) {
        res = await apiFetch('?action=update_entry&id=' + editId, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        res = await apiFetch('?action=create_entry', { method: 'POST', body: JSON.stringify(body) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      window.kbCancelForm();
      renderKB();
    } catch (e) {
      alert('Error saving article: ' + e.message);
    }
  };

  window.kbDeleteEntry = async function (id, title) {
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    try {
      const res  = await apiFetch('?action=delete_entry&id=' + id, { method: 'PATCH', body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      renderKB();
    } catch (e) {
      alert('Error deleting article: ' + e.message);
    }
  };

  // ── Client-side filter / search ───────────────────────────────────────────
  window.kbApplySearch = function (q) {
    _searchTerm = q.toLowerCase();
    kbFilterCards();
  };

  window.kbApplyFilters = function () {
    _activeCategory = (document.getElementById('kbCatFilter')    || {}).value || '';
    _activeStatus   = (document.getElementById('kbStatusFilter') || {}).value || '';
    kbFilterCards();
  };

  function kbFilterCards() {
    const list = document.getElementById('kbList');
    if (!list) return;
    let visible = 0;
    list.querySelectorAll('.kb-card').forEach(card => {
      const text          = card.textContent.toLowerCase();
      const cardCategory  = card.dataset.category || '';
      const cardStatus    = card.dataset.status   || '';
      const matchSearch   = !_searchTerm     || text.includes(_searchTerm);
      const matchCategory = !_activeCategory || cardCategory === _activeCategory;
      const matchStatus   = !_activeStatus   || cardStatus   === _activeStatus;
      const show = matchSearch && matchCategory && matchStatus;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    let empty = document.getElementById('kbEmptyFilter');
    if (!visible && !empty) {
      empty = document.createElement('div');
      empty.id        = 'kbEmptyFilter';
      empty.className = 'kb-empty';
      empty.textContent = 'No articles match the current filters.';
      list.appendChild(empty);
    } else if (visible && empty) {
      empty.remove();
    }
  }

})();
