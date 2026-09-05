'use strict';

// One-time, idempotent, non-destructive production reconciliation.
// Usage: node scripts/historical-reconciliation-2026-09-02.js [--apply]

const fs = require('fs');
const path = require('path');

const SITE_ID = '1e40c2ba-a615-4fd1-a149-6ee4e78c5ebc';
const PROJECT_REF = 'pqlynrmacrorkfludmms';
const SOURCE = 'historical_planner_reconciliation_20260902';
const MARKER = '[planner-reconciliation:2026-09-02]';
const APPLY = process.argv.includes('--apply');
const VALIDATE = process.argv.includes('--validate');
const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) { if (!condition) throw new Error(message); }
function normalizeName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’]/g, "'").replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}
function editDistance(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}
function minuteValue(time) {
  if (!time) return 24 * 60;
  const parts = String(time).slice(0, 5).split(':').map(Number);
  return parts[0] * 60 + parts[1];
}
function loadNetlifyToken() {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'netlify', 'Config', 'config.json'), 'utf8'));
  const user = config.users?.[config.userId] || Object.values(config.users || {})[0];
  assert(user?.auth?.token, 'Authenticated Netlify token not found.');
  return user.auth.token;
}
async function json(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url.replace(/apikey=[^&]+/g, 'apikey=[redacted]')} -> ${response.status}: ${raw.slice(0, 500)}`);
  return { data, headers: response.headers };
}
async function getCredentials() {
  const qaEnvPath = path.join(ROOT, 'qa', '.env');
  if (fs.existsSync(qaEnvPath)) {
    const local = {};
    for (const line of fs.readFileSync(qaEnvPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) local[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
    if (local.QA_SUPABASE_URL && local.QA_SUPABASE_SERVICE_ROLE_KEY) {
      assert(local.QA_SUPABASE_URL.includes(PROJECT_REF), 'Local QA credentials do not match the approved production project.');
      return { url: local.QA_SUPABASE_URL.replace(/\/$/, ''), key: local.QA_SUPABASE_SERVICE_ROLE_KEY };
    }
  }
  const token = loadNetlifyToken();
  const result = await json(`https://api.netlify.com/api/v1/accounts/01JZNBXKWV10BYFTRCJC1AZG7F/env?site_id=${SITE_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const values = {};
  for (const item of result.data || []) {
    const value = (item.values || []).find(v => v.context === 'production') ||
      (item.values || []).find(v => !v.context || v.context === 'all') || (item.values || [])[0];
    if (value) values[item.key] = value.value;
  }
  assert(values.SUPABASE_URL && values.SUPABASE_SERVICE_ROLE_KEY, 'Supabase production credentials unavailable.');
  assert(values.SUPABASE_URL.includes(PROJECT_REF), 'Supabase project ref does not match the approved production project.');
  return { url: values.SUPABASE_URL.replace(/\/$/, ''), key: values.SUPABASE_SERVICE_ROLE_KEY };
}
function parsePlanner() {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'sprint18m-planner-reconciliation.md'), 'utf8');
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    if (!/^\| 2026-/.test(line) || !/\| Needs review \|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(v => v.trim());
    rows.push({ date: cells[0], time: cells[1] === 'Unclear' ? null : cells[1], name: cells[2], service: cells[3], payment: cells[4], note: cells[6] });
  }
  assert(rows.length === 179, `Expected 179 approved rows; parsed ${rows.length}.`);
  return rows;
}
function restClient(credentials) {
  const headers = { apikey: credentials.key, Authorization: `Bearer ${credentials.key}`, 'Content-Type': 'application/json' };
  const base = `${credentials.url}/rest/v1`;
  return {
    async select(table, query = '') { return (await json(`${base}/${table}?${query}`, { headers })).data || []; },
    async insert(table, rows) { return (await json(`${base}/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(rows) })).data || []; },
    async patch(table, query, body) { return (await json(`${base}/${table}?${query}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body) })).data || []; },
  };
}
function sortPlanner(a, b) { return (a.time || '99:99').localeCompare(b.time || '99:99'); }
function sortSessions(a, b) { return String(a.session_time || '99:99').localeCompare(String(b.session_time || '99:99')) || String(a.created_at).localeCompare(String(b.created_at)); }
function plannerNote(row) {
  return `${MARKER} Approved planner entry. Original name: ${row.name}. Session/round: ${row.service}. Payment notation: ${row.payment}. Review note: ${row.note || '—'}.${row.time ? '' : ' [time_unknown]'}`;
}
function appendNote(existing, addition) {
  const current = String(existing || '').trim();
  if (current.includes(MARKER)) return current;
  return current ? `${current}\n\n${addition}` : addition;
}
function durationFor(row) {
  const text = `${row.service} ${row.note}`.toLowerCase();
  if (/1\/2 hour|half hour/.test(text)) return 30;
  const minutes = text.match(/\b(5|15|30|45) minute/);
  return minutes ? Number(minutes[1]) : 60;
}
function relationshipSpecs(rows) {
  const present = new Set(rows.map(r => r.name));
  const specs = [];
  const add = (anchor, related, type, label, evidence) => {
    if (present.has(related)) specs.push({ anchor, related, type, label, evidence });
  };
  for (const row of rows) {
    const m = row.name.match(/^(.+?)['’]s\s+(sister|brother|daughter|granddaughter|mom|mother|son)$/i);
    if (m) {
      const word = m[2].toLowerCase();
      const type = ({ sister:'sibling', brother:'sibling', daughter:'child', son:'child', granddaughter:'grandchild', mom:'parent', mother:'parent' })[word];
      add(m[1], row.name, type, word === 'mom' ? 'Mother' : word[0].toUpperCase() + word.slice(1), `Explicit planner name: ${row.name}`);
    }
  }
  add('Katie Potter', 'Katie Potter + friend', 'friend', 'Friend', 'Explicit "+ friend" planner wording');
  add('Sun', 'Sun + daughter', 'child', 'Daughter', 'Explicit "+ daughter" planner wording');
  add('Donna Lambert', 'Donna Lambert + son', 'child', 'Son', 'Explicit "+ son" planner wording');
  add('Ann-Olivia Amson', 'Ann-Olivia Amson + Finn', 'associated', 'Co-attendee: Finn', 'Planner names Finn as co-attendee; no family role inferred');
  add('Hilda', 'Hilda / Uncle Phillip', 'uncle', 'Uncle', 'Explicit "Uncle Phillip" planner wording');
  add('Kathleen Blair', 'Kathleen Blair / Grandma Kelly', 'grandparent', 'Grandmother', 'Explicit "Grandma Kelly" planner wording');
  add('Joanna', 'Marion Culino', 'sibling', 'Sister', "Planner session note says Joanna's sister");
  add('Macy', 'Lynn Stahl', 'parent', 'Mother', "Planner session note says Macy's mom");
  return specs.filter((s, i, all) => all.findIndex(x => x.anchor === s.anchor && x.related === s.related && x.type === s.type) === i);
}

async function main() {
  const approved = parsePlanner();
  const early = approved.filter(r => r.date <= '2026-07-07');
  const late = approved.filter(r => r.date > '2026-07-07');
  assert(early.length === 110 && late.length === 69, `Expected 110 early/69 late; found ${early.length}/${late.length}.`);

  const credentials = await getCredentials();
  const db = restClient(credentials);
  const [sessions, clients] = await Promise.all([
    db.select('sessions', 'select=*&order=session_date.asc,session_time.asc,created_at.asc'),
    db.select('clients', 'select=*&order=created_at.asc'),
  ]);
  if (VALIDATE) {
    const represented = sessions.filter(s => String(s.seller_notes || '').includes(MARKER));
    const inserted = sessions.filter(s => s.source === SOURCE);
    const historicalClients = clients.filter(c => c.source === SOURCE);
    const [relationships, payments] = await Promise.all([
      db.select('client_relationships', `select=*&source=eq.${SOURCE}`),
      db.select('payments', 'select=id,session_id'),
    ]);
    const tarot = represented.find(s => s.session_date === '2026-07-03' && s.client_name === 'Tarot reading');
    const protectedExpected = [
      ['2026-06-18','17:05','test'],
      ['2026-07-07','12:00','Dawn Yekrabs'], ['2026-07-07','14:00','Jayne Taylor'],
      ['2026-07-07','16:00','Maria Padesis'], ['2026-07-07','18:00','Sarah Viral'],
    ];
    const protectedFound = protectedExpected.filter(([date,time,name]) => sessions.some(s => s.session_date === date && String(s.session_time || '').slice(0,5) === time && s.client_name === name && !String(s.seller_notes || '').includes(MARKER)));
    const qaProtected = sessions.filter(s => s.session_date === '2026-06-11' && String(s.session_time || '').slice(0,5) === '14:00' && s.client_name === 'Tamara Simms [QA]' && !String(s.seller_notes || '').includes(MARKER));
    const insertedIds = new Set(inserted.map(s => s.id));
    const result = {
      sessions: sessions.length, clients: clients.length, representedApprovedRows: represented.length,
      correctedPreservedRecords: represented.length - inserted.length, insertedHistoricalSessions: inserted.length,
      createdHistoricalClients: historicalClients.length, relationshipLinks: relationships.length,
      relationshipTypes: [...new Set(relationships.map(r => r.relationship_type))].sort(),
      allRepresentedLinked: represented.every(s => s.client_id),
      tarotTimeNull: !!tarot && tarot.session_time === null && String(tarot.seller_notes || '').includes('[time_unknown]'),
      insertedCalendarSilent: inserted.every(s => s.google_calendar_status === 'not_requested' && !s.google_calendar_event_id && !s.google_meet_url),
      insertedPaymentsCreated: payments.filter(p => insertedIds.has(p.session_id)).length,
      protectedQaRows: qaProtected.length, protectedOtherRows: protectedFound.length,
    };
    assert(result.representedApprovedRows === 179, 'Validation failed: not all 179 rows represented.');
    assert(result.correctedPreservedRecords === 110 && result.insertedHistoricalSessions === 69, 'Validation failed: existing/new record split changed.');
    assert(result.allRepresentedLinked && result.tarotTimeNull && result.insertedCalendarSilent && result.insertedPaymentsCreated === 0, 'Validation failed: linking, Tarot, calendar, or payment safety invariant.');
    assert(result.protectedQaRows === 3 && result.protectedOtherRows === 5, 'Validation failed: one or more excluded rows changed.');
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const manualEarly = sessions.filter(s => s.source === 'manual' && s.session_date >= '2026-06-08' && s.session_date <= '2026-07-07');
  const eligibleManualEarly = manualEarly.filter(s => !/\[qa\]/i.test(s.client_name || '') && normalizeName(s.client_name) !== 'test');

  const mappings = [];
  const usedSessionIds = new Set();
  for (const date of [...new Set(early.map(r => r.date))]) {
    const rows = early.filter(r => r.date === date).sort(sortPlanner);
    const allDateSessions = sessions.filter(s => s.session_date === date && !/\[qa\]/i.test(s.client_name || '') && normalizeName(s.client_name) !== 'test');
    const remainingRows = rows.slice();
    // Lock authoritative exact matches first, regardless of their legacy source label.
    for (let i = remainingRows.length - 1; i >= 0; i--) {
      const row = remainingRows[i];
      const exactSession = allDateSessions.find(s => !usedSessionIds.has(s.id) && normalizeName(row.name) === normalizeName(s.client_name) && (row.time || null) === (s.session_time ? String(s.session_time).slice(0, 5) : null));
      if (exactSession) {
        mappings.push({ row, session: exactSession });
        usedSessionIds.add(exactSession.id);
        remainingRows.splice(i, 1);
      }
    }
    const remainingProd = eligibleManualEarly.filter(s => s.session_date === date && !usedSessionIds.has(s.id)).sort(sortSessions);
    assert(remainingProd.length >= remainingRows.length, `Production drift on ${date}: ${remainingRows.length} unmatched planner rows, ${remainingProd.length} eligible existing sessions.`);
    while (remainingRows.length) {
      const row = remainingRows.shift();
      const ranked = remainingProd.map((session, index) => ({ index, score: editDistance(row.name, session.client_name) * 120 + Math.abs(minuteValue(row.time) - minuteValue(session.session_time)) }));
      ranked.sort((a, b) => a.score - b.score);
      const selected = remainingProd.splice(ranked[0].index, 1)[0];
      mappings.push({ row, session: selected });
      usedSessionIds.add(selected.id);
    }
  }
  const exact = mappings.filter(m => normalizeName(m.row.name) === normalizeName(m.session.client_name) && (m.row.time || null) === (m.session.session_time ? String(m.session.session_time).slice(0, 5) : null));
  assert(exact.length === 37, `Production drift: expected 37 unchanged matches, found ${exact.length}.`);
  assert(mappings.length - exact.length === 73, 'Expected exactly 73 corrected existing sessions.');

  const existingImported = sessions.filter(s => s.source === SOURCE || String(s.seller_notes || '').includes(MARKER));
  assert(existingImported.length === 0 || existingImported.length === 69, `Partial prior import detected (${existingImported.length}); stop for review.`);

  const byNorm = new Map();
  for (const client of clients) {
    const key = normalizeName(client.full_name);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(client);
  }
  const approvedNames = [...new Set(approved.map(r => r.name))];
  const specs = relationshipSpecs(approved);
  const anchorNames = [...new Set(specs.map(s => s.anchor))];
  const requiredNames = [...new Set([...approvedNames, ...anchorNames])];
  const ambiguousExisting = requiredNames.filter(name => (byNorm.get(normalizeName(name)) || []).length > 1);
  assert(!ambiguousExisting.length, `Potential exact client duplicates require review: ${ambiguousExisting.join(', ')}`);
  const namesToCreate = requiredNames.filter(name => !(byNorm.get(normalizeName(name)) || []).length);

  const plan = {
    mode: APPLY ? 'apply' : 'dry-run', sessionsBefore: sessions.length, clientsBefore: clients.length,
    approvedRows: approved.length, unchangedSessions: exact.length, correctedSessions: 73,
    backfilledSessions: existingImported.length ? 0 : 69, approvedUniqueClients: approvedNames.length,
    relationshipAnchorClients: anchorNames.length, clientsToCreate: namesToCreate.length,
    existingClientsReused: requiredNames.length - namesToCreate.length,
    relationshipLinksPlanned: specs.length, relationshipTypes: [...new Set(specs.map(s => s.type))].sort(),
    tarot: { date: '2026-07-03', sessionTime: null, marker: 'time_unknown' },
  };
  let relationshipTableAvailable = true;
  try { await db.select('client_relationships', 'select=id&limit=1'); } catch (error) { relationshipTableAvailable = false; }
  assert(relationshipTableAvailable, 'client_relationships migration is not available; no reconciliation writes were attempted.');
  if (!APPLY) { console.log(JSON.stringify(plan, null, 2)); return; }

  if (namesToCreate.length) {
    const created = await db.insert('clients', namesToCreate.map(name => ({
      full_name: name, email: null, phone: null, source: SOURCE, status: 'active',
      notes: `${MARKER} Historical client identity preserved exactly as approved from Daron's planner; contact details unknown.`,
      tags: ['historical', 'planner-reconciled'],
    })));
    assert(created.length === namesToCreate.length, `Expected ${namesToCreate.length} created clients, got ${created.length}.`);
    for (const client of created) byNorm.set(normalizeName(client.full_name), [client]);
  }
  const clientFor = name => {
    const matches = byNorm.get(normalizeName(name)) || [];
    assert(matches.length === 1, `Cannot resolve one client for ${name}.`);
    return matches[0];
  };

  let corrected = 0;
  for (const { row, session } of mappings) {
    const isExact = normalizeName(row.name) === normalizeName(session.client_name) && (row.time || null) === (session.session_time ? String(session.session_time).slice(0, 5) : null);
    const body = { client_id: clientFor(row.name).id, seller_notes: appendNote(session.seller_notes, plannerNote(row)) };
    if (!isExact) { body.client_name = row.name; body.session_time = row.time; corrected++; }
    const updated = await db.patch('sessions', `id=eq.${encodeURIComponent(session.id)}`, body);
    assert(updated.length === 1 && updated[0].id === session.id, `Failed to update session ${session.id}.`);
  }
  assert(corrected === 73, `Expected 73 corrections; applied ${corrected}.`);

  let inserted = existingImported.length;
  if (!existingImported.length) {
    const createdSessions = await db.insert('sessions', late.map(row => ({
      client_id: clientFor(row.name).id, client_name: row.name, service: row.service === '—' ? 'Historical session' : row.service,
      session_date: row.date, session_time: row.time, duration_minutes: durationFor(row), location_type: null,
      status: 'completed', payment_status: 'unpaid', amount_due: null, amount_paid: 0, source: SOURCE,
      seller_notes: plannerNote(row), google_calendar_status: 'not_requested', google_calendar_event_id: null, google_meet_url: null,
    })));
    inserted = createdSessions.length;
    assert(inserted === 69, `Expected 69 inserted sessions, got ${inserted}.`);
  }

  // Also link other sessions only where their client_name exactly identifies one reconciled client.
  let extraSessionsLinked = 0;
  for (const session of sessions) {
    if (session.client_id || manualEarly.some(s => s.id === session.id)) continue;
    const matches = byNorm.get(normalizeName(session.client_name)) || [];
    if (matches.length !== 1 || !requiredNames.some(n => normalizeName(n) === normalizeName(session.client_name))) continue;
    const updated = await db.patch('sessions', `id=eq.${encodeURIComponent(session.id)}`, { client_id: matches[0].id });
    if (updated.length === 1) extraSessionsLinked++;
  }

  const existingRelationships = await db.select('client_relationships', 'select=client_id,related_client_id,relationship_type');
  let relationshipsCreated = 0;
  for (const spec of specs) {
    const anchor = clientFor(spec.anchor), related = clientFor(spec.related);
    const exists = existingRelationships.some(r => r.client_id === anchor.id && r.related_client_id === related.id && r.relationship_type === spec.type);
    if (exists) continue;
    const created = await db.insert('client_relationships', [{ client_id: anchor.id, related_client_id: related.id, relationship_type: spec.type, relationship_label: spec.label, source: SOURCE, notes: `${MARKER} ${spec.evidence}.` }]);
    assert(created.length === 1, `Failed relationship ${spec.anchor} -> ${spec.related}.`);
    relationshipsCreated++;
  }

  const [afterSessions, afterClients, afterRelationships] = await Promise.all([
    db.select('sessions', 'select=id,client_id,client_name,session_date,session_time,source,seller_notes'),
    db.select('clients', 'select=id,full_name,source'),
    db.select('client_relationships', `select=id,relationship_type&source=eq.${SOURCE}`),
  ]);
  const represented = afterSessions.filter(s => String(s.seller_notes || '').includes(MARKER));
  const tarot = represented.find(s => s.session_date === '2026-07-03' && s.client_name === 'Tarot reading');
  assert(represented.length === 179, `Expected all 179 represented; found ${represented.length}.`);
  assert(tarot && tarot.session_time === null && String(tarot.seller_notes).includes('[time_unknown]'), 'Tarot null-time validation failed.');
  assert(represented.every(s => s.client_id), 'At least one approved session is not linked to a client.');
  console.log(JSON.stringify({ ...plan, mode: 'applied', sessionsAfter: afterSessions.length, clientsAfter: afterClients.length, correctedApplied: corrected, backfilledApplied: inserted, extraSessionsLinked, relationshipLinksCreated: relationshipsCreated, relationshipLinksTotal: afterRelationships.length, representedApprovedRows: represented.length, tarotValidated: true }, null, 2));
}

main().catch(error => { console.error(`RECONCILIATION_STOPPED: ${error.message}`); process.exitCode = 1; });
