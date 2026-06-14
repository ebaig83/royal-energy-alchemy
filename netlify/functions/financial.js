// /.netlify/functions/financial
//
// GET  ?section=overview          — dashboard KPIs (revenue, outstanding, packages)
// GET  ?section=packages          — all packages
// GET  ?section=packages&client_id=uuid — packages for one client
// GET  ?section=ledger            — full ledger history
// GET  ?section=ledger&client_id=uuid   — ledger for one client
// GET  ?section=invoices          — all invoices
// GET  ?section=invoices&client_id=uuid — invoices for one client
// GET  ?section=revenue           — revenue analytics
// GET  ?section=alerts            — unread financial alerts
// GET  ?section=client_summary&client_id=uuid — full financial profile for client
//
// ── Bookkeeping Lite (Sprint 1) ──────────────────────────────────────────────
// GET  ?section=expenses                            — all expenses (filterable)
// GET  ?section=expenses&category=supplies          — filter by category
// GET  ?section=expenses&tax_deductible=true        — tax-deductible only
// GET  ?section=expenses&from=YYYY-MM-DD&to=YYYY-MM-DD — date range
// GET  ?section=expenses_summary                    — KPI aggregates (month/YTD/by category)
// GET  ?section=pnl                                 — 12-month P&L (revenue vs expenses)
// GET  ?section=schema_validation                   — Sprint 1 table schema checks (columns/indexes/FKs/grants/RLS)
//
// POST ?action=create_package     — create a package record (auto-creates ledger charge)
// POST ?action=use_session        — link a session to a package (burns 1 usage)
// POST ?action=create_ledger      — manual ledger entry
// POST ?action=create_invoice     — create a draft invoice (auto-creates ledger charges)
// POST ?action=add_invoice_item   — add line item to invoice
// POST ?action=record_payment     — record payment → ledger payment entry + update invoice
// POST ?action=generate_alerts    — scan packages/invoices and write financial alerts
// POST ?action=create_expense     — create expense record
//
// PATCH ?action=update_package&id=uuid   — edit package fields
// PATCH ?action=update_invoice&id=uuid   — change invoice status / notes
// PATCH ?action=mark_alert_read&id=uuid  — dismiss a financial alert
// PATCH ?action=update_expense&id=uuid   — edit expense fields
// PATCH ?action=delete_expense&id=uuid   — soft-delete expense (sets deleted_at)

const { requireAdmin, respond } = require('./lib/auth');
const { getClient }             = require('./lib/supabase');
const { log }                   = require('./lib/audit');

// ── Package type catalogue ────────────────────────────────────────────────
const PACKAGE_TYPES = {
  single:      { name: 'Single Session',     sessions: 1  },
  '3_session': { name: '3 Session Package',  sessions: 3  },
  '5_session': { name: '5 Session Package',  sessions: 5  },
  '10_session':{ name: '10 Session Package', sessions: 10 },
  custom:      { name: 'Custom Package',     sessions: null },
};

// ── Safe query helper — returns [] / null when a table does not yet exist ─
// Handles both Postgres 42P01 (undefined_table) and PostgREST PGRST204
// (schema cache miss) so the dashboard works before Daron runs the migration.
function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg  = String(error.message || '');
  return (
    code === '42P01'   ||   // Postgres: undefined_table
    code === 'PGRST204'||   // PostgREST: schema cache miss (table not in schema cache)
    code === 'PGRST200'||   // PostgREST: relationship not found
    msg.includes('does not exist') ||
    msg.includes('Could not find') ||
    msg.includes('schema cache')
  );
}

async function safeRows(query, fallback = []) {
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return fallback;
    throw new Error(error.message);
  }
  return data || fallback;
}

async function safeOne(query, fallback = null) {
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return fallback;
    throw new Error(error.message);
  }
  return data || fallback;
}

function userErr(msg) { const e = new Error(msg); e.name = 'UserError'; return e; }

// ── Invoice number: timestamp-based, collision-resistant ─────────────────
async function nextInvoiceNumber(sb) {
  const year = new Date().getFullYear();
  let existing = 0;
  try {
    const { count } = await sb
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', `${year}-01-01`);
    existing = count || 0;
  } catch {}
  return `INV-${year}-${String(existing + 1).padStart(3, '0')}`;
}

// ── Ledger write helper — centralises all ledger creation ────────────────
// Called by every function that moves money. Non-fatal if ledger table
// does not exist yet (pre-migration). Audit-logged.
async function writeLedger(sb, entry) {
  try {
    const { data, error } = await sb.from('ledger_entries').insert({
      client_id:          entry.client_id          || null,
      client_name:        entry.client_name        || null,
      entry_type:         entry.entry_type,
      description:        entry.description,
      amount:             Math.abs(parseFloat(entry.amount)),
      balance_impact:     parseFloat(entry.balance_impact),
      related_session_id: entry.related_session_id || null,
      related_payment_id: entry.related_payment_id || null,
      related_package_id: entry.related_package_id || null,
      invoice_id:         entry.invoice_id         || null,
      entry_date:         entry.entry_date         || new Date().toISOString().slice(0, 10),
      notes:              entry.notes              || null,
      created_by:         entry.created_by         || 'daron',
    }).select().single();
    if (error && error.code !== '42P01') throw error;
    return data || null;
  } catch (err) {
    // Never let a ledger write failure break the main operation
    console.error('[financial] ledger write failed:', err.message);
    return null;
  }
}

// ── Financial alert upsert (one active alert per type+client+package) ────
async function upsertFinancialAlert(sb, alert) {
  try {
    // Check for an existing unread alert of same type for this client+package
    let existQuery = sb
      .from('financial_alerts')
      .select('id')
      .eq('alert_type', alert.alert_type)
      .eq('is_read', false)
      .eq('client_id', alert.client_id || null);

    if (alert.related_package_id) {
      existQuery = existQuery.eq('related_package_id', alert.related_package_id);
    }

    const { data: existing, error: exErr } = await existQuery.maybeSingle();
    if (exErr && exErr.code !== '42P01') {
      console.warn('[financial] alert check error:', exErr.message);
      return;
    }
    if (existing) return; // already exists — don't duplicate

    await sb.from('financial_alerts').insert({
      client_id:          alert.client_id          || null,
      client_name:        alert.client_name        || null,
      alert_type:         alert.alert_type,
      severity:           alert.severity           || 'medium',
      title:              alert.title,
      body:               alert.body               || null,
      related_package_id: alert.related_package_id || null,
      related_invoice_id: alert.related_invoice_id || null,
      is_read:            false,
    });
  } catch (err) {
    if (err.code !== '42P01') console.error('[financial] alert upsert failed:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════════
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  const sb     = getClient();
  const params = event.queryStringParameters || {};
  const ip     = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

  // ── GET ───────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const section = params.section;
    if (!section) return respond(400, { error: 'section is required.' });
    try {
      if (section === 'overview')          return respond(200, await getOverview(sb));
      if (section === 'packages')          return respond(200, await getPackages(sb, params));
      if (section === 'ledger')            return respond(200, await getLedger(sb, params));
      if (section === 'invoices')          return respond(200, await getInvoices(sb, params));
      if (section === 'revenue')           return respond(200, await getRevenue(sb));
      if (section === 'alerts')            return respond(200, await getAlerts(sb));
      if (section === 'client_summary')    return respond(200, await getClientSummary(sb, params));
      // ── Bookkeeping Lite ─────────────────────────────────────────────────
      if (section === 'expenses')          return respond(200, await getExpenses(sb, params));
      if (section === 'expenses_summary')  return respond(200, await getExpensesSummary(sb));
      if (section === 'pnl')               return respond(200, await getPnL(sb));
      // ── Schema Validation ────────────────────────────────────────────────
      if (section === 'schema_validation') return respond(200, await validateSprint1Schema(sb));
      return respond(400, { error: `Unknown section: ${section}` });
    } catch (err) {
      console.error('[financial] GET', section, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    try {
      if (action === 'create_package')   return respond(201, await createPackage(sb, body, auth, ip));
      if (action === 'use_session')      return respond(200, await useSession(sb, body, auth, ip));
      if (action === 'create_ledger')    return respond(201, await createLedgerEntry(sb, body, auth, ip));
      if (action === 'create_invoice')   return respond(201, await createInvoice(sb, body, auth, ip));
      if (action === 'add_invoice_item') return respond(201, await addInvoiceItem(sb, body, auth, ip));
      if (action === 'record_payment')   return respond(200, await recordPayment(sb, body, auth, ip));
      if (action === 'generate_alerts')  return respond(200, await generateAlerts(sb, auth, ip));
      // ── Bookkeeping Lite ────────────────────────────────────────────────
      if (action === 'create_expense')   return respond(201, await createExpense(sb, body, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[financial] POST', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid JSON.' }); }
    const action = params.action;
    const id     = params.id;
    if (!id) return respond(400, { error: 'id is required.' });
    try {
      if (action === 'update_package')  return respond(200, await updatePackage(sb, id, body, auth, ip));
      if (action === 'update_invoice')  return respond(200, await updateInvoice(sb, id, body, auth, ip));
      if (action === 'mark_alert_read') return respond(200, await markAlertRead(sb, id, auth, ip));
      // ── Bookkeeping Lite ────────────────────────────────────────────────
      if (action === 'update_expense')  return respond(200, await updateExpense(sb, id, body, auth, ip));
      if (action === 'delete_expense')  return respond(200, await deleteExpense(sb, id, auth, ip));
      return respond(400, { error: `Unknown action: ${action}` });
    } catch (err) {
      if (err.name === 'UserError') return respond(400, { error: err.message });
      console.error('[financial] PATCH', action, err.message);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed.' });
};

// ═════════════════════════════════════════════════════════════════════════
// GET SECTION HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function getOverview(sb) {
  const now   = new Date();
  const y     = now.getFullYear();
  const m     = String(now.getMonth() + 1).padStart(2, '0');

  // Existing tables — always available
  const [sessRes, payRes] = await Promise.all([
    sb.from('sessions').select('id, amount_due, amount_paid, payment_status, session_date, status'),
    sb.from('payments').select('amount, paid_at, status'),
  ]);
  if (sessRes.error) throw new Error('sessions: ' + sessRes.error.message);
  if (payRes.error)  throw new Error('payments: ' + payRes.error.message);

  const sessions = sessRes.data || [];
  const payments = payRes.data  || [];

  // New financial tables — graceful fallback if migration not yet run
  const [packages, ledger, invoices, alerts] = await Promise.all([
    safeRows(sb.from('packages').select('*').is('deleted_at', null)),
    safeRows(sb.from('ledger_entries').select('entry_type,amount,balance_impact,entry_date').is('deleted_at', null).order('entry_date', { ascending: false }).limit(500)),
    safeRows(sb.from('invoices').select('id,status,total,amount_paid,due_date').is('deleted_at', null)),
    safeRows(sb.from('financial_alerts').select('id').eq('is_read', false)),
  ]);

  // Revenue from payments table (existing)
  const totalRevenue   = payments.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.amount), 0);
  const monthlyRevenue = payments
    .filter(p => p.status === 'received' && (p.paid_at || '').startsWith(`${y}-${m}`))
    .reduce((s, p) => s + Number(p.amount), 0);

  // Outstanding = sum of unpaid/partial sessions
  const outstanding = sessions
    .filter(s => ['unpaid', 'partial'].includes(s.payment_status) && s.status !== 'cancelled')
    .reduce((s, sess) => s + Math.max(0, Number(sess.amount_due || 0) - Number(sess.amount_paid || 0)), 0);

  // Package metrics
  const activePackages  = packages.filter(p => p.status === 'active').length;
  const expiringSoon    = packages.filter(p => {
    if (p.status !== 'active' || !p.expiration_date) return false;
    const days = (new Date(p.expiration_date + 'T12:00:00') - now) / 86400000;
    return days >= 0 && days <= 14;
  }).length;
  const packageRevenue  = packages.reduce((s, p) => s + Number(p.purchase_price || 0), 0);
  const usedSessions    = packages.reduce((s, p) => s + Number(p.sessions_used || 0), 0);
  const totalSessions   = packages.reduce((s, p) => s + Number(p.sessions_included || 0), 0);
  const utilizationRate = totalSessions > 0 ? Math.round((usedSessions / totalSessions) * 100) : 0;

  // Invoice metrics
  const overdue           = invoices.filter(inv => inv.status === 'overdue' ||
    (inv.status === 'sent' && inv.due_date && new Date(inv.due_date + 'T12:00:00') < now)).length;
  const outstandingInvAmt = invoices
    .filter(inv => ['sent', 'partial', 'overdue'].includes(inv.status))
    .reduce((s, inv) => s + Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)), 0);
  const paidThisMonth     = invoices
    .filter(inv => inv.status === 'paid' && (inv.due_date || '').startsWith(`${y}-${m}`))
    .reduce((s, inv) => s + Number(inv.total || 0), 0);

  return {
    revenue: { total: totalRevenue, monthly: monthlyRevenue, outstanding, packageRevenue },
    packages: { active: activePackages, expiringSoon, utilizationRate, totalPackages: packages.length },
    invoices: { overdue, outstanding: outstandingInvAmt, paidThisMonth },
    alerts:   { unread: alerts.length },
    _migration_needed: packages.length === 0 && invoices.length === 0 && ledger.length === 0,
  };
}

async function getPackages(sb, params) {
  let q = sb.from('packages').select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (params.client_id) q = q.eq('client_id', params.client_id);
  if (params.status)    q = q.eq('status', params.status);
  const packages = await safeRows(q);
  return { packages, package_types: PACKAGE_TYPES };
}

async function getLedger(sb, params) {
  let q = sb.from('ledger_entries')
    .select('*')
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (params.client_id) q = q.eq('client_id', params.client_id);
  if (params.type)      q = q.eq('entry_type', params.type);
  if (params.from)      q = q.gte('entry_date', params.from);
  if (params.to)        q = q.lte('entry_date', params.to);
  q = q.limit(params.limit ? parseInt(params.limit) : 300);

  const entries = await safeRows(q);

  const totalCharges  = entries.filter(e => e.entry_type === 'charge')
                               .reduce((s, e) => s + Number(e.amount), 0);
  const totalPayments = entries.filter(e => ['payment', 'credit'].includes(e.entry_type))
                               .reduce((s, e) => s + Number(e.amount), 0);
  const runningBalance = entries.reduce((s, e) => s + Number(e.balance_impact || 0), 0);

  return { entries, totals: { charges: totalCharges, payments: totalPayments, balance: runningBalance } };
}

async function getInvoices(sb, params) {
  let q = sb.from('invoices')
    .select('*, invoice_items(*)')
    .is('deleted_at', null)
    .order('issue_date', { ascending: false });
  if (params.client_id) q = q.eq('client_id', params.client_id);
  if (params.status)    q = q.eq('status', params.status);
  const invoices = await safeRows(q);
  return { invoices };
}

async function getRevenue(sb) {
  const now = new Date();

  const [payments, sessions, packages] = await Promise.all([
    safeRows(sb.from('payments').select('amount, method, paid_at, status, client_id').eq('status', 'received').order('paid_at', { ascending: false }).limit(500)),
    safeRows(sb.from('sessions').select('service, amount_due, amount_paid, payment_status, session_date, status')),
    safeRows(sb.from('packages').select('package_type,package_name,purchase_price,sessions_included,sessions_used,status,purchase_date').is('deleted_at', null)),
  ]);

  // Monthly revenue last 12 months
  const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
    const d   = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rev = payments.filter(p => (p.paid_at || '').startsWith(key))
                        .reduce((s, p) => s + Number(p.amount), 0);
    return { month: key, revenue: rev };
  });

  // Revenue by payment method
  const byMethod = {};
  payments.forEach(p => {
    const m = p.method || 'unknown';
    byMethod[m] = (byMethod[m] || 0) + Number(p.amount);
  });

  // Revenue by service (completed sessions)
  const byService = {};
  sessions.filter(s => s.status === 'completed').forEach(s => {
    const svc = s.service || 'General';
    if (!byService[svc]) byService[svc] = { sessions: 0, revenue: 0 };
    byService[svc].sessions++;
    byService[svc].revenue += Number(s.amount_paid || 0);
  });

  // Average client value
  const clientTotals = {};
  payments.forEach(p => {
    const id = p.client_id || '_unknown';
    clientTotals[id] = (clientTotals[id] || 0) + Number(p.amount);
  });
  const totalRevenue   = payments.reduce((s, p) => s + Number(p.amount), 0);
  const clientCount    = Object.keys(clientTotals).length;
  const avgClientValue = clientCount > 0 ? Math.round((totalRevenue / clientCount) * 100) / 100 : 0;

  // Package metrics
  const completedPkgs  = packages.filter(p => p.status === 'completed').length;
  const totalPkgs      = packages.length;
  const completionRate = totalPkgs > 0 ? Math.round((completedPkgs / totalPkgs) * 100) : 0;
  const unusedValue    = packages.filter(p => p.status === 'active').reduce((s, p) => {
    const rem = Number(p.sessions_included) - Number(p.sessions_used);
    return rem > 0 && Number(p.sessions_included) > 0
      ? s + (rem / Number(p.sessions_included)) * Number(p.purchase_price || 0)
      : s;
  }, 0);

  return {
    totalRevenue,
    monthlyBreakdown,
    byMethod,
    byService,
    packages: { completionRate, unusedValue, totalPackages: totalPkgs, completed: completedPkgs },
    avgClientValue,
  };
}

async function getAlerts(sb) {
  const alerts = await safeRows(
    sb.from('financial_alerts')
      .select('*')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50)
  );
  return { alerts, count: alerts.length };
}

async function getClientSummary(sb, params) {
  if (!params.client_id) throw new Error('client_id is required.');
  const cid = params.client_id;

  const [clientRes, packages, ledger, invoices, sessions] = await Promise.all([
    sb.from('clients').select('id, full_name, email, phone, status').eq('id', cid).single(),
    safeRows(sb.from('packages').select('*').eq('client_id', cid).is('deleted_at', null).order('created_at', { ascending: false })),
    safeRows(sb.from('ledger_entries').select('*').eq('client_id', cid).is('deleted_at', null).order('entry_date', { ascending: false }).limit(50)),
    safeRows(sb.from('invoices').select('*, invoice_items(*)').eq('client_id', cid).is('deleted_at', null).order('issue_date', { ascending: false })),
    safeRows(sb.from('sessions').select('id, session_date, service, payment_status, amount_due, amount_paid, status').eq('client_id', cid).order('session_date', { ascending: false }).limit(20)),
  ]);

  if (clientRes.error) throw new Error('Client not found.');

  // Running balance from ledger
  const currentBalance    = ledger.reduce((s, e) => s + Number(e.balance_impact || 0), 0);
  const creditsAvailable  = ledger.filter(e => e.entry_type === 'credit').reduce((s, e) => s + Number(e.amount), 0);
  const outstandingCharges = sessions
    .filter(s => ['unpaid', 'partial'].includes(s.payment_status) && s.status !== 'cancelled')
    .reduce((s, sess) => s + Math.max(0, Number(sess.amount_due || 0) - Number(sess.amount_paid || 0)), 0);
  const activePackage = packages.find(p => p.status === 'active') || null;
  const totalCharges  = ledger.filter(e => e.entry_type === 'charge').reduce((s, e) => s + Number(e.amount), 0);
  const totalPayments = ledger.filter(e => ['payment', 'credit'].includes(e.entry_type)).reduce((s, e) => s + Number(e.amount), 0);

  return {
    client: clientRes.data,
    financial: { currentBalance, creditsAvailable, outstandingCharges, totalCharges, totalPayments, activePackage },
    packages,
    ledger,
    invoices,
    recentSessions: sessions,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// POST ACTION HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function createPackage(sb, body, auth, ip) {
  if (!body.client_id)    throw new Error('client_id is required.');
  if (!body.package_type) throw new Error('package_type is required.');

  const typeDef = PACKAGE_TYPES[body.package_type];
  if (!typeDef) throw new Error(`Invalid package_type. Valid values: ${Object.keys(PACKAGE_TYPES).join(', ')}`);

  const sessionsIncluded = Number(body.sessions_included) || typeDef.sessions || 1;
  const packageName      = (body.package_name || typeDef.name || 'Custom Package').trim();
  const purchasePrice    = parseFloat(body.purchase_price || 0);
  const purchaseDate     = body.purchase_date || new Date().toISOString().slice(0, 10);

  const insert = {
    client_id:         body.client_id,
    client_name:       (body.client_name || '').trim() || null,
    package_type:      body.package_type,
    package_name:      packageName,
    sessions_included: sessionsIncluded,
    sessions_used:     0,
    purchase_date:     purchaseDate,
    expiration_date:   body.expiration_date || null,
    purchase_price:    purchasePrice,
    status:            'active',
    notes:             body.notes || null,
    created_by:        auth.user.email || 'daron',
  };

  const { data: pkg, error } = await sb.from('packages').insert(insert).select().single();
  if (error) throw new Error(error.message);

  // ── Ledger: charge for the package purchase ──────────────────────────
  if (purchasePrice > 0) {
    await writeLedger(sb, {
      client_id:          body.client_id,
      client_name:        insert.client_name,
      entry_type:         'charge',
      description:        `Package purchase: ${packageName}`,
      amount:             purchasePrice,
      balance_impact:     purchasePrice,   // charge → increases balance owed
      related_package_id: pkg.id,
      entry_date:         purchaseDate,
      created_by:         auth.user.email || 'daron',
    });
  }

  await log({ actor: auth.user.email, action: 'created', tableName: 'packages', recordId: pkg.id, newData: pkg,
    context: `Created ${packageName} for ${insert.client_name || body.client_id}`, ip });
  return { package: pkg };
}

async function useSession(sb, body, auth, ip) {
  if (!body.package_id) throw new Error('package_id is required.');

  const { data: pkg, error: pkgErr } = await sb.from('packages').select('*').eq('id', body.package_id).single();
  if (pkgErr || !pkg) throw new Error('Package not found.');
  if (pkg.status !== 'active') throw new Error('Package is not active.');
  if (pkg.sessions_used >= pkg.sessions_included) throw new Error('Package has no sessions remaining.');

  const newUsed   = pkg.sessions_used + 1;
  const newStatus = newUsed >= pkg.sessions_included ? 'completed' : 'active';

  const { data: updated, error: upErr } = await sb.from('packages')
    .update({ sessions_used: newUsed, status: newStatus })
    .eq('id', body.package_id)
    .select().single();
  if (upErr) throw new Error(upErr.message);

  // Record session use in junction table
  if (body.session_id) {
    await sb.from('package_sessions')
      .insert({ package_id: body.package_id, session_id: body.session_id })
      .catch(err => { if (err.code !== '42P01') console.error('[financial] pkg_sessions insert:', err.message); });
  }

  // Alert when 1 session remains
  const remaining = pkg.sessions_included - newUsed;
  if (remaining === 1) {
    await upsertFinancialAlert(sb, {
      client_id:          pkg.client_id,
      client_name:        pkg.client_name,
      alert_type:         'package_low',
      severity:           'high',
      title:              `1 session remaining — ${pkg.package_name}`,
      body:               `${pkg.client_name || 'Client'} has only 1 session remaining in their ${pkg.package_name}. Consider discussing renewal.`,
      related_package_id: pkg.id,
    });
  }

  await log({ actor: auth.user.email, action: 'updated', tableName: 'packages', recordId: pkg.id, newData: updated,
    context: `Used 1 session from ${pkg.package_name} (session: ${body.session_id || 'unlinked'})`, ip });
  return { package: updated, sessions_remaining: remaining };
}

async function createLedgerEntry(sb, body, auth, ip) {
  if (!body.client_id)   throw new Error('client_id is required.');
  if (!body.entry_type)  throw new Error('entry_type is required.');
  if (!body.description) throw new Error('description is required.');
  if (body.amount == null || isNaN(body.amount)) throw new Error('amount is required.');

  const VALID_TYPES = ['charge', 'payment', 'credit', 'refund', 'adjustment', 'write_off'];
  if (!VALID_TYPES.includes(body.entry_type)) throw new Error(`entry_type must be one of: ${VALID_TYPES.join(', ')}`);

  const amount = Math.abs(parseFloat(body.amount));
  // charge → positive impact (increases what client owes)
  // everything else → negative impact (reduces balance)
  const impact = body.entry_type === 'charge' ? amount : -amount;

  const entry = await writeLedger(sb, {
    client_id:          body.client_id,
    client_name:        body.client_name         || null,
    entry_type:         body.entry_type,
    description:        body.description,
    amount,
    balance_impact:     body.balance_impact != null ? parseFloat(body.balance_impact) : impact,
    related_session_id: body.related_session_id  || null,
    related_payment_id: body.related_payment_id  || null,
    related_package_id: body.related_package_id  || null,
    invoice_id:         body.invoice_id          || null,
    entry_date:         body.entry_date          || new Date().toISOString().slice(0, 10),
    notes:              body.notes               || null,
    created_by:         auth.user.email          || 'daron',
  });

  if (!entry) throw new Error('Ledger table not yet created. Run the financial-ops SQL migration first.');

  await log({ actor: auth.user.email, action: 'created', tableName: 'ledger_entries', recordId: entry.id, newData: entry,
    context: `Ledger ${body.entry_type}: $${amount} for ${body.client_name || body.client_id}`, ip });
  return { entry };
}

async function createInvoice(sb, body, auth, ip) {
  if (!body.client_id) throw new Error('client_id is required.');

  const invoiceNumber = await nextInvoiceNumber(sb);
  const subtotal      = parseFloat(body.subtotal || 0);
  const adjustment    = parseFloat(body.adjustment || 0);

  const insert = {
    invoice_number: invoiceNumber,
    client_id:      body.client_id,
    client_name:    (body.client_name || '').trim() || null,
    issue_date:     body.issue_date || new Date().toISOString().slice(0, 10),
    due_date:       body.due_date   || null,
    subtotal,
    adjustment,
    amount_paid:    0,
    status:         'draft',
    notes:          body.notes      || null,
    created_by:     auth.user.email || 'daron',
  };

  const { data: invoice, error } = await sb.from('invoices').insert(insert).select().single();
  if (error) throw new Error(error.message);

  // Create line items if passed inline
  let finalSubtotal = subtotal;
  if (Array.isArray(body.items) && body.items.length > 0) {
    const itemInserts = body.items.map(item => ({
      invoice_id:  invoice.id,
      description: item.description,
      quantity:    parseInt(item.quantity) || 1,
      unit_price:  parseFloat(item.unit_price || 0),
      session_id:  item.session_id || null,
      package_id:  item.package_id || null,
    }));
    const { error: itemErr } = await sb.from('invoice_items').insert(itemInserts);
    if (itemErr) console.error('[financial] invoice_items insert:', itemErr.message);

    finalSubtotal = itemInserts.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
    await sb.from('invoices').update({ subtotal: finalSubtotal }).eq('id', invoice.id);
    invoice.subtotal = finalSubtotal;
    invoice.total    = finalSubtotal + adjustment;
  }

  // ── Ledger: charge entry for each invoice item (or the invoice total) ─
  const chargeAmount = finalSubtotal + adjustment;
  if (chargeAmount > 0) {
    await writeLedger(sb, {
      client_id:    body.client_id,
      client_name:  insert.client_name,
      entry_type:   'charge',
      description:  `Invoice ${invoiceNumber}`,
      amount:       chargeAmount,
      balance_impact: chargeAmount,
      invoice_id:   invoice.id,
      entry_date:   insert.issue_date,
      created_by:   auth.user.email || 'daron',
    });
  }

  await log({ actor: auth.user.email, action: 'created', tableName: 'invoices', recordId: invoice.id, newData: invoice,
    context: `Created invoice ${invoiceNumber} for ${insert.client_name || body.client_id}`, ip });
  return { invoice };
}

async function addInvoiceItem(sb, body, auth, ip) {
  if (!body.invoice_id)       throw new Error('invoice_id is required.');
  if (!body.description)      throw new Error('description is required.');
  if (body.unit_price == null) throw new Error('unit_price is required.');

  const insert = {
    invoice_id:  body.invoice_id,
    description: body.description,
    quantity:    parseInt(body.quantity  || 1),
    unit_price:  parseFloat(body.unit_price),
    session_id:  body.session_id  || null,
    package_id:  body.package_id  || null,
  };

  const { data: item, error } = await sb.from('invoice_items').insert(insert).select().single();
  if (error) throw new Error(error.message);

  // Recalculate invoice subtotal
  const { data: allItems } = await sb.from('invoice_items').select('quantity, unit_price').eq('invoice_id', body.invoice_id);
  const subtotal = (allItems || []).reduce((s, i) => s + (i.quantity * i.unit_price), 0);
  await sb.from('invoices').update({ subtotal }).eq('id', body.invoice_id);

  return { item, subtotal };
}

async function recordPayment(sb, body, auth, ip) {
  // Records a payment → creates ledger entry → updates invoice balance
  if (!body.client_id)                    throw new Error('client_id is required.');
  if (body.amount == null || isNaN(body.amount)) throw new Error('amount is required.');

  const amount    = parseFloat(body.amount);
  const entryDate = body.payment_date || new Date().toISOString().slice(0, 10);

  // ── Ledger: payment entry ──────────────────────────────────────────────
  const entry = await writeLedger(sb, {
    client_id:          body.client_id,
    client_name:        body.client_name       || null,
    entry_type:         'payment',
    description:        body.description || 'Payment received',
    amount,
    balance_impact:     -amount,               // payment reduces balance owed
    related_session_id: body.session_id        || null,
    related_payment_id: body.payment_id        || null,
    invoice_id:         body.invoice_id        || null,
    entry_date:         entryDate,
    notes:              body.notes             || null,
    created_by:         auth.user.email        || 'daron',
  });

  // ── Invoice: update amount_paid and status ─────────────────────────────
  let invoice = null;
  if (body.invoice_id) {
    let inv = null;
    try { const { data } = await sb.from('invoices').select('*').eq('id', body.invoice_id).single(); inv = data; } catch {}
    if (inv) {
      const newPaid   = Number(inv.amount_paid || 0) + amount;
      const total     = Number(inv.total || 0);
      const newStatus = newPaid >= total && total > 0 ? 'paid' : newPaid > 0 ? 'partial' : inv.status;
      const upd       = { amount_paid: newPaid, status: newStatus };
      if (newStatus === 'paid') upd.paid_at = new Date().toISOString();
      const { data: updated } = await sb.from('invoices').update(upd).eq('id', body.invoice_id).select().single();
      invoice = updated;
    }
  }

  await log({ actor: auth.user.email, action: 'created', tableName: 'ledger_entries', recordId: entry?.id, newData: entry,
    context: `Payment $${amount} from ${body.client_name || body.client_id}`, ip });
  return { entry, invoice };
}

async function generateAlerts(sb, auth, ip) {
  const now   = new Date();
  const in14  = new Date(now.getTime() + 14 * 86400000);
  const generated = [];

  // Packages expiring within 14 days
  const expiring = await safeRows(
    sb.from('packages')
      .select('*')
      .eq('status', 'active')
      .not('expiration_date', 'is', null)
      .lte('expiration_date', in14.toISOString().slice(0, 10))
      .gte('expiration_date', now.toISOString().slice(0, 10))
  );
  for (const pkg of expiring) {
    const daysLeft = Math.ceil((new Date(pkg.expiration_date + 'T12:00:00') - now) / 86400000);
    await upsertFinancialAlert(sb, {
      client_id:          pkg.client_id,
      client_name:        pkg.client_name,
      alert_type:         'package_expiring',
      severity:           daysLeft <= 3 ? 'critical' : 'high',
      title:              `Package expiring in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — ${pkg.package_name}`,
      body:               `${pkg.client_name || 'Client'}'s ${pkg.package_name} expires on ${pkg.expiration_date}. ${pkg.sessions_remaining ?? (pkg.sessions_included - pkg.sessions_used)} session(s) remaining.`,
      related_package_id: pkg.id,
    });
    generated.push({ type: 'package_expiring', client: pkg.client_name, package: pkg.package_name });
  }

  // Packages already expired but still marked active
  const expired = await safeRows(
    sb.from('packages')
      .select('*')
      .eq('status', 'active')
      .not('expiration_date', 'is', null)
      .lt('expiration_date', now.toISOString().slice(0, 10))
  );
  for (const pkg of expired) {
    try { await sb.from('packages').update({ status: 'expired' }).eq('id', pkg.id); } catch {}
    await upsertFinancialAlert(sb, {
      client_id:          pkg.client_id,
      client_name:        pkg.client_name,
      alert_type:         'package_expired',
      severity:           'medium',
      title:              `Package expired — ${pkg.package_name}`,
      body:               `${pkg.client_name || 'Client'}'s ${pkg.package_name} expired on ${pkg.expiration_date}. Consider reaching out about renewal.`,
      related_package_id: pkg.id,
    });
    generated.push({ type: 'package_expired', client: pkg.client_name });
  }

  // Invoices past due date → mark overdue and alert
  const overdueInvs = await safeRows(
    sb.from('invoices')
      .select('*')
      .in('status', ['sent', 'partial'])
      .not('due_date', 'is', null)
      .lt('due_date', now.toISOString().slice(0, 10))
  );
  for (const inv of overdueInvs) {
    try { await sb.from('invoices').update({ status: 'overdue' }).eq('id', inv.id); } catch {}
    const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
    await upsertFinancialAlert(sb, {
      client_id:         inv.client_id,
      client_name:       inv.client_name,
      alert_type:        'invoice_overdue',
      severity:          'high',
      title:             `Invoice overdue — ${inv.invoice_number}`,
      body:              `Invoice ${inv.invoice_number} for ${inv.client_name || 'client'} was due ${inv.due_date}. Outstanding: $${balance.toFixed(2)}`,
      related_invoice_id: inv.id,
    });
    generated.push({ type: 'invoice_overdue', invoice: inv.invoice_number });
  }

  await log({ actor: auth.user.email, action: 'created', tableName: 'financial_alerts', recordId: null,
    newData: { count: generated.length }, context: `Generated ${generated.length} financial alert(s)`, ip });
  return { generated: generated.length, alerts: generated };
}

// ═════════════════════════════════════════════════════════════════════════
// PATCH ACTION HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function updatePackage(sb, id, body, auth, ip) {
  const allowed = ['package_name', 'expiration_date', 'purchase_price', 'status', 'notes'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
  const { data, error } = await sb.from('packages').update(updates).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  await log({ actor: auth.user.email, action: 'updated', tableName: 'packages', recordId: id, newData: data, ip });
  return { package: data };
}

async function updateInvoice(sb, id, body, auth, ip) {
  const allowed = ['status', 'notes', 'due_date', 'sent_at', 'paid_at', 'adjustment'];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
  if (updates.status === 'sent' && !updates.sent_at) updates.sent_at = new Date().toISOString();
  const { data, error } = await sb.from('invoices').update(updates).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  await log({ actor: auth.user.email, action: 'updated', tableName: 'invoices', recordId: id, newData: data, ip });
  return { invoice: data };
}

async function markAlertRead(sb, id, auth, ip) {
  const { data, error } = await sb.from('financial_alerts')
    .update({ is_read: true, resolved_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return { alert: data };
}

// ═════════════════════════════════════════════════════════════════════════
// SPRINT 1 SCHEMA VALIDATION
// ═════════════════════════════════════════════════════════════════════════
//
// Full contract per table: column presence, NOT NULL, defaults,
// CHECK constraints, FK constraints, indexes, grants, RLS.
//
// column_contracts: { name, not_null, default_contains }
//   default_contains — case-insensitive substring match on column_default.
//   null means "no default required" (not checked).
// check_constraints: expected constraint names (from pg_constraint.conname)
// fk_columns:        column names that must have a FK constraint
//                    (matched by constraint name containing the column name)
// indexes:           expected index names in pg_indexes
// grants:            privilege_type values service_role must have
//
// All checks degrade gracefully when information_schema / pg_catalog are
// not exposed by PostgREST — they return WARN rather than crashing.
// ─────────────────────────────────────────────────────────────────────────

const SPRINT1_SCHEMA = {
  expenses: {
    column_contracts: [
      { name: 'id',                 not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'expense_date',       not_null: true,  default_contains: 'current_date'   },
      { name: 'category',           not_null: true,  default_contains: null             },
      { name: 'description',        not_null: true,  default_contains: null             },
      { name: 'amount',             not_null: true,  default_contains: null             },
      { name: 'vendor',             not_null: false, default_contains: null             },
      { name: 'payment_method',     not_null: true,  default_contains: 'personal'       },
      { name: 'tax_deductible',     not_null: true,  default_contains: 'false'          },
      { name: 'receipt_url',        not_null: false, default_contains: null             },
      { name: 'related_session_id', not_null: false, default_contains: null             },
      { name: 'notes',              not_null: false, default_contains: null             },
      { name: 'created_by',         not_null: true,  default_contains: 'daron'          },
      { name: 'created_at',         not_null: true,  default_contains: 'now()'          },
      { name: 'updated_at',         not_null: true,  default_contains: 'now()'          },
      { name: 'deleted_at',         not_null: false, default_contains: null             },
    ],
    check_constraints: [
      'expenses_category_check',
      'expenses_payment_method_check',
      'expenses_amount_positive',
    ],
    fk_columns: ['related_session_id'],
    indexes:    ['expenses_date_idx','expenses_category_idx','expenses_tax_idx',
                 'expenses_deleted_idx','expenses_session_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  research_notes: {
    column_contracts: [
      { name: 'id',         not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',      not_null: true,  default_contains: null             },
      { name: 'content',    not_null: false, default_contains: null             },
      { name: 'source_url', not_null: false, default_contains: null             },
      { name: 'tags',       not_null: false, default_contains: null             },
      { name: 'session_id', not_null: false, default_contains: null             },
      { name: 'visibility', not_null: true,  default_contains: 'private'        },
      { name: 'client_id',  not_null: false, default_contains: null             },
      { name: 'created_by', not_null: true,  default_contains: 'daron'          },
      { name: 'created_at', not_null: true,  default_contains: 'now()'          },
      { name: 'updated_at', not_null: true,  default_contains: 'now()'          },
      { name: 'deleted_at', not_null: false, default_contains: null             },
    ],
    check_constraints: ['research_notes_visibility_check'],
    fk_columns: [],
    indexes:    ['research_notes_created_idx','research_notes_deleted_idx','research_notes_tags_idx','research_notes_client_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  kb_entries: {
    column_contracts: [
      { name: 'id',         not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',      not_null: true,  default_contains: null             },
      { name: 'content',    not_null: false, default_contains: null             },
      { name: 'summary',    not_null: false, default_contains: null             },
      { name: 'category',   not_null: false, default_contains: null             },
      { name: 'tags',       not_null: false, default_contains: null             },
      { name: 'is_pinned',  not_null: true,  default_contains: 'false'          },
      { name: 'fts',        not_null: false, default_contains: null             },
      { name: 'status',     not_null: true,  default_contains: 'draft'          },
      { name: 'created_by', not_null: true,  default_contains: 'daron'          },
      { name: 'created_at', not_null: true,  default_contains: 'now()'          },
      { name: 'updated_at', not_null: true,  default_contains: 'now()'          },
      { name: 'deleted_at', not_null: false, default_contains: null             },
    ],
    check_constraints: ['kb_entries_status_check'],
    fk_columns: [],
    indexes:    ['kb_entries_fts_idx','kb_entries_category_idx','kb_entries_status_idx',
                 'kb_entries_pinned_idx','kb_entries_deleted_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  content_ideas: {
    column_contracts: [
      { name: 'id',             not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',          not_null: true,  default_contains: null             },
      { name: 'content_type',   not_null: true,  default_contains: null             },
      { name: 'source_type',    not_null: false, default_contains: null             },
      { name: 'source_ids',        not_null: false, default_contains: null             },
      { name: 'topic',             not_null: false, default_contains: null             },
      { name: 'summary',           not_null: false, default_contains: null             },
      { name: 'status',            not_null: true,  default_contains: 'draft'          },
      { name: 'scheduled_date',    not_null: false, default_contains: null             },
      { name: 'internal_score',    not_null: false, default_contains: null             },
      { name: 'market_score',      not_null: false, default_contains: null             },
      { name: 'educational_score', not_null: false, default_contains: null             },
      { name: 'business_score',    not_null: false, default_contains: null             },
      { name: 'priority',          not_null: false, default_contains: null             },
      { name: 'created_by',        not_null: true,  default_contains: 'daron'          },
      { name: 'created_at',        not_null: true,  default_contains: 'now()'          },
      { name: 'updated_at',        not_null: true,  default_contains: 'now()'          },
      { name: 'deleted_at',        not_null: false, default_contains: null             },
    ],
    check_constraints: ['content_ideas_content_type_check', 'content_ideas_status_check', 'content_ideas_priority_check'],
    fk_columns: [],
    indexes:    ['ci_status_idx','ci_content_type_idx','ci_scheduled_idx','ci_deleted_idx','ci_created_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  content_sources: {
    column_contracts: [
      { name: 'id',               not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'source_type',      not_null: true,  default_contains: null              },
      { name: 'source_title',     not_null: true,  default_contains: null              },
      { name: 'source_url',       not_null: false, default_contains: null              },
      { name: 'source_summary',   not_null: false, default_contains: null              },
      { name: 'source_tags',      not_null: false, default_contains: null              },
      { name: 'source_date',      not_null: false, default_contains: null              },
      { name: 'relevance_score',  not_null: false, default_contains: '5'               },
      { name: 'created_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',       not_null: false, default_contains: null              },
    ],
    check_constraints: ['content_sources_type_check', 'content_sources_score_check'],
    fk_columns: [],
    indexes:    ['cs_type_idx','cs_score_idx','cs_deleted_idx','cs_date_idx','cs_tags_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  content_drafts: {
    column_contracts: [
      { name: 'id',                not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'content_idea_id',   not_null: false, default_contains: null              },
      { name: 'title',             not_null: true,  default_contains: null              },
      { name: 'content_type',      not_null: true,  default_contains: null              },
      { name: 'draft_content',     not_null: false, default_contains: null              },
      { name: 'source_ids',        not_null: true,  default_contains: '[]'              },
      { name: 'generation_method', not_null: false, default_contains: null              },
      { name: 'status',            not_null: true,  default_contains: 'draft'           },
      { name: 'created_by',        not_null: true,  default_contains: 'daron'           },
      { name: 'created_at',        not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',        not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',        not_null: false, default_contains: null              },
    ],
    check_constraints: ['content_drafts_status_check','content_drafts_type_check','content_drafts_method_check'],
    fk_columns: [],
    indexes:    ['cd_status_idx','cd_type_idx','cd_idea_idx','cd_deleted_idx','cd_created_idx','cd_source_ids_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  training_modules: {
    column_contracts: [
      { name: 'id',                   not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',                not_null: true,  default_contains: null              },
      { name: 'summary',              not_null: false, default_contains: null              },
      { name: 'module_type',          not_null: true,  default_contains: 'onboarding'      },
      { name: 'source_ids',           not_null: true,  default_contains: '[]'              },
      { name: 'content_draft_id',     not_null: false, default_contains: null              },
      { name: 'difficulty_level',     not_null: true,  default_contains: 'beginner'        },
      { name: 'estimated_duration',   not_null: false, default_contains: null              },
      { name: 'status',               not_null: true,  default_contains: 'draft'           },
      { name: 'learning_objectives',  not_null: true,  default_contains: '[]'              },
      { name: 'key_concepts',         not_null: true,  default_contains: '[]'              },
      { name: 'discussion_questions', not_null: true,  default_contains: '[]'              },
      { name: 'module_content',       not_null: false, default_contains: null              },
      { name: 'created_by',           not_null: true,  default_contains: 'daron'           },
      { name: 'created_at',           not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',           not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',           not_null: false, default_contains: null              },
    ],
    check_constraints: ['tm_type_check','tm_difficulty_check','tm_status_check'],
    fk_columns: [],
    indexes:    ['tm_status_idx','tm_type_idx','tm_difficulty_idx','tm_deleted_idx','tm_created_idx','tm_source_ids_idx','tm_objectives_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  learning_paths: {
    column_contracts: [
      { name: 'id',                 not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',              not_null: true,  default_contains: null              },
      { name: 'description',        not_null: false, default_contains: null              },
      { name: 'path_type',          not_null: true,  default_contains: 'practitioner'    },
      { name: 'module_ids',         not_null: true,  default_contains: '[]'              },
      { name: 'status',             not_null: true,  default_contains: 'draft'           },
      { name: 'estimated_duration', not_null: false, default_contains: null              },
      { name: 'created_by',         not_null: true,  default_contains: 'daron'           },
      { name: 'created_at',         not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',         not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',         not_null: false, default_contains: null              },
    ],
    check_constraints: ['lp_type_check','lp_status_check'],
    fk_columns: [],
    indexes:    ['lp_status_idx','lp_type_idx','lp_deleted_idx','lp_created_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },
  training_certifications: {
    column_contracts: [
      { name: 'id',               not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'title',            not_null: true,  default_contains: null              },
      { name: 'description',      not_null: false, default_contains: null              },
      { name: 'required_modules', not_null: true,  default_contains: '{}'             },
      { name: 'status',           not_null: true,  default_contains: 'draft'           },
      { name: 'created_by',       not_null: true,  default_contains: 'daron'           },
      { name: 'created_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',       not_null: false, default_contains: null              },
    ],
    check_constraints: ['tcert_status_check'],
    fk_columns: [],
    indexes:    ['tcert_status_idx','tcert_deleted_idx','tcert_created_idx'],
    grants:     ['SELECT','INSERT','UPDATE','DELETE'],
  },

  // ── Sprint 8: Practitioner Network ─────────────────────────────────────────
  practitioners: {
    column_contracts: [
      { name: 'id',                  not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'name',                not_null: true,  default_contains: null              },
      { name: 'email',               not_null: false, default_contains: null              },
      { name: 'phone',               not_null: false, default_contains: null              },
      { name: 'location',            not_null: false, default_contains: null              },
      { name: 'specialties',         not_null: true,  default_contains: '{}'             },
      { name: 'bio',                 not_null: false, default_contains: null              },
      { name: 'status',              not_null: true,  default_contains: 'applied'         },
      { name: 'application_date',    not_null: false, default_contains: 'CURRENT_DATE'    },
      { name: 'approval_date',       not_null: false, default_contains: null              },
      { name: 'certification_level', not_null: true,  default_contains: 'none'            },
      { name: 'directory_visible',   not_null: true,  default_contains: 'false'           },
      { name: 'created_at',          not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',          not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',          not_null: false, default_contains: null              },
    ],
    check_constraints: ['pn_status_check','pn_cert_level_check'],
    fk_columns:        [],
    indexes:           ['pn_status_idx','pn_email_idx','pn_deleted_idx','pn_specialties_idx','pn_directory_idx','pn_created_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },

  practitioner_applications: {
    column_contracts: [
      { name: 'id',               not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'practitioner_id',  not_null: false, default_contains: null              },
      { name: 'application_text', not_null: false, default_contains: null              },
      { name: 'experience',       not_null: false, default_contains: null              },
      { name: 'training_history', not_null: false, default_contains: null              },
      { name: 'references',       not_null: false, default_contains: null              },
      { name: 'review_notes',     not_null: false, default_contains: null              },
      { name: 'status',           not_null: true,  default_contains: 'pending'         },
      { name: 'created_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',       not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',       not_null: false, default_contains: null              },
    ],
    check_constraints: ['pa_status_check'],
    fk_columns:        ['practitioner_id'],
    indexes:           ['pa_practitioner_idx','pa_status_idx','pa_deleted_idx','pa_created_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },

  practitioner_certifications: {
    column_contracts: [
      { name: 'id',                        not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'practitioner_id',           not_null: false, default_contains: null              },
      { name: 'training_certification_id', not_null: false, default_contains: null              },
      { name: 'completion_date',           not_null: false, default_contains: null              },
      { name: 'expiration_date',           not_null: false, default_contains: null              },
      { name: 'status',                    not_null: true,  default_contains: 'active'          },
      { name: 'created_at',               not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',               not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',               not_null: false, default_contains: null              },
    ],
    check_constraints: ['pc_status_check'],
    fk_columns:        ['practitioner_id'],
    indexes:           ['pc_practitioner_idx','pc_cert_idx','pc_status_idx','pc_deleted_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },

  practitioner_referrals: {
    column_contracts: [
      { name: 'id',              not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'client_id',       not_null: false, default_contains: null              },
      { name: 'practitioner_id', not_null: false, default_contains: null              },
      { name: 'reason',          not_null: false, default_contains: null              },
      { name: 'status',          not_null: true,  default_contains: 'pending'         },
      { name: 'created_at',      not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',      not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',      not_null: false, default_contains: null              },
    ],
    check_constraints: ['pr_status_check'],
    fk_columns:        ['practitioner_id'],
    indexes:           ['pr_client_idx','pr_practitioner_idx','pr_status_idx','pr_deleted_idx','pr_created_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },

  // ── Sprint 9: Lead Pipeline ────────────────────────────────────────────────
  referral_sources: {
    column_contracts: [
      { name: 'id',           not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'name',         not_null: true,  default_contains: null              },
      { name: 'source_type',  not_null: true,  default_contains: 'other'           },
      { name: 'contact_info', not_null: false, default_contains: null              },
      { name: 'notes',        not_null: false, default_contains: null              },
      { name: 'active',       not_null: true,  default_contains: 'true'            },
      { name: 'created_at',   not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',   not_null: true,  default_contains: 'now()'           },
    ],
    check_constraints: ['rs_type_check'],
    fk_columns:        [],
    indexes:           ['rs_type_idx','rs_active_idx','rs_created_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },

  leads: {
    column_contracts: [
      { name: 'id',                  not_null: true,  default_contains: 'gen_random_uuid' },
      { name: 'first_name',          not_null: true,  default_contains: null              },
      { name: 'last_name',           not_null: false, default_contains: null              },
      { name: 'email',               not_null: false, default_contains: null              },
      { name: 'phone',               not_null: false, default_contains: null              },
      { name: 'source',              not_null: true,  default_contains: 'other'           },
      { name: 'source_detail',       not_null: false, default_contains: null              },
      { name: 'referral_source_id',  not_null: false, default_contains: null              },
      { name: 'interested_service',  not_null: false, default_contains: null              },
      { name: 'status',              not_null: true,  default_contains: 'new'             },
      { name: 'notes',               not_null: false, default_contains: null              },
      { name: 'assigned_to',         not_null: false, default_contains: null              },
      { name: 'first_contact_date',  not_null: false, default_contains: null              },
      { name: 'last_contact_date',   not_null: false, default_contains: null              },
      { name: 'converted_client_id', not_null: false, default_contains: null              },
      { name: 'converted_at',        not_null: false, default_contains: null              },
      { name: 'converted_service',   not_null: false, default_contains: null              },
      { name: 'converted_revenue',   not_null: false, default_contains: null              },
      { name: 'contact_count',       not_null: true,  default_contains: '0'              },
      { name: 'created_at',          not_null: true,  default_contains: 'now()'           },
      { name: 'updated_at',          not_null: true,  default_contains: 'now()'           },
      { name: 'deleted_at',          not_null: false, default_contains: null              },
    ],
    check_constraints: ['leads_status_check','leads_source_check'],
    fk_columns:        ['referral_source_id'],
    indexes:           ['leads_status_idx','leads_source_idx','leads_email_idx','leads_deleted_idx','leads_created_idx','leads_referral_idx','leads_converted_idx','leads_contact_idx'],
    grants:            ['SELECT','INSERT','UPDATE','DELETE'],
  },
};

async function validateSprint1Schema(sb) {
  const out = {};

  for (const [table, expected] of Object.entries(SPRINT1_SCHEMA)) {
    const r = {
      table,
      exists:                  false,
      // columns
      missing_columns:         [],
      wrong_nullable:          [],   // [{column, expected:'NOT NULL', actual:'nullable'}]
      wrong_default:           [],   // [{column, expected_contains, actual}]
      col_meta_available:      true,
      // constraints
      missing_check_constraints: [],
      missing_fks:             [],
      constraint_check_available: true,
      // indexes
      missing_indexes:         [],
      index_check_available:   true,
      // security
      missing_grants:          [],
      grant_check_available:   true,
      rls_enabled:             null,
      errors:                  [],
    };

    // ── 1. Table existence ──────────────────────────────────────────────────
    const { error: existErr } = await sb.from(table).select('id').limit(0);
    if (existErr) {
      if (isMissingTableError(existErr)) { out[table] = r; continue; }
      r.errors.push('table_check: ' + existErr.message.slice(0, 200));
      out[table] = r;
      continue;
    }
    r.exists = true;

    // ── 2. Column metadata: presence, NOT NULL, defaults ───────────────────
    // Primary: information_schema.columns (names + defaults + nullability).
    // Fallback: single SELECT probe (names only, from Postgres error message).
    const colNames = expected.column_contracts.map(c => c.name);

    const { data: colData, error: colMetaErr } = await sb
      .schema('information_schema')
      .from('columns')
      .select('column_name, column_default, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', table);

    if (!colMetaErr && Array.isArray(colData)) {
      const colMap = {};
      colData.forEach(c => { colMap[c.column_name] = c; });

      r.missing_columns = colNames.filter(name => !colMap[name]);

      expected.column_contracts.filter(c => colMap[c.name]).forEach(c => {
        const meta = colMap[c.name];
        if (c.not_null && meta.is_nullable !== 'NO') {
          r.wrong_nullable.push({ column: c.name, expected: 'NOT NULL', actual: 'nullable' });
        }
        if (c.default_contains) {
          const actual = (meta.column_default || '').toLowerCase();
          if (!actual.includes(c.default_contains.toLowerCase())) {
            r.wrong_default.push({
              column:            c.name,
              expected_contains: c.default_contains,
              actual:            meta.column_default || 'NULL',
            });
          }
        }
      });
    } else {
      r.col_meta_available = false;
      // Fallback: single SELECT probe — Postgres names the first missing column
      const { error: probeErr } = await sb
        .from(table)
        .select(colNames.join(', '))
        .limit(0);
      if (probeErr) {
        const match = probeErr.message.match(/column[s]?\s+"([^"]+)"/i);
        r.missing_columns = [match ? match[1] : probeErr.message.slice(0, 80)];
      }
    }

    // ── 3. CHECK constraints + FK constraints (information_schema) ──────────
    const { data: tcData, error: tcErr } = await sb
      .schema('information_schema')
      .from('table_constraints')
      .select('constraint_name, constraint_type')
      .eq('table_schema', 'public')
      .eq('table_name', table);

    if (!tcErr && Array.isArray(tcData)) {
      const names = tcData.map(c => c.constraint_name.toLowerCase());

      r.missing_check_constraints = expected.check_constraints
        .filter(name => !names.includes(name.toLowerCase()));

      if (expected.fk_columns.length > 0) {
        r.missing_fks = expected.fk_columns.filter(col =>
          !names.some(name => name.includes(col.toLowerCase()))
        );
      }
    } else {
      r.constraint_check_available = false;
    }

    // ── 4. Index check (pg_catalog.pg_indexes) ──────────────────────────────
    const { data: idxData, error: idxErr } = await sb
      .schema('pg_catalog')
      .from('pg_indexes')
      .select('indexname')
      .eq('schemaname', 'public')
      .eq('tablename', table);
    if (!idxErr && Array.isArray(idxData)) {
      const existing = idxData.map(i => i.indexname);
      r.missing_indexes = expected.indexes.filter(i => !existing.includes(i));
    } else {
      r.index_check_available = false;
    }

    // ── 5. Grant check (information_schema.role_table_grants) ───────────────
    const { data: grantData, error: grantErr } = await sb
      .schema('information_schema')
      .from('role_table_grants')
      .select('privilege_type')
      .eq('table_schema', 'public')
      .eq('table_name', table)
      .eq('grantee', 'service_role');
    if (!grantErr && Array.isArray(grantData)) {
      const existing = grantData.map(g => g.privilege_type);
      r.missing_grants = expected.grants.filter(g => !existing.includes(g));
    } else {
      r.grant_check_available = false;
    }

    // ── 6. RLS check (pg_catalog.pg_class) ──────────────────────────────────
    const { data: rlsData, error: rlsErr } = await sb
      .schema('pg_catalog')
      .from('pg_class')
      .select('relrowsecurity')
      .eq('relname', table)
      .maybeSingle();
    if (!rlsErr && rlsData) {
      r.rls_enabled = rlsData.relrowsecurity === true;
    }

    out[table] = r;
  }

  return { tables: out };
}

// ═════════════════════════════════════════════════════════════════════════
// BOOKKEEPING LITE — GET HANDLERS
// ═════════════════════════════════════════════════════════════════════════

const VALID_EXPENSE_CATEGORIES = [
  'supplies','marketing','education','software','professional','travel','other',
];

const VALID_PAYMENT_METHODS = [
  'personal','business','venmo','cash','check','card',
];

async function getExpenses(sb, params) {
  let q = sb.from('expenses')
    .select('*')
    .is('deleted_at', null)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (params.category)      q = q.eq('category', params.category);
  if (params.from)          q = q.gte('expense_date', params.from);
  if (params.to)            q = q.lte('expense_date', params.to);
  if (params.tax_deductible === 'true')  q = q.eq('tax_deductible', true);
  if (params.tax_deductible === 'false') q = q.eq('tax_deductible', false);

  const limit = params.limit ? parseInt(params.limit, 10) : 300;
  q = q.limit(limit);

  const expenses = await safeRows(q);

  const total   = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const taxDeductible = expenses.filter(e => e.tax_deductible)
                                .reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = {};
  for (const e of expenses) {
    const cat = e.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount);
  }

  return { expenses, totals: { total, taxDeductible, byCategory, count: expenses.length } };
}

async function getExpensesSummary(sb) {
  const now    = new Date();
  const y      = now.getFullYear();
  const m      = String(now.getMonth() + 1).padStart(2, '0');
  const ytdStart = `${y}-01-01`;
  const mStart   = `${y}-${m}-01`;

  const allExpenses = await safeRows(
    sb.from('expenses')
      .select('amount, category, tax_deductible, expense_date')
      .is('deleted_at', null)
      .gte('expense_date', ytdStart)
      .order('expense_date', { ascending: false })
  );

  const thisMonth = allExpenses.filter(e => e.expense_date >= mStart);
  const ytd       = allExpenses;

  const monthTotal = thisMonth.reduce((s, e) => s + Number(e.amount), 0);
  const ytdTotal   = ytd.reduce((s, e) => s + Number(e.amount), 0);
  const ytdTaxDeductible = ytd.filter(e => e.tax_deductible)
                              .reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = {};
  for (const e of ytd) {
    const cat = e.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + Number(e.amount);
  }

  return {
    thisMonth: monthTotal,
    ytd: ytdTotal,
    ytdTaxDeductible,
    byCategory,
    transactionCount: allExpenses.length,
  };
}

async function getPnL(sb) {
  const now    = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d   = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return key;
  });

  const earliest = months[0] + '-01';

  const [payments, expenses] = await Promise.all([
    safeRows(
      sb.from('payments')
        .select('amount, paid_at, status')
        .eq('status', 'received')
        .gte('paid_at', earliest)
        .order('paid_at', { ascending: false })
    ),
    safeRows(
      sb.from('expenses')
        .select('amount, expense_date, category, tax_deductible')
        .is('deleted_at', null)
        .gte('expense_date', earliest)
        .order('expense_date', { ascending: false })
    ),
  ]);

  const monthly = months.map(key => {
    const revenue = payments
      .filter(p => (p.paid_at || '').startsWith(key))
      .reduce((s, p) => s + Number(p.amount), 0);
    const expenseAmt = expenses
      .filter(e => (e.expense_date || '').startsWith(key))
      .reduce((s, e) => s + Number(e.amount), 0);
    return { month: key, revenue, expenses: expenseAmt, net: revenue - expenseAmt };
  });

  const totalRevenue  = payments.reduce((s, p) => s + Number(p.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netIncome     = totalRevenue - totalExpenses;

  const ytdStart  = `${now.getFullYear()}-01-01`;
  const ytdRev    = payments.filter(p => (p.paid_at || '') >= ytdStart)
                            .reduce((s, p) => s + Number(p.amount), 0);
  const ytdExp    = expenses.filter(e => (e.expense_date || '') >= ytdStart)
                            .reduce((s, e) => s + Number(e.amount), 0);
  const ytdNet    = ytdRev - ytdExp;

  return {
    monthly,
    totals: { revenue: totalRevenue, expenses: totalExpenses, net: netIncome },
    ytd:    { revenue: ytdRev, expenses: ytdExp, net: ytdNet },
  };
}

// ═════════════════════════════════════════════════════════════════════════
// BOOKKEEPING LITE — POST / PATCH HANDLERS
// ═════════════════════════════════════════════════════════════════════════

async function createExpense(sb, body, auth, ip) {
  if (!body.description?.trim())       throw userErr('description is required.');
  if (!body.category)                  throw userErr('category is required.');
  if (body.amount == null || isNaN(body.amount)) throw userErr('amount is required.');
  if (Number(body.amount) <= 0)        throw userErr('amount must be greater than 0.');

  if (!VALID_EXPENSE_CATEGORIES.includes(body.category))
    throw userErr(`category must be one of: ${VALID_EXPENSE_CATEGORIES.join(', ')}`);

  const paymentMethod = body.payment_method || 'personal';
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod))
    throw userErr(`payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);

  const insert = {
    expense_date:       body.expense_date       || new Date().toISOString().slice(0, 10),
    category:           body.category,
    description:        body.description.trim(),
    amount:             parseFloat(body.amount),
    vendor:             (body.vendor            || '').trim() || null,
    payment_method:     paymentMethod,
    tax_deductible:     body.tax_deductible === true || body.tax_deductible === 'true',
    receipt_url:        body.receipt_url        || null,
    related_session_id: body.related_session_id || null,
    notes:              body.notes              || null,
    created_by:         auth.user.email         || 'daron',
  };

  const { data, error } = await sb.from('expenses').insert(insert).select().single();
  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'created',
    tableName: 'expenses',
    recordId:  data.id,
    newData:   data,
    context:   `Expense: ${data.category} — ${data.description} $${data.amount}`,
    ip,
  });

  return { expense: data };
}

async function updateExpense(sb, id, body, auth, ip) {
  const allowed = [
    'expense_date','category','description','amount','vendor',
    'payment_method','tax_deductible','receipt_url','notes',
  ];
  const updates = {};
  allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

  if (updates.category && !VALID_EXPENSE_CATEGORIES.includes(updates.category))
    throw userErr(`category must be one of: ${VALID_EXPENSE_CATEGORIES.join(', ')}`);

  if (updates.payment_method && !VALID_PAYMENT_METHODS.includes(updates.payment_method))
    throw userErr(`payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`);

  if (updates.amount !== undefined) {
    updates.amount = parseFloat(updates.amount);
    if (isNaN(updates.amount) || updates.amount <= 0)
      throw userErr('amount must be a positive number.');
  }

  if (Object.keys(updates).length === 0) throw userErr('No valid fields to update.');

  updates.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('expenses')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data)  throw new Error('Expense not found or already deleted.');

  await log({
    actor:     auth.user.email,
    action:    'updated',
    tableName: 'expenses',
    recordId:  id,
    newData:   data,
    context:   `Updated expense: ${data.description}`,
    ip,
  });

  return { expense: data };
}

async function deleteExpense(sb, id, auth, ip) {
  const { data: existing, error: fetchErr } = await sb.from('expenses')
    .select('id, description')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (fetchErr || !existing) throw new Error('Expense not found or already deleted.');

  const { data, error } = await sb.from('expenses')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await log({
    actor:     auth.user.email,
    action:    'deleted',
    tableName: 'expenses',
    recordId:  id,
    newData:   { deleted_at: data.deleted_at },
    context:   `Soft-deleted expense: ${existing.description}`,
    ip,
  });

  return { deleted: true, id };
}
