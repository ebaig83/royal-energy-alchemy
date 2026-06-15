// /.netlify/functions/reporting
//
// GET ?section=tax_monthly[&year=YYYY]             — monthly revenue breakdown for tax filing
// GET ?section=tax_annual[&year=YYYY]              — annual totals (revenue, expenses, net)
// GET ?section=tax_by_service[&year=YYYY]          — revenue grouped by service type
// GET ?section=expenses_deductible[&year=YYYY]     — deductible expense list
// GET ?section=annual_summary[&year=YYYY]          — full-year metrics: clients, sessions, outcomes
// GET ?section=practitioner_performance[&year=YYYY]— session volume, avg revenue, completion rate
// GET ?section=research_metrics                    — patterns, case studies, insights counts
// GET ?section=content_metrics                     — KB articles, books, content studio pipeline
// GET ?section=export_log                          — recent report exports
//
// POST ?action=log_export — record a report export in report_exports

'use strict';

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');

function isMissingTableError(err) {
  if (!err) return false;
  const code = err.code || '';
  const msg  = err.message || '';
  return (
    code === '42P01' || code === 'PGRST204' || code === 'PGRST200' || code === 'PGRST116' ||
    msg.includes('does not exist') || msg.includes('Could not find') || msg.includes('schema cache')
  );
}

function currentYear() { return new Date().getFullYear(); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = requireAdmin(event);
  if (auth.error) return respond(auth.status, { error: auth.error });

  const sb     = getClient();
  const params = Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
  const year   = parseInt(params.year || currentYear(), 10);

  // ── GET ───────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section || 'annual_summary';
    try {
      switch (section) {
        case 'tax_monthly':           return respond(200, await getTaxMonthly(sb, year));
        case 'tax_annual':            return respond(200, await getTaxAnnual(sb, year));
        case 'tax_by_service':        return respond(200, await getTaxByService(sb, year));
        case 'expenses_deductible':   return respond(200, await getExpensesDeductible(sb, year));
        case 'annual_summary':        return respond(200, await getAnnualSummary(sb, year));
        case 'practitioner_performance': return respond(200, await getPractitionerPerformance(sb, year));
        case 'research_metrics':      return respond(200, await getResearchMetrics(sb));
        case 'content_metrics':       return respond(200, await getContentMetrics(sb));
        case 'export_log':            return respond(200, await getExportLog(sb));
        default: return respond(400, { error: `Unknown section: ${section}` });
      }
    } catch (err) {
      console.error('[reporting] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'log_export') return respond(201, await logExport(sb, body));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[reporting] POST', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ═══════════════════════════════════════════════════════════════════════════
// TAX REPORTING
// ═══════════════════════════════════════════════════════════════════════════

async function getTaxMonthly(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data: sessions, error: sErr } = await sb
    .from('sessions')
    .select('id, session_date, amount_due, payment_status, service, status')
    .gte('session_date', start)
    .lte('session_date', end)
    .not('status', 'eq', 'cancelled');

  if (sErr && !isMissingTableError(sErr)) throw new Error(sErr.message);

  const rows = sessions || [];

  // Build month buckets
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return { month: `${year}-${m}`, label: new Date(`${year}-${m}-01`).toLocaleString('en-US', { month: 'long' }), revenue: 0, sessions: 0, paid: 0, unpaid: 0 };
  });

  for (const s of rows) {
    const m = s.session_date?.slice(0, 7); // 'YYYY-MM'
    const bucket = months.find(b => b.month === m);
    if (!bucket) continue;
    const amt = parseFloat(s.amount_due) || 0;
    bucket.sessions++;
    bucket.revenue += amt;
    if (s.payment_status === 'paid') bucket.paid += amt;
    else bucket.unpaid += amt;
  }

  const totalRevenue  = months.reduce((s, m) => s + m.revenue, 0);
  const totalSessions = months.reduce((s, m) => s + m.sessions, 0);

  return { year, months, totals: { revenue: totalRevenue, sessions: totalSessions } };
}

async function getTaxAnnual(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const [sessRes, expRes] = await Promise.all([
    sb.from('sessions').select('amount_due, payment_status, status')
      .gte('session_date', start).lte('session_date', end).not('status', 'eq', 'cancelled'),
    sb.from('expenses').select('amount, is_deductible, category')
      .gte('expense_date', start).lte('expense_date', end),
  ]);

  const sessions  = sessRes.data  || [];
  const expenses  = expRes.error && isMissingTableError(expRes.error) ? [] : (expRes.data || []);

  const grossRevenue    = sessions.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const collectedRev    = sessions.filter(r => r.payment_status === 'paid').reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const totalExpenses   = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const deductibleExp   = expenses.filter(e => e.is_deductible).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const netIncome       = collectedRev - deductibleExp;

  return {
    year,
    gross_revenue:      grossRevenue,
    collected_revenue:  collectedRev,
    uncollected:        grossRevenue - collectedRev,
    total_expenses:     totalExpenses,
    deductible_expenses: deductibleExp,
    net_taxable_income: netIncome,
    session_count:      sessions.length,
  };
}

async function getTaxByService(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data, error } = await sb
    .from('sessions')
    .select('service, amount_due, payment_status, status')
    .gte('session_date', start)
    .lte('session_date', end)
    .not('status', 'eq', 'cancelled');

  if (error && !isMissingTableError(error)) throw new Error(error.message);

  const rows = data || [];
  const byService = {};

  for (const s of rows) {
    const key = s.service || 'Unspecified';
    if (!byService[key]) byService[key] = { service: key, sessions: 0, revenue: 0, paid: 0 };
    byService[key].sessions++;
    const amt = parseFloat(s.amount_due) || 0;
    byService[key].revenue += amt;
    if (s.payment_status === 'paid') byService[key].paid += amt;
  }

  const services = Object.values(byService).sort((a, b) => b.revenue - a.revenue);
  return { year, services, total_services: services.length };
}

async function getExpensesDeductible(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data, error } = await sb
    .from('expenses')
    .select('id, expense_date, category, description, amount, is_deductible, vendor, receipt_url')
    .gte('expense_date', start)
    .lte('expense_date', end)
    .eq('is_deductible', true)
    .order('expense_date', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return { year, expenses: [], total: 0, migration_needed: true };
    throw new Error(error.message);
  }

  const expenses = data || [];
  const total    = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const byCategory = {};
  for (const e of expenses) {
    const cat = e.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, total: 0 };
    byCategory[cat].count++;
    byCategory[cat].total += parseFloat(e.amount) || 0;
  }

  return { year, expenses, total, by_category: Object.values(byCategory).sort((a, b) => b.total - a.total) };
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE REPORTING
// ═══════════════════════════════════════════════════════════════════════════

async function getAnnualSummary(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const [sessRes, clientRes, intakeRes, aftercareRes] = await Promise.all([
    sb.from('sessions').select('id, status, payment_status, amount_due, service, session_date, source')
      .gte('session_date', start).lte('session_date', end),
    sb.from('clients').select('id, created_at')
      .gte('created_at', start + 'T00:00:00').lte('created_at', end + 'T23:59:59'),
    sb.from('intake_submissions').select('id, created_at').gte('created_at', start).lte('created_at', end),
    sb.from('aftercare').select('id, check_in_type, intensity_after').gte('created_at', start).lte('created_at', end),
  ]);

  const sessions  = sessRes.data  || [];
  const clients   = clientRes.data  && !isMissingTableError(clientRes.error)  ? clientRes.data  : [];
  const intakes   = intakeRes.data  && !isMissingTableError(intakeRes.error)  ? intakeRes.data  : [];
  const aftercare = aftercareRes.data && !isMissingTableError(aftercareRes.error) ? aftercareRes.data : [];

  const completed   = sessions.filter(s => s.status === 'completed');
  const cancelled   = sessions.filter(s => s.status === 'cancelled');
  const revenue     = completed.reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const collected   = completed.filter(s => s.payment_status === 'paid').reduce((s, r) => s + (parseFloat(r.amount_due) || 0), 0);
  const avgPerSession = completed.length ? revenue / completed.length : 0;

  return {
    year,
    sessions: {
      total: sessions.length,
      completed: completed.length,
      cancelled: cancelled.length,
      completion_rate: sessions.length ? Math.round(completed.length / sessions.length * 100) : 0,
    },
    revenue: {
      gross: revenue,
      collected,
      collection_rate: revenue ? Math.round(collected / revenue * 100) : 0,
      avg_per_session: Math.round(avgPerSession * 100) / 100,
    },
    clients: {
      new_this_year: clients.length,
    },
    intakes:   intakes.length,
    followups: aftercare.length,
    checkin_types: aftercare.reduce((acc, a) => {
      const t = a.check_in_type || 'unknown';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function getPractitionerPerformance(sb, year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const { data, error } = await sb
    .from('sessions')
    .select('id, session_date, service, status, payment_status, amount_due, duration_minutes, location_type, source')
    .gte('session_date', start)
    .lte('session_date', end)
    .order('session_date', { ascending: false });

  if (error && !isMissingTableError(error)) throw new Error(error.message);

  const sessions  = data || [];
  const completed = sessions.filter(s => s.status === 'completed');

  const byMonth = {};
  for (const s of completed) {
    const m = s.session_date?.slice(0, 7);
    if (!m) continue;
    if (!byMonth[m]) byMonth[m] = { month: m, sessions: 0, revenue: 0, minutes: 0 };
    byMonth[m].sessions++;
    byMonth[m].revenue  += parseFloat(s.amount_due) || 0;
    byMonth[m].minutes  += parseInt(s.duration_minutes) || 0;
  }

  const byService = {};
  for (const s of completed) {
    const svc = s.service || 'Unspecified';
    if (!byService[svc]) byService[svc] = { service: svc, sessions: 0, revenue: 0 };
    byService[svc].sessions++;
    byService[svc].revenue += parseFloat(s.amount_due) || 0;
  }

  const bySource = {};
  for (const s of sessions) {
    const src = s.source || 'direct';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const totalMinutes     = completed.reduce((s, r) => s + (parseInt(r.duration_minutes) || 0), 0);
  const avgSessionLength = completed.length ? Math.round(totalMinutes / completed.length) : 0;
  const remoteCount      = completed.filter(s => s.location_type === 'remote').length;
  const inPersonCount    = completed.filter(s => s.location_type === 'in-person').length;

  return {
    year,
    total_sessions:     sessions.length,
    completed_sessions: completed.length,
    completion_rate:    sessions.length ? Math.round(completed.length / sessions.length * 100) : 0,
    total_hours:        Math.round(totalMinutes / 60 * 10) / 10,
    avg_session_length_minutes: avgSessionLength,
    delivery: { remote: remoteCount, in_person: inPersonCount },
    by_month:   Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
    by_service: Object.values(byService).sort((a, b) => b.revenue - a.revenue),
    by_source:  bySource,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH & CONTENT METRICS
// ═══════════════════════════════════════════════════════════════════════════

async function getResearchMetrics(sb) {
  const [patternsRes, insightsRes, caseStudiesRes, outcomesRes, flagsRes] = await Promise.all([
    sb.from('patterns').select('id, confidence_level, pattern_type, created_at').order('created_at', { ascending: false }),
    sb.from('healing_insights').select('id, category, created_at').order('created_at', { ascending: false }),
    sb.from('case_studies').select('id, outcome_score, created_at').order('created_at', { ascending: false }),
    sb.from('session_outcomes').select('id, outcome_rating, created_at'),
    sb.from('research_flags').select('id, status, severity, created_at').order('created_at', { ascending: false }),
  ]);

  const safe = (res) => (res.error && isMissingTableError(res.error)) ? [] : (res.data || []);

  const patterns    = safe(patternsRes);
  const insights    = safe(insightsRes);
  const caseStudies = safe(caseStudiesRes);
  const outcomes    = safe(outcomesRes);
  const flags       = safe(flagsRes);

  const avgConfidence = patterns.length
    ? patterns.reduce((s, p) => s + (parseFloat(p.confidence_level) || 0), 0) / patterns.length
    : 0;

  const avgOutcome = outcomes.length
    ? outcomes.reduce((s, o) => s + (parseFloat(o.outcome_rating) || 0), 0) / outcomes.length
    : 0;

  const patternsByType = patterns.reduce((acc, p) => {
    const t = p.pattern_type || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const openFlags = flags.filter(f => f.status === 'open' || !f.status);

  return {
    patterns:    { total: patterns.length,    avg_confidence: Math.round(avgConfidence * 100) / 100, by_type: patternsByType },
    insights:    { total: insights.length },
    case_studies:{ total: caseStudies.length  },
    outcomes:    { total: outcomes.length,    avg_rating: Math.round(avgOutcome * 100) / 100 },
    flags:       { total: flags.length,       open: openFlags.length },
    recent_patterns:    patterns.slice(0, 5),
    recent_case_studies: caseStudies.slice(0, 5),
  };
}

async function getContentMetrics(sb) {
  const [kbRes, booksRes, scriptRes, calRes] = await Promise.all([
    sb.from('kb_entries').select('id, status, category, created_at').is('deleted_at', null),
    sb.from('healing_books').select('id, status, type, created_at'),
    sb.from('content_scripts').select('id, status, created_at'),
    sb.from('content_calendar').select('id, status, platform, scheduled_date'),
  ]);

  const safe = (res) => (res.error && isMissingTableError(res.error)) ? [] : (res.data || []);

  const kb      = safe(kbRes);
  const books   = safe(booksRes);
  const scripts = safe(scriptRes);
  const cal     = safe(calRes);

  const kbByStatus = kb.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
  const booksByStatus = books.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
  const calByPlatform = cal.reduce((acc, e) => { acc[e.platform] = (acc[e.platform] || 0) + 1; return acc; }, {});

  const scheduled = cal.filter(c => c.status === 'scheduled' || c.status === 'approved');
  const published = cal.filter(c => c.status === 'published');

  return {
    knowledge_base: { total: kb.length,    by_status: kbByStatus },
    books:          { total: books.length,  by_status: booksByStatus },
    scripts:        { total: scripts.length },
    content_calendar: {
      total:     cal.length,
      scheduled: scheduled.length,
      published: published.length,
      by_platform: calByPlatform,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT LOG
// ═══════════════════════════════════════════════════════════════════════════

async function getExportLog(sb) {
  const { data, error } = await sb
    .from('report_exports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(50);

  if (error) {
    if (isMissingTableError(error)) return { exports: [], migration_needed: true };
    throw new Error(error.message);
  }
  return { exports: data || [] };
}

async function logExport(sb, body) {
  if (!body.report_type) throw new Error('report_type is required.');

  const { data, error } = await sb
    .from('report_exports')
    .insert({
      report_type:  body.report_type,
      report_period: body.report_period || null,
      parameters:   body.parameters    || null,
      row_count:    body.row_count      || null,
      generated_by: body.generated_by  || 'daron',
      notes:        body.notes          || null,
    })
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) return { logged: false, migration_needed: true };
    throw new Error(error.message);
  }
  return { logged: true, export: data };
}
