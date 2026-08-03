const serviceSelect = document.querySelector("#serviceSelect");
const packageChoice = document.querySelector("#packageChoice");
const clientName = document.querySelector("#clientName");
const clientContact = document.querySelector("#clientContact");
const clientMessage = document.querySelector("#clientMessage");
const bookingForm = document.querySelector(".booking-form");
const bookingSummary = document.querySelector("#bookingSummary");
const assessmentSeverity = document.querySelector("#assessmentSeverity");
const assessmentDuration = document.querySelector("#assessmentDuration");
const assessmentConcern = document.querySelector("#assessmentConcern");
const assessmentChanges = document.querySelector("#assessmentChanges");
const assessmentPreview = document.querySelector("#assessmentPreview");
const copyStatus = document.querySelector("#copyStatus");
const selectedSlot = document.querySelector("#selectedSlot");
const availabilityTemplate = document.querySelector("#availabilityTemplate");
const availabilityPreview = document.querySelector("#availabilityPreview");
const generateAvailability = document.querySelector("#generateAvailability");
const reserveSlot = document.querySelector("#reserveSlot");
const calendarActions = document.querySelector("#calendarActions");
const calendarUrl = document.querySelector("#calendarUrl");
const assessmentForm = document.querySelector(".assessment-form");
const intakeName = document.querySelector("#intakeName");
const intakeContact = document.querySelector("#intakeContact");
const intakeSeverity = document.querySelector("#intakeSeverity");
const intakeFrequency = document.querySelector("#intakeFrequency");
const intakeDuration = document.querySelector("#intakeDuration");
const intakeConcern = document.querySelector("#intakeConcern");
const intakeNotes = document.querySelector("#intakeNotes");
const intakeSafety = document.querySelector("#intakeSafety");
const intakeResult = document.querySelector("#intakeResult");
let selectedSlotData = null;
let lastIntakeAssessment = null;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const siteHeader = document.querySelector(".site-header");
const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const navSections = navLinks
  .map((link) => ({ link, section: document.querySelector(link.getAttribute("href")) }))
  .filter((item) => item.section);

function updateScrollUi() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)) : 0;
  document.body.style.setProperty("--scroll", `${progress}%`);
  siteHeader?.classList.toggle("is-scrolled", window.scrollY > 20);

  const active = navSections
    .filter((item) => item.section.getBoundingClientRect().top <= 130)
    .pop();

  navLinks.forEach((link) => link.classList.toggle("is-active", active?.link === link));
}

window.addEventListener("scroll", updateScrollUi, { passive: true });
window.addEventListener("resize", updateScrollUi);
updateScrollUi();

if (!prefersReducedMotion) {
  document.addEventListener("pointermove", (event) => {
    const x = ((event.clientX / window.innerWidth) - 0.5) * -16;
    const y = ((event.clientY / window.innerHeight) - 0.5) * -12;
    document.body.style.setProperty("--parallax-x", `${x}px`);
    document.body.style.setProperty("--parallax-y", `${y}px`);
  }, { passive: true });
}

function setupRevealMotion() {
  const targets = [
    ...document.querySelectorAll("section:not(.hero), .service-card, .price-card, .payment-card, .plan-grid article, .timeline article, .technique-card, .testimonial-card, .contact-card, .booking-form")
  ];

  targets.forEach((target, index) => {
    target.classList.add("reveal");
    target.style.transitionDelay = `${Math.min(index % 6, 5) * 70}ms`;
  });

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.13, rootMargin: "0px 0px -8% 0px" });

  targets.forEach((target) => observer.observe(target));
}

setupRevealMotion();

function formatCounter(value, suffix = "") {
  if (value >= 1000) return `${Math.round(value / 1000)}K${suffix}`;
  return `${Math.round(value)}${suffix}`;
}

function animateCounter(element) {
  const target = Number(element.dataset.count || "0");
  const suffix = element.dataset.suffix || "";
  const start = performance.now();
  const duration = 1300;

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatCounter(target * eased, suffix);
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

const statCounters = [...document.querySelectorAll("[data-count]")];
if (statCounters.length) {
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    statCounters.forEach((counter) => {
      counter.textContent = formatCounter(Number(counter.dataset.count || "0"), counter.dataset.suffix || "");
    });
  } else {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.8 });
    statCounters.forEach((counter) => counterObserver.observe(counter));
  }
}

function setupEnergyField() {
  const canvas = document.querySelector("#energyField");
  if (!canvas || prefersReducedMotion) return;
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let stars = [];
  let meteors = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = canvas.width = window.innerWidth * dpr;
    height = canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const count = Math.min(150, Math.max(70, Math.floor(window.innerWidth / 11)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.045 * dpr,
      vy: (Math.random() * 0.055 + 0.012) * dpr,
      r: (Math.random() * 1.35 + 0.35) * dpr,
      phase: Math.random() * Math.PI * 2,
      twinkle: Math.random() * 0.0024 + 0.0012,
      tint: Math.random() > 0.78 ? "gold" : Math.random() > 0.55 ? "teal" : "white"
    }));
  }

  function starColor(star, alpha) {
    if (star.tint === "gold") return `rgba(217, 166, 66, ${alpha})`;
    if (star.tint === "teal") return `rgba(67, 208, 193, ${alpha})`;
    return `rgba(246, 241, 232, ${alpha})`;
  }

  function addMeteor() {
    if (meteors.length > 3 || Math.random() > 0.018) return;
    meteors.push({
      x: Math.random() * width,
      y: Math.random() * height * 0.42,
      vx: (Math.random() * 4 + 5) * dpr,
      vy: (Math.random() * 1.3 + 1.6) * dpr,
      life: 0,
      max: Math.random() * 26 + 22
    });
  }

  function draw(now = performance.now()) {
    context.clearRect(0, 0, width, height);

    stars.forEach((star) => {
      star.x += star.vx;
      star.y += star.vy;
      if (star.y > height + 8) star.y = -8;
      if (star.x < -8) star.x = width + 8;
      if (star.x > width + 8) star.x = -8;

      const pulse = 0.28 + Math.abs(Math.sin(now * star.twinkle + star.phase)) * 0.72;
      context.fillStyle = starColor(star, pulse);
      context.shadowColor = starColor(star, 0.9);
      context.shadowBlur = 8 * pulse * dpr;
      context.beginPath();
      context.arc(star.x, star.y, star.r * (0.75 + pulse * 0.65), 0, Math.PI * 2);
      context.fill();
    });

    context.shadowBlur = 0;
    addMeteor();
    meteors = meteors.filter((meteor) => {
      meteor.life += 1;
      meteor.x += meteor.vx;
      meteor.y += meteor.vy;
      const alpha = 1 - meteor.life / meteor.max;
      context.strokeStyle = `rgba(217, 166, 66, ${alpha * 0.45})`;
      context.lineWidth = 1.3 * dpr;
      context.beginPath();
      context.moveTo(meteor.x, meteor.y);
      context.lineTo(meteor.x - meteor.vx * 8, meteor.y - meteor.vy * 8);
      context.stroke();
      return meteor.life < meteor.max;
    });

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

setupEnergyField();

function setupHeroEnergy() {
  const canvas = document.querySelector("#heroEnergy");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero || prefersReducedMotion) return;

  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let particles = [];
  let heroStars = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    width = canvas.width = hero.clientWidth * dpr;
    height = canvas.height = hero.clientHeight * dpr;
    canvas.style.width = `${hero.clientWidth}px`;
    canvas.style.height = `${hero.clientHeight}px`;
    heroStars = Array.from({ length: 90 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: (Math.random() * 1.4 + 0.35) * dpr,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.002 + 0.001,
      drift: (Math.random() * 0.09 + 0.02) * dpr
    }));
  }

  function origin() {
    return {
      x: width * 0.285,
      y: height * 0.68
    };
  }

  function emitEnergy() {
    const start = origin();
    const amount = Math.random() > 0.55 ? 4 : 3;
    for (let i = 0; i < amount; i += 1) {
      const force = Math.random() * 2.4 + 2.2;
      particles.push({
        x: start.x + (Math.random() - 0.5) * 22 * dpr,
        y: start.y + (Math.random() - 0.5) * 22 * dpr,
        px: start.x,
        py: start.y,
        vx: force * dpr,
        vy: (Math.random() - 0.58) * 1.8 * dpr,
        curve: Math.random() * Math.PI * 2,
        life: 0,
        max: Math.random() * 70 + 90,
        size: (Math.random() * 2.3 + 1) * dpr,
        color: Math.random() > 0.5 ? "teal" : Math.random() > 0.35 ? "gold" : "violet"
      });
    }
  }

  function particleColor(particle, alpha) {
    if (particle.color === "gold") return `rgba(217, 166, 66, ${alpha})`;
    if (particle.color === "violet") return `rgba(156, 108, 243, ${alpha})`;
    return `rgba(67, 208, 193, ${alpha})`;
  }

  function drawEnergyRibbons(now, start) {
    const paths = [
      { endX: width * 0.78, endY: height * 0.42, controlX: width * 0.46, controlY: height * 0.46, color: "rgba(67, 208, 193," },
      { endX: width * 0.86, endY: height * 0.58, controlX: width * 0.52, controlY: height * 0.64, color: "rgba(217, 166, 66," },
      { endX: width * 0.68, endY: height * 0.30, controlX: width * 0.42, controlY: height * 0.36, color: "rgba(156, 108, 243," }
    ];

    context.save();
    context.lineCap = "round";
    context.globalCompositeOperation = "lighter";

    paths.forEach((path, index) => {
      const wave = Math.sin(now * 0.0025 + index) * 26 * dpr;
      const gradient = context.createLinearGradient(start.x, start.y, path.endX, path.endY);
      gradient.addColorStop(0, `${path.color} 0.04)`);
      gradient.addColorStop(0.18, `${path.color} 0.68)`);
      gradient.addColorStop(0.64, `${path.color} 0.32)`);
      gradient.addColorStop(1, `${path.color} 0)`);

      context.strokeStyle = gradient;
      context.lineWidth = (index === 1 ? 5 : 3.5) * dpr;
      context.setLineDash([24 * dpr, 22 * dpr]);
      context.lineDashOffset = -now * 0.08 - index * 24 * dpr;
      context.shadowColor = index === 1 ? "rgba(217, 166, 66, 0.8)" : "rgba(67, 208, 193, 0.72)";
      context.shadowBlur = 18 * dpr;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(path.controlX, path.controlY + wave, path.endX, path.endY);
      context.stroke();

      context.setLineDash([]);
      context.lineWidth = 1.2 * dpr;
      context.strokeStyle = `${path.color} 0.2)`;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(path.controlX, path.controlY - wave * 0.35, path.endX, path.endY);
      context.stroke();
    });

    context.restore();
  }

  function draw(now = performance.now()) {
    context.clearRect(0, 0, width, height);

    heroStars.forEach((star) => {
      star.x += star.drift;
      if (star.x > width + 10) star.x = -10;
      const alpha = 0.18 + Math.abs(Math.sin(now * star.speed + star.phase)) * 0.62;
      context.fillStyle = `rgba(246, 241, 232, ${alpha})`;
      context.shadowColor = `rgba(67, 208, 193, ${alpha})`;
      context.shadowBlur = 7 * dpr * alpha;
      context.beginPath();
      context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      context.fill();
    });

    const start = origin();
    const pulse = 0.5 + Math.sin(now * 0.004) * 0.5;
    const glow = context.createRadialGradient(start.x, start.y, 0, start.x, start.y, 150 * dpr);
    glow.addColorStop(0, `rgba(246, 241, 232, ${0.55 + pulse * 0.25})`);
    glow.addColorStop(0.16, `rgba(217, 166, 66, ${0.35 + pulse * 0.2})`);
    glow.addColorStop(0.45, `rgba(67, 208, 193, ${0.18 + pulse * 0.15})`);
    glow.addColorStop(1, "rgba(67, 208, 193, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(start.x, start.y, 150 * dpr, 0, Math.PI * 2);
    context.fill();

    drawEnergyRibbons(now, start);
    emitEnergy();
    context.shadowBlur = 0;
    particles = particles.filter((particle) => {
      particle.life += 1;
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx + Math.sin(particle.life * 0.08 + particle.curve) * 1.1 * dpr;
      particle.y += particle.vy + Math.cos(particle.life * 0.055 + particle.curve) * 0.9 * dpr;
      particle.vx *= 1.003;
      const alpha = 1 - particle.life / particle.max;

      context.strokeStyle = particleColor(particle, alpha * 0.75);
      context.lineWidth = Math.max(1, particle.size * alpha);
      context.beginPath();
      context.moveTo(particle.px, particle.py);
      context.lineTo(particle.x, particle.y);
      context.stroke();

      context.fillStyle = particleColor(particle, alpha);
      context.shadowColor = particleColor(particle, alpha);
      context.shadowBlur = 12 * alpha * dpr;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (0.8 + alpha), 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;

      return particle.life < particle.max && particle.x < width + 80 * dpr && particle.y > -80 * dpr && particle.y < height + 80 * dpr;
    });

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

setupHeroEnergy();

function scrollToBooking() {
  document.querySelector("#book").scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectService(service, packageText = "") {
  if (serviceSelect) {
    const matchingOption = [...serviceSelect.options].find((option) => option.value === service);
    if (matchingOption) {
      serviceSelect.value = service;
    }
  }
  if (packageChoice && packageText) {
    packageChoice.value = packageText;
  }
  scrollToBooking();
}

document.querySelectorAll(".choose-service").forEach((button) => {
  button.addEventListener("click", () => {
    selectService(button.dataset.service);
  });
});

document.querySelectorAll(".choose-package").forEach((button) => {
  button.addEventListener("click", () => {
    selectService(button.dataset.service, button.dataset.package);
  });
});

document.querySelectorAll(".choose-plan").forEach((button) => {
  button.addEventListener("click", () => {
    selectService("Treatment Plan", button.dataset.plan);
  });
});

document.querySelectorAll(".copy-payment").forEach((button) => {
  button.addEventListener("click", async () => {
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      copyStatus.textContent = `${value} copied.`;
    } catch {
      copyStatus.textContent = `Copy this payment detail: ${value}`;
    }
  });
});

const availabilityMessages = {
  june: `Here's what I have first available for the week of June 8th, all EST:
Monday, 8th - 1, 3
9th - 3, 5
10th - 1, 3, 5
11th - 11, 1, 3
12th - 11, 1, 3, 5, 7
Let me know if any of those work for you?`,
  july: `Here's what I have for first availability:
July 6th - 12, 2, 4 or 6
July 7th - 10, 12, 2 or 4
July 8th - 10, 12, 2, 4 or 6
July 9th - 10, 12, 2, 4 or 6
July 10th - 10 or 2
All EST...let me know if any of those work for you? Thanks, Daron`
};

function slotKey(slot) {
  return `${slot.isoDate}-${slot.time}`;
}

function getBookedSlots() {
  try {
    return JSON.parse(localStorage.getItem("royalEnergyBookedSlots") || "[]");
  } catch {
    return [];
  }
}

function setBookedSlots(slots) {
  localStorage.setItem("royalEnergyBookedSlots", JSON.stringify(slots));
}

function applyBookedSlots() {
  const booked = new Set(getBookedSlots());
  document.querySelectorAll(".slot-button").forEach((button) => {
    const key = `${button.dataset.isoDate}-${button.dataset.time}`;
    if (booked.has(key)) {
      button.classList.add("is-booked");
      button.disabled = true;
      button.textContent = `${button.dataset.time} booked`;
    }
  });
}

function parseHour(timeText) {
  const match = timeText.match(/(\d+)\s*(AM|PM)/i);
  if (!match) return 12;
  let hour = Number(match[1]);
  const meridiem = match[2].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour;
}

function calendarDateParts(slot, addHours = 0) {
  const hour = parseHour(slot.time) + addHours;
  const date = new Date(`${slot.isoDate}T00:00:00-04:00`);
  date.setHours(hour, 0, 0, 0);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  return `${y}${m}${d}T${hh}0000`;
}

function buildGoogleCalendarUrl(slot) {
  const text = encodeURIComponent("Royal Energy Alchemy Session");
  const details = encodeURIComponent("Confirmed appointment with Daron Royal. Payment required to reserve the session.");
  const dates = `${calendarDateParts(slot)}/${calendarDateParts(slot, 1)}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&ctz=America/New_York&details=${details}`;
}

function buildIcsHref(slot) {
  const start = calendarDateParts(slot);
  const end = calendarDateParts(slot, 1);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Royal Energy Alchemy//Booking Prototype//EN",
    "BEGIN:VEVENT",
    `UID:${slotKey(slot)}@royal-energy-alchemy.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;TZID=America/New_York:${start}`,
    `DTEND;TZID=America/New_York:${end}`,
    "SUMMARY:Royal Energy Alchemy Session",
    "DESCRIPTION:Confirmed appointment with Daron Royal. Payment required to reserve the session.",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  return URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
}

function setAvailabilityPreview(message) {
  if (!availabilityPreview) return;
  availabilityPreview.innerHTML = `
    <span class="panel-label">Messenger copy</span>
    <p>${escapeHtml(message)}</p>
  `;
}

document.querySelectorAll(".slot-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    document.querySelectorAll(".slot-button").forEach((slot) => slot.classList.remove("is-selected"));
    button.classList.add("is-selected");
    selectedSlotData = {
      date: button.dataset.date,
      isoDate: button.dataset.isoDate,
      time: button.dataset.time
    };
    const slotText = `${button.dataset.date} at ${button.dataset.time} EST`;
    if (selectedSlot) selectedSlot.value = slotText;
    if (availabilityTemplate) availabilityTemplate.value = "custom";
    if (packageChoice) packageChoice.value = `Selected appointment: ${slotText}`;
    setAvailabilityPreview(`I have ${slotText} available. Let me know if that works for you? Thanks, Daron`);
  });
});

applyBookedSlots();

if (generateAvailability) {
  generateAvailability.addEventListener("click", () => {
    const mode = availabilityTemplate.value;
    if (mode === "custom") {
      const slotText = selectedSlot.value.trim() || "the next available appointment";
      setAvailabilityPreview(`I have ${slotText} available. Let me know if that works for you? Thanks, Daron`);
      return;
    }
    setAvailabilityPreview(availabilityMessages[mode]);
  });
}

if (reserveSlot) {
  reserveSlot.addEventListener("click", () => {
    if (!selectedSlotData) {
      setAvailabilityPreview("Choose an available June slot first, then reserve it.");
      return;
    }

    const booked = new Set(getBookedSlots());
    booked.add(slotKey(selectedSlotData));
    setBookedSlots([...booked]);
    applyBookedSlots();

    const googleUrl = buildGoogleCalendarUrl(selectedSlotData);
    const icsHref = buildIcsHref(selectedSlotData);
    const liveCalendarUrl = calendarUrl.value.trim();

    calendarActions.innerHTML = `
      <a class="calendar-link" href="${googleUrl}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <a class="calendar-link" href="${icsHref}" download="royal-energy-appointment.ics">Download calendar file</a>
      ${liveCalendarUrl ? `<a class="calendar-link" href="${escapeHtml(liveCalendarUrl)}" target="_blank" rel="noopener">Open Daron's live calendar</a>` : ""}
    `;

    if (packageChoice) packageChoice.value = `Reserved appointment: ${selectedSlotData.date} at ${selectedSlotData.time} EST`;
    setAvailabilityPreview(`Reserved: ${selectedSlotData.date} at ${selectedSlotData.time} EST.\n\nNext step: collect payment, add the appointment to Daron's live calendar, and send the confirmation message.`);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function followUpPlan(service) {
  if (/Treatment Plan|Parasite|Cord|Transmutation/i.test(service)) {
    return "72-hour check-in plus ongoing guidance when appropriate, with longer-term follow-ups if needed.";
  }
  return "72-hour check-in plus ongoing guidance when appropriate.";
}

function selectedSymptoms() {
  return [...document.querySelectorAll('input[name="symptom"]:checked')].map((input) => input.value);
}

function durationWeight(value) {
  return {
    new: 0,
    weeks: 1,
    months: 2,
    years: 3
  }[value] || 0;
}

function concernWeight(value) {
  if (/parasite|attachment|fear|intrusive/i.test(value)) return 2;
  if (/cord|house|unsettled/i.test(value)) return 1;
  return 0;
}

function frequencyWeight(value) {
  return {
    sometimes: 0,
    weekly: 1,
    daily: 2,
    constant: 3
  }[value] || 0;
}

function selectedIntakeSymptoms() {
  return [...document.querySelectorAll('input[name="intakeSymptom"]:checked')].map((input) => input.value);
}

function serviceRecommendation(concern, score) {
  if (/distance/i.test(concern)) return "Extended Session - $110";
  if (/house|room/i.test(concern)) return "House Clearing - $80";
  if (/cord|person|place/i.test(concern)) return score >= 11 ? "Follow-Up Session - $80 after initial assessment" : "15-Minute Consultation - $50";
  if (/entity|intrusive/i.test(concern)) return score >= 16 ? "Initial Session - $90 or Emergency Removal - $120 after review" : "Initial Session - $90";
  if (/parasite|attachment/i.test(concern)) return score >= 16 ? "Treatment plan plus Energetic Parasite Session - $75" : "Energetic Parasite Session - $75";
  return score >= 11 ? "Initial Session followed by a treatment plan if needed" : "Initial Session - $90 or Coaching - $50";
}

function assessIntake() {
  const severity = Number(intakeSeverity?.value || 0);
  const duration = intakeDuration?.value || "new";
  const frequency = intakeFrequency?.value || "sometimes";
  const concern = intakeConcern?.value || "Not sure yet";
  const symptoms = selectedIntakeSymptoms();
  const safety = intakeSafety?.value || "no";
  const score = severity + durationWeight(duration) + frequencyWeight(frequency) + concernWeight(concern) + Math.min(symptoms.length, 4);
  let level = "Light";
  let followUp = "72-hour check-in plus ongoing guidance when appropriate.";
  let plan = "One assessment or coaching session may be enough to choose the next step.";

  if (safety === "yes") {
    level = "Needs licensed support first";
    followUp = "Do not treat this as a spiritual-only issue. Recommend emergency, medical, or mental health support before booking.";
    plan = "Pause booking until safety is clear.";
  } else if (score >= 16) {
    level = "High";
    followUp = "72-hour check-in plus ongoing guidance when appropriate, with longer-term follow-ups if needed.";
    plan = "Recommend a treatment plan with multiple sessions and care recommendations.";
  } else if (score >= 11) {
    level = "Moderate";
    followUp = "72-hour check-in plus ongoing guidance when appropriate.";
    plan = "Recommend a full clearing or removal session, then review whether follow-up work is needed.";
  }

  const service = safety === "yes" ? "Licensed support / emergency help before booking" : serviceRecommendation(concern, score);
  const summary = [
    `Client: ${intakeName?.value.trim() || "New client"}`,
    `Contact: ${intakeContact?.value.trim() || "Not provided"}`,
    `Concern level: ${level} (${score} points, intensity ${severity}/10)`,
    `Main concern: ${concern}`,
    `Duration: ${duration}; frequency: ${frequency}`,
    `Symptoms: ${symptoms.join(", ") || "None selected"}`,
    `Recent changes: ${intakeNotes?.value.trim() || "No notes added"}`,
    `Recommended next step: ${service}`,
    `Follow-up: ${followUp}`
  ].join("\n");

  return {
    name: intakeName?.value.trim() || "New client",
    contact: intakeContact?.value.trim() || "Not provided",
    severity,
    duration,
    frequency,
    concern,
    symptoms,
    safety,
    score,
    level,
    service,
    plan,
    followUp,
    notes: intakeNotes?.value.trim() || "No notes added",
    summary
  };
}

function renderIntakeResult(assessment) {
  if (!intakeResult) return;
  intakeResult.innerHTML = `
    <span class="panel-label">Assessment result</span>
    <h3>${escapeHtml(assessment.level)} concern</h3>
    <div class="assessment-score">
      <strong>${assessment.score}</strong>
      <span>Assessment score based on intensity, duration, frequency, concern type, and selected symptoms.</span>
    </div>
    <p><strong>Recommended service:</strong> ${escapeHtml(assessment.service)}</p>
    <p><strong>Plan guidance:</strong> ${escapeHtml(assessment.plan)}</p>
    <p><strong>Follow-up cadence:</strong> ${escapeHtml(assessment.followUp)}</p>
    <p><strong>Messenger summary:</strong></p>
    <p>${escapeHtml(assessment.summary).replaceAll("\n", "<br>")}</p>
    <div class="assessment-actions">
      <button id="copyAssessmentSummary" type="button">Copy Summary</button>
      <button id="useAssessmentInBooking" type="button">Use in Booking Form</button>
    </div>
  `;

  document.querySelector("#copyAssessmentSummary")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(assessment.summary);
      document.querySelector("#copyAssessmentSummary").textContent = "Copied";
    } catch {
      document.querySelector("#copyAssessmentSummary").textContent = "Select summary above";
    }
  });

  document.querySelector("#useAssessmentInBooking")?.addEventListener("click", () => {
    if (clientName) clientName.value = assessment.name;
    if (clientContact && assessment.contact !== "Not provided") clientContact.value = assessment.contact;
    if (clientMessage) clientMessage.value = assessment.summary;
    if (packageChoice) packageChoice.value = assessment.service;
    if (serviceSelect) {
      const option = [...serviceSelect.options].find((item) => assessment.service.includes(item.value));
      serviceSelect.value = option ? option.value : "Assessment Session";
    }
    scrollToBooking();
  });
}

if (assessmentForm) {
  assessmentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    lastIntakeAssessment = assessIntake();
    renderIntakeResult(lastIntakeAssessment);
    localStorage.setItem("royalEnergyAssessment", JSON.stringify({
      ...lastIntakeAssessment,
      createdAt: new Date().toISOString()
    }));
  });
}

function assessConcern() {
  const severity = Number(assessmentSeverity?.value || 0);
  const duration = assessmentDuration?.value || "new";
  const concern = assessmentConcern?.value || "Not sure yet";
  const symptoms = selectedSymptoms();
  const score = severity + durationWeight(duration) + concernWeight(concern) + Math.min(symptoms.length, 3);
  let level = "Light";
  let recommendation = "Start with an assessment session and 24/72-hour follow-up.";

  if (score >= 14) {
    level = "High";
    recommendation = "Recommend a treatment plan with multiple sessions, payment confirmation, and care recommendations.";
  } else if (score >= 9) {
    level = "Moderate";
    recommendation = "Recommend a full clearing or removal session with 24/48/72-hour check-ins and possible maintenance.";
  }

  return {
    severity,
    duration,
    concern,
    symptoms,
    score,
    level,
    recommendation,
    changes: assessmentChanges?.value.trim() || "No recent changes added."
  };
}

function renderAssessmentPreview(assessment) {
  if (!assessmentPreview) return;
  assessmentPreview.innerHTML = `
    <span class="panel-label">Assessment preview</span>
    <h3>${escapeHtml(assessment.level)} concern - score ${assessment.score}</h3>
    <p><strong>Concern:</strong> ${escapeHtml(assessment.concern)}</p>
    <p><strong>Severity:</strong> ${assessment.severity}/10</p>
    <p><strong>Symptoms:</strong> ${escapeHtml(assessment.symptoms.join(", ") || "None selected")}</p>
    <p><strong>Recommendation:</strong> ${escapeHtml(assessment.recommendation)}</p>
  `;
}

if (bookingForm) {
  bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = clientName.value.trim() || "New client";
    const contact = clientContact.value.trim() || "Contact not provided";
    const service = serviceSelect.value;
    const packageText = packageChoice.value.trim() || "No package selected yet";
    const message = clientMessage.value.trim() || "No concern details added yet.";
    const assessment = assessConcern();
    renderAssessmentPreview(assessment);

    bookingSummary.innerHTML = `
      <span class="panel-label">Booking summary</span>
      <h3>${escapeHtml(name)} - ${escapeHtml(service)}</h3>
      <p><strong>Contact:</strong> ${escapeHtml(contact)}</p>
      <p><strong>Package:</strong> ${escapeHtml(packageText)}</p>
      <p><strong>Client concern:</strong> ${escapeHtml(message)}</p>
      <p><strong>Assessment:</strong> ${escapeHtml(assessment.level)} concern, score ${assessment.score}. Severity ${assessment.severity}/10. Duration: ${escapeHtml(assessment.duration)}.</p>
      <p><strong>Symptoms:</strong> ${escapeHtml(assessment.symptoms.join(", ") || "None selected")}</p>
      <p><strong>Recent changes:</strong> ${escapeHtml(assessment.changes)}</p>
      <p><strong>Assessment recommendation:</strong> ${escapeHtml(assessment.recommendation)}</p>
      <p><strong>Recommended next step:</strong> Send intake questions, collect payment, then schedule the first session.</p>
      <p><strong>Accepted payment:</strong> Cash, Cash App $DaronRoyal, PayPal/Zelle droyal168@gmail.com, or Venmo @Daron-Royal / @DaronRoyal. Venmo last four: 2095.</p>
      <p><strong>Appointment language:</strong> Offer first availability in EST and ask which time works before reserving the slot.</p>
      <p><strong>Follow-up cadence:</strong> ${followUpPlan(service)}</p>
    `;

    localStorage.setItem("royalEnergyBooking", JSON.stringify({
      name,
      contact,
      service,
      package: packageText,
      message,
      assessment,
      createdAt: new Date().toISOString()
    }));
  });
}

const reportClient = document.querySelector("#reportClient");
const reportFocus = document.querySelector("#reportFocus");
const beforeScore = document.querySelector("#beforeScore");
const afterScore = document.querySelector("#afterScore");
const reportNotes = document.querySelector("#reportNotes");
const generateReport = document.querySelector("#generateReport");
const reportPreview = document.querySelector("#reportPreview");

function syncRangeOutput(input) {
  const output = input.parentElement.querySelector("output");
  if (output) {
    output.textContent = input.value;
  }
}

[beforeScore, afterScore].forEach((input) => {
  if (!input) return;
  input.addEventListener("input", () => syncRangeOutput(input));
  syncRangeOutput(input);
});

if (assessmentSeverity) {
  assessmentSeverity.addEventListener("input", () => syncRangeOutput(assessmentSeverity));
  syncRangeOutput(assessmentSeverity);
}

if (intakeSeverity) {
  intakeSeverity.addEventListener("input", () => syncRangeOutput(intakeSeverity));
  syncRangeOutput(intakeSeverity);
}

if (generateReport) {
  generateReport.addEventListener("click", () => {
    const client = reportClient.value.trim() || "Client";
    const focus = reportFocus.value;
    const before = Number(beforeScore.value);
    const after = Number(afterScore.value);
    const change = before - after;
    const notes = reportNotes.value.trim() || "No notes entered yet.";
    const direction = change > 0 ? `${change}-point improvement` : change === 0 ? "no score change yet" : `${Math.abs(change)}-point increase to watch`;

    reportPreview.innerHTML = `
      <span class="panel-label">Generated report</span>
      <h3>${escapeHtml(client)} - ${escapeHtml(focus)}</h3>
      <p><strong>Client-reported heaviness:</strong> ${before}/10 before, ${after}/10 now (${direction}).</p>
      <p><strong>Observed pattern:</strong> Track sleep, dreams, mood, body sensations, recurring symptoms, and space energy across the next follow-up window.</p>
      <p><strong>Notes:</strong> ${escapeHtml(notes)}</p>
      <p><strong>Recommended follow-up:</strong> Send the 24/48/72-hour check-ins, compare scores at the next session, and decide whether a treatment plan or maintenance session is appropriate.</p>
    `;
  });
}
