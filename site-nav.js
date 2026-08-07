(function(){
  var existingNav = document.querySelector('body > nav');
  var nav = document.createElement('nav');
  nav.className = 'rea-site-nav';
  nav.setAttribute('aria-label','Primary navigation');
  nav.innerHTML =
    '<ul class="rea-nav-links">' +
      '<li><a href="/">Home</a></li>' +
      '<li><a href="/#about">About</a></li>' +
      '<li class="rea-nav-dropdown"><a href="/#services">Services</a>' +
        '<ul class="rea-nav-menu" aria-label="Services">' +
          '<li><a href="/#services">Initial Session</a></li>' +
          '<li><a href="/#services">15-Minute Consultation</a></li>' +
          '<li><a href="/#services">Extended Session</a></li>' +
          '<li><a href="/#services">House Clearing</a></li>' +
          '<li><a href="/#services">Emergency Removal</a></li>' +
          '<li><a href="/#services">Coaching</a></li>' +
          '<li><a href="/#services">Follow-Up Session</a></li>' +
          '<li><a href="/#services">Energetic Parasite Session</a></li>' +
          '<li><a href="/#services">Youth Sessions (Ages 9-14)</a></li>' +
        '</ul></li>' +
      '<li class="rea-nav-dropdown"><a href="/#plans">Plans</a>' +
        '<ul class="rea-nav-menu" aria-label="Plans">' +
          '<li><a href="/#plans">Stabilize &amp; Clear</a></li>' +
          '<li><a href="/#plans">Pattern Release</a></li>' +
          '<li><a href="/#plans">Maintenance Circle</a></li>' +
          '<li><a href="/#plans">Research &amp; Outcomes</a></li>' +
        '</ul></li>' +
      '<li><a href="/#assess">Assess</a></li>' +
      '<li class="rea-nav-dropdown"><a href="/training.html">Training</a>' +
        '<ul class="rea-nav-menu" aria-label="Training">' +
          '<li><a href="/training.html#foundations">Level One - Foundations of Energy</a></li>' +
          '<li><a href="/training.html#intermediate">Level Two - Applied Energy Work</a></li>' +
        '</ul></li>' +
      '<li class="rea-nav-dropdown"><a href="/#faq">More</a>' +
        '<ul class="rea-nav-menu" aria-label="More">' +
          '<li><a href="/#faq">FAQ</a></li>' +
          '<li><a href="/privacy-policy">Privacy Policy</a></li>' +
          '<li><a href="/terms">Terms of Service</a></li>' +
          '<li><a href="/data-retention">Data Retention</a></li>' +
          '<li><a href="/provider-apply" style="color:#22c98a">Provider Application</a></li>' +
          '<li><a href="/community">Join the Fight</a></li>' +
        '</ul></li>' +
    '</ul>' +
    '<a href="/book.html" class="rea-nav-book">Book Session</a>';

  if(existingNav){
    existingNav.replaceWith(nav);
  }else{
    document.body.insertBefore(nav,document.body.firstChild);
    document.body.classList.add('rea-shared-nav-added');
  }
})();
