(function(){
  const navHtml = `
    <nav class="rea-site-nav" aria-label="Primary">
      <ul class="rea-nav-links">
        <li><a href="/#hero">Home</a></li>
        <li><a href="/#about">About</a></li>
        <li class="rea-nav-dropdown">
          <a href="/#services">Services</a>
          <ul class="rea-nav-dropdown-menu" aria-label="Services">
            <li><a href="/#services">Energetic Parasite Removal</a></li>
            <li><a href="/#services">Cord Removal &amp; Transmutation</a></li>
            <li><a href="/#services">Energy Alchemy Exorcism</a></li>
            <li><a href="/#services">Distance Energy Session</a></li>
            <li><a href="/#services">House Cleansing &amp; Blessing</a></li>
            <li><a href="/#services">Emergency Removal Session</a></li>
            <li><a href="/#services">Removal + Tarot Bundle</a></li>
            <li><a href="/#services">Spiritual Coaching</a></li>
            <li><a href="/#services">Youth Sessions (Ages 9-14)</a></li>
          </ul>
        </li>
        <li class="rea-nav-dropdown">
          <a href="/#plans">Plans</a>
          <ul class="rea-nav-dropdown-menu" aria-label="Plans">
            <li><a href="/#plans">Stabilize &amp; Clear</a></li>
            <li><a href="/#plans">Pattern Release</a></li>
            <li><a href="/#plans">Maintenance Circle</a></li>
            <li><a href="/#plans">Research &amp; Outcomes</a></li>
            <li><a href="/treatment-plan">Treatment Plan Page</a></li>
          </ul>
        </li>
        <li><a href="/#assess">Assess</a></li>
        <li><a href="/#contact">Contact</a></li>
        <li class="rea-nav-dropdown">
          <a href="/#faq">More</a>
          <ul class="rea-nav-dropdown-menu" aria-label="More pages">
            <li><a href="/#faq">FAQ</a></li>
            <li><a href="/pay">Payment QR Codes</a></li>
            <li><a href="/aftercare">Aftercare Check-In</a></li>
            <li><a href="/rating">Session Rating</a></li>
            <li><a href="/privacy-policy">Privacy Policy</a></li>
            <li><a href="/terms">Terms of Service</a></li>
            <li><a href="/data-retention">Data Retention</a></li>
          </ul>
        </li>
        <li class="rea-nav-dropdown">
          <a href="/training" style="color:#ffd977">Training</a>
          <ul class="rea-nav-dropdown-menu" aria-label="Training">
            <li><a href="/training#foundations">Level One - Foundations</a></li>
            <li><a href="/training#intermediate">Level Two - Intermediate</a></li>
            <li><a href="/training#advanced">Level Three - Advanced</a></li>
          </ul>
        </li>
        <li><a href="/waiver-esign" style="color:#ffd977">Sign Waiver</a></li>
      </ul>
      <a href="/#contact" class="rea-nav-book">Book Session</a>
    </nav>
  `;

  function installNav(){
    const existing = document.querySelector('body > nav');
    if (existing) {
      existing.outerHTML = navHtml;
    } else {
      document.body.insertAdjacentHTML('afterbegin', navHtml);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installNav);
  } else {
    installNav();
  }
})();
