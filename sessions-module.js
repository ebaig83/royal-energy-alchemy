// sessions-module.js
// Wires the Session Log tab entirely to the live /sessions + /session-notes API.
// Overrides the localStorage-based renderSessions() from dashboard.html.

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var _sessions    = [];
  var _loaded      = false;
  var _searchTimer = null;
  var _openSessId  = null;  // session currently open in notes modal

  // ── API helper ────────────────────────────────────────────────────────────
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

  // ── Shared helpers ────────────────────────────────────────────────────────
  var STATUS_CFG = {
    pending:    ['Pending',    '#f8a84b'],
    confirmed:  ['Confirmed',  '#66b5f8'],
    completed:  ['Completed',  '#22c98a'],
    cancelled:  ['Cancelled',  '#f07070'],
    no_show:    ['No-Show',    '#ff5555'],
    rescheduled:['Rescheduled','#b09ef8'],
  };

  var PAY_CFG = {
    unpaid:     ['Unpaid',     '#f07070'],
    paid:       ['Paid',       '#22c98a'],
    partial:    ['Partial',    '#f8a84b'],
    exchange:   ['Exchange',   '#9b7fe8'],
    waived:     ['Waived',     '#888888'],
  };

  function badge(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'text-transform:uppercase;color:' + color + ';background:' + color + '28;' +
      'border:1px solid ' + color + '66;padding:2px 10px;border-radius:2px;white-space:nowrap">' +
      label + '</span>';
  }

  function statusBadge(status) {
    var cfg = STATUS_CFG[status] || ['Unknown', '#888888'];
    return badge(cfg[0], cfg[1]);
  }

  function payBadge(status) {
    var cfg = PAY_CFG[status] || ['Unknown', '#888888'];
    return badge(cfg[0], cfg[1]);
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDay(d) {
    if (!d) return '';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  }

  function esc(s) { return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  function formLabel(txt) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;' +
      'text-transform:uppercase;color:#e8b84baa;margin-bottom:5px">' + txt + '</div>';
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function loadingHtml(msg) {
    return '<div style="padding:36px;text-align:center;color:#e8b84b99;' +
      'font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.3em">' +
      (msg || 'LOADING…') + '</div>';
  }

  function errorHtml(msg) {
    return '<div style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:15px;padding:20px;line-height:1.6">' +
      msg + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER SESSION LOG
  // ═══════════════════════════════════════════════════════════════════════════
  window.renderSessions = async function () {
    var el      = document.getElementById('sessionLog');
    var countEl = document.getElementById('sessCount');
    if (!el) return;

    var search = ((document.getElementById('sessSearch') || {}).value || '').trim().toLowerCase();
    var filter = ((document.getElementById('sessFilter') || {}).value || 'all');

    if (!_loaded) {
      el.innerHTML = loadingHtml('LOADING SESSIONS…');
    }

    if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null; }

    async function doLoad() {
      try {
        var data = await api('/sessions');
        _sessions = data.sessions || [];
        _loaded   = true;
      } catch (e) {
        el.innerHTML = errorHtml('Failed to load sessions: ' + e.message);
        if (countEl) countEl.textContent = '';
        return;
      }

      var list = _sessions.slice();

      if (search) {
        list = list.filter(function(s) {
          return (s.client_name || '').toLowerCase().includes(search) ||
                 (s.session_date || '').includes(search) ||
                 (s.service || '').toLowerCase().includes(search);
        });
      }

      if (filter === 'paid')        list = list.filter(function(s) { return s.payment_status === 'paid'; });
      if (filter === 'exchange')    list = list.filter(function(s) { return s.payment_status === 'exchange'; });
      if (filter === 'distance')    list = list.filter(function(s) { return s.location_type === 'distance'; });
      if (filter === 'in_person')   list = list.filter(function(s) { return s.location_type === 'in_person'; });
      if (filter === 'completed')   list = list.filter(function(s) { return s.status === 'completed'; });
      if (filter === 'pending')     list = list.filter(function(s) { return s.status === 'pending'; });
      if (filter === 'upcoming')    list = list.filter(function(s) {
        return s.session_date >= todayISO() && (s.status === 'pending' || s.status === 'confirmed');
      });

      if (countEl) countEl.textContent = list.length + ' session' + (list.length !== 1 ? 's' : '');

      if (!list.length) {
        el.innerHTML = '<p style="color:#dddaeecc;font-style:italic;padding:24px 0">No sessions match.</p>';
        return;
      }

      el.innerHTML = list.map(buildSessionCard).join('');
    }

    if (search) { _searchTimer = setTimeout(doLoad, 280); }
    else        { await doLoad(); }
  };

  // ── Session card ──────────────────────────────────────────────────────────
  function buildSessionCard(s) {
    var id      = s.id;
    var name    = s.client_name || '(unnamed client)';
    var status  = s.status || 'pending';
    var pay     = s.payment_status || 'unpaid';
    var svcCfg  = STATUS_CFG[status] || ['Pending', '#f8a84b'];
    var isPast  = s.session_date && s.session_date < todayISO();
    var dim     = (status === 'cancelled' || status === 'no_show') ? 'opacity:.6;' : '';

    var amtStr = '';
    if (s.amount_due)  amtStr = '$' + parseFloat(s.amount_due).toFixed(2);
    if (s.amount_paid && s.amount_paid !== s.amount_due) {
      amtStr += ' (paid $' + parseFloat(s.amount_paid).toFixed(2) + ')';
    }

    return '<div style="background:#0e0b1f;border:1px solid #e8b84b44;padding:18px 22px;' +
      'margin-bottom:14px;cursor:pointer;transition:border-color .15s;' + dim + '"' +
      ' onmouseover="this.style.borderColor=\'#e8b84b88\'" onmouseout="this.style.borderColor=\'#e8b84b44\'"' +
      ' onclick="snOpenSession(\'' + esc(id) + '\')">' +

      '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +

        '<div style="flex:1;min-width:0">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.06em;' +
            'color:#f0ecff;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            name + ' ' + statusBadge(status) + ' ' + payBadge(pay) +
          '</div>' +

          '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#e8b84baa;margin-top:5px">' +
            (s.session_date ? fmtDate(s.session_date) + ' · ' + fmtDay(s.session_date) : '(no date)') +
            (s.session_time ? ' · ' + s.session_time.slice(0,5) : '') +
            (s.service ? ' · ' + s.service : '') +
            (s.location_type ? ' · ' + (s.location_type === 'distance' ? 'Distance' : 'In Person') : '') +
          '</div>' +

          (amtStr
            ? '<div style="font-family:\'EB Garamond\',serif;font-size:14px;color:#22c98acc;margin-top:3px">' +
                amtStr + '</div>'
            : '') +
        '</div>' +

        '<div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">' +
          (status !== 'completed'
            ? '<button onclick="event.stopPropagation();snMarkComplete(\'' + esc(id) + '\')" ' +
                'style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;' +
                'background:#22c98a1a;border:1px solid #22c98a66;color:#22c98a;padding:5px 12px;cursor:pointer">' +
                '✓ Complete</button>'
            : '') +
          '<button onclick="event.stopPropagation();snOpenSession(\'' + esc(id) + '\')" ' +
            'style="font-family:\'Cinzel\',serif;font-size:8px;letter-spacing:.2em;text-transform:uppercase;' +
            'background:#e8b84b0d;border:1px solid #e8b84b55;color:#e8b84b;padding:5px 12px;cursor:pointer">' +
            '📝 Notes</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Mark complete (shortcut — no modal) ──────────────────────────────────
  window.snMarkComplete = async function (id) {
    try {
      await api('/sessions?id=' + id, {
        method: 'PATCH',
        body:   JSON.stringify({ status: 'completed', _context: 'Marked complete from session log' }),
      });
      _loaded = false;
      await window.renderSessions();
    } catch (e) { alert('Could not mark complete: ' + e.message); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION NOTES MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.snOpenSession = async function (id) {
    _openSessId = id;
    var modal = document.getElementById('snModal');
    var body  = document.getElementById('snModalBody');
    if (!modal) return;
    body.innerHTML = loadingHtml('LOADING SESSION…');
    modal.classList.add('open');
    await loadSessionDetail(id);
  };

  async function loadSessionDetail(id) {
    var body = document.getElementById('snModalBody');
    if (!body) return;

    try {
      var data  = await api('/sessions?id=' + id);
      var s     = data.session;
      var notes = s.session_notes || [];
      var pays  = s.payments      || [];

      // ── Client compliance data (if client_id available) ───────────
      var waiverSigned = false, hasIntake = false, intakeDate = null, latestIntake = null;
      if (s.client_id) {
        try {
          var tlData   = await api('/timeline?client_id=' + s.client_id);
          var clData   = await api('/clients?id=' + s.client_id);
          var clTags   = (clData.client && clData.client.tags) || [];
          waiverSigned = clTags.some(function(t) { return t.toLowerCase() === 'waiver'; });
          var intakeEvs = (tlData.timeline || []).filter(function(e) { return e.type === 'intake'; });
          hasIntake     = intakeEvs.length > 0;
          intakeDate    = hasIntake ? intakeEvs[intakeEvs.length - 1].date : null;
          latestIntake  = hasIntake ? intakeEvs[0].data : null;
        } catch (_) { /* compliance data optional */ }
      }

      // ── Missing requirements ──────────────────────────────────────
      var missing = [];
      if (!waiverSigned)            missing.push({ icon: '⚠', label: 'Waiver not on file',    hint: 'Add tag "waiver" to client once signed.' });
      if (!hasIntake)               missing.push({ icon: '⚠', label: 'No intake on file',      hint: 'Client has not submitted an intake form.' });
      if (!pays.length)             missing.push({ icon: '○', label: 'No payment recorded',    hint: 'Log a payment for this session.' });
      if (!notes.length)            missing.push({ icon: '○', label: 'No session notes yet',   hint: 'Add notes below.' });

      var missingBox = missing.length
        ? '<div style="background:#ff70700d;border:1px solid #ff555533;padding:12px 16px;margin-bottom:18px">' +
            '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;' +
              'color:#ff8888;margin-bottom:8px">Needs Completion</div>' +
            missing.map(function(m) {
              return '<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:5px">' +
                '<span style="color:#ff8888;font-size:11px;flex-shrink:0">' + m.icon + '</span>' +
                '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.15em;' +
                  'text-transform:uppercase;color:#ffaaaa">' + m.label + '</span>' +
                '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee66">' + m.hint + '</span>' +
              '</div>';
            }).join('') +
          '</div>'
        : '';

      // ── Compliance badges ─────────────────────────────────────────
      var wBadge = snCompBadge(
        waiverSigned ? '✓ Waiver on File' : '⚠ Waiver Missing',
        waiverSigned ? '#22c98a' : '#ff5555'
      );
      var iBadge = snCompBadge(
        hasIntake ? ('✓ Intake · ' + fmtDate(intakeDate)) : '⚠ Intake Missing',
        hasIntake ? '#22c98a' : '#f8a84b'
      );

      // ── Intake summary ────────────────────────────────────────────
      var intakeSummaryHtml = '';
      if (latestIntake) {
        var iLines = [];
        if (latestIntake.service_requested) iLines.push(['Requested', latestIntake.service_requested]);
        if (latestIntake.message)           iLines.push(['Message',   latestIntake.message]);
        if (latestIntake.agent_summary)     iLines.push(['Summary',   latestIntake.agent_summary]);
        if (iLines.length) {
          intakeSummaryHtml =
            '<div style="background:#f8a84b0d;border:1px solid #f8a84b33;padding:12px 16px;margin-bottom:18px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;' +
                'color:#f8a84b;margin-bottom:8px">Intake / Assessment</div>' +
              iLines.map(function(fl) {
                return '<div style="margin-bottom:6px">' +
                  '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;' +
                    'color:#e8b84baa">' + fl[0] + ': </span>' +
                  '<span style="font-family:\'EB Garamond\',serif;font-size:14px;color:#e8e6f8">' + fl[1] + '</span>' +
                '</div>';
              }).join('') +
            '</div>';
        }
      }

      // ── Environmental context (from env log via getEnvForDate) ────
      var envEntry = (s.session_date && typeof getEnvForDate === 'function')
        ? getEnvForDate(s.session_date) : null;
      var envPills = '';
      if (envEntry) {
        var pills = [];
        if (envEntry.moon)       pills.push({ label: envEntry.moon,                 color: '#dddaee' });
        if (envEntry.schumann)   pills.push({ label: 'Schumann: ' + envEntry.schumann + (envEntry.schumannVal ? ' (' + envEntry.schumannVal + ')' : ''), color: envEntry.schumann === 'Normal' ? '#22c98a' : envEntry.schumann === 'Elevated' ? '#f8e090' : envEntry.schumann === 'High' ? '#e8b84b' : '#ee7070' });
        if (envEntry.solar)      pills.push({ label: 'Solar: ' + envEntry.solar,    color: '#f8a84b' });
        if (envEntry.geo)        pills.push({ label: 'Geo: ' + envEntry.geo,        color: '#66b5f8' });
        envPills = pills.map(function(p) {
          return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;' +
            'color:' + p.color + ';border:1px solid ' + p.color + '44;padding:3px 10px;white-space:nowrap">' +
            p.label + '</span>';
        }).join('');
      }

      var envSection =
        '<div style="background:#07051a;border:1px solid #9b7fe844;padding:14px 16px;margin-bottom:22px">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.35em;text-transform:uppercase;' +
            'color:#9b7fe8;margin-bottom:10px">Environmental Context ' +
            '<span style="color:#dddaee44;font-size:8px;letter-spacing:.2em;font-weight:400">— observational only, not causal</span>' +
          '</div>' +
          (envPills
            ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + envPills + '</div>'
            : '<div style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee44;margin-bottom:12px;font-style:italic">' +
                'No environmental data on file for this date. Visit the Environment tab to fetch live data.' +
              '</div>') +
          formLabel('Practitioner Environmental Notes') +
          '<textarea id="snEnvNotes" class="modal-notes" ' +
            'placeholder="e.g. Client reported high sensitivity, cloudy day, barometric drop noticed…" ' +
            'style="min-height:54px;margin-bottom:8px;border-color:#9b7fe855"></textarea>' +
          formLabel('Client-Reported Environmental Sensitivity') +
          '<input id="snEnvSensitivity" type="text" class="appt-input" ' +
            'placeholder="e.g. Had headache, felt energetically congested…" ' +
            'style="width:100%;background:#04020e;color:#f0ecff;border-color:#9b7fe855">' +
        '</div>';

      // ── Status / payment options ──────────────────────────────────
      var statusOpts = Object.keys(STATUS_CFG).map(function(k) {
        var cfg = STATUS_CFG[k];
        return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + cfg[0] + '</option>';
      }).join('');
      var payOpts = Object.keys(PAY_CFG).map(function(k) {
        var cfg = PAY_CFG[k];
        return '<option value="' + k + '"' + (s.payment_status === k ? ' selected' : '') + '>' + cfg[0] + '</option>';
      }).join('');

      // ── Notes list ────────────────────────────────────────────────
      var notesHtml = notes.length
        ? notes.map(function(n) {
            var env = n.env_notes;
            var envLine = '';
            if (env) {
              var parts = [];
              if (env.moon)        parts.push(env.moon);
              if (env.schumann)    parts.push('Schumann: ' + env.schumann);
              if (env.solar)       parts.push('Solar: ' + env.solar);
              if (env.notes)       parts.push(env.notes);
              if (env.sensitivity) parts.push('Client: ' + env.sensitivity);
              if (parts.length) envLine = '<div style="margin-top:6px;font-family:\'Cinzel\',serif;font-size:9px;' +
                'letter-spacing:.2em;text-transform:uppercase;color:#9b7fe8aa">🌿 ' + parts.join(' · ') + '</div>';
            }
            return '<div style="background:#07051a;border-left:2px solid #e8b84b44;padding:12px 16px;margin-bottom:10px">' +
              '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
                'color:#e8b84b88;margin-bottom:6px">' + (n.note_type || 'note') + ' · ' + fmtDate(n.created_at) + '</div>' +
              '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#e8e6f8;line-height:1.65;' +
                'white-space:pre-wrap">' + (n.content || '') + '</div>' +
              (n.energy_findings ? '<div style="margin-top:8px;font-family:\'EB Garamond\',serif;font-size:14px;' +
                'color:#b09ef8;font-style:italic">Energy: ' + n.energy_findings + '</div>' : '') +
              (n.recommendations ? '<div style="margin-top:4px;font-family:\'EB Garamond\',serif;font-size:14px;' +
                'color:#66b5f8;font-style:italic">Recommendations: ' + n.recommendations + '</div>' : '') +
              envLine +
            '</div>';
          }).join('')
        : '<p style="color:#dddaee66;font-style:italic;font-family:\'EB Garamond\',serif;font-size:15px">No notes yet for this session.</p>';

      // ── Payments list ─────────────────────────────────────────────
      var paysHtml = pays.length
        ? pays.map(function(p) {
            return '<div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid #e8b84b0e">' +
              '<span style="font-family:\'Cinzel\',serif;font-size:12px;color:#22c98a">$' + parseFloat(p.amount || 0).toFixed(2) + '</span>' +
              '<span style="font-family:\'EB Garamond\',serif;font-size:14px;color:#dddaee99">' + (p.method || '') + (p.notes ? ' — ' + p.notes : '') + '</span>' +
              '<span style="font-family:\'EB Garamond\',serif;font-size:13px;color:#dddaee55;margin-left:auto">' + fmtDate(p.paid_at) + '</span>' +
            '</div>';
          }).join('')
        : '<p style="color:#dddaee55;font-style:italic;font-family:\'EB Garamond\',serif;font-size:14px">No payments logged.</p>';

      body.innerHTML =
        // ── Missing requirements ──────────────────────────────────
        missingBox +

        // ── Compliance badges ─────────────────────────────────────
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">' + wBadge + iBadge + '</div>' +

        // ── Intake summary ────────────────────────────────────────
        intakeSummaryHtml +

        // ── Session header grid ───────────────────────────────────
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">' +
          infoCell('Client',     s.client_name || '—') +
          infoCell('Date',       fmtDate(s.session_date) + (s.session_date ? ' · ' + fmtDay(s.session_date) : '')) +
          infoCell('Service',    s.service || '—') +
          infoCell('Location',   s.location_type === 'distance' ? 'Distance' : 'In Person') +
          infoCell('Duration',   s.duration_minutes ? s.duration_minutes + ' min' : '—') +
          infoCell('Amount Due', s.amount_due ? '$' + parseFloat(s.amount_due).toFixed(2) : '—') +
        '</div>' +

        // ── Status / payment update row ───────────────────────────
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;' +
          'padding:14px;background:#07051a;border:1px solid #e8b84b22;margin-bottom:22px">' +
          '<div style="flex:1;min-width:160px">' +
            formLabel('Session Status') +
            '<select id="snStatusSel" onchange="snUpdateSession()" ' +
              'style="width:100%;background:#04020e;color:#f0ecff;border:1px solid #e8b84b44;' +
              'padding:7px 10px;font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em">' +
              statusOpts +
            '</select>' +
          '</div>' +
          '<div style="flex:1;min-width:160px">' +
            formLabel('Payment Status') +
            '<select id="snPaySel" onchange="snUpdateSession()" ' +
              'style="width:100%;background:#04020e;color:#f0ecff;border:1px solid #e8b84b44;' +
              'padding:7px 10px;font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em">' +
              payOpts +
            '</select>' +
          '</div>' +
          '<div style="flex:0 0 auto;margin-top:18px">' +
            '<div id="snUpdateMsg" style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;' +
              'color:#22c98a;text-transform:uppercase;min-height:16px"></div>' +
          '</div>' +
        '</div>' +

        // ── Environmental context ─────────────────────────────────
        envSection +

        // ── Add note form ─────────────────────────────────────────
        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;' +
          'color:#e8b84bcc;margin-bottom:12px">Add Session Note</div>' +

        '<div style="background:#07051a;border:1px solid #e8b84b33;padding:18px;margin-bottom:22px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
            '<div>' +
              formLabel('Note Type') +
              '<select id="snNoteType" ' +
                'style="width:100%;background:#04020e;color:#f0ecff;border:1px solid #e8b84b44;' +
                'padding:7px 10px;font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.2em">' +
                '<option value="session">Session Notes</option>' +
                '<option value="pre_session">Pre-Session</option>' +
                '<option value="post_session">Post-Session</option>' +
                '<option value="energy_reading">Energy Reading</option>' +
                '<option value="follow_up">Follow-up</option>' +
                '<option value="manual_event">Manual Event</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              formLabel('Energy Findings (optional)') +
              '<input id="snEnergyFindings" type="text" placeholder="e.g. Solar plexus blockage…" ' +
                'class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
            '</div>' +
          '</div>' +

          formLabel('Notes') +
          '<textarea id="snNoteContent" class="modal-notes" ' +
            'placeholder="What happened in this session? What was cleared? Client response, energetic findings, guidance received…" ' +
            'style="min-height:100px;margin-bottom:10px;border-color:#e8b84b44"></textarea>' +

          formLabel('Recommendations (optional)') +
          '<input id="snRecommendations" type="text" placeholder="e.g. Follow-up in 3 weeks, crystal work…" ' +
            'class="appt-input" style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;margin-bottom:14px">' +

          '<div id="snNoteError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;min-height:16px;margin-bottom:8px"></div>' +
          '<div style="display:flex;gap:10px;align-items:center">' +
            '<button id="snSaveNoteBtn" class="action-btn approve" onclick="snSaveNote()" style="padding:8px 24px">Save Note</button>' +
            '<label style="display:flex;align-items:center;gap:6px;font-family:\'Cinzel\',serif;font-size:9px;' +
              'letter-spacing:.2em;text-transform:uppercase;color:#e8b84b99;cursor:pointer">' +
              '<input type="checkbox" id="snEnhance" style="accent-color:#e8b84b"> Enhance with AI' +
            '</label>' +
          '</div>' +
        '</div>' +

        // ── Existing notes ────────────────────────────────────────
        '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;' +
          'color:#e8b84bcc;margin-bottom:12px">Session Notes (' + notes.length + ')</div>' +
        '<div id="snNotesList">' + notesHtml + '</div>' +

        // ── Payments ──────────────────────────────────────────────
        '<div style="margin-top:22px;border-top:1px solid #e8b84b1a;padding-top:16px">' +
          '<div style="font-family:\'Cinzel\',serif;font-size:10px;letter-spacing:.3em;text-transform:uppercase;' +
            'color:#e8b84bcc;margin-bottom:10px">Payments</div>' +
          paysHtml +
        '</div>' +

        // ── Footer actions ────────────────────────────────────────
        '<div style="margin-top:22px;border-top:1px solid #e8b84b22;padding-top:16px;display:flex;gap:10px;flex-wrap:wrap">' +
          (s.client_id
            ? '<button class="action-btn view" style="border-color:#9b7fe866;color:#b09ef8" ' +
                'onclick="snCloseModal();crmOpenTimeline(\'' + esc(s.client_id) + '\')">' +
                '⏱ Client Timeline</button>'
            : '') +
          (s.status !== 'completed'
            ? '<button class="action-btn approve" onclick="snMarkComplete(\'' + esc(s.id) + '\')" ' +
                'style="border-color:#22c98a66">✓ Mark Complete</button>'
            : '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
                'color:#22c98a;padding:8px 0">✓ Session Completed</span>') +
        '</div>';

    } catch (e) {
      body.innerHTML = errorHtml('Failed to load session: ' + e.message);
    }
  }

  function snCompBadge(label, color) {
    return '<span style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.25em;text-transform:uppercase;' +
      'color:' + color + ';background:' + color + '18;border:1px solid ' + color + '55;' +
      'padding:4px 12px;border-radius:2px;white-space:nowrap">' + label + '</span>';
  }

  function infoCell(label, val) {
    return '<div>' +
      '<div style="font-family:\'Cinzel\',serif;font-size:9px;letter-spacing:.3em;text-transform:uppercase;' +
        'color:#e8b84baa;margin-bottom:4px">' + label + '</div>' +
      '<div style="font-family:\'EB Garamond\',serif;font-size:15px;color:#f0ecff">' + (val || '—') + '</div>' +
    '</div>';
  }

  // ── Update session status / payment inline ────────────────────────────────
  var _updateDebounce = null;
  window.snUpdateSession = function () {
    if (_updateDebounce) clearTimeout(_updateDebounce);
    _updateDebounce = setTimeout(async function() {
      var id     = _openSessId;
      var status = (document.getElementById('snStatusSel') || {}).value;
      var pay    = (document.getElementById('snPaySel')    || {}).value;
      var msg    = document.getElementById('snUpdateMsg');
      if (!id) return;
      try {
        await api('/sessions?id=' + id, {
          method: 'PATCH',
          body:   JSON.stringify({ status: status, payment_status: pay, _context: 'Status update from session modal' }),
        });
        if (msg) { msg.textContent = 'Saved ✓'; setTimeout(function() { if (msg) msg.textContent = ''; }, 1800); }
        _loaded = false;
        // Silently refresh the session log in background
        window.renderSessions().catch(function(){});
      } catch (e) {
        if (msg) msg.textContent = 'Error: ' + e.message;
      }
    }, 600);
  };

  // ── Save session note ─────────────────────────────────────────────────────
  window.snSaveNote = async function () {
    var id       = _openSessId;
    var content  = (document.getElementById('snNoteContent')    || {}).value || '';
    var noteType = (document.getElementById('snNoteType')        || {}).value || 'session';
    var energy   = (document.getElementById('snEnergyFindings') || {}).value || '';
    var recs     = (document.getElementById('snRecommendations') || {}).value || '';
    var enhance  = (document.getElementById('snEnhance')        || {}).checked || false;
    var errEl    = document.getElementById('snNoteError');
    var saveBtn  = document.getElementById('snSaveNoteBtn');

    if (!content.trim()) { if (errEl) errEl.textContent = 'Notes are required.'; return; }
    if (errEl) errEl.textContent = '';

    // Collect environmental context fields
    var envNotesText  = ((document.getElementById('snEnvNotes')        || {}).value || '').trim();
    var envSensText   = ((document.getElementById('snEnvSensitivity')  || {}).value || '').trim();
    var envEntry      = null;
    if (_openSessId) {
      // Try to get the session date from the header grid for env lookup
      try {
        var dateCell = document.querySelector('#snModalBody .session-date-cell');
        var sessDate = dateCell ? dateCell.dataset.date : null;
        if (sessDate && typeof getEnvForDate === 'function') envEntry = getEnvForDate(sessDate);
      } catch (_) {}
    }
    var envPayload = null;
    if (envNotesText || envSensText || envEntry) {
      envPayload = {};
      if (envEntry) {
        if (envEntry.moon)       envPayload.moon       = envEntry.moon;
        if (envEntry.schumann)   envPayload.schumann   = envEntry.schumann;
        if (envEntry.schumannVal)envPayload.schumannVal= envEntry.schumannVal;
        if (envEntry.solar)      envPayload.solar      = envEntry.solar;
        if (envEntry.geo)        envPayload.geo        = envEntry.geo;
      }
      if (envNotesText) envPayload.notes       = envNotesText;
      if (envSensText)  envPayload.sensitivity = envSensText;
    }

    var payload = {
      session_id:      id,
      note_type:       noteType,
      content:         content.trim(),
      energy_findings: energy.trim() || null,
      recommendations: recs.trim()   || null,
      env_notes:       envPayload,
      enhance:         enhance,
    };

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Saving…';

    try {
      await api('/session-notes', { method: 'POST', body: JSON.stringify(payload) });
      // Clear form fields
      document.getElementById('snNoteContent').value    = '';
      document.getElementById('snEnergyFindings').value = '';
      document.getElementById('snRecommendations').value = '';
      // Reload modal body to show new note
      await loadSessionDetail(id);
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Save Note';
    }
  };

  // ── Close modal ───────────────────────────────────────────────────────────
  window.snCloseModal = function (e) {
    if (e && e.target !== document.getElementById('snModal')) return;
    document.getElementById('snModal').classList.remove('open');
    _openSessId = null;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE SESSION MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  window.snOpenCreate = function () {
    var modal = document.getElementById('snCreateModal');
    if (!modal) return;
    document.getElementById('snCreateError').textContent = '';
    document.getElementById('snCreateSaveBtn').disabled  = false;
    document.getElementById('snCreateSaveBtn').textContent = 'Create Session';
    // Default date to today
    var dateEl = document.getElementById('snCreateDate');
    if (dateEl && !dateEl.value) dateEl.value = todayISO();
    modal.classList.add('open');
    setTimeout(function() {
      var f = document.getElementById('snCreateClientName');
      if (f) f.focus();
    }, 80);
  };

  window.snCloseCreateModal = function (e) {
    if (e && e.target !== document.getElementById('snCreateModal')) return;
    document.getElementById('snCreateModal').classList.remove('open');
  };

  window.snSaveCreate = async function () {
    var name    = (document.getElementById('snCreateClientName') || {}).value || '';
    var date    = (document.getElementById('snCreateDate')       || {}).value || '';
    var time    = (document.getElementById('snCreateTime')       || {}).value || null;
    var service = (document.getElementById('snCreateService')    || {}).value || '';
    var locType = (document.getElementById('snCreateLocType')    || {}).value || 'distance';
    var dur     = parseInt((document.getElementById('snCreateDuration') || {}).value || '60', 10);
    var amount  = (document.getElementById('snCreateAmount')     || {}).value || null;
    var errEl   = document.getElementById('snCreateError');
    var btn     = document.getElementById('snCreateSaveBtn');

    if (!name.trim()) { errEl.textContent = 'Client name is required.'; return; }

    errEl.textContent   = '';
    btn.disabled        = true;
    btn.textContent     = 'Creating…';

    try {
      var payload = {
        client_name:      name.trim(),
        session_date:     date || null,
        session_time:     time || null,
        service:          service.trim() || null,
        location_type:    locType,
        duration_minutes: dur,
        amount_due:       amount ? parseFloat(amount) : null,
        status:           'pending',
        payment_status:   'unpaid',
        source:           'manual',
      };
      var data = await api('/sessions', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('snCreateModal').classList.remove('open');
      _loaded = false;
      await window.renderSessions();
      // Auto-open the new session for notes
      if (data.session && data.session.id) {
        await window.snOpenSession(data.session.id);
      }
    } catch (e) {
      errEl.textContent   = e.message;
      btn.disabled        = false;
      btn.textContent     = 'Create Session';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INJECT MODALS + BUTTON INTO DOM
  // ═══════════════════════════════════════════════════════════════════════════
  function injectUI() {
    // ── "+ New Session" button in sessions tab header ────────────────────
    var sessHeader = document.querySelector('#tab-sessions .section-title');
    if (sessHeader && !document.getElementById('snNewBtn')) {
      var btn = document.createElement('button');
      btn.id        = 'snNewBtn';
      btn.className = 'action-btn approve';
      btn.textContent = '+ New Session';
      btn.style.cssText = 'padding:6px 18px;font-size:10px';
      btn.onclick = function() { window.snOpenCreate(); };
      sessHeader.appendChild(btn);
    }

    // ── Fix Sessions filter to include our new filter values ─────────────
    var filterEl = document.getElementById('sessFilter');
    if (filterEl && !filterEl.querySelector('option[value="upcoming"]')) {
      var extraOpts = [
        ['upcoming',  'Upcoming'],
        ['completed', 'Completed'],
        ['pending',   'Pending'],
        ['in_person', 'In Person'],
      ];
      extraOpts.forEach(function(pair) {
        var opt = document.createElement('option');
        opt.value       = pair[0];
        opt.textContent = pair[1];
        filterEl.appendChild(opt);
      });
    }

    // ── Session Notes modal (detail + notes) ─────────────────────────────
    if (!document.getElementById('snModal')) {
      var snModal = document.createElement('div');
      snModal.id        = 'snModal';
      snModal.className = 'modal-overlay';
      snModal.onclick   = window.snCloseModal;
      snModal.innerHTML =
        '<div class="modal" style="max-width:720px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">' +
          '<button class="modal-close" onclick="snCloseModal()">✕</button>' +
          '<h2 id="snModalTitle">Session</h2>' +
          '<div class="modal-sub">Notes, status &amp; payment</div>' +
          '<div id="snModalBody" style="margin-top:16px"></div>' +
        '</div>';
      document.body.appendChild(snModal);
    }

    // ── Create Session modal ─────────────────────────────────────────────
    if (!document.getElementById('snCreateModal')) {
      var snCreate = document.createElement('div');
      snCreate.id        = 'snCreateModal';
      snCreate.className = 'modal-overlay';
      snCreate.onclick   = window.snCloseCreateModal;
      snCreate.innerHTML =
        '<div class="modal" style="max-width:560px" onclick="event.stopPropagation()">' +
          '<button class="modal-close" onclick="snCloseCreateModal()">✕</button>' +
          '<h2>New Session</h2>' +
          '<div class="modal-sub">Log a session manually</div>' +
          '<div style="margin-top:16px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +

              '<div style="grid-column:span 2">' +
                formLabel('Client Name *') +
                '<input id="snCreateClientName" type="text" placeholder="Full name" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
              '</div>' +

              '<div>' +
                formLabel('Date') +
                '<input id="snCreateDate" type="date" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
              '</div>' +

              '<div>' +
                formLabel('Time') +
                '<input id="snCreateTime" type="time" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44;color-scheme:dark">' +
              '</div>' +

              '<div>' +
                formLabel('Service') +
                '<select id="snCreateService" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                  '<option value="">Select service…</option>' +
                  '<option value="Energy Healing">Energy Healing</option>' +
                  '<option value="Distance Healing">Distance Healing</option>' +
                  '<option value="Tarot Reading">Tarot Reading</option>' +
                  '<option value="Chakra Clearing">Chakra Clearing</option>' +
                  '<option value="Entity Removal">Entity Removal</option>' +
                  '<option value="Consultation">Consultation</option>' +
                  '<option value="Other">Other</option>' +
                '</select>' +
              '</div>' +

              '<div>' +
                formLabel('Location') +
                '<select id="snCreateLocType" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
                  '<option value="distance">Distance</option>' +
                  '<option value="in_person">In Person</option>' +
                '</select>' +
              '</div>' +

              '<div>' +
                formLabel('Duration (min)') +
                '<input id="snCreateDuration" type="number" value="60" min="15" max="480" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
              '</div>' +

              '<div>' +
                formLabel('Amount Due ($)') +
                '<input id="snCreateAmount" type="number" min="0" step="0.01" placeholder="0.00" class="appt-input" ' +
                  'style="width:100%;background:#04020e;color:#f0ecff;border-color:#e8b84b44">' +
              '</div>' +

            '</div>' +
            '<div id="snCreateError" style="color:#ff7070;font-family:\'EB Garamond\',serif;font-size:14px;' +
              'min-height:18px;margin-top:14px"></div>' +
            '<div style="display:flex;gap:10px;margin-top:16px">' +
              '<button id="snCreateSaveBtn" class="action-btn approve" onclick="snSaveCreate()" ' +
                'style="padding:8px 24px">Create Session</button>' +
              '<button class="action-btn" onclick="snCloseCreateModal()">Cancel</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(snCreate);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  // Clear stale localStorage session log immediately
  (function () {
    var el = document.getElementById('sessionLog');
    if (el) el.innerHTML = '';
    var ct = document.getElementById('sessCount');
    if (ct) ct.textContent = '';
  })();

  // Patch showTab to auto-load when Sessions tab opens
  var _origShowTab = window.showTab;
  window.showTab = function (name) {
    if (_origShowTab) _origShowTab(name);
    if (name === 'sessions') window.renderSessions();
  };

  // Inject UI after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      injectUI();
      var active = document.querySelector('.tab-content.active');
      if (active && active.id === 'tab-sessions') window.renderSessions();
    });
  } else {
    injectUI();
    var active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-sessions') window.renderSessions();
  }

})();
