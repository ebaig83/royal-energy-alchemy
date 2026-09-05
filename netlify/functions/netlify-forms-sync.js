// ─────────────────────────────────────────────────────────────────────────────
// netlify-forms-sync.js  —  Netlify Function
// Pulls booking form submissions from Netlify Forms → dashboard.html
//
// Required Netlify env var:
//   NETLIFY_ACCESS_TOKEN  — your Netlify Personal Access Token
//                           (netlify.com → User Settings → Applications → New access token)
//
// SITE_ID is injected automatically by Netlify into every function.
//
// Called by: dashboard.html  →  /.netlify/functions/netlify-forms-sync
// Query params:
//   ?per_page=100   — submissions per page (max 100, default 100)
//   ?page=1         — page number (default 1)
// ─────────────────────────────────────────────────────────────────────────────

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const { requireAdmin } = require('./lib/auth');

exports.handler = async function(event) {
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const token  = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId = process.env.SITE_ID;

  if (!token) {
    return respond(500, { error: 'NETLIFY_ACCESS_TOKEN not set. Add it in Netlify → Site Settings → Environment Variables.' });
  }
  if (!siteId) {
    return respond(500, { error: 'SITE_ID not available. This should be auto-injected by Netlify.' });
  }

  const params   = event.queryStringParameters || {};
  const perPage  = Math.min(parseInt(params.per_page) || 100, 100);
  const page     = parseInt(params.page) || 1;

  const headers = { 'Authorization': `Bearer ${token}` };

  try {
    // ── 1. Find the "booking" form for this site ───────────────────
    const formsRes  = await fetch(`${NETLIFY_API}/sites/${siteId}/forms`, { headers });
    const formsData = await formsRes.json();

    if (!formsRes.ok) {
      return respond(formsRes.status, { error: 'Could not fetch forms', detail: formsData });
    }

    const bookingForm = (formsData || []).find(f =>
      f.name === 'booking' || f.name === 'Booking' || f.name === 'contact'
    );

    if (!bookingForm) {
      return respond(404, {
        error: 'No form named "booking" found on this site.',
        available: (formsData || []).map(f => f.name),
      });
    }

    // ── 2. Fetch submissions ───────────────────────────────────────
    const subUrl = `${NETLIFY_API}/forms/${bookingForm.id}/submissions?per_page=${perPage}&page=${page}`;
    const subRes  = await fetch(subUrl, { headers });
    const subData = await subRes.json();

    if (!subRes.ok) {
      return respond(subRes.status, { error: 'Could not fetch submissions', detail: subData });
    }

    // ── 3. Shape the output ────────────────────────────────────────
    const submissions = (subData || []).map(s => {
      const d = s.data || {};
      return {
        netlifySubmissionId: s.id,
        submittedAt:         s.created_at,
        client:              (d.name || d.full_name || '').trim(),
        email:               (d.contact || d.email || '').includes('@') ? (d.contact || d.email || '').trim() : '',
        phone:               (d.contact || d.phone || '').includes('@') ? '' : (d.contact || d.phone || '').trim(),
        service:             (d.service || '').trim(),
        message:             (d.message || '').trim(),
        window1:             (d['window-1'] || d.window1 || '').trim(),
        window2:             (d['window-2'] || d.window2 || '').trim(),
        source:              'website_form',
        status:              'pending',   // needs Daron to confirm
        internalFlag:        d.internal_flag || '',
        spamSuspect:         !!s.data?.bot_field,
      };
    });

    return respond(200, {
      success:    true,
      formName:   bookingForm.name,
      formId:     bookingForm.id,
      count:      submissions.length,
      page,
      submissions,
    });

  } catch (err) {
    return respond(500, { error: 'Function error', detail: err.message });
  }
};

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
