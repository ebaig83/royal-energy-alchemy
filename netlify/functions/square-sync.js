// ─────────────────────────────────────────────────────────────────────────────
// square-sync.js  —  Netlify Function
// Proxies Square Appointments API → dashboard.html
//
// Required Netlify env var:
//   SQUARE_ACCESS_TOKEN  — your Square Production access token
//                          (Developers → Your App → Production → Access Token)
//
// Optional:
//   SQUARE_LOCATION_ID   — limit bookings to one location
//                          defaults to LA19CVXRF3KDC from the public booking page
//
// Called by: dashboard.html  →  /.netlify/functions/square-sync
// Query params:
//   ?days_back=90        — how many days back to fetch (default 90)
//   ?days_forward=60     — how many days forward (default 60)
// ─────────────────────────────────────────────────────────────────────────────

const SQUARE_BASE   = 'https://connect.squareup.com/v2';
const LOCATION_ID   = process.env.SQUARE_LOCATION_ID || 'LA19CVXRF3KDC';

// Map Square service variation IDs to human names, fallback to the raw ID
const SERVICE_NAMES = {
  // Add your Square service variation IDs here after setup
  // e.g. 'ABCDEF123': 'Energetic Parasite Session'
};

const SERVICE_PRICES = {
  'Initial Session': 90,
  '15-Minute Consultation': 50,
  'Extended Session': 110,
  'House Clearing': 80,
  'Emergency Removal': 120,
  'Coaching': 50,
  'Follow-Up Session': 80,
  'Energetic Parasite Session': 75,
};

const SERVICE_ALIASES = {
  'Energetic Parasite Removal': 'Energetic Parasite Session',
  'Cord Removal & Transmutation': '15-Minute Consultation',
  'Energy Alchemy Exorcism': 'Initial Session',
  'Distance Energy Session': 'Extended Session',
  'House Cleansing & Blessing': 'House Clearing',
  'Emergency Removal Session': 'Emergency Removal',
  'Removal + Tarot Bundle': 'Follow-Up Session',
  'Spiritual Coaching': 'Coaching',
  'Round 2 Session': 'Follow-Up Session',
};

function normalizeServiceName(rawName) {
  const name = (rawName || '').trim();
  if (!name) return 'Session';
  const base = name.split('—')[0].trim();
  return SERVICE_ALIASES[base] || SERVICE_PRICES[base] ? (SERVICE_ALIASES[base] || base) : name;
}

exports.handler = async function(event) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return respond(500, { error: 'SQUARE_ACCESS_TOKEN not set. Add it in Netlify → Site Settings → Environment Variables.' });
  }

  const params   = event.queryStringParameters || {};
  const daysBack = Math.min(parseInt(params.days_back) || 90, 365);
  const daysFwd  = Math.min(parseInt(params.days_forward) || 60, 365);

  const now     = new Date();
  const startAt = new Date(now); startAt.setDate(startAt.getDate() - daysBack);
  const endAt   = new Date(now); endAt.setDate(endAt.getDate() + daysFwd);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Square-Version': '2024-01-18',
    'Content-Type':   'application/json',
  };

  try {
    // ── 1. Fetch bookings ──────────────────────────────────────────
    const bookings = [];
    let cursor = null;

    do {
      const url = new URL(`${SQUARE_BASE}/bookings`);
      url.searchParams.set('start_at_min', startAt.toISOString());
      url.searchParams.set('start_at_max', endAt.toISOString());
      url.searchParams.set('limit', '100');
      if (LOCATION_ID) url.searchParams.set('location_id', LOCATION_ID);
      if (cursor) url.searchParams.set('cursor', cursor);

      const res  = await fetch(url.toString(), { headers });
      const data = await res.json();

      if (!res.ok) {
        return respond(res.status, { error: 'Square bookings API error', detail: data.errors });
      }

      (data.bookings || []).forEach(b => bookings.push(b));
      cursor = data.cursor || null;
    } while (cursor);

    // ── 2. Batch-fetch customers ───────────────────────────────────
    const customerIds = [...new Set(bookings.map(b => b.customer_id).filter(Boolean))];
    const customerMap = {};

    if (customerIds.length > 0) {
      // Square batch retrieve: up to 100 at a time
      for (let i = 0; i < customerIds.length; i += 100) {
        const chunk = customerIds.slice(i, i + 100);
        const res   = await fetch(`${SQUARE_BASE}/customers/batch-retrieve`, {
          method:  'POST',
          headers,
          body:    JSON.stringify({ customer_ids: chunk }),
        });
        const data = await res.json();
        if (res.ok && data.responses) {
          data.responses.forEach(r => {
            if (r.customer) customerMap[r.customer.id] = r.customer;
          });
        }
      }
    }

    // ── 3. Shape the output ────────────────────────────────────────
    const result = bookings.map(b => {
      const customer  = customerMap[b.customer_id] || {};
      const seg       = (b.appointment_segments || [])[0] || {};
      const givenName = customer.given_name || '';
      const famName   = customer.family_name || '';
      const fullName  = [givenName, famName].filter(Boolean).join(' ') || 'Unknown Client';

      // Parse local date/time from the ISO timestamp
      // Square stores start_at in UTC — convert to ET approximation (UTC-5/UTC-4)
      const startDate = new Date(b.start_at);
      const offsetHrs = -5; // EST; adjust to -4 in DST if needed
      const localDate = new Date(startDate.getTime() + offsetHrs * 3600 * 1000);
      const dateStr   = localDate.toISOString().slice(0, 10);
      const timeStr   = localDate.toISOString().slice(11, 16);

      const svcId   = seg.service_variation_id || '';
      const svcName = normalizeServiceName(SERVICE_NAMES[svcId] || svcId || 'Session');

      const statusMap = {
        'ACCEPTED':               'active',
        'PENDING':                'pending',
        'DECLINED':               'cancelled',
        'CANCELLED_BY_CUSTOMER':  'cancelled',
        'CANCELLED_BY_SELLER':    'cancelled',
        'NO_SHOW':                'no_show',
      };

      return {
        squareBookingId:  b.id,
        squareCustomerId: b.customer_id || null,
        client:           fullName,
        email:            customer.email_address || '',
        phone:            customer.phone_number  || '',
        date:             dateStr,
        time:             timeStr,
        dur:              seg.duration_minutes || b.duration_minutes || 60,
        service:          svcName,
        price:            SERVICE_PRICES[svcName] || 0,
        status:           statusMap[b.status] || 'active',
        squareStatus:     b.status,
        notes:            b.seller_note || b.customer_note || '',
        source:           'square',
        createdAt:        b.created_at || null,
        updatedAt:        b.updated_at || null,
      };
    });

    return respond(200, { success: true, count: result.length, bookings: result });

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
