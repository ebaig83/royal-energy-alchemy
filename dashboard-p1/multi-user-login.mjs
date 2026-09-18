// Multi-user login adapter: add the account identifier and submit it to the
// existing login endpoint without exposing credentials outside the form.
const observe = new MutationObserver(() => {
  const invite = location.hash.startsWith('#invite=') ? location.hash.slice(7) : '';
  if (invite && !document.querySelector('#invite-form')) {
    const root = document.querySelector('#app');
    if (root) root.innerHTML='<main class="login-shell"><section class="login-panel"><div class="login-card"><div class="login-heading"><p class="eyebrow">Authorized dashboard access</p><h1>Set your password</h1><p>Choose a private password of at least 12 characters.</p></div><form id="invite-form" class="login-form"><label>New password<input id="invite-next" type="password" minlength="12" autocomplete="new-password" required></label><label>Confirm password<input id="invite-confirm" type="password" minlength="12" autocomplete="new-password" required></label><button type="button" class="login-link" id="invite-toggle">Show password</button><button class="gold login-submit" type="submit">Set password</button><p id="invite-status" class="login-error" role="alert"></p></form></div></section></main>';
    const form=document.querySelector('#invite-form'),next=document.querySelector('#invite-next'),confirm=document.querySelector('#invite-confirm');
    document.querySelector('#invite-toggle').addEventListener('click',event=>{const text=next.type==='text';next.type=text?'password':'text';confirm.type=text?'password':'text';event.target.textContent=text?'Show password':'Hide password';});
    form.addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('#invite-status');if(next.value!==confirm.value){status.textContent='Passwords do not match.';return;}try{const response=await fetch('/.netlify/functions/practitioner-invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:invite,next:next.value,confirm:confirm.value})});if(!response.ok)throw Error('Invitation is invalid or expired.');history.replaceState(null,'',location.pathname+location.search);status.textContent='Password set. Return to the dashboard sign-in page.';form.hidden=true;}catch(e){status.textContent=e.message;next.value='';confirm.value='';}});
    return;
  }
  const form = document.querySelector('#sign-in');
  if (!form || form.dataset.multiUserBound) return;
  form.dataset.multiUserBound = 'true';
  const pin = form.querySelector('#admin-pin');
  if (pin && !form.querySelector('#admin-email')) {
    const label = document.createElement('label');
    label.htmlFor = 'admin-email';
    label.innerHTML = 'Email<input id="admin-email" type="email" autocomplete="username" placeholder="name@example.com">';
    pin.closest('label')?.before(label);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const button=form.querySelector('.login-submit'), error=form.querySelector('#login-error');
    button.disabled=true;
    try {
      const response=await fetch('/.netlify/functions/verify-pin',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.querySelector('#admin-email')?.value||'',pin:pin.value,remember_me:form.querySelector('#remember-login')?.checked===true})});
      if(!response.ok)throw Error('Sign-in was not accepted. Check the email and password or try again.');
      window.location.reload();
    } catch (e) { error.textContent=e.message; button.disabled=false; }
  }, true);
});
observe.observe(document.documentElement,{childList:true,subtree:true});
