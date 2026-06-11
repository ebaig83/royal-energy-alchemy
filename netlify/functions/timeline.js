// /.netlify/functions/timeline
// GET ?client_id=uuid  — full chronological timeline for one client:
//   sessions, notes, payments, aftercare, intake submissions — merged and sorted

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const params = event.queryStringParameters || {};
  if (!params.client_id) return respond(400, { error: 'client_id is required.' });

  const sb = getClient();
  const id = params.client_id;

  const [
    { data: client },
    { data: sessions },
    { data: notes },
    { data: payments },
    { data: aftercareRows },
    { data: intakes },
  ] = await Promise.all([
    sb.from('clients').select('*').eq('id', id).single(),
    sb.from('sessions').select('*').eq('client_id', id).order('session_date', { ascending: false }),
    sb.from('session_notes').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    sb.from('payments').select('*').eq('client_id', id).order('paid_at', { ascending: false }),
    sb.from('aftercare').select('*').eq('client_id', id).order('scheduled_for', { ascending: false }),
    sb.from('intake_submissions').select('*').eq('client_id', id).order('created_at', { ascending: false }),
  ]);

  if (!client) return respond(404, { error: 'Client not found.' });

  // Build a flat timeline array, each item has a type and a date for sorting
  const events = [];

  (sessions || []).forEach(s => events.push({
    type: 'session',
    date: s.session_date || s.created_at,
    data: s,
  }));

  (notes || []).forEach(n => events.push({
    type: 'note',
    date: n.created_at,
    data: n,
  }));

  (payments || []).forEach(p => events.push({
    type: 'payment',
    date: p.paid_at || p.created_at,
    data: p,
  }));

  (aftercareRows || []).forEach(a => events.push({
    type: 'aftercare',
    date: a.scheduled_for,
    data: a,
  }));

  (intakes || []).forEach(i => events.push({
    type: 'intake',
    date: i.created_at,
    data: i,
  }));

  // Sort newest first
  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Summary stats
  const completedSessions = (sessions || []).filter(s => s.status === 'completed');
  const totalPaid         = (payments || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const pendingFollowUps  = (aftercareRows || []).filter(a => a.status === 'scheduled').length;

  return respond(200, {
    client,
    stats: {
      totalSessions:    (sessions || []).length,
      completedSessions: completedSessions.length,
      totalPaid,
      pendingFollowUps,
    },
    timeline: events,
  });
};
