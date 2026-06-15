// communications-module.js
// Communications Dashboard — Email log, templates, stats, send interface.
// Loaded after pin-lock; all API calls require X-Dashboard-Token.

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var _currentSection  = 'overview';
  var _initialized     = false;
  var _sendClientId    = null;
  var _sendClientName  = null;
  var _sendClientEmail = null;

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

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtDateShort(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  var TYPE_LABELS = {
    appointment_reminder:       'Appointment Reminder',
    followup_reminder:          'Follow-Up Reminder',
    recommendation_delivery:    'Recommendation Delivery',
    invoice_notification:       'Invoice Notification',
    package_expiration_warning: 'Package Expiration',
    general_message:            'General Message',
  };

  var STATUS_COLORS = {
    sent:      '#22c98a',
    delivered: '#22c98a',
    failed:    '#ee7070',
    bounced:   '#f8a84b',
    pending:   '#e8b84b',
  };

  function statusPill(s) {
    var col = STATUS_COLORS[s] || '#9b7fe8';
    return '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;' +
      'color:' + col + ';background:' + col + '18;border:1px solid ' + col + '66;padding:3px 10px;border-radius:2px">' +
      esc(s) + '</span>';
  }

  function typePill(t) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.15em;text-transform:uppercase;' +
      'color:#9b7fe8;background:#9b7fe818;border:1px solid #9b7fe844;padding:3px 10px;border-radius:2px">' +
      esc(TYPE_LABELS[t] || t) + '</span>';
  }

  function kpiCard(label, value, color) {
    return '<div class="cm-kpi">' +
      '<div class="cm-kpi-label">' + esc(label) + '</div>' +
      '<div class="cm-kpi-val" style="color:' + (color || '#e8b84b') + '">' + esc(String(value)) + '</div>' +
    '</div>';
  }

  function loading(el) {
    if (!el) return;
    el.innerHTML = '<div style="padding:36px;text-align:center;font-family:\'Cinzel\',serif;font-size:12px;' +
      'letter-spacing:.3em;color:#e8b84b44">LOADING…</div>';
  }

  function errBox(el, msg) {
    if (!el) return;
    el.innerHTML = '<div style="padding:24px;border:1px solid #ee707033;background:#ee70700a;' +
      'color:#ee7070;font-size:15px">' + esc(msg) + '</div>';
  }

  // ── Entry point (called by showTab in dashboard.html) ────────────────────
  window.cmInit = function () {
    if (!_initialized) {
      _initialized    = true;
      _currentSection = 'overview';
    }
    cmSection(_currentSection);
  };

  // ── Section router ────────────────────────────────────────────────────────
  window.cmSection = function (name) {
    _currentSection = name;
    document.querySelectorAll('.cm-sub').forEach(function (b) {
      b.classList.toggle('active', b.dataset.section === name);
    });
    document.querySelectorAll('.cm-section').forEach(function (el) {
      el.style.display = 'none';
    });
    var el = document.getElementById('cm-' + name);
    if (el) el.style.display = 'block';

    if (name === 'overview')  renderCmOverview();
    if (name === 'log')       renderCmLog();
    if (name === 'templates') renderCmTemplates();
    if (name === 'send')      renderCmSend();
  };

  // ════════════════════════════════════════════════════════════════════════
  // OVERVIEW
  // ════════════════════════════════════════════════════════════════════════
  async function renderCmOverview() {
    var el = document.getElementById('cm-overview');
    if (!el) return;
    loading(el);
    try {
      var data = await api('/communications?section=stats');

      if (data._empty) {
        el.innerHTML =
          '<div style="margin-bottom:28px"><div class="cm-section-title">Overview</div></div>' +
          '<div style="border:1px solid #22c98a22;background:#22c98a08;padding:28px 32px;margin-bottom:24px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em;color:#22c98a;text-transform:uppercase;margin-bottom:12px">Communications Ready</div>' +
            '<div style="font-size:17px;color:#dddaeecc;line-height:1.7">The communications system is active. No emails have been sent yet. Use the <strong style="color:#e8b84b">Compose</strong> tab to send your first message.</div>' +
          '</div>';
        return;
      }

      var kpis =
        '<div class="cm-kpi-row">' +
          kpiCard('Total Sent',  data.total,     '#e8b84b') +
          kpiCard('Sent',        data.sent,      '#22c98a') +
          kpiCard('Delivered',   data.delivered, '#22c98a') +
          kpiCard('Failed',      data.failed,    data.failed > 0 ? '#ee7070' : '#dddaee44') +
          kpiCard('Bounced',     data.bounced,   data.bounced > 0 ? '#f8a84b' : '#dddaee44') +
        '</div>';

      // Messages by type
      var byTypeHtml = '';
      if (Object.keys(data.byType || {}).length) {
        byTypeHtml =
          '<div style="margin-bottom:32px">' +
            '<div class="cm-section-title">Messages by Type</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">' +
            Object.entries(data.byType).map(function (e) {
              return '<div style="background:#09050f;border:1px solid #e8b84b22;padding:14px 18px;display:flex;' +
                'justify-content:space-between;align-items:center">' +
                '<span style="font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#e8b84b">' +
                esc(TYPE_LABELS[e[0]] || e[0]) + '</span>' +
                '<span style="font-family:\'Cinzel\',serif;font-size:24px;color:#f0ecff">' + e[1] + '</span>' +
              '</div>';
            }).join('') +
            '</div>' +
          '</div>';
      }

      // Timeline (last 30 days)
      var timelineHtml = '';
      if (Array.isArray(data.timeline) && data.timeline.some(function (t) { return t.count > 0; })) {
        var maxCount = Math.max.apply(null, data.timeline.map(function (t) { return t.count; })) || 1;
        timelineHtml =
          '<div style="margin-bottom:32px">' +
            '<div class="cm-section-title">Communication Timeline — Last 30 Days</div>' +
            '<div style="display:flex;align-items:flex-end;gap:4px;height:80px;background:#09050f;border:1px solid #e8b84b22;padding:14px 18px">' +
            data.timeline.map(function (t) {
              var h = t.count > 0 ? Math.max(4, Math.round((t.count / maxCount) * 52)) : 2;
              var col = t.count > 0 ? '#e8b84b' : '#e8b84b18';
              return '<div style="flex:1;background:' + col + ';height:' + h + 'px;border-radius:1px;cursor:default" title="' + esc(t.date) + ': ' + t.count + '"></div>';
            }).join('') +
            '</div>' +
          '</div>';
      }

      // Recent activity
      var recentHtml = '';
      if (Array.isArray(data.recentActivity) && data.recentActivity.length) {
        recentHtml =
          '<div style="margin-bottom:32px">' +
            '<div class="cm-section-title">Recent Activity</div>' +
            '<div style="border:1px solid #e8b84b22;overflow:hidden">' +
            data.recentActivity.map(function (c) {
              return '<div style="display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid #e8b84b0f;background:#09050f">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.1em;color:#f0ecff;margin-bottom:3px">' + esc(c.subject || TYPE_LABELS[c.message_type] || c.message_type) + '</div>' +
                  '<div style="font-size:14px;color:#9b7fe8">' + fmtDate(c.sent_at) + '</div>' +
                '</div>' +
                typePill(c.message_type) + ' ' + statusPill(c.status) +
              '</div>';
            }).join('') +
            '</div>' +
          '</div>';
      }

      el.innerHTML =
        '<div style="margin-bottom:28px"><div class="cm-section-title">Overview</div></div>' +
        kpis + byTypeHtml + timelineHtml + recentHtml;

    } catch (e) { errBox(el, 'Could not load stats: ' + e.message); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMMUNICATION LOG
  // ════════════════════════════════════════════════════════════════════════
  async function renderCmLog() {
    var el = document.getElementById('cm-log');
    if (!el) return;
    loading(el);
    try {
      var data = await api('/communications?section=log&limit=100');

      if (!data.communications.length) {
        el.innerHTML =
          '<div style="text-align:center;padding:48px;font-style:italic;color:#dddaee66;font-size:17px">' +
          'No communications logged yet. Use the Compose tab to send your first email.' +
          '</div>';
        return;
      }

      el.innerHTML =
        '<div style="margin-bottom:24px">' +
          '<div class="cm-section-title">Communication Log <span style="font-family:\'EB Garamond\',serif;font-size:16px;font-style:italic;font-weight:400;color:#dddaee66;letter-spacing:0">' + data.total + ' total</span></div>' +
        '</div>' +
        '<div style="border:1px solid #e8b84b22;overflow:hidden">' +
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="background:#0a0618">' +
              '<th style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b;padding:12px 16px;text-align:left;border-bottom:1px solid #e8b84b22">Date</th>' +
              '<th style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b;padding:12px 16px;text-align:left;border-bottom:1px solid #e8b84b22">Recipient</th>' +
              '<th style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b;padding:12px 16px;text-align:left;border-bottom:1px solid #e8b84b22">Subject</th>' +
              '<th style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b;padding:12px 16px;text-align:left;border-bottom:1px solid #e8b84b22">Type</th>' +
              '<th style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#e8b84b;padding:12px 16px;text-align:left;border-bottom:1px solid #e8b84b22">Status</th>' +
            '</tr></thead>' +
            '<tbody>' +
            data.communications.map(function (c) {
              return '<tr style="border-bottom:1px solid #e8b84b0a;transition:background .1s" onmouseover="this.style.background=\'#e8b84b05\'" onmouseout="this.style.background=\'\'">' +
                '<td style="padding:12px 16px;font-size:14px;color:#dddaeecc;white-space:nowrap">' + fmtDateShort(c.sent_at) + '</td>' +
                '<td style="padding:12px 16px;font-size:14px;color:#f0ecff">' + esc(c.recipient) + '</td>' +
                '<td style="padding:12px 16px;font-size:15px;color:#f0ecff;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.subject || '—') + '</td>' +
                '<td style="padding:12px 16px">' + typePill(c.message_type) + '</td>' +
                '<td style="padding:12px 16px">' + statusPill(c.status) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>';

    } catch (e) { errBox(el, 'Could not load communication log: ' + e.message); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ════════════════════════════════════════════════════════════════════════
  async function renderCmTemplates() {
    var el = document.getElementById('cm-templates');
    if (!el) return;
    loading(el);
    try {
      var data = await api('/communications?section=templates');

      if (!data.templates || !data.templates.length) {
        el.innerHTML =
          '<div style="text-align:center;padding:48px;font-style:italic;color:#dddaee66;font-size:17px">' +
          'No email templates found. Run the Sprint 13A migration to seed the default branded templates.' +
          '</div>';
        return;
      }

      el.innerHTML =
        '<div style="margin-bottom:24px"><div class="cm-section-title">Email Templates</div></div>' +
        data.templates.map(function (t) {
          return '<div style="background:#09050f;border:1px solid #e8b84b22;padding:22px 26px;margin-bottom:12px;border-radius:2px">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px">' +
              '<div>' +
                '<div style="font-family:\'Cinzel\',serif;font-size:16px;letter-spacing:.06em;color:#fff;margin-bottom:6px">' + esc(t.name) + '</div>' +
                '<div style="font-family:\'EB Garamond\',serif;font-size:16px;color:#dddaeecc;font-style:italic">' + esc(t.subject) + '</div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0">' +
                typePill(t.type) +
                (t.is_active
                  ? '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#22c98a;background:#22c98a18;border:1px solid #22c98a44;padding:3px 10px">Active</span>'
                  : '<span style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#ee7070;background:#ee70700f;border:1px solid #ee707033;padding:3px 10px">Inactive</span>') +
              '</div>' +
            '</div>' +
            (t.variables && t.variables.length
              ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' +
                  t.variables.map(function (v) {
                    return '<code style="font-family:monospace;font-size:12px;color:#e8b84b;background:#e8b84b0a;' +
                      'padding:2px 7px;border:1px solid #e8b84b22">{{' + esc(v) + '}}</code>';
                  }).join('') +
                '</div>'
              : '') +
          '</div>';
        }).join('');

    } catch (e) { errBox(el, 'Could not load templates: ' + e.message); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEND EMAIL COMPOSER
  // ════════════════════════════════════════════════════════════════════════
  async function renderCmSend() {
    var el = document.getElementById('cm-send');
    if (!el) return;

    // Load clients for recipient picker and templates for type picker
    var clientsRes, templatesRes;
    try {
      [clientsRes, templatesRes] = await Promise.all([
        api('/clients'),
        api('/communications?section=templates&active_only=true'),
      ]);
    } catch (e) {
      errBox(el, 'Could not load send form: ' + e.message);
      return;
    }

    var clients   = (clientsRes.clients || []).filter(function (c) { return c.email; });
    var templates = templatesRes.templates || [];

    el.innerHTML =
      '<div style="margin-bottom:24px"><div class="cm-section-title">Compose & Send</div></div>' +
      '<div style="background:#09050f;border:1px solid #e8b84b33;padding:32px;border-radius:2px">' +

        // Client selector
        '<div class="cm-field">' +
          '<label class="cm-lbl">Recipient Client</label>' +
          '<select id="cmSendClientSel" class="cm-input" onchange="window.cmOnClientChange(this.value)">' +
            '<option value="">— Select client (or enter email manually below) —</option>' +
            clients.map(function (c) {
              var sel = (_sendClientId && _sendClientId === c.id) ? ' selected' : '';
              return '<option value="' + esc(c.id) + '" data-email="' + esc(c.email) + '" data-name="' + esc(c.full_name) + '"' + sel + '>' +
                esc(c.full_name) + (c.email ? ' · ' + c.email : '') + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +

        // Email override
        '<div class="cm-field">' +
          '<label class="cm-lbl">Recipient Email <span style="color:#dddaee66;font-family:\'EB Garamond\',serif;font-size:15px;letter-spacing:0;text-transform:none">(override or manual entry)</span></label>' +
          '<input id="cmSendEmail" class="cm-input" type="email" placeholder="client@example.com" value="' + esc(_sendClientEmail || '') + '">' +
        '</div>' +

        // Message type
        '<div class="cm-field">' +
          '<label class="cm-lbl">Message Type</label>' +
          '<select id="cmSendType" class="cm-input" onchange="window.cmOnTypeChange(this.value)">' +
            Object.entries(TYPE_LABELS).map(function (e) {
              return '<option value="' + esc(e[0]) + '">' + esc(e[1]) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +

        // Template picker
        (templates.length
          ? '<div class="cm-field">' +
              '<label class="cm-lbl">Use Template <span style="color:#dddaee66;font-family:\'EB Garamond\',serif;font-size:15px;letter-spacing:0;text-transform:none">(optional — pre-fills subject & body)</span></label>' +
              '<select id="cmSendTemplate" class="cm-input" onchange="window.cmOnTemplateChange(this.value)">' +
                '<option value="">— No template —</option>' +
                templates.map(function (t) {
                  return '<option value="' + esc(t.id) + '" data-type="' + esc(t.type) + '">' + esc(t.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>'
          : '') +

        // Subject
        '<div class="cm-field">' +
          '<label class="cm-lbl">Subject</label>' +
          '<input id="cmSendSubject" class="cm-input" type="text" placeholder="Email subject…">' +
        '</div>' +

        // Body (plain text — simple for practitioner)
        '<div class="cm-field">' +
          '<label class="cm-lbl">Message Body</label>' +
          '<textarea id="cmSendBody" class="cm-input" rows="10" ' +
            'placeholder="Write your message here. If using a template, variables like {{client_name}} will be filled from the template."></textarea>' +
        '</div>' +

        // Notes / metadata
        '<div class="cm-field">' +
          '<label class="cm-lbl">Internal Notes <span style="color:#dddaee66;font-family:\'EB Garamond\',serif;font-size:15px;letter-spacing:0;text-transform:none">(not sent to client — for audit log)</span></label>' +
          '<input id="cmSendNotes" class="cm-input" type="text" placeholder="e.g. Sent after session on 2026-06-13">' +
        '</div>' +

        '<div style="display:flex;gap:10px;align-items:center;margin-top:8px">' +
          '<button onclick="window.cmSend()" style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.25em;' +
            'text-transform:uppercase;padding:13px 32px;background:#e8b84b14;border:1px solid #e8b84b66;' +
            'color:#e8b84b;cursor:pointer;border-radius:2px;transition:all .2s" id="cmSendBtn">Send Email</button>' +
          '<span id="cmSendMsg" style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.2em;opacity:0;transition:opacity .4s"></span>' +
        '</div>' +

      '</div>';

    // Restore pre-filled state if launched from client profile
    if (_sendClientId) {
      var sel = document.getElementById('cmSendClientSel');
      if (sel) sel.value = _sendClientId;
    }
    if (_sendClientEmail) {
      var emailInput = document.getElementById('cmSendEmail');
      if (emailInput) emailInput.value = _sendClientEmail;
    }

    // Store templates map for template change handler
    window._cmTemplates = {};
    templates.forEach(function (t) { window._cmTemplates[t.id] = t; });
  }

  // ── Client selector change ────────────────────────────────────────────────
  window.cmOnClientChange = function (clientId) {
    var sel = document.getElementById('cmSendClientSel');
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    var email = (opt && opt.dataset.email) ? opt.dataset.email : '';
    var name  = (opt && opt.dataset.name)  ? opt.dataset.name  : '';
    var emailInput = document.getElementById('cmSendEmail');
    if (emailInput && email) emailInput.value = email;
    _sendClientId    = clientId || null;
    _sendClientEmail = email    || null;
    _sendClientName  = name     || null;
  };

  // ── Message type change ───────────────────────────────────────────────────
  window.cmOnTypeChange = function (type) {
    // If a template is selected for a different type, clear it
    var tmplSel = document.getElementById('cmSendTemplate');
    if (!tmplSel) return;
    var tmplId = tmplSel.value;
    if (tmplId && window._cmTemplates && window._cmTemplates[tmplId]) {
      if (window._cmTemplates[tmplId].type !== type) {
        tmplSel.value = '';
      }
    }
  };

  // ── Template change — auto-fill subject/body ──────────────────────────────
  window.cmOnTemplateChange = function (templateId) {
    if (!templateId || !window._cmTemplates) return;
    var tmpl = window._cmTemplates[templateId];
    if (!tmpl) return;
    var subjEl = document.getElementById('cmSendSubject');
    var bodyEl = document.getElementById('cmSendBody');
    var typeEl = document.getElementById('cmSendType');
    if (subjEl) subjEl.value = tmpl.subject;
    if (bodyEl) bodyEl.value = tmpl.text_body || '';
    if (typeEl) typeEl.value = tmpl.type;
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  window.cmSend = async function () {
    var emailInput = document.getElementById('cmSendEmail');
    var subjEl     = document.getElementById('cmSendSubject');
    var bodyEl     = document.getElementById('cmSendBody');
    var typeEl     = document.getElementById('cmSendType');
    var tmplSel    = document.getElementById('cmSendTemplate');
    var notesEl    = document.getElementById('cmSendNotes');
    var btn        = document.getElementById('cmSendBtn');
    var msgEl      = document.getElementById('cmSendMsg');

    var email   = (emailInput && emailInput.value.trim())   || '';
    var subj    = (subjEl     && subjEl.value.trim())       || '';
    var body    = (bodyEl     && bodyEl.value.trim())       || '';
    var type    = (typeEl     && typeEl.value)               || 'general_message';
    var tmplId  = (tmplSel   && tmplSel.value)              || '';
    var notes   = (notesEl   && notesEl.value.trim())       || '';

    if (!email)   { _showMsg(msgEl, 'Recipient email is required.', '#ee7070'); return; }
    if (!subj)    { _showMsg(msgEl, 'Subject is required.',         '#ee7070'); return; }
    if (!body && !tmplId) { _showMsg(msgEl, 'Message body is required (or choose a template).', '#ee7070'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      var payload;
      if (tmplId) {
        // Send via template — fill variables from what we know
        payload = {
          method: 'POST',
          body: JSON.stringify({
            recipient_email: email,
            client_id:       _sendClientId  || undefined,
            template_id:     tmplId,
            variables: {
              client_name:  _sendClientName || '',
              subject:      subj,
              message_body: body,
            },
            metadata: notes ? { notes: notes } : undefined,
          }),
        };
        await api('/send-email?action=send_template', payload);
      } else {
        payload = {
          method: 'POST',
          body: JSON.stringify({
            recipient_email: email,
            client_id:       _sendClientId  || undefined,
            subject:         subj,
            text:            body,
            html:            '<div style="font-family:Georgia,serif;font-size:17px;line-height:1.75;color:#333;max-width:580px">' +
                               body.replace(/\n/g, '<br>') +
                             '</div>',
            message_type:    type,
            metadata:        notes ? { notes: notes } : undefined,
          }),
        };
        await api('/send-email?action=send_email', payload);
      }

      _showMsg(msgEl, 'Email sent successfully.', '#22c98a');
      // Reset form
      if (subjEl)     subjEl.value     = '';
      if (bodyEl)     bodyEl.value     = '';
      if (notesEl)    notesEl.value    = '';
      if (tmplSel)    tmplSel.value    = '';
      _sendClientId    = null;
      _sendClientEmail = null;
      _sendClientName  = null;

    } catch (e) {
      _showMsg(msgEl, 'Send failed: ' + e.message, '#ee7070');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Email'; }
    }
  };

  function _showMsg(el, msg, color) {
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = color || '#e8b84b';
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 4000);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PUBLIC LAUNCHER — called from follow-up center, financial center, etc.
  // Usage: window.cmOpenSend({ clientId, clientName, clientEmail, subject, type })
  // ════════════════════════════════════════════════════════════════════════
  window.cmOpenSend = function (opts) {
    opts = opts || {};
    _sendClientId    = opts.clientId    || null;
    _sendClientName  = opts.clientName  || null;
    _sendClientEmail = opts.clientEmail || null;
    if (typeof showTab === 'function') showTab('communications');
    setTimeout(function () {
      cmSection('send');
      if (opts.subject) {
        var subj = document.getElementById('cmSendSubject');
        if (subj) subj.value = opts.subject;
      }
    }, 200);
  };

  // ════════════════════════════════════════════════════════════════════════
  // CLIENT PROFILE — Communication History loader
  // Called by clients-module.js after profile renders
  // ════════════════════════════════════════════════════════════════════════
  window.cmLoadClientHistory = async function (clientId, clientName, clientEmail) {
    var wrap = document.getElementById('crmCommWrap');
    if (!wrap) return;

    try {
      var data = await api('/communications?section=client_history&client_id=' + clientId);
      var comms = data.communications || [];

      if (!comms.length) {
        wrap.innerHTML = '';
        return;
      }

      // Build history card using same caseSection pattern as clients-module.js
      var rows = comms.slice(0, 10).map(function (c) {
        return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #e8b84b0a">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.1em;color:#f0ecff;margin-bottom:2px;' +
              'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.subject || TYPE_LABELS[c.message_type] || c.message_type) + '</div>' +
            '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#9b7fe8">' + fmtDateShort(c.sent_at) + '</div>' +
          '</div>' +
          typePill(c.message_type) + '&nbsp;' + statusPill(c.status) +
        '</div>';
      }).join('');

      var sendLink = clientEmail
        ? '<div style="margin-top:14px;font-family:\'EB Garamond\',serif;font-size:15px;color:#9b7fe8;cursor:pointer;text-decoration:underline" ' +
            'onclick="window.cmOpenSend({clientId:\'' + esc(clientId) + '\',clientName:\'' + esc(clientName || '') + '\',clientEmail:\'' + esc(clientEmail || '') + '\'})">Send Message →</div>'
        : '';

      var viewAllLink =
        '<span style="color:#9b7fe8;cursor:pointer;text-decoration:underline;font-family:\'EB Garamond\',serif;font-size:15px" ' +
          'onclick="crmCloseProfileModal && crmCloseProfileModal();showTab(\'communications\');setTimeout(function(){cmSection(\'log\');},300)">View All →</span>';

      wrap.innerHTML =
        '<div style="background:#0d0a1e;border:1px solid #9b7fe833;padding:24px 28px;margin-bottom:28px;border-radius:2px">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:16px;letter-spacing:.22em;text-transform:uppercase;' +
            'color:#9b7fe8;margin-bottom:16px;margin-top:4px;padding-bottom:12px;border-bottom:1px solid #9b7fe833;' +
            'display:flex;align-items:center;justify-content:space-between">' +
            '<span>✉ Communication History</span>' +
            '<span style="font-family:\'EB Garamond\',serif;font-size:14px;color:#9b7fe866;font-style:italic;font-weight:400;letter-spacing:0">' +
              comms.length + ' message' + (comms.length !== 1 ? 's' : '') +
            '</span>' +
          '</div>' +
          rows +
          '<div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap">' +
            sendLink + viewAllLink +
          '</div>' +
        '</div>';

    } catch (e) {
      // Non-fatal — pre-migration state; just hide the section
      var w = document.getElementById('crmCommWrap');
      if (w) w.innerHTML = '';
    }
  };

})();
