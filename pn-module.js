// pn-module.js — Practitioner Network frontend IIFE
// Renders into #tab-pn. Called by showTab('pn') → pnInit().
// Auth: sessionStorage 'rea_api_token' → X-Dashboard-Token header.
// API: /.netlify/functions/practitioner-network

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const API  = '/.netlify/functions/practitioner-network';
  const SECTIONS = ['dashboard','applications','practitioners','certifications','referrals','directory'];
  const SECTION_LABELS = {
    dashboard:      'Dashboard',
    applications:   'Applications',
    practitioners:  'Practitioners',
    certifications: 'Certifications',
    referrals:      'Referrals',
    directory:      'Directory',
  };

  const STATUS_COLORS = {
    // practitioner statuses
    applied:   '#e8b84b', review: '#b09ef8', approved: '#22c98a',
    active:    '#22c98a', suspended: '#e8a840', archived: '#5a6050',
    // application statuses
    pending:   '#e8b84b', rejected: '#dc9090', withdrawn: '#5a6050',
    // cert statuses
    expired:   '#dc9090', revoked: '#c07070',
    // referral statuses
    accepted:  '#22c98a', completed: '#50b890', declined: '#dc9090',
  };

  const CERT_LEVEL_COLORS = {
    none: '#5a6050', foundation: '#e8b84b', practitioner: '#b09ef8',
    advanced: '#22c98a', master: '#e87040',
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let currentSection = 'dashboard';
  let toastTimer     = null;

  // ── Entry ──────────────────────────────────────────────────────────────────
  function pnInit() {
    const root = document.getElementById('tab-pn');
    if (!root) return;
    root.innerHTML = `
      <div class="pn-wrap">
        <nav class="pn-subnav" id="pn-subnav"></nav>
        <div class="pn-body" id="pn-body"></div>
      </div>`;
    renderSubnav(currentSection);
    loadSection(currentSection);
  }

  // ── Subnav ─────────────────────────────────────────────────────────────────
  function renderSubnav(active) {
    const nav = document.getElementById('pn-subnav');
    if (!nav) return;
    nav.innerHTML = SECTIONS.map(s =>
      `<button class="pn-snav${s === active ? ' pn-snav-active' : ''}" data-s="${s}">${SECTION_LABELS[s]}</button>`
    ).join('');
    nav.querySelectorAll('.pn-snav').forEach(btn =>
      btn.addEventListener('click', () => switchSection(btn.dataset.s))
    );
  }

  function switchSection(s) {
    currentSection = s;
    renderSubnav(s);
    loadSection(s);
  }

  // ── Section router ─────────────────────────────────────────────────────────
  function loadSection(s) {
    const body = document.getElementById('pn-body');
    if (!body) return;
    body.innerHTML = shimmer();
    if (s === 'dashboard')      loadDashboard(body);
    else if (s === 'applications')   loadApplications(body);
    else if (s === 'practitioners')  loadPractitioners(body);
    else if (s === 'certifications') loadCertifications(body);
    else if (s === 'referrals')      loadReferrals(body);
    else if (s === 'directory')      loadDirectory(body);
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard(body) {
    const r = await api('GET', '?section=dashboard');
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql in Supabase to enable the Practitioner Network.'); return; }

    const k = r.kpis || {};
    const pc = r.practitioner_counts || {};

    body.innerHTML = `
      <div>
        <div class="pn-kpi-row">
          ${kpi('🌐', k.total_practitioners ?? 0,     'Total')}
          ${kpi('📋', k.pending_applications ?? 0,    'Pending Apps')}
          ${kpi('✅', k.active_practitioners ?? 0,    'Active')}
          ${kpi('🎓', k.active_certifications ?? 0,   'Certs')}
          ${kpi('🔀', k.pending_referrals ?? 0,       'Referrals')}
          ${kpi('📖', k.directory_listings ?? 0,      'Directory')}
        </div>
        <div class="pn-dash-grid">
          <div class="pn-dash-card">
            <div class="pn-dash-card-title">Practitioner Pipeline</div>
            <div class="pn-pipeline">
              ${pipe('#e8b84b', 'Applied',   pc.applied   ?? 0)}
              ${pipe('#b09ef8', 'In Review', pc.review    ?? 0)}
              ${pipe('#22c98a', 'Approved',  pc.approved  ?? 0)}
              ${pipe('#22c98a', 'Active',    pc.active    ?? 0)}
              ${pipe('#e8a840', 'Suspended', pc.suspended ?? 0)}
            </div>
          </div>
          <div class="pn-dash-card">
            <div class="pn-dash-card-title">Quick Actions</div>
            <div class="pn-quick-actions">
              <button class="pn-quick-btn" onclick="pnGoto('applications')">+ New Application</button>
              <button class="pn-quick-btn" onclick="pnGoto('practitioners')">View All Practitioners</button>
              <button class="pn-quick-btn" onclick="pnGoto('directory')">Browse Directory</button>
              <button class="pn-quick-btn" onclick="pnGoto('referrals')">View Referrals</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function kpi(icon, num, lbl) {
    return `<div class="pn-kpi"><div class="pn-kpi-icon">${icon}</div><div class="pn-kpi-num">${num}</div><div class="pn-kpi-lbl">${lbl}</div></div>`;
  }
  function pipe(color, lbl, count) {
    return `<div class="pn-pipe-item"><div class="pn-pipe-dot" style="background:${color}"></div><div class="pn-pipe-lbl">${lbl}</div><div class="pn-pipe-count">${count}</div></div>`;
  }

  // expose for onclick in dashboard quick-action buttons
  window.pnGoto = function (s) { switchSection(s); };

  // ── Applications ───────────────────────────────────────────────────────────
  async function loadApplications(body) {
    const r = await api('GET', '?section=applications');
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql to enable Applications.'); return; }

    const apps = r.applications || [];
    body.innerHTML = `
      <div>
        <div class="pn-section-header">
          <div class="pn-section-title">Applications (${apps.length})</div>
          <div class="pn-header-actions">
            <button class="pn-btn-primary" id="pn-new-app-btn">+ New Application</button>
          </div>
        </div>
        <div id="pn-app-form-area"></div>
        <div id="pn-app-list">${apps.length ? apps.map(appCard).join('') : emptyEl('No applications yet.')}</div>
      </div>`;

    document.getElementById('pn-new-app-btn').addEventListener('click', () => showAppForm());
  }

  function appCard(a) {
    const prac = a.practitioners || {};
    const color = STATUS_COLORS[a.status] || '#7a7060';
    return `<div class="pn-prac-card" id="pn-app-${a.id}">
      <div class="pn-prac-top">
        <div class="pn-prac-name">${esc(prac.name || '—')}</div>
        <span class="pn-status-badge" style="background:${color}66;color:${color};border:1px solid ${color}44">${a.status}</span>
        <div class="pn-prac-actions">
          ${a.status === 'pending' || a.status === 'review' ? `
            <button class="pn-btn-approve" onclick="pnApproveApp('${a.id}')">Approve</button>
            <button class="pn-btn-reject"  onclick="pnRejectApp('${a.id}')">Reject</button>` : ''}
          <button class="pn-btn-delete" onclick="pnDeleteApp('${a.id}')">Delete</button>
        </div>
      </div>
      ${a.application_text ? `<div class="pn-prac-bio">${esc(a.application_text).slice(0, 180)}…</div>` : ''}
      <div class="pn-prac-meta">Submitted ${fmtDate(a.created_at)}${a.review_notes ? ' · ' + esc(a.review_notes).slice(0, 80) : ''}</div>
    </div>`;
  }

  function showAppForm(area) {
    const el = document.getElementById('pn-app-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="pn-form" id="pn-app-form">
        <div class="pn-form-title">New Application</div>
        <div class="pn-form-row-2">
          <div class="pn-form-row"><label class="pn-label">Name *</label><input class="pn-input" id="pna-name" placeholder="Full name"></div>
          <div class="pn-form-row"><label class="pn-label">Email</label><input class="pn-input" id="pna-email" type="email" placeholder="email@example.com"></div>
        </div>
        <div class="pn-form-row-2">
          <div class="pn-form-row"><label class="pn-label">Phone</label><input class="pn-input" id="pna-phone" placeholder="+1 555 000 0000"></div>
          <div class="pn-form-row"><label class="pn-label">Location</label><input class="pn-input" id="pna-location" placeholder="City, State"></div>
        </div>
        <div class="pn-form-row"><label class="pn-label">Specialties (comma-separated)</label><input class="pn-input" id="pna-specialties" placeholder="Reiki, Sound Healing, Energy Work"></div>
        <div class="pn-form-row"><label class="pn-label">Application / Cover Letter</label><textarea class="pn-input pn-textarea-sm" id="pna-text" rows="4" placeholder="Why do you want to join the REA network?"></textarea></div>
        <div class="pn-form-row"><label class="pn-label">Experience</label><textarea class="pn-input pn-textarea-sm" id="pna-exp" rows="3" placeholder="Relevant healing experience…"></textarea></div>
        <div class="pn-form-actions">
          <button class="pn-btn-primary" id="pna-submit">Submit Application</button>
          <button class="pn-btn-cancel" onclick="document.getElementById('pn-app-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('pna-submit').addEventListener('click', submitAppForm);
  }

  async function submitAppForm() {
    const name = v('pna-name');
    if (!name) { toast('Name is required', true); return; }
    const btn = document.getElementById('pna-submit');
    btn.disabled = true; btn.textContent = 'Submitting…';
    const r = await api('POST', '?action=create_application', {
      name, email: v('pna-email'), phone: v('pna-phone'), location: v('pna-location'),
      specialties: v('pna-specialties').split(',').map(s => s.trim()).filter(Boolean),
      application_text: v('pna-text'), experience: v('pna-exp'),
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Submit Application'; return; }
    toast('Application submitted');
    loadSection('applications');
  }

  window.pnApproveApp = async function (id) {
    if (!confirm('Approve this application? The practitioner status will advance to Approved.')) return;
    const r = await api('PATCH', `?action=approve_application&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Application approved'); loadSection('applications');
  };
  window.pnRejectApp = async function (id) {
    if (!confirm('Reject this application?')) return;
    const r = await api('PATCH', `?action=reject_application&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Application rejected'); loadSection('applications');
  };
  window.pnDeleteApp = async function (id) {
    if (!confirm('Delete this application record?')) return;
    const r = await api('PATCH', `?action=delete_application&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Deleted'); document.getElementById('pn-app-' + id)?.remove();
  };

  // ── Practitioners ──────────────────────────────────────────────────────────
  async function loadPractitioners(body, params) {
    const qs = params ? '?section=practitioners&' + params : '?section=practitioners';
    const r = await api('GET', qs);
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql to enable Practitioners.'); return; }

    const pracs = r.practitioners || [];
    body.innerHTML = `
      <div>
        <div class="pn-section-header">
          <div class="pn-section-title">Practitioners (${pracs.length})</div>
          <div class="pn-header-actions">
            <button class="pn-btn-primary" id="pn-new-prac-btn">+ Add Practitioner</button>
          </div>
        </div>
        <div class="pn-filters">
          <input class="pn-search" id="pn-prac-search" placeholder="Search by name…" value="${params ? (new URLSearchParams(params).get('search') || '') : ''}">
          <select class="pn-filter-select" id="pn-prac-status">
            <option value="">All Statuses</option>
            ${['applied','review','approved','active','suspended','archived'].map(s =>
              `<option value="${s}">${s}</option>`).join('')}
          </select>
          <select class="pn-filter-select" id="pn-prac-level">
            <option value="">All Levels</option>
            ${['none','foundation','practitioner','advanced','master'].map(l =>
              `<option value="${l}">${l}</option>`).join('')}
          </select>
          <button class="pn-btn-secondary" id="pn-prac-filter-btn">Filter</button>
        </div>
        <div id="pn-prac-form-area"></div>
        <div id="pn-prac-list">${pracs.length ? pracs.map(pracCard).join('') : emptyEl('No practitioners found.')}</div>
      </div>`;

    document.getElementById('pn-new-prac-btn').addEventListener('click', showPracForm);
    document.getElementById('pn-prac-filter-btn').addEventListener('click', () => {
      const search = v('pn-prac-search');
      const status = document.getElementById('pn-prac-status').value;
      const level  = document.getElementById('pn-prac-level').value;
      const parts  = [];
      if (search) parts.push('search=' + encodeURIComponent(search));
      if (status) parts.push('status=' + status);
      if (level)  parts.push('certification_level=' + level);
      loadPractitioners(body, parts.join('&'));
    });
  }

  function pracCard(p) {
    const sc = STATUS_COLORS[p.status] || '#7a7060';
    const lc = CERT_LEVEL_COLORS[p.certification_level] || '#7a7060';
    const specs = (p.specialties || []).map(s => `<span class="pn-spec-chip">${esc(s)}</span>`).join('');
    return `<div class="pn-prac-card" id="pn-prac-${p.id}">
      <div class="pn-prac-top">
        <div>
          <div class="pn-prac-name">${esc(p.name)}</div>
          ${p.email ? `<div class="pn-prac-email">${esc(p.email)}</div>` : ''}
          ${p.location ? `<div class="pn-prac-loc">📍 ${esc(p.location)}</div>` : ''}
        </div>
        <span class="pn-status-badge" style="background:${sc}44;color:${sc};border:1px solid ${sc}33">${p.status}</span>
        <span class="pn-level-badge" style="color:${lc};border-color:${lc}44">${p.certification_level}</span>
        ${p.directory_visible ? '<span class="pn-dir-badge">Listed</span>' : ''}
        <div class="pn-prac-actions">
          ${p.status === 'approved' ? `<button class="pn-btn-activate" onclick="pnActivatePrac('${p.id}')">Activate</button>` : ''}
          ${p.status === 'active'   ? `<button class="pn-btn-suspend"  onclick="pnSuspendPrac('${p.id}')">Suspend</button>` : ''}
          <button class="pn-btn-edit"   onclick="pnEditPrac('${p.id}')">Edit</button>
          <button class="pn-btn-delete" onclick="pnDeletePrac('${p.id}')">Delete</button>
        </div>
      </div>
      ${p.bio ? `<div class="pn-prac-bio">${esc(p.bio).slice(0, 160)}…</div>` : ''}
      ${specs ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">${specs}</div>` : ''}
      <div class="pn-prac-meta">Joined ${fmtDate(p.application_date)}${p.approval_date ? ' · Approved ' + fmtDate(p.approval_date) : ''}</div>
    </div>`;
  }

  function showPracForm() {
    const el = document.getElementById('pn-prac-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="pn-form" id="pn-prac-form">
        <div class="pn-form-title">Add Practitioner</div>
        <div class="pn-form-row-2">
          <div class="pn-form-row"><label class="pn-label">Name *</label><input class="pn-input" id="pnp-name" placeholder="Full name"></div>
          <div class="pn-form-row"><label class="pn-label">Email</label><input class="pn-input" id="pnp-email" type="email"></div>
        </div>
        <div class="pn-form-row-2">
          <div class="pn-form-row"><label class="pn-label">Phone</label><input class="pn-input" id="pnp-phone"></div>
          <div class="pn-form-row"><label class="pn-label">Location</label><input class="pn-input" id="pnp-location" placeholder="City, State"></div>
        </div>
        <div class="pn-form-row-2">
          <div class="pn-form-row">
            <label class="pn-label">Status</label>
            <select class="pn-input" id="pnp-status">
              <option value="applied">Applied</option><option value="review">Review</option>
              <option value="approved">Approved</option><option value="active">Active</option>
            </select>
          </div>
          <div class="pn-form-row">
            <label class="pn-label">Certification Level</label>
            <select class="pn-input" id="pnp-level">
              <option value="none">None</option><option value="foundation">Foundation</option>
              <option value="practitioner">Practitioner</option><option value="advanced">Advanced</option>
              <option value="master">Master</option>
            </select>
          </div>
        </div>
        <div class="pn-form-row"><label class="pn-label">Specialties (comma-separated)</label><input class="pn-input" id="pnp-specialties"></div>
        <div class="pn-form-row"><label class="pn-label">Bio</label><textarea class="pn-input pn-textarea-sm" id="pnp-bio" rows="3"></textarea></div>
        <div class="pn-form-row"><label class="pn-label"><input type="checkbox" id="pnp-dir"> Show in Directory</label></div>
        <div class="pn-form-actions">
          <button class="pn-btn-primary" id="pnp-submit">Add Practitioner</button>
          <button class="pn-btn-cancel" onclick="document.getElementById('pn-prac-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('pnp-submit').addEventListener('click', submitPracForm);
  }

  async function submitPracForm() {
    const name = v('pnp-name');
    if (!name) { toast('Name is required', true); return; }
    const btn = document.getElementById('pnp-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await api('POST', '?action=create_practitioner', {
      name, email: v('pnp-email'), phone: v('pnp-phone'), location: v('pnp-location'),
      status: document.getElementById('pnp-status').value,
      certification_level: document.getElementById('pnp-level').value,
      specialties: v('pnp-specialties').split(',').map(s => s.trim()).filter(Boolean),
      bio: v('pnp-bio'),
      directory_visible: document.getElementById('pnp-dir').checked,
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Add Practitioner'; return; }
    toast('Practitioner added'); loadSection('practitioners');
  }

  window.pnActivatePrac = async function (id) {
    const r = await api('PATCH', `?action=activate_practitioner&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Practitioner activated'); loadSection('practitioners');
  };
  window.pnSuspendPrac = async function (id) {
    if (!confirm('Suspend this practitioner?')) return;
    const r = await api('PATCH', `?action=suspend_practitioner&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Practitioner suspended'); loadSection('practitioners');
  };
  window.pnEditPrac = function (id) {
    toast('Edit form — coming in Phase 5', false);
  };
  window.pnDeletePrac = async function (id) {
    if (!confirm('Delete this practitioner? This is a soft delete.')) return;
    const r = await api('PATCH', `?action=delete_practitioner&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Deleted'); document.getElementById('pn-prac-' + id)?.remove();
  };

  // ── Certifications ─────────────────────────────────────────────────────────
  async function loadCertifications(body) {
    const r = await api('GET', '?section=certifications');
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql to enable Certifications.'); return; }

    const certs = r.certifications || [];
    body.innerHTML = `
      <div>
        <div class="pn-section-header">
          <div class="pn-section-title">Certifications (${certs.length})</div>
          <div class="pn-header-actions">
            <button class="pn-btn-primary" id="pn-new-cert-btn">+ Assign Cert</button>
          </div>
        </div>
        <div id="pn-cert-form-area"></div>
        <div id="pn-cert-list">${certs.length ? certs.map(certCard).join('') : emptyEl('No certifications assigned yet.')}</div>
      </div>`;
    document.getElementById('pn-new-cert-btn').addEventListener('click', showCertForm);
  }

  function certCard(c) {
    const prac = c.practitioners || {};
    const sc   = STATUS_COLORS[c.status] || '#7a7060';
    return `<div class="pn-prac-card" id="pn-cert-${c.id}">
      <div class="pn-prac-top">
        <div class="pn-prac-name">${esc(prac.name || '—')}</div>
        <span class="pn-status-badge" style="background:${sc}44;color:${sc};border:1px solid ${sc}33">${c.status}</span>
        <div class="pn-prac-actions">
          ${c.status === 'active' ? `<button class="pn-btn-suspend" onclick="pnExpireCert('${c.id}')">Expire</button>` : ''}
          ${c.status === 'expired' ? `<button class="pn-btn-approve" onclick="pnRenewCert('${c.id}')">Renew</button>` : ''}
        </div>
      </div>
      <div class="pn-prac-meta">
        Completed: ${fmtDate(c.completion_date) || '—'} · Expires: ${fmtDate(c.expiration_date) || '—'}
      </div>
    </div>`;
  }

  function showCertForm() {
    const el = document.getElementById('pn-cert-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="pn-form" id="pn-cert-form">
        <div class="pn-form-title">Assign Certification</div>
        <div class="pn-form-row"><label class="pn-label">Practitioner ID *</label><input class="pn-input" id="pnc-prac" placeholder="UUID of practitioner"></div>
        <div class="pn-form-row-2">
          <div class="pn-form-row"><label class="pn-label">Completion Date</label><input class="pn-input" id="pnc-comp" type="date"></div>
          <div class="pn-form-row"><label class="pn-label">Expiration Date</label><input class="pn-input" id="pnc-exp" type="date"></div>
        </div>
        <div class="pn-form-row">
          <label class="pn-label">New Certification Level (optional)</label>
          <select class="pn-input" id="pnc-level">
            <option value="">No change</option>
            <option value="foundation">Foundation</option><option value="practitioner">Practitioner</option>
            <option value="advanced">Advanced</option><option value="master">Master</option>
          </select>
        </div>
        <div class="pn-form-actions">
          <button class="pn-btn-primary" id="pnc-submit">Assign</button>
          <button class="pn-btn-cancel" onclick="document.getElementById('pn-cert-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('pnc-submit').addEventListener('click', submitCertForm);
  }

  async function submitCertForm() {
    const pracId = v('pnc-prac');
    if (!pracId) { toast('Practitioner ID is required', true); return; }
    const btn = document.getElementById('pnc-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await api('POST', '?action=assign_certification', {
      practitioner_id:    pracId,
      completion_date:    v('pnc-comp') || null,
      expiration_date:    v('pnc-exp')  || null,
      certification_level: document.getElementById('pnc-level').value || undefined,
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Assign'; return; }
    toast('Certification assigned'); loadSection('certifications');
  }

  window.pnExpireCert = async function (id) {
    const r = await api('PATCH', `?action=expire_certification&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Marked expired'); loadSection('certifications');
  };
  window.pnRenewCert = async function (id) {
    const expDate = prompt('New expiration date (YYYY-MM-DD):');
    if (!expDate) return;
    const r = await api('PATCH', `?action=renew_certification&id=${id}`, { expiration_date: expDate });
    if (r.error) { toast(r.error, true); return; }
    toast('Certification renewed'); loadSection('certifications');
  };

  // ── Referrals ──────────────────────────────────────────────────────────────
  async function loadReferrals(body) {
    const r = await api('GET', '?section=referrals');
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql to enable Referrals.'); return; }

    const refs = r.referrals || [];
    body.innerHTML = `
      <div>
        <div class="pn-section-header">
          <div class="pn-section-title">Referrals (${refs.length})</div>
          <div class="pn-header-actions">
            <button class="pn-btn-primary" id="pn-new-ref-btn">+ New Referral</button>
          </div>
        </div>
        <div id="pn-ref-form-area"></div>
        <div id="pn-ref-list">${refs.length ? refs.map(refCard).join('') : emptyEl('No referrals yet.')}</div>
      </div>`;
    document.getElementById('pn-new-ref-btn').addEventListener('click', showRefForm);
  }

  function refCard(r) {
    const prac = r.practitioners || {};
    const sc   = STATUS_COLORS[r.status] || '#7a7060';
    return `<div class="pn-prac-card" id="pn-ref-${r.id}">
      <div class="pn-prac-top">
        <div class="pn-prac-name">→ ${esc(prac.name || r.practitioner_id || '—')}</div>
        <span class="pn-status-badge" style="background:${sc}44;color:${sc};border:1px solid ${sc}33">${r.status}</span>
        <div class="pn-prac-actions">
          ${r.status === 'pending'  ? `<button class="pn-btn-approve" onclick="pnAcceptRef('${r.id}')">Accept</button>` : ''}
          ${r.status === 'accepted' ? `<button class="pn-btn-activate" onclick="pnCompleteRef('${r.id}')">Complete</button>` : ''}
          ${['pending','accepted'].includes(r.status) ? `<button class="pn-btn-reject" onclick="pnDeclineRef('${r.id}')">Decline</button>` : ''}
          <button class="pn-btn-delete" onclick="pnDeleteRef('${r.id}')">Delete</button>
        </div>
      </div>
      ${r.reason ? `<div class="pn-prac-bio">${esc(r.reason)}</div>` : ''}
      <div class="pn-prac-meta">Created ${fmtDate(r.created_at)}</div>
    </div>`;
  }

  function showRefForm() {
    const el = document.getElementById('pn-ref-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="pn-form" id="pn-ref-form">
        <div class="pn-form-title">New Referral</div>
        <div class="pn-form-row"><label class="pn-label">Practitioner ID *</label><input class="pn-input" id="pnr-prac" placeholder="UUID of practitioner"></div>
        <div class="pn-form-row"><label class="pn-label">Client ID (optional)</label><input class="pn-input" id="pnr-client" placeholder="UUID of client"></div>
        <div class="pn-form-row"><label class="pn-label">Reason</label><textarea class="pn-input pn-textarea-sm" id="pnr-reason" rows="3" placeholder="Why is this client being referred?"></textarea></div>
        <div class="pn-form-actions">
          <button class="pn-btn-primary" id="pnr-submit">Create Referral</button>
          <button class="pn-btn-cancel" onclick="document.getElementById('pn-ref-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('pnr-submit').addEventListener('click', submitRefForm);
  }

  async function submitRefForm() {
    const pracId = v('pnr-prac');
    if (!pracId) { toast('Practitioner ID is required', true); return; }
    const btn = document.getElementById('pnr-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await api('POST', '?action=create_referral', {
      practitioner_id: pracId,
      client_id: v('pnr-client') || null,
      reason:    v('pnr-reason') || null,
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Create Referral'; return; }
    toast('Referral created'); loadSection('referrals');
  }

  window.pnAcceptRef   = async function (id) {
    const r = await api('PATCH', `?action=accept_referral&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Accepted'); loadSection('referrals');
  };
  window.pnCompleteRef = async function (id) {
    const r = await api('PATCH', `?action=complete_referral&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Completed'); loadSection('referrals');
  };
  window.pnDeclineRef  = async function (id) {
    const r = await api('PATCH', `?action=decline_referral&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Declined'); loadSection('referrals');
  };
  window.pnDeleteRef   = async function (id) {
    if (!confirm('Delete this referral?')) return;
    const r = await api('PATCH', `?action=delete_referral&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Deleted'); document.getElementById('pn-ref-' + id)?.remove();
  };

  // ── Directory ──────────────────────────────────────────────────────────────
  async function loadDirectory(body, params) {
    const qs = params ? '?section=directory&' + params : '?section=directory';
    const r = await api('GET', qs);
    if (r.error) { body.innerHTML = errEl(r.error); return; }
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-practitioner-network.sql to enable the Directory.'); return; }

    const pracs = r.practitioners || [];
    body.innerHTML = `
      <div>
        <div class="pn-section-header">
          <div class="pn-section-title">Public Directory (${pracs.length} practitioners)</div>
        </div>
        <div class="pn-filters">
          <input class="pn-search" id="pn-dir-search" placeholder="Search by name…">
          <input class="pn-search" id="pn-dir-loc" placeholder="Location…" style="max-width:200px">
          <input class="pn-search" id="pn-dir-spec" placeholder="Specialty…" style="max-width:200px">
          <button class="pn-btn-secondary" id="pn-dir-filter-btn">Search</button>
        </div>
        <div class="pn-dir-grid" id="pn-dir-grid">
          ${pracs.length ? pracs.map(dirCard).join('') : emptyEl('No practitioners in the directory yet. Activate practitioners and enable their directory listing.')}
        </div>
      </div>`;

    document.getElementById('pn-dir-filter-btn').addEventListener('click', () => {
      const parts = [];
      const s = v('pn-dir-search'); if (s) parts.push('search=' + encodeURIComponent(s));
      const l = v('pn-dir-loc');    if (l) parts.push('location=' + encodeURIComponent(l));
      const sp = v('pn-dir-spec');  if (sp) parts.push('specialty=' + encodeURIComponent(sp));
      loadDirectory(body, parts.join('&'));
    });
  }

  function dirCard(p) {
    const lc   = CERT_LEVEL_COLORS[p.certification_level] || '#7a7060';
    const specs = (p.specialties || []).map(s => `<span class="pn-spec-chip">${esc(s)}</span>`).join('');
    return `<div class="pn-dir-card">
      <div class="pn-dir-name">${esc(p.name)}</div>
      ${p.location ? `<div class="pn-dir-loc">📍 ${esc(p.location)}</div>` : ''}
      ${p.bio ? `<div class="pn-dir-bio">${esc(p.bio).slice(0, 200)}…</div>` : ''}
      ${specs ? `<div class="pn-dir-specs">${specs}</div>` : ''}
      <span class="pn-dir-level" style="color:${lc}">${p.certification_level}</span>
    </div>`;
  }

  // ── API helper ─────────────────────────────────────────────────────────────
  async function api(method, qs, body) {
    const token = sessionStorage.getItem('rea_api_token') || '';
    const opts  = { method, headers: { 'X-Dashboard-Token': token } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try {
      const res  = await fetch(API + qs, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || ('HTTP ' + res.status) };
      return data;
    } catch (err) {
      return { error: err.message || 'Network error' };
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg, isErr) {
    const existing = document.querySelector('.pn-toast');
    if (existing) existing.remove();
    clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'pn-toast' + (isErr ? ' pn-toast-err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function v(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); } catch { return d; }
  }
  function shimmer() {
    return `<div class="pn-shimmer">${[0,1,2].map(() => `<div class="pn-shimmer-row"><div class="pn-shimmer-cell"></div><div class="pn-shimmer-cell"></div></div>`).join('')}</div>`;
  }
  function errEl(msg)  { return `<div class="pn-error">Error: ${esc(msg)}</div>`; }
  function warnEl(msg) { return `<div class="pn-warn">⚠ ${esc(msg)}</div>`; }
  function emptyEl(msg){ return `<div class="pn-empty">${esc(msg)}</div>`; }

  // ── Expose global entry ────────────────────────────────────────────────────
  window.pnInit = pnInit;

})();
