const observer = new MutationObserver(async () => {
  const profile = document.querySelector('.profile');
  if (!profile || profile.dataset.identityBound) return;
  profile.dataset.identityBound = 'true';
  try {
    const response = await fetch('/.netlify/functions/verify-pin', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json(), user = result.user;
    if (!user) return;
    const name = user.displayName || user.email;
    profile.innerHTML = `<span class="avatar">${name.split(/\\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()}</span><span>${name}<small style="display:block">${user.role}</small></span>`;
    profile.setAttribute('aria-label', `${name} · ${user.role}`);
  } catch { /* Dashboard identity is already protected server-side. */ }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
