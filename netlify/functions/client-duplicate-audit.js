'use strict';
const { requireAdmin, respond } = require('./lib/auth');
const { getClient } = require('./lib/supabase');
const { isQaRecord } = require('./lib/record-policy');
const { normalizeEmail, normalizePhone, nameSimilarityManual, profileSummary } = require('./lib/client-identity');

exports.handler = async event => {
  const auth = await requireAdmin(event, { touch: false });
  if (auth.error) return auth.error;
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Read-only duplicate audit.' });
  try {
    const sb = getClient();
    const [{ data: clients, error: clientError }, { data: sessions, error: sessionError }] = await Promise.all([
      sb.from('clients').select('id,full_name,email,phone,status,source,created_at,merged_into_client_id'),
      sb.from('sessions').select('id,client_id,session_date,status'),
    ]);
    if (clientError || sessionError) return respond(503, { error: 'Duplicate audit is unavailable.' });
    const active = (clients || []).filter(c => !c.merged_into_client_id && !isQaRecord(c));
    const parent = new Map(active.map(c => [c.id, c.id]));
    const find = id => parent.get(id) === id ? id : (parent.set(id, find(parent.get(id))), parent.get(id));
    const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const byEmail = new Map(), byPhone = new Map();
    for (const client of active) {
      const email = normalizeEmail(client.email), phone = normalizePhone(client.phone);
      if (email) { if (byEmail.has(email)) join(client.id, byEmail.get(email)); else byEmail.set(email, client.id); }
      if (phone.length >= 7) { if (byPhone.has(phone)) join(client.id, byPhone.get(phone)); else byPhone.set(phone, client.id); }
    }
    // Name similarity is review evidence only. It never raises confidence or authorizes a merge.
    for (let i = 0; i < active.length; i += 1) for (let j = i + 1; j < active.length; j += 1) {
      if (nameSimilarityManual(active[i].full_name, active[j].full_name)) join(active[i].id, active[j].id);
    }
    const groups = new Map();
    for (const client of active) {
      const root = find(client.id); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(client);
    }
    const candidates = [...groups.values()].filter(group => group.length > 1).map(group => {
      const emails = group.map(c => normalizeEmail(c.email)).filter(Boolean);
      const phones = group.map(c => normalizePhone(c.phone)).filter(v => v.length >= 7);
      const reasons = [], exactSignals = [];
      const hasExactEmail = new Set(emails).size < emails.length;
      const hasExactPhone = new Set(phones).size < phones.length;
      if (hasExactEmail) reasons.push('normalized exact email match');
      if (hasExactPhone) reasons.push('normalized exact phone match');
      if (hasExactEmail) exactSignals.push('email');
      if (hasExactPhone) exactSignals.push('phone');
      if (group.some((client, index) => group.some((other, otherIndex) => index < otherIndex && nameSimilarityManual(client.full_name, other.full_name)))) reasons.push('name_similarity_manual_review');
      const hasExactSignal = exactSignals.length > 0;
      return { confidence: hasExactSignal ? (exactSignals.length > 1 ? 'high' : 'medium') : 'low', manualVerificationRequired: !hasExactSignal, reason: reasons.join(' + '), clients: group.map(c => profileSummary(c, sessions || [])) };
    });
    return respond(200, { readOnly: true, candidates });
  } catch { return respond(503, { error: 'Duplicate audit is unavailable.' }); }
};
