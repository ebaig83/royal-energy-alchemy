'use strict';

// ── Cancellation Policy — single source of truth ──────────────────────────────
// Edit this file to change the policy everywhere: emails, manage-appointment,
// cancellations portal, and any future surface.

const POLICY = {
  tiers: [
    { minHours: 72, refundPct: 100, label: 'Full refund or session credit' },
    { minHours: 24, refundPct: 50,  label: '50% refund or session credit'  },
    { minHours: 0,  refundPct: 0,   label: 'Non-refundable'                },
  ],
  noShow: { refundPct: 0, label: 'Non-refundable — must prepay to rebook' },
  // Human-readable lines for display in emails, UI, etc.
  lines: [
    '72+ hours notice: Full refund or session credit',
    '24–72 hours notice: 50% refund or session credit',
    'Less than 24 hours: Non-refundable',
    'No-show / no-call: Non-refundable — must prepay to rebook',
  ],
};

/**
 * calcRefund(appointmentDate, appointmentTime)
 * Returns { eligible, pct, estimate, hours }
 */
function calcRefund(appointmentDate, appointmentTime) {
  if (!appointmentDate) {
    return {
      eligible: false, pct: 0,
      estimate: 'Non-refundable — appointment date not provided.',
      hours: null,
    };
  }

  const timeStr  = appointmentTime ? String(appointmentTime).slice(0, 5) : '12:00';
  const [h, m]   = timeStr.split(':').map(Number);
  const [y, mo, d] = appointmentDate.split('-').map(Number);
  const apptMs   = new Date(y, mo - 1, d, h || 12, m || 0).getTime();
  const nowMs    = Date.now();
  const hrs      = (apptMs - nowMs) / 3600000;

  if (hrs < 0) {
    return {
      eligible: false, pct: 0,
      estimate: 'Non-refundable — appointment has already passed.',
      hours: Math.round(hrs),
    };
  }

  for (const tier of POLICY.tiers) {
    if (hrs >= tier.minHours) {
      const pct = tier.refundPct;
      return {
        eligible: pct > 0,
        pct,
        estimate: pct === 100
          ? 'Eligible for a full refund or session credit.'
          : pct > 0
            ? `Eligible for a ${pct}% refund or session credit.`
            : `Non-refundable — appointment is within ${Math.round(hrs)} hours (policy requires 24+ hours notice).`,
        hours: Math.round(hrs),
      };
    }
  }

  return { eligible: false, pct: 0, estimate: 'Non-refundable.', hours: Math.round(hrs) };
}

module.exports = { POLICY, calcRefund };
