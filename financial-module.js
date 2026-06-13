// financial-module.js
// Financial Center — Packages · Ledger · Invoices · Revenue Analytics
// Loaded after pin-lock; all API calls require X-Dashboard-Token.

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var _currentSection = 'overview';
  var _initialized    = false;

  // ── API helper ───────────────────────────────────────────────────────────
  function tok() { return sessionStorage.getItem('rea_api_token') || ''; }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch('/.netlify/functions' + path, Object.assign({}, opts, {
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'X-Dashboard-Token': tok() },
        opts.headers || {}
      ),
    }));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoney(n) {
    var v = parseFloat(n || 0);
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtDate(d) {
    if (!d) return '—';
    var dt = new Date(d + (d.length === 10 ? 'T12:00:00' : ''));
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function pill(status) {
    return '<span class="fc-pill ' + esc(status) + '">' + esc(status) + '</span>';
  }

  function kpi(label, value, cls, sub) {
    return '<div class="fc-kpi">' +
      '<div class="fc-kpi-label">' + esc(label) + '</div>' +
      '<div class="fc-kpi-val' + (cls ? ' ' + cls : '') + '">' + esc(String(value)) + '</div>' +
      (sub ? '<div class="fc-kpi-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function sectionHead(title, btnLabel, btnFn) {
    var btn = btnLabel
      ? '<button onclick="' + esc(btnFn) + '">' + esc(btnLabel) + '</button>'
      : '';
    return '<div class="fc-section-head">' + esc(title) + btn + '</div>';
  }

  function loading(el) {
    el.innerHTML = '<div class="fc-empty" style="font-size:14px;letter-spacing:.3em;font-style:normal;' +
      'font-family:\'Cinzel\',serif;color:rgba(232,184,75,.3)">LOADING…</div>';
  }

  function errBox(el, msg) {
    el.innerHTML = '<div class="fc-empty" style="color:#ee7070">' + esc(msg) + '</div>';
  }

  // ── Entry point (called by showTab) ─────────────────────────────────────
  window.fcInit = function () {
    if (!_initialized) {
      _initialized = true;
      _currentSection = 'overview';
    }
    fcSection(_currentSection);
    loadAlertBanner();
  };

  // ── Sub-section router ───────────────────────────────────────────────────
  window.fcSection = function (name) {
    _currentSection = name;
    // Update pill nav
    document.querySelectorAll('.fin-sub').forEach(function (b) {
      b.classList.toggle('active', b.dataset.section === name);
    });
    // Hide all sections
    document.querySelectorAll('.fc-section').forEach(function (el) {
      el.style.display = 'none';
    });
    var el = document.getElementById('fc-' + name);
    if (el) el.style.display = 'block';

    if (name === 'overview') renderOverview();
    if (name === 'packages') renderPackages();
    if (name === 'ledger')   renderLedger();
    if (name === 'invoices') renderInvoices();
    if (name === 'revenue')  renderRevenue();
  };

  // ── Alert banner ─────────────────────────────────────────────────────────
  async function loadAlertBanner() {
    try {
      var data = await api('/financial?section=alerts');
      var banner = document.getElementById('finAlertBanner');
      var text   = document.getElementById('finAlertBannerText');
      if (!banner || !text) return;
      if (data.count > 0) {
        text.textContent = data.count + ' financial alert' + (data.count !== 1 ? 's' : '') +
          ' require attention.';
        banner.style.display = 'flex';
      }
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════
  async function renderOverview() {
    var el = document.getElementById('fc-overview');
    loading(el);
    try {
      var [ovData, alertData] = await Promise.all([
        api('/financial?section=overview'),
        api('/financial?section=alerts'),
      ]);
      var r = ovData.revenue   || {};
      var p = ovData.packages  || {};
      var i = ovData.invoices  || {};

      var html = '';

      // Revenue KPIs
      html += sectionHead('Revenue');
      html += '<div class="fc-kpi-row">';
      html += kpi('Total Revenue',       fmtMoney(r.total),       'green');
      html += kpi('Monthly Revenue',     fmtMoney(r.monthly),     r.monthly > 0 ? 'green' : '');
      html += kpi('Outstanding',         fmtMoney(r.outstanding), r.outstanding > 0 ? 'amber' : 'green',
                  'unpaid / partial sessions');
      html += kpi('Package Revenue',     fmtMoney(r.packageRevenue));
      html += '</div>';

      // Package KPIs
      html += sectionHead('Packages');
      html += '<div class="fc-kpi-row">';
      html += kpi('Active Packages',     p.active,        p.active > 0 ? 'green' : '');
      html += kpi('Expiring Soon',       p.expiringSoon,  p.expiringSoon > 0 ? 'amber' : 'green',
                  'within 14 days');
      html += kpi('Utilization Rate',    p.utilizationRate + '%', p.utilizationRate >= 80 ? 'green' : 'amber');
      html += kpi('Total Packages',      p.totalPackages || 0);
      html += '</div>';

      // Invoice KPIs
      html += sectionHead('Invoices');
      html += '<div class="fc-kpi-row">';
      html += kpi('Overdue',             i.overdue,               i.overdue > 0 ? 'red' : 'green');
      html += kpi('Outstanding Amount',  fmtMoney(i.outstanding), i.outstanding > 0 ? 'amber' : 'green');
      html += kpi('Paid This Month',     fmtMoney(i.paidThisMonth), 'green');
      html += '</div>';

      // Alerts
      var alerts = alertData.alerts || [];
      if (alerts.length > 0) {
        html += sectionHead('Alerts — Action Required');
        html += alerts.slice(0, 8).map(function (a) {
          return '<div class="fc-alert-card ' + esc(a.severity) + '">' +
            '<span class="fc-alert-sev ' + esc(a.severity) + '">' + esc(a.severity) + '</span>' +
            '<div><div class="fc-alert-title">' + esc(a.title) + '</div>' +
            (a.body ? '<div class="fc-alert-body">' + esc(a.body) + '</div>' : '') +
            '</div>' +
            '<button onclick="fcDismissAlert(\'' + esc(a.id) + '\',this)" ' +
              'style="margin-left:auto;flex-shrink:0;font-family:\'Cinzel\',serif;font-size:8px;' +
              'letter-spacing:.25em;text-transform:uppercase;color:rgba(176,158,248,.4);' +
              'border:1px solid rgba(176,158,248,.15);background:transparent;padding:4px 10px;cursor:pointer">' +
              'Dismiss</button>' +
            '</div>';
        }).join('');
      }

      el.innerHTML = html;
    } catch (e) {
      errBox(el, 'Could not load overview: ' + e.message);
    }
  }

  window.fcDismissAlert = async function (id, btn) {
    try {
      btn.disabled = true;
      await api('/financial?action=mark_alert_read&id=' + id, { method: 'PATCH', body: '{}' });
      var card = btn.closest('.fc-alert-card');
      if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
    } catch (e) { btn.disabled = false; }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PACKAGES
  // ══════════════════════════════════════════════════════════════════════════
  async function renderPackages() {
    var el = document.getElementById('fc-packages');
    loading(el);
    try {
      var data = await api('/financial?section=packages');
      var pkgs = data.packages || [];

      var html = sectionHead('Package Management', '+ New Package', "fcToggleForm('pkg-form')");

      // New package form
      html += '<div class="fc-form-panel" id="pkg-form">' +
        '<div class="fc-section-head" style="font-size:11px;margin-bottom:18px">New Package</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field"><label>Client Name</label>' +
            '<input class="fc-input" id="pkgClientName" placeholder="e.g. Jane Smith"></div>' +
          '<div class="fc-field"><label>Package Type</label>' +
            '<select class="fc-select" id="pkgType" onchange="fcPkgTypeChange()">' +
              '<option value="single">Single Session</option>' +
              '<option value="3_session">3 Session Package</option>' +
              '<option value="5_session">5 Session Package</option>' +
              '<option value="10_session">10 Session Package</option>' +
              '<option value="custom">Custom</option>' +
            '</select></div>' +
          '<div class="fc-field" id="pkgSessField" style="display:none"><label>Sessions Included</label>' +
            '<input class="fc-input" id="pkgSessions" type="number" min="1" value="1"></div>' +
        '</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field"><label>Purchase Price ($)</label>' +
            '<input class="fc-input" id="pkgPrice" type="number" min="0" step="0.01" placeholder="0.00"></div>' +
          '<div class="fc-field"><label>Purchase Date</label>' +
            '<input class="fc-input" id="pkgDate" type="date" value="' + new Date().toISOString().slice(0,10) + '"></div>' +
          '<div class="fc-field"><label>Expiration Date (optional)</label>' +
            '<input class="fc-input" id="pkgExpiry" type="date"></div>' +
        '</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field" style="flex:2"><label>Notes (optional)</label>' +
            '<input class="fc-input" id="pkgNotes" placeholder="Any notes about this package"></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:6px">' +
          '<button class="fc-btn primary" onclick="fcSavePackage()">Save Package</button>' +
          '<button class="fc-btn" onclick="fcToggleForm(\'pkg-form\')">Cancel</button>' +
        '</div>' +
        '<div id="pkgFormMsg" style="margin-top:10px;font-family:\'EB Garamond\',serif;font-size:15px"></div>' +
        '</div>';

      // Filter tabs
      var active    = pkgs.filter(function (p) { return p.status === 'active'; });
      var expiring  = pkgs.filter(function (p) {
        if (p.status !== 'active' || !p.expiration_date) return false;
        return (new Date(p.expiration_date) - new Date()) / 86400000 <= 14;
      });
      var completed = pkgs.filter(function (p) { return p.status === 'completed'; });
      var expired   = pkgs.filter(function (p) { return p.status === 'expired' || p.status === 'cancelled'; });

      // Package revenue total
      var pkgRevTotal = pkgs.reduce(function (s, p) { return s + Number(p.purchase_price || 0); }, 0);
      var utilSess    = pkgs.reduce(function (s, p) { return s + Number(p.sessions_used || 0); }, 0);
      var totalSess   = pkgs.reduce(function (s, p) { return s + Number(p.sessions_included || 0); }, 0);
      var utilRate    = totalSess > 0 ? Math.round((utilSess / totalSess) * 100) : 0;

      html += '<div class="fc-kpi-row" style="margin-bottom:24px">';
      html += kpi('Active',           active.length,          active.length > 0 ? 'green' : '');
      html += kpi('Expiring Soon',    expiring.length,        expiring.length > 0 ? 'amber' : 'green');
      html += kpi('Completed',        completed.length);
      html += kpi('Package Revenue',  fmtMoney(pkgRevTotal),  'green');
      html += kpi('Utilization Rate', utilRate + '%',         utilRate >= 80 ? 'green' : 'amber');
      html += '</div>';

      if (pkgs.length === 0) {
        html += '<div class="fc-empty">No packages yet. Create one with + New Package above.</div>';
      } else {
        // Active packages as cards
        if (active.length > 0) {
          html += '<div class="fc-section-head" style="font-size:11px">Active Packages</div>';
          html += active.map(renderPkgCard).join('');
        }
        if (expiring.length > 0) {
          html += '<div class="fc-section-head" style="font-size:11px;color:#f8a84b;border-color:rgba(248,168,75,.2);margin-top:24px">Expiring Soon</div>';
          html += expiring.map(renderPkgCard).join('');
        }
        // Completed/expired as a compact table
        if (completed.length + expired.length > 0) {
          html += '<div class="fc-section-head" style="font-size:11px;margin-top:24px">History</div>';
          html += '<table class="fc-table"><thead><tr>' +
            '<th>Client</th><th>Package</th><th>Sessions</th><th>Price</th>' +
            '<th>Purchased</th><th>Status</th></tr></thead><tbody>';
          html += completed.concat(expired).map(function (p) {
            return '<tr>' +
              '<td>' + esc(p.client_name || '—') + '</td>' +
              '<td>' + esc(p.package_name) + '</td>' +
              '<td>' + esc(p.sessions_used) + ' / ' + esc(p.sessions_included) + '</td>' +
              '<td>' + fmtMoney(p.purchase_price) + '</td>' +
              '<td>' + fmtDate(p.purchase_date) + '</td>' +
              '<td>' + pill(p.status) + '</td>' +
              '</tr>';
          }).join('');
          html += '</tbody></table>';
        }
      }

      el.innerHTML = html;
    } catch (e) {
      errBox(el, 'Could not load packages: ' + e.message);
    }
  }

  function renderPkgCard(p) {
    var used      = Number(p.sessions_used || 0);
    var included  = Number(p.sessions_included || 1);
    var remaining = included - used;
    var pct       = Math.round((used / included) * 100);
    var expiryStr = p.expiration_date
      ? 'Expires ' + fmtDate(p.expiration_date)
      : 'No expiry';
    var daysLeft  = p.expiration_date
      ? Math.ceil((new Date(p.expiration_date + 'T12:00:00') - new Date()) / 86400000)
      : null;
    var expiryColor = daysLeft !== null && daysLeft <= 7 ? '#ee7070' : daysLeft <= 14 ? '#f8a84b' : 'rgba(176,158,248,.5)';

    return '<div class="fc-pkg-card">' +
      '<div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px">' +
          '<div class="fc-pkg-name">' + esc(p.package_name) + '</div>' +
          '<div class="fc-pkg-client">' + esc(p.client_name || 'Unknown Client') + '</div>' +
          '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px">' +
            '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;color:rgba(232,184,75,.5)">' +
              'PURCHASED ' + fmtDate(p.purchase_date) + '</span>' +
            '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;color:' + expiryColor + '">' +
              expiryStr.toUpperCase() + '</span>' +
          '</div>' +
          '<div class="fc-progress-wrap">' +
            '<div class="fc-progress-bar" style="width:' + pct + '%;background:' +
              (remaining === 0 ? '#b09ef8' : remaining === 1 ? '#f8a84b' : '#22c98a') + '"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:6px">' +
            '<span style="font-family:\'EB Garamond\',serif;font-size:14px;color:rgba(176,158,248,.5)">' +
              used + ' of ' + included + ' sessions used</span>' +
            '<span style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.15em;color:' +
              (remaining === 0 ? '#b09ef8' : remaining === 1 ? '#f8a84b' : '#22c98a') + '">' +
              remaining + ' remaining</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;flex-shrink:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:18px;color:#e8b84b">' +
            fmtMoney(p.purchase_price) + '</div>' +
          pill(p.status) +
          '<button onclick="fcUseSession(\'' + esc(p.id) + '\',this)" ' +
            'class="fc-btn" style="font-size:9px;padding:6px 14px" ' +
            (remaining === 0 ? 'disabled style="opacity:.4;cursor:not-allowed"' : '') + '>' +
            'Use Session</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  window.fcPkgTypeChange = function () {
    var type = document.getElementById('pkgType').value;
    var fld  = document.getElementById('pkgSessField');
    if (fld) fld.style.display = type === 'custom' ? 'flex' : 'none';
  };

  window.fcSavePackage = async function () {
    var msg   = document.getElementById('pkgFormMsg');
    var type  = (document.getElementById('pkgType')       || {}).value || 'single';
    var name  = (document.getElementById('pkgClientName') || {}).value || '';
    var price = (document.getElementById('pkgPrice')      || {}).value || '0';
    var date  = (document.getElementById('pkgDate')       || {}).value || '';
    var exp   = (document.getElementById('pkgExpiry')     || {}).value || null;
    var notes = (document.getElementById('pkgNotes')      || {}).value || '';
    var sess  = type === 'custom'
      ? parseInt((document.getElementById('pkgSessions') || {}).value || '1')
      : null;

    if (!name.trim()) { msg.style.color = '#ee7070'; msg.textContent = 'Client name is required.'; return; }
    msg.textContent = 'Saving…'; msg.style.color = 'rgba(176,158,248,.6)';

    try {
      var body = {
        client_name:       name.trim(),
        package_type:      type,
        purchase_price:    parseFloat(price) || 0,
        purchase_date:     date || undefined,
        expiration_date:   exp || undefined,
        notes:             notes || undefined,
        sessions_included: sess || undefined,
      };
      await api('/financial?action=create_package', { method: 'POST', body: JSON.stringify(body) });
      msg.style.color = '#22c98a';
      msg.textContent = 'Package saved.';
      fcToggleForm('pkg-form');
      setTimeout(renderPackages, 400);
    } catch (e) {
      msg.style.color = '#ee7070';
      msg.textContent = e.message;
    }
  };

  window.fcUseSession = async function (pkgId, btn) {
    if (!confirm('Mark 1 session as used for this package?')) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/financial?action=use_session', { method: 'POST',
        body: JSON.stringify({ package_id: pkgId }) });
      renderPackages();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Use Session';
      alert('Error: ' + e.message);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // LEDGER
  // ══════════════════════════════════════════════════════════════════════════
  async function renderLedger() {
    var el = document.getElementById('fc-ledger');
    loading(el);
    try {
      var data    = await api('/financial?section=ledger');
      var entries = data.entries || [];
      var totals  = data.totals  || {};

      var html = sectionHead('Client Ledger', '+ Manual Entry', "fcToggleForm('ledger-form')");

      // Entry form
      html += '<div class="fc-form-panel" id="ledger-form">' +
        '<div class="fc-section-head" style="font-size:11px;margin-bottom:18px">New Ledger Entry</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field"><label>Client Name</label>' +
            '<input class="fc-input" id="ledClientName" placeholder="e.g. Jane Smith"></div>' +
          '<div class="fc-field"><label>Entry Type</label>' +
            '<select class="fc-select" id="ledType">' +
              '<option value="charge">Charge</option>' +
              '<option value="payment">Payment</option>' +
              '<option value="credit">Credit</option>' +
              '<option value="refund">Refund</option>' +
              '<option value="adjustment">Adjustment</option>' +
              '<option value="write_off">Write-Off</option>' +
            '</select></div>' +
          '<div class="fc-field"><label>Amount ($)</label>' +
            '<input class="fc-input" id="ledAmount" type="number" min="0" step="0.01" placeholder="0.00"></div>' +
        '</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field" style="flex:2"><label>Description</label>' +
            '<input class="fc-input" id="ledDesc" placeholder="e.g. Distance healing session — June 12"></div>' +
          '<div class="fc-field"><label>Date</label>' +
            '<input class="fc-input" id="ledDate" type="date" value="' + new Date().toISOString().slice(0,10) + '"></div>' +
        '</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field" style="flex:2"><label>Notes (optional)</label>' +
            '<input class="fc-input" id="ledNotes" placeholder="Internal notes"></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:6px">' +
          '<button class="fc-btn primary" onclick="fcSaveLedger()">Save Entry</button>' +
          '<button class="fc-btn" onclick="fcToggleForm(\'ledger-form\')">Cancel</button>' +
        '</div>' +
        '<div id="ledFormMsg" style="margin-top:10px;font-family:\'EB Garamond\',serif;font-size:15px"></div>' +
        '</div>';

      // Totals
      html += '<div class="fc-kpi-row" style="margin-bottom:24px">';
      html += kpi('Total Charges',  fmtMoney(totals.charges),  'red');
      html += kpi('Total Payments', fmtMoney(totals.payments), 'green');
      html += '</div>';

      // Filter row
      html += '<div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center">' +
        '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
          'text-transform:uppercase;color:rgba(232,184,75,.4)">Filter:</span>' +
        '<select class="fc-select" id="ledFilterType" onchange="fcFilterLedger()" ' +
          'style="padding:6px 12px;font-size:14px;width:auto">' +
          '<option value="">All Types</option>' +
          '<option value="charge">Charges</option>' +
          '<option value="payment">Payments</option>' +
          '<option value="credit">Credits</option>' +
          '<option value="refund">Refunds</option>' +
          '<option value="adjustment">Adjustments</option>' +
          '<option value="write_off">Write-Offs</option>' +
        '</select>' +
        '<input class="fc-input" id="ledFilterClient" oninput="fcFilterLedger()" ' +
          'placeholder="Filter by client…" style="padding:6px 12px;font-size:14px;width:200px">' +
      '</div>';

      if (entries.length === 0) {
        html += '<div class="fc-empty">No ledger entries yet. Record a charge or payment above.</div>';
      } else {
        html += '<div id="ledgerTableWrap">' + buildLedgerTable(entries) + '</div>';
      }

      el.innerHTML = html;
      // Store all entries for client-side filtering
      el._allEntries = entries;

    } catch (e) {
      errBox(el, 'Could not load ledger: ' + e.message);
    }
  }

  function buildLedgerTable(entries) {
    if (entries.length === 0) {
      return '<div class="fc-empty">No entries match this filter.</div>';
    }
    var html = '<table class="fc-table"><thead><tr>' +
      '<th>Date</th><th>Client</th><th>Type</th><th>Description</th>' +
      '<th style="text-align:right">Amount</th><th style="text-align:right">Impact</th>' +
      '</tr></thead><tbody>';

    html += entries.map(function (e) {
      var impact = Number(e.balance_impact || 0);
      var impactColor = impact > 0 ? '#ee7070' : '#22c98a';
      var impactStr   = (impact > 0 ? '+' : '') + fmtMoney(impact);
      return '<tr>' +
        '<td style="white-space:nowrap">' + fmtDate(e.entry_date) + '</td>' +
        '<td>' + esc(e.client_name || '—') + '</td>' +
        '<td>' + pill(e.entry_type) + '</td>' +
        '<td>' + esc(e.description) + (e.notes ? '<br><span style="font-size:13px;color:rgba(176,158,248,.4);font-style:italic">' + esc(e.notes) + '</span>' : '') + '</td>' +
        '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px">' + fmtMoney(e.amount) + '</td>' +
        '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px;color:' + impactColor + '">' + impactStr + '</td>' +
        '</tr>';
    }).join('');
    return html + '</tbody></table>';
  }

  window.fcFilterLedger = function () {
    var el        = document.getElementById('fc-ledger');
    var typeVal   = (document.getElementById('ledFilterType')   || {}).value || '';
    var clientVal = ((document.getElementById('ledFilterClient') || {}).value || '').toLowerCase().trim();
    var entries   = (el && el._allEntries) || [];

    var filtered = entries.filter(function (e) {
      var matchType   = !typeVal   || e.entry_type === typeVal;
      var matchClient = !clientVal || (e.client_name || '').toLowerCase().includes(clientVal);
      return matchType && matchClient;
    });
    var wrap = document.getElementById('ledgerTableWrap');
    if (wrap) wrap.innerHTML = buildLedgerTable(filtered);
  };

  window.fcSaveLedger = async function () {
    var msg    = document.getElementById('ledFormMsg');
    var client = (document.getElementById('ledClientName') || {}).value || '';
    var type   = (document.getElementById('ledType')       || {}).value || 'charge';
    var amount = (document.getElementById('ledAmount')     || {}).value || '0';
    var desc   = (document.getElementById('ledDesc')       || {}).value || '';
    var date   = (document.getElementById('ledDate')       || {}).value || '';
    var notes  = (document.getElementById('ledNotes')      || {}).value || '';

    if (!client.trim()) { msg.style.color = '#ee7070'; msg.textContent = 'Client name is required.'; return; }
    if (!desc.trim())   { msg.style.color = '#ee7070'; msg.textContent = 'Description is required.'; return; }
    msg.textContent = 'Saving…'; msg.style.color = 'rgba(176,158,248,.6)';

    try {
      await api('/financial?action=create_ledger', { method: 'POST', body: JSON.stringify({
        client_name:  client.trim(),
        entry_type:   type,
        amount:       parseFloat(amount) || 0,
        description:  desc.trim(),
        entry_date:   date || undefined,
        notes:        notes || undefined,
      })});
      msg.style.color = '#22c98a'; msg.textContent = 'Entry saved.';
      fcToggleForm('ledger-form');
      setTimeout(renderLedger, 400);
    } catch (e) {
      msg.style.color = '#ee7070'; msg.textContent = e.message;
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // INVOICES
  // ══════════════════════════════════════════════════════════════════════════
  async function renderInvoices() {
    var el = document.getElementById('fc-invoices');
    loading(el);
    try {
      var data     = await api('/financial?section=invoices');
      var invoices = data.invoices || [];

      var html = sectionHead('Invoices', '+ New Invoice', "fcToggleForm('inv-form')");

      // Invoice form
      html += '<div class="fc-form-panel" id="inv-form">' +
        '<div class="fc-section-head" style="font-size:11px;margin-bottom:18px">New Invoice</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field"><label>Client Name</label>' +
            '<input class="fc-input" id="invClientName" placeholder="e.g. Jane Smith"></div>' +
          '<div class="fc-field"><label>Issue Date</label>' +
            '<input class="fc-input" id="invDate" type="date" value="' + new Date().toISOString().slice(0,10) + '"></div>' +
          '<div class="fc-field"><label>Due Date (optional)</label>' +
            '<input class="fc-input" id="invDue" type="date"></div>' +
        '</div>' +
        '<div id="invItems" style="margin-bottom:12px">' +
          '<div class="fc-section-head" style="font-size:10px;margin-bottom:10px">Line Items</div>' +
          '<div id="invItemRows"></div>' +
          '<button class="fc-btn" onclick="fcAddInvItem()" style="font-size:9px;padding:5px 12px;margin-top:6px">+ Add Item</button>' +
        '</div>' +
        '<div class="fc-form-row">' +
          '<div class="fc-field"><label>Adjustment ($, negative = discount)</label>' +
            '<input class="fc-input" id="invAdj" type="number" step="0.01" placeholder="0.00"></div>' +
          '<div class="fc-field" style="flex:2"><label>Notes (optional)</label>' +
            '<input class="fc-input" id="invNotes" placeholder="Internal notes or payment instructions"></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:6px">' +
          '<button class="fc-btn primary" onclick="fcSaveInvoice()">Create Invoice</button>' +
          '<button class="fc-btn" onclick="fcToggleForm(\'inv-form\')">Cancel</button>' +
        '</div>' +
        '<div id="invFormMsg" style="margin-top:10px;font-family:\'EB Garamond\',serif;font-size:15px"></div>' +
        '</div>';

      // Dashboard KPIs
      var outstanding = invoices.filter(function (i) { return ['sent','partial','overdue'].includes(i.status); });
      var overdue     = invoices.filter(function (i) { return i.status === 'overdue'; });
      var paid        = invoices.filter(function (i) { return i.status === 'paid'; });
      var outAmt      = outstanding.reduce(function (s, i) { return s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)); }, 0);

      html += '<div class="fc-kpi-row" style="margin-bottom:24px">';
      html += kpi('Outstanding',  outstanding.length,    outstanding.length > 0 ? 'amber' : 'green');
      html += kpi('Overdue',      overdue.length,        overdue.length > 0 ? 'red' : 'green');
      html += kpi('Paid',         paid.length,           'green');
      html += kpi('Amt Outstanding', fmtMoney(outAmt),  outAmt > 0 ? 'amber' : 'green');
      html += '</div>';

      if (invoices.length === 0) {
        html += '<div class="fc-empty">No invoices yet. Create one with + New Invoice above.</div>';
      } else {
        html += '<table class="fc-table"><thead><tr>' +
          '<th>Invoice #</th><th>Client</th><th>Issued</th><th>Due</th>' +
          '<th style="text-align:right">Total</th><th style="text-align:right">Paid</th>' +
          '<th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>';

        html += invoices.map(function (inv) {
          var balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
          return '<tr>' +
            '<td style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.15em">' + esc(inv.invoice_number) + '</td>' +
            '<td>' + esc(inv.client_name || '—') + '</td>' +
            '<td style="white-space:nowrap">' + fmtDate(inv.issue_date) + '</td>' +
            '<td style="white-space:nowrap">' + (inv.due_date ? fmtDate(inv.due_date) : '—') + '</td>' +
            '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px">' + fmtMoney(inv.total) + '</td>' +
            '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px;color:#22c98a">' + fmtMoney(inv.amount_paid) + '</td>' +
            '<td>' + pill(inv.status) + '</td>' +
            '<td style="white-space:nowrap">' +
              (inv.status === 'draft'
                ? '<button class="fc-btn" onclick="fcMarkInvoiceSent(\'' + esc(inv.id) + '\',this)" style="font-size:8px;padding:4px 10px">Mark Sent</button> '
                : '') +
              (balance > 0
                ? '<button class="fc-btn" onclick="fcRecordInvPayment(\'' + esc(inv.id) + '\',\'' + esc(inv.client_name) + '\',\'' + esc(inv.client_id) + '\',' + balance + ',this)" style="font-size:8px;padding:4px 10px">Record Payment</button>'
                : '') +
            '</td>' +
          '</tr>';
        }).join('');
        html += '</tbody></table>';
      }

      el.innerHTML = html;
      // Seed one blank item row
      fcAddInvItem();
    } catch (e) {
      errBox(el, 'Could not load invoices: ' + e.message);
    }
  }

  var _invItemCount = 0;
  window.fcAddInvItem = function () {
    var container = document.getElementById('invItemRows');
    if (!container) return;
    _invItemCount++;
    var id = 'invItem_' + _invItemCount;
    var row = document.createElement('div');
    row.id = id;
    row.className = 'fc-form-row';
    row.style.cssText = 'align-items:center;margin-bottom:8px';
    row.innerHTML =
      '<div class="fc-field" style="flex:3"><input class="fc-input" data-role="desc" placeholder="Description (e.g. Distance Healing Session)"></div>' +
      '<div class="fc-field" style="flex:1;min-width:80px"><input class="fc-input" data-role="qty" type="number" min="1" value="1" style="text-align:center"></div>' +
      '<div class="fc-field" style="flex:1;min-width:100px"><input class="fc-input" data-role="price" type="number" min="0" step="0.01" placeholder="0.00"></div>' +
      '<button onclick="document.getElementById(\'' + id + '\').remove()" ' +
        'style="font-family:\'Cinzel\',serif;font-size:10px;color:#ee707099;border:none;background:transparent;cursor:pointer;flex-shrink:0;padding:4px 8px">✕</button>';
    container.appendChild(row);
  };

  window.fcSaveInvoice = async function () {
    var msg    = document.getElementById('invFormMsg');
    var client = (document.getElementById('invClientName') || {}).value || '';
    var date   = (document.getElementById('invDate')       || {}).value || '';
    var due    = (document.getElementById('invDue')        || {}).value || null;
    var adj    = parseFloat((document.getElementById('invAdj')  || {}).value || '0') || 0;
    var notes  = (document.getElementById('invNotes')      || {}).value || '';

    if (!client.trim()) { msg.style.color = '#ee7070'; msg.textContent = 'Client name is required.'; return; }

    // Collect line items
    var items = [];
    document.querySelectorAll('#invItemRows .fc-form-row').forEach(function (row) {
      var desc  = (row.querySelector('[data-role="desc"]')  || {}).value || '';
      var qty   = parseInt((row.querySelector('[data-role="qty"]')   || {}).value || '1');
      var price = parseFloat((row.querySelector('[data-role="price"]') || {}).value || '0');
      if (desc.trim()) items.push({ description: desc.trim(), quantity: qty || 1, unit_price: price || 0 });
    });

    if (items.length === 0) { msg.style.color = '#ee7070'; msg.textContent = 'Add at least one line item.'; return; }

    msg.textContent = 'Creating invoice…'; msg.style.color = 'rgba(176,158,248,.6)';

    try {
      var body = {
        client_name: client.trim(),
        issue_date:  date  || undefined,
        due_date:    due   || undefined,
        adjustment:  adj,
        notes:       notes || undefined,
        items,
      };
      var data = await api('/financial?action=create_invoice', { method: 'POST', body: JSON.stringify(body) });
      msg.style.color = '#22c98a';
      msg.textContent = 'Invoice ' + data.invoice.invoice_number + ' created.';
      fcToggleForm('inv-form');
      _invItemCount = 0;
      setTimeout(renderInvoices, 400);
    } catch (e) {
      msg.style.color = '#ee7070'; msg.textContent = e.message;
    }
  };

  window.fcMarkInvoiceSent = async function (id, btn) {
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/financial?action=update_invoice&id=' + id, { method: 'PATCH',
        body: JSON.stringify({ status: 'sent' }) });
      renderInvoices();
    } catch (e) { btn.disabled = false; btn.textContent = 'Mark Sent'; alert(e.message); }
  };

  window.fcRecordInvPayment = async function (invId, clientName, clientId, balance, btn) {
    var amtStr = prompt('Record payment for ' + (clientName || 'client') +
      '\nOutstanding: ' + fmtMoney(balance) + '\n\nEnter amount paid:',
      balance.toFixed(2));
    if (!amtStr) return;
    var amt = parseFloat(amtStr);
    if (isNaN(amt) || amt <= 0) { alert('Invalid amount.'); return; }
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/financial?action=record_payment', { method: 'POST', body: JSON.stringify({
        client_id:   clientId,
        client_name: clientName,
        invoice_id:  invId,
        amount:      amt,
        description: 'Payment received for invoice',
      })});
      renderInvoices();
    } catch (e) { btn.disabled = false; btn.textContent = 'Record Payment'; alert(e.message); }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // REVENUE ANALYTICS
  // ══════════════════════════════════════════════════════════════════════════
  async function renderRevenue() {
    var el = document.getElementById('fc-revenue');
    loading(el);
    try {
      var data = await api('/financial?section=revenue');
      var html = sectionHead('Revenue Analytics');

      // Top KPIs
      html += '<div class="fc-kpi-row">';
      html += kpi('Total Revenue',          fmtMoney(data.totalRevenue),                      'green');
      html += kpi('Avg Client Value',       fmtMoney(data.avgClientValue));
      html += kpi('Package Completion',     (data.packages && data.packages.completionRate) + '%');
      html += kpi('Unused Package Value',   fmtMoney(data.packages && data.packages.unusedValue), 'amber',
                  'value not yet consumed');
      html += '</div>';

      // Monthly bar chart
      var months   = data.monthlyBreakdown || [];
      var maxRev   = Math.max.apply(null, months.map(function (m) { return m.revenue; }).concat([1]));
      html += '<div class="fc-section-head" style="font-size:11px;margin-top:24px">Monthly Revenue — Last 12 Months</div>';
      html += '<div class="fc-bar-chart">';
      html += months.map(function (m) {
        var pct = Math.round((m.revenue / maxRev) * 100);
        var lbl = m.month.slice(5);  // MM
        return '<div class="fc-bar-col">' +
          '<div class="fc-bar" style="height:' + pct + '%;min-height:' + (m.revenue > 0 ? '4' : '0') + 'px" ' +
            'title="' + m.month + ': ' + fmtMoney(m.revenue) + '"></div>' +
          '<div class="fc-bar-lbl">' + esc(lbl) + '</div>' +
          '</div>';
      }).join('');
      html += '</div>';
      // Labels row below chart
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:24px;' +
        'font-family:\'EB Garamond\',serif;font-size:13px;color:rgba(176,158,248,.35)">' +
        '<span>' + fmtMoney(0) + '</span><span>' + fmtMoney(maxRev) + '</span></div>';

      // Revenue by method
      var methods = data.byMethod || {};
      if (Object.keys(methods).length > 0) {
        html += '<div class="fc-section-head" style="font-size:11px">Revenue by Payment Method</div>';
        html += '<table class="fc-table" style="max-width:440px"><tbody>';
        var methodTotal = Object.values(methods).reduce(function (s, v) { return s + v; }, 0);
        html += Object.entries(methods).sort(function (a, b) { return b[1] - a[1]; }).map(function (pair) {
          var pct = methodTotal > 0 ? Math.round((pair[1] / methodTotal) * 100) : 0;
          return '<tr><td>' + esc(pair[0]) + '</td>' +
            '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px">' + fmtMoney(pair[1]) + '</td>' +
            '<td style="width:100px;padding-left:14px">' +
              '<div class="fc-progress-wrap"><div class="fc-progress-bar" style="width:' + pct + '%"></div></div></td>' +
            '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:12px;color:rgba(176,158,248,.5);padding-left:8px">' + pct + '%</td>' +
            '</tr>';
        }).join('');
        html += '</tbody></table>';
      }

      // Revenue by service
      var services = data.byService || {};
      if (Object.keys(services).length > 0) {
        html += '<div class="fc-section-head" style="font-size:11px;margin-top:28px">Revenue by Service</div>';
        html += '<table class="fc-table"><thead><tr><th>Service</th><th>Sessions</th>' +
          '<th style="text-align:right">Revenue</th></tr></thead><tbody>';
        html += Object.entries(services).sort(function (a, b) { return b[1].revenue - a[1].revenue; }).map(function (pair) {
          return '<tr><td>' + esc(pair[0]) + '</td>' +
            '<td>' + esc(pair[1].sessions) + '</td>' +
            '<td style="text-align:right;font-family:\'Cinzel\',serif;font-size:14px">' + fmtMoney(pair[1].revenue) + '</td>' +
            '</tr>';
        }).join('');
        html += '</tbody></table>';
      }

      // Package metrics
      var pkgStats = data.packages || {};
      html += '<div class="fc-section-head" style="font-size:11px;margin-top:28px">Package Metrics</div>';
      html += '<div class="fc-kpi-row">';
      html += kpi('Total Packages',    pkgStats.totalPackages || 0);
      html += kpi('Completed',         pkgStats.completed || 0,   'green');
      html += kpi('Completion Rate',   (pkgStats.completionRate || 0) + '%',
                  (pkgStats.completionRate || 0) >= 70 ? 'green' : 'amber');
      html += kpi('Unused Value',      fmtMoney(pkgStats.unusedValue),  'amber');
      html += '</div>';

      el.innerHTML = html;
    } catch (e) {
      errBox(el, 'Could not load revenue analytics: ' + e.message);
    }
  }

  // ── Shared UI helpers ────────────────────────────────────────────────────
  window.fcToggleForm = function (id) {
    var panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

})();
