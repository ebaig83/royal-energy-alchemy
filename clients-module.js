// clients-module.js
// Live /clients API tab — overrides localStorage-based renderClients().
// Loaded after dashboard.html inline scripts so these definitions win.

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var _clients     = [];
  var _loaded      = false;
  var _searchTimer = null;
  var _tlClientId  = null;   // client currently open in timeline modal

  // ── API helper ───────────────────────────────────────────────────────────
  function token() { return sessionStorage.getItem('rea_sb_token') || ''; }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch('/.netlify/functions' + path, Object.assign({}, opts, {
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        opts.headers || {}
      ),
    }));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────
  var STATUS_LABELS = {
    active:                ['Active',         '#22c98a'],
    cancelled_appointment: ['Cancelled',       '#f07070'],
    rescheduled:           ['Rescheduled',     '#b09ef8'],
    no_show:               ['No-Show',         '#f8a84b'],
    payment_issue:         ['Payment Issue',   '#f8e060'],
    blocked:               ['Blocked',         '#ff5555'],
    archived:              ['Archived',        '#aaaaaa'],
  };

  function statusBadge(status) {
    var pair  = STATUS_LABELS[status] || ['Active', '#22c98a'];
    var label = pair[0], color = pair[1];
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'color:' + color + ';background:' + color + '28;border:1px solid ' + color + '77;' +
      'padding:2px 10px;border-radius:2px;text-transform:uppercase;white-space:nowrap">' + label + '</span>';
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  function tagChip(t) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.15em;' +
      'text-transform:uppercase;background:#e8b84b1c;border:1px solid #e8b84b55;' +
      'color:#e8b84bdd;padding:2px 8px;border-radius:2px">' + t + '</span>';
  }

  function profileRow(label, val, rawHtml) {
    var display = rawHtml ? (val || '—') : (val || '—');
    return '<div>' +
      '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
        'text-transform:uppercase;color:#e8b84baa;margin-bottom:4px">' + label + '</div>' +
      '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#f0ecff">' + display + '</div>' +
    '</div>';
  }

  function statBox(label, val) {
    return '<div class="stat"><span class="stat-val">' + val +
      '</span><span class="stat-label">' + label + '</span></div>';
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER CLIENTS
  // ═══════════════════════════════════════════════════════════════════════════
  window.renderClients = async function () {
    var roster  = document.getElementById('clientRoster');
    var countEl = document.getElementById('clientCount');
    if (!roster) return;

    var search = ((document.getElementById('clientSearch') || {}).value || '').trim();
    var filter = ((document.getElementById('clientFilter') || {}).value || 'all');

    if (!_loaded) {
      roster.innerHTML = '<div style="padding:36px;text-align:center;color:#e8b84b99;' +
        'font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">LOADING CLIENTS…</div>';
    }

    if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null; }

    async function doLoad() {
      try {
        var path = search ? '/clients?search=' + encodeURIComponent(search) : '/clients';
        var data = await api(path);
        _clients = data.clients || [];
        _loaded  = true;
      } catch (e) {
        roster.innerHTML = '<div style="padding:24px;color:#ff7070;font-family:\'EB Garamond\',serif;' +
          'font-size:16px">Failed to load clients: ' + e.message + '</div>';
        if (countEl) countEl.textContent = '';
        return;
      }

      var list = _clients.slice();
      var STATUS_FILTERS = ['active','cancelled_appointment','rescheduled','no_show',
                            'payment_issue','blocked','archived'];
      if (filter === 'distance') list = list.filter(function(c) { return (c.tags||[]).includes('distance'); });
      if (filter === 'inperson') list = list.filter(function(c) {
        return (c.tags||[]).includes('in-person') || (c.tags||[]).includes('inPerson');
      });
      if (STATUS_FILTERS.includes(filter)) list = list.filter(function(c) { return c.status === filter; });

      if (countEl) countEl.textContent = list.length + ' client' + (list.length !== 1 ? 's' : '');

      if (!list.length) {
        roster.innerHTML = '<p style="color:#dddaeecc;font-style:italic;padding:24px 0">No clients match.</p>';
        return;
      }
      roster.innerHTML = list.map(buildCard).join('');
    }

    if (search) { _searchTimer = setTimeout(doLoad, 280); }
    else        { await doLoad(); }
  };

  // ── Client card ─────────────────────────────────────────────────────────
  function buildCard(c) {
    var id       = c.id;
    var name     = c.full_name || '(unnamed)';
    var status   = c.status || 'active';
    var tags     = (c.tags || []).filter(Boolean);
    var archived = status === 'archived';

    var statusRow = Object.keys(STATUS_LABELS).map(function(s) {
      var pair   = STATUS_LABELS[s];
      var lbl    = pair[0], col = pair[1];
      var isCur  = status === s;
      return '<button onclick="crmSetStatus(\'' + esc(id) + '\',\'' + s + '\')" ' +
        'style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;' +
        'padding:4px 10px;border:1px solid ' + col + (isCur ? '99' : '44') + ';' +
        'color:' + col + (isCur ? '' : 'aa') + ';background:' + col + (isCur ? '22' : '0d') + ';' +
        'cursor:pointer;font-weight:' + (isCur ? '700' : '400') + '">' + lbl + '</button>';
    }).join('');

    return '<div class="client-card" style="' +
        'background:#0e0b1f;border:1px solid #e8b84b55;padding:22px;margin-bottom:16px;' +
        (archived ? 'opacity:.55;' : '') + '">' +

      '<div class="card-head">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.08em;color:#f0ecff;' +
            'display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-weight:600">' +
            name + ' ' + statusBadge(status) +
          '</div>' +
          (c.email || c.phone
            ? '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#dddaeeaa;margin-top:5px">' +
                [c.email, c.phone].filter(Boolean).join(' · ') +
              '</div>'
            : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;color:#e8b84b88;' +
            'text-transform:uppercase;margin-top:5px">' +
            'Added ' + fmtDate(c.created_at) +
            (c.source && c.source !== 'manual' ? ' · ' + c.source : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;flex-shrink:0;margin-left:12px">' +
          '<button class="action-btn view" onclick="crmOpenProfile(\'' + esc(id) + '\')">👤 Profile</button>' +
          '<button class="action-btn view" style="border-color:#9b7fe866;color:#b09ef8" ' +
            'onclick="crmOpenTimeline(\'' + esc(id) + '\')">⏱ Timeline</button>' +
          '<button class="action-btn view" style="border-color:#e8b84b66;color:#e8b84b" ' +
            'onclick="crmOpenEdit(\'' + esc(id) + '\')">✎ Edit</button>' +
          '<button class="action-btn reject" style="border-color:#ff555566;color:#ff8888" ' +
            'onclick="crmConfirmArchive(\'' + esc(id) + '\',\'' + esc(name) + '\')">⊘ Archive</button>' +
        '</div>' +
      '</div>' +

      (tags.length
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' + tags.map(tagChip).join('') + '</div>'
        : '') +

      '<div style="display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap;' +
        'padding-top:12px;border-top:1px solid #e8b84b1a">' +
        '<span style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.3em;' +
          'color:#e8b84b88;text-transform:uppercase">Status:</span>' +
        statusRow +
      '</div>' +
    '</div>';
  }

  // ── Set status ───────────────────────────────────────────────────────────
  window.crmSetStatus = async function (id, status) {
    try {
      await api('/clients?id=' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) });
      _loaded = false;
      await window.renderClients();
    } catch (e) { alert('Could not update status: ' + e.message); }
  };

  // ── Archive ──────────────────────────────────────────────────────────────
  window.crmConfirmArchive = function (id, name) {
    if (!confirm('Archive ' + name + '?\n\nThey will be hidden from active views but never deleted.')) return;
    api('/clients?id=' + id, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })
      .then(function() { _loaded = false; return window.renderClients(); })
      .catch(function(e) { alert('Archive failed: ' + e.message); });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE / EDIT MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenCreate = function () {
    document.getElementById('crmModalTitle').textContent    = 'New Client';
    document.getElementById('crmModalSubtitle').textContent = 'Add a new client to the database';
    document.getElementById('crmClientId').value   = '';
    document.getElementById('crmFullName').value   = '';
    document.getElementById('crmEmail').value      = '';
    document.getElementById('crmPhone').value      = '';
    document.getElementById('crmSource').value     = 'manual';
    document.getElementById('crmNotes').value      = '';
    document.getElementById('crmTags').value       = '';
    document.getElementById('crmModalError').textContent = '';
    document.getElementById('crmClientModal').classList.add('open');
    document.getElementById('crmFullName').focus();
  };

  window.crmOpenEdit = async function (id) {
    document.getElementById('crmModalTitle').textContent    = 'Edit Client';
    document.getElementById('crmModalSubtitle').textContent = 'Update client details';
    document.getElementById('crmModalError').textContent    = '';
    document.getElementById('crmClientId').value = id;

    var cached = _clients.find(function(c) { return c.id === id; });
    if (cached) {
      document.getElementById('crmFullName').value = cached.full_name || '';
      document.getElementById('crmEmail').value    = cached.email     || '';
      document.getElementById('crmPhone').value    = cached.phone     || '';
      document.getElementById('crmSource').value   = cached.source    || 'manual';
      document.getElementById('crmNotes').value    = cached.notes     || '';
      document.getElementById('crmTags').value     = (cached.tags || []).join(', ');
    }
    document.getElementById('crmClientModal').classList.add('open');

    try {
      var data = await api('/clients?id=' + id);
      var cl   = data.client;
      document.getElementById('crmFullName').value = cl.full_name || '';
      document.getElementById('crmEmail').value    = cl.email     || '';
      document.getElementById('crmPhone').value    = cl.phone     || '';
      document.getElementById('crmSource').value   = cl.source    || 'manual';
      document.getElementById('crmNotes').value    = cl.notes     || '';
      document.getElementById('crmTags').value     = (cl.tags || []).join(', ');
    } catch (e) { /* use cached */ }
  };

  window.crmSaveClient = async function () {
    var id      = document.getElementById('crmClientId').value.trim();
    var name    = document.getElementById('crmFullName').value.trim();
    var errEl   = document.getElementById('crmModalError');
    var saveBtn = document.getElementById('crmSaveBtn');

    if (!name) { errEl.textContent = 'Full name is required.'; return; }

    var tags = document.getElementById('crmTags').value
      .split(',').map(function(t) { return t.trim(); }).filter(Boolean);

    var payload = {
      full_name: name,
      email:     document.getElementById('crmEmail').value.trim()  || null,
      phone:     document.getElementById('crmPhone').value.trim()  || null,
      source:    document.getElementById('crmSource').value        || 'manual',
      notes:     document.getElementById('crmNotes').value.trim()  || null,
      tags:      tags,
    };

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    errEl.textContent   = '';

    try {
      if (id) {
        await api('/clients?id=' + id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/clients', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('crmClientModal').classList.remove('open');
      _loaded = false;
      await window.renderClients();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save';
    }
  };

  window.crmCloseClientModal = function (e) {
    if (e && e.target !== document.getElementById('crmClientModal')) return;
    document.getElementById('crmClientModal').classList.remove('open');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenProfile = async function (id) {
    var modal = document.getElementById('crmProfileModal');
    var body  = document.getElementById('crmProfileBody');
    body.innerHTML = loadingHtml();
    modal.classList.add('open');

    try {
      var data = await api('/clients?id=' + id);
      var cl   = data.client;
      var sess = data.sessions  || [];
      var ac   = data.aftercare || [];

      var totalPaid = sess.reduce(function(sum, s) { return sum + (parseFloat(s.price) || 0); }, 0);
      var completed = sess.filter(function(s) { return s.status === 'completed'; }).length;
      var pendingAC = ac.filter(function(a)  { return a.status === 'scheduled'; }).length;

      var sessRows = sess.length
        ? sess.map(function(s) {
            return '<tr>' +
              '<td style="padding:6px 8px 6px 0;color:#dddaee;border-bottom:1px solid #e8b84b0e">' + fmtDate(s.session_date) + '</td>' +
              '<td style="padding:6px 8px;color:#e8b84b;border-bottom:1px solid #e8b84b0e">'        + (s.service_type || '—') + '</td>' +
              '<td style="padding:6px 8px;color:#22c98a;border-bottom:1px solid #e8b84b0e">'        + (s.status || '—') + '</td>' +
              '<td style="padding:6px 0 6px 8px;color:#f0ecff;border-bottom:1px solid #e8b84b0e">$' + parseFloat(s.price || 0).toFixed(2) + '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="4" style="color:#dddaee66;font-style:italic;padding:14px 0">No sessions yet.</td></tr>';

      body.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">' +
          profileRow('Full Name', cl.full_name) +
          profileRow('Email',     cl.email) +
          profileRow('Phone',     cl.phone) +
          profileRow('Source',    cl.source) +
          profileRow('Status',    statusBadge(cl.status || 'active'), true) +
          profileRow('Added',     fmtDate(cl.created_at)) +
        '</div>' +

        (cl.notes
          ? '<div style="background:#e8b84b0c;border-left:2px solid #e8b84b55;padding:12px 16px;' +
              'margin-bottom:20px;font-family:\'EB Garamond\',serif;font-size:15px;color:#e8e6f8;line-height:1.7">' +
              cl.notes + '</div>'
          : '') +

        ((cl.tags||[]).length
          ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">' +
              (cl.tags||[]).map(tagChip).join('') + '</div>'
          : '') +

        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e8b84b22;margin-bottom:24px">' +
          statBox('Sessions',        sess.length) +
          statBox('Completed',       completed) +
          statBox('Total Paid',      '$' + totalPaid.toFixed(2)) +
          statBox('Pending Follow-ups', pendingAC) +
        '</div>' +

        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;' +
          'color:#e8b84baa;margin-bottom:10px">Sessions</div>' +
        '<table style="width:100%;border-collapse:collapse;font-family:\'EB Garamond\',serif;font-size:14px">' +
          '<thead><tr>' +
            thCell('Date') + thCell('Service') + thCell('Status') + thCell('Price') +
          '</tr></thead>' +
          '<tbody>' + sessRows + '</tbody>' +
        '</table>' +

        '<div style="margin-top:22px;border-top:1px solid #e8b84b22;padding-top:16px;display:flex;gap:10px">' +
          '<button class="action-btn view" style="border-color:#e8b84b66;color:#e8b84b" ' +
            'onclick="crmCloseProfileModal();crmOpenEdit(\'' + esc(id) + '\')">✎ Edit Client</button>' +
          '<button class="action-btn view" style="border-color:#9b7fe866;color:#b09ef8" ' +
            'onclick="crmCloseProfileModal();crmOpenTimeline(\'' + esc(id) + '\')">⏱ Full Timeline</button>' +
        '</div>';
    } catch (e) {
      body.innerHTML = errorHtml('Failed to load profile: ' + e.message);
    }
  };

  function thCell(t) {
    return '<th style="text-align:left;color:#e8b84baa;font-family:\'Cinzel\',serif;' +
      'font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:8px;' +
      'padding-right:8px">' + t + '</th>';
  }

  window.crmCloseProfileModal = function (e) {
    if (e && e.target !== document.getElementById('crmProfileModal')) return;
    document.getElementById('crmProfileModal').classList.remove('open');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMELINE MODAL  +  ADD EVENT
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenTimeline = async function (id) {
    _tlClientId = id;
    var modal = document.getElementById('crmTimelineModal');
    var body  = document.getElementById('crmTimelineBody');
    body.innerHTML = loadingHtml('BUILDING TIMELINE…');
    modal.classList.add('open');
    await loadTimeline(id);
  };

  async function loadTimeline(id) {
    var body = document.getElementById('crmTimelineBody');
    if (!body) return;

    try {
      var data   = await api('/timeline?client_id=' + id);
      var cl     = data.client;
      var stats  = data.stats   || {};
      var events = data.timeline || [];

      document.getElementById('crmTimelineTitle').textContent = cl.full_name + ' — Timeline';

      var TYPE_CFG = {
        session:   { icon: '✦',  label: 'Session',    color: '#9b7fe8' },
        note:      { icon: '📝', label: 'Note',       color: '#e8b84b' },
        payment:   { icon: '💳', label: 'Payment',    color: '#22c98a' },
        aftercare: { icon: '💌', label: 'Follow-up',  color: '#66b5f8' },
        intake:    { icon: '📋', label: 'Intake',     color: '#f8a84b' },
      };

      var eventsHtml = events.length
        ? events.map(function(ev) {
            var cfg    = TYPE_CFG[ev.type] || { icon: '·', label: ev.type, color: '#aaa' };
            var d      = ev.data || {};
            var detail = '';
            if (ev.type === 'session') {
              detail = [d.service_type, d.status, d.price ? '$' + parseFloat(d.price).toFixed(2) : ''].filter(Boolean).join(' · ');
            } else if (ev.type === 'note') {
              var txt = d.content || d.raw_notes || '';
              detail = txt.slice(0, 200) + (txt.length > 200 ? '…' : '');
            } else if (ev.type === 'payment') {
              detail = '$' + parseFloat(d.amount || 0).toFixed(2) +
                (d.method ? ' via ' + d.method : '') + (d.notes ? ' — ' + d.notes : '');
            } else if (ev.type === 'aftercare') {
              detail = (d.message_type || '') + (d.status ? ' · ' + d.status : '');
            } else if (ev.type === 'intake') {
              detail = 'Form submitted' + (d.service_interest ? ' · ' + d.service_interest : '');
            }
            return '<div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #e8b84b14">' +
              '<div style="width:38px;height:38px;border-radius:50%;background:' + cfg.color + '22;' +
                'border:1px solid ' + cfg.color + '55;display:flex;align-items:center;justify-content:center;' +
                'font-size:15px;flex-shrink:0;margin-top:2px">' + cfg.icon + '</div>' +
              '<div style="flex:1;min-width:0">' +
                '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
                  '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
                    'text-transform:uppercase;color:' + cfg.color + ';font-weight:600">' + cfg.label + '</span>' +
                  '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee99">' + fmtDate(ev.date) + '</span>' +
                '</div>' +
                (detail
                  ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#e8e6f8;' +
                      'margin-top:3px;line-height:1.55">' + detail + '</div>'
                  : '') +
              '</div>' +
            '</div>';
          }).join('')
        : '<p style="color:#dddaee77;font-style:italic;padding:20px 0">No timeline events yet.</p>';

      body.innerHTML =
        // Stats bar
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;' +
          'background:#e8b84b22;margin-bottom:22px">' +
          statBox('Sessions',          stats.totalSessions     || 0) +
          statBox('Completed',         stats.completedSessions || 0) +
          statBox('Total Paid',        '$' + (stats.totalPaid  || 0).toFixed(2)) +
          statBox('Pending Follow-ups', stats.pendingFollowUps || 0) +
        '</div>' +

        // Add event button + collapsible form
        '<div style="margin-bottom:20px">' +
          '<button onclick="crmToggleAddEvent()" id="crmAddEvtToggle" ' +
            'style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;' +
            'background:#e8b84b14;border:1px solid #e8b84b55;color:#e8b84b;padding:7px 18px;cursor:pointer;' +
            'transition:background .2s">+ Add Timeline Event</button>' +

          '<div id="crmAddEvtForm" style="display:none;margin-top:14px;background:#0e0b1f;' +
            'border:1px solid #e8b84b44;padding:20px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
              '<div>' +
                formLabel('Event Type') +
                '<select id="crmEvtType" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                  '<option value="note">Note</option>' +
                  '<option value="follow_up">Follow-up</option>' +
                  '<option value="intake">Intake</option>' +
                  '<option value="manual_event">Manual Event</option>' +
                '</select>' +
              '</div>' +
              '<div>' +
                formLabel('Date') +
                '<input id="crmEvtDate" type="date" class="appt-input" value="' + todayISO() + '" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;' +
                  'color-scheme:dark">' +
              '</div>' +
              '<div style="grid-column:span 2">' +
                formLabel('Title / Notes') +
                '<textarea id="crmEvtContent" class="modal-notes" ' +
                  'placeholder="Describe what happened…" ' +
                  'style="min-height:72px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
              '</div>' +
            '</div>' +
            '<div id="crmEvtError" style="color:#ff7070;font-family:\'EB Garamond\',serif;' +
              'font-size:14px;min-height:18px;margin-bottom:8px"></div>' +
            '<div style="display:flex;gap:10px">' +
              '<button id="crmEvtSaveBtn" class="action-btn approve" ' +
                'onclick="crmSaveTimelineEvent()" style="padding:8px 24px">Save Event</button>' +
              '<button class="action-btn" onclick="crmToggleAddEvent()">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Events list
        '<div>' + eventsHtml + '</div>';

    } catch (e) {
      body.innerHTML = errorHtml('Failed to load timeline: ' + e.message);
    }
  }

  // Toggle the add-event form open/closed
  window.crmToggleAddEvent = function () {
    var form = document.getElementById('crmAddEvtForm');
    var btn  = document.getElementById('crmAddEvtToggle');
    if (!form) return;
    var open = form.style.display !== 'none';
    form.style.display = open ? 'none' : 'block';
    if (btn) btn.textContent = open ? '+ Add Timeline Event' : '✕ Cancel';
    if (!open) {
      // Reset form
      var contentEl = document.getElementById('crmEvtContent');
      var errEl     = document.getElementById('crmEvtError');
      if (contentEl) contentEl.value = '';
      if (errEl)     errEl.textContent = '';
      var dateEl = document.getElementById('crmEvtDate');
      if (dateEl) dateEl.value = todayISO();
      setTimeout(function() { if (contentEl) contentEl.focus(); }, 50);
    }
  };

  // POST the new event to /session-notes
  window.crmSaveTimelineEvent = async function () {
    var id      = _tlClientId;
    var typeEl  = document.getElementById('crmEvtType');
    var dateEl  = document.getElementById('crmEvtDate');
    var txtEl   = document.getElementById('crmEvtContent');
    var errEl   = document.getElementById('crmEvtError');
    var saveBtn = document.getElementById('crmEvtSaveBtn');

    if (!id) { errEl.textContent = 'No client selected.'; return; }

    var noteType = typeEl ? typeEl.value : 'note';
    var date     = dateEl ? dateEl.value : todayISO();
    var rawText  = txtEl ? txtEl.value.trim() : '';

    if (!rawText) { errEl.textContent = 'Notes are required.'; return; }

    // Prefix content with the selected date so it shows context in the timeline
    var content = '[' + date + '] ' + rawText;

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    errEl.textContent   = '';

    try {
      await api('/session-notes', {
        method: 'POST',
        body:   JSON.stringify({ client_id: id, note_type: noteType, content: content }),
      });
      // Reload the timeline
      await loadTimeline(id);
    } catch (e) {
      errEl.textContent = e.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save Event';
    }
  };

  window.crmCloseTimelineModal = function (e) {
    if (e && e.target !== document.getElementById('crmTimelineModal')) return;
    document.getElementById('crmTimelineModal').classList.remove('open');
    _tlClientId = null;
  };

  // ── UI micro-helpers ─────────────────────────────────────────────────────
  function loadingHtml(msg) {
    return '<div style="padding:36px;text-align:center;color:#e8b84b99;' +
      'font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">' +
      (msg || 'LOADING…') + '</div>';
  }

  function errorHtml(msg) {
    return '<div style="color:#ff7070;font-family:\'EB Garamond\',serif;' +
      'font-size:15px;padding:20px;line-height:1.6">' + msg + '</div>';
  }

  function formLabel(txt) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'text-transform:uppercase;color:#e8b84baa;margin-bottom:5px">' + txt + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  // Clear stale localStorage-rendered cards from initDashboard()
  (function () {
    var roster  = document.getElementById('clientRoster');
    var countEl = document.getElementById('clientCount');
    if (roster)  roster.innerHTML   = '';
    if (countEl) countEl.textContent = '';
  })();

  // Patch showTab to auto-load when Clients tab opens
  var _origShowTab = window.showTab;
  window.showTab = function (name) {
    if (_origShowTab) _origShowTab(name);
    if (name === 'clients') window.renderClients();
  };

  // Initial load if clients tab is already visible on page load
  document.addEventListener('DOMContentLoaded', function () {
    var active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-clients') window.renderClients();
  });

})();
