// clients-module.js
// Full case file, recommendations, referrals, and action plans for each client.

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var _clients      = [];
  var _loaded       = false;
  var _searchTimer  = null;
  var _tlClientId   = null;
  var _profileId    = null;
  var _recEditId    = null;
  var _refEditId    = null;
  var _apEditId     = null;

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
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'color:' + pair[1] + ';background:' + pair[1] + '28;border:1px solid ' + pair[1] + '77;' +
      'padding:2px 10px;border-radius:2px;text-transform:uppercase;white-space:nowrap">' + pair[0] + '</span>';
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

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function complianceBadge(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;' +
      'text-transform:uppercase;color:' + color + ';background:' + color + '18;' +
      'border:1px solid ' + color + '55;padding:4px 12px;border-radius:2px;white-space:nowrap">' +
      label + '</span>';
  }

  function recStatChip(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;' +
      'text-transform:uppercase;color:' + color + ';padding:3px 8px;' +
      'border:1px solid ' + color + '44">' + label + '</span>';
  }

  function thCell(t) {
    return '<th style="text-align:left;color:#e8b84baa;font-family:\'Cinzel\',serif;' +
      'font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:8px;' +
      'padding-right:8px">' + t + '</th>';
  }

  function sectionHeader(title) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;' +
      'color:#e8b84baa;margin-bottom:10px;margin-top:4px">' + title + '</div>';
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
          '<button class="action-btn view" onclick="crmOpenProfile(\'' + esc(id) + '\')">📋 Case File</button>' +
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

      // ── Missing requirements ────────────────────────────────────────
      var missing = [];
      if (!waiverSigned)                    missing.push({ icon: '⚠', label: 'Waiver not on file',       hint: 'Add tag "waiver" once signed.' });
      if (!hasIntake)                       missing.push({ icon: '⚠', label: 'No intake form on file',    hint: 'Client has not submitted an intake/assessment.' });
      if (!hasPayment && sess.length)       missing.push({ icon: '○', label: 'No payment recorded',       hint: 'No payments found across all sessions.' });
      if (pendingAC === 0 && completedSess.length) missing.push({ icon: '○', label: 'No aftercare scheduled', hint: 'Mark a session Complete to auto-schedule aftercare.' });
      if (!hasNotes)                        missing.push({ icon: '○', label: 'No session notes yet',      hint: 'Open a session and add notes.' });

      var missingBox = missing.length
        ? '<div style="background:#ff70700d;border:1px solid #ff555533;padding:14px 16px;margin-bottom:20px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;' +
              'color:#ff8888;margin-bottom:10px">Needs Completion</div>' +
            missing.map(function(m) {
              return '<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:7px">' +
                '<span style="color:#ff8888;font-size:12px;flex-shrink:0">' + m.icon + '</span>' +
                '<div><div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;' +
                  'text-transform:uppercase;color:#ffaaaa">' + m.label + '</div>' +
                  '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee77;margin-top:2px">' + m.hint + '</div>' +
                '</div></div>';
            }).join('') +
          '</div>'
        : '<div style="background:#22c98a0d;border:1px solid #22c98a33;padding:10px 16px;margin-bottom:20px;' +
            'font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;color:#22c98a">' +
            '✓ All requirements complete' +
          '</div>';

      var waiverBadge = waiverSigned
        ? complianceBadge('✓ Waiver on File',   '#22c98a')
        : complianceBadge('⚠ Waiver Missing',   '#ff5555');
      var intakeBadge = hasIntake
        ? complianceBadge('✓ Intake Complete ' + (intakeDate ? '· ' + fmtDate(intakeDate) : ''), '#22c98a')
        : complianceBadge('⚠ Intake Missing',   '#f8a84b');

      // ── Intake summary ──────────────────────────────────────────────
      var intakeSummaryHtml = '';
      if (latestIntake) {
        var iFields = [];
        if (latestIntake.service_requested) iFields.push(['Service Requested', latestIntake.service_requested]);
        if (latestIntake.message)           iFields.push(['Message',           latestIntake.message]);
        if (latestIntake.agent_summary)     iFields.push(['Assessment Summary', latestIntake.agent_summary]);
        if (iFields.length) {
          intakeSummaryHtml =
            '<div style="background:#f8a84b0d;border:1px solid #f8a84b33;padding:14px 16px;margin-bottom:20px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;' +
                'color:#f8a84b;margin-bottom:10px">Intake / Assessment</div>' +
              iFields.map(function(f) {
                return '<div style="margin-bottom:8px">' +
                  '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;' +
                    'color:#e8b84baa;margin-bottom:3px">' + f[0] + '</div>' +
                  '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#e8e6f8;line-height:1.6">' + f[1] + '</div>' +
                '</div>';
              }).join('') +
            '</div>';
        }
      }

      var sessRows = sess.length
        ? sess.map(function(s) {
            return '<tr>' +
              '<td style="padding:6px 8px 6px 0;color:#dddaee;border-bottom:1px solid #e8b84b0e">' + fmtDate(s.session_date) + '</td>' +
              '<td style="padding:6px 8px;color:#e8b84b;border-bottom:1px solid #e8b84b0e">'        + (s.service || s.service_type || '—') + '</td>' +
              '<td style="padding:6px 8px;color:#22c98a;border-bottom:1px solid #e8b84b0e">'        + (s.status || '—') + '</td>' +
              '<td style="padding:6px 0 6px 8px;color:#f0ecff;border-bottom:1px solid #e8b84b0e">'  +
                (s.amount_due ? '$' + parseFloat(s.amount_due).toFixed(2) : '—') + '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="4" style="color:#dddaee66;font-style:italic;padding:14px 0">No sessions yet.</td></tr>';

      body.innerHTML =
        // ── Title ───────────────────────────────────────────────────
        '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.35em;text-transform:uppercase;' +
          'color:#e8b84b77;margin-bottom:20px">Full Case File</div>' +

        missingBox +

        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">' +
          waiverBadge + intakeBadge +
        '</div>' +

        // ── Core info grid ──────────────────────────────────────────
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">' +
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

        (tags.length
          ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">' + tags.map(tagChip).join('') + '</div>'
          : '') +

        // ── Stats bar (6-up) ────────────────────────────────────────
        '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:1px;background:#e8b84b22;margin-bottom:24px">' +
          statBox('Sessions',        sess.length) +
          statBox('Completed',       completedSess.length) +
          statBox('Total Paid',      '$' + parseFloat(totalPaid).toFixed(2)) +
          statBox('Follow-ups',      pendingAC) +
          statBox('Active Recs',     tlStats.activeRecs || 0) +
          statBox('Pending Refs',    tlStats.pendingReferrals || 0) +
        '</div>' +

        intakeSummaryHtml +

        // ── Sessions table ──────────────────────────────────────────
        sectionHeader('Sessions') +
        '<table style="width:100%;border-collapse:collapse;font-family:\'EB Garamond\',serif;font-size:14px;margin-bottom:28px">' +
          '<thead><tr>' + thCell('Date') + thCell('Service') + thCell('Status') + thCell('Amount') + '</tr></thead>' +
          '<tbody>' + sessRows + '</tbody>' +
        '</table>' +

        buildRecsSection(recs, id) +
        buildRefsSection(refs, id) +
        buildActionPlansSection(plans, id) +

        // ── Footer actions ──────────────────────────────────────────
        '<div style="margin-top:22px;border-top:1px solid #e8b84b22;padding-top:16px;display:flex;gap:10px;flex-wrap:wrap">' +
          '<button class="action-btn view" style="border-color:#e8b84b66;color:#e8b84b" ' +
            'onclick="crmCloseProfileModal();crmOpenEdit(\'' + esc(id) + '\')">✎ Edit Client Details</button>' +
          '<button class="action-btn view" style="border-color:#9b7fe866;color:#b09ef8" ' +
            'onclick="crmCloseProfileModal();crmOpenTimeline(\'' + esc(id) + '\')">⏱ Full Timeline</button>' +
        '</div>';
    } catch (e) {
      body.innerHTML = errorHtml('Failed to load case file: ' + e.message);
    }
  };

  // ── Recommendations section builder ──────────────────────────────────────
  function buildRecsSection(recs, clientId) {
    var active    = recs.filter(function(r) { return r.purchased === 'unknown'; }).length;
    var completed = recs.filter(function(r) { return r.purchased === 'yes'; }).length;
    var declined  = recs.filter(function(r) { return r.purchased === 'no'; }).length;

    var outstanding = recs.filter(function(r) { return r.purchased === 'unknown'; });
    var outstandingAlert = outstanding.length
      ? '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
          'color:#f8a84b;margin-bottom:10px">⚠ ' + outstanding.length + ' recommendation' +
          (outstanding.length > 1 ? 's' : '') + ' awaiting outcome</div>'
      : '';

    var recRows = recs.length
      ? recs.map(function(r) { return buildRecRow(r, clientId); }).join('')
      : '<div style="color:#dddaee55;font-family:\'EB Garamond\',serif;font-size:14px;' +
          'font-style:italic;padding:10px 0">No recommendations yet.</div>';

    return '<div style="margin-bottom:28px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84baa">' +
          'Recommendations & Products' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          recStatChip(recs.length + ' Total', '#dddaee99') +
          recStatChip(active    + ' Active',    '#f8a84b') +
          recStatChip(completed + ' Completed', '#22c98a') +
          (declined ? recStatChip(declined + ' Declined', '#f07070') : '') +
          '<button class="action-btn approve" style="padding:4px 14px;font-size:8px" ' +
            'onclick="crmOpenRecForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
        '</div>' +
      '</div>' +
      outstandingAlert +
      recRows +
    '</div>';
  }

  function buildRecRow(r, clientId) {
    var prCfg  = PRIORITY_CFG[r.priority]  || PRIORITY_CFG.medium;
    var puCfg  = PURCHASED_CFG[r.purchased] || PURCHASED_CFG.unknown;
    var catLbl = CAT_LABELS[r.category]    || 'Other';
    return '<div style="background:#0a0718;border:1px solid #e8b84b33;padding:12px 16px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.08em;color:#f0ecff;' +
            'font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
            r.product_name +
            complianceBadge(catLbl,   '#9b7fe8') +
            complianceBadge(prCfg[0], prCfg[1]) +
            complianceBadge(puCfg[0], puCfg[1]) +
          '</div>' +
          (r.reason ? '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#dddaeecc;line-height:1.5;margin-bottom:3px">' + r.reason + '</div>' : '') +
          (r.client_outcome ? '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#22c98acc;font-style:italic">Outcome: ' + r.client_outcome + '</div>' : '') +
          (r.practitioner_notes ? '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee77;font-style:italic">Notes: ' + r.practitioner_notes + '</div>' : '') +
          (r.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe855;margin-top:2px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#e8b84b55;margin-top:4px">' +
            fmtDate(r.recommended_at) +
          '</div>' +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b55;color:#e8b84b;padding:3px 10px;font-size:8px;flex-shrink:0" ' +
          'onclick="crmOpenRecForm(\'' + esc(clientId) + '\',\'' + esc(r.id) + '\')">Edit</button>' +
      '</div>' +
    '</div>';
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
      staleAlert = '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
        'color:#ff8888;margin-bottom:10px">⚠ ' + stale.length + ' referral' +
        (stale.length > 1 ? 's' : '') + ' older than 30 days — follow up needed</div>';
    }

    var refRows = refs.length
      ? refs.map(function(r) { return buildRefRow(r, clientId); }).join('')
      : '<div style="color:#dddaee55;font-family:\'EB Garamond\',serif;font-size:14px;' +
          'font-style:italic;padding:10px 0">No referrals yet.</div>';

    return '<div style="margin-bottom:28px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84baa">' +
          'Provider Referrals' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          recStatChip(refs.length + ' Total',    '#dddaee99') +
          recStatChip(pending     + ' Pending',   '#f8a84b') +
          recStatChip(completed   + ' Completed', '#22c98a') +
          '<button class="action-btn approve" style="padding:4px 14px;font-size:8px" ' +
            'onclick="crmOpenRefForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
        '</div>' +
      '</div>' +
      staleAlert +
      refRows +
    '</div>';
  }

  function buildRefRow(r, clientId) {
    var urgCfg = URGENCY_CFG[r.urgency]           || URGENCY_CFG.routine;
    var flwCfg = FOLLOWED_CFG[r.followed_through] || FOLLOWED_CFG.unknown;
    var ptLbl  = PTYPE_LABELS[r.provider_type]    || 'Other';
    return '<div style="background:#0a0718;border:1px solid #e8b84b33;padding:12px 16px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.08em;color:#f0ecff;' +
            'font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
            r.provider_name +
            complianceBadge(ptLbl,      '#9b7fe8') +
            complianceBadge(urgCfg[0],  urgCfg[1]) +
            complianceBadge(flwCfg[0],  flwCfg[1]) +
          '</div>' +
          (r.reason ? '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#dddaeecc;line-height:1.5;margin-bottom:3px">' + r.reason + '</div>' : '') +
          (r.contact_info ? '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#66b5f8cc">' + r.contact_info + '</div>' : '') +
          (r.outcome_notes ? '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#22c98acc;font-style:italic;margin-top:2px">Outcome: ' + r.outcome_notes + '</div>' : '') +
          (r.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe855;margin-top:2px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#e8b84b55;margin-top:4px">' +
            'Referred ' + fmtDate(r.referred_at) +
          '</div>' +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b55;color:#e8b84b;padding:3px 10px;font-size:8px;flex-shrink:0" ' +
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
      : '<div style="color:#dddaee55;font-family:\'EB Garamond\',serif;font-size:14px;' +
          'font-style:italic;padding:10px 0">No action plans yet.</div>';

    return '<div style="margin-bottom:28px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84baa">' +
          'Action Plans' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          recStatChip(plans.length + ' Total',    '#dddaee99') +
          recStatChip(active       + ' Active',    '#22c98a') +
          recStatChip(completed    + ' Completed', '#b09ef8') +
          '<button class="action-btn approve" style="padding:4px 14px;font-size:8px" ' +
            'onclick="crmOpenApForm(\'' + esc(clientId) + '\',null)">+ Add</button>' +
        '</div>' +
      '</div>' +
      planRows +
    '</div>';
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

    return '<div style="background:#0a0718;border:1px solid #e8b84b33;padding:12px 16px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            complianceBadge(stCfg[0], stCfg[1]) +
            complianceBadge(prCfg[0] + ' Priority', prCfg[1]) +
            (p.due_date ? complianceBadge('Due ' + fmtDate(p.due_date), '#e8b84b') : '') +
          '</div>' +
          fields.map(function(f) {
            return '<div style="margin-bottom:6px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.25em;text-transform:uppercase;' +
                'color:#e8b84b77;margin-bottom:2px">' + f[0] + '</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#e8e6f8;line-height:1.5">' + f[1] + '</div>' +
            '</div>';
          }).join('') +
          (p.session_id ? '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:#9b7fe855;margin-top:4px">Linked to session</div>' : '') +
          '<div style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#e8b84b55;margin-top:6px">' +
            fmtDate(p.created_at) +
          '</div>' +
        '</div>' +
        '<button class="action-btn view" style="border-color:#e8b84b55;color:#e8b84b;padding:3px 10px;font-size:8px;flex-shrink:0" ' +
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
