// ══════════════════════════════════════════════════════════════════════════
// CONTENT STUDIO MODULE — cs-module.js
// Sections: Dashboard · Ideas · Calendar · Drafts · Sources
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────
  var CONTENT_TYPES = [
    { value: 'social_post',  label: 'Social Post' },
    { value: 'video',        label: 'Video' },
    { value: 'newsletter',   label: 'Newsletter' },
    { value: 'blog',         label: 'Blog' },
    { value: 'training',     label: 'Training' },
    { value: 'book_chapter', label: 'Book Chapter' },
    { value: 'faq',          label: 'FAQ' },
    { value: 'webinar',      label: 'Webinar' },
  ];

  var TYPE_ICONS = {
    social_post:  '◎',
    video:        '▶',
    newsletter:   '✉',
    blog:         '✦',
    training:     '◈',
    book_chapter: '⬡',
    faq:          '?',
    webinar:      '⊕',
  };

  // ── Auth helper ───────────────────────────────────────────────────────
  function tok() { return sessionStorage.getItem('rea_api_token') || ''; }

  function csReq(method, path, body) {
    var opts = { method: method, headers: { Authorization: 'Bearer ' + tok() } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || r.status);
        return j;
      });
    });
  }

  // ── Shimmer ───────────────────────────────────────────────────────────
  function shimmer(n) {
    var h = '';
    for (var i = 0; i < n; i++) h += '<div class="cs-shimmer"></div>';
    return h;
  }

  // ── Toast ─────────────────────────────────────────────────────────────
  function toast(msg, isErr) {
    var el = document.getElementById('cs-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'cs-toast' + (isErr ? ' cs-toast-err' : ' cs-toast-ok');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.display = 'none'; }, 3200);
  }

  // ── Type badge ────────────────────────────────────────────────────────
  function typeBadge(ct) {
    var label = CONTENT_TYPES.find(function (t) { return t.value === ct; });
    return '<span class="cs-type-badge cs-type-' + ct + '">' + (TYPE_ICONS[ct] || '•') + ' ' + (label ? label.label : ct) + '</span>';
  }

  function statusBadge(s) {
    return '<span class="cs-status cs-status-' + s + '">' + s + '</span>';
  }

  // ── Render source trace ───────────────────────────────────────────────
  function renderTrace(sourceIds) {
    if (!sourceIds || !sourceIds.length) return '';
    var html = '<div class="cs-trace"><span class="cs-trace-lbl">Sources:</span>';
    sourceIds.forEach(function (src) {
      var tableLabel = src.table === 'kb_entries' ? 'KB' : src.table === 'research_notes' ? 'RN' : src.table;
      html += '<span class="cs-trace-chip">' + tableLabel + ': ' + esc(src.title || src.id) + '</span>';
    });
    html += '</div>';
    return html;
  }

  // ── Escape ────────────────────────────────────────────────────────────
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(d) {
    if (!d) return '';
    var dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ENTRY POINTS
  // ════════════════════════════════════════════════════════════════════════

  window.csInit = function () {
    var body = document.getElementById('tab-cs');
    if (!body) return;
    body.innerHTML = [
      '<div id="cs-toast" class="cs-toast" style="display:none"></div>',
      '<div class="cs-wrap">',
      '  <div class="cs-subnav" id="cs-subnav">',
      '    <button class="cs-snav active" onclick="csSection(\'dashboard\')">⬡ Dashboard</button>',
      '    <button class="cs-snav" onclick="csSection(\'ideas\')">✦ Ideas</button>',
      '    <button class="cs-snav" onclick="csSection(\'calendar\')">◈ Calendar</button>',
      '    <button class="cs-snav" onclick="csSection(\'drafts\')">◎ Drafts</button>',
      '    <button class="cs-snav" onclick="csSection(\'sources\')">⌂ Sources</button>',
      '  </div>',
      '  <div id="cs-body" class="cs-body"></div>',
      '</div>',
    ].join('');
    csSection('dashboard');
  };

  window.csSection = function (name) {
    var btns = document.querySelectorAll('.cs-snav');
    btns.forEach(function (b) { b.classList.remove('active'); });
    var sections = ['dashboard', 'ideas', 'calendar', 'drafts', 'sources'];
    var idx = sections.indexOf(name);
    if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');

    var body = document.getElementById('cs-body');
    if (!body) return;

    if (name === 'dashboard') loadDashboard(body);
    else if (name === 'ideas')    loadIdeas(body, {});
    else if (name === 'calendar') loadCalendar(body);
    else if (name === 'drafts')   loadIdeas(body, { status: 'draft' });
    else if (name === 'sources')  loadSources(body);
  };

  // ════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════════════

  function loadDashboard(body) {
    body.innerHTML = '<div class="cs-loading">' + shimmer(4) + '</div>';
    csReq('GET', '/.netlify/functions/content-studio?section=dashboard').then(function (d) {
      var k = d.kpis || {};
      var warn = d.migration_needed ? '<div class="cs-warn">Database not yet migrated — run 2026-06-13-content-studio.sql in Supabase.</div>' : '';
      body.innerHTML = warn + [
        '<div class="cs-kpi-row">',
        kpiCard('Total Ideas',     k.total           || 0, '✦'),
        kpiCard('Draft Ideas',     k.draft           || 0, '◎'),
        kpiCard('Approved Ideas',  k.approved        || 0, '✔'),
        kpiCard('KB Articles',     k.source_articles || 0, '⬡'),
        kpiCard('Research Notes',  k.source_notes    || 0, '⌂'),
        '</div>',
        '<div class="cs-dash-grid">',
        '<div class="cs-dash-card">',
        '  <div class="cs-card-title">Recently Generated</div>',
        renderRecentList(d.recent_generated || []),
        '</div>',
        '<div class="cs-dash-card">',
        '  <div class="cs-card-title">Recently Approved</div>',
        renderRecentList(d.recent_approved || []),
        '</div>',
        '</div>',
        '<div class="cs-dash-card cs-quick-actions">',
        '  <div class="cs-card-title">Quick Actions</div>',
        '  <div class="cs-action-row">',
        '    <button class="cs-action-btn" onclick="csGenerate(\'social_post\')">◎ Generate Social Posts</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'training\')">◈ Generate Training Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'book_chapter\')">⬡ Generate Book Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'video\')">▶ Generate Video Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(null)">✦ Generate All Ideas</button>',
        '    <button class="cs-action-btn cs-action-secondary" onclick="csSection(\'ideas\')">View All Ideas →</button>',
        '  </div>',
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="cs-error">Failed to load dashboard: ' + esc(e.message) + '</div>';
    });
  }

  function kpiCard(label, val, icon) {
    return '<div class="cs-kpi"><div class="cs-kpi-icon">' + icon + '</div><div class="cs-kpi-num">' + val + '</div><div class="cs-kpi-lbl">' + label + '</div></div>';
  }

  function renderRecentList(items) {
    if (!items.length) return '<div class="cs-empty">None yet.</div>';
    return '<ul class="cs-recent-list">' + items.map(function (i) {
      return '<li><span class="cs-recent-type">' + (TYPE_ICONS[i.content_type] || '•') + '</span> ' + esc(i.title) + '</li>';
    }).join('') + '</ul>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // IDEAS
  // ════════════════════════════════════════════════════════════════════════

  var _ideasFilter = {};
  var _editingIdeaId = null;

  function loadIdeas(body, filter) {
    _ideasFilter = filter || {};
    var typeOptions = '<option value="">All Types</option>' + CONTENT_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + ((_ideasFilter.content_type === t.value) ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');

    body.innerHTML = [
      '<div class="cs-ideas-header">',
      '  <input id="cs-search" class="cs-search" placeholder="Search ideas…" oninput="csIdeasSearch()" value="' + esc(_ideasFilter.search || '') + '">',
      '  <select class="cs-filter-select" id="cs-type-filter" onchange="csIdeasFilter()">',
      typeOptions,
      '  </select>',
      '  <button class="cs-btn-primary" onclick="csNewIdeaForm()">+ New Idea</button>',
      '  <button class="cs-btn-secondary" onclick="csGenerate(null)">⚡ Generate</button>',
      '</div>',
      '<div id="cs-idea-form-wrap"></div>',
      '<div id="cs-generate-panel"></div>',
      '<div id="cs-ideas-list">' + shimmer(3) + '</div>',
    ].join('');

    fetchIdeas();
  }

  function fetchIdeas() {
    var qs = '?section=ideas';
    if (_ideasFilter.status)       qs += '&status='       + _ideasFilter.status;
    if (_ideasFilter.content_type) qs += '&content_type=' + _ideasFilter.content_type;
    if (_ideasFilter.search)       qs += '&search='       + encodeURIComponent(_ideasFilter.search);

    var listEl = document.getElementById('cs-ideas-list');
    if (listEl) listEl.innerHTML = shimmer(3);

    csReq('GET', '/.netlify/functions/content-studio' + qs).then(function (d) {
      renderIdeasList(d.ideas || []);
    }).catch(function (e) {
      var el = document.getElementById('cs-ideas-list');
      if (el) el.innerHTML = '<div class="cs-error">' + esc(e.message) + '</div>';
    });
  }

  function renderIdeasList(ideas) {
    var el = document.getElementById('cs-ideas-list');
    if (!el) return;
    if (!ideas.length) {
      el.innerHTML = '<div class="cs-empty">No ideas found. Use ⚡ Generate to create ideas from your knowledge base.</div>';
      return;
    }
    el.innerHTML = ideas.map(function (idea) {
      return [
        '<div class="cs-idea-card" id="cs-idea-' + idea.id + '">',
        '  <div class="cs-idea-top">',
        '    ' + typeBadge(idea.content_type),
        '    ' + statusBadge(idea.status),
        '    <div class="cs-idea-actions">',
        '      <button class="cs-btn-edit" onclick="csEditIdea(\'' + idea.id + '\')">Edit</button>',
        '      <button class="cs-btn-approve" onclick="csApproveIdea(\'' + idea.id + '\', \'' + idea.status + '\')">' + (idea.status === 'approved' ? 'Unapprove' : 'Approve') + '</button>',
        '      <button class="cs-btn-delete" onclick="csDeleteIdea(\'' + idea.id + '\')">Delete</button>',
        '    </div>',
        '  </div>',
        '  <div class="cs-idea-title">' + esc(idea.title) + '</div>',
        idea.topic   ? '<div class="cs-idea-topic">Topic: ' + esc(idea.topic) + '</div>' : '',
        idea.summary ? '<div class="cs-idea-summary">' + esc(idea.summary) + '</div>' : '',
        renderTrace(idea.source_ids),
        idea.scheduled_date ? '<div class="cs-idea-date">📅 Scheduled: ' + fmt(idea.scheduled_date) + '</div>' : '',
        '</div>',
      ].join('');
    }).join('');
  }

  window.csIdeasSearch = function () {
    var el = document.getElementById('cs-search');
    _ideasFilter.search = el ? el.value : '';
    fetchIdeas();
  };

  window.csIdeasFilter = function () {
    var el = document.getElementById('cs-type-filter');
    _ideasFilter.content_type = el ? el.value : '';
    fetchIdeas();
  };

  // ── Idea form ─────────────────────────────────────────────────────────

  window.csNewIdeaForm = function () {
    _editingIdeaId = null;
    renderIdeaForm({});
  };

  window.csEditIdea = function (id) {
    _editingIdeaId = id;
    csReq('GET', '/.netlify/functions/content-studio?section=ideas').then(function (d) {
      var idea = (d.ideas || []).find(function (i) { return i.id === id; });
      if (idea) renderIdeaForm(idea);
    });
  };

  function renderIdeaForm(idea) {
    var wrap = document.getElementById('cs-idea-form-wrap');
    if (!wrap) return;
    var typeOpts = CONTENT_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + (idea.content_type === t.value ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');
    wrap.innerHTML = [
      '<div class="cs-form" id="cs-idea-form">',
      '  <div class="cs-form-row"><label class="cs-label">Title *</label>',
      '    <input class="cs-input" id="csIdeaTitle" value="' + esc(idea.title || '') + '" placeholder="Idea title…"></div>',
      '  <div class="cs-form-row"><label class="cs-label">Content Type *</label>',
      '    <select class="cs-input" id="csIdeaType"><option value="">— select —</option>' + typeOpts + '</select></div>',
      '  <div class="cs-form-row"><label class="cs-label">Topic</label>',
      '    <input class="cs-input" id="csIdeaTopic" value="' + esc(idea.topic || '') + '" placeholder="Main topic or theme…"></div>',
      '  <div class="cs-form-row"><label class="cs-label">Summary</label>',
      '    <textarea class="cs-textarea" id="csIdeaSummary" rows="3" placeholder="Brief description of the content idea…">' + esc(idea.summary || '') + '</textarea></div>',
      '  <div class="cs-form-row"><label class="cs-label">Scheduled Date</label>',
      '    <input class="cs-input" id="csIdeaDate" type="date" value="' + esc(idea.scheduled_date || '') + '"></div>',
      '  <div class="cs-form-actions">',
      '    <button class="cs-btn-primary" onclick="csIdeaSave()">Save Idea</button>',
      '    <button class="cs-btn-cancel" onclick="csIdeaCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.csIdeaSave = function () {
    var title = (document.getElementById('csIdeaTitle') || {}).value || '';
    var ctype = (document.getElementById('csIdeaType')  || {}).value || '';
    var topic = (document.getElementById('csIdeaTopic') || {}).value || '';
    var summ  = (document.getElementById('csIdeaSummary') || {}).value || '';
    var date  = (document.getElementById('csIdeaDate')  || {}).value || null;

    if (!title.trim()) { toast('Title is required.', true); return; }
    if (!ctype)        { toast('Content type is required.', true); return; }

    var body = { title: title.trim(), content_type: ctype, topic: topic || null, summary: summ || null, scheduled_date: date || null };
    var isNew = !_editingIdeaId;
    var req   = isNew
      ? csReq('POST', '/.netlify/functions/content-studio?action=create_idea', body)
      : csReq('PATCH', '/.netlify/functions/content-studio?action=update_idea&id=' + _editingIdeaId, body);

    req.then(function () {
      toast(isNew ? 'Idea created.' : 'Idea updated.');
      csIdeaCancel();
      fetchIdeas();
    }).catch(function (e) { toast(e.message, true); });
  };

  window.csIdeaCancel = function () {
    var wrap = document.getElementById('cs-idea-form-wrap');
    if (wrap) wrap.innerHTML = '';
    _editingIdeaId = null;
  };

  window.csApproveIdea = function (id, currentStatus) {
    var newStatus = currentStatus === 'approved' ? 'draft' : 'approved';
    csReq('PATCH', '/.netlify/functions/content-studio?action=update_idea&id=' + id, { status: newStatus })
      .then(function () { toast('Status updated to ' + newStatus + '.'); fetchIdeas(); })
      .catch(function (e) { toast(e.message, true); });
  };

  window.csDeleteIdea = function (id) {
    if (!confirm('Delete this idea?')) return;
    csReq('PATCH', '/.netlify/functions/content-studio?action=delete_idea&id=' + id)
      .then(function () { toast('Idea deleted.'); fetchIdeas(); })
      .catch(function (e) { toast(e.message, true); });
  };

  // ════════════════════════════════════════════════════════════════════════
  // GENERATE PANEL
  // ════════════════════════════════════════════════════════════════════════

  window.csGenerate = function (contentType) {
    var panel = document.getElementById('cs-generate-panel');
    if (!panel) {
      // If called from dashboard, switch to ideas first
      csSection('ideas');
      setTimeout(function () { csGenerate(contentType); }, 200);
      return;
    }
    panel.innerHTML = '<div class="cs-generate-loading">⚡ Analyzing knowledge base…' + shimmer(2) + '</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var body = { limit: 30 };
    if (contentType) body.content_type = contentType;

    csReq('POST', '/.netlify/functions/content-studio?action=generate', body).then(function (d) {
      var ideas = d.generated || [];
      if (!ideas.length) {
        panel.innerHTML = '<div class="cs-warn">No ideas could be generated. Add published KB articles or research notes first.</div>';
        return;
      }

      var typeLabel = contentType
        ? (CONTENT_TYPES.find(function (t) { return t.value === contentType; }) || {}).label || contentType
        : 'All Types';

      panel.innerHTML = [
        '<div class="cs-generate-results">',
        '  <div class="cs-generate-header">',
        '    <span>⚡ ' + ideas.length + ' ideas generated from ' + d.sources.kb_count + ' KB articles + ' + d.sources.rn_count + ' research notes</span>',
        '    <button class="cs-btn-cancel" onclick="csClearGenerate()">✕ Clear</button>',
        '  </div>',
        '  <div class="cs-gen-list">',
        ideas.map(function (idea, i) {
          return [
            '<div class="cs-gen-item" id="cs-gen-' + i + '">',
            '  <div class="cs-gen-item-top">',
            '    ' + typeBadge(idea.content_type),
            '    <button class="cs-btn-save-gen" onclick="csSaveGenerated(' + i + ')">Save Idea</button>',
            '  </div>',
            '  <div class="cs-gen-title">' + esc(idea.title) + '</div>',
            idea.summary ? '<div class="cs-gen-summary">' + esc(idea.summary) + '</div>' : '',
            renderTrace(idea.source_ids),
            '</div>',
          ].join('');
        }).join(''),
        '  </div>',
        '  <div class="cs-generate-footer">',
        '    <button class="cs-btn-primary" onclick="csSaveAllGenerated()">Save All Ideas</button>',
        '    <button class="cs-btn-cancel" onclick="csClearGenerate()">Discard</button>',
        '  </div>',
        '</div>',
      ].join('');

      // Store for saving
      window._csGeneratedIdeas = ideas;
    }).catch(function (e) {
      panel.innerHTML = '<div class="cs-error">Generation failed: ' + esc(e.message) + '</div>';
    });
  };

  window.csClearGenerate = function () {
    var panel = document.getElementById('cs-generate-panel');
    if (panel) panel.innerHTML = '';
    window._csGeneratedIdeas = [];
  };

  window.csSaveGenerated = function (idx) {
    var ideas = window._csGeneratedIdeas || [];
    var idea  = ideas[idx];
    if (!idea) return;
    csReq('POST', '/.netlify/functions/content-studio?action=create_idea', idea)
      .then(function () {
        toast('Idea saved.');
        var el = document.getElementById('cs-gen-' + idx);
        if (el) el.style.opacity = '0.4';
        fetchIdeas();
      })
      .catch(function (e) { toast(e.message, true); });
  };

  window.csSaveAllGenerated = function () {
    var ideas = window._csGeneratedIdeas || [];
    if (!ideas.length) return;
    var saved = 0;
    var errs  = 0;
    var done  = function () {
      if (saved + errs === ideas.length) {
        toast('Saved ' + saved + ' idea(s).' + (errs ? ' ' + errs + ' error(s).' : ''));
        csClearGenerate();
        fetchIdeas();
      }
    };
    ideas.forEach(function (idea) {
      csReq('POST', '/.netlify/functions/content-studio?action=create_idea', idea)
        .then(function () { saved++; done(); })
        .catch(function () { errs++; done(); });
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // CALENDAR
  // ════════════════════════════════════════════════════════════════════════

  var _calView = 'monthly';
  var _calOffset = 0;

  function loadCalendar(body) {
    body.innerHTML = [
      '<div class="cs-cal-header">',
      '  <div class="cs-cal-nav">',
      '    <button class="cs-cal-btn" onclick="csCalPrev()">‹</button>',
      '    <span class="cs-cal-title" id="cs-cal-title"></span>',
      '    <button class="cs-cal-btn" onclick="csCalNext()">›</button>',
      '  </div>',
      '  <div class="cs-cal-views">',
      '    <button class="cs-view-btn active" id="cs-view-monthly" onclick="csCalView(\'monthly\')">Monthly</button>',
      '    <button class="cs-view-btn" id="cs-view-weekly" onclick="csCalView(\'weekly\')">Weekly</button>',
      '  </div>',
      '</div>',
      '<div id="cs-cal-body"></div>',
    ].join('');
    _calOffset = 0;
    renderCalendar(body);
  }

  function renderCalendar() {
    csReq('GET', '/.netlify/functions/content-studio?section=calendar').then(function (d) {
      var items = d.calendar || [];
      var now   = new Date();
      var titleEl = document.getElementById('cs-cal-title');
      var calBody = document.getElementById('cs-cal-body');
      if (!calBody) return;

      if (_calView === 'monthly') {
        var month = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
        if (titleEl) titleEl.textContent = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        calBody.innerHTML = renderMonthly(month, items);
      } else {
        var startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay() + (_calOffset * 7));
        var endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        if (titleEl) titleEl.textContent = fmt(startOfWeek) + ' – ' + fmt(endOfWeek);
        calBody.innerHTML = renderWeekly(startOfWeek, items);
      }
    }).catch(function (e) {
      var calBody = document.getElementById('cs-cal-body');
      if (calBody) calBody.innerHTML = '<div class="cs-error">' + esc(e.message) + '</div>';
    });
  }

  function renderMonthly(month, items) {
    var year = month.getFullYear(), m = month.getMonth();
    var firstDay = new Date(year, m, 1).getDay();
    var daysInMonth = new Date(year, m + 1, 0).getDate();
    var html = '<div class="cs-cal-grid">';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    html += days.map(function (d) { return '<div class="cs-cal-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < firstDay; i++) html += '<div class="cs-cal-day cs-cal-empty"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + '-' + pad(m + 1) + '-' + pad(day);
      var dayItems = items.filter(function (it) { return (it.scheduled_date || '').startsWith(dateStr); });
      var isToday  = dateStr === todayStr();
      html += '<div class="cs-cal-day' + (isToday ? ' cs-cal-today' : '') + '">';
      html += '<span class="cs-cal-daynum">' + day + '</span>';
      dayItems.forEach(function (it) {
        html += '<div class="cs-cal-item cs-type-' + it.content_type + '" title="' + esc(it.title) + '">' + (TYPE_ICONS[it.content_type] || '•') + ' ' + esc(it.title.slice(0, 25)) + (it.title.length > 25 ? '…' : '') + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    if (!items.length) html += '<div class="cs-empty cs-cal-empty-msg">No ideas scheduled. Edit an idea to add a date.</div>';
    return html;
  }

  function renderWeekly(startOfWeek, items) {
    var html = '<div class="cs-week-grid">';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (var d = 0; d < 7; d++) {
      var dt = new Date(startOfWeek);
      dt.setDate(startOfWeek.getDate() + d);
      var dateStr  = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
      var dayItems = items.filter(function (it) { return (it.scheduled_date || '').startsWith(dateStr); });
      var isToday  = dateStr === todayStr();
      html += '<div class="cs-week-col' + (isToday ? ' cs-cal-today' : '') + '">';
      html += '<div class="cs-week-hdr">' + days[d] + ' ' + pad(dt.getMonth() + 1) + '/' + pad(dt.getDate()) + '</div>';
      if (!dayItems.length) {
        html += '<div class="cs-week-empty">—</div>';
      } else {
        dayItems.forEach(function (it) {
          html += '<div class="cs-cal-item cs-type-' + it.content_type + '">' + (TYPE_ICONS[it.content_type] || '•') + ' ' + esc(it.title) + '</div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  window.csCalPrev = function () { _calOffset--; renderCalendar(); };
  window.csCalNext = function () { _calOffset++; renderCalendar(); };
  window.csCalView = function (v) {
    _calView   = v;
    _calOffset = 0;
    document.querySelectorAll('.cs-view-btn').forEach(function (b) { b.classList.remove('active'); });
    var btn = document.getElementById('cs-view-' + v);
    if (btn) btn.classList.add('active');
    renderCalendar();
  };

  function todayStr() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ════════════════════════════════════════════════════════════════════════
  // SOURCES
  // ════════════════════════════════════════════════════════════════════════

  function loadSources(body) {
    body.innerHTML = '<div class="cs-loading">' + shimmer(3) + '</div>';
    csReq('GET', '/.netlify/functions/content-studio?section=sources').then(function (d) {
      var kb = d.kb_entries    || [];
      var rn = d.research_notes || [];
      body.innerHTML = [
        '<div class="cs-sources-header">',
        '  <span class="cs-sources-lbl">⬡ ' + kb.length + ' Published KB Articles</span>',
        '  <span class="cs-sources-lbl">⌂ ' + rn.length + ' Research Notes</span>',
        '  <button class="cs-btn-primary" onclick="csGenerate(null)">⚡ Generate Ideas from Sources</button>',
        '</div>',
        '<div class="cs-sources-grid">',
        '<div class="cs-source-col">',
        '  <div class="cs-source-hdr">KB Articles</div>',
        kb.length ? kb.map(function (e) {
          return '<div class="cs-source-card">' +
            '<div class="cs-source-title">' + esc(e.title) + '</div>' +
            (e.category ? '<div class="cs-source-meta">' + esc(e.category) + '</div>' : '') +
            (e.summary  ? '<div class="cs-source-summary">' + esc(e.summary.slice(0, 100)) + (e.summary.length > 100 ? '…' : '') + '</div>' : '') +
            ((e.tags || []).length ? '<div class="cs-source-tags">' + e.tags.map(function (t) { return '<span class="cs-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
            '</div>';
        }).join('') : '<div class="cs-empty">No published KB articles yet.</div>',
        '</div>',
        '<div class="cs-source-col">',
        '  <div class="cs-source-hdr">Research Notes</div>',
        rn.length ? rn.map(function (n) {
          return '<div class="cs-source-card">' +
            '<div class="cs-source-title">' + esc(n.title) + '</div>' +
            (n.content ? '<div class="cs-source-summary">' + esc(n.content.slice(0, 100)) + (n.content.length > 100 ? '…' : '') + '</div>' : '') +
            ((n.tags || []).length ? '<div class="cs-source-tags">' + n.tags.map(function (t) { return '<span class="cs-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
            '</div>';
        }).join('') : '<div class="cs-empty">No research notes yet.</div>',
        '</div>',
        '</div>',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="cs-error">Failed to load sources: ' + esc(e.message) + '</div>';
    });
  }

})();
