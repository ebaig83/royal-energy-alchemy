// policy-ack.js — shared client-policy acknowledgment widget.
//
// Drop into any policy page:
//   <div id="policyAck" data-doc-type="privacy_policy"
//        data-doc-title="Privacy Policy" data-doc-version="v1"></div>
//   <script defer src="/policy-ack.js"></script>
//
// Optional extra consent checkboxes (e.g. the AI/Recording policy) — place
// inside #policyAck before the script runs, each marked data-consent="key":
//   <label><input type="checkbox" data-consent="audio_recording"> I consent…</label>
//
// Behaviour:
//   • Reads ?token= from the URL (issued by the client portal).
//   • Records a "view" on load (best-effort) when a token is present.
//   • Renders: "I have read and understand this policy." checkbox + typed name
//     + auto date + submit. Posts an "acknowledge" action to the backend.
//   • Always mirrors acknowledgment to localStorage for dashboard fallback.
//   • Degrades gracefully without a token (local-only acknowledgment + notice).

(function () {
  'use strict';

  var GOLD = '#e8b84b';
  var mount = document.getElementById('policyAck');
  if (!mount) return;

  var docType    = mount.getAttribute('data-doc-type') || '';
  var docTitle   = mount.getAttribute('data-doc-title') || document.title;
  var docVersion = mount.getAttribute('data-doc-version') || 'v1';

  var params = new URLSearchParams(window.location.search);
  var token  = (params.get('token') || params.get('t') || '').trim();

  var ENDPOINT = '/.netlify/functions/client-documents';

  // Pull any consent checkboxes the page declared inside the mount.
  var consentInputs = Array.prototype.slice.call(mount.querySelectorAll('[data-consent]'));

  // ── Build the acknowledgment block ─────────────────────────────────────────
  var box = document.createElement('div');
  box.style.cssText =
    'margin-top:28px;border:1px solid rgba(232,184,75,.4);background:rgba(14,10,36,.92);' +
    'padding:24px 26px;box-shadow:0 16px 44px rgba(0,0,0,.24)';

  var today = new Date();
  var todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  var todayISO = today.toISOString().slice(0, 10);

  box.innerHTML =
    '<div style="font-family:\'Cinzel\',serif;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:' + GOLD + ';margin-bottom:16px">Acknowledgment</div>' +
    '<label style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;margin-bottom:18px;font-size:17px;color:rgba(246,241,255,.92);line-height:1.6">' +
      '<input type="checkbox" id="ackCheck" style="margin-top:5px;width:20px;height:20px;accent-color:' + GOLD + ';flex:none">' +
      '<span>I have read and understand this policy.</span>' +
    '</label>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">' +
      '<div><label style="display:block;font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:' + GOLD + ';margin-bottom:6px">Type your full name</label>' +
      '<input type="text" id="ackName" placeholder="Your full name" style="width:100%;padding:12px 14px;background:rgba(8,6,22,.9);border:1px solid rgba(232,184,75,.34);color:#fff;font-family:Georgia,serif;font-size:17px;font-style:italic"></div>' +
      '<div><label style="display:block;font-family:\'Cinzel\',serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:' + GOLD + ';margin-bottom:6px">Date</label>' +
      '<input type="text" id="ackDate" value="' + todayStr + '" readonly style="width:100%;padding:12px 14px;background:rgba(8,6,22,.6);border:1px solid rgba(232,184,75,.22);color:#c8c4e0;font-size:17px"></div>' +
    '</div>' +
    '<button type="button" id="ackSubmit" style="font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#160a00;background:linear-gradient(135deg,#f8e090,' + GOLD + ');border:none;padding:14px 28px;cursor:pointer;font-weight:700">Submit Acknowledgment</button>' +
    '<div id="ackMsg" style="margin-top:16px;font-size:16px;line-height:1.6"></div>';

  mount.appendChild(box);

  var msg = box.querySelector('#ackMsg');
  function setMsg(text, color) { msg.textContent = text; msg.style.color = color || '#c8c4e0'; }

  if (!token) {
    setMsg('Your acknowledgment will be saved locally on this device. Contact Royal Energy Alchemy if you need this added to your client record.', '#f8a84b');
  }

  function collectConsents() {
    if (!consentInputs.length) return null;
    var out = {};
    consentInputs.forEach(function (el) {
      out[el.getAttribute('data-consent')] = !!el.checked;
    });
    return out;
  }

  function localMirror() {
    try {
      var key = 'rea_policy_' + docType;
      localStorage.setItem(key, JSON.stringify({
        type: docType, version: docVersion,
        acknowledged_at: new Date().toISOString(),
        name: box.querySelector('#ackName').value.trim(),
      }));
    } catch (e) { /* ignore */ }
  }

  // ── Record a view (best-effort) ────────────────────────────────────────────
  if (token) {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, document_type: docType, title: docTitle, version: docVersion, action: 'view' }),
    }).catch(function () { /* non-fatal */ });
  }

  // ── Submit acknowledgment ──────────────────────────────────────────────────
  box.querySelector('#ackSubmit').addEventListener('click', function () {
    var checked = box.querySelector('#ackCheck').checked;
    var name    = box.querySelector('#ackName').value.trim();
    if (!checked) { setMsg('Please check the box to confirm you have read and understand this policy.', '#ff7777'); return; }
    if (!name)    { setMsg('Please type your full name to acknowledge.', '#ff7777'); return; }

    localMirror();

    if (!token) {
      setMsg('✓ Acknowledged locally. Contact Royal Energy Alchemy if you need this added to your client record.', '#22c98a');
      finishUI();
      return;
    }

    setMsg('Saving…', '#c8c4e0');
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token, document_type: docType, title: docTitle, version: docVersion,
        action: 'acknowledge', signature: name, consents: collectConsents(),
      }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { setMsg((res.j && res.j.error) || 'Could not save your acknowledgment.', '#ff7777'); return; }
        setMsg('✓ Acknowledgment recorded. Thank you, ' + name + '.', '#22c98a');
        finishUI();
      })
      .catch(function () { setMsg('Network error — please try again.', '#ff7777'); });
  });

  function finishUI() {
    box.querySelector('#ackSubmit').disabled = true;
    box.querySelector('#ackSubmit').style.opacity = '.5';
    box.querySelector('#ackSubmit').style.cursor = 'default';
    var back = document.createElement('a');
    back.href = token ? ('/client-portal.html?token=' + encodeURIComponent(token)) : '/';
    back.textContent = token ? '← Return to your portal' : '← Return home';
    back.style.cssText = 'display:inline-block;margin-top:14px;font-family:\'Cinzel\',serif;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:' + GOLD;
    msg.appendChild(document.createElement('br'));
    msg.appendChild(back);
  }
})();
