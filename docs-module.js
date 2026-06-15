// docs-module.js
// Documentation & Handoff Center — Phase 1, Sprint 13B
// Renders markdown docs, tracks review status, stores state in localStorage.

(function () {
  'use strict';

  // ── Document registry ─────────────────────────────────────────────────────
  var DOCS = [
    {
      key:   'executive-overview',
      file:  '/docs/executive-system-overview.md',
      title: 'Executive System Overview',
      desc:  'Business-level overview of the entire platform — what it does, what it tracks, and what you own.',
      icon:  '◇',
    },
    {
      key:   'practitioner-guide',
      file:  '/docs/practitioner-user-guide.md',
      title: 'Practitioner User Guide',
      desc:  'Daily workflow guide — before, during, and after sessions. Tips and troubleshooting.',
      icon:  '✦',
    },
    {
      key:   'admin-guide',
      file:  '/docs/administrator-technical-guide.md',
      title: 'Administrator Technical Guide',
      desc:  'Full technical reference: stack, database schema, environment variables, migrations, QA.',
      icon:  '⚙',
    },
    {
      key:   'ai-architecture',
      file:  '/docs/ai-architecture-blueprint.md',
      title: 'AI Architecture Blueprint',
      desc:  'How the AI pattern engine works today and the roadmap for multi-practitioner expansion.',
      icon:  '◉',
    },
    {
      key:   'platform-architecture',
      file:  '/docs/PLATFORM_ARCHITECTURE.md',
      title: 'Platform Architecture',
      desc:  'Full platform architecture including deployment, functions, and data flow.',
      icon:  '◈',
    },
  ];

  var STATUSES = ['Not Started', 'In Review', 'Reviewed', 'Complete', 'Needs Update'];

  var STATUS_COLORS = {
    'Not Started':  '#6660a0',
    'In Review':    '#e8b84b',
    'Reviewed':     '#22c98a',
    'Complete':     '#22c98a',
    'Needs Update': '#ee7070',
  };

  // ── LocalStorage helpers ──────────────────────────────────────────────────

  function storeKey(key) { return 'rea_doc_' + key; }

  function getDocState(key) {
    try {
      var raw = localStorage.getItem(storeKey(key));
      return raw ? JSON.parse(raw) : { status: 'Not Started', notes: '', reviewedAt: null };
    } catch(e) { return { status: 'Not Started', notes: '', reviewedAt: null }; }
  }

  function saveDocState(key, state) {
    try { localStorage.setItem(storeKey(key), JSON.stringify(state)); } catch(e) {}
  }

  // ── Markdown renderer ─────────────────────────────────────────────────────

  function renderMarkdown(md) {
    // Escape HTML in code blocks first, then process
    var lines    = md.split('\n');
    var html     = [];
    var inCode   = false;
    var codeLang = '';
    var codeLines = [];
    var inTable  = false;
    var tableLines = [];
    var inList   = false;
    var listType = '';
    var listItems = [];

    function flushList() {
      if (!listItems.length) return;
      var tag = listType === 'ol' ? 'ol' : 'ul';
      html.push('<' + tag + ' class="doc-list">' + listItems.map(function(l){ return '<li>' + l + '</li>'; }).join('') + '</' + tag + '>');
      listItems = [];
      inList    = false;
    }

    function flushTable() {
      if (!tableLines.length) return;
      var rows = tableLines.filter(function(l){ return !/^[\s\|\-:]+$/.test(l); });
      if (!rows.length) { tableLines = []; inTable = false; return; }
      var header = rows[0].split('|').map(function(c){ return c.trim(); }).filter(Boolean);
      var body   = rows.slice(1);
      var tableHtml = '<div class="doc-table-wrap"><table class="doc-table"><thead><tr>' +
        header.map(function(h){ return '<th>' + inlineRender(h) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        body.map(function(row){
          var cells = row.split('|').map(function(c){ return c.trim(); }).filter(Boolean);
          return '<tr>' + cells.map(function(c){ return '<td>' + inlineRender(c) + '</td>'; }).join('') + '</tr>';
        }).join('') +
        '</tbody></table></div>';
      html.push(tableHtml);
      tableLines = [];
      inTable    = false;
    }

    function inlineRender(s) {
      return s
        .replace(/`([^`]+)`/g, '<code class="doc-inline-code">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="doc-link">$1</a>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Code block fence
      if (line.match(/^```/)) {
        if (!inCode) {
          flushList();
          flushTable();
          inCode   = true;
          codeLang = line.slice(3).trim();
          codeLines = [];
        } else {
          var esc = codeLines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          html.push('<pre class="doc-pre"><code class="doc-code">' + esc + '</code></pre>');
          inCode = false;
          codeLines = [];
        }
        continue;
      }

      if (inCode) { codeLines.push(line); continue; }

      // Table detection
      if (line.includes('|')) {
        flushList();
        inTable = true;
        tableLines.push(line);
        continue;
      }
      if (inTable && !line.includes('|')) { flushTable(); }

      // HR
      if (line.match(/^---+$/)) { flushList(); html.push('<hr class="doc-hr">'); continue; }

      // Headings
      var hMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (hMatch) {
        flushList();
        var level = hMatch[1].length;
        html.push('<h' + level + ' class="doc-h' + level + '">' + inlineRender(hMatch[2]) + '</h' + level + '>');
        continue;
      }

      // Unordered list
      var ulMatch = line.match(/^[\s]*[-*+]\s+(.+)/);
      if (ulMatch) {
        if (inList && listType !== 'ul') flushList();
        inList   = true;
        listType = 'ul';
        listItems.push(inlineRender(ulMatch[1]));
        continue;
      }

      // Ordered list
      var olMatch = line.match(/^[\s]*\d+\.\s+(.+)/);
      if (olMatch) {
        if (inList && listType !== 'ol') flushList();
        inList   = true;
        listType = 'ol';
        listItems.push(inlineRender(olMatch[1]));
        continue;
      }

      // Blank line — flush lists
      if (!line.trim()) {
        flushList();
        flushTable();
        html.push('<div class="doc-spacer"></div>');
        continue;
      }

      // Blockquote
      var bqMatch = line.match(/^>\s*(.+)/);
      if (bqMatch) { flushList(); html.push('<blockquote class="doc-bq">' + inlineRender(bqMatch[1]) + '</blockquote>'); continue; }

      // Paragraph
      flushList();
      html.push('<p class="doc-p">' + inlineRender(line) + '</p>');
    }

    flushList();
    flushTable();
    return html.join('\n');
  }

  // ── Render functions ──────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function statusBadge(status) {
    var col = STATUS_COLORS[status] || '#6660a0';
    return '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;' +
      'color:' + col + ';background:' + col + '15;border:1px solid ' + col + '44;padding:3px 10px">' +
      esc(status) + '</span>';
  }

  function renderCards(wrap) {
    var grid = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:32px">';
    DOCS.forEach(function(doc) {
      var state = getDocState(doc.key);
      var col   = STATUS_COLORS[state.status] || '#6660a0';
      grid +=
        '<div style="background:#09050f;border:1px solid ' + col + '33;padding:24px;cursor:pointer;' +
          'transition:all .2s;border-left:3px solid ' + col + '" ' +
          'onclick="window.docsOpenViewer(\'' + doc.key + '\')" ' +
          'onmouseover="this.style.background=\'#e8b84b05\'" onmouseout="this.style.background=\'#09050f\'">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px">' +
            '<div style="font-size:22px;color:' + col + ';line-height:1">' + doc.icon + '</div>' +
            statusBadge(state.status) +
          '</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:14px;letter-spacing:.05em;color:#f0ecff;margin-bottom:8px">' + esc(doc.title) + '</div>' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#9b9ac0;line-height:1.6;margin-bottom:12px">' + esc(doc.desc) + '</div>' +
          (state.reviewedAt ? '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;color:#6660a0;text-transform:uppercase">Last reviewed: ' + esc(state.reviewedAt) + '</div>' : '') +
        '</div>';
    });
    grid += '</div>';

    // Completion bar
    var counts = { 'Not Started':0, 'In Review':0, 'Reviewed':0, 'Complete':0, 'Needs Update':0 };
    var complete = 0;
    DOCS.forEach(function(doc) {
      var s = getDocState(doc.key).status;
      counts[s] = (counts[s] || 0) + 1;
      if (s === 'Reviewed' || s === 'Complete') complete++;
    });
    var pct = Math.round(complete / DOCS.length * 100);

    var summary =
      '<div style="background:#09050f;border:1px solid #e8b84b22;padding:20px 24px;margin-bottom:28px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.35em;color:#e8b84b;text-transform:uppercase">Documentation Progress</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.2em;color:#f0ecff">' + complete + ' / ' + DOCS.length + ' reviewed</div>' +
        '</div>' +
        '<div style="height:6px;background:#e8b84b12;border-radius:0;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#22c98a,#22c98a);transition:width .4s"></div>' +
        '</div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px">' +
          Object.entries(counts).filter(function(e){ return e[1] > 0; }).map(function(e){
            return '<span style="font-size:13px;color:' + (STATUS_COLORS[e[0]]||'#6660a0') + '">' + e[0] + ': <strong>' + e[1] + '</strong></span>';
          }).join('') +
        '</div>' +
      '</div>';

    wrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:16px;letter-spacing:.08em;color:#e8b84b">Documentation Center</div>' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#9b9ac0;margin-top:4px">Review, track, and complete all system documentation without accessing code or GitHub.</div>' +
        '</div>' +
      '</div>' +
      summary + grid;
  }

  // ── Viewer ────────────────────────────────────────────────────────────────

  window.docsOpenViewer = async function(docKey) {
    var doc   = DOCS.find(function(d){ return d.key === docKey; });
    var wrap  = document.getElementById('docs-wrap');
    if (!doc || !wrap) return;

    var state = getDocState(docKey);

    // Show loading panel
    wrap.innerHTML =
      '<div style="margin-bottom:20px;display:flex;align-items:center;gap:12px">' +
        '<button onclick="window.docsShowCards()" style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;' +
          'text-transform:uppercase;background:transparent;border:1px solid #e8b84b44;color:#e8b84b;' +
          'padding:7px 14px;cursor:pointer">← All Docs</button>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:13px;color:#9b9ac0;letter-spacing:.05em">' + esc(doc.title) + '</div>' +
      '</div>' +
      '<div id="docs-viewer-controls" style="background:#09050f;border:1px solid #e8b84b22;padding:18px 22px;margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:200px">' +
          '<label style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;color:#e8b84b;text-transform:uppercase;display:block;margin-bottom:6px">Status</label>' +
          '<select id="docs-status-sel" onchange="window.docsUpdateStatus(\'' + docKey + '\')" ' +
            'style="background:#0a0618;border:1px solid #e8b84b33;color:#f0ecff;padding:8px 12px;font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.15em;width:100%">' +
            STATUSES.map(function(s){ return '<option value="' + s + '"' + (s===state.status?' selected':'') + '>' + s + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div style="flex:2;min-width:240px">' +
          '<label style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;color:#e8b84b;text-transform:uppercase;display:block;margin-bottom:6px">Notes</label>' +
          '<input id="docs-notes-input" type="text" value="' + esc(state.notes) + '" ' +
            'placeholder="Add notes about this document..." ' +
            'oninput="window.docsUpdateNotes(\'' + docKey + '\')" ' +
            'style="background:#0a0618;border:1px solid #e8b84b33;color:#f0ecff;padding:8px 12px;font-family:\'EB Garamond\',serif;font-size:15px;width:100%">' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-shrink:0">' +
          '<button onclick="window.docsMarkReviewed(\'' + docKey + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.25em;text-transform:uppercase;' +
              'padding:8px 16px;background:#22c98a14;border:1px solid #22c98a44;color:#22c98a;cursor:pointer">Mark Reviewed</button>' +
          '<button onclick="window.docsMarkComplete(\'' + docKey + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.25em;text-transform:uppercase;' +
              'padding:8px 16px;background:#e8b84b14;border:1px solid #e8b84b44;color:#e8b84b;cursor:pointer">Mark Complete</button>' +
        '</div>' +
      '</div>' +
      '<div id="docs-viewer-content" style="font-family:\'EB Garamond\',serif;font-size:17px;line-height:1.8;color:#dddaee;background:#09050f;border:1px solid #e8b84b15;padding:36px 40px;max-width:900px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em;color:#e8b84b44;text-transform:uppercase">Loading document…</div>' +
      '</div>';

    // Fetch and render markdown
    try {
      var res  = await fetch(doc.file + '?_=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      document.getElementById('docs-viewer-content').innerHTML = renderMarkdown(text);
    } catch(e) {
      document.getElementById('docs-viewer-content').innerHTML =
        '<div style="color:#ee7070;padding:24px">Could not load document: ' + esc(e.message) + '</div>';
    }
  };

  window.docsShowCards = function() {
    var wrap = document.getElementById('docs-wrap');
    if (wrap) renderCards(wrap);
  };

  window.docsUpdateStatus = function(docKey) {
    var sel = document.getElementById('docs-status-sel');
    if (!sel) return;
    var state = getDocState(docKey);
    state.status = sel.value;
    saveDocState(docKey, state);
  };

  window.docsUpdateNotes = function(docKey) {
    var inp = document.getElementById('docs-notes-input');
    if (!inp) return;
    var state = getDocState(docKey);
    state.notes = inp.value;
    saveDocState(docKey, state);
  };

  window.docsMarkReviewed = function(docKey) {
    var state = getDocState(docKey);
    state.status     = 'Reviewed';
    state.reviewedAt = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    saveDocState(docKey, state);
    var sel = document.getElementById('docs-status-sel');
    if (sel) sel.value = 'Reviewed';
    _showDocToast('Marked as Reviewed ✓');
  };

  window.docsMarkComplete = function(docKey) {
    var state = getDocState(docKey);
    state.status     = 'Complete';
    state.reviewedAt = state.reviewedAt || new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    saveDocState(docKey, state);
    var sel = document.getElementById('docs-status-sel');
    if (sel) sel.value = 'Complete';
    _showDocToast('Marked as Complete ✓');
  };

  function _showDocToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:9999;background:#22c98a;color:#000;' +
      'font-family:Cinzel,serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;' +
      'padding:12px 22px;box-shadow:0 4px 20px rgba(34,201,138,.3);transition:opacity .4s';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 500); }, 2500);
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  window.docsInit = function() {
    var wrap = document.getElementById('docs-wrap');
    if (!wrap) return;
    renderCards(wrap);
  };

  // ── Styles injected once ──────────────────────────────────────────────────

  var styles = document.createElement('style');
  styles.textContent = [
    '.doc-h1{font-family:Cinzel,serif;font-size:24px;letter-spacing:.04em;color:#f8e090;margin:28px 0 14px;border-bottom:1px solid rgba(232,184,75,.2);padding-bottom:10px}',
    '.doc-h2{font-family:Cinzel,serif;font-size:18px;letter-spacing:.04em;color:#e8b84b;margin:24px 0 12px}',
    '.doc-h3{font-family:Cinzel,serif;font-size:14px;letter-spacing:.08em;color:#ddd8f0;margin:18px 0 8px;text-transform:uppercase}',
    '.doc-h4{font-family:Cinzel,serif;font-size:12px;letter-spacing:.1em;color:#9990c0;margin:14px 0 6px;text-transform:uppercase}',
    '.doc-p{margin:0 0 12px;line-height:1.8;color:#dddaee}',
    '.doc-list{margin:0 0 14px 22px;color:#dddaee}',
    '.doc-list li{margin-bottom:6px;line-height:1.7}',
    '.doc-pre{background:#0a0312;border:1px solid rgba(232,184,75,.15);padding:18px 20px;overflow-x:auto;margin:16px 0;border-radius:0}',
    '.doc-code{font-family:monospace;font-size:13px;color:#e8b84b;white-space:pre}',
    '.doc-inline-code{font-family:monospace;font-size:13px;color:#e8b84b;background:#e8b84b0a;padding:1px 6px;border:1px solid #e8b84b22}',
    '.doc-link{color:#22c98a;text-decoration:underline}',
    '.doc-hr{border:none;border-top:1px solid rgba(232,184,75,.15);margin:24px 0}',
    '.doc-bq{border-left:3px solid #e8b84b44;padding:8px 18px;margin:12px 0;color:#9990c0;font-style:italic}',
    '.doc-spacer{height:4px}',
    '.doc-table-wrap{overflow-x:auto;margin:16px 0}',
    '.doc-table{width:100%;border-collapse:collapse}',
    '.doc-table th{font-family:Cinzel,serif;font-size:10px;letter-spacing:.25em;color:#e8b84b;text-transform:uppercase;padding:10px 14px;text-align:left;border-bottom:1px solid rgba(232,184,75,.2);background:#0a0618}',
    '.doc-table td{padding:10px 14px;font-size:15px;color:#dddaee;border-bottom:1px solid rgba(232,184,75,.07)}',
    '.doc-table tr:hover td{background:#e8b84b04}',
  ].join('');
  document.head.appendChild(styles);

})();
