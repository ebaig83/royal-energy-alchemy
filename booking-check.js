// ============================================================
// booking-check.js — Royal Energy Alchemy
// Runs on index.html contact/booking form.
// Checks submitted name + email against REA_FLAGS blocked list.
// Blocked clients see a generic unavailability message.
// Warned clients can proceed but a hidden flag is added to the form.
// ============================================================
// Depends on: clients-data.js (must load first)
// ============================================================

(function() {
  'use strict';

  // Wait for DOM ready
  document.addEventListener('DOMContentLoaded', function() {

    // Find the booking form (Netlify form named "booking")
    const form = document.querySelector('form[name="booking"]');
    if (!form) return;

    // Find name + email fields
    const nameField  = form.querySelector('input[name="name"], input[name="full_name"], input[placeholder*="name" i], input[id*="name" i]');
    const emailField = form.querySelector('input[type="email"], input[name="email"]');

    if (!nameField && !emailField) return;

    // Inject a hidden flag field into the form for warned clients
    const warnFlag = document.createElement('input');
    warnFlag.type  = 'hidden';
    warnFlag.name  = 'internal_flag';
    warnFlag.value = '';
    form.appendChild(warnFlag);

    // Create the block message element (hidden by default)
    const blockMsg = document.createElement('div');
    blockMsg.id = 'rea-block-msg';
    blockMsg.style.cssText = [
      'display:none',
      'margin:16px 0',
      'padding:16px 20px',
      'background:#ee44440d',
      'border:1px solid #ee444433',
      'font-family:Cinzel,serif',
      'font-size:12px',
      'letter-spacing:.25em',
      'color:#ee7070cc',
      'text-transform:uppercase',
      'text-align:center',
      'line-height:1.8'
    ].join(';');
    blockMsg.textContent = 'This time slot is currently unavailable. Please contact us directly at royalenergyalchemy@gmail.com or 814-392-2095.';

    // Insert message before the submit button
    const submitBtn = form.querySelector('[type="submit"], button');
    if (submitBtn) {
      form.insertBefore(blockMsg, submitBtn);
    } else {
      form.appendChild(blockMsg);
    }

    // Helper: get current name + email values
    function getValues() {
      return {
        name:  nameField  ? nameField.value.trim()  : '',
        email: emailField ? emailField.value.trim() : ''
      };
    }

    // Run check on blur of name/email fields so feedback is immediate
    function runCheck() {
      if (typeof REA_FLAGS === 'undefined') return null;
      const { name, email } = getValues();
      if (!name && !email) return null;
      return REA_FLAGS.checkBoth(name, email);
    }

    if (nameField)  nameField.addEventListener('blur',  runCheck);
    if (emailField) emailField.addEventListener('blur', runCheck);

    // Intercept form submit
    form.addEventListener('submit', function(e) {
      if (typeof REA_FLAGS === 'undefined') return; // safety — let through if script missing

      const { name, email } = getValues();
      const flag = REA_FLAGS.checkBoth(name, email);

      if (!flag) {
        // Clean client — clear any previous block message and proceed
        blockMsg.style.display = 'none';
        warnFlag.value = '';
        return; // allow submit
      }

      if (flag.status === 'blocked') {
        // BLOCKED — prevent submit, show generic message
        e.preventDefault();
        e.stopImmediatePropagation();
        blockMsg.style.display = 'block';
        blockMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Do NOT reveal reason — protects Daron legally
        return false;
      }

      if (flag.status === 'warned') {
        // WARNED — allow booking but inject internal flag into form data
        // Daron will see this in the Netlify form submission
        warnFlag.value = 'WARNED:' + (flag.reasons || []).join(',') + ' | ' + (flag.notes || '') + ' | flagged:' + flag.date;
        blockMsg.style.display = 'none';
        // Let form submit normally
      }
    });

  });

})();
