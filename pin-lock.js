(function () {
  var KEY       = "rea_pin_unlocked";
  var TOKEN_KEY = "rea_api_token";
  var HOURS     = 8;

  function isPinUnlocked() {
    var t = Number(sessionStorage.getItem(KEY));
    return t && Date.now() < t + HOURS * 3600000;
  }

  function unlockDashboard(apiToken) {
    sessionStorage.setItem(KEY, Date.now().toString());
    if (apiToken) sessionStorage.setItem(TOKEN_KEY, apiToken);
    var gate = document.getElementById("accessGate");
    if (gate) gate.classList.add("hidden");
    var lb = document.getElementById("logoutBtn");
    if (lb) lb.style.display = "";
    if (typeof window.initDashboard === "function") window.initDashboard();
  }

  function lockDashboard() {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    var gate = document.getElementById("accessGate");
    if (gate) gate.classList.remove("hidden");
    var lb = document.getElementById("logoutBtn");
    if (lb) lb.style.display = "none";
    var inp = document.getElementById("gatePass");
    if (inp) inp.value = "";
    var err = document.getElementById("gateErr");
    if (err) err.textContent = "";
    var btn = document.getElementById("gateBtn");
    if (btn) { btn.disabled = false; btn.textContent = "Unlock"; }
  }

  // Returns { ok, token } — token is the DASHBOARD_API_SECRET returned by the function.
  async function verifyPin(pin) {
    try {
      var res = await fetch("/.netlify/functions/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin })
      });
      if (!res.ok) return { ok: false };
      var data = await res.json();
      return { ok: true, token: data.token || "" };
    } catch (_) {
      return { ok: false };
    }
  }

  window.doLogin = async function () {
    var inp = document.getElementById("gatePass");
    var btn = document.getElementById("gateBtn");
    var err = document.getElementById("gateErr");
    var pin = inp ? inp.value.trim() : "";

    if (!pin) { err.textContent = "Please enter your PIN."; return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="gate-spinner"></span>Verifying…';
    err.textContent = "";

    var result = await verifyPin(pin);

    if (!result.ok) {
      btn.disabled = false;
      btn.textContent = "Unlock";
      err.textContent = "Invalid PIN.";
      if (inp) {
        inp.classList.add("error");
        setTimeout(function () { inp.classList.remove("error"); }, 600);
      }
      return;
    }

    unlockDashboard(result.token);
  };

  window.doLogout = lockDashboard;

  document.addEventListener("DOMContentLoaded", function () {
    if (isPinUnlocked()) {
      // Token already in sessionStorage from previous unlock — no re-fetch needed.
      unlockDashboard();
    }
  });
})();
