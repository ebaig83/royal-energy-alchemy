(function () {
  'use strict';

  var installPrompt = null;
  var button = document.getElementById('installDashboardBtn');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function hideButton() {
    if (button) button.hidden = true;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(function (error) {
          console.warn('Dashboard service worker registration failed:', error);
        });
    });
  }

  if (!button || isStandalone()) {
    hideButton();
    return;
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
  });

  button.addEventListener('click', async function () {
    if (!installPrompt) return;
    button.disabled = true;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    hideButton();
    button.disabled = false;
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    hideButton();
  });
})();
