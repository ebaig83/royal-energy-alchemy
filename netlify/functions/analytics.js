// /.netlify/functions/analytics
// GET ?section=recommendations  — Recommendation Intelligence
// GET ?section=outcomes          — Outcome Intelligence (state_before/state_after)
// GET ?section=retention         — Retention Intelligence
// GET ?section=cross-client      — Cross-Client Intelligence (NO PII)
// GET ?section=data-quality      — Data Quality Audit (counts + severity)
// GET ?section=audit-detail      — Full record-level audit data for investigation

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

// Minimum sample sizes — never calculate metrics below these thresholds
const MIN = {
  OUTCOME_SESSIONS:    3,  // completed sessions with state_before + state_after
  REC_WITH_OUTCOME:    3,  // recommendations with a non-pending outcome_status
  RETENTION_CLIENTS:   3,  // clients with 2+ completed sessions
  CROSS_CLIENT_RECORDS: 5, // aggregate records for cross-client intelligence
};

function insufficientData(minimumRequired, currentCount, context) {
  return { status: 'insufficient_data', minimumRequired, currentCount, context };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb      = getClient();
  const section = (event.queryStringParameters || {}).section;

  if (!section) {
    return respond(400, { error: 'section is required: recommendations | outcomes | retention | cross-client | data-quality' });
  }

  try {
    if (section === 'recommendations') return respond(200, await recommendationIntelligence(sb));
    if (section === 'outcomes')        return respond(200, await outcomeIntelligence(sb));
    if (section === 'retention')       return respond(200, await retentionIntelligence(sb));
    if (section === 'cross-client')    return respond(200, await crossClientIntelligence(sb));
    if (section === 'data-quality')    return respond(200, await dataQualityAudit(sb));
    if (section === 'audit-detail')    return respond(200, await auditDetail(sb));
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
    return insufficientData(MIN.REC_WITH_OUTCOME, 0, 'No recommendations found');
  }

  // Count recommendations with a meaningful (non-pending) outcome
  const ALLOWED_OUTCOMES = ['purchased', 'tried', 'helpful', 'not_helpful', 'declined'];
  const recsWithOutcome = recs.filter(r => ALLOWED_OUTCOMES.includes(r.outcome_status));
  if (recsWithOutcome.length < MIN.REC_WITH_OUTCOME) {
    return insufficientData(MIN.REC_WITH_OUTCOME, recsWithOutcome.length, 'Recommendations with recorded outcomes');
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
      const successRate = purchased > 0 ? Math.round((helpful / purchased) * 100) : null;
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
  const trendData = Array.from({ length: 8 }, (_, i) => {
    const end   = now - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const count = recs.filter(r => {
      const t = new Date(r.recommended_at || r.created_at).getTime();
      return t >= start && t < end;
    }).length;
    return { week: new Date(start).toISOString().slice(0, 10), count };
  }).reverse();

  const mostPurchased = topRecommendations.slice().sort((a, b) => b.purchased - a.purchased)[0]?.name || null;
  const mostHelpful   = topRecommendations.slice().sort((a, b) => b.helpful - a.helpful)[0]?.name || null;
  const mostDeclined  = topRecommendations.slice().sort((a, b) => b.declined - a.declined)[0]?.name || null;

  const withDays = recs.filter(r => r.outcome_date && r.recommended_at);
  const avgDaysToOutcome = withDays.length > 0
    ? Math.round(withDays.reduce((sum, r) => sum + (new Date(r.outcome_date) - new Date(r.recommended_at)) / 86400000, 0) / withDays.length)
    : null;

  return {
    topRecommendations,
    conversionRates,
    successRates,
    trendData,
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

  const totalCompleted = (sessions || []).length;
  // Only valid if both state values are present and in range 1-5
  const withState = (sessions || []).filter(s =>
    s.state_before != null && s.state_after != null &&
    s.state_before >= 1 && s.state_before <= 5 &&
    s.state_after  >= 1 && s.state_after  <= 5
  );

  if (withState.length < MIN.OUTCOME_SESSIONS) {
    return {
      ...insufficientData(MIN.OUTCOME_SESSIONS, withState.length, 'Completed sessions with both pre- and post-session state scores'),
      totalCompleted,
      message: 'Outcome analytics will become available after 3 completed sessions contain both pre-session and post-session state scores.',
    };
  }

  const avgImprovement = Math.round(
    (withState.reduce((sum, s) => sum + (s.state_after - s.state_before), 0) / withState.length) * 100
  ) / 100;

  // Service performance — only include services with ≥ 1 valid session
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

  // Weekly improvement trend (only weeks with data contribute)
  const now = Date.now();
  const trends = Array.from({ length: 8 }, (_, i) => {
    const end   = now - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const inWindow = withState.filter(s => {
      const t = new Date(s.session_date).getTime();
      return t >= start && t < end;
    });
    const avg = inWindow.length > 0
      ? Math.round((inWindow.reduce((sum, s) => sum + (s.state_after - s.state_before), 0) / inWindow.length) * 100) / 100
      : null;
    return { week: new Date(start).toISOString().slice(0, 10), sessions: inWindow.length, avgImprovement: avg };
  }).reverse();

  return { avgImprovement, servicePerformance, locationPerformance, trends, sessionsWithStateData: withState.length, totalCompleted };
}

// ── PHASE 4: RETENTION INTELLIGENCE ─────────────────────────────────────────
async function retentionIntelligence(sb) {
  const [sessRes, acRes] = await Promise.all([
    sb.from('sessions').select('id, client_id, session_date, status').order('session_date', { ascending: true }),
    sb.from('aftercare').select('id, client_id, status, scheduled_for, followup_type'),
  ]);

  if (sessRes.error) throw new Error(sessRes.error.message);
  if (acRes.error)   throw new Error(acRes.error.message);

  const sessions = (sessRes.data || []).filter(s => s.status === 'completed');
  const aftercare = acRes.data || [];

  // Client session map
  const clientSessions = {};
  sessions.forEach(s => {
    if (!s.client_id) return;
    if (!clientSessions[s.client_id]) clientSessions[s.client_id] = [];
    clientSessions[s.client_id].push(s.session_date);
  });

  const clientIds     = Object.keys(clientSessions);
  const repeatClients = clientIds.filter(id => clientSessions[id].length > 1).length;
  const totalClients  = clientIds.length;

  // Follow-up completion — can be computed regardless of session count
  const sent               = aftercare.filter(a => a.status === 'sent');
  const followUpCompletion = aftercare.length > 0 ? Math.round((sent.length / aftercare.length) * 100) : 0;

  // Basic metrics always available if any sessions exist
  const repeatRate  = totalClients > 0 ? Math.round((repeatClients / totalClients) * 100) : 0;
  const avgSessions = totalClients > 0 ? Math.round((sessions.length / totalClients) * 10) / 10 : 0;

  // Guard: retention scores require MIN.RETENTION_CLIENTS clients with 2+ sessions
  if (repeatClients < MIN.RETENTION_CLIENTS) {
    return {
      repeatRate,
      avgSessions,
      followUpCompletion,
      rebookingRate: null,
      retentionScores: insufficientData(MIN.RETENTION_CLIENTS, repeatClients, 'Clients with 2+ completed sessions for retention scoring'),
      totalClients,
      repeatClients,
    };
  }

  // Avg days between sessions
  const allGaps = [];
  clientIds.forEach(id => {
    const dates = clientSessions[id].sort();
    for (let i = 1; i < dates.length; i++) {
      allGaps.push((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    }
  });
  const avgDaysBetweenSessions = allGaps.length > 0
    ? Math.round(allGaps.reduce((a, b) => a + b, 0) / allGaps.length)
    : null;

  // Rebook rate
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

  const retentionScores = clientIds
    .filter(id => clientSessions[id].length >= 2)
    .map(id => {
      const dates     = clientSessions[id].sort();
      const firstDate = new Date(dates[0]);
      const lastDate  = new Date(dates[dates.length - 1]);
      const span      = Math.max(1, (lastDate - firstDate) / 86400000);
      const sessCount = dates.length;
      const score     = Math.round((sessCount / (span / 30)) * 10) / 10;
      return { client_id: id, sessionCount: sessCount, spanDays: Math.round(span), sessionsPerMonth: score };
    })
    .sort((a, b) => b.sessionsPerMonth - a.sessionsPerMonth)
    .slice(0, 20);

  return { repeatRate, avgSessions, avgDaysBetweenSessions, followUpCompletion, rebookingRate, retentionScores, totalClients, repeatClients };
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

  const sessions  = sessRes.data || [];
  const recs      = recRes.data  || [];
  const notes     = snRes.data   || [];
  const aftercare = acRes.data   || [];

  // Guard: need MIN.CROSS_CLIENT_RECORDS aggregate service records
  const serviceSet = new Set(sessions.map(s => s.service).filter(Boolean));
  if (sessions.length < MIN.CROSS_CLIENT_RECORDS) {
    return insufficientData(MIN.CROSS_CLIENT_RECORDS, sessions.length, 'Total session records for cross-client analysis');
  }

  // Top concerns — from chief_concern and snm_json.concerns
  const concernCounts = {};
  notes.forEach(n => {
    if (!n.chief_concern) return;
    const concern = n.chief_concern.trim().toLowerCase();
    concernCounts[concern] = (concernCounts[concern] || 0) + 1;
  });
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

  // Top recommendations (aggregate only — no client_id exposed)
  const recCounts = {};
  recs.forEach(r => {
    const name = r.product_name || 'Unknown';
    recCounts[name] = (recCounts[name] || 0) + 1;
  });
  const topRecommendations = Object.entries(recCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Effectiveness: only include services with ≥ 1 session with valid state data
  const withState = sessions.filter(s =>
    s.state_before != null && s.state_after != null &&
    s.state_before >= 1 && s.state_before <= 5 &&
    s.state_after  >= 1 && s.state_after  <= 5 &&
    s.status === 'completed'
  );
  const serviceEffectiveness = {};
  withState.forEach(s => {
    const svc = s.service || 'General';
    if (!serviceEffectiveness[svc]) serviceEffectiveness[svc] = { count: 0, sum: 0, positive: 0 };
    const delta = s.state_after - s.state_before;
    serviceEffectiveness[svc].count++;
    serviceEffectiveness[svc].sum += delta;
    if (delta > 0) serviceEffectiveness[svc].positive++;
  });
  const effectivenessMetrics = Object.entries(serviceEffectiveness)
    .map(([service, s]) => ({
      service,
      measuredSessions: s.count,
      avgImprovement: Math.round((s.sum / s.count) * 100) / 100,
      positiveOutcomeRate: Math.round((s.positive / s.count) * 100),
    }))
    .sort((a, b) => b.avgImprovement - a.avgImprovement);

  // Follow-up type distribution (no PII)
  const followupTypes = {};
  aftercare.forEach(a => {
    const t = a.followup_type || 'unknown';
    followupTypes[t] = (followupTypes[t] || 0) + 1;
  });

  return { topConcerns, topServices, topRecommendations, effectivenessMetrics, followupTypeDistribution: followupTypes };
}

// ── PHASE 8: DATA QUALITY AUDIT ─────────────────────────────────────────────
async function dataQualityAudit(sb) {
  const issues = [];
  const exclusions = [];
  let auditedAt = new Date().toISOString();

  const [sessRes, recRes, clientRes, acRes] = await Promise.all([
    sb.from('sessions').select('id, client_id, session_date, status, state_before, state_after, payment_status'),
    sb.from('recommendations').select('id, client_id, product_name, outcome_status, recommended_at, created_at'),
    sb.from('clients').select('id, email, phone, status, created_at'),
    sb.from('aftercare').select('id, client_id, session_id, status, scheduled_for'),
  ]);

  if (sessRes.error)   throw new Error('sessions: ' + sessRes.error.message);
  if (recRes.error)    throw new Error('recommendations: ' + recRes.error.message);
  if (clientRes.error) throw new Error('clients: ' + clientRes.error.message);
  if (acRes.error)     throw new Error('aftercare: ' + acRes.error.message);

  const sessions    = sessRes.data   || [];
  const recs        = recRes.data    || [];
  const clients     = clientRes.data || [];
  const aftercare   = acRes.data     || [];

  const clientIdSet   = new Set(clients.map(c => c.id));
  const sessionIdSet  = new Set(sessions.map(s => s.id));
  const VALID_OUTCOMES = ['recommended', 'purchased', 'tried', 'helpful', 'not_helpful', 'declined'];
  const now = new Date();
  const staleThreshold = 90 * 86400000; // 90 days

  // ── Sessions ─────────────────────────────────────────────────────
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const missingStateScores = completedSessions.filter(s => s.state_before == null || s.state_after == null);
  if (missingStateScores.length > 0) {
    issues.push({ severity: 'High', table: 'sessions', issue: 'Missing state scores', count: missingStateScores.length, detail: `${missingStateScores.length} completed session(s) lack pre- or post-session state scores. These are excluded from outcome analytics.` });
    missingStateScores.forEach(s => exclusions.push({ table: 'sessions', id: s.id, reason: 'Missing state_before or state_after' }));
  }

  const invalidState = sessions.filter(s =>
    (s.state_before != null && (s.state_before < 1 || s.state_before > 5)) ||
    (s.state_after  != null && (s.state_after  < 1 || s.state_after  > 5))
  );
  if (invalidState.length > 0) {
    issues.push({ severity: 'Critical', table: 'sessions', issue: 'Invalid state score range', count: invalidState.length, detail: `${invalidState.length} session(s) have state scores outside the 1–5 scale. Excluded from all analytics.` });
    invalidState.forEach(s => exclusions.push({ table: 'sessions', id: s.id, reason: 'State score out of 1-5 range' }));
  }

  const orphanedSessions = sessions.filter(s => s.client_id && !clientIdSet.has(s.client_id));
  if (orphanedSessions.length > 0) {
    issues.push({ severity: 'Critical', table: 'sessions', issue: 'Orphaned sessions (no client record)', count: orphanedSessions.length, detail: `${orphanedSessions.length} session(s) reference a client_id that does not exist.` });
  }

  const stalePending = sessions.filter(s => s.status === 'pending' && (now - new Date(s.session_date)) > staleThreshold);
  if (stalePending.length > 0) {
    issues.push({ severity: 'Medium', table: 'sessions', issue: 'Stale pending sessions (90+ days)', count: stalePending.length, detail: `${stalePending.length} session(s) in "pending" status older than 90 days.` });
  }

  // Duplicate sessions: same client_id + session_date
  const sessionKeys = {};
  sessions.forEach(s => {
    const key = `${s.client_id}::${s.session_date}`;
    sessionKeys[key] = (sessionKeys[key] || 0) + 1;
  });
  const dupSessionCount = Object.values(sessionKeys).filter(c => c > 1).length;
  if (dupSessionCount > 0) {
    issues.push({ severity: 'High', table: 'sessions', issue: 'Duplicate session entries', count: dupSessionCount, detail: `${dupSessionCount} client+date combination(s) appear more than once.` });
  }

  // ── Recommendations ──────────────────────────────────────────────
  const invalidOutcomes = recs.filter(r => r.outcome_status && !VALID_OUTCOMES.includes(r.outcome_status));
  if (invalidOutcomes.length > 0) {
    issues.push({ severity: 'High', table: 'recommendations', issue: 'Invalid outcome_status values', count: invalidOutcomes.length, detail: `${invalidOutcomes.length} recommendation(s) have outcome_status values not in the allowed set.` });
    invalidOutcomes.forEach(r => exclusions.push({ table: 'recommendations', id: r.id, reason: 'Invalid outcome_status: ' + r.outcome_status }));
  }

  const orphanedRecs = recs.filter(r => r.client_id && !clientIdSet.has(r.client_id));
  if (orphanedRecs.length > 0) {
    issues.push({ severity: 'Critical', table: 'recommendations', issue: 'Orphaned recommendations (no client record)', count: orphanedRecs.length, detail: `${orphanedRecs.length} recommendation(s) reference a client_id that does not exist.` });
  }

  // Purchased/tried with no further outcome after 30 days
  const feedbackGap = recs.filter(r => {
    if (r.outcome_status !== 'purchased' && r.outcome_status !== 'tried') return false;
    const age = (now - new Date(r.recommended_at || r.created_at)) / 86400000;
    return age > 30;
  });
  if (feedbackGap.length > 0) {
    issues.push({ severity: 'Low', table: 'recommendations', issue: 'Purchased/tried without outcome follow-up (30+ days)', count: feedbackGap.length, detail: `${feedbackGap.length} recommendation(s) remain at "purchased" or "tried" status for 30+ days without a helpful/not_helpful outcome.` });
  }

  // ── Clients ──────────────────────────────────────────────────────
  // Duplicate emails
  const emailMap = {};
  clients.forEach(c => { if (c.email) emailMap[c.email] = (emailMap[c.email] || 0) + 1; });
  const dupEmails = Object.values(emailMap).filter(c => c > 1).length;
  if (dupEmails > 0) {
    issues.push({ severity: 'High', table: 'clients', issue: 'Duplicate client emails', count: dupEmails, detail: `${dupEmails} email address(es) appear on more than one client record.` });
  }

  // Duplicate phones
  const phoneMap = {};
  clients.forEach(c => {
    if (!c.phone) return;
    const norm = c.phone.replace(/\D/g, '');
    if (norm.length >= 7) phoneMap[norm] = (phoneMap[norm] || 0) + 1;
  });
  const dupPhones = Object.values(phoneMap).filter(c => c > 1).length;
  if (dupPhones > 0) {
    issues.push({ severity: 'Medium', table: 'clients', issue: 'Duplicate client phone numbers', count: dupPhones, detail: `${dupPhones} phone number(s) appear on more than one client record.` });
  }

  // ── Aftercare ────────────────────────────────────────────────────
  const orphanedAftercate = aftercare.filter(a => a.client_id && !clientIdSet.has(a.client_id));
  if (orphanedAftercate.length > 0) {
    issues.push({ severity: 'Critical', table: 'aftercare', issue: 'Orphaned follow-ups (no client record)', count: orphanedAftercate.length, detail: `${orphanedAftercate.length} follow-up(s) reference a client_id that does not exist.` });
  }

  const brokenSessionRefs = aftercare.filter(a => a.session_id && !sessionIdSet.has(a.session_id));
  if (brokenSessionRefs.length > 0) {
    issues.push({ severity: 'Medium', table: 'aftercare', issue: 'Broken session references', count: brokenSessionRefs.length, detail: `${brokenSessionRefs.length} follow-up(s) reference a session_id that does not exist.` });
  }

  // Sort by severity
  const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  issues.sort((a, b) => (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4));

  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });

  return {
    auditedAt,
    summary: { totalIssues: issues.length, ...counts },
    issues,
    exclusions: { totalExcluded: exclusions.length, records: exclusions },
    status: issues.length === 0 ? 'clean' : counts.Critical > 0 ? 'critical' : counts.High > 0 ? 'degraded' : 'acceptable',
  };
}

// ── AUDIT DETAIL — full record-level data for investigation scripts ──────────
// Returns raw records needed to classify duplicates, stale sessions, test data,
// and missing outcomes. Read-only. No PII redaction (admin-only endpoint).
async function auditDetail(sb) {
  const now = new Date();
  const staleThreshold = new Date(now - 90 * 86400000).toISOString();

  const [clientRes, sessRes, recRes, acRes, intakeRes, notesRes] = await Promise.all([
    sb.from('clients')
      .select('id, full_name, email, phone, status, source, tags, created_at, updated_at')
      .order('created_at', { ascending: false }),
    sb.from('sessions')
      .select('id, client_id, client_name, service, session_date, status, payment_status, state_before, state_after, source, seller_notes, created_at, updated_at')
      .order('session_date', { ascending: false }),
    sb.from('recommendations')
      .select('id, client_id, product_name, category, outcome_status, recommended_at, created_at')
      .order('created_at', { ascending: false }),
    sb.from('aftercare')
      .select('id, client_id, session_id, client_name, followup_type, scheduled_for, status, source, created_at')
      .order('scheduled_for', { ascending: false })
      .limit(500),
    sb.from('intake_submissions')
      .select('id, client_id, session_id, full_name, email, phone, processed, match_status, spam_suspect, created_at')
      .order('created_at', { ascending: false })
      .limit(300),
    sb.from('session_notes')
      .select('id, session_id, client_id, note_type, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  if (clientRes.error)  throw new Error('clients: '  + clientRes.error.message);
  if (sessRes.error)    throw new Error('sessions: '  + sessRes.error.message);
  if (recRes.error)     throw new Error('recs: '      + recRes.error.message);
  if (acRes.error)      throw new Error('aftercare: ' + acRes.error.message);

  const clients  = clientRes.data  || [];
  const sessions = sessRes.data    || [];
  const recs     = recRes.data     || [];
  const aftercare = acRes.data     || [];
  const intakes  = intakeRes.data  || [];
  const notes    = notesRes.data   || [];

  const clientIdSet  = new Set(clients.map(c => c.id));
  const sessionIdSet = new Set(sessions.map(s => s.id));

  // ── Duplicate client emails ───────────────────────────────────────
  const emailMap = {};
  clients.forEach(c => {
    if (!c.email) return;
    const key = c.email.toLowerCase().trim();
    if (!emailMap[key]) emailMap[key] = [];
    emailMap[key].push({ id: c.id, full_name: c.full_name, email: c.email, phone: c.phone, status: c.status, tags: c.tags, created_at: c.created_at, source: c.source });
  });
  const dupEmails = Object.entries(emailMap)
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({ email, count: rows.length, clients: rows }));

  // ── Duplicate client phones ───────────────────────────────────────
  const phoneMap = {};
  clients.forEach(c => {
    if (!c.phone) return;
    const key = c.phone.replace(/\D/g, '');
    if (key.length < 7) return;
    if (!phoneMap[key]) phoneMap[key] = [];
    phoneMap[key].push({ id: c.id, full_name: c.full_name, email: c.email, phone: c.phone, status: c.status, tags: c.tags, created_at: c.created_at });
  });
  const dupPhones = Object.entries(phoneMap)
    .filter(([, rows]) => rows.length > 1)
    .map(([phone, rows]) => ({ phone, count: rows.length, clients: rows }));

  // ── Duplicate sessions (same client_id + session_date) ────────────
  const sessKeyMap = {};
  sessions.forEach(s => {
    if (!s.client_id || !s.session_date) return;
    const key = `${s.client_id}::${s.session_date}`;
    if (!sessKeyMap[key]) sessKeyMap[key] = [];
    sessKeyMap[key].push({ id: s.id, client_id: s.client_id, client_name: s.client_name, service: s.service, session_date: s.session_date, status: s.status, payment_status: s.payment_status, source: s.source, created_at: s.created_at });
  });
  const dupSessions = Object.entries(sessKeyMap)
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ client_id: key.split('::')[0], session_date: key.split('::')[1], count: rows.length, sessions: rows }));

  // ── Sessions missing state scores (completed) ─────────────────────
  const completedSessions = sessions.filter(s => s.status === 'completed');
  const missingState = completedSessions.filter(s => s.state_before == null || s.state_after == null)
    .map(s => ({
      id: s.id, client_id: s.client_id, client_name: s.client_name,
      service: s.service, session_date: s.session_date, status: s.status,
      state_before: s.state_before, state_after: s.state_after,
      source: s.source, seller_notes: (s.seller_notes || '').slice(0, 80),
      created_at: s.created_at,
    }));

  // ── Stale pending sessions (> 90 days, never completed) ──────────
  const stalePending = sessions.filter(s =>
    s.status === 'pending' &&
    s.session_date &&
    new Date(s.session_date) < new Date(staleThreshold)
  ).map(s => ({
    id: s.id, client_id: s.client_id, client_name: s.client_name,
    service: s.service, session_date: s.session_date, status: s.status,
    payment_status: s.payment_status, source: s.source,
    seller_notes: (s.seller_notes || '').slice(0, 80),
    created_at: s.created_at,
    daysOld: Math.floor((now - new Date(s.session_date)) / 86400000),
  }));

  // ── Test / QA data detection ──────────────────────────────────────
  const QA_TAGS = ['qa', 'test', 'seed', 'demo'];
  const QA_NAMES = /qa|test|seed|demo|sample|fake|automation|workflow.audit/i;
  const testClients = clients.filter(c => {
    const tags = (c.tags || []).map(t => (t || '').toLowerCase());
    return QA_TAGS.some(q => tags.includes(q)) || QA_NAMES.test(c.full_name || '');
  }).map(c => ({ id: c.id, full_name: c.full_name, email: c.email, tags: c.tags, created_at: c.created_at }));

  const testClientIdSet = new Set(testClients.map(c => c.id));
  const testSessions = sessions.filter(s =>
    testClientIdSet.has(s.client_id) || QA_NAMES.test(s.client_name || '') || QA_NAMES.test(s.seller_notes || '')
  ).map(s => ({ id: s.id, client_id: s.client_id, client_name: s.client_name, session_date: s.session_date, status: s.status, source: s.source }));

  const testRecs = recs.filter(r => testClientIdSet.has(r.client_id))
    .map(r => ({ id: r.id, client_id: r.client_id, product_name: r.product_name }));

  const testAftercate = aftercare.filter(a => testClientIdSet.has(a.client_id))
    .map(a => ({ id: a.id, client_id: a.client_id, client_name: a.client_name, followup_type: a.followup_type, status: a.status }));

  // ── Orphaned records ──────────────────────────────────────────────
  const orphanedSessions = sessions.filter(s => s.client_id && !clientIdSet.has(s.client_id))
    .map(s => ({ id: s.id, client_id: s.client_id, client_name: s.client_name, session_date: s.session_date }));

  const orphanedRecs = recs.filter(r => r.client_id && !clientIdSet.has(r.client_id))
    .map(r => ({ id: r.id, client_id: r.client_id, product_name: r.product_name }));

  const orphanedAftercate = aftercare.filter(a => a.client_id && !clientIdSet.has(a.client_id))
    .map(a => ({ id: a.id, client_id: a.client_id, client_name: a.client_name }));

  const orphanedAftercareSession = aftercare.filter(a => a.session_id && !sessionIdSet.has(a.session_id))
    .map(a => ({ id: a.id, session_id: a.session_id, client_name: a.client_name }));

  // ── Clients with issues ───────────────────────────────────────────
  const blankNames = clients.filter(c => !(c.full_name || '').trim())
    .map(c => ({ id: c.id, email: c.email, phone: c.phone, created_at: c.created_at }));

  const noContact = clients.filter(c => !c.email && !c.phone && c.status !== 'archived')
    .map(c => ({ id: c.id, full_name: c.full_name, source: c.source, created_at: c.created_at }));

  // ── Recommendations missing outcomes ─────────────────────────────
  const ALLOWED_OUTCOMES = ['purchased', 'tried', 'helpful', 'not_helpful', 'declined'];
  const recsNoOutcome = recs.filter(r => !r.outcome_status || r.outcome_status === 'recommended')
    .map(r => ({ id: r.id, client_id: r.client_id, product_name: r.product_name, recommended_at: r.recommended_at, created_at: r.created_at }));

  const recsPurchasedNoFeedback = recs.filter(r => {
    if (r.outcome_status !== 'purchased' && r.outcome_status !== 'tried') return false;
    const age = (now - new Date(r.recommended_at || r.created_at)) / 86400000;
    return age > 30;
  }).map(r => ({
    id: r.id, client_id: r.client_id, product_name: r.product_name,
    outcome_status: r.outcome_status, recommended_at: r.recommended_at,
    daysOld: Math.floor((now - new Date(r.recommended_at || r.created_at)) / 86400000),
  }));

  // ── Intake quality ────────────────────────────────────────────────
  const unmatchedIntakes = intakes.filter(i => !i.processed || i.match_status === 'unmatched')
    .map(i => ({ id: i.id, full_name: i.full_name, email: i.email, phone: i.phone, match_status: i.match_status, processed: i.processed, created_at: i.created_at }));

  const intakeEmailMap = {};
  intakes.forEach(i => {
    if (!i.email) return;
    const key = i.email.toLowerCase();
    if (!intakeEmailMap[key]) intakeEmailMap[key] = [];
    intakeEmailMap[key].push(i);
  });
  const dupIntakes = Object.entries(intakeEmailMap)
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({ email, count: rows.length, ids: rows.map(r => r.id) }));

  // ── Analytics impact summary ──────────────────────────────────────
  const validState = completedSessions.filter(s =>
    s.state_before != null && s.state_after != null &&
    s.state_before >= 1 && s.state_before <= 5 &&
    s.state_after  >= 1 && s.state_after  <= 5
  );
  const validRecs = recs.filter(r => ALLOWED_OUTCOMES.includes(r.outcome_status));
  const nonTestCompleted = completedSessions.filter(s => !testClientIdSet.has(s.client_id));
  const nonTestValidState = validState.filter(s => !testClientIdSet.has(s.client_id));

  const analyticsReadiness = {
    outcomeAnalytics: nonTestValidState.length >= 3 ? 'Healthy' : nonTestValidState.length > 0 ? 'Limited' : 'Insufficient',
    recommendationAnalytics: validRecs.length >= 3 ? 'Healthy' : validRecs.length > 0 ? 'Limited' : 'Insufficient',
    retentionAnalytics: 'See retention section',
    effectiveSampleSizes: {
      completedSessions: completedSessions.length,
      completedNonTest: nonTestCompleted.length,
      sessionsWithValidState: validState.length,
      sessionsWithValidStateNonTest: nonTestValidState.length,
      recsWithOutcome: validRecs.length,
      totalRecommendations: recs.length,
    },
  };

  return {
    generatedAt: now.toISOString(),
    counts: {
      clients: clients.length, sessions: sessions.length, recommendations: recs.length,
      aftercare: aftercare.length, intakes: intakes.length, notes: notes.length,
    },
    duplicates: { emails: dupEmails, phones: dupPhones, sessions: dupSessions, intakes: dupIntakes },
    sessions: { missingState, stalePending, orphaned: orphanedSessions },
    clients: { blankNames, noContact },
    recommendations: { noOutcome: recsNoOutcome, purchasedNoFeedback: recsPurchasedNoFeedback, orphaned: orphanedRecs },
    aftercare: { orphanedClient: orphanedAftercate, orphanedSession: orphanedAftercareSession },
    intakes: { unmatched: unmatchedIntakes, duplicates: dupIntakes },
    testData: { clients: testClients, sessions: testSessions, recommendations: testRecs, aftercare: testAftercate },
    analyticsReadiness,
  };
}
