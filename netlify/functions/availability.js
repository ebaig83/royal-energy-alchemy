// /.netlify/functions/availability
//
// PUBLIC  GET  (no auth)  — fetch available slots for the booking calendar
//   ?date=YYYY-MM-DD        — slots for one date
//   ?from=YYYY-MM-DD        — slots from date onwards (default: today, 60 days)
//   (no params)             — all future available slots
//
// ADMIN   POST (auth)     — create one or more slots
// ADMIN   PATCH ?id=uuid  — update a slot status (booked/blocked/available/cancelled)
// ADMIN   DELETE ?id=uuid — hard-delete a slot (admin cleanup only)

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

// ── helpers ──────────────────────────────────────────────────────────────────

function buildLabel(dateStr, timeStr) {
  // dateStr: "2026-06-19", timeStr: "19:00" or "19:00:00"
  const [y, m, d]   = dateStr.split('-').map(Number);
  const [hh, mm]    = timeStr.split(':').map(Number);
  const dt          = new Date(y, m - 1, d);
  const weekday     = dt.toLocaleDateString('en-US', { weekday: 'short' });
  const month       = dt.toLocaleDateString('en-US', { month: 'short' });
  const suffix      = d >= 11 && d <= 13 ? 'th' : ['th','st','nd','rd'][d % 10] || 'th';
  const ampm        = hh < 12 ? 'AM' : 'PM';
  const h12         = hh % 12 || 12;
  const minStr      = mm ? `:${String(mm).padStart(2,'0')}` : '';
  return `${weekday}, ${month} ${d}${suffix} at ${h12}${minStr} ${ampm}`;
}

function buildDisplayTime(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const ampm     = hh < 12 ? 'AM' : 'PM';
  const h12      = hh % 12 || 12;
  const minStr   = mm ? `:${String(mm).padStart(2,'0')}` : '';
  return `${h12}${minStr} ${ampm}`;
}

// ── handler ──────────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const sb     = getClient();
  const params = event.queryStringParameters || {};

  // ── PUBLIC GET ────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const today = new Date().toISOString().slice(0, 10);
    let query   = sb.from('availability_slots').select('id,slot_date,slot_time,label,display_time,status,session_id');

    if (params.date) {
      query = query.eq('slot_date', params.date);
    } else {
      const from = params.from || today;
      const to   = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      query      = query.gte('slot_date', from).lte('slot_date', to);
    }

    query = query.order('slot_date', { ascending: true }).order('slot_time', { ascending: true });

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });

    // Shape into the same format the booking calendar expects
    const slots = (data || []).map(row => ({
      id:          row.id,
      date:        row.slot_date,
      time:        row.slot_time ? row.slot_time.slice(0, 5) : '',
      displayTime: row.display_time || buildDisplayTime(row.slot_time || '00:00'),
      label:       row.label       || buildLabel(row.slot_date, row.slot_time || '00:00'),
      status:      row.status,
      booked:      row.status !== 'available',
    }));

    return respond(200, { slots });
  }

  // ── ADMIN WRITE — require token ───────────────────────────────────────────
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const ip = event.headers['x-forwarded-for'] || '';

  // ── ADMIN POST — create slot(s) ───────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    // Accept a single slot or array
    const items = Array.isArray(body) ? body : [body];
    if (!items.length) return respond(400, { error: 'No slot data provided.' });

    const rows = items.map(item => {
      if (!item.date || !item.time) throw new Error('Each slot requires date and time.');
      const timeNorm = item.time.length === 5 ? item.time + ':00' : item.time;
      return {
        slot_date:    item.date,
        slot_time:    timeNorm,
        label:        item.label        || buildLabel(item.date, item.time),
        display_time: item.display_time || buildDisplayTime(item.time),
        status:       item.status       || 'available',
        session_id:   item.session_id   || null,
      };
    });

    let data, error;
    try {
      ({ data, error } = await sb
        .from('availability_slots')
        .upsert(rows, { onConflict: 'slot_date,slot_time' })
        .select());
    } catch (e) { return respond(400, { error: e.message }); }

    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'created', tableName: 'availability_slots', recordId: data[0]?.id, newData: data, context: `Added ${data.length} slot(s)`, ip });

    return respond(201, { slots: data });
  }

  // ── ADMIN PATCH — update a slot ───────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }

    const { data: old } = await sb.from('availability_slots').select('*').eq('id', params.id).single();

    const allowed = ['status', 'session_id', 'label', 'display_time', 'slot_date', 'slot_time'];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    const { data, error } = await sb.from('availability_slots').update(updates).eq('id', params.id).select().single();
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'updated', tableName: 'availability_slots', recordId: params.id, oldData: old, newData: data, context: `Updated slot ${params.id} → ${data.status}`, ip });

    return respond(200, { slot: data });
  }

  // ── ADMIN DELETE — remove a slot ──────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    if (!params.id) return respond(400, { error: 'id is required.' });

    const { data: old } = await sb.from('availability_slots').select('*').eq('id', params.id).single();
    const { error }     = await sb.from('availability_slots').delete().eq('id', params.id);
    if (error) return respond(500, { error: error.message });

    await log({ actor: auth.user.email, action: 'deleted', tableName: 'availability_slots', recordId: params.id, oldData: old, context: `Deleted slot ${params.id}`, ip });

    return respond(200, { deleted: true });
  }

  return respond(405, { error: 'Method not allowed.' });
};
