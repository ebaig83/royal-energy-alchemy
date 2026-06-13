// clients-module.js
// Full case file, recommendations, referrals, and action plans for each client.

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var _clients      = [];
  var _loaded       = false;
  var _searchTimer  = null;
  var _tlClientId        = null;
  var _profileId         = null;
  var _recEditId         = null;
  var _refEditId         = null;
  var _apEditId          = null;
  var _prepBriefClientId = null;
  var _prepBriefPayload  = null;
  var _prepBriefCache    = {};  // { clientId: { html, ts } }
  var PREP_BRIEF_TTL     = 30 * 60 * 1000;

  // ── API helper ───────────────────────────────────────────────────────────
  function token() { return sessionStorage.getItem('rea_api_token') || ''; }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch('/.netlify/functions' + path, Object.assign({}, opts, {
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'X-Dashboard-Token': token() },
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

  var PRIORITY_CFG  = { high: ['High','#ff5555'], medium: ['Medium','#f8a84b'], low: ['Low','#66b5f8'] };
  var PURCHASED_CFG = { yes: ['Purchased','#22c98a'], no: ['Not Purchased','#f07070'], unknown: ['Status Unknown','#888888'] };
  var CAT_LABELS    = { supplement:'Supplement', crystal:'Crystal', essential_oil:'Essential Oil',
    book:'Book', course:'Course', device:'Device', service:'Service', other:'Other' };
  var URGENCY_CFG   = { urgent: ['Urgent','#ff5555'], soon: ['Soon','#f8a84b'], routine: ['Routine','#66b5f8'] };
  var FOLLOWED_CFG  = { yes: ['Followed Up','#22c98a'], no: ['Not Followed Up','#f07070'], unknown: ['Pending','#888888'] };
  var PTYPE_LABELS  = { pcp:'PCP', therapist:'Therapist', psychiatrist:'Psychiatrist',
    nutritionist:'Nutritionist', functional_medicine:'Functional Med', neurologist:'Neurologist',
    physical_therapist:'Physical Therapist', energy_practitioner:'Energy Practitioner', other:'Other' };
  var AP_STATUS_CFG = { draft: ['Draft','#888888'], active: ['Active','#22c98a'], completed: ['Completed','#b09ef8'] };

  function statusBadge(status) {
    var pair  = STATUS_LABELS[status] || ['Active', '#22c98a'];
    return '<span style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.25em;' +
      'color:' + pair[1] + ';background:' + pair[1] + '22;border:1px solid ' + pair[1] + ';' +
      'padding:4px 13px;border-radius:2px;text-transform:uppercase;white-space:nowrap">' + pair[0] + '</span>';
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  function tagChip(t) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.15em;' +
      'text-transform:uppercase;background:#e8b84b18;border:1px solid #e8b84b;' +
      'color:#e8b84b;padding:4px 11px;border-radius:2px">' + t + '</span>';
  }

  function profileRow(label, val, rawHtml) {
    var display = rawHtml ? (val || '—') : (val || '—');
    return '<div>' +
      '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.25em;' +
        'text-transform:uppercase;color:#e8b84b;margin-bottom:7px">' + label + '</div>' +
      '<div style="font-family:\'EB Garamond\',serif;font-size:18px;color:#fff;line-height:1.55">' + display + '</div>' +
    '</div>';
  }

  function statBox(label, val) {
    return '<div class="stat"><span class="stat-val">' + val +
      '</span><span class="stat-label">' + label + '</span></div>';
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function complianceBadge(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.2em;' +
      'text-transform:uppercase;color:' + color + ';background:' + color + '18;' +
      'border:1px solid ' + color + ';padding:5px 14px;border-radius:2px;white-space:nowrap">' +
      label + '</span>';
  }

  function recStatChip(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.18em;' +
      'text-transform:uppercase;color:' + color + ';padding:4px 11px;' +
      'border:1px solid ' + color + '88">' + label + '</span>';
  }

  function thCell(t) {
    return '<th style="text-align:left;color:#e8b84b;font-family:\'Cinzel\',serif;' +
      'font-size:12px;letter-spacing:.22em;text-transform:uppercase;padding-bottom:10px;' +
      'padding-right:10px">' + t + '</th>';
  }

  function sectionHeader(title) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:16px;letter-spacing:.22em;text-transform:uppercase;' +
      'color:#e8b84b;margin-bottom:16px;margin-top:4px;padding-bottom:12px;border-bottom:1px solid #e8b84b33">' + title + '</div>';
  }

  function cardWrap(content, extraStyle) {
    return '<div style="background:#0d0a1e;border:1px solid #e8b84b33;padding:24px 28px;margin-bottom:28px;border-radius:2px' +
      (extraStyle ? ';' + extraStyle : '') + '">' + content + '</div>';
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
      // Build API path — pass status filter server-side to reduce payload
      var path;
      if (search) {
        path = '/clients?search=' + encodeURIComponent(search);
        if (filter === 'archived') path += '&include_archived=true';
      } else if (filter === 'archived') {
        path = '/clients?status=archived&include_archived=true';
      } else {
        path = '/clients';
      }

      try {
        var data = await api(path);
        _clients = data.clients || [];
        window._crmClients = _clients; // expose for home dashboard pending-docs stat
        _loaded  = true;
      } catch (e) {
        var msg = e.message || 'Unknown error';
        // Detect token-missing scenario and give a clearer prompt
        var hint = msg.toLowerCase().includes('unauthorized') || msg.includes('401')
          ? 'Session may have expired — try signing out and back in.'
          : 'Check your network connection and Netlify function logs.';
        roster.innerHTML = '<div style="padding:32px 24px;border:1px solid #ff555533;' +
          'background:#ff05050a;margin-top:8px">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.25em;' +
          'color:#ff7070;text-transform:uppercase;margin-bottom:10px">Client Roster Unavailable</div>' +
          '<div style="font-size:16px;color:#dddaeecc;margin-bottom:8px">' + msg + '</div>' +
          '<div style="font-size:14px;color:#9988cc">' + hint + '</div>' +
          '<button onclick="window.renderClients()" class="action-btn view" ' +
          'style="margin-top:16px;font-size:11px">↻ Retry</button></div>';
        if (countEl) countEl.textContent = '';
        return;
      }

      var list = _clients.slice();
      var STATUS_FILTERS = ['active','cancelled_appointment','rescheduled','no_show',
                            'payment_issue','blocked','archived'];

      // Client-side filters (server already excluded archived for the default case)
      if (filter === 'distance') list = list.filter(function(c) { return (c.tags||[]).includes('distance'); });
      if (filter === 'inperson') list = list.filter(function(c) {
        return (c.tags||[]).includes('in-person') || (c.tags||[]).includes('inPerson');
      });
      if (filter === 'repeat') list = list.filter(function(c) { return (c.tags||[]).includes('repeat'); });
      if (filter === 'first')  list = list.filter(function(c) { return !(c.tags||[]).includes('repeat'); });
      if (STATUS_FILTERS.includes(filter)) list = list.filter(function(c) { return c.status === filter; });

      if (countEl) countEl.textContent = list.length + ' client' + (list.length !== 1 ? 's' : '');

      if (!list.length) {
        var emptyMsg = filter === 'archived'
          ? 'No archived clients.'
          : search
            ? 'No clients match "' + search + '".'
            : 'No active clients found. Clients are added automatically when sessions are logged, or manually with + New Client.';
        roster.innerHTML = '<div style="padding:32px 24px;text-align:center;color:#9988cc;' +
          'font-style:italic;font-size:16px;border:1px solid #e8b84b11">' + emptyMsg + '</div>';
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
        'background:#0e0b1f;border:1px solid #e8b84b44;padding:26px;margin-bottom:14px;' +
        (archived ? 'opacity:.55;' : '') + '">' +

      '<div class="card-head">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:18px;letter-spacing:.06em;color:#fff;' +
            'display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-weight:600">' +
            name + ' ' + statusBadge(status) +
          '</div>' +
          (c.email || c.phone
            ? '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#dddaeecc;margin-top:6px">' +
                [c.email, c.phone].filter(Boolean).join(' · ') +
              '</div>'
            : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.2em;color:#e8b84b;' +
            'text-transform:uppercase;margin-top:7px">' +
            'Added ' + fmtDate(c.created_at) +
            (c.source && c.source !== 'manual' ? ' · ' + c.source : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;flex-shrink:0;margin-left:14px">' +
          '<button class="action-btn view" onclick="crmOpenProfile(\'' + esc(id) + '\')">📋 Case File</button>' +
          '<button class="action-btn view" style="border-color:#9b7fe899;color:#b09ef8" ' +
            'onclick="crmOpenTimeline(\'' + esc(id) + '\')">⏱ Timeline</button>' +
          '<button class="action-btn view" style="border-color:#e8b84b;color:#e8b84b" ' +
            'onclick="crmOpenEdit(\'' + esc(id) + '\')">✎ Edit</button>' +
          '<button class="action-btn reject" style="border-color:#ff555577;color:#ff8888" ' +
            'onclick="crmConfirmArchive(\'' + esc(id) + '\',\'' + esc(name) + '\')">⊘ Archive</button>' +
        '</div>' +
      '</div>' +

      (tags.length
        ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' + tags.map(tagChip).join('') + '</div>'
        : '') +

      '<div style="display:flex;gap:7px;align-items:center;margin-top:14px;flex-wrap:wrap;' +
        'padding-top:14px;border-top:1px solid #e8b84b22">' +
        '<span style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.3em;' +
          'color:#e8b84b;text-transform:uppercase">Status:</span>' +
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
  // CREATE / EDIT MODAL  (basic contact/demo fields only)
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
    document.getElementById('crmModalSubtitle').textContent = 'Update contact & demographic details';
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
  // CASE FILE / PROFILE MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenProfile = async function (id) {
    _profileId = id;
    var modal = document.getElementById('crmProfileModal');
    var body  = document.getElementById('crmProfileBody');
    body.innerHTML = loadingHtml();
    modal.classList.add('open');

    try {
      var results = await Promise.all([
        api('/clients?id=' + id),
        api('/timeline?client_id=' + id),
        api('/recommendations?client_id=' + id).catch(function() { return { recommendations: [] }; }),
        api('/referrals?client_id=' + id).catch(function() { return { referrals: [] }; }),
        api('/action-plans?client_id=' + id).catch(function() { return { action_plans: [] }; }),
      ]);
      var data     = results[0];
      var tlData   = results[1];
      var recs     = results[2].recommendations || [];
      var refs     = results[3].referrals       || [];
      var plans    = results[4].action_plans    || [];
      var cl       = data.client;
      var sess     = data.sessions  || [];
      var tlEvents = tlData.timeline || [];
      var tlStats  = tlData.stats   || {};

      var tags         = cl.tags || [];
      var waiverSigned = tags.some(function(t) { return t.toLowerCase() === 'waiver'; });
      var intakeEvents = tlEvents.filter(function(e) { return e.type === 'intake'; });
      var hasIntake    = intakeEvents.length > 0;
      var intakeDate   = hasIntake ? intakeEvents[intakeEvents.length - 1].date : null;
      var latestIntake = hasIntake ? intakeEvents[0].data : null;

      var completedSess = sess.filter(function(s) { return s.status === 'completed'; });
      var totalPaid     = tlStats.totalPaid   || 0;
      var pendingAC     = tlStats.pendingFollowUps || 0;
      var hasNotes      = tlEvents.some(function(e) { return e.type === 'note'; });
      var hasPayment    = totalPaid > 0;

      // ── Extended derived data ──────────────────────────────────────
      var today        = todayISO();
      var sortedSess   = sess.slice().sort(function(a, b) {
        return (b.session_date || '') > (a.session_date || '') ? 1 : -1;
      });
      var lastSession  = sortedSess.find(function(s) { return (s.session_date || '') <= today; });
      var nextSession  = sortedSess.slice().reverse().find(function(s) {
        return s.session_date >= today && (s.status === 'pending' || s.status === 'confirmed');
      });
      var unpaidSess   = sess.filter(function(s) {
        return s.status === 'completed' &&
               s.payment_status !== 'paid' && s.payment_status !== 'exchange';
      });
      var overdueFollowUps = tlEvents.filter(function(e) {
        return e.type === 'aftercare' && e.data &&
               e.data.status === 'scheduled' && (e.date || '') < today;
      });
      var urgentPendingRefs = refs.filter(function(r) {
        return r.urgency === 'urgent' && r.followed_through === 'unknown';
      });
      var activeRecs   = recs.filter(function(r) { return r.purchased === 'unknown'; });
      var activePlans  = plans.filter(function(p) { return p.status === 'active'; });
      var pendingRefs  = refs.filter(function(r) { return r.followed_through === 'unknown'; });
      var hasAssessment = !!(latestIntake && latestIntake.agent_summary);
      var hasEnvData    = !!(latestIntake && (latestIntake.service_requested || latestIntake.message || latestIntake.agent_summary));

      // Update modal subtitle with client name
      var titleEl = document.getElementById('crmProfileTitle');
      var subEl   = document.getElementById('crmProfileSub');
      if (titleEl) titleEl.textContent = cl.full_name;
      if (subEl)   subEl.textContent   = 'Case File  ·  Client since ' + fmtDate(cl.created_at);

      // ── Needs Attention items ──────────────────────────────────────
      var attention = [];
      if (!waiverSigned)
        attention.push({ level: 'critical', icon: '⊘',
          label: 'Waiver not on file',
          hint:  'Required before treatment — add tag "waiver" once signed.',
          color: '#ff5555' });
      if (!hasIntake)
        attention.push({ level: 'critical', icon: '⊘',
          label: 'No intake form on file',
          hint:  'Client has not submitted an intake or initial assessment.',
          color: '#ff5555' });
      if (unpaidSess.length)
        attention.push({ level: 'critical', icon: '⊘',
          label: unpaidSess.length + ' completed session' + (unpaidSess.length > 1 ? 's' : '') + ' without payment',
          hint:  'Payment not recorded — review session log and reconcile.',
          color: '#ff5555' });
      if (urgentPendingRefs.length)
        attention.push({ level: 'warning', icon: '⚠',
          label: 'Urgent referral pending: ' + urgentPendingRefs[0].provider_name,
          hint:  'Flagged urgent — client has not yet followed through.',
          color: '#f8a84b' });
      if (overdueFollowUps.length)
        attention.push({ level: 'warning', icon: '⚠',
          label: overdueFollowUps.length + ' overdue follow-up' + (overdueFollowUps.length > 1 ? 's' : ''),
          hint:  'Scheduled aftercare has passed its due date without completion.',
          color: '#f8a84b' });
      if (!hasNotes && completedSess.length)
        attention.push({ level: 'info', icon: '○',
          label: 'No session notes documented',
          hint:  'Open any session to add clinical notes for the record.',
          color: '#66b5f8' });
      if (activePlans.length === 0 && completedSess.length >= 2)
        attention.push({ level: 'info', icon: '○',
          label: 'No active action plan',
          hint:  'Consider creating a care plan to guide ongoing treatment.',
          color: '#9b7fe8' });

      // ── Layout helpers ─────────────────────────────────────────────
      function caseSection(icon, title, content, accentColor) {
        var ac = accentColor || '#e8b84b';
        return '<div style="margin-bottom:56px">' +
          '<div style="display:flex;align-items:center;gap:13px;margin-bottom:26px;' +
            'padding-bottom:16px;border-bottom:2px solid ' + ac + '66">' +
            '<span style="font-size:20px;opacity:.95;line-height:1">' + icon + '</span>' +
            '<div style="font-family:\'Cinzel\',serif;font-size:17px;letter-spacing:.35em;' +
              'text-transform:uppercase;color:' + ac + ';font-weight:700">' + title + '</div>' +
          '</div>' +
          content +
        '</div>';
      }

      function snapMetric(label, value, valueColor, subtext) {
        return '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.28em;' +
            'text-transform:uppercase;color:#e8b84b">' + label + '</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:24px;color:' + (valueColor || '#fff') + ';font-weight:700;letter-spacing:.02em;line-height:1.1">' + value + '</div>' +
          (subtext ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc;line-height:1.3">' + subtext + '</div>' : '') +
        '</div>';
      }

      function statusDot(ok, label, okText, noText) {
        var color = ok ? '#22c98a' : '#ee7070';
        return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #ffffff0f">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#d8d4f0;flex:1">' + label + '</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:' + color + ';white-space:nowrap">' + (ok ? okText : noText) + '</div>' +
        '</div>';
      }

      function countDot(count, label, activeColor, inactiveColor) {
        var color = count > 0 ? (activeColor || '#f8a84b') : (inactiveColor || '#22c98a');
        return '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #ffffff0f">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#d8d4f0;flex:1">' + label + '</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:17px;color:#fff;font-weight:700">' + count + '</div>' +
        '</div>';
      }

      // ══════════════════════════════════════════════════════════════════
      // SECTION 1 — PRACTITIONER SNAPSHOT
      // ══════════════════════════════════════════════════════════════════
      var snapshotHtml =
        // Header
        '<div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:22px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:46px;letter-spacing:.03em;color:#fff;font-weight:700;line-height:1.05;margin-bottom:14px">' +
              cl.full_name +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px">' +
              statusBadge(cl.status || 'active') +
              (tags.length ? tags.map(tagChip).join('') : '') +
            '</div>' +
            '<div style="font-family:\'EB Garamond\',serif;font-size:21px;color:#f0ecff;margin-bottom:8px">' +
              [cl.email, cl.phone].filter(Boolean).join('  ·  ') +
            '</div>' +
            '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:#e8b84b">' +
              'On file since ' + fmtDate(cl.created_at) +
              (cl.source && cl.source !== 'manual' ? '  ·  Source: ' + cl.source : '') +
            '</div>' +
          '</div>' +
        '</div>' +

        // Key metrics bar (5-up)
        '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#e8b84b22;margin-bottom:20px">' +
          '<div style="background:#08061a;padding:22px 18px">' +
            snapMetric('Last Session',
              lastSession ? fmtDate(lastSession.session_date) : 'None yet',
              lastSession ? '#f0ecff' : '#888',
              lastSession ? (lastSession.service || lastSession.service_type || '') : '') +
          '</div>' +
          '<div style="background:#08061a;padding:22px 18px">' +
            snapMetric('Next Session',
              nextSession ? fmtDate(nextSession.session_date) : 'Not scheduled',
              nextSession ? '#e8b84b' : '#888888',
              nextSession ? (nextSession.service || nextSession.service_type || '') : '') +
          '</div>' +
          '<div style="background:#08061a;padding:22px 18px">' +
            snapMetric('Sessions', sess.length + ' total', '#f0ecff', completedSess.length + ' completed') +
          '</div>' +
          '<div style="background:#08061a;padding:22px 18px">' +
            snapMetric('Revenue',
              '$' + parseFloat(totalPaid).toFixed(2), '#22c98a',
              unpaidSess.length ? unpaidSess.length + ' session' + (unpaidSess.length > 1 ? 's' : '') + ' unpaid' : 'All paid') +
          '</div>' +
          '<div style="background:#08061a;padding:22px 18px">' +
            snapMetric('Follow-ups',
              pendingAC + ' pending',
              pendingAC > 0 ? '#f8a84b' : '#22c98a',
              overdueFollowUps.length ? overdueFollowUps.length + ' overdue' : '') +
          '</div>' +
        '</div>' +

        // Three-column status panel
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +

          '<div style="background:#07051a;border:1px solid #e8b84b33;padding:22px 22px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:#e8b84b;margin-bottom:13px;padding-bottom:10px;border-bottom:1px solid #e8b84b44">Paperwork</div>' +
            statusDot(waiverSigned,  'Waiver',      '✓ On File',   '⚠ Missing') +
            statusDot(hasIntake,     'Intake Form',  '✓ Complete',  '⚠ Missing') +
            statusDot(hasAssessment, 'Assessment',   '✓ Complete',  '⚠ Pending') +
          '</div>' +

          '<div style="background:#07051a;border:1px solid #e8b84b33;padding:22px 22px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:#e8b84b;margin-bottom:13px;padding-bottom:10px;border-bottom:1px solid #e8b84b44">Clinical</div>' +
            countDot(activeRecs.length,   'Active Recs',    '#f8a84b', '#22c98a') +
            countDot(pendingRefs.length,  'Pending Refs',   urgentPendingRefs.length ? '#ff5555' : '#f8a84b', '#22c98a') +
            countDot(activePlans.length,  'Open Plans',     '#9b7fe8', '#888') +
          '</div>' +

          '<div style="background:#07051a;border:1px solid #e8b84b33;padding:22px 22px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:#e8b84b;margin-bottom:13px;padding-bottom:10px;border-bottom:1px solid #e8b84b44">Environment</div>' +
            statusDot(hasEnvData,      'Env Review',   '✓ On File',    '○ Not Started') +
            statusDot(hasNotes,        'Session Notes', '✓ Documented', '○ None Yet') +
            countDot(overdueFollowUps.length, 'Overdue F/U', '#ee7070', '#22c98a') +
          '</div>' +

        '</div>';

      // ══════════════════════════════════════════════════════════════════
      // SECTION 2 — NEEDS ATTENTION
      // ══════════════════════════════════════════════════════════════════
      var needsAttentionHtml;
      if (attention.length) {
        needsAttentionHtml = caseSection('⚑', 'Needs Attention',
          attention.map(function(a) {
            return '<div style="display:flex;align-items:flex-start;gap:18px;padding:20px 22px;' +
              'background:' + a.color + '12;border-left:4px solid ' + a.color + ';margin-bottom:8px">' +
              '<span style="color:' + a.color + ';font-size:24px;line-height:1.1;flex-shrink:0;margin-top:1px">' + a.icon + '</span>' +
              '<div>' +
                '<div style="font-family:\'Cinzel\',serif;font-size:15px;letter-spacing:.12em;' +
                  'text-transform:uppercase;color:' + a.color + ';margin-bottom:7px">' + a.label + '</div>' +
                '<div style="font-family:\'EB Garamond\',serif;font-size:19px;color:#f0ecff;line-height:1.55">' + a.hint + '</div>' +
              '</div>' +
            '</div>';
          }).join(''),
          '#ff5555'
        );
      } else {
        needsAttentionHtml = caseSection('⚑', 'Needs Attention',
          '<div style="display:flex;align-items:center;gap:18px;padding:24px 26px;background:#22c98a14;border:1px solid #22c98a55">' +
            '<span style="color:#22c98a;font-size:28px;line-height:1">✓</span>' +
            '<div style="font-family:\'Cinzel\',serif;font-size:16px;letter-spacing:.25em;text-transform:uppercase;color:#22c98a">' +
              'All documentation complete — no items require attention' +
            '</div>' +
          '</div>',
          '#22c98a'
        );
      }

      // ══════════════════════════════════════════════════════════════════
      // SECTION 3 — ACTIVE TREATMENT
      // ══════════════════════════════════════════════════════════════════
      var recentNotes = tlEvents.filter(function(e) { return e.type === 'note'; });
      var lastNoteData = recentNotes.length ? recentNotes[0] : null;
      var lastNoteSnippet = lastNoteData
        ? (lastNoteData.data.content || '').slice(0, 300) +
          ((lastNoteData.data.content || '').length > 300 ? '…' : '')
        : null;

      var activeTreatmentHtml = caseSection('✦', 'Active Treatment',
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:' + (lastNoteSnippet ? '16px' : '0') + '">' +
          '<div style="background:#07051a;border:1px solid #9b7fe833;padding:18px 20px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.32em;text-transform:uppercase;color:#9b7fe8;margin-bottom:12px">Last Session</div>' +
            (lastSession
              ? '<div style="font-family:\'EB Garamond\',serif;font-size:20px;color:#fff;margin-bottom:5px">' + fmtDate(lastSession.session_date) + '</div>' +
                '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#e8b84b;margin-bottom:5px">' + (lastSession.service || lastSession.service_type || 'Session') + '</div>' +
                '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:' + ((lastSession.status === 'completed') ? '#22c98a' : '#f8a84b') + '">' + (lastSession.status || '') + '</div>' +
                (lastSession.amount_due ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc;margin-top:5px">$' + parseFloat(lastSession.amount_due).toFixed(2) + '</div>' : '')
              : '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaee44;font-style:italic">No sessions yet</div>') +
          '</div>' +
          '<div style="background:#07051a;border:1px solid #22c98a33;padding:18px 20px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.32em;text-transform:uppercase;color:#22c98a;margin-bottom:12px">Next Session</div>' +
            (nextSession
              ? '<div style="font-family:\'EB Garamond\',serif;font-size:20px;color:#fff;margin-bottom:5px">' + fmtDate(nextSession.session_date) + '</div>' +
                '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#e8b84b;margin-bottom:5px">' + (nextSession.service || nextSession.service_type || 'Session') + '</div>' +
                (nextSession.session_time ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc">' + nextSession.session_time.slice(0, 5) + '</div>' : '')
              : '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaee44;font-style:italic">Not scheduled</div>') +
          '</div>' +
        '</div>' +
        (lastNoteSnippet
          ? '<div style="background:#07051a;border:1px solid #e8b84b22;border-left:3px solid #e8b84b55;padding:16px 20px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#e8b84b;margin-bottom:10px">Most Recent Note  ·  ' + fmtDate(lastNoteData.date) + '</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#e8e6f8;line-height:1.65;white-space:pre-wrap">' + lastNoteSnippet + '</div>' +
              (lastNoteData.data.energy_findings ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#b09ef8;font-style:italic;margin-top:8px">Energy: ' + lastNoteData.data.energy_findings + '</div>' : '') +
            '</div>'
          : ''),
        '#9b7fe8'
      );

      // ══════════════════════════════════════════════════════════════════
      // SECTION 4 — SESSION DOCUMENTATION
      // ══════════════════════════════════════════════════════════════════
      var sessRows = sess.length
        ? sess.map(function(s) {
            var payCol = s.payment_status === 'paid' ? '#22c98a' : s.payment_status === 'exchange' ? '#b09ef8' : '#f8a84b';
            return '<tr>' +
              '<td style="padding:10px 10px 10px 0;color:#f0ecff;font-family:\'EB Garamond\',serif;font-size:17px;border-bottom:1px solid #e8b84b14">' + fmtDate(s.session_date) + '</td>' +
              '<td style="padding:10px 10px;color:#e8b84b;font-family:\'EB Garamond\',serif;font-size:17px;border-bottom:1px solid #e8b84b14">' + (s.service || s.service_type || '—') + '</td>' +
              '<td style="padding:10px 10px;font-family:\'EB Garamond\',serif;font-size:17px;border-bottom:1px solid #e8b84b14">' + statusBadge(s.status || 'pending') + '</td>' +
              '<td style="padding:10px 0 10px 10px;color:' + payCol + ';font-family:\'EB Garamond\',serif;font-size:17px;border-bottom:1px solid #e8b84b14">' +
                (s.amount_due ? '$' + parseFloat(s.amount_due).toFixed(2) : '—') + '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="4" style="color:#dddaee55;font-style:italic;padding:20px 0;font-family:\'EB Garamond\',serif;font-size:17px">No sessions yet.</td></tr>';

      var sessionDocHtml = caseSection('◈', 'Session Documentation',
        cardWrap(
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' + thCell('Date') + thCell('Service') + thCell('Status') + thCell('Amount') + '</tr></thead>' +
            '<tbody>' + sessRows + '</tbody>' +
          '</table>'
        ),
        '#e8b84b'
      );

      // ══════════════════════════════════════════════════════════════════
      // SECTION 4b — FINANCIAL SUMMARY (from Financial Center ledger)
      // ══════════════════════════════════════════════════════════════════
      var financialHtml = '<div id="crmFinancialWrap" style="margin-bottom:8px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.22em;color:#9b7fe8;padding:16px 0 8px">Loading financial summary…</div>' +
        '</div>';

      // ══════════════════════════════════════════════════════════════════
      // SECTION 4c — COMMUNICATION HISTORY (from Communications module)
      // ══════════════════════════════════════════════════════════════════
      var commHtml = '<div id="crmCommWrap" style="margin-bottom:8px"></div>';

      // ══════════════════════════════════════════════════════════════════
      // SECTIONS 5–7 — RECS / REFS / PLANS (inner content only)
      // ══════════════════════════════════════════════════════════════════
      var recsHtml  = caseSection('🌿', 'Recommendations & Products', buildRecsSection(recs, id),   '#22c98a');
      var refsHtml  = caseSection('🔗', 'Provider Referrals',         buildRefsSection(refs, id),   '#b09ef8');
      var plansHtml = caseSection('◎',  'Action Plans',               buildActionPlansSection(plans, id), '#e8b84b');

      // ══════════════════════════════════════════════════════════════════
      // SECTION 8 — ENVIRONMENTAL REVIEW
      // ══════════════════════════════════════════════════════════════════
      var envHtml = '';
      if (hasEnvData) {
        var envFields = [];
        if (latestIntake.service_requested) envFields.push(['Service Requested', latestIntake.service_requested]);
        if (latestIntake.message)           envFields.push(['Intake Message',    latestIntake.message]);
        if (latestIntake.agent_summary)     envFields.push(['Assessment Summary', latestIntake.agent_summary]);
        envHtml = caseSection('◉', 'Environmental Review',
          cardWrap(
            envFields.map(function(f) {
              return '<div style="margin-bottom:18px">' +
                '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#e8b84b;margin-bottom:6px">' + f[0] + '</div>' +
                '<div style="font-family:\'EB Garamond\',serif;font-size:18px;color:#e8e6f8;line-height:1.6">' + f[1] + '</div>' +
              '</div>';
            }).join(''),
            'border-color:#9b7fe833'
          ),
          '#9b7fe8'
        );
      }

      // ══════════════════════════════════════════════════════════════════
      // SECTION 9 — CLIENT INFORMATION
      // ══════════════════════════════════════════════════════════════════
      var clientInfoHtml = caseSection('◇', 'Client Information',
        cardWrap(
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px' + (cl.notes ? ';margin-bottom:20px' : '') + '">' +
            profileRow('Full Name', cl.full_name) +
            profileRow('Email',     cl.email) +
            profileRow('Phone',     cl.phone) +
            profileRow('Source',    cl.source) +
            profileRow('Status',    statusBadge(cl.status || 'active'), true) +
            profileRow('On File Since', fmtDate(cl.created_at)) +
          '</div>' +
          (cl.notes
            ? '<div style="border-left:3px solid #e8b84b55;padding:14px 18px;background:#e8b84b07;' +
                'font-family:\'EB Garamond\',serif;font-size:18px;color:#e8e6f8;line-height:1.7">' +
                cl.notes + '</div>'
            : '')
        ),
        '#e8b84b'
      );

      // ── Shared AI payload (reused by flags, prep brief, and timeline) ─
      _prepBriefClientId = id;
      _prepBriefPayload  = {
        clientName:   cl.full_name,
        status:       cl.status || 'active',
        clientTags:   cl.tags  || [],
        today:        todayISO(),
        sessions:     sess,
        notes:        tlEvents
          .filter(function(e) { return e.type === 'note'; })
          .map(function(e) { return Object.assign({ created_at: e.date }, e.data || {}); }),
        intake:       intakeEvents.map(function(e) { return e.data || {}; }),
        recommendations: recs,
        referrals:    refs,
        followUps:    tlEvents
          .filter(function(e) { return e.type === 'aftercare'; })
          .map(function(e) { return Object.assign({ date: e.date }, e.data || {}); }),
        plans:        plans,
        recentEnvironment: (function() {
          try { return JSON.parse(localStorage.getItem('rea_env_log') || '[]').slice(0, 5); }
          catch (_) { return []; }
        })()
      };

      // ── Assemble ────────────────────────────────────────────────────
      body.innerHTML =
        caseSection('◈', 'Practitioner Snapshot', snapshotHtml, '#e8b84b') +
        needsAttentionHtml +
        activeTreatmentHtml +
        '<div id="crmPrepBriefWrap">'           + _prepBriefLoadingHtml()       + '</div>' +
        '<div id="crmAttentionFlagsWrap">'      + _attentionFlagsLoadingHtml()  + '</div>' +
        '<div id="crmPractitionerTimelineWrap">'+ _timelineLoadingHtml()        + '</div>' +
        sessionDocHtml +
        financialHtml +
        commHtml +
        recsHtml +
        refsHtml +
        plansHtml +
        envHtml +
        clientInfoHtml +
        '<div style="margin-top:8px;padding-top:20px;border-top:1px solid #e8b84b1a;display:flex;gap:12px;flex-wrap:wrap">' +
          '<button class="action-btn view" style="border-color:#e8b84b;color:#e8b84b" ' +
            'onclick="crmCloseProfileModal();crmOpenEdit(\'' + esc(id) + '\')">✎ Edit Client</button>' +
          '<button class="action-btn view" style="border-color:#9b7fe899;color:#b09ef8" ' +
            'onclick="crmCloseProfileModal();crmOpenTimeline(\'' + esc(id) + '\')">⏱ Full Timeline</button>' +
        '</div>';

      // Fire all async sections in parallel
      _loadAttentionFlags(id, _prepBriefPayload);
      _loadPrepBrief(id, _prepBriefPayload);
      _loadPractitionerTimeline(id, _prepBriefPayload);
      _loadClientFinancialSummary(id, cl.full_name);
      if (typeof window.cmLoadClientHistory === 'function') {
        window.cmLoadClientHistory(id, cl.full_name, cl.email);
      }

    } catch (e) {
      body.innerHTML = errorHtml('Failed to load case file: ' + e.message);
    }
  };

  // ── Financial summary loader (async, non-blocking) ───────────────────────
  function _loadClientFinancialSummary(clientId, clientName) {
    var wrap = document.getElementById('crmFinancialWrap');
    if (!wrap) return;
    api('/financial?section=client_summary&client_id=' + clientId)
      .then(function(data) {
        if (!wrap) return;
        var fin = data.financial || {};
        var pkgs = data.packages || [];
        var activePkg = fin.activePackage;
        var balance   = parseFloat(fin.currentBalance || 0);
        var credits   = parseFloat(fin.creditsAvailable || 0);
        var outstanding = parseFloat(fin.outstandingCharges || 0);

        var fmt = function(n) { return '$' + Math.abs(n).toFixed(2); };
        var balColor = balance > 0 ? '#ff6b6b' : balance < 0 ? '#22c98a' : '#9b7fe8';

        var pkgRow = activePkg
          ? '<div style="margin-top:14px;padding:12px 16px;background:#9b7fe808;border:1px solid #9b7fe833;border-radius:6px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#9b7fe8;margin-bottom:6px">Active Package</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#e8e6f8">' + (activePkg.package_name || 'Package') + '</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaee99;margin-top:4px">' +
                ((activePkg.sessions_included - activePkg.sessions_used) + ' sessions remaining') +
                (activePkg.expiration_date ? ' · Expires ' + activePkg.expiration_date : '') +
              '</div>' +
            '</div>'
          : '';

        var kpis =
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:0">' +
            _finKpi('Running Balance', fmt(balance), balColor) +
            _finKpi('Credits Available', fmt(credits), '#22c98a') +
            _finKpi('Unpaid Sessions', fmt(outstanding), outstanding > 0 ? '#f8a84b' : '#dddaee66') +
          '</div>';

        var histLink = data.ledger && data.ledger.length > 0
          ? '<div style="margin-top:14px;font-family:\'EB Garamond\',serif;font-size:15px;color:#9b7fe899">' +
              data.ledger.length + ' ledger entr' + (data.ledger.length === 1 ? 'y' : 'ies') + ' on file. ' +
              '<span style="color:#9b7fe8;cursor:pointer;text-decoration:underline" ' +
                'onclick="crmCloseProfileModal();showTab(\'financial\');setTimeout(function(){fcSection(\'ledger\');},300)">View in Financial Center →</span>' +
            '</div>'
          : '<div style="margin-top:10px;font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaee44">No ledger history yet — run the SQL migration to enable financial tracking.</div>';

        wrap.innerHTML = caseSection('◇', 'Financial Summary',
          cardWrap(kpis + pkgRow + histLink, 'border-color:#9b7fe833'),
          '#9b7fe8'
        );
      })
      .catch(function() {
        var wrap2 = document.getElementById('crmFinancialWrap');
        if (wrap2) wrap2.innerHTML = '';
      });
  }

  function _finKpi(label, val, color) {
    return '<div style="background:#0c0622;border:1px solid #2a1f4e;border-radius:8px;padding:14px 16px">' +
      '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:#dddaee66;margin-bottom:6px">' + label + '</div>' +
      '<div style="font-size:22px;font-weight:600;color:' + color + '">' + val + '</div>' +
    '</div>';
  }

  // ── Recommendations section builder ──────────────────────────────────────
  function buildRecsSection(recs, clientId) {
    var active    = recs.filter(function(r) { return r.purchased === 'unknown'; }).length;
    var completed = recs.filter(function(r) { return r.purchased === 'yes'; }).length;
    var declined  = recs.filter(function(r) { return r.purchased === 'no'; }).length;

    var outstanding = recs.filter(function(r) { return r.purchased === 'unknown'; });
    var outstandingAlert = outstanding.length
      ? '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.22em;text-transform:uppercase;' +
          'color:#f8a84b;margin-bottom:14px;padding:10px 14px;background:#f8a84b0d;border:1px solid #f8a84b33">⚠ ' +
          outstanding.length + ' recommendation' + (outstanding.length > 1 ? 's' : '') + ' awaiting outcome</div>'
      : '';

    var recRows = recs.length
      ? recs.map(function(r) { return buildRecRow(r, clientId); }).join('')
      : '<div style="color:#dddaeeaa;font-family:\'EB Garamond\',serif;font-size:17px;' +
          'font-style:italic;padding:14px 0">No recommendations yet.</div>';

    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
        recStatChip(recs.length + ' Total', '#dddaeecc') +
        recStatChip(active    + ' Active',    '#f8a84b') +
        recStatChip(completed + ' Completed', '#22c98a') +
        (declined ? recStatChip(declined + ' Declined', '#ee7070') : '') +
        '<button class="action-btn approve" style="padding:6px 16px;font-size:11px;margin-left:auto" ' +
          'onclick="crmOpenRecForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
      '</div>' +
      outstandingAlert +
      recRows;
  }

  var OUTCOME_CFG = {
    recommended: ['Recommended', '#888888'],
    purchased:   ['Purchased',   '#22c98a'],
    tried:       ['Tried',       '#66b5f8'],
    helpful:     ['Helpful',     '#9b7fe8'],
    not_helpful: ['Not Helpful', '#f07070'],
    declined:    ['Declined',    '#ee7070'],
  };

  function buildRecRow(r, clientId) {
    var prCfg  = PRIORITY_CFG[r.priority]  || PRIORITY_CFG.medium;
    var puCfg  = PURCHASED_CFG[r.purchased] || PURCHASED_CFG.unknown;
    var catLbl = CAT_LABELS[r.category]    || 'Other';
    var outCfg = r.outcome_status ? (OUTCOME_CFG[r.outcome_status] || OUTCOME_CFG.recommended) : null;

    // Outcome quick-action buttons — only show for non-terminal states
    var terminalOutcomes = ['purchased','helpful','not_helpful','declined'];
    var isTerminal = r.outcome_status && terminalOutcomes.includes(r.outcome_status);
    var outcomeButtons = isTerminal ? '' :
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' +
        _outcomeBtn(r.id, clientId, 'purchased',   '✓ Purchased',  '#22c98a') +
        _outcomeBtn(r.id, clientId, 'tried',        '◎ Tried',      '#66b5f8') +
        _outcomeBtn(r.id, clientId, 'helpful',      '✦ Helpful',    '#9b7fe8') +
        _outcomeBtn(r.id, clientId, 'not_helpful',  '✗ Not Helpful','#f07070') +
        _outcomeBtn(r.id, clientId, 'declined',     '— Declined',   '#888888') +
      '</div>';

    return '<div style="background:#0a0718;border:1px solid #e8b84b22;padding:16px 20px;margin-bottom:10px;border-radius:2px">' +
      '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:15px;letter-spacing:.06em;color:#fff;' +
            'font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            r.product_name +
            complianceBadge(catLbl,   '#9b7fe8') +
            complianceBadge(prCfg[0], prCfg[1]) +
            (outCfg ? complianceBadge(outCfg[0], outCfg[1]) : complianceBadge(puCfg[0], puCfg[1])) +
          '</div>' +
          (r.reason ? '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#dddaeecc;line-height:1.55;margin-bottom:5px">' + r.reason + '</div>' : '') +
          (r.client_outcome ? '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#22c98acc;font-style:italic">Outcome: ' + r.client_outcome + '</div>' : '') +
          (r.practitioner_notes ? '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaeeaa;font-style:italic">Notes: ' + r.practitioner_notes + '</div>' : '') +
          (r.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe8aa;margin-top:4px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#e8b84b;margin-top:6px">' +
            fmtDate(r.recommended_at) +
          '</div>' +
          outcomeButtons +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b;color:#e8b84b;padding:5px 14px;font-size:11px;flex-shrink:0" ' +
          'onclick="crmOpenRecForm(\'' + esc(clientId) + '\',\'' + esc(r.id) + '\')">Edit</button>' +
      '</div>' +
    '</div>';
  }

  function _outcomeBtn(recId, clientId, outcome, label, color) {
    return '<button onclick="crmUpdateRecOutcome(\'' + esc(recId) + '\',\'' + outcome + '\',\'' + esc(clientId) + '\')" ' +
      'style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;' +
      'padding:5px 11px;border:1px solid ' + color + '55;color:' + color + ';background:transparent;' +
      'cursor:pointer;border-radius:2px;transition:all .15s" ' +
      'onmouseover="this.style.background=\'' + color + '18\'" onmouseout="this.style.background=\'transparent\'">' +
      label + '</button>';
  }

  // ── Referrals section builder ─────────────────────────────────────────────
  function buildRefsSection(refs, clientId) {
    var pending   = refs.filter(function(r) { return r.followed_through === 'unknown'; }).length;
    var completed = refs.filter(function(r) { return r.followed_through === 'yes'; }).length;

    var staleAlert = '';
    var thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    var stale = refs.filter(function(r) {
      return r.followed_through === 'unknown' && r.referred_at < thirtyDaysAgo;
    });
    if (stale.length) {
      staleAlert = '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.22em;text-transform:uppercase;' +
        'color:#ee7070;margin-bottom:14px;padding:10px 14px;background:#ee70700d;border:1px solid #ee707033">⚠ ' +
        stale.length + ' referral' + (stale.length > 1 ? 's' : '') + ' older than 30 days — follow up needed</div>';
    }

    var refRows = refs.length
      ? refs.map(function(r) { return buildRefRow(r, clientId); }).join('')
      : '<div style="color:#dddaeeaa;font-family:\'EB Garamond\',serif;font-size:17px;' +
          'font-style:italic;padding:14px 0">No referrals yet.</div>';

    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
        recStatChip(refs.length + ' Total',    '#dddaeecc') +
        recStatChip(pending     + ' Pending',   '#f8a84b') +
        recStatChip(completed   + ' Completed', '#22c98a') +
        '<button class="action-btn approve" style="padding:6px 16px;font-size:11px;margin-left:auto" ' +
          'onclick="crmOpenRefForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
      '</div>' +
      staleAlert +
      refRows;
  }

  function buildRefRow(r, clientId) {
    var urgCfg = URGENCY_CFG[r.urgency]           || URGENCY_CFG.routine;
    var flwCfg = FOLLOWED_CFG[r.followed_through] || FOLLOWED_CFG.unknown;
    var ptLbl  = PTYPE_LABELS[r.provider_type]    || 'Other';
    return '<div style="background:#0a0718;border:1px solid #e8b84b22;padding:16px 20px;margin-bottom:10px;border-radius:2px">' +
      '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:15px;letter-spacing:.06em;color:#fff;' +
            'font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            r.provider_name +
            complianceBadge(ptLbl,      '#9b7fe8') +
            complianceBadge(urgCfg[0],  urgCfg[1]) +
            complianceBadge(flwCfg[0],  flwCfg[1]) +
          '</div>' +
          (r.reason ? '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#dddaeecc;line-height:1.55;margin-bottom:5px">' + r.reason + '</div>' : '') +
          (r.contact_info ? '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#66b5f8cc">' + r.contact_info + '</div>' : '') +
          (r.outcome_notes ? '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#22c98acc;font-style:italic;margin-top:3px">Outcome: ' + r.outcome_notes + '</div>' : '') +
          (r.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe8aa;margin-top:4px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#e8b84b;margin-top:6px">' +
            'Referred ' + fmtDate(r.referred_at) +
          '</div>' +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b;color:#e8b84b;padding:5px 14px;font-size:11px;flex-shrink:0" ' +
          'onclick="crmOpenRefForm(\'' + esc(clientId) + '\',\'' + esc(r.id) + '\')">Edit</button>' +
      '</div>' +
    '</div>';
  }

  // ── Action Plans section builder ─────────────────────────────────────────
  function buildActionPlansSection(plans, clientId) {
    var active    = plans.filter(function(p) { return p.status === 'active'; }).length;
    var completed = plans.filter(function(p) { return p.status === 'completed'; }).length;

    var planRows = plans.length
      ? plans.map(function(p) { return buildActionPlanRow(p, clientId); }).join('')
      : '<div style="color:#dddaeeaa;font-family:\'EB Garamond\',serif;font-size:17px;' +
          'font-style:italic;padding:14px 0">No action plans yet.</div>';

    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">' +
        recStatChip(plans.length + ' Total',    '#dddaeecc') +
        recStatChip(active       + ' Active',    '#22c98a') +
        recStatChip(completed    + ' Completed', '#b09ef8') +
        '<button class="action-btn approve" style="padding:6px 16px;font-size:11px;margin-left:auto" ' +
          'onclick="crmOpenApForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
      '</div>' +
      planRows;
  }

  function buildActionPlanRow(p, clientId) {
    var prCfg = PRIORITY_CFG[p.priority]    || PRIORITY_CFG.medium;
    var stCfg = AP_STATUS_CFG[p.status]     || AP_STATUS_CFG.active;
    var fields = [];
    if (p.immediate_steps)       fields.push(['Immediate Steps',       p.immediate_steps]);
    if (p.products_recommended)  fields.push(['Products Recommended',  p.products_recommended]);
    if (p.provider_referrals)    fields.push(['Provider Referrals',    p.provider_referrals]);
    if (p.environmental_actions) fields.push(['Environmental Actions', p.environmental_actions]);
    if (p.aftercare_tasks)       fields.push(['Aftercare Tasks',       p.aftercare_tasks]);

    return '<div style="background:#0a0718;border:1px solid #e8b84b22;padding:16px 20px;margin-bottom:10px;border-radius:2px">' +
      '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
            complianceBadge(stCfg[0], stCfg[1]) +
            complianceBadge(prCfg[0] + ' Priority', prCfg[1]) +
            (p.due_date ? complianceBadge('Due ' + fmtDate(p.due_date), '#e8b84b') : '') +
          '</div>' +
          fields.map(function(f) {
            return '<div style="margin-bottom:10px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.22em;text-transform:uppercase;' +
                'color:#e8b84b;margin-bottom:4px">' + f[0] + '</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:17px;color:#e8e6f8;line-height:1.55">' + f[1] + '</div>' +
            '</div>';
          }).join('') +
          (p.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe8aa;margin-top:6px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#e8b84b;margin-top:8px">' +
            fmtDate(p.created_at) +
          '</div>' +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b;color:#e8b84b;padding:5px 14px;font-size:11px;flex-shrink:0" ' +
          'onclick="crmOpenApForm(\'' + esc(clientId) + '\',\'' + esc(p.id) + '\')">Edit</button>' +
      '</div>' +
    '</div>';
  }

  window.crmCloseProfileModal = function (e) {
    if (e && e.target !== document.getElementById('crmProfileModal')) return;
    document.getElementById('crmProfileModal').classList.remove('open');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMELINE MODAL
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
        session:        { icon: '✦',  label: 'Session',        color: '#9b7fe8' },
        note:           { icon: '📝', label: 'Note',           color: '#e8b84b' },
        payment:        { icon: '💳', label: 'Payment',        color: '#22c98a' },
        aftercare:      { icon: '💌', label: 'Follow-up',      color: '#66b5f8' },
        intake:         { icon: '📋', label: 'Intake',         color: '#f8a84b' },
        recommendation: { icon: '🌿', label: 'Recommendation', color: '#22c98a' },
        referral:       { icon: '🔗', label: 'Referral',       color: '#b09ef8' },
        action_plan:    { icon: '📌', label: 'Action Plan',    color: '#e8b84b' },
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
              detail = 'Form submitted' + (d.service_requested ? ' · ' + d.service_requested : '');
            } else if (ev.type === 'recommendation') {
              var prCfgT = PRIORITY_CFG[d.priority] || PRIORITY_CFG.medium;
              var puCfgT = PURCHASED_CFG[d.purchased] || PURCHASED_CFG.unknown;
              detail = (d.product_name || '') +
                (d.category ? ' · ' + (CAT_LABELS[d.category] || d.category) : '') +
                ' · ' + prCfgT[0] + ' priority · ' + puCfgT[0] +
                (d.reason ? ' — ' + d.reason.slice(0, 80) : '');
            } else if (ev.type === 'referral') {
              var urgCfgT = URGENCY_CFG[d.urgency] || URGENCY_CFG.routine;
              var flwCfgT = FOLLOWED_CFG[d.followed_through] || FOLLOWED_CFG.unknown;
              detail = (d.provider_name || '') +
                (d.provider_type ? ' · ' + (PTYPE_LABELS[d.provider_type] || d.provider_type) : '') +
                ' · ' + urgCfgT[0] + ' · ' + flwCfgT[0] +
                (d.reason ? ' — ' + d.reason.slice(0, 80) : '');
            } else if (ev.type === 'action_plan') {
              var prCfgAP = PRIORITY_CFG[d.priority] || PRIORITY_CFG.medium;
              var stCfgAP = AP_STATUS_CFG[d.status]  || AP_STATUS_CFG.active;
              var parts = [];
              if (d.immediate_steps)      parts.push(d.immediate_steps.slice(0, 60));
              if (d.products_recommended) parts.push('Products: ' + d.products_recommended.slice(0, 40));
              if (d.provider_referrals)   parts.push('Refs: ' + d.provider_referrals.slice(0, 40));
              detail = stCfgAP[0] + ' · ' + prCfgAP[0] + ' priority' +
                (d.due_date ? ' · Due ' + fmtDate(d.due_date) : '') +
                (parts.length ? ' — ' + parts.join(' · ') : '');
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
                (detail ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#e8e6f8;margin-top:3px;line-height:1.55">' + detail + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('')
        : '<p style="color:#dddaee77;font-style:italic;padding:20px 0">No timeline events yet.</p>';

      body.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e8b84b22;margin-bottom:22px">' +
          statBox('Sessions',          stats.totalSessions     || 0) +
          statBox('Completed',         stats.completedSessions || 0) +
          statBox('Total Paid',        '$' + (stats.totalPaid  || 0).toFixed(2)) +
          statBox('Pending Follow-ups', stats.pendingFollowUps || 0) +
        '</div>' +

        '<div style="margin-bottom:20px">' +
          '<button onclick="crmToggleAddEvent()" id="crmAddEvtToggle" ' +
            'style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;' +
            'background:#e8b84b14;border:1px solid #e8b84b55;color:#e8b84b;padding:7px 18px;cursor:pointer">+ Add Timeline Event</button>' +

          '<div id="crmAddEvtForm" style="display:none;margin-top:14px;background:#0e0b1f;border:1px solid #e8b84b44;padding:20px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
              '<div>' +
                formLabel('Event Type') +
                '<select id="crmEvtType" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                  '<option value="note">Note</option>' +
                  '<option value="follow_up">Follow-up</option>' +
                  '<option value="intake">Intake</option>' +
                  '<option value="manual_event">Manual Event</option>' +
                '</select>' +
              '</div>' +
              '<div>' +
                formLabel('Date') +
                '<input id="crmEvtDate" type="date" class="appt-input" value="' + todayISO() + '" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
              '</div>' +
              '<div style="grid-column:span 2">' +
                formLabel('Title / Notes') +
                '<textarea id="crmEvtContent" class="modal-notes" placeholder="Describe what happened…" ' +
                  'style="min-height:72px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
              '</div>' +
            '</div>' +
            '<div id="crmEvtError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;min-height:18px;margin-bottom:8px"></div>' +
            '<div style="display:flex;gap:10px">' +
              '<button id="crmEvtSaveBtn" class="action-btn approve" onclick="crmSaveTimelineEvent()" style="padding:8px 24px">Save Event</button>' +
              '<button class="action-btn" onclick="crmToggleAddEvent()">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div>' + eventsHtml + '</div>';

    } catch (e) {
      body.innerHTML = errorHtml('Failed to load timeline: ' + e.message);
    }
  }

  window.crmToggleAddEvent = function () {
    var form = document.getElementById('crmAddEvtForm');
    var btn  = document.getElementById('crmAddEvtToggle');
    if (!form) return;
    var open = form.style.display !== 'none';
    form.style.display = open ? 'none' : 'block';
    if (btn) btn.textContent = open ? '+ Add Timeline Event' : '✕ Cancel';
    if (!open) {
      var contentEl = document.getElementById('crmEvtContent');
      var errEl     = document.getElementById('crmEvtError');
      if (contentEl) contentEl.value = '';
      if (errEl)     errEl.textContent = '';
      var dateEl = document.getElementById('crmEvtDate');
      if (dateEl) dateEl.value = todayISO();
      setTimeout(function() { if (contentEl) contentEl.focus(); }, 50);
    }
  };

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

    var content = '[' + date + '] ' + rawText;
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';
    errEl.textContent   = '';

    try {
      await api('/session-notes', {
        method: 'POST',
        body:   JSON.stringify({ client_id: id, note_type: noteType, content: content }),
      });
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
    return '<div style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:15px;padding:20px;line-height:1.6">' + msg + '</div>';
  }

  function formLabel(txt) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'text-transform:uppercase;color:#e8b84baa;margin-bottom:5px">' + txt + '</div>';
  }

  function recFormLabel(txt) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'text-transform:uppercase;color:#e8b84baa;margin-bottom:5px">' + txt + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMENDATION FORM MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenRecForm = async function (clientId, recId) {
    _recEditId = recId || null;
    var modal  = document.getElementById('crmRecModal');
    var err    = document.getElementById('crmRecError');
    if (!modal) return;
    err.textContent = '';

    document.getElementById('crmRecProductName').value      = '';
    document.getElementById('crmRecCategory').value         = 'other';
    document.getElementById('crmRecReason').value           = '';
    document.getElementById('crmRecPriority').value         = 'medium';
    document.getElementById('crmRecPractNotes').value       = '';
    document.getElementById('crmRecPurchased').value        = 'unknown';
    document.getElementById('crmRecClientOutcome').value    = '';
    document.getElementById('crmRecDate').value             = todayISO();
    document.getElementById('crmRecClientId').value         = clientId;
    document.getElementById('crmRecModalTitle').textContent = recId ? 'Edit Recommendation' : 'Add Recommendation';

    if (recId) {
      try {
        var d = await api('/recommendations?id=' + recId);
        var r = d.recommendation;
        document.getElementById('crmRecProductName').value   = r.product_name    || '';
        document.getElementById('crmRecCategory').value      = r.category        || 'other';
        document.getElementById('crmRecReason').value        = r.reason          || '';
        document.getElementById('crmRecPriority').value      = r.priority        || 'medium';
        document.getElementById('crmRecPractNotes').value    = r.practitioner_notes || '';
        document.getElementById('crmRecPurchased').value     = r.purchased       || 'unknown';
        document.getElementById('crmRecClientOutcome').value = r.client_outcome  || '';
        document.getElementById('crmRecDate').value          = r.recommended_at  || todayISO();
      } catch (_) {}
    }
    modal.classList.add('open');
    document.getElementById('crmRecProductName').focus();
  };

  window.crmCloseRecModal = function (e) {
    if (e && e.target !== document.getElementById('crmRecModal')) return;
    document.getElementById('crmRecModal').classList.remove('open');
  };

  window.crmSaveRec = async function () {
    var clientId = document.getElementById('crmRecClientId').value;
    var name     = document.getElementById('crmRecProductName').value.trim();
    var errEl    = document.getElementById('crmRecError');
    var btn      = document.getElementById('crmRecSaveBtn');
    if (!name) { errEl.textContent = 'Product name is required.'; return; }
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Saving…';

    var payload = {
      client_id:          clientId,
      product_name:       name,
      category:           document.getElementById('crmRecCategory').value      || 'other',
      reason:             document.getElementById('crmRecReason').value.trim() || null,
      priority:           document.getElementById('crmRecPriority').value      || 'medium',
      practitioner_notes: document.getElementById('crmRecPractNotes').value.trim() || null,
      purchased:          document.getElementById('crmRecPurchased').value     || 'unknown',
      client_outcome:     document.getElementById('crmRecClientOutcome').value.trim() || null,
      recommended_at:     document.getElementById('crmRecDate').value          || todayISO(),
    };
    try {
      if (_recEditId) {
        await api('/recommendations?id=' + _recEditId, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/recommendations', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('crmRecModal').classList.remove('open');
      if (_profileId) await window.crmOpenProfile(_profileId);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Save';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REFERRAL FORM MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenRefForm = async function (clientId, refId) {
    _refEditId = refId || null;
    var modal  = document.getElementById('crmRefModal');
    var err    = document.getElementById('crmRefError');
    if (!modal) return;
    err.textContent = '';

    document.getElementById('crmRefProviderName').value  = '';
    document.getElementById('crmRefProviderType').value  = 'other';
    document.getElementById('crmRefContactInfo').value   = '';
    document.getElementById('crmRefReason').value        = '';
    document.getElementById('crmRefUrgency').value       = 'routine';
    document.getElementById('crmRefDate').value          = todayISO();
    document.getElementById('crmRefFollowed').value      = 'unknown';
    document.getElementById('crmRefOutcome').value       = '';
    document.getElementById('crmRefClientId').value      = clientId;
    document.getElementById('crmRefModalTitle').textContent = refId ? 'Edit Referral' : 'Add Referral';

    if (refId) {
      try {
        var d = await api('/referrals?id=' + refId);
        var r = d.referral;
        document.getElementById('crmRefProviderName').value = r.provider_name    || '';
        document.getElementById('crmRefProviderType').value = r.provider_type    || 'other';
        document.getElementById('crmRefContactInfo').value  = r.contact_info     || '';
        document.getElementById('crmRefReason').value       = r.reason           || '';
        document.getElementById('crmRefUrgency').value      = r.urgency          || 'routine';
        document.getElementById('crmRefDate').value         = r.referred_at      || todayISO();
        document.getElementById('crmRefFollowed').value     = r.followed_through || 'unknown';
        document.getElementById('crmRefOutcome').value      = r.outcome_notes    || '';
      } catch (_) {}
    }
    modal.classList.add('open');
    document.getElementById('crmRefProviderName').focus();
  };

  window.crmCloseRefModal = function (e) {
    if (e && e.target !== document.getElementById('crmRefModal')) return;
    document.getElementById('crmRefModal').classList.remove('open');
  };

  window.crmSaveRef = async function () {
    var clientId = document.getElementById('crmRefClientId').value;
    var name     = document.getElementById('crmRefProviderName').value.trim();
    var type     = document.getElementById('crmRefProviderType').value;
    var errEl    = document.getElementById('crmRefError');
    var btn      = document.getElementById('crmRefSaveBtn');
    if (!name) { errEl.textContent = 'Provider name is required.'; return; }
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Saving…';

    var payload = {
      client_id:        clientId,
      provider_name:    name,
      provider_type:    type || 'other',
      contact_info:     document.getElementById('crmRefContactInfo').value.trim() || null,
      reason:           document.getElementById('crmRefReason').value.trim()      || null,
      urgency:          document.getElementById('crmRefUrgency').value            || 'routine',
      referred_at:      document.getElementById('crmRefDate').value               || todayISO(),
      followed_through: document.getElementById('crmRefFollowed').value           || 'unknown',
      outcome_notes:    document.getElementById('crmRefOutcome').value.trim()     || null,
    };
    try {
      if (_refEditId) {
        await api('/referrals?id=' + _refEditId, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/referrals', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('crmRefModal').classList.remove('open');
      if (_profileId) await window.crmOpenProfile(_profileId);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Save';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION PLAN FORM MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.crmOpenApForm = async function (clientId, planId) {
    _apEditId = planId || null;
    var modal = document.getElementById('crmApModal');
    var err   = document.getElementById('crmApError');
    if (!modal) return;
    err.textContent = '';

    document.getElementById('crmApClientId').value   = clientId;
    document.getElementById('crmApSteps').value      = '';
    document.getElementById('crmApProducts').value   = '';
    document.getElementById('crmApRefs').value        = '';
    document.getElementById('crmApEnvAct').value     = '';
    document.getElementById('crmApAftercare').value  = '';
    document.getElementById('crmApPriority').value   = 'medium';
    document.getElementById('crmApDueDate').value    = '';
    document.getElementById('crmApStatus').value     = 'active';
    document.getElementById('crmApModalTitle').textContent = planId ? 'Edit Action Plan' : 'New Action Plan';

    if (planId) {
      try {
        var d = await api('/action-plans?id=' + planId);
        var p = d.action_plan;
        document.getElementById('crmApSteps').value     = p.immediate_steps       || '';
        document.getElementById('crmApProducts').value  = p.products_recommended  || '';
        document.getElementById('crmApRefs').value       = p.provider_referrals    || '';
        document.getElementById('crmApEnvAct').value    = p.environmental_actions || '';
        document.getElementById('crmApAftercare').value = p.aftercare_tasks       || '';
        document.getElementById('crmApPriority').value  = p.priority              || 'medium';
        document.getElementById('crmApDueDate').value   = p.due_date              || '';
        document.getElementById('crmApStatus').value    = p.status                || 'active';
      } catch (_) {}
    }
    modal.classList.add('open');
    document.getElementById('crmApSteps').focus();
  };

  window.crmCloseApModal = function (e) {
    if (e && e.target !== document.getElementById('crmApModal')) return;
    document.getElementById('crmApModal').classList.remove('open');
  };

  window.crmSaveAp = async function () {
    var clientId = document.getElementById('crmApClientId').value;
    var errEl    = document.getElementById('crmApError');
    var btn      = document.getElementById('crmApSaveBtn');

    var steps = document.getElementById('crmApSteps').value.trim();
    var prods = document.getElementById('crmApProducts').value.trim();
    if (!steps && !prods) { errEl.textContent = 'Add at least one field.'; return; }
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Saving…';

    var payload = {
      client_id:             clientId,
      immediate_steps:       steps || null,
      products_recommended:  prods || null,
      provider_referrals:    document.getElementById('crmApRefs').value.trim()      || null,
      environmental_actions: document.getElementById('crmApEnvAct').value.trim()    || null,
      aftercare_tasks:       document.getElementById('crmApAftercare').value.trim() || null,
      priority:              document.getElementById('crmApPriority').value         || 'medium',
      due_date:              document.getElementById('crmApDueDate').value          || null,
      status:                document.getElementById('crmApStatus').value           || 'active',
    };
    try {
      if (_apEditId) {
        await api('/action-plans?id=' + _apEditId, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/action-plans', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('crmApModal').classList.remove('open');
      if (_profileId) await window.crmOpenProfile(_profileId);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Save';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INJECT ALL MODALS
  // ═══════════════════════════════════════════════════════════════════════════
  function injectRecRefModals() {
    // ── Recommendation modal ────────────────────────────────────────────────
    if (!document.getElementById('crmRecModal')) {
      var el = document.createElement('div');
      el.id        = 'crmRecModal';
      el.className = 'modal-overlay';
      el.onclick   = window.crmCloseRecModal;
      el.innerHTML =
        '<div class="modal" style="max-width:560px" onclick="event.stopPropagation()">' +
          '<button class="modal-close" onclick="crmCloseRecModal()">✕</button>' +
          '<h2 id="crmRecModalTitle">Add Recommendation</h2>' +
          '<div class="modal-sub">Product, supplement, or service for this client</div>' +
          '<input type="hidden" id="crmRecClientId">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Product / Item Name *') +
              '<input id="crmRecProductName" class="appt-input" placeholder="e.g. Black Tourmaline" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Category') +
              '<select id="crmRecCategory" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="supplement">Supplement</option><option value="crystal">Crystal</option>' +
                '<option value="essential_oil">Essential Oil</option><option value="book">Book</option>' +
                '<option value="course">Course</option><option value="device">Device</option>' +
                '<option value="service">Service</option><option value="other" selected>Other</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              recFormLabel('Priority') +
              '<select id="crmRecPriority" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              recFormLabel('Date Recommended') +
              '<input id="crmRecDate" type="date" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
            '</div>' +
            '<div>' +
              recFormLabel('Client Purchased?') +
              '<select id="crmRecPurchased" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="unknown" selected>Unknown</option><option value="yes">Yes</option><option value="no">No</option>' +
              '</select>' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Reason Recommended') +
              '<textarea id="crmRecReason" class="modal-notes" placeholder="e.g. Grounding and energetic boundary work…" style="min-height:64px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Practitioner Notes') +
              '<textarea id="crmRecPractNotes" class="modal-notes" placeholder="Internal notes…" style="min-height:48px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Client-Reported Outcome') +
              '<input id="crmRecClientOutcome" class="appt-input" placeholder="e.g. Reports feeling more grounded…" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
          '</div>' +
          '<div id="crmRecError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;min-height:16px;margin-top:12px"></div>' +
          '<div style="display:flex;gap:10px;margin-top:12px">' +
            '<button id="crmRecSaveBtn" class="action-btn approve" onclick="crmSaveRec()" style="padding:8px 24px">Save</button>' +
            '<button class="action-btn" onclick="crmCloseRecModal()">Cancel</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el);
    }

    // ── Referral modal ──────────────────────────────────────────────────────
    if (!document.getElementById('crmRefModal')) {
      var el2 = document.createElement('div');
      el2.id        = 'crmRefModal';
      el2.className = 'modal-overlay';
      el2.onclick   = window.crmCloseRefModal;
      el2.innerHTML =
        '<div class="modal" style="max-width:560px" onclick="event.stopPropagation()">' +
          '<button class="modal-close" onclick="crmCloseRefModal()">✕</button>' +
          '<h2 id="crmRefModalTitle">Add Referral</h2>' +
          '<div class="modal-sub">Refer this client to a provider</div>' +
          '<input type="hidden" id="crmRefClientId">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Provider Name *') +
              '<input id="crmRefProviderName" class="appt-input" placeholder="e.g. Dr. Smith – Neurology" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Provider Type') +
              '<select id="crmRefProviderType" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="pcp">PCP</option><option value="therapist">Therapist</option>' +
                '<option value="psychiatrist">Psychiatrist</option><option value="nutritionist">Nutritionist</option>' +
                '<option value="functional_medicine">Functional Medicine</option><option value="neurologist">Neurologist</option>' +
                '<option value="physical_therapist">Physical Therapist</option><option value="energy_practitioner">Energy Practitioner</option>' +
                '<option value="other" selected>Other</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              recFormLabel('Urgency') +
              '<select id="crmRefUrgency" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="urgent">Urgent</option><option value="soon">Soon</option><option value="routine" selected>Routine</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              recFormLabel('Referral Date') +
              '<input id="crmRefDate" type="date" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
            '</div>' +
            '<div>' +
              recFormLabel('Client Followed Through?') +
              '<select id="crmRefFollowed" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="unknown" selected>Unknown / Pending</option><option value="yes">Yes</option><option value="no">No</option>' +
              '</select>' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Contact Information') +
              '<input id="crmRefContactInfo" class="appt-input" placeholder="Phone, address, website…" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Reason for Referral') +
              '<textarea id="crmRefReason" class="modal-notes" placeholder="e.g. Chronic tinnitus and sensory sensitivity…" style="min-height:64px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
            '</div>' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Outcome Notes') +
              '<input id="crmRefOutcome" class="appt-input" placeholder="e.g. Appointment scheduled for July…" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
          '</div>' +
          '<div id="crmRefError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;min-height:16px;margin-top:12px"></div>' +
          '<div style="display:flex;gap:10px;margin-top:12px">' +
            '<button id="crmRefSaveBtn" class="action-btn approve" onclick="crmSaveRef()" style="padding:8px 24px">Save</button>' +
            '<button class="action-btn" onclick="crmCloseRefModal()">Cancel</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el2);
    }

    // ── Action Plan modal ───────────────────────────────────────────────────
    if (!document.getElementById('crmApModal')) {
      var el3 = document.createElement('div');
      el3.id        = 'crmApModal';
      el3.className = 'modal-overlay';
      el3.onclick   = window.crmCloseApModal;
      el3.innerHTML =
        '<div class="modal" style="max-width:600px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">' +
          '<button class="modal-close" onclick="crmCloseApModal()">✕</button>' +
          '<h2 id="crmApModalTitle">New Action Plan</h2>' +
          '<div class="modal-sub">Next steps, products, and aftercare for this client</div>' +
          '<input type="hidden" id="crmApClientId">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">' +
            '<div style="grid-column:span 2">' +
              recFormLabel('Immediate Next Steps') +
              '<textarea id="crmApSteps" class="modal-notes" placeholder="What should the client do right away?" style="min-height:70px;margin-bottom:0;border-color:#e8b84b44"></textarea>' +
            '</div>' +
            '<div>' +
              recFormLabel('Products Recommended') +
              '<input id="crmApProducts" class="appt-input" placeholder="e.g. Shungite, B12, Ashwagandha" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Provider Referrals') +
              '<input id="crmApRefs" class="appt-input" placeholder="e.g. Nutritionist, PCP" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Environmental Actions') +
              '<input id="crmApEnvAct" class="appt-input" placeholder="e.g. Reduce screen time, salt bath" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Aftercare Tasks') +
              '<input id="crmApAftercare" class="appt-input" placeholder="e.g. Follow-up in 3 weeks" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
            '<div>' +
              recFormLabel('Priority') +
              '<select id="crmApPriority" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              recFormLabel('Due Date') +
              '<input id="crmApDueDate" type="date" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
            '</div>' +
            '<div>' +
              recFormLabel('Status') +
              '<select id="crmApStatus" class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                '<option value="draft">Draft</option><option value="active" selected>Active</option><option value="completed">Completed</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div id="crmApError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;min-height:16px;margin-top:12px"></div>' +
          '<div style="display:flex;gap:10px;margin-top:12px">' +
            '<button id="crmApSaveBtn" class="action-btn approve" onclick="crmSaveAp()" style="padding:8px 24px">Save</button>' +
            '<button class="action-btn" onclick="crmCloseApModal()">Cancel</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el3);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI ATTENTION FLAGS
  // ═══════════════════════════════════════════════════════════════════════════

  var SEVERITY_CFG = {
    urgent:  { bg: '#1a0808', border: '#ee4444', accent: '#ee7070', icon: '⊘' },
    warning: { bg: '#120e00', border: '#e8b84b', accent: '#f8c84b', icon: '⚠' },
    info:    { bg: '#060c1a', border: '#66b5f8', accent: '#88ccff', icon: '○' },
    success: { bg: '#04120a', border: '#22c98a', accent: '#44e0aa', icon: '✓' }
  };

  function _attentionFlagsLoadingHtml() {
    return '<div style="background:#08060f;border:1px solid #e8b84b33;border-left:3px solid #e8b84b55;' +
      'padding:22px 28px;margin-bottom:32px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="color:#e8b84b;font-size:15px">⚑</span>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:#e8b84b;font-weight:700">Attention Flags</div>' +
        '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#e8b84b55;margin-left:auto">Evaluating…</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        [1,2,3].map(function() {
          return '<div style="height:28px;width:120px;background:#e8b84b0d;border:1px solid #e8b84b18;border-radius:2px"></div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function _renderAttentionFlagsCard(data, clientId) {
    var flags = data.flags || [];

    var badgesHtml = flags.map(function(f) {
      var cfg  = SEVERITY_CFG[f.severity] || SEVERITY_CFG.info;
      return '<div style="background:' + cfg.bg + ';border:1px solid ' + cfg.border + '66;' +
        'padding:14px 16px;border-left:3px solid ' + cfg.border + ';min-width:0">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">' +
          '<span style="color:' + cfg.accent + ';font-size:13px;line-height:1;flex-shrink:0">' + cfg.icon + '</span>' +
          '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.22em;text-transform:uppercase;' +
            'color:' + cfg.accent + ';font-weight:700">' + f.label + '</span>' +
          (f.source ? '<span style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.18em;text-transform:uppercase;' +
            'color:' + cfg.accent + '66;margin-left:auto;flex-shrink:0">' + f.source + '</span>' : '') +
        '</div>' +
        (f.reason ? '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc;line-height:1.5;margin-bottom:' +
          (f.suggested_action ? '5px' : '0') + '">' + f.reason + '</div>' : '') +
        (f.suggested_action ? '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.15em;text-transform:uppercase;' +
          'color:' + cfg.accent + '99;line-height:1.4">' + f.suggested_action + '</div>' : '') +
      '</div>';
    }).join('');

    return '<div style="background:#08060f;border:1px solid #e8b84b33;border-left:3px solid #e8b84b;' +
      'padding:22px 28px;margin-bottom:32px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="color:#e8b84b;font-size:16px;line-height:1">⚑</span>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:#e8b84b;font-weight:700">Attention Flags</div>' +
        (data.source === 'deterministic'
          ? '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#e8b84b55;font-style:italic;margin-left:4px">— computed</span>'
          : '') +
        '<button onclick="crmRegenerateAttentionFlags(\'' + esc(clientId) + '\')" ' +
          'style="margin-left:auto;font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.22em;text-transform:uppercase;' +
          'color:#e8b84b;border:1px solid #e8b84b44;padding:5px 12px;background:transparent;cursor:pointer" ' +
          'onmouseover="this.style.background=\'#e8b84b14\'" onmouseout="this.style.background=\'transparent\'">↺ Refresh</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">' +
        badgesHtml +
      '</div>' +
    '</div>';
  }

  async function _loadAttentionFlags(clientId, payload) {
    var wrap = document.getElementById('crmAttentionFlagsWrap');
    if (!wrap) return;
    try {
      var res  = await fetch('/.netlify/functions/client-attention-flags', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token() },
        body:    JSON.stringify(payload)
      });
      var json = await res.json();
      if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
      wrap.innerHTML = _renderAttentionFlagsCard(json, clientId);
    } catch (e) {
      wrap.innerHTML =
        '<div style="background:#08060f;border:1px solid #e8b84b22;border-left:3px solid #ee707055;' +
        'padding:18px 24px;margin-bottom:32px;display:flex;align-items:center;gap:14px">' +
          '<span style="color:#ee7070;font-size:16px">⚑</span>' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc;flex:1">' +
            'Attention Flags: ' + e.message +
          '</div>' +
          '<button onclick="crmRegenerateAttentionFlags(\'' + esc(clientId) + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;' +
            'color:#e8b84b;border:1px solid #e8b84b44;padding:5px 12px;background:transparent;cursor:pointer;flex-shrink:0">↺ Retry</button>' +
        '</div>';
    }
  }

  window.crmRegenerateAttentionFlags = function(clientId) {
    var wrap = document.getElementById('crmAttentionFlagsWrap');
    if (!wrap) return;
    wrap.innerHTML = _attentionFlagsLoadingHtml();
    _loadAttentionFlags(
      clientId,
      (_prepBriefClientId === clientId && _prepBriefPayload) ? _prepBriefPayload : { clientName: clientId }
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // AI PRACTITIONER TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════

  var TIMELINE_CAT_CFG = {
    intake:         { color: '#f8a84b', icon: '📋' },
    session:        { color: '#9b7fe8', icon: '✦'  },
    recommendation: { color: '#22c98a', icon: '🌿' },
    followup:       { color: '#66b5f8', icon: '💌' },
    document:       { color: '#dddaeecc', icon: '📄' },
    environment:    { color: '#b09ef8', icon: '◎'  },
    note:           { color: '#e8b84b', icon: '📝' },
    referral:       { color: '#b09ef8', icon: '🔗' },
    plan:           { color: '#e8b84b', icon: '📌' }
  };

  var IMPORTANCE_CFG = {
    high:   { dot: '#ee7070', label: 'High' },
    medium: { dot: '#f8a84b', label: 'Med'  },
    low:    { dot: '#6662aa', label: 'Low'  }
  };

  function _timelineLoadingHtml() {
    return '<div style="background:#080614;border:1px solid #9b7fe833;border-left:3px solid #9b7fe855;' +
      'padding:22px 28px;margin-bottom:32px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">' +
        '<span style="color:#9b7fe8;font-size:15px">◈</span>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:#9b7fe8;font-weight:700">Practitioner Timeline</div>' +
        '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:#9b7fe855;margin-left:auto">Building…</span>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        [1,2,3,4].map(function() {
          return '<div style="display:flex;gap:14px;align-items:flex-start">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:#9b7fe812;border:1px solid #9b7fe820;flex-shrink:0"></div>' +
            '<div style="flex:1">' +
              '<div style="height:10px;width:90px;background:#9b7fe812;border-radius:2px;margin-bottom:6px"></div>' +
              '<div style="height:14px;width:200px;background:#9b7fe80a;border-radius:2px"></div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function _renderPractitionerTimeline(data, clientId) {
    var items = data.items || [];

    if (!items.length) {
      return '<div style="background:#080614;border:1px solid #9b7fe833;border-left:3px solid #9b7fe8;' +
        'padding:22px 28px;margin-bottom:32px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
          '<span style="color:#9b7fe8;font-size:15px">◈</span>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:#9b7fe8;font-weight:700">Practitioner Timeline</div>' +
        '</div>' +
        '<p style="font-family:\'EB Garamond\',serif;font-size:17px;color:#dddaee55;font-style:italic">No timeline events found in the available record.</p>' +
      '</div>';
    }

    var eventsHtml = items.map(function(item, idx) {
      var cat  = TIMELINE_CAT_CFG[item.category]  || { color: '#aaaaaa', icon: '·' };
      var imp  = IMPORTANCE_CFG[item.importance]   || IMPORTANCE_CFG.low;
      var isLast = idx === items.length - 1;
      return '<div style="display:flex;gap:14px;align-items:flex-start;' +
        'padding-bottom:' + (isLast ? '0' : '18px') + ';' +
        'border-bottom:' + (isLast ? 'none' : '1px solid #ffffff08') + '">' +

        // Left column: connector + icon
        '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">' +
          '<div style="width:34px;height:34px;border-radius:50%;background:' + cat.color + '1a;' +
            'border:1px solid ' + cat.color + '55;display:flex;align-items:center;justify-content:center;' +
            'font-size:13px;line-height:1">' + cat.icon + '</div>' +
          (!isLast ? '<div style="width:1px;flex:1;background:#ffffff0d;margin-top:6px;min-height:14px"></div>' : '') +
        '</div>' +

        // Right column: content
        '<div style="flex:1;min-width:0;padding-top:4px">' +
          '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:5px">' +
            '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.28em;text-transform:uppercase;' +
              'color:' + cat.color + ';font-weight:700">' + cat.icon + ' ' + (item.category || 'event') + '</span>' +
            '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee77">' +
              (item.date === 'undated' ? 'Undated Record' : item.date) + '</span>' +
            '<span style="width:7px;height:7px;border-radius:50%;background:' + imp.dot + ';' +
              'display:inline-block;flex-shrink:0;align-self:center"></span>' +
          '</div>' +
          '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.06em;color:#fff;' +
            'font-weight:600;margin-bottom:5px">' + (item.title || '') + '</div>' +
          (item.summary
            ? '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaeecc;line-height:1.55">' + item.summary + '</div>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div style="background:#080614;border:1px solid #9b7fe833;border-left:3px solid #9b7fe8;' +
      'padding:22px 28px;margin-bottom:32px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">' +
        '<span style="color:#9b7fe8;font-size:15px;line-height:1">◈</span>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.38em;text-transform:uppercase;color:#9b7fe8;font-weight:700">Practitioner Timeline</div>' +
        '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#9b7fe888;font-style:italic;margin-left:4px">' +
          '— ' + items.length + ' event' + (items.length !== 1 ? 's' : '') +
          (data.source === 'deterministic' ? ', computed' : ', AI-enhanced') +
        '</span>' +
        '<button onclick="crmRegeneratePractitionerTimeline(\'' + esc(clientId) + '\')" ' +
          'style="margin-left:auto;font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.22em;text-transform:uppercase;' +
          'color:#9b7fe8;border:1px solid #9b7fe844;padding:5px 12px;background:transparent;cursor:pointer" ' +
          'onmouseover="this.style.background=\'#9b7fe81a\'" onmouseout="this.style.background=\'transparent\'">↺ Regenerate</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:0">' + eventsHtml + '</div>' +
    '</div>';
  }

  async function _loadPractitionerTimeline(clientId, payload) {
    var wrap = document.getElementById('crmPractitionerTimelineWrap');
    if (!wrap) return;
    try {
      var res  = await fetch('/.netlify/functions/client-practitioner-timeline', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token() },
        body:    JSON.stringify(payload)
      });
      var json = await res.json();
      if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
      wrap.innerHTML = _renderPractitionerTimeline(json, clientId);
    } catch (e) {
      wrap.innerHTML =
        '<div style="background:#080614;border:1px solid #9b7fe822;border-left:3px solid #ee707055;' +
        'padding:18px 24px;margin-bottom:32px;display:flex;align-items:center;gap:14px">' +
          '<span style="color:#9b7fe8;font-size:15px">◈</span>' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#dddaeecc;flex:1">' +
            'Practitioner Timeline: ' + e.message +
          '</div>' +
          '<button onclick="crmRegeneratePractitionerTimeline(\'' + esc(clientId) + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;' +
            'color:#9b7fe8;border:1px solid #9b7fe844;padding:5px 12px;background:transparent;cursor:pointer;flex-shrink:0">↺ Retry</button>' +
        '</div>';
    }
  }

  window.crmRegeneratePractitionerTimeline = function(clientId) {
    var wrap = document.getElementById('crmPractitionerTimelineWrap');
    if (!wrap) return;
    wrap.innerHTML = _timelineLoadingHtml();
    _loadPractitionerTimeline(
      clientId,
      (_prepBriefClientId === clientId && _prepBriefPayload) ? _prepBriefPayload : { clientName: clientId }
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION PREP BRIEF
  // ═══════════════════════════════════════════════════════════════════════════

  function _prepBriefLoadingHtml() {
    return '<div style="background:#0d0920;border:2px solid #9b7fe844;border-left:4px solid #9b7fe8;' +
      'padding:28px 32px;margin-bottom:40px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        '<span style="color:#9b7fe8;font-size:18px;line-height:1">✦</span>' +
        '<div style="font-family:\'Cinzel\',serif;font-size:14px;letter-spacing:.35em;text-transform:uppercase;color:#9b7fe8;font-weight:700">Session Prep Brief</div>' +
        '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;' +
          'color:#9b7fe866;margin-left:auto;animation:pulse 1.4s infinite alternate">Generating…</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        [1,2,3,4,5,6].map(function() {
          return '<div style="height:54px;background:#9b7fe812;border:1px solid #9b7fe820;border-radius:1px"></div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function _renderPrepBriefCard(brief, clientId) {
    function bulletList(items, color) {
      if (!items || !items.length) {
        return '<span style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaee44;font-style:italic">None on record</span>';
      }
      return items.map(function(item) {
        return '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">' +
          '<span style="color:' + color + ';font-size:9px;flex-shrink:0;line-height:1.9">▸</span>' +
          '<span style="font-family:\'EB Garamond\',serif;font-size:17px;color:#f0ecff;line-height:1.5">' + item + '</span>' +
        '</div>';
      }).join('');
    }

    function prose(text, color) {
      if (!text) return '<span style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaee44;font-style:italic">None on record</span>';
      return '<span style="font-family:\'EB Garamond\',serif;font-size:17px;color:#f0ecff;line-height:1.55">' + text + '</span>';
    }

    function cell(icon, label, accentColor, content) {
      return '<div style="background:#07051a;border:1px solid ' + accentColor + '28;' +
        'border-top:2px solid ' + accentColor + ';padding:18px 20px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.38em;text-transform:uppercase;' +
          'color:' + accentColor + ';margin-bottom:12px;display:flex;align-items:center;gap:7px">' +
          '<span style="font-size:12px">' + icon + '</span>' + label +
        '</div>' +
        content +
      '</div>';
    }

    var grid =
      cell('◈', 'Last Session',         '#9b7fe8', prose(brief.lastSessionDate, '#9b7fe8')) +
      cell('◉', 'Primary Concerns',      '#f8a84b', bulletList(brief.primaryConcerns,    '#f8a84b')) +
      cell('🌿','Outstanding Recs',      '#22c98a', bulletList(brief.outstandingRecs,     '#22c98a')) +
      cell('💌','Follow-up Items',       '#66b5f8', bulletList(brief.followUpItems,       '#66b5f8')) +
      cell('◎', 'Environmental Status',  '#b09ef8', prose(brief.environmentalStatus,      '#b09ef8')) +
      cell('✦', 'Discussion Topics',     '#e8b84b', bulletList(brief.discussionTopics,    '#e8b84b'));

    return '<div style="background:#0d0920;border:2px solid #9b7fe844;border-left:4px solid #9b7fe8;' +
      'padding:28px 32px;margin-bottom:40px">' +

      '<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:22px">' +
        '<div style="flex:1">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:14px;letter-spacing:.38em;text-transform:uppercase;' +
            'color:#9b7fe8;font-weight:700;display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px;line-height:1">✦</span> Session Prep Brief' +
          '</div>' +
          '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#9b7fe877;margin-top:5px">' +
            'Generated from client record — not a clinical assessment' +
          '</div>' +
        '</div>' +
        '<button onclick="crmRegeneratePrepBrief(\'' + esc(clientId) + '\')" ' +
          'style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
          'color:#9b7fe8;border:1px solid #9b7fe855;padding:7px 16px;background:transparent;cursor:pointer;' +
          'flex-shrink:0;transition:all .2s" ' +
          'onmouseover="this.style.background=\'#9b7fe81a\'" onmouseout="this.style.background=\'transparent\'">' +
          '↺ Regenerate' +
        '</button>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + grid + '</div>' +

    '</div>';
  }

  async function _loadPrepBrief(clientId, payload) {
    var wrap = document.getElementById('crmPrepBriefWrap');
    if (!wrap) return;

    // Serve from cache if fresh (30 min TTL)
    var cached = _prepBriefCache[clientId];
    if (cached && (Date.now() - cached.ts) < PREP_BRIEF_TTL) {
      wrap.innerHTML = cached.html;
      return;
    }

    try {
      var res = await fetch('/.netlify/functions/session-prep-brief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token() },
        body:    JSON.stringify(payload)
      });

      var json = await res.json();
      if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));

      var renderedHtml = _renderPrepBriefCard(json.brief, clientId);
      _prepBriefCache[clientId] = { html: renderedHtml, ts: Date.now() };
      wrap.innerHTML = renderedHtml;
    } catch (e) {
      wrap.innerHTML =
        '<div style="background:#0d0920;border:2px solid #9b7fe844;border-left:4px solid #ee707088;' +
        'padding:20px 28px;margin-bottom:40px;display:flex;align-items:center;gap:16px">' +
          '<span style="color:#9b7fe8;font-size:18px">✦</span>' +
          '<div>' +
            '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;' +
              'color:#9b7fe8;margin-bottom:6px">Session Prep Brief</div>' +
            '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaeecc">' +
              'Could not generate brief: ' + e.message +
            '</div>' +
          '</div>' +
          '<button onclick="crmRegeneratePrepBrief(\'' + esc(clientId) + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;' +
            'color:#9b7fe8;border:1px solid #9b7fe855;padding:6px 14px;background:transparent;cursor:pointer;margin-left:auto">' +
            '↺ Retry' +
          '</button>' +
        '</div>';
    }
  }

  window.crmUpdateRecOutcome = async function(recId, outcomeStatus, clientId) {
    // Map outcome to purchased field
    var purchasedMap = { purchased: 'yes', helpful: 'yes', not_helpful: 'no', declined: 'no' };
    var body = {
      outcome_status: outcomeStatus,
      outcome_date:   new Date().toISOString().slice(0, 10),
    };
    if (purchasedMap[outcomeStatus]) body.purchased = purchasedMap[outcomeStatus];

    try {
      var res = await fetch('/.netlify/functions/recommendations?id=' + encodeURIComponent(recId), {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token() },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // Refresh the client profile to show updated rec
      var refreshId = clientId || _profileId;
      if (refreshId && window.crmOpenProfile) await window.crmOpenProfile(refreshId);
    } catch (e) {
      alert('Could not update recommendation: ' + e.message);
    }
  };

  window.crmRegeneratePrepBrief = function(clientId) {
    var wrap = document.getElementById('crmPrepBriefWrap');
    if (!wrap) return;
    delete _prepBriefCache[clientId];
    wrap.innerHTML = _prepBriefLoadingHtml();
    _loadPrepBrief(
      clientId,
      (_prepBriefClientId === clientId && _prepBriefPayload) ? _prepBriefPayload : { clientName: clientId }
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  (function () {
    var roster  = document.getElementById('clientRoster');
    var countEl = document.getElementById('clientCount');
    if (roster)  roster.innerHTML   = '';
    if (countEl) countEl.textContent = '';
  })();

  var _origShowTab = window.showTab;
  window.showTab = function (name) {
    if (_origShowTab) _origShowTab(name);
    if (name === 'clients') window.renderClients();
  };

  document.addEventListener('DOMContentLoaded', function () {
    injectRecRefModals();
    var active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-clients') window.renderClients();
  });

  if (document.readyState !== 'loading') {
    injectRecRefModals();
  }

})();
