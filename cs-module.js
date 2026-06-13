// ══════════════════════════════════════════════════════════════════════════
// CONTENT STUDIO MODULE — cs-module.js
// Sections: Dashboard · Intelligence · Ideas · Calendar · Drafts · Sources
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────
  var CONTENT_TYPES = [
    { value: 'social_post',         label: 'Social Post' },
    { value: 'video',               label: 'Video' },
    { value: 'newsletter',          label: 'Newsletter' },
    { value: 'blog',                label: 'Blog' },
    { value: 'training',            label: 'Training' },
    { value: 'book_chapter',        label: 'Book Chapter' },
    { value: 'faq',                 label: 'FAQ' },
    { value: 'faq_series',          label: 'FAQ Series' },
    { value: 'webinar',             label: 'Webinar' },
    { value: 'workshop',            label: 'Workshop' },
    { value: 'podcast_topic',       label: 'Podcast Topic' },
    { value: 'course_module',       label: 'Course Module' },
    { value: 'lead_magnet',         label: 'Lead Magnet' },
    { value: 'case_study',          label: 'Case Study' },
    { value: 'certification_module',label: 'Certification Module' },
  ];

  var TYPE_ICONS = {
    social_post:          '◎',
    video:                '▶',
    newsletter:           '✉',
    blog:                 '✦',
    training:             '◈',
    book_chapter:         '⬡',
    faq:                  '?',
    faq_series:           '?',
    webinar:              '⊕',
    workshop:             '⚙',
    podcast_topic:        '🎙',
    course_module:        '📚',
    lead_magnet:          '⤓',
    case_study:           '◉',
    certification_module: '★',
  };

  var EXT_SOURCE_TYPES = [
    { value: 'search_trend', label: 'Search Trend' },
    { value: 'article',      label: 'Article' },
    { value: 'podcast',      label: 'Podcast' },
    { value: 'book',         label: 'Book' },
    { value: 'video',        label: 'Video' },
    { value: 'webinar',      label: 'Webinar' },
    { value: 'competitor',   label: 'Competitor' },
    { value: 'research',     label: 'Research' },
    { value: 'community',    label: 'Community' },
  ];

  var PRIORITY_COLORS = { critical: '#e53935', high: '#f57c00', medium: '#1976d2', low: '#616161' };

  // ── Auth helper ───────────────────────────────────────────────────────
  function tok() { return sessionStorage.getItem('rea_api_token') || ''; }

  function csReq(method, path, body) {
    var opts = { method: method, headers: { 'X-Dashboard-Token': tok() } };
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

  function priorityBadge(p) {
    if (!p) return '';
    var color = PRIORITY_COLORS[p] || '#616161';
    return '<span class="cs-priority-badge" style="background:' + color + '">' + p.toUpperCase() + '</span>';
  }

  function scoreBadge(idea) {
    if (!idea.priority) return '';
    return [
      '<div class="cs-scores">',
      '<span class="cs-score-item" title="Internal Relevance">INT ' + (idea.internal_score || '—') + '</span>',
      '<span class="cs-score-item" title="Market Interest">MKT ' + (idea.market_score || '—') + '</span>',
      '<span class="cs-score-item" title="Educational Value">EDU ' + (idea.educational_score || '—') + '</span>',
      '<span class="cs-score-item" title="Business Value">BIZ ' + (idea.business_score || '—') + '</span>',
      priorityBadge(idea.priority),
      '</div>',
    ].join('');
  }

  // ── Render source trace ───────────────────────────────────────────────
  function renderTrace(sourceIds) {
    if (!sourceIds || !sourceIds.length) return '';
    var html = '<div class="cs-trace"><span class="cs-trace-lbl">Sources:</span>';
    sourceIds.forEach(function (src) {
      var tableLabel = src.table === 'kb_entries' ? 'KB'
        : src.table === 'research_notes' ? 'RN'
        : src.table === 'content_sources' ? 'EXT'
        : src.table || 'SRC';
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
      '    <button class="cs-snav" onclick="csSection(\'intelligence\')">◉ Intelligence</button>',
      '    <button class="cs-snav" onclick="csSection(\'ideas\')">✦ Ideas</button>',
      '    <button class="cs-snav" onclick="csSection(\'calendar\')">◈ Calendar</button>',
      '    <button class="cs-snav" onclick="csSection(\'library\')">📄 Library</button>',
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
    var sections = ['dashboard', 'intelligence', 'ideas', 'calendar', 'library', 'sources'];
    var idx = sections.indexOf(name);
    if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');

    var body = document.getElementById('cs-body');
    if (!body) return;

    if (name === 'dashboard')         loadDashboard(body);
    else if (name === 'intelligence')  loadIntelligence(body);
    else if (name === 'ideas')         loadIdeas(body, {});
    else if (name === 'calendar')      loadCalendar(body);
    else if (name === 'library')       loadLibrary(body);
    else if (name === 'sources')       loadSources(body);
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
        kpiCard('Critical',        k.critical        || 0, '!'),
        kpiCard('High Priority',   k.high            || 0, '↑'),
        kpiCard('KB Articles',     k.source_articles || 0, '⬡'),
        kpiCard('Research Notes',  k.source_notes    || 0, '⌂'),
        kpiCard('Ext Sources',     k.ext_sources     || 0, '◉'),
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
        '    <button class="cs-action-btn" onclick="csSection(\'intelligence\')">◉ View Intelligence</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'social_post\')">◎ Generate Social Posts</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'training\')">◈ Generate Training Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'book_chapter\')">⬡ Generate Book Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(\'video\')">▶ Generate Video Topics</button>',
        '    <button class="cs-action-btn" onclick="csGenerate(null)">✦ Generate All Ideas</button>',
        '    <button class="cs-action-btn cs-action-secondary" onclick="csSection(\'ideas\')">View All Ideas →</button>',
        '    <button class="cs-action-btn cs-action-secondary" onclick="csSection(\'library\')">📄 Content Library →</button>',
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
      return '<li>' + priorityBadge(i.priority) + '<span class="cs-recent-type">' + (TYPE_ICONS[i.content_type] || '•') + '</span> ' + esc(i.title) + '</li>';
    }).join('') + '</ul>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // INTELLIGENCE
  // ════════════════════════════════════════════════════════════════════════

  function loadIntelligence(body) {
    body.innerHTML = '<div class="cs-loading">' + shimmer(4) + '</div>';
    csReq('GET', '/.netlify/functions/content-studio?section=intelligence').then(function (d) {
      var s = d.summary || {};
      body.innerHTML = [
        '<div class="cs-intel-header">',
        '  <div class="cs-intel-meta">',
        '    <span class="cs-intel-stat">◉ ' + (s.ext_sources_count || 0) + ' External Sources</span>',
        '    <span class="cs-intel-stat">⌂ ' + (s.internal_notes_count || 0) + ' Research Notes</span>',
        '    <span class="cs-intel-stat">⬡ ' + (s.kb_count || 0) + ' KB Articles</span>',
        '  </div>',
        '  <button class="cs-btn-primary" onclick="csSection(\'sources\')">+ Add External Source</button>',
        '</div>',

        // Trending Topics
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">🔥 Trending Topics</div>',
        renderTrendingTopics(d.trending_topics || []),
        '</div>',

        // Emerging Themes
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">🌱 Emerging Themes</div>',
        renderSourceCards(d.emerging_themes || [], 'No recent high-relevance sources. Add external content to see emerging themes.'),
        '</div>',

        // High Interest Topics
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">⭐ High Interest Topics</div>',
        renderSourceCards(d.high_interest || [], 'No high-interest sources yet (relevance ≥ 8).'),
        '</div>',

        // FAQ Opportunities
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">? FAQ Opportunities</div>',
        renderSourceCards(d.faq_opportunities || [], 'No search trend or community sources yet.'),
        '</div>',

        // Underserved Topics
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">⚡ Underserved Topics</div>',
        renderUnderserved(d.underserved_topics || []),
        '</div>',

        // Competitor Gaps
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">◈ Competitor Gaps</div>',
        renderCompetitorGaps(d.competitor_gaps || []),
        '</div>',

        // Internal Pattern Matches
        '<div class="cs-intel-section">',
        '  <div class="cs-intel-title">⬡ Internal Pattern Matches</div>',
        renderPatternMatches(d.pattern_matches || []),
        '</div>',

        // Generate from intelligence
        d.summary && (d.trending_topics || []).length > 0 ? [
          '<div class="cs-dash-card cs-quick-actions">',
          '  <div class="cs-card-title">Generate from Intelligence</div>',
          '  <div class="cs-action-row">',
          '    <button class="cs-action-btn" onclick="csGenerate(null)">✦ Generate All (scored)</button>',
          '    <button class="cs-action-btn" onclick="csGenerate(\'social_post\')">◎ Social Posts</button>',
          '    <button class="cs-action-btn" onclick="csGenerate(\'faq_series\')">? FAQ Series</button>',
          '    <button class="cs-action-btn" onclick="csGenerate(\'podcast_topic\')">🎙 Podcast Topics</button>',
          '    <button class="cs-action-btn" onclick="csGenerate(\'lead_magnet\')">⤓ Lead Magnets</button>',
          '  </div>',
          '</div>',
        ].join('') : '',
      ].join('');
    }).catch(function (e) {
      body.innerHTML = '<div class="cs-error">Failed to load intelligence: ' + esc(e.message) + '</div>';
    });
  }

  function renderTrendingTopics(topics) {
    if (!topics.length) return '<div class="cs-empty">No external sources yet. Add sources in the Sources section to surface trending topics.</div>';
    return '<div class="cs-intel-tags">' + topics.map(function (t) {
      return '<span class="cs-intel-tag" title="' + t.count + ' source(s), avg score ' + t.avg_score + '">' +
        esc(t.tag) + ' <small>×' + t.count + ' · ' + t.avg_score + '/10</small></span>';
    }).join('') + '</div>';
  }

  function renderSourceCards(items, emptyMsg) {
    if (!items.length) return '<div class="cs-empty">' + emptyMsg + '</div>';
    return '<div class="cs-intel-cards">' + items.map(function (s) {
      return '<div class="cs-intel-card">' +
        '<div class="cs-intel-card-title">' + esc(s.title) + '</div>' +
        (s.type ? '<span class="cs-intel-type-chip">' + esc(s.type) + '</span>' : '') +
        (s.score ? '<span class="cs-intel-score">' + s.score + '/10</span>' : '') +
        ((s.tags || []).length ? '<div class="cs-source-tags">' + s.tags.map(function (t) { return '<span class="cs-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        (s.url ? '<a class="cs-intel-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">View →</a>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function renderUnderserved(topics) {
    if (!topics.length) return '<div class="cs-empty">No underserved topics identified. Trending topics with no internal coverage will appear here.</div>';
    return '<div class="cs-intel-tags">' + topics.map(function (t) {
      return '<span class="cs-intel-tag cs-intel-tag-gap" title="External demand, no internal coverage">' +
        esc(t.tag) + ' <small>×' + t.count + '</small></span>';
    }).join('') + '</div>';
  }

  function renderCompetitorGaps(gaps) {
    if (!gaps.length) return '<div class="cs-empty">No competitor sources added. Add sources with type "competitor" to surface gaps.</div>';
    return '<div class="cs-intel-cards">' + gaps.map(function (g) {
      return '<div class="cs-intel-card cs-intel-card-competitor">' +
        '<div class="cs-intel-card-title">' + esc(g.title) + '</div>' +
        '<span class="cs-intel-score">' + (g.score || 0) + '/10</span>' +
        (g.summary ? '<div class="cs-intel-summary">' + esc(g.summary.slice(0, 120)) + '…</div>' : '') +
        ((g.tags || []).length ? '<div class="cs-source-tags">' + g.tags.map(function (t) { return '<span class="cs-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function renderPatternMatches(patterns) {
    if (!patterns.length) return '<div class="cs-empty">No internal research patterns found. Add research notes to reveal pattern-intelligence overlaps.</div>';
    return '<div class="cs-intel-patterns">' + patterns.map(function (p) {
      var supported = p.opportunity === 'supported';
      return '<div class="cs-intel-pattern' + (supported ? ' cs-intel-pattern-match' : '') + '">' +
        '<span class="cs-intel-pattern-tag">' + esc(p.pattern) + '</span>' +
        '<span class="cs-intel-pattern-stat">Internal: ' + p.internal_count + '</span>' +
        '<span class="cs-intel-pattern-stat">External: ' + p.external_matches + '</span>' +
        '<span class="cs-intel-opp' + (supported ? ' cs-intel-opp-ok' : '') + '">' + (supported ? '✔ Supported' : 'Internal only') + '</span>' +
        '</div>';
    }).join('') + '</div>';
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
        scoreBadge(idea),
        '    <div class="cs-idea-actions">',
        '      <button class="cs-btn-edit" onclick="csEditIdea(\'' + idea.id + '\')">Edit</button>',
        '      <button class="cs-btn-approve" onclick="csApproveIdea(\'' + idea.id + '\', \'' + idea.status + '\')">' + (idea.status === 'approved' ? 'Unapprove' : 'Approve') + '</button>',
        idea.status === 'approved' ? '      <button class="cs-btn-draft" onclick="csGenerateDraft(\'' + idea.id + '\')">📄 Generate Draft</button>' : '',
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
      csSection('ideas');
      setTimeout(function () { csGenerate(contentType); }, 200);
      return;
    }
    panel.innerHTML = '<div class="cs-generate-loading">⚡ Analyzing knowledge base + intelligence sources…' + shimmer(2) + '</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var body = { limit: 30 };
    if (contentType) body.content_type = contentType;

    csReq('POST', '/.netlify/functions/content-studio?action=generate', body).then(function (d) {
      var ideas = d.generated || [];
      if (!ideas.length) {
        panel.innerHTML = '<div class="cs-warn">No ideas could be generated. Add published KB articles or research notes first.</div>';
        return;
      }

      panel.innerHTML = [
        '<div class="cs-generate-results">',
        '  <div class="cs-generate-header">',
        '    <span>⚡ ' + ideas.length + ' ideas generated from ' + d.sources.kb_count + ' KB · ' + d.sources.rn_count + ' RN · ' + (d.sources.ext_count || 0) + ' Ext sources</span>',
        '    <button class="cs-btn-cancel" onclick="csClearGenerate()">✕ Clear</button>',
        '  </div>',
        '  <div class="cs-gen-list">',
        ideas.map(function (idea, i) {
          return [
            '<div class="cs-gen-item" id="cs-gen-' + i + '">',
            '  <div class="cs-gen-item-top">',
            '    ' + typeBadge(idea.content_type),
            scoreBadge(idea),
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
  // SOURCES — Internal + External
  // ════════════════════════════════════════════════════════════════════════

  var _extSourceFilter = '';
  var _newSourceFormOpen = false;

  function loadSources(body) {
    body.innerHTML = '<div class="cs-loading">' + shimmer(3) + '</div>';
    Promise.all([
      csReq('GET', '/.netlify/functions/content-studio?section=sources'),
      csReq('GET', '/.netlify/functions/content-studio?section=content_sources' + (_extSourceFilter ? '&type=' + _extSourceFilter : '')),
    ]).then(function (results) {
      var internal = results[0];
      var external = results[1];
      var kb = internal.kb_entries    || [];
      var rn = internal.research_notes || [];
      var ext = external.sources || [];

      body.innerHTML = [
        // External sources management
        '<div class="cs-sources-ext-header">',
        '  <div class="cs-sources-ext-title">◉ External Intelligence Sources</div>',
        '  <div class="cs-sources-ext-controls">',
        '    <select class="cs-filter-select" id="cs-ext-type-filter" onchange="csFilterExtSources()">',
        '      <option value="">All Types</option>',
        EXT_SOURCE_TYPES.map(function (t) {
          return '<option value="' + t.value + '"' + (_extSourceFilter === t.value ? ' selected' : '') + '>' + t.label + '</option>';
        }).join(''),
        '    </select>',
        '    <button class="cs-btn-primary" onclick="csNewSourceForm()">+ Add Source</button>',
        '  </div>',
        '</div>',
        '<div id="cs-source-form-wrap"></div>',
        ext.length ? renderExtSourcesList(ext) : '<div class="cs-empty cs-ext-empty">No external sources yet. Add search trends, articles, podcasts, competitor content, and more to power the Intelligence layer.</div>',

        // Internal sources (read-only reference)
        '<div class="cs-sources-int-header">',
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

  function renderExtSourcesList(sources) {
    return '<div class="cs-ext-sources-list">' + sources.map(function (s) {
      return [
        '<div class="cs-ext-source-card" id="cs-ext-src-' + s.id + '">',
        '  <div class="cs-ext-src-top">',
        '    <span class="cs-intel-type-chip">' + esc(s.source_type) + '</span>',
        '    <span class="cs-intel-score">' + (s.relevance_score || 5) + '/10</span>',
        '    <button class="cs-btn-delete" onclick="csDeleteExtSource(\'' + s.id + '\')">Delete</button>',
        '  </div>',
        '  <div class="cs-ext-src-title">' + esc(s.source_title) + '</div>',
        s.source_url ? '<a class="cs-intel-link" href="' + esc(s.source_url) + '" target="_blank" rel="noopener">View →</a>' : '',
        s.source_summary ? '<div class="cs-source-summary">' + esc(s.source_summary.slice(0, 120)) + (s.source_summary.length > 120 ? '…' : '') + '</div>' : '',
        (s.source_tags || []).length ? '<div class="cs-source-tags">' + s.source_tags.map(function (t) { return '<span class="cs-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '',
        s.source_date ? '<div class="cs-source-meta">Date: ' + fmt(s.source_date) + '</div>' : '',
        '</div>',
      ].join('');
    }).join('') + '</div>';
  }

  window.csNewSourceForm = function () {
    var wrap = document.getElementById('cs-source-form-wrap');
    if (!wrap) return;
    var typeOpts = EXT_SOURCE_TYPES.map(function (t) {
      return '<option value="' + t.value + '">' + t.label + '</option>';
    }).join('');
    wrap.innerHTML = [
      '<div class="cs-form" id="cs-source-form">',
      '  <div class="cs-form-row"><label class="cs-label">Source Type *</label>',
      '    <select class="cs-input" id="csSrcType"><option value="">— select —</option>' + typeOpts + '</select></div>',
      '  <div class="cs-form-row"><label class="cs-label">Title *</label>',
      '    <input class="cs-input" id="csSrcTitle" placeholder="Source title…"></div>',
      '  <div class="cs-form-row"><label class="cs-label">URL</label>',
      '    <input class="cs-input" id="csSrcUrl" placeholder="https://…"></div>',
      '  <div class="cs-form-row"><label class="cs-label">Summary</label>',
      '    <textarea class="cs-textarea" id="csSrcSummary" rows="2" placeholder="Brief summary of this source…"></textarea></div>',
      '  <div class="cs-form-row"><label class="cs-label">Tags (comma-separated)</label>',
      '    <input class="cs-input" id="csSrcTags" placeholder="energy healing, chakras, meditation…"></div>',
      '  <div class="cs-form-row"><label class="cs-label">Date</label>',
      '    <input class="cs-input" id="csSrcDate" type="date"></div>',
      '  <div class="cs-form-row"><label class="cs-label">Relevance Score (1–10)</label>',
      '    <input class="cs-input" id="csSrcScore" type="number" min="1" max="10" value="5"></div>',
      '  <div class="cs-form-actions">',
      '    <button class="cs-btn-primary" onclick="csSourceSave()">Add Source</button>',
      '    <button class="cs-btn-cancel" onclick="csSourceCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.csSourceSave = function () {
    var stype = (document.getElementById('csSrcType')    || {}).value || '';
    var title = (document.getElementById('csSrcTitle')   || {}).value || '';
    var url   = (document.getElementById('csSrcUrl')     || {}).value || '';
    var summ  = (document.getElementById('csSrcSummary') || {}).value || '';
    var tags  = (document.getElementById('csSrcTags')    || {}).value || '';
    var date  = (document.getElementById('csSrcDate')    || {}).value || null;
    var score = parseInt((document.getElementById('csSrcScore') || {}).value || '5', 10);

    if (!stype) { toast('Source type is required.', true); return; }
    if (!title.trim()) { toast('Title is required.', true); return; }

    var body = {
      source_type:    stype,
      source_title:   title.trim(),
      source_url:     url  || null,
      source_summary: summ || null,
      source_tags:    tags ? tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [],
      source_date:    date || null,
      relevance_score: isNaN(score) ? 5 : Math.min(10, Math.max(1, score)),
    };

    csReq('POST', '/.netlify/functions/content-studio?action=create_source', body)
      .then(function () {
        toast('Source added.');
        csSourceCancel();
        var csBody = document.getElementById('cs-body');
        if (csBody) loadSources(csBody);
      })
      .catch(function (e) { toast(e.message, true); });
  };

  window.csSourceCancel = function () {
    var wrap = document.getElementById('cs-source-form-wrap');
    if (wrap) wrap.innerHTML = '';
  };

  window.csDeleteExtSource = function (id) {
    if (!confirm('Delete this external source?')) return;
    csReq('PATCH', '/.netlify/functions/content-studio?action=delete_source&id=' + id)
      .then(function () {
        toast('Source deleted.');
        var csBody = document.getElementById('cs-body');
        if (csBody) loadSources(csBody);
      })
      .catch(function (e) { toast(e.message, true); });
  };

  window.csFilterExtSources = function () {
    var el = document.getElementById('cs-ext-type-filter');
    _extSourceFilter = el ? el.value : '';
    var csBody = document.getElementById('cs-body');
    if (csBody) loadSources(csBody);
  };

  // ════════════════════════════════════════════════════════════════════════
  // GENERATE DRAFT (from approved idea)
  // ════════════════════════════════════════════════════════════════════════

  window.csGenerateDraft = function (ideaId) {
    var btn = document.querySelector('[onclick="csGenerateDraft(\'' + ideaId + '\')"]');
    if (btn) { btn.textContent = '⏳ Generating…'; btn.disabled = true; }
    csReq('POST', '/.netlify/functions/content-studio?action=generate_draft', { content_idea_id: ideaId })
      .then(function (d) {
        toast('Draft generated! Opening Content Library…');
        setTimeout(function () { csSection('library'); }, 600);
      })
      .catch(function (e) {
        toast('Draft generation failed: ' + e.message, true);
        if (btn) { btn.textContent = '📄 Generate Draft'; btn.disabled = false; }
      });
  };

  // ════════════════════════════════════════════════════════════════════════
  // CONTENT LIBRARY
  // ════════════════════════════════════════════════════════════════════════

  var _libFilter   = 'all';
  var _libSearch   = '';
  var _editDraftId = null;

  function loadLibrary(body) {
    body.innerHTML = '<div class="cs-loading">' + shimmer(4) + '</div>';
    csReq('GET', '/.netlify/functions/content-studio?section=library').then(function (lib) {
      var c = lib.counts || {};
      var warn = lib.migration_needed ? '<div class="cs-warn">Run migration 2026-06-13-content-drafts.sql in Supabase to enable the Content Library.</div>' : '';

      body.innerHTML = warn + [
        // Library header KPIs
        '<div class="cs-lib-header">',
        '  <div class="cs-lib-title">📄 Content Library</div>',
        '  <button class="cs-btn-primary" onclick="csNewDraftForm()">+ New Draft</button>',
        '</div>',
        '<div class="cs-lib-kpis">',
        libKpi('All',       c.total     || 0, 'all',       _libFilter),
        libKpi('Draft',     c.draft     || 0, 'draft',     _libFilter),
        libKpi('Review',    c.review    || 0, 'review',    _libFilter),
        libKpi('Approved',  c.approved  || 0, 'approved',  _libFilter),
        libKpi('Published', c.published || 0, 'published', _libFilter),
        libKpi('Archived',  c.archived  || 0, 'archived',  _libFilter),
        '</div>',

        // Search + filter
        '<div class="cs-lib-controls">',
        '  <input id="cs-lib-search" class="cs-search" placeholder="Search drafts…" oninput="csLibSearch()" value="' + esc(_libSearch) + '">',
        '  <select class="cs-filter-select" id="cs-lib-type-filter" onchange="csLibTypeFilter()">',
        '    <option value="">All Types</option>',
        CONTENT_TYPES.map(function (t) { return '<option value="' + t.value + '">' + t.label + '</option>'; }).join(''),
        '  </select>',
        '</div>',

        // Form placeholder
        '<div id="cs-draft-form-wrap"></div>',

        // Drafts list
        '<div id="cs-lib-list">' + shimmer(3) + '</div>',
      ].join('');

      fetchDrafts();
    }).catch(function (e) {
      body.innerHTML = '<div class="cs-error">Failed to load library: ' + esc(e.message) + '</div>';
    });
  }

  function libKpi(label, count, filterVal, active) {
    var isActive = active === filterVal;
    return '<button class="cs-lib-kpi' + (isActive ? ' cs-lib-kpi-active' : '') + '" onclick="csLibFilter(\'' + filterVal + '\')">' +
      '<span class="cs-lib-kpi-num">' + count + '</span>' +
      '<span class="cs-lib-kpi-lbl">' + label + '</span>' +
      '</button>';
  }

  function fetchDrafts() {
    var qs = '?section=drafts';
    if (_libFilter && _libFilter !== 'all') qs += '&status=' + _libFilter;
    if (_libSearch) qs += '&search=' + encodeURIComponent(_libSearch);
    var el = document.getElementById('cs-lib-list');
    if (el) el.innerHTML = shimmer(3);
    csReq('GET', '/.netlify/functions/content-studio' + qs).then(function (d) {
      renderDraftList(d.drafts || []);
    }).catch(function (e) {
      var el2 = document.getElementById('cs-lib-list');
      if (el2) el2.innerHTML = '<div class="cs-error">' + esc(e.message) + '</div>';
    });
  }

  function renderDraftList(drafts) {
    var el = document.getElementById('cs-lib-list');
    if (!el) return;
    if (!drafts.length) {
      el.innerHTML = '<div class="cs-empty">No drafts yet. Approve an idea and click "Generate Draft" to create your first content draft.</div>';
      return;
    }
    el.innerHTML = drafts.map(function (d) {
      return renderDraftCard(d);
    }).join('');
  }

  function renderDraftCard(d) {
    var statusActions = draftStatusActions(d);
    var preview = d.draft_content ? d.draft_content.replace(/#+\s/g, '').slice(0, 200) : '';
    return [
      '<div class="cs-draft-card" id="cs-draft-' + d.id + '">',
      '  <div class="cs-draft-top">',
      '    ' + typeBadge(d.content_type),
      '    ' + draftStatusBadge(d.status),
      d.generation_method === 'generated' ? '<span class="cs-gen-badge">⚡ Generated</span>' : '<span class="cs-gen-badge cs-gen-manual">✎ Manual</span>',
      '    <div class="cs-draft-actions">',
      statusActions,
      '      <button class="cs-btn-edit" onclick="csEditDraft(\'' + d.id + '\')">Edit</button>',
      '      <button class="cs-btn-delete" onclick="csDeleteDraft(\'' + d.id + '\')">Delete</button>',
      '    </div>',
      '  </div>',
      '  <div class="cs-draft-title">' + esc(d.title) + '</div>',
      preview ? '<div class="cs-draft-preview">' + esc(preview) + (d.draft_content.length > 200 ? '…' : '') + '</div>' : '',
      renderTrace(d.source_ids),
      '<div class="cs-draft-meta">Created ' + fmt(d.created_at) + '</div>',
      '</div>',
    ].join('');
  }

  function draftStatusBadge(s) {
    var colors = { draft: '#7a7060', review: '#1976d2', approved: '#2e7d32', published: '#6a1b9a', archived: '#424242' };
    var color = colors[s] || '#7a7060';
    return '<span class="cs-draft-status" style="background:' + color + '">' + s.toUpperCase() + '</span>';
  }

  function draftStatusActions(d) {
    var html = '';
    if (d.status === 'draft')     html += '<button class="cs-btn-workflow" onclick="csReviewDraft(\'' + d.id + '\')">Send to Review</button>';
    if (d.status === 'review')    html += '<button class="cs-btn-workflow cs-btn-approve" onclick="csApproveDraft(\'' + d.id + '\')">Approve</button>';
    if (d.status === 'approved')  html += '<button class="cs-btn-workflow cs-btn-publish" onclick="csPublishDraft(\'' + d.id + '\')">Publish</button>';
    if (d.status !== 'archived')  html += '<button class="cs-btn-workflow cs-btn-archive" onclick="csArchiveDraft(\'' + d.id + '\')">Archive</button>';
    return html;
  }

  // ── Library controls ─────────────────────────────────────────────────

  window.csLibFilter = function (filterVal) {
    _libFilter = filterVal;
    var csBody = document.getElementById('cs-body');
    if (csBody) loadLibrary(csBody);
  };

  window.csLibSearch = function () {
    var el = document.getElementById('cs-lib-search');
    _libSearch = el ? el.value : '';
    fetchDrafts();
  };

  window.csLibTypeFilter = function () {
    var el = document.getElementById('cs-lib-type-filter');
    var qs = '?section=drafts';
    if (_libFilter && _libFilter !== 'all') qs += '&status=' + _libFilter;
    if (el && el.value) qs += '&content_type=' + el.value;
    if (_libSearch) qs += '&search=' + encodeURIComponent(_libSearch);
    var listEl = document.getElementById('cs-lib-list');
    if (listEl) listEl.innerHTML = shimmer(3);
    csReq('GET', '/.netlify/functions/content-studio' + qs).then(function (d) {
      renderDraftList(d.drafts || []);
    }).catch(function (e) {
      if (listEl) listEl.innerHTML = '<div class="cs-error">' + esc(e.message) + '</div>';
    });
  };

  // ── Draft form ───────────────────────────────────────────────────────

  window.csNewDraftForm = function () {
    _editDraftId = null;
    renderDraftForm({});
  };

  window.csEditDraft = function (id) {
    _editDraftId = id;
    csReq('GET', '/.netlify/functions/content-studio?section=drafts').then(function (d) {
      var draft = (d.drafts || []).find(function (dr) { return dr.id === id; });
      if (draft) renderDraftForm(draft);
    }).catch(function (e) { toast(e.message, true); });
  };

  function renderDraftForm(draft) {
    var wrap = document.getElementById('cs-draft-form-wrap');
    if (!wrap) return;
    var typeOpts = CONTENT_TYPES.map(function (t) {
      return '<option value="' + t.value + '"' + (draft.content_type === t.value ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');
    wrap.innerHTML = [
      '<div class="cs-form cs-draft-form" id="cs-draft-form">',
      '  <div class="cs-form-row"><label class="cs-label">Title *</label>',
      '    <input class="cs-input" id="csDraftTitle" value="' + esc(draft.title || '') + '" placeholder="Draft title…"></div>',
      draft.id ? '' : [
        '  <div class="cs-form-row"><label class="cs-label">Content Type *</label>',
        '    <select class="cs-input" id="csDraftType"><option value="">— select —</option>' + typeOpts + '</select></div>',
      ].join(''),
      '  <div class="cs-form-row"><label class="cs-label">Draft Content</label>',
      '    <textarea class="cs-textarea cs-draft-textarea" id="csDraftContent" rows="20" placeholder="Write or paste draft content here…">' + esc(draft.draft_content || '') + '</textarea></div>',
      '  <div class="cs-form-actions">',
      '    <button class="cs-btn-primary" onclick="csDraftSave()">Save Draft</button>',
      '    <button class="cs-btn-cancel" onclick="csDraftCancel()">Cancel</button>',
      '  </div>',
      '</div>',
    ].join('');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.csDraftSave = function () {
    var title   = (document.getElementById('csDraftTitle')   || {}).value || '';
    var content = (document.getElementById('csDraftContent') || {}).value || '';
    var ctype   = (document.getElementById('csDraftType')    || {}).value || '';

    if (!title.trim()) { toast('Title is required.', true); return; }

    var isNew = !_editDraftId;
    if (isNew && !ctype) { toast('Content type is required.', true); return; }

    var body = isNew
      ? { title: title.trim(), content_type: ctype, draft_content: content }
      : { title: title.trim(), draft_content: content };

    var req = isNew
      ? csReq('POST', '/.netlify/functions/content-studio?action=create_draft', body)
      : csReq('PATCH', '/.netlify/functions/content-studio?action=update_draft&id=' + _editDraftId, body);

    req.then(function () {
      toast(isNew ? 'Draft created.' : 'Draft saved.');
      csDraftCancel();
      fetchDrafts();
    }).catch(function (e) { toast(e.message, true); });
  };

  window.csDraftCancel = function () {
    var wrap = document.getElementById('cs-draft-form-wrap');
    if (wrap) wrap.innerHTML = '';
    _editDraftId = null;
  };

  // ── Draft workflow ───────────────────────────────────────────────────

  function draftTransition(id, action, label) {
    csReq('PATCH', '/.netlify/functions/content-studio?action=' + action + '&id=' + id)
      .then(function (d) {
        toast('Draft status: ' + (d.draft ? d.draft.status : label));
        fetchDrafts();
      })
      .catch(function (e) { toast(e.message, true); });
  }

  window.csReviewDraft  = function (id) { draftTransition(id, 'review_draft',  'review');    };
  window.csApproveDraft = function (id) { draftTransition(id, 'approve_draft', 'approved');  };
  window.csPublishDraft = function (id) { draftTransition(id, 'publish_draft', 'published'); };
  window.csArchiveDraft = function (id) { draftTransition(id, 'archive_draft', 'archived');  };

  window.csDeleteDraft  = function (id) {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    csReq('PATCH', '/.netlify/functions/content-studio?action=delete_draft&id=' + id)
      .then(function () { toast('Draft deleted.'); fetchDrafts(); })
      .catch(function (e) { toast(e.message, true); });
  };

})();
