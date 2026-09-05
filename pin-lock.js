(function () {
  var UI_MARKER_KEY = "rea_api_token";
  function unlockDashboard() {
    // Compatibility marker for legacy UI branches that only check truthiness.
    // It is not a credential; the server authenticates the HttpOnly cookie.
    sessionStorage.setItem(UI_MARKER_KEY, "cookie-session");
    var gate = document.getElementById("accessGate");
    if (gate) gate.classList.add("hidden");
    var lb = document.getElementById("logoutBtn");
    if (lb) lb.style.display = "";
    if (typeof window.initDashboard === "function") window.initDashboard();
  }

  function lockDashboard() {
    sessionStorage.removeItem(UI_MARKER_KEY);
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

  // The server creates an opaque, expiring HttpOnly cookie. No permanent
  // administrator secret is returned to or stored by browser JavaScript.
  async function verifyPin(pin) {
    try {
      var res = await fetch("/.netlify/functions/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin })
      });
      if (!res.ok) return { ok: false };
      var data = await res.json();
      return { ok: true };
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

    unlockDashboard();
  };

  window.doLogout = async function () {
    try { await fetch("/.netlify/functions/verify-pin", { method: "DELETE" }); } catch (_) {}
    lockDashboard();
  };

  document.addEventListener("DOMContentLoaded", function () {
    fetch("/.netlify/functions/verify-pin", { method: "GET" })
      .then(function (res) { if (res.ok) unlockDashboard(); })
      .catch(function () {});
  });
})();
