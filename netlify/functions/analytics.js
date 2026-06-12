// /.netlify/functions/analytics
// GET ?section=recommendations  — Recommendation Intelligence
// GET ?section=outcomes          — Outcome Intelligence (state_before/state_after)
// GET ?section=retention         — Retention Intelligence
// GET ?section=cross-client      — Cross-Client Intelligence (NO PII)

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb      = getClient();
  const section = (event.queryStringParameters || {}).section;

  if (!section) {
    return respond(400, { error: 'section is required: recommendations | outcomes | retention | cross-client' });
  }

  try {
    if (section === 'recommendations') return respond(200, await recommendationIntelligence(sb));
    if (section === 'outcomes')        return respond(200, await outcomeIntelligence(sb));
    if (section === 'retention')       return respond(200, await retentionIntelligence(sb));
    if (section === 'cross-client')    return respond(200, await crossClientIntelligence(sb));
    return respond(400, { error: `Unknown section: ${section}` });
  } catch (err) {
    console.error('[analytics] Error in section', section, err.message);
    return respond(500, { error: err.message });
  }
};

// ── PHASE 2: RECOMMENDATION INTELLIGENCE ────────────────────────────────────
async function recommendationIntelligence(sb) {
  const { data: recs, error } = await sb
    .from('recommendations')
    .select('id, product_name, category, outcome_status, outcome_date, recommended_at, created_at, client_id')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!recs || recs.length === 0) {
    return { topRecommendations: [], conversionRates: {}, successRates: {}, trendData: [] };
  }

  // Top recommendations by frequency
  const productCounts = {};
  const productOutcomes = {};
  recs.forEach(r => {
    const name = r.product_name || 'Unknown';
    productCounts[name] = (productCounts[name] || 0) + 1;
    if (!productOutcomes[name]) productOutcomes[name] = { recommended: 0, purchased: 0, tried: 0, helpful: 0, not_helpful: 0, declined: 0, total: 0 };
    productOutcomes[name].total++;
    const s = r.outcome_status || 'recommended';
    if (productOutcomes[name][s] !== undefined) productOutcomes[name][s]++;
  });

  const topRecommendations = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => {
      const o = productOutcomes[name] || {};
      const purchased  = o.purchased  || 0;
      const helpful    = (o.helpful   || 0) + (o.tried || 0);
      const notHelpful = o.not_helpful || 0;
      const declined   = o.declined   || 0;
      const convRate   = count > 0 ? Math.round((purchased / count) * 100) : 0;
      const successRate = purchased > 0 ? Math.round(((helpful) / purchased) * 100) : null;
      return { name, recommendedCount: count, purchased, helpful, notHelpful, declined, conversionRate: convRate, successRate };
    });

  // Overall conversion and success rates by category
  const catStats = {};
  recs.forEach(r => {
    const cat = r.category || 'Uncategorized';
    if (!catStats[cat]) catStats[cat] = { total: 0, purchased: 0, helpful: 0, declined: 0 };
    catStats[cat].total++;
    if (r.outcome_status === 'purchased') catStats[cat].purchased++;
    if (r.outcome_status === 'helpful' || r.outcome_status === 'tried') catStats[cat].helpful++;
    if (r.outcome_status === 'declined') catStats[cat].declined++;
  });
  const conversionRates = {};
  const successRates = {};
  Object.entries(catStats).forEach(([cat, s]) => {
    conversionRates[cat] = s.total > 0 ? Math.round((s.purchased / s.total) * 100) : 0;
    successRates[cat]    = s.purchased > 0 ? Math.round((s.helpful / s.purchased) * 100) : null;
  });

  // Trend: recommendations per week (last 8 weeks)
  const now = Date.now();
  const weekBuckets = Array.from({ length: 8 }, (_, i) => {
    const end   = now - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const label = new Date(start).toISOString().slice(0, 10);
    const count = recs.filter(r => {
      const t = new Date(r.recommended_at || r.created_at).getTime();
      return t >= start && t < end;
    }).length;
    return { week: label, count };
  }).reverse();

  // Most/least helpful and most declined
  const mostPurchased = topRecommendations.slice().sort((a, b) => b.purchased - a.purchased)[0]?.name || null;
  const mostHelpful   = topRecommendations.slice().sort((a, b) => b.helpful - a.helpful)[0]?.name || null;
  const mostDeclined  = topRecommendations.slice().sort((a, b) => b.declined - a.declined)[0]?.name || null;

  // Avg days to outcome (for items that have outcome_date and recommended_at)
  const withDays = recs.filter(r => r.outcome_date && r.recommended_at);
  const avgDaysToOutcome = withDays.length > 0
    ? Math.round(withDays.reduce((sum, r) => {
        return sum + (new Date(r.outcome_date) - new Date(r.recommended_at)) / 86400000;
      }, 0) / withDays.length)
    : null;

  return {
    topRecommendations,
    conversionRates,
    successRates,
    trendData: weekBuckets,
    summary: { mostPurchased, mostHelpful, mostDeclined, avgDaysToOutcome, totalRecommendations: recs.length },
  };
}

// ── PHASE 3: OUTCOME INTELLIGENCE ───────────────────────────────────────────
async function outcomeIntelligence(sb) {
  const { data: sessions, error } = await sb
    .from('sessions')
    .select('id, service, location_type, session_date, state_before, state_after, status, client_id')
    .eq('status', 'completed')
    .order('session_date', { ascending: false });

  if (error) throw new Error(error.message);
  if (!sessions || sessions.length === 0) {
    return { avgImprovement: null, servicePerformance: [], locationPerformance: [], trends: [] };
  }

  const withState = sessions.filter(s => s.state_before != null && s.state_after != null);

  // Overall avg improvement
  const avgImprovement = withState.length > 0
    ? Math.round((withState.reduce((sum, s) => sum + (s.state_after - s.state_before), 0) / withState.length) * 100) / 100
    : null;

  // Service performance
  const serviceMap = {};
  withState.forEach(s => {
    const svc = s.service || 'General';
    if (!serviceMap[svc]) serviceMap[svc] = { total: 0, improvementSum: 0, improving: 0 };
    const delta = s.state_after - s.state_before;
    serviceMap[svc].total++;
    serviceMap[svc].improvementSum += delta;
    if (delta > 0) serviceMap[svc].improving++;
  });
  const servicePerformance = Object.entries(serviceMap)
    .map(([service, s]) => ({
      service,
      sessionsWithState: s.total,
      avgImprovement: Math.round((s.improvementSum / s.total) * 100) / 100,
      improvingRate: Math.round((s.improving / s.total) * 100),
    }))
    .sort((a, b) => b.avgImprovement - a.avgImprovement);

  // Location performance
  const locMap = {};
  withState.forEach(s => {
    const loc = s.location_type || 'unknown';
    if (!locMap[loc]) locMap[loc] = { total: 0, improvementSum: 0 };
    locMap[loc].total++;
    locMap[loc].improvementSum += (s.state_after - s.state_before);
  });
  const locationPerformance = Object.entries(locMap).map(([location, s]) => ({
    location,
    sessionsWithState: s.total,
    avgImprovement: Math.round((s.improvementSum / s.total) * 100) / 100,
  }));

  // Improvement trend over last 8 weeks (avg delta per week)
  const now = Date.now();
  const trends = Array.from({ length: 8 }, (_, i) => {
    const end   = now - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const week  = new Date(start).toISOString().slice(0, 10);
    const inWindow = withState.filter(s => {
      const t = new Date(s.session_date).getTime();
      return t >= start && t < end;
    });
    const avg = inWindow.length > 0
      ? Math.round((inWindow.reduce((sum, s) => sum + (s.state_after - s.state_before), 0) / inWindow.length) * 100) / 100
      : null;
    return { week, sessions: inWindow.length, avgImprovement: avg };
  }).reverse();

  return { avgImprovement, servicePerformance, locationPerformance, trends, sessionsWithStateData: withState.length, totalCompleted: sessions.length };
}

// ── PHASE 4: RETENTION INTELLIGENCE ─────────────────────────────────────────
async function retentionIntelligence(sb) {
  // Sessions and aftercare in parallel
  const [sessRes, acRes] = await Promise.all([
    sb.from('sessions').select('id, client_id, session_date, status').order('session_date', { ascending: true }),
    sb.from('aftercare').select('id, client_id, status, scheduled_for, followup_type'),
  ]);

  if (sessRes.error) throw new Error(sessRes.error.message);
  if (acRes.error)   throw new Error(acRes.error.message);

  const sessions = (sessRes.data || []).filter(s => s.status === 'completed');
  const aftercare = acRes.data || [];

  if (sessions.length === 0) {
    return { repeatRate: 0, avgSessions: 0, followUpCompletion: 0, rebookingRate: null, retentionScores: [] };
  }

  // Client session counts
  const clientSessions = {};
  sessions.forEach(s => {
    if (!s.client_id) return;
    if (!clientSessions[s.client_id]) clientSessions[s.client_id] = [];
    clientSessions[s.client_id].push(s.session_date);
  });

  const clientIds      = Object.keys(clientSessions);
  const repeatClients  = clientIds.filter(id => clientSessions[id].length > 1).length;
  const repeatRate     = clientIds.length > 0 ? Math.round((repeatClients / clientIds.length) * 100) : 0;
  const avgSessions    = clientIds.length > 0 ? Math.round((sessions.length / clientIds.length) * 10) / 10 : 0;

  // Avg days between sessions per client
  const allGaps = [];
  clientIds.forEach(id => {
    const dates = clientSessions[id].sort();
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
      allGaps.push(gap);
    }
  });
  const avgDaysBetweenSessions = allGaps.length > 0 ? Math.round(allGaps.reduce((a, b) => a + b, 0) / allGaps.length) : null;

  // Follow-up completion rate
  const nonSkipped       = aftercare.filter(a => a.status !== 'scheduled'); // sent or skipped
  const sent             = aftercare.filter(a => a.status === 'sent');
  const followUpCompletion = aftercare.length > 0 ? Math.round((sent.length / aftercare.length) * 100) : 0;

  // Rebook rate: clients who had a follow-up sent and then booked another session
  const clientsWithSentFollowUp = new Set(sent.map(a => a.client_id).filter(Boolean));
  let rebookCount = 0;
  clientsWithSentFollowUp.forEach(clientId => {
    const clientDates = clientSessions[clientId];
    if (!clientDates || clientDates.length < 2) return;
    const followUpDate = (sent.find(a => a.client_id === clientId)?.scheduled_for || '').slice(0, 10);
    if (followUpDate && clientDates.some(d => d > followUpDate)) rebookCount++;
  });
  const rebookingRate = clientsWithSentFollowUp.size > 0
    ? Math.round((rebookCount / clientsWithSentFollowUp.size) * 100)
    : null;

  // Retention scores per client (simple: sessions completed / days since first session)
  const retentionScores = clientIds
    .filter(id => clientSessions[id].length >= 2)
    .map(id => {
      const dates     = clientSessions[id].sort();
      const firstDate = new Date(dates[0]);
      const lastDate  = new Date(dates[dates.length - 1]);
      const span      = Math.max(1, (lastDate - firstDate) / 86400000);
      const sessCount = dates.length;
      const score     = Math.round((sessCount / (span / 30)) * 10) / 10; // sessions per month
      return { client_id: id, sessionCount: sessCount, spanDays: Math.round(span), sessionsPerMonth: score };
    })
    .sort((a, b) => b.sessionsPerMonth - a.sessionsPerMonth)
    .slice(0, 20);

  return { repeatRate, avgSessions, avgDaysBetweenSessions, followUpCompletion, rebookingRate, retentionScores, totalClients: clientIds.length, repeatClients };
}

// ── PHASE 5: CROSS-CLIENT INTELLIGENCE (NO PII) ──────────────────────────────
async function crossClientIntelligence(sb) {
  const [sessRes, recRes, snRes, acRes] = await Promise.all([
    sb.from('sessions').select('id, service, location_type, session_date, state_before, state_after, status, seller_notes'),
    sb.from('recommendations').select('id, product_name, category, outcome_status, recommended_at'),
    sb.from('session_notes').select('id, chief_concern, env_notes, snm_json'),
    sb.from('aftercare').select('id, followup_type, status'),
  ]);

  if (sessRes.error) throw new Error(sessRes.error.message);
  if (recRes.error)  throw new Error(recRes.error.message);

  const sessions       = sessRes.data || [];
  const recs           = recRes.data  || [];
  const notes          = snRes.data   || [];
  const aftercare      = acRes.data   || [];

  // Top concerns from chief_concern field (session_notes)
  const concernCounts = {};
  notes.forEach(n => {
    if (!n.chief_concern) return;
    const concern = n.chief_concern.trim().toLowerCase();
    concernCounts[concern] = (concernCounts[concern] || 0) + 1;
  });
  // Also extract from snm_json.concerns array if present
  notes.forEach(n => {
    if (!n.snm_json) return;
    let snm = n.snm_json;
    if (typeof snm === 'string') { try { snm = JSON.parse(snm); } catch { return; } }
    if (Array.isArray(snm.concerns)) {
      snm.concerns.forEach(c => {
        const key = (typeof c === 'string' ? c : c.label || '').trim().toLowerCase();
        if (key) concernCounts[key] = (concernCounts[key] || 0) + 1;
      });
    }
  });
  const topConcerns = Object.entries(concernCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([concern, count]) => ({ concern, count }));

  // Top services
  const serviceCounts = {};
  sessions.forEach(s => {
    if (!s.service) return;
    serviceCounts[s.service] = (serviceCounts[s.service] || 0) + 1;
  });
  const topServices = Object.entries(serviceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([service, count]) => ({ service, count }));

  // Top recommendations (by name, no client data)
  const recCounts = {};
  recs.forEach(r => {
    const name = r.product_name || 'Unknown';
    recCounts[name] = (recCounts[name] || 0) + 1;
  });
  const topRecommendations = Object.entries(recCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Effectiveness metrics — service vs improvement
  const withState = sessions.filter(s => s.state_before != null && s.state_after != null && s.status === 'completed');
  const serviceEffectiveness = {};
  withState.forEach(s => {
    const svc = s.service || 'General';
    if (!serviceEffectiveness[svc]) serviceEffectiveness[svc] = { count: 0, sum: 0, positive: 0 };
    const delta = s.state_after - s.state_before;
    serviceEffectiveness[svc].count++;
    serviceEffectiveness[svc].sum += delta;
    if (delta > 0) serviceEffectiveness[svc].positive++;
  });
  const effectivenessMetrics = Object.entries(serviceEffectiveness).map(([service, s]) => ({
    service,
    measuredSessions: s.count,
    avgImprovement: Math.round((s.sum / s.count) * 100) / 100,
    positiveOutcomeRate: Math.round((s.positive / s.count) * 100),
  })).sort((a, b) => b.avgImprovement - a.avgImprovement);

  // Follow-up type distribution (no PII)
  const followupTypes = {};
  aftercare.forEach(a => {
    const t = a.followup_type || 'unknown';
    followupTypes[t] = (followupTypes[t] || 0) + 1;
  });

  return { topConcerns, topServices, topRecommendations, effectivenessMetrics, followupTypeDistribution: followupTypes };
}
