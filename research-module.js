(function () {
  'use strict';

  const API = '/.netlify/functions/research';

  function token() { return sessionStorage.getItem('rea_api_token') || ''; }

  function apiFetch(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { 'X-Dashboard-Token': token(), 'Content-Type': 'application/json' },
    }, opts));
  }

  function loading(el) { el.innerHTML = '<div class="rn-empty">LOADING…</div>'; }
  function errBox(el, msg) { el.innerHTML = '<div class="rn-error">' + msg + '</div>'; }

  // ── Entry point (called by showTab) ──────────────────────────────────────
  window.rnInit = function () {
    renderResearch();
  };

  // ── Main render ───────────────────────────────────────────────────────────
  async function renderResearch() {
    const el = document.getElementById('tab-research');
    if (!el) return;
    loading(el);
    try {
      const res  = await apiFetch('?section=notes');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API error');
      el.innerHTML = rnHTML(data.notes || []);
      rnBindForm();
      rnBindSearch();
    } catch (e) {
      errBox(el, 'Could not load research notes: ' + e.message);
    }
  }

  // ── HTML builder ─────────────────────────────────────────────────────────
  function rnHTML(notes) {
    return `
<div class="rn-wrap">
  <div class="rn-header">
    <div class="rn-title-row">
      <span class="rn-title">Research Notes</span>
      <button class="rn-btn-primary" onclick="rnToggleForm()">+ New Note</button>
    </div>
    <input class="rn-search" id="rnSearchInput" type="text" placeholder="Search notes…" oninput="rnSearch(this.value)">
  </div>

  <div id="rnFormWrap" style="display:none">${rnFormHTML()}</div>

  <div id="rnListWrap">${rnListHTML(notes)}</div>
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

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Form wiring ───────────────────────────────────────────────────────────
  function rnBindForm()   { /* no-op: form uses inline onsubmit */ }
  function rnBindSearch() { /* no-op: search uses inline oninput */ }

  window.rnToggleForm = function () {
    const wrap = document.getElementById('rnFormWrap');
    if (!wrap) return;
    const showing = wrap.style.display !== 'none';
    if (showing) {
      wrap.style.display = 'none';
    } else {
      wrap.innerHTML = rnFormHTML();
      wrap.style.display = 'block';
      document.getElementById('rnTitle') && document.getElementById('rnTitle').focus();
    }
  };

  window.rnCancelForm = function () {
    const wrap = document.getElementById('rnFormWrap');
    if (wrap) wrap.style.display = 'none';
  };

  window.rnStartEdit = function (id) {
    const card = document.getElementById('rnCard-' + id);
    if (!card) return;
    const titleEl   = card.querySelector('.rn-card-title');
    const contentEl = card.querySelector('.rn-card-content');
    const linkEl    = card.querySelector('.rn-card-link');
    const tagsEl    = card.querySelectorAll('.rn-tag');
    const note = {
      id,
      title:      titleEl   ? titleEl.textContent   : '',
      content:    contentEl ? contentEl.textContent  : '',
      source_url: linkEl    ? linkEl.getAttribute('href') : '',
      tags:       Array.from(tagsEl).map(t => t.textContent),
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
      renderResearch();
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
      renderResearch();
    } catch (e) {
      alert('Error deleting note: ' + e.message);
    }
  };

  window.rnSearch = function (q) {
    const list = document.getElementById('rnList');
    if (!list) return;
    const term = q.toLowerCase();
    list.querySelectorAll('.rn-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(term) ? '' : 'none';
    });
  };

})();
