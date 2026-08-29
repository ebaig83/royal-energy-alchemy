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
          '<li><a href="/#services">Implant/Parasite Removal</a></li>' +
          '<li><a href="/#services">Follow-Up Session</a></li>' +
          '<li><a href="/#services">Heavy Duty Removal</a></li>' +
          '<li><a href="/#services">Distance Energy Session</a></li>' +
          '<li><a href="/#services">Spiritual Coaching</a></li>' +
          '<li><a href="/#services">House Cleansing/Blessing</a></li>' +
        '</ul></li>' +
      '<li class="rea-nav-dropdown"><a href="/#plans">Plans</a>' +
        '<ul class="rea-nav-menu" aria-label="Plans">' +
          '<li><a href="/#plans">Stabilize &amp; Clear</a></li>' +
          '<li><a href="/#plans">Pattern Release</a></li>' +
          '<li><a href="/#plans">Maintenance Circle</a></li>' +
          '<li><a href="/#plans">Research &amp; Outcomes</a></li>' +
        '</ul></li>' +
      '<li><a href="/#assess">Assess</a></li>' +
      '<li class="rea-nav-dropdown"><a href="/#faq">More</a>' +
        '<ul class="rea-nav-menu" aria-label="More">' +
          '<li><a href="/#faq">FAQ</a></li>' +
          '<li><a href="/privacy-policy">Privacy Policy</a></li>' +
          '<li><a href="/terms">Terms of Service</a></li>' +
          '<li><a href="/data-retention">Data Retention</a></li>' +
          '<li><a href="/community">Join the Fight</a></li>' +
        '</ul></li>' +
    '</ul>' +
    '<a href="/#contact" class="rea-nav-book">Book Session</a>';

  if(existingNav){
    existingNav.replaceWith(nav);
  }else{
    document.body.insertBefore(nav,document.body.firstChild);
    document.body.classList.add('rea-shared-nav-added');
  }
})();
