// clients-module.js
// Replaces the localStorage-based Clients tab with live /clients API calls.
// Loaded after dashboard.html's inline scripts so these definitions win.

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────
  let _clients   = [];
  let _loaded    = false;
  let _searching = false;
  let _searchTimer = null;

  // ── API helper ──────────────────────────────────────────────────────────
  function token() {
    return sessionStorage.getItem('rea_sb_token') || '';
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch('/.netlify/functions' + path, Object.assign({}, opts, {
      headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() }, opts.headers || {}),
    }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  const STATUS_LABELS = {
    active:                  ['Active',          '#22c98a'],
    cancelled_appointment:   ['Cancelled',        '#ee7070'],
    rescheduled:             ['Rescheduled',      '#9b7fe8'],
    no_show:                 ['No-Show',          '#f8a84b'],
    payment_issue:           ['Payment Issue',    '#f8e090'],
    blocked:                 ['Blocked',          '#ee4444'],
    archived:                ['Archived',         '#888888'],
  };

  function statusBadge(status) {
    const [label, color] = STATUS_LABELS[status] || ['Active', '#22c98a'];
    return `<span style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.3em;color:${color};background:${color}18;border:1px solid ${color}44;padding:2px 10px;border-radius:2px;text-transform:uppercase;white-space:nowrap">${label}</span>`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escAttr(s) {
    return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  function tagChip(t) {
    return `<span style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.15em;text-transform:uppercase;background:#e8b84b12;border:1px solid #e8b84b33;color:#e8b84bcc;padding:2px 8px;border-radius:2px">${t}</span>`;
  }

  // ── renderClients — overrides the localStorage version ──────────────────
  window.renderClients = async function () {
    const roster  = document.getElementById('clientRoster');
    const countEl = document.getElementById('clientCount');
    if (!roster) return;

    const search = ((document.getElementById('clientSearch') || {}).value || '').trim();
    const filter = (document.getElementById('clientFilter') || {}).value || 'all';

    if (!_loaded) {
      roster.innerHTML = '<div style="padding:32px;text-align:center;color:#e8b84b88;font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">LOADING CLIENTS…</div>';
    }

    // Debounce only when the user is typing in the search box
    if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null; }

    const doLoad = async () => {
      try {
        const path = search ? '/clients?search=' + encodeURIComponent(search) : '/clients';
        const data = await api(path);
        _clients = data.clients || [];
        _loaded  = true;
      } catch (e) {
        roster.innerHTML = `<div style="padding:24px;color:#ee7070;font-family:'EB Garamond',serif">Failed to load clients: ${e.message}</div>`;
        if (countEl) countEl.textContent = '';
        return;
      }

      let list = _clients.slice();

      const STATUS_FILTERS = ['active','cancelled_appointment','rescheduled','no_show','payment_issue','blocked','archived'];
      if (filter === 'distance') list = list.filter(c => (c.tags || []).includes('distance'));
      if (filter === 'inperson') list = list.filter(c => (c.tags || []).includes('in-person') || (c.tags || []).includes('inPerson'));
      if (STATUS_FILTERS.includes(filter)) list = list.filter(c => c.status === filter);

      if (countEl) countEl.textContent = list.length + ' client' + (list.length !== 1 ? 's' : '');

      if (!list.length) {
        roster.innerHTML = '<p style="color:#dddaeecc;font-style:italic;padding:24px 0">No clients match.</p>';
        return;
      }

      roster.innerHTML = list.map(c => buildCard(c)).join('');
    };

    if (search) {
      _searchTimer = setTimeout(doLoad, 280);
    } else {
      await doLoad();
    }
  };

  function buildCard(c) {
    const id        = c.id;
    const name      = c.full_name || '(unnamed)';
    const status    = c.status || 'active';
    const tags      = c.tags || [];
    const tagHtml   = tags.filter(t => t).map(tagChip).join(' ');
    const isArchived = status === 'archived';

    const statusRow = Object.keys(STATUS_LABELS).map(s => {
      const [lbl, col] = STATUS_LABELS[s];
      const active = status === s ? `;border-color:${col};color:${col}` : '';
      return `<button onclick="crmSetStatus('${escAttr(id)}','${s}')" style="font-family:'Cinzel',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;padding:3px 8px;border:1px solid ${col}44;color:${col}88;background:${col}0d;cursor:pointer${active}">${lbl}</button>`;
    }).join('');

    return `<div class="client-card" style="${isArchived ? 'opacity:.5' : ''}">
  <div class="card-head">
    <div style="flex:1;min-width:0">
      <div class="card-name" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${name} ${statusBadge(status)}
      </div>
      ${c.email || c.phone ? `<div style="font-family:'EB Garamond',serif;font-size:14px;color:#dddaee77;margin-top:3px">${[c.email, c.phone].filter(Boolean).join(' · ')}</div>` : ''}
      <div class="card-time" style="margin-top:2px">Added ${fmtDate(c.created_at)}${c.source && c.source !== 'manual' ? ' · ' + c.source : ''}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;flex-shrink:0">
      <button class="action-btn view" onclick="crmOpenProfile('${escAttr(id)}')">👤 Profile</button>
      <button class="action-btn view" style="border-color:#9b7fe844;color:#9b7fe8cc" onclick="crmOpenTimeline('${escAttr(id)}')">⏱ Timeline</button>
      <button class="action-btn view" style="border-color:#e8b84b44;color:#e8b84bcc" onclick="crmOpenEdit('${escAttr(id)}')">✎ Edit</button>
      <button class="action-btn reject" onclick="crmConfirmArchive('${escAttr(id)}','${escAttr(name)}')">⊘ Archive</button>
    </div>
  </div>
  ${tagHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${tagHtml}</div>` : ''}
  <div style="display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap">
    <span style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.3em;color:#e8b84b66;text-transform:uppercase">Set Status:</span>
    ${statusRow}
  </div>
</div>`;
  }

  // ── Set status ───────────────────────────────────────────────────────────
  window.crmSetStatus = async function (id, status) {
    try {
      await api('/clients?id=' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
      await window.renderClients();
    } catch (e) {
      alert('Could not update status: ' + e.message);
    }
  };

  // ── Archive (soft-delete) ────────────────────────────────────────────────
  window.crmConfirmArchive = function (id, name) {
    if (!confirm('Archive ' + name + '?\n\nThey will be hidden from active views but never deleted.')) return;
    api('/clients?id=' + id, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })
      .then(() => window.renderClients())
      .catch(e => alert('Archive failed: ' + e.message));
  };

  // ── Create / Edit modal ──────────────────────────────────────────────────
  window.crmOpenCreate = function () {
    document.getElementById('crmModalTitle').textContent   = 'New Client';
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
    document.getElementById('crmModalTitle').textContent   = 'Edit Client';
    document.getElementById('crmModalSubtitle').textContent = 'Update client details';
    document.getElementById('crmModalError').textContent   = '';
    document.getElementById('crmClientId').value = id;

    // Pre-populate with cached data while we fetch full record
    const cached = _clients.find(c => c.id === id);
    if (cached) {
      document.getElementById('crmFullName').value  = cached.full_name  || '';
      document.getElementById('crmEmail').value     = cached.email      || '';
      document.getElementById('crmPhone').value     = cached.phone      || '';
      document.getElementById('crmSource').value    = cached.source     || 'manual';
      document.getElementById('crmNotes').value     = cached.notes      || '';
      document.getElementById('crmTags').value      = (cached.tags || []).join(', ');
    }

    document.getElementById('crmClientModal').classList.add('open');

    // Fetch full record to get notes field (not in list response)
    try {
      const data = await api('/clients?id=' + id);
      const cl = data.client;
      document.getElementById('crmFullName').value  = cl.full_name  || '';
      document.getElementById('crmEmail').value     = cl.email      || '';
      document.getElementById('crmPhone').value     = cl.phone      || '';
      document.getElementById('crmSource').value    = cl.source     || 'manual';
      document.getElementById('crmNotes').value     = cl.notes      || '';
      document.getElementById('crmTags').value      = (cl.tags || []).join(', ');
    } catch (e) { /* use cached data */ }
  };

  window.crmSaveClient = async function () {
    const id       = document.getElementById('crmClientId').value.trim();
    const fullName = document.getElementById('crmFullName').value.trim();
    const errEl    = document.getElementById('crmModalError');
    const saveBtn  = document.getElementById('crmSaveBtn');

    if (!fullName) { errEl.textContent = 'Full name is required.'; return; }

    const tagsRaw = document.getElementById('crmTags').value;
    const tags    = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

    const payload = {
      full_name: fullName,
      email:     document.getElementById('crmEmail').value.trim() || null,
      phone:     document.getElementById('crmPhone').value.trim() || null,
      source:    document.getElementById('crmSource').value || 'manual',
      notes:     document.getElementById('crmNotes').value.trim() || null,
      tags,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errEl.textContent = '';

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
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  };

  window.crmCloseClientModal = function (e) {
    if (e && e.target !== document.getElementById('crmClientModal')) return;
    document.getElementById('crmClientModal').classList.remove('open');
  };

  // ── Profile modal ────────────────────────────────────────────────────────
  window.crmOpenProfile = async function (id) {
    const modal = document.getElementById('crmProfileModal');
    const body  = document.getElementById('crmProfileBody');
    body.innerHTML = '<div style="padding:32px;text-align:center;color:#e8b84b88;font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">LOADING…</div>';
    modal.classList.add('open');

    try {
      const data = await api('/clients?id=' + id);
      const cl   = data.client;
      const sess = data.sessions || [];
      const ac   = data.aftercare || [];

      const totalPaid = sess.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
      const completed = sess.filter(s => s.status === 'completed').length;
      const pendingAC = ac.filter(a => a.status === 'scheduled').length;

      const sessRows = sess.length
        ? sess.map(s => `<tr>
            <td style="color:#dddaeecc">${fmtDate(s.session_date)}</td>
            <td style="color:#e8b84bcc">${s.service_type || '—'}</td>
            <td style="color:#22c98a">${s.status || '—'}</td>
            <td style="color:#e8b84b">$${parseFloat(s.price || 0).toFixed(2)}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" style="color:#dddaee55;font-style:italic;padding:12px 0">No sessions yet.</td></tr>';

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          ${row('Full Name',    cl.full_name)}
          ${row('Email',        cl.email)}
          ${row('Phone',        cl.phone)}
          ${row('Source',       cl.source)}
          ${row('Status',       statusBadge(cl.status || 'active'), true)}
          ${row('Added',        fmtDate(cl.created_at))}
        </div>
        ${cl.notes ? `<div style="background:#e8b84b08;border-left:2px solid #e8b84b33;padding:10px 14px;margin-bottom:20px;font-family:'EB Garamond',serif;font-size:15px;color:#dddaee;line-height:1.7">${cl.notes}</div>` : ''}
        ${(cl.tags||[]).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">${(cl.tags||[]).map(tagChip).join('')}</div>` : ''}

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e8b84b14;margin-bottom:20px">
          ${stat('Total Sessions', sess.length)}
          ${stat('Completed',      completed)}
          ${stat('Total Paid',     '$' + totalPaid.toFixed(2))}
          ${stat('Pending Follow-ups', pendingAC)}
        </div>

        <div style="font-family:'Cinzel',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b88;margin-bottom:10px">Sessions</div>
        <table style="width:100%;border-collapse:collapse;font-family:'EB Garamond',serif;font-size:14px">
          <thead><tr>
            <th style="text-align:left;color:#e8b84b66;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:6px">Date</th>
            <th style="text-align:left;color:#e8b84b66;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:6px">Service</th>
            <th style="text-align:left;color:#e8b84b66;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:6px">Status</th>
            <th style="text-align:left;color:#e8b84b66;font-family:'Cinzel',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;padding-bottom:6px">Price</th>
          </tr></thead>
          <tbody>${sessRows}</tbody>
        </table>

        <div style="margin-top:20px;border-top:1px solid #e8b84b14;padding-top:16px">
          <button class="action-btn view" style="border-color:#e8b84b44;color:#e8b84bcc" onclick="crmCloseProfileModal();crmOpenEdit('${id}')">✎ Edit This Client</button>
          <button class="action-btn view" style="border-color:#9b7fe844;color:#9b7fe8cc;margin-left:8px" onclick="crmCloseProfileModal();crmOpenTimeline('${id}')">⏱ Full Timeline</button>
        </div>`;
    } catch (e) {
      body.innerHTML = `<div style="color:#ee7070;font-family:'EB Garamond',serif;padding:20px">Failed to load profile: ${e.message}</div>`;
    }
  };

  function row(label, val, raw) {
    const display = raw ? (val || '—') : (val || '—');
    return `<div>
      <div style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b66;margin-bottom:3px">${label}</div>
      <div style="font-family:'EB Garamond',serif;font-size:15px;color:#dddaee">${display}</div>
    </div>`;
  }

  function stat(label, val) {
    return `<div class="stat"><span class="stat-val">${val}</span><span class="stat-label">${label}</span></div>`;
  }

  window.crmCloseProfileModal = function (e) {
    if (e && e.target !== document.getElementById('crmProfileModal')) return;
    document.getElementById('crmProfileModal').classList.remove('open');
  };

  // ── Timeline modal ───────────────────────────────────────────────────────
  window.crmOpenTimeline = async function (id) {
    const modal = document.getElementById('crmTimelineModal');
    const body  = document.getElementById('crmTimelineBody');
    body.innerHTML = '<div style="padding:32px;text-align:center;color:#e8b84b88;font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">BUILDING TIMELINE…</div>';
    modal.classList.add('open');

    try {
      const data   = await api('/timeline?client_id=' + id);
      const cl     = data.client;
      const stats  = data.stats || {};
      const events = data.timeline || [];

      document.getElementById('crmTimelineTitle').textContent = cl.full_name + ' — Timeline';

      const TYPE_CONFIG = {
        session:  { icon: '✦', label: 'Session',     color: '#9b7fe8' },
        note:     { icon: '📝', label: 'Note',        color: '#e8b84b' },
        payment:  { icon: '💳', label: 'Payment',     color: '#22c98a' },
        aftercare:{ icon: '💌', label: 'Follow-up',   color: '#66b5f8' },
        intake:   { icon: '📋', label: 'Intake',      color: '#f8a84b' },
      };

      const eventHtml = events.length
        ? events.map(ev => {
            const cfg  = TYPE_CONFIG[ev.type] || { icon: '·', label: ev.type, color: '#888' };
            const d    = ev.data || {};
            let detail = '';

            if (ev.type === 'session') {
              detail = [d.service_type, d.status, d.price ? '$' + parseFloat(d.price).toFixed(2) : ''].filter(Boolean).join(' · ');
            } else if (ev.type === 'note') {
              detail = (d.content || d.raw_notes || '').slice(0, 160) + ((d.content || d.raw_notes || '').length > 160 ? '…' : '');
            } else if (ev.type === 'payment') {
              detail = '$' + parseFloat(d.amount || 0).toFixed(2) + (d.method ? ' via ' + d.method : '') + (d.notes ? ' — ' + d.notes : '');
            } else if (ev.type === 'aftercare') {
              detail = (d.message_type || '') + (d.status ? ' · ' + d.status : '') + (d.message_preview ? ' · ' + (d.message_preview||'').slice(0,100) : '');
            } else if (ev.type === 'intake') {
              detail = 'Form submitted' + (d.service_interest ? ' · ' + d.service_interest : '');
            }

            return `<div style="display:flex;gap:14px;padding:10px 0;border-bottom:1px solid #e8b84b08">
              <div style="width:36px;height:36px;border-radius:50%;background:${cfg.color}18;border:1px solid ${cfg.color}44;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px">${cfg.icon}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
                  <span style="font-family:'Cinzel',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:${cfg.color}">${cfg.label}</span>
                  <span style="font-family:'EB Garamond',serif;font-size:13px;color:#dddaee55">${fmtDate(ev.date)}</span>
                </div>
                ${detail ? `<div style="font-family:'EB Garamond',serif;font-size:14px;color:#dddaeecc;margin-top:2px;line-height:1.5">${detail}</div>` : ''}
              </div>
            </div>`;
          }).join('')
        : '<p style="color:#dddaee55;font-style:italic;padding:24px 0">No timeline events yet.</p>';

      body.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e8b84b14;margin-bottom:24px">
          ${stat('Sessions',       stats.totalSessions || 0)}
          ${stat('Completed',      stats.completedSessions || 0)}
          ${stat('Total Paid',     '$' + (stats.totalPaid || 0).toFixed(2))}
          ${stat('Pending Follow-ups', stats.pendingFollowUps || 0)}
        </div>
        <div>${eventHtml}</div>`;
    } catch (e) {
      body.innerHTML = `<div style="color:#ee7070;font-family:'EB Garamond',serif;padding:20px">Failed to load timeline: ${e.message}</div>`;
    }
  };

  window.crmCloseTimelineModal = function (e) {
    if (e && e.target !== document.getElementById('crmTimelineModal')) return;
    document.getElementById('crmTimelineModal').classList.remove('open');
  };

  // ── Clear any stale localStorage-rendered cards immediately ─────────────
  // initDashboard() runs before this module and calls the old renderClients()
  // which fills the roster from REA_DATA. Clear it so API data renders cleanly.
  (function clearStaleRoster() {
    var roster = document.getElementById('clientRoster');
    if (roster) roster.innerHTML = '';
    var countEl = document.getElementById('clientCount');
    if (countEl) countEl.textContent = '';
  })();

  // ── Patch showTab to auto-load clients ───────────────────────────────────
  const _origShowTab = window.showTab;
  window.showTab = function (name) {
    if (_origShowTab) _origShowTab(name);
    if (name === 'clients') {
      window.renderClients();
    }
  };

  // ── Initial load if clients tab is already active on page load ───────────
  document.addEventListener('DOMContentLoaded', function () {
    const active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-clients') {
      window.renderClients();
    }
  });

})();
