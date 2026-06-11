// /.netlify/functions/daily-briefing
// GET  ?date=YYYY-MM-DD   — fetch or generate today's briefing
// POST                     — force-regenerate briefing for today

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { runDailyBriefingAgent } = require('./agents/daily-briefing-agent');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const date   = params.date || new Date().toISOString().slice(0, 10);

  // ── GET — return cached briefing or generate one ──────────────────
  if (event.httpMethod === 'GET') {
    const { data: existing } = await sb
      .from('daily_briefings')
      .select('*')
      .eq('briefing_date', date)
      .single();

    if (existing) return respond(200, { briefing: existing, cached: true });

    // Generate fresh
    const briefing = await buildBriefing({ sb, date, actor: auth.user.email });
    return respond(200, { briefing, cached: false });
  }

  // ── POST — force regenerate ───────────────────────────────────────
  if (event.httpMethod === 'POST') {
    // Delete existing for this date so we rebuild
    await sb.from('daily_briefings').delete().eq('briefing_date', date);
    const briefing = await buildBriefing({ sb, date, actor: auth.user.email });
    return respond(200, { briefing, cached: false });
  }

  return respond(405, { error: 'Method not allowed.' });
};

async function buildBriefing({ sb, date, actor }) {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const [
    { data: todaySessions },
    { data: dueAftercare },
    { data: unpaidSessions },
    { data: newIntakes },
  ] = await Promise.all([
    sb.from('sessions').select('*').eq('session_date', date).order('session_time', { ascending: true }),
    sb.from('aftercare').select('*, sessions(client_name, service)').lte('scheduled_for', `${tomorrowStr}T00:00:00Z`).eq('status', 'scheduled'),
    sb.from('sessions').select('id, client_name, amount_due, amount_paid, payment_status, session_date').in('payment_status', ['unpaid','partial']).gte('session_date', new Date(Date.now() - 30*86400000).toISOString().slice(0,10)),
    sb.from('intake_submissions').select('*').eq('processed', false).order('created_at', { ascending: false }),
  ]);

  const rawData = {
    date,
    todaySessions:  todaySessions  || [],
    dueAftercare:   dueAftercare   || [],
    unpaidSessions: unpaidSessions || [],
    newIntakes:     newIntakes     || [],
  };

  // Calculate stats
  const revenueDue  = (todaySessions || []).reduce((s, x) => s + (parseFloat(x.amount_due)  || 0), 0);
  const revenuePaid = (todaySessions || []).reduce((s, x) => s + (parseFloat(x.amount_paid) || 0), 0);

  // Build issues list
  const issues = [];
  (dueAftercare || []).forEach(a => issues.push({
    type: 'followup',
    priority: 'high',
    label: `${a.followup_type} follow-up due`,
    client: a.client_name || a.sessions?.client_name,
    id: a.id,
  }));
  (unpaidSessions || []).filter(s => s.payment_status === 'unpaid').forEach(s => issues.push({
    type: 'payment',
    priority: 'medium',
    label: `Unpaid session — $${s.amount_due || '?'}`,
    client: s.client_name,
    date: s.session_date,
    id: s.id,
  }));
  (newIntakes || []).forEach(i => issues.push({
    type: 'intake',
    priority: 'medium',
    label: 'New intake needs review',
    client: i.full_name,
    id: i.id,
  }));

  // Agent-generated summary
  let summaryText = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      summaryText = await runDailyBriefingAgent({ rawData });
    } catch (err) {
      console.error('[daily-briefing] Agent error:', err.message);
    }
  }

  const briefingRow = {
    briefing_date:  date,
    sessions_count: (todaySessions || []).length,
    revenue_due:    revenueDue,
    revenue_paid:   revenuePaid,
    follow_ups_due: (dueAftercare || []).length,
    new_intakes:    (newIntakes || []).length,
    issues,
    summary_text:   summaryText,
    raw_data:       rawData,
  };

  const { data } = await sb
    .from('daily_briefings')
    .upsert(briefingRow, { onConflict: 'briefing_date' })
    .select()
    .single();

  return data || briefingRow;
}
