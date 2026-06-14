// lp-module.js — Lead Pipeline frontend IIFE
// Renders into #tab-lp. Called by showTab('lp') → lpInit().
// Auth: sessionStorage 'rea_api_token' → X-Dashboard-Token header.
// API: /.netlify/functions/lead-pipeline

(function () {
  'use strict';

  const API = '/.netlify/functions/lead-pipeline';

  const SECTIONS = ['dashboard','pipeline','leads','referrals','conversions','lost'];
  const SECTION_LABELS = {
    dashboard:   'Dashboard',
    pipeline:    'Pipeline',
    leads:       'All Leads',
    referrals:   'Referral Sources',
    conversions: 'Conversions',
    lost:        'Lost Opportunities',
  };

  const STATUS_COLORS = {
    new:          '#e8b84b',
    contacted:    '#b09ef8',
    consultation: '#22c98a',
    booked:       '#50b8f8',
    converted:    '#22c98a',
    lost:         '#dc9090',
    archived:     '#5a6050',
  };

  const SOURCE_ICONS = {
    website: '🌐', facebook: '📘', instagram: '📸', tiktok: '🎵',
    youtube: '▶️', referral: '🤝', workshop: '🎓', event: '🎪',
    returning_client: '🔄', google: '🔍', email: '📧', phone: '📞', other: '◈',
  };

  const SOURCES = ['website','facebook','instagram','tiktok','youtube','referral','workshop','event','returning_client','google','email','phone','other'];
  const STATUSES = ['new','contacted','consultation','booked','converted','lost','archived'];
  const RS_TYPES = ['client','practitioner','business','social_media','website','event','workshop','other'];

  let currentSection = 'dashboard';
  let toastTimer = null;

  // ── Entry ──────────────────────────────────────────────────────────────────
  function lpInit() {
    const root = document.getElementById('tab-lp');
    if (!root) return;
    root.innerHTML = `
      <div class="lp-wrap">
        <nav class="lp-subnav" id="lp-subnav"></nav>
        <div class="lp-body" id="lp-body"></div>
      </div>`;
    renderSubnav(currentSection);
    loadSection(currentSection);
  }

  function renderSubnav(active) {
    const nav = document.getElementById('lp-subnav');
    if (!nav) return;
    nav.innerHTML = SECTIONS.map(s =>
      `<button class="lp-snav${s === active ? ' lp-snav-active' : ''}" data-s="${s}">${SECTION_LABELS[s]}</button>`
    ).join('');
    nav.querySelectorAll('.lp-snav').forEach(btn =>
      btn.addEventListener('click', () => switchSection(btn.dataset.s))
    );
  }

  function switchSection(s) {
    currentSection = s;
    renderSubnav(s);
    loadSection(s);
  }

  function loadSection(s) {
    const body = document.getElementById('lp-body');
    if (!body) return;
    body.innerHTML = shimmer();
    if (s === 'dashboard')   loadDashboard(body);
    else if (s === 'pipeline')    loadPipeline(body);
    else if (s === 'leads')       loadLeads(body);
    else if (s === 'referrals')   loadReferrals(body);
    else if (s === 'conversions') loadConversions(body);
    else if (s === 'lost')        loadLost(body);
  }

  // expose for onclick
  window.lpGoto = s => switchSection(s);

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard(body) {
    const r = await api('GET', '?section=dashboard');
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration 2026-06-13-lead-pipeline.sql in Supabase to enable the Lead Pipeline.'); return; }
    if (r.error) { body.innerHTML = errEl(r.error); return; }

    const k  = r.kpis || {};
    const sc = r.status_counts || {};
    const srcs = r.source_counts || {};

    const topSources = Object.entries(srcs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([src, cnt]) => `<div class="lp-pipe-item"><span>${SOURCE_ICONS[src] || '◈'} ${src}</span><span class="lp-pipe-count">${cnt}</span></div>`)
      .join('') || '<div class="lp-empty-sm">No data yet</div>';

    body.innerHTML = `
      <div>
        <div class="lp-kpi-row">
          ${kpi('🎯', k.total_leads      ?? 0, 'Total Leads')}
          ${kpi('✨', k.new_leads        ?? 0, 'New')}
          ${kpi('⚡', k.active_leads     ?? 0, 'Active')}
          ${kpi('✅', k.converted_leads  ?? 0, 'Converted')}
          ${kpi('❌', k.lost_leads       ?? 0, 'Lost')}
          ${kpi('📈', (k.conversion_rate ?? 0) + '%', 'Conv. Rate')}
          ${kpi('🤝', k.referral_sources ?? 0, 'Ref. Sources')}
          ${kpi('💰', '$' + fmtMoney(k.revenue_from_leads ?? 0), 'Revenue')}
        </div>

        <div class="lp-dash-grid">
          <div class="lp-dash-card">
            <div class="lp-dash-card-title">Pipeline Status</div>
            <div class="lp-pipeline-mini">
              ${STATUSES.map(s => `
                <div class="lp-pipe-item">
                  <span class="lp-pipe-dot" style="background:${STATUS_COLORS[s]}"></span>
                  <span class="lp-pipe-lbl">${s}</span>
                  <span class="lp-pipe-count">${sc[s] ?? 0}</span>
                </div>`).join('')}
            </div>
          </div>
          <div class="lp-dash-card">
            <div class="lp-dash-card-title">Top Lead Sources</div>
            ${topSources}
          </div>
          <div class="lp-dash-card">
            <div class="lp-dash-card-title">Quick Actions</div>
            <div class="lp-quick-actions">
              <button class="lp-quick-btn" onclick="lpGoto('leads'); setTimeout(()=>document.getElementById('lp-new-lead-btn')?.click(),300)">+ New Lead</button>
              <button class="lp-quick-btn" onclick="lpGoto('pipeline')">View Pipeline</button>
              <button class="lp-quick-btn" onclick="lpGoto('conversions')">View Conversions</button>
              <button class="lp-quick-btn" onclick="lpGoto('referrals')">Manage Referral Sources</button>
            </div>
          </div>
          <div class="lp-dash-card">
            <div class="lp-dash-card-title">Revenue by Source</div>
            <div id="lp-rev-by-source">Loading…</div>
          </div>
        </div>
      </div>`;

    // Load revenue by source async
    loadRevenueBySource();
  }

  async function loadRevenueBySource() {
    const el = document.getElementById('lp-rev-by-source');
    if (!el) return;
    const r = await api('GET', '?section=analytics');
    if (r.migration_needed || r.error) { el.innerHTML = '<div class="lp-empty-sm">No data</div>'; return; }
    const bySource = (r.analytics || {}).by_source || {};
    const rows = Object.entries(bySource)
      .filter(([, d]) => d.revenue > 0)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6);
    if (!rows.length) { el.innerHTML = '<div class="lp-empty-sm">No converted leads yet</div>'; return; }
    el.innerHTML = rows.map(([src, d]) =>
      `<div class="lp-pipe-item">
        <span>${SOURCE_ICONS[src] || '◈'} ${src}</span>
        <span class="lp-pipe-count">$${fmtMoney(d.revenue)} <span style="color:#5a6050;font-size:.7rem">(${d.clients} clients)</span></span>
      </div>`
    ).join('');
  }

  // ── Pipeline ───────────────────────────────────────────────────────────────
  async function loadPipeline(body) {
    const r = await api('GET', '?section=pipeline');
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration to enable Lead Pipeline.'); return; }
    if (r.error) { body.innerHTML = errEl(r.error); return; }

    const p = r.pipeline || {};
    const stages = ['new','contacted','consultation','booked'];

    body.innerHTML = `
      <div>
        <div class="lp-section-header">
          <div class="lp-section-title">Active Pipeline (${r.total ?? 0} leads)</div>
        </div>
        <div class="lp-pipeline-cols">
          ${stages.map(stage => `
            <div class="lp-pipeline-col">
              <div class="lp-pipeline-col-hdr" style="border-top:3px solid ${STATUS_COLORS[stage]}">
                <span>${stage.toUpperCase()}</span>
                <span class="lp-col-count">${(p[stage] || []).length}</span>
              </div>
              <div class="lp-pipeline-col-body" id="lp-col-${stage}">
                ${(p[stage] || []).length ? (p[stage] || []).map(leadPipeCard).join('') : '<div class="lp-empty-sm">Empty</div>'}
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function leadPipeCard(l) {
    const sc = STATUS_COLORS[l.status] || '#7a7060';
    return `<div class="lp-pipe-card" id="lp-pipe-${l.id}">
      <div class="lp-pipe-card-name">${esc(l.first_name)} ${esc(l.last_name || '')}</div>
      ${l.interested_service ? `<div class="lp-pipe-card-svc">${esc(l.interested_service)}</div>` : ''}
      <div class="lp-pipe-card-meta">
        ${SOURCE_ICONS[l.source] || '◈'} ${l.source}
        ${l.last_contact_date ? ' · ' + fmtDate(l.last_contact_date) : ''}
      </div>
      <div class="lp-pipe-card-actions">
        <button class="lp-btn-sm" onclick="lpAdvanceStatus('${l.id}','${l.status}')">Advance →</button>
        <button class="lp-btn-sm lp-btn-sm-red" onclick="lpLoseLead('${l.id}')">Lost</button>
      </div>
    </div>`;
  }

  window.lpAdvanceStatus = async function (id, currentStatus) {
    const order = ['new','contacted','consultation','booked','converted'];
    const next  = order[order.indexOf(currentStatus) + 1];
    if (!next) return;
    if (next === 'converted') { lpConvertLead(id); return; }
    const r = await api('PATCH', `?action=update_status&id=${id}`, { status: next });
    if (r.error) { toast(r.error, true); return; }
    toast('Advanced to ' + next);
    loadSection('pipeline');
  };

  window.lpLoseLead = async function (id) {
    const reason = prompt('Reason for loss (optional):') || '';
    const r = await api('PATCH', `?action=lose_lead&id=${id}`, { reason });
    if (r.error) { toast(r.error, true); return; }
    toast('Lead marked lost');
    loadSection('pipeline');
  };

  window.lpConvertLead = function (id) {
    const clientId = prompt('Client UUID (leave blank if not yet created):') || '';
    const service  = prompt('Service purchased:') || '';
    const revenue  = parseFloat(prompt('Revenue ($):') || '0') || 0;
    api('PATCH', `?action=convert_lead&id=${id}`, {
      converted_client_id: clientId || null,
      converted_service:   service  || null,
      converted_revenue:   revenue,
    }).then(r => {
      if (r.error) { toast(r.error, true); return; }
      toast('Lead converted! 🎉');
      loadSection('pipeline');
    });
  };

  // ── All Leads ──────────────────────────────────────────────────────────────
  async function loadLeads(body, params) {
    const qs = params ? '?section=leads&' + params : '?section=leads';
    const r = await api('GET', qs);
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration to enable Lead Pipeline.'); return; }
    if (r.error) { body.innerHTML = errEl(r.error); return; }

    const leads = r.leads || [];
    body.innerHTML = `
      <div>
        <div class="lp-section-header">
          <div class="lp-section-title">All Leads (${leads.length})</div>
          <div class="lp-header-actions">
            <button class="lp-btn-primary" id="lp-new-lead-btn">+ New Lead</button>
          </div>
        </div>
        <div class="lp-filters">
          <input class="lp-search" id="lp-lead-search" placeholder="Search name or email…">
          <select class="lp-filter-select" id="lp-lead-status">
            <option value="">All Statuses</option>
            ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <select class="lp-filter-select" id="lp-lead-source">
            <option value="">All Sources</option>
            ${SOURCES.map(s => `<option value="${s}">${SOURCE_ICONS[s] || ''} ${s}</option>`).join('')}
          </select>
          <button class="lp-btn-secondary" id="lp-lead-filter-btn">Filter</button>
        </div>
        <div id="lp-lead-form-area"></div>
        <div id="lp-lead-list">${leads.length ? leads.map(leadCard).join('') : emptyEl('No leads yet. Add your first lead to start tracking.')}</div>
      </div>`;

    document.getElementById('lp-new-lead-btn').addEventListener('click', () => showLeadForm());
    document.getElementById('lp-lead-filter-btn').addEventListener('click', () => {
      const parts = [];
      const s = v('lp-lead-search'); if (s) parts.push('search=' + encodeURIComponent(s));
      const st = document.getElementById('lp-lead-status').value; if (st) parts.push('status=' + st);
      const src = document.getElementById('lp-lead-source').value; if (src) parts.push('source=' + src);
      loadLeads(body, parts.join('&'));
    });
  }

  function leadCard(l) {
    const sc = STATUS_COLORS[l.status] || '#7a7060';
    const rs = l.referral_sources;
    return `<div class="lp-lead-card" id="lp-lead-${l.id}">
      <div class="lp-lead-top">
        <div>
          <div class="lp-lead-name">${esc(l.first_name)} ${esc(l.last_name || '')}</div>
          ${l.email ? `<div class="lp-lead-email">${esc(l.email)}</div>` : ''}
        </div>
        <span class="lp-status-badge" style="background:${sc}33;color:${sc};border:1px solid ${sc}44">${l.status}</span>
        <span class="lp-source-chip">${SOURCE_ICONS[l.source] || '◈'} ${l.source}</span>
        <div class="lp-lead-actions">
          <button class="lp-btn-sm" onclick="lpLogContact('${l.id}')">Log Contact</button>
          <button class="lp-btn-sm" onclick="lpAdvanceStatus('${l.id}','${l.status}')">Advance →</button>
          ${l.status !== 'converted' ? `<button class="lp-btn-sm lp-btn-sm-green" onclick="lpConvertLead('${l.id}')">Convert</button>` : ''}
          ${l.status !== 'lost' ? `<button class="lp-btn-sm lp-btn-sm-red" onclick="lpLoseLead('${l.id}')">Lost</button>` : ''}
          <button class="lp-btn-sm lp-btn-sm-del" onclick="lpDeleteLead('${l.id}')">×</button>
        </div>
      </div>
      ${l.interested_service ? `<div class="lp-lead-svc">Interested in: ${esc(l.interested_service)}</div>` : ''}
      ${rs ? `<div class="lp-lead-ref">Referred by: ${esc(rs.name)}</div>` : ''}
      ${l.notes ? `<div class="lp-lead-notes">${esc(l.notes).slice(0,120)}${l.notes.length > 120 ? '…' : ''}</div>` : ''}
      <div class="lp-lead-meta">
        Contacts: ${l.contact_count || 0}
        ${l.first_contact_date ? ' · First: ' + fmtDate(l.first_contact_date) : ''}
        ${l.last_contact_date  ? ' · Last: '  + fmtDate(l.last_contact_date)  : ''}
        ${l.converted_at ? ' · Converted: ' + fmtDate(l.converted_at) : ''}
        ${l.converted_revenue ? ' · $' + fmtMoney(l.converted_revenue) : ''}
      </div>
    </div>`;
  }

  function showLeadForm() {
    const el = document.getElementById('lp-lead-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="lp-form" id="lp-lead-form">
        <div class="lp-form-title">New Lead</div>
        <div class="lp-form-row-2">
          <div class="lp-form-row"><label class="lp-label">First Name *</label><input class="lp-input" id="lpf-fname" placeholder="First name"></div>
          <div class="lp-form-row"><label class="lp-label">Last Name</label><input class="lp-input" id="lpf-lname" placeholder="Last name"></div>
        </div>
        <div class="lp-form-row-2">
          <div class="lp-form-row"><label class="lp-label">Email</label><input class="lp-input" id="lpf-email" type="email"></div>
          <div class="lp-form-row"><label class="lp-label">Phone</label><input class="lp-input" id="lpf-phone"></div>
        </div>
        <div class="lp-form-row-2">
          <div class="lp-form-row">
            <label class="lp-label">Source *</label>
            <select class="lp-input" id="lpf-source">
              ${SOURCES.map(s => `<option value="${s}">${SOURCE_ICONS[s] || ''} ${s}</option>`).join('')}
            </select>
          </div>
          <div class="lp-form-row"><label class="lp-label">Source Detail</label><input class="lp-input" id="lpf-srcdetail" placeholder="e.g. specific post, campaign name"></div>
        </div>
        <div class="lp-form-row"><label class="lp-label">Interested Service</label><input class="lp-input" id="lpf-service" placeholder="e.g. Reiki Session, Distance Healing"></div>
        <div class="lp-form-row"><label class="lp-label">Notes</label><textarea class="lp-input lp-textarea-sm" id="lpf-notes" rows="3" placeholder="Initial notes…"></textarea></div>
        <div class="lp-form-actions">
          <button class="lp-btn-primary" id="lpf-submit">Add Lead</button>
          <button class="lp-btn-cancel" onclick="document.getElementById('lp-lead-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('lpf-submit').addEventListener('click', submitLeadForm);
  }

  async function submitLeadForm() {
    const firstName = v('lpf-fname');
    if (!firstName) { toast('First name is required', true); return; }
    const btn = document.getElementById('lpf-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await api('POST', '?action=create_lead', {
      first_name:         firstName,
      last_name:          v('lpf-lname')    || null,
      email:              v('lpf-email')    || null,
      phone:              v('lpf-phone')    || null,
      source:             document.getElementById('lpf-source').value,
      source_detail:      v('lpf-srcdetail') || null,
      interested_service: v('lpf-service')  || null,
      notes:              v('lpf-notes')    || null,
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Add Lead'; return; }
    toast('Lead added');
    loadSection('leads');
  }

  window.lpLogContact = async function (id) {
    const r = await api('PATCH', `?action=log_contact&id=${id}`, {});
    if (r.error) { toast(r.error, true); return; }
    toast('Contact logged (' + r.lead.contact_count + ' total)');
    const card = document.getElementById('lp-lead-' + id);
    if (card) { const meta = card.querySelector('.lp-lead-meta'); if (meta) meta.textContent = 'Contacts: ' + r.lead.contact_count; }
  };

  window.lpDeleteLead = async function (id) {
    if (!confirm('Soft-delete this lead? The record will be preserved for analytics.')) return;
    const r = await api('PATCH', `?action=delete_lead&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Lead removed');
    document.getElementById('lp-lead-' + id)?.remove();
  };

  // ── Referral Sources ───────────────────────────────────────────────────────
  async function loadReferrals(body) {
    const r = await api('GET', '?section=referral_sources');
    if (r.migration_needed) { body.innerHTML = warnEl('Run migration to enable Referral Sources.'); return; }
    if (r.error) { body.innerHTML = errEl(r.error); return; }

    const sources = r.referral_sources || [];
    body.innerHTML = `
      <div>
        <div class="lp-section-header">
          <div class="lp-section-title">Referral Sources (${sources.length})</div>
          <div class="lp-header-actions">
            <button class="lp-btn-primary" id="lp-new-rs-btn">+ Add Referral Source</button>
          </div>
        </div>
        <div id="lp-rs-form-area"></div>
        <div id="lp-rs-list">${sources.length ? sources.map(rsCard).join('') : emptyEl('No referral sources yet. Add your first source to start tracking referrals.')}</div>
      </div>`;
    document.getElementById('lp-new-rs-btn').addEventListener('click', showRsForm);
  }

  function rsCard(rs) {
    const activeColor = rs.active ? '#22c98a' : '#5a6050';
    return `<div class="lp-lead-card" id="lp-rs-${rs.id}">
      <div class="lp-lead-top">
        <div>
          <div class="lp-lead-name">${esc(rs.name)}</div>
          <div class="lp-lead-email">${esc(rs.source_type)}</div>
        </div>
        <span class="lp-status-badge" style="background:${activeColor}22;color:${activeColor};border:1px solid ${activeColor}44">${rs.active ? 'Active' : 'Inactive'}</span>
        <div class="lp-lead-actions">
          <button class="lp-btn-sm" onclick="lpToggleRsActive('${rs.id}',${!rs.active})">
            ${rs.active ? 'Deactivate' : 'Activate'}
          </button>
          <button class="lp-btn-sm lp-btn-sm-del" onclick="lpDeleteRs('${rs.id}')">×</button>
        </div>
      </div>
      ${rs.contact_info ? `<div class="lp-lead-svc">${esc(rs.contact_info)}</div>` : ''}
      ${rs.notes ? `<div class="lp-lead-notes">${esc(rs.notes)}</div>` : ''}
      <div class="lp-lead-meta">Added ${fmtDate(rs.created_at)}</div>
    </div>`;
  }

  function showRsForm() {
    const el = document.getElementById('lp-rs-form-area');
    if (!el) return;
    el.innerHTML = `
      <div class="lp-form" id="lp-rs-form">
        <div class="lp-form-title">New Referral Source</div>
        <div class="lp-form-row-2">
          <div class="lp-form-row"><label class="lp-label">Name *</label><input class="lp-input" id="lprs-name" placeholder="e.g. Jane Smith, Erie Wellness Co."></div>
          <div class="lp-form-row">
            <label class="lp-label">Type *</label>
            <select class="lp-input" id="lprs-type">
              ${RS_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="lp-form-row"><label class="lp-label">Contact Info</label><input class="lp-input" id="lprs-contact" placeholder="Email, phone, or Instagram handle"></div>
        <div class="lp-form-row"><label class="lp-label">Notes</label><textarea class="lp-input lp-textarea-sm" id="lprs-notes" rows="2" placeholder="Partnership details, agreement notes…"></textarea></div>
        <div class="lp-form-actions">
          <button class="lp-btn-primary" id="lprs-submit">Add Source</button>
          <button class="lp-btn-cancel" onclick="document.getElementById('lp-rs-form').remove()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('lprs-submit').addEventListener('click', submitRsForm);
  }

  async function submitRsForm() {
    const name = v('lprs-name');
    if (!name) { toast('Name is required', true); return; }
    const btn = document.getElementById('lprs-submit');
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await api('POST', '?action=create_referral_source', {
      name,
      source_type:  document.getElementById('lprs-type').value,
      contact_info: v('lprs-contact') || null,
      notes:        v('lprs-notes')   || null,
    });
    if (r.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Add Source'; return; }
    toast('Referral source added');
    loadSection('referrals');
  }

  window.lpToggleRsActive = async function (id, active) {
    const r = await api('PATCH', `?action=update_referral_source&id=${id}`, { active });
    if (r.error) { toast(r.error, true); return; }
    toast(active ? 'Activated' : 'Deactivated');
    loadSection('referrals');
  };

  window.lpDeleteRs = async function (id) {
    if (!confirm('Delete this referral source? This cannot be undone.')) return;
    const r = await api('PATCH', `?action=delete_referral_source&id=${id}`);
    if (r.error) { toast(r.error, true); return; }
    toast('Deleted');
    document.getElementById('lp-rs-' + id)?.remove();
  };

  // ── Conversions ────────────────────────────────────────────────────────────
  async function loadConversions(body) {
    const [leadsR, analyticsR] = await Promise.all([
      api('GET', '?section=leads&status=converted'),
      api('GET', '?section=analytics'),
    ]);
    if (leadsR.migration_needed) { body.innerHTML = warnEl('Run migration to enable Conversion Tracking.'); return; }

    const leads = leadsR.leads || [];
    const an    = (analyticsR.analytics) || {};
    const bySource = an.by_source || {};

    body.innerHTML = `
      <div>
        <div class="lp-kpi-row" style="grid-template-columns:repeat(4,1fr)">
          ${kpi('✅', leads.length, 'Converted')}
          ${kpi('📈', (an.conversion_rate_pct ?? 0) + '%', 'Conv. Rate')}
          ${kpi('💰', '$' + fmtMoney(an.total_revenue ?? 0), 'Total Revenue')}
          ${kpi('⏱', an.avg_days_to_convert ? an.avg_days_to_convert + 'd' : '—', 'Avg. Days')}
        </div>

        <div class="lp-dash-grid">
          <div class="lp-dash-card" style="grid-column:1/-1">
            <div class="lp-dash-card-title">Revenue by Source</div>
            <div class="lp-rev-table">
              <div class="lp-rev-row lp-rev-hdr">
                <span>Source</span><span>Leads</span><span>Clients</span><span>Revenue</span><span>Conv %</span>
              </div>
              ${Object.entries(bySource).sort((a,b) => b[1].revenue - a[1].revenue).map(([src, d]) => `
                <div class="lp-rev-row">
                  <span>${SOURCE_ICONS[src] || '◈'} ${src}</span>
                  <span>${d.leads}</span>
                  <span>${d.clients}</span>
                  <span>$${fmtMoney(d.revenue)}</span>
                  <span>${d.leads > 0 ? Math.round(d.clients/d.leads*100) : 0}%</span>
                </div>`).join('') || '<div class="lp-empty-sm">No converted leads yet</div>'}
            </div>
          </div>
        </div>

        <div class="lp-section-title" style="margin-top:24px">Converted Leads</div>
        <div style="margin-top:12px">
          ${leads.length ? leads.map(leadCard).join('') : emptyEl('No converted leads yet. Convert leads from the Pipeline or All Leads view.')}
        </div>
      </div>`;
  }

  // ── Lost Opportunities ─────────────────────────────────────────────────────
  async function loadLost(body) {
    const [lostR, analyticsR] = await Promise.all([
      api('GET', '?section=lost'),
      api('GET', '?section=analytics'),
    ]);
    if (lostR.migration_needed) { body.innerHTML = warnEl('Run migration to enable Lost Opportunity tracking.'); return; }

    const leads = lostR.leads || [];
    const an    = (analyticsR.analytics) || {};

    body.innerHTML = `
      <div>
        <div class="lp-kpi-row" style="grid-template-columns:repeat(3,1fr)">
          ${kpi('❌', leads.length, 'Lost')}
          ${kpi('📉', (an.lost_opportunity_rate ?? 0) + '%', 'Loss Rate')}
          ${kpi('💸', '$' + fmtMoney(leads.reduce((s,l) => s, 0)), 'Opp. Lost')}
        </div>
        <div class="lp-section-title" style="margin-top:24px">Lost &amp; Archived Leads</div>
        <div style="margin-top:12px">
          ${leads.length ? leads.map(leadCard).join('') : emptyEl('No lost leads. Great work!')}
        </div>
      </div>`;
  }

  // ── API helper ─────────────────────────────────────────────────────────────
  async function api(method, qs, body) {
    const token = sessionStorage.getItem('rea_api_token') || '';
    const opts  = { method, headers: { 'X-Dashboard-Token': token } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
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
    const existing = document.querySelector('.lp-toast');
    if (existing) existing.remove();
    clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'lp-toast' + (isErr ? ' lp-toast-err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); } catch { return d; }
  }
  function fmtMoney(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function kpi(icon, num, lbl) {
    return `<div class="lp-kpi"><div class="lp-kpi-icon">${icon}</div><div class="lp-kpi-num">${num}</div><div class="lp-kpi-lbl">${lbl}</div></div>`;
  }
  function shimmer() {
    return `<div class="lp-shimmer">${[0,1,2].map(() =>
      `<div class="lp-shimmer-row"><div class="lp-shimmer-cell"></div><div class="lp-shimmer-cell"></div></div>`
    ).join('')}</div>`;
  }
  function errEl(msg)  { return `<div class="lp-error">Error: ${esc(msg)}</div>`; }
  function warnEl(msg) { return `<div class="lp-warn">⚠ ${esc(msg)}</div>`; }
  function emptyEl(msg){ return `<div class="lp-empty">${esc(msg)}</div>`; }

  window.lpInit = lpInit;

})();
