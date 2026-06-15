// docs-module.js
// Documentation & Handoff Center
// Protected dashboard module — readable from dashboard.html only.
// Fetches markdown from /docs/, renders it with full styling, tracks per-doc
// review/completion status in localStorage (rea_doc_review_status).

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // Document Registry — 4 operational handoff documents
  // ─────────────────────────────────────────────────────────────────────────
  var DOCS = [
    {
      key:  'executive-overview',
      file: '/docs/executive-system-overview.md',
      title: 'Executive System Overview',
      badge: 'For Daron',
      badgeColor: '#e8b84b',
      desc: 'High-level explanation of what this platform is, what every system does, and what has been built. Start here.',
      icon: '◇',
    },
    {
      key:  'practitioner-guide',
      file: '/docs/practitioner-user-guide.md',
      title: 'Practitioner User Guide',
      badge: 'Daily Operations',
      badgeColor: '#22c98a',
      desc: 'Step-by-step daily workflow — booking, payment, intake review, session completion, outcome tracking, aftercare, and follow-up.',
      icon: '✦',
    },
    {
      key:  'admin-guide',
      file: '/docs/administrator-technical-guide.md',
      title: 'Administrator Technical Guide',
      badge: 'Technical Reference',
      badgeColor: '#b09ef8',
      desc: 'How to maintain the platform: Netlify, Supabase, migrations, environment variables, deployment, and troubleshooting.',
      icon: '⚙',
    },
    {
      key:  'ai-architecture',
      file: '/docs/ai-architecture-blueprint.md',
      title: 'AI Architecture Blueprint',
      badge: 'AI & Automation',
      badgeColor: '#22c98a',
      desc: 'How the AI pattern engine works today, the agent roadmap, orchestrator model, and future automation layers.',
      icon: '◉',
    },
  ];

  var STATUSES = ['Not Started', 'In Review', 'Reviewed', 'Complete', 'Needs Update'];
  var STATUS_STYLE = {
    'Not Started':  { color: '#6660a0', bg: '#6660a010', border: '#6660a030' },
    'In Review':    { color: '#e8b84b', bg: '#e8b84b10', border: '#e8b84b40' },
    'Reviewed':     { color: '#22c98a', bg: '#22c98a10', border: '#22c98a40' },
    'Complete':     { color: '#22c98a', bg: '#22c98a18', border: '#22c98a55' },
    'Needs Update': { color: '#ee7070', bg: '#ee707010', border: '#ee707040' },
  };

  var LS_KEY = 'rea_doc_review_status';

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence helpers
  // ─────────────────────────────────────────────────────────────────────────

  function loadAllStates() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch (_) { return {}; }
  }

  function getState(key) {
    var all = loadAllStates();
    return all[key] || { status: 'Not Started', notes: '', reviewed_at: null, completed_at: null };
  }

  function saveState(key, patch) {
    var all = loadAllStates();
    all[key] = Object.assign(getState(key), patch);
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Markdown renderer
  // ─────────────────────────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineRender(s) {
    return escHtml(s)
      // Bold
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+?)`/g, '<code class="rmd-code">$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="rmd-link">$1</a>')
      // Strikethrough
      .replace(/~~([^~]+?)~~/g, '<del>$1</del>');
  }

  function renderMarkdown(raw) {
    var lines  = (raw || '').split('\n');
    var out    = [];
    var i      = 0;

    function peek(n) { return lines[i + (n || 0)] || ''; }
    function consume() { return lines[i++]; }

    function flushBuffer(buf, tag) {
      if (!buf.length) return;
      out.push('<' + tag + ' class="rmd-' + tag + '">' + buf.map(inlineRender).join('<br>') + '</' + tag + '>');
    }

    while (i < lines.length) {
      var line = consume();

      // Fenced code block
      var fenceMatch = line.match(/^```(\w*)/);
      if (fenceMatch) {
        var lang  = fenceMatch[1] || '';
        var codeLines = [];
        while (i < lines.length && !lines[i].match(/^```/)) {
          codeLines.push(consume());
        }
        if (i < lines.length) consume(); // consume closing ```
        out.push(
          '<pre class="rmd-pre"><code class="rmd-codeblock"' + (lang ? ' data-lang="' + escHtml(lang) + '"' : '') + '>' +
          escHtml(codeLines.join('\n')) +
          '</code></pre>'
        );
        continue;
      }

      // Horizontal rule
      if (line.match(/^(---+|===+|\*\*\*+)$/)) {
        out.push('<hr class="rmd-hr">');
        continue;
      }

      // Headings
      var hMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (hMatch) {
        var level = hMatch[1].length;
        var cls   = 'rmd-h' + level;
        out.push('<h' + level + ' class="' + cls + '">' + inlineRender(hMatch[2]) + '</h' + level + '>');
        continue;
      }

      // Blockquote
      if (line.match(/^>\s/)) {
        var bqLines = [line.replace(/^>\s?/, '')];
        while (i < lines.length && lines[i].match(/^>\s/)) {
          bqLines.push(consume().replace(/^>\s?/, ''));
        }
        out.push('<blockquote class="rmd-blockquote">' + bqLines.map(inlineRender).join('<br>') + '</blockquote>');
        continue;
      }

      // Table (header row must have pipes and next non-empty line must be separator)
      if (line.includes('|') && line.trim().startsWith('|')) {
        var tableLines = [line];
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(consume());
        }
        if (tableLines.length >= 2) {
          var sep = tableLines[1];
          if (sep.match(/^[\s|:\-]+$/)) {
            var headerCells = tableLines[0].split('|').map(function(c){ return c.trim(); }).filter(Boolean);
            var bodyRows    = tableLines.slice(2).map(function(row) {
              return row.split('|').map(function(c){ return c.trim(); }).filter(Boolean);
            });
            var tHtml = '<div class="rmd-table-wrap"><table class="rmd-table"><thead><tr>' +
              headerCells.map(function(h){ return '<th>' + inlineRender(h) + '</th>'; }).join('') +
              '</tr></thead><tbody>' +
              bodyRows.map(function(cells){
                return '<tr>' + cells.map(function(c){ return '<td>' + inlineRender(c) + '</td>'; }).join('') + '</tr>';
              }).join('') +
              '</tbody></table></div>';
            out.push(tHtml);
            continue;
          }
        }
        // Not a table — fall through with first line
        line = tableLines[0];
      }

      // Unordered list
      if (line.match(/^(\s*[-*+])\s+/)) {
        var ulItems = [line.replace(/^\s*[-*+]\s+/, '')];
        while (i < lines.length && lines[i].match(/^\s*[-*+]\s+/)) {
          ulItems.push(consume().replace(/^\s*[-*+]\s+/, ''));
        }
        out.push('<ul class="rmd-ul">' + ulItems.map(function(item){
          return '<li>' + inlineRender(item) + '</li>';
        }).join('') + '</ul>');
        continue;
      }

      // Ordered list
      if (line.match(/^\d+\.\s+/)) {
        var olItems = [line.replace(/^\d+\.\s+/, '')];
        while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
          olItems.push(consume().replace(/^\d+\.\s+/, ''));
        }
        out.push('<ol class="rmd-ol">' + olItems.map(function(item){
          return '<li>' + inlineRender(item) + '</li>';
        }).join('') + '</ol>');
        continue;
      }

      // Blank line
      if (!line.trim()) {
        out.push('<div class="rmd-spacer"></div>');
        continue;
      }

      // Paragraph
      out.push('<p class="rmd-p">' + inlineRender(line) + '</p>');
    }

    return out.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Styles — injected once into <head>
  // ─────────────────────────────────────────────────────────────────────────

  (function injectStyles() {
    if (document.getElementById('rmd-styles')) return;
    var el = document.createElement('style');
    el.id  = 'rmd-styles';
    el.textContent = [
      /* Viewer prose */
      '.rmd-h1{font-family:Cinzel,serif;font-size:28px;letter-spacing:.03em;color:#f8e090;margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid rgba(232,184,75,.2);line-height:1.3}',
      '.rmd-h2{font-family:Cinzel,serif;font-size:20px;letter-spacing:.03em;color:#e8b84b;margin:28px 0 12px;line-height:1.3}',
      '.rmd-h3{font-family:Cinzel,serif;font-size:15px;letter-spacing:.08em;color:#c8c4e0;text-transform:uppercase;margin:22px 0 10px}',
      '.rmd-h4{font-family:Cinzel,serif;font-size:12px;letter-spacing:.12em;color:#9990c0;text-transform:uppercase;margin:18px 0 8px}',
      '.rmd-p{font-size:18px;line-height:1.85;color:#dddaee;margin:0 0 14px}',
      '.rmd-ul,.rmd-ol{font-size:18px;line-height:1.85;color:#dddaee;margin:0 0 16px;padding-left:26px}',
      '.rmd-ul li,.rmd-ol li{margin-bottom:8px}',
      '.rmd-pre{background:#020010;border:1px solid rgba(232,184,75,.15);padding:20px 22px;overflow-x:auto;margin:16px 0}',
      '.rmd-codeblock{font-family:\'Courier New\',monospace;font-size:13.5px;color:#e8b84b;white-space:pre;display:block}',
      '.rmd-code{font-family:\'Courier New\',monospace;font-size:14px;color:#e8b84b;background:rgba(232,184,75,.07);padding:1px 6px;border:1px solid rgba(232,184,75,.2)}',
      '.rmd-link{color:#22c98a;text-decoration:underline;transition:color .2s}.rmd-link:hover{color:#34e89e}',
      '.rmd-hr{border:none;border-top:1px solid rgba(232,184,75,.15);margin:28px 0}',
      '.rmd-blockquote{border-left:3px solid rgba(232,184,75,.4);padding:10px 20px;margin:14px 0;color:#9990c0;font-style:italic;font-size:17px;background:rgba(232,184,75,.03)}',
      '.rmd-table-wrap{overflow-x:auto;margin:16px 0}',
      '.rmd-table{width:100%;border-collapse:collapse}',
      '.rmd-table th{font-family:Cinzel,serif;font-size:11px;letter-spacing:.25em;color:#e8b84b;text-transform:uppercase;padding:12px 16px;text-align:left;border-bottom:1px solid rgba(232,184,75,.2);background:rgba(10,6,24,.7);white-space:nowrap}',
      '.rmd-table td{padding:12px 16px;font-size:16px;color:#dddaee;border-bottom:1px solid rgba(232,184,75,.07);vertical-align:top}',
      '.rmd-table tr:hover td{background:rgba(232,184,75,.03)}',
      '.rmd-spacer{height:6px}',
      /* Card grid */
      '.doc-card{background:#09050f;border:1px solid;padding:26px 24px;cursor:pointer;transition:all .22s;position:relative;display:flex;flex-direction:column;gap:12px}',
      '.doc-card:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.4)}',
      '.doc-badge{font-family:Cinzel,serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;padding:3px 10px;display:inline-block}',
      '.doc-status-chip{font-family:Cinzel,serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding:3px 10px;border:1px solid}',
      /* Summary bar */
      '.doc-summary{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:28px}',
      '.doc-kpi{background:#09050f;border:1px solid rgba(232,184,75,.12);padding:16px 18px}',
      '.doc-kpi-label{font-family:Cinzel,serif;font-size:9px;letter-spacing:.35em;color:#6660a0;text-transform:uppercase;margin-bottom:6px}',
      '.doc-kpi-value{font-family:Cinzel,serif;font-size:28px;color:#f0ecff}',
      /* Controls */
      '.doc-ctrl-btn{font-family:Cinzel,serif;font-size:10px;letter-spacing:.25em;text-transform:uppercase;padding:9px 18px;border:1px solid;cursor:pointer;transition:all .2s;background:transparent}',
      '.doc-ctrl-btn:hover{opacity:.8}',
      '.doc-select{background:#0a0618;border:1px solid rgba(232,184,75,.3);color:#f0ecff;padding:9px 12px;font-family:Cinzel,serif;font-size:11px;letter-spacing:.1em}',
      '.doc-notes-input{background:#0a0618;border:1px solid rgba(232,184,75,.25);color:#f0ecff;padding:9px 12px;font-family:"EB Garamond",serif;font-size:16px;width:100%}',
      '.doc-notes-input::placeholder{color:rgba(246,241,255,.35)}',
      '.doc-notes-input:focus{outline:none;border-color:rgba(232,184,75,.6)}',
      /* Viewer */
      '.doc-viewer{background:#06030e;border:1px solid rgba(232,184,75,.12);padding:44px 48px;max-width:860px}',
      '@media(max-width:700px){.doc-viewer{padding:24px 20px}}',
      /* Nav back */
      '.doc-back-btn{font-family:Cinzel,serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;background:transparent;border:1px solid rgba(232,184,75,.3);color:#e8b84b;padding:7px 16px;cursor:pointer;transition:all .2s}',
      '.doc-back-btn:hover{background:rgba(232,184,75,.06)}',
      /* Toast */
      '.doc-toast{position:fixed;bottom:28px;right:28px;z-index:9999;font-family:Cinzel,serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;padding:12px 22px;transition:opacity .4s}',
    ].join('');
    document.head.appendChild(el);
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    } catch(_){ return iso; }
  }

  function statusChip(status) {
    var s = STATUS_STYLE[status] || STATUS_STYLE['Not Started'];
    return '<span class="doc-status-chip" style="color:' + s.color + ';background:' + s.bg + ';border-color:' + s.border + '">' + esc(status) + '</span>';
  }

  function toast(msg, color) {
    var t = document.createElement('div');
    t.className   = 'doc-toast';
    t.textContent = msg;
    t.style.background  = color || '#22c98a';
    t.style.color       = '#000';
    t.style.boxShadow   = '0 4px 20px rgba(0,0,0,.5)';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); }, 450); }, 2500);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Card grid view
  // ─────────────────────────────────────────────────────────────────────────

  function renderGrid(wrap) {
    var all      = loadAllStates();
    var reviewed = DOCS.filter(function(d){ var s = (all[d.key]||{}).status; return s==='Reviewed'||s==='Complete'; }).length;
    var complete = DOCS.filter(function(d){ return (all[d.key]||{}).status==='Complete'; }).length;
    var needsUpd = DOCS.filter(function(d){ return (all[d.key]||{}).status==='Needs Update'; }).length;
    var inReview = DOCS.filter(function(d){ return (all[d.key]||{}).status==='In Review'; }).length;

    var summary =
      '<div class="doc-summary">' +
        kpi('Total Documents', DOCS.length, '#f0ecff') +
        kpi('Reviewed',        reviewed,    '#22c98a') +
        kpi('Complete',        complete,    '#22c98a') +
        kpi('In Review',       inReview,    '#e8b84b') +
        (needsUpd ? kpi('Needs Update', needsUpd, '#ee7070') : '') +
      '</div>';

    var cards =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">' +
      DOCS.map(function(doc) {
        var state = getState(doc.key);
        var bdr   = STATUS_STYLE[state.status] || STATUS_STYLE['Not Started'];
        return [
          '<div class="doc-card" style="border-color:' + bdr.border + ';border-left-width:3px;border-left-color:' + (STATUS_STYLE[state.status]||{}).color + '" onclick="window.docsOpen(\'' + doc.key + '\')">',
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">',
              '<span style="font-size:20px;color:' + doc.badgeColor + ';line-height:1">' + doc.icon + '</span>',
              statusChip(state.status),
            '</div>',
            '<div>',
              '<div style="font-family:Cinzel,serif;font-size:15px;letter-spacing:.05em;color:#f0ecff;margin-bottom:6px">' + esc(doc.title) + '</div>',
              '<span class="doc-badge" style="color:' + doc.badgeColor + ';background:' + doc.badgeColor + '15;margin-bottom:8px">' + esc(doc.badge) + '</span>',
              '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#9990c0;line-height:1.6;margin-top:6px">' + esc(doc.desc) + '</div>',
            '</div>',
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px">',
              '<div style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.15em;color:#6660a0;text-transform:uppercase">' +
                (state.reviewed_at ? 'Reviewed ' + fmtDate(state.reviewed_at) : state.notes ? 'Note: ' + esc(state.notes.slice(0,40)) : 'Not yet reviewed') +
              '</div>',
              '<div style="font-family:Cinzel,serif;font-size:10px;letter-spacing:.25em;color:#e8b84b;text-transform:uppercase">Open →</div>',
            '</div>',
          '</div>',
        ].join('');
      }).join('') +
      '</div>';

    var header =
      '<div style="margin-bottom:24px">' +
        '<div style="font-family:Cinzel,serif;font-size:18px;letter-spacing:.06em;color:#e8b84b;margin-bottom:6px">📘 Handoff Center</div>' +
        '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#9990c0">Review, track, and mark complete the platform documentation. No code access needed.</div>' +
      '</div>';

    wrap.innerHTML = header + summary + cards;
  }

  function kpi(label, value, color) {
    return '<div class="doc-kpi"><div class="doc-kpi-label">' + esc(label) + '</div><div class="doc-kpi-value" style="color:' + color + '">' + value + '</div></div>';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document viewer
  // ─────────────────────────────────────────────────────────────────────────

  window.docsOpen = async function(docKey) {
    var doc  = DOCS.find(function(d){ return d.key === docKey; });
    var wrap = document.getElementById('docs-wrap');
    if (!doc || !wrap) return;

    var state = getState(docKey);

    // Show skeleton immediately
    wrap.innerHTML =
      _viewerShell(doc, state) +
      '<div class="doc-viewer" id="doc-viewer-body">' +
        '<div style="font-family:Cinzel,serif;font-size:12px;letter-spacing:.3em;color:#e8b84b44;text-transform:uppercase;text-align:center;padding:48px 0">Loading document…</div>' +
      '</div>';

    // Fetch markdown
    try {
      var res  = await fetch(doc.file + '?v=' + Date.now(), { headers: { Accept: 'text/plain,text/markdown,*/*' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — document not accessible');
      var text = await res.text();
      // Guard: if we got HTML instead of markdown (e.g. SPA redirect)
      if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().startsWith('<html')) {
        throw new Error('Received HTML instead of Markdown — check /docs/ path');
      }
      document.getElementById('doc-viewer-body').innerHTML = renderMarkdown(text);
    } catch(e) {
      document.getElementById('doc-viewer-body').innerHTML =
        '<div style="border:1px solid rgba(238,68,68,.3);background:rgba(238,68,68,.06);padding:24px 28px;color:#ee7070">' +
          '<div style="font-family:Cinzel,serif;font-size:12px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:10px">Document Load Error</div>' +
          '<div style="font-size:17px;line-height:1.7">' + esc(e.message) + '</div>' +
          '<div style="font-size:15px;color:#9990c0;margin-top:12px">Expected path: <code style="color:#e8b84b">' + esc(doc.file) + '</code></div>' +
        '</div>';
    }
  };

  function _viewerShell(doc, state) {
    return [
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">',
        '<button class="doc-back-btn" onclick="window.docsShowGrid()">← All Documents</button>',
        '<div style="font-family:Cinzel,serif;font-size:11px;letter-spacing:.2em;color:#9990c0;text-transform:uppercase">' + esc(doc.title) + '</div>',
      '</div>',

      // Controls bar
      '<div style="background:#09050f;border:1px solid rgba(232,184,75,.18);padding:20px 22px;margin-bottom:20px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">',

        // Status
        '<div style="flex:0 0 auto">',
          '<div style="font-family:Cinzel,serif;font-size:9px;letter-spacing:.35em;color:#e8b84b;text-transform:uppercase;margin-bottom:7px">Status</div>',
          '<select id="doc-status-sel" class="doc-select" onchange="window.docsSetStatus(\'' + doc.key + '\')" style="min-width:160px">',
            STATUSES.map(function(s){ return '<option value="' + s + '"' + (s===state.status?' selected':'') + '>' + s + '</option>'; }).join(''),
          '</select>',
        '</div>',

        // Notes
        '<div style="flex:1;min-width:220px">',
          '<div style="font-family:Cinzel,serif;font-size:9px;letter-spacing:.35em;color:#e8b84b;text-transform:uppercase;margin-bottom:7px">Notes</div>',
          '<input class="doc-notes-input" id="doc-notes-inp" type="text" value="' + esc(state.notes) + '" placeholder="Add a note about this document…" oninput="window.docsSetNotes(\'' + doc.key + '\')">',
        '</div>',

        // Action buttons
        '<div style="display:flex;gap:8px;flex-shrink:0;align-self:flex-end">',
          '<button class="doc-ctrl-btn" style="color:#22c98a;border-color:rgba(34,201,138,.4)" onclick="window.docsMarkReviewed(\'' + doc.key + '\')">✓ Reviewed</button>',
          '<button class="doc-ctrl-btn" style="color:#e8b84b;border-color:rgba(232,184,75,.4)" onclick="window.docsMarkComplete(\'' + doc.key + '\')">✦ Complete</button>',
        '</div>',

      '</div>',
    ].join('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status actions
  // ─────────────────────────────────────────────────────────────────────────

  window.docsShowGrid = function() {
    var wrap = document.getElementById('docs-wrap');
    if (wrap) renderGrid(wrap);
  };

  window.docsSetStatus = function(key) {
    var sel = document.getElementById('doc-status-sel');
    if (sel) saveState(key, { status: sel.value });
  };

  window.docsSetNotes = function(key) {
    var inp = document.getElementById('doc-notes-inp');
    if (inp) saveState(key, { notes: inp.value });
  };

  window.docsMarkReviewed = function(key) {
    var now = new Date().toISOString();
    saveState(key, { status: 'Reviewed', reviewed_at: now });
    var sel = document.getElementById('doc-status-sel');
    if (sel) sel.value = 'Reviewed';
    toast('Marked as Reviewed ✓', '#22c98a');
  };

  window.docsMarkComplete = function(key) {
    var now = new Date().toISOString();
    var cur = getState(key);
    saveState(key, { status: 'Complete', completed_at: now, reviewed_at: cur.reviewed_at || now });
    var sel = document.getElementById('doc-status-sel');
    if (sel) sel.value = 'Complete';
    toast('Marked as Complete ✦', '#e8b84b');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Entry point — called by showTab('docs') in dashboard.html
  // ─────────────────────────────────────────────────────────────────────────

  window.docsInit = function() {
    var wrap = document.getElementById('docs-wrap');
    if (!wrap) return;
    // Only render grid if not already showing a doc viewer (allow back-button nav)
    if (!document.getElementById('doc-viewer-body')) renderGrid(wrap);
  };

})();
