// /.netlify/functions/client-attention-flags
// Evaluates existing client data and returns structured attention flags.
// Never diagnoses. Uses only supplied data. Returns JSON only.

const https = require('https');

const SYSTEM_PROMPT = `You are a documentation assistant for a holistic energy healing practitioner. Evaluate the client record below and return structured attention flags.

Rules you must follow without exception:
- Use only the data provided. Do not invent, infer, or speculate.
- Never diagnose or suggest any medical, psychological, or clinical condition.
- Use practitioner-safe language: "client reports," "records indicate," "documentation appears missing," "follow-up may be useful," "recommendation appears incomplete."
- Write in third person.
- Return ONLY valid JSON — no markdown, no prose outside the JSON.

Severity levels:
- "urgent": missing required documentation, overdue critical items
- "warning": pending items, no recent contact, incomplete follow-through
- "info": optional improvements, low-priority notices
- "success": only use when no issues exist at all — label "Up To Date"

Return this exact structure:
{
  "flags": [
    {
      "label": "string (short, 2-5 words)",
      "severity": "urgent | warning | info | success",
      "reason": "one sentence using practitioner-safe language",
      "source": "intake | sessions | recommendations | followups | documents | environment | timeline | all",
      "suggested_action": "one sentence or empty string if success"
    }
  ]
}

If no issues are found, return exactly:
{
  "flags": [{ "label": "Up To Date", "severity": "success", "reason": "No immediate attention items found from the available record.", "source": "all", "suggested_action": "" }]
}`;

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(payload) }]
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Failed to parse Claude response')); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(d) {
  const lines = [];
  const today = d.today || new Date().toISOString().slice(0, 10);

  lines.push(`CLIENT: ${d.clientName} | Status: ${d.status || 'active'} | Today: ${today}`);
  lines.push(`TAGS: ${(d.clientTags || []).join(', ') || 'none'}`);

  // Waiver / intake presence
  const hasWaiver = (d.clientTags || []).some(t => t.toLowerCase() === 'waiver');
  lines.push(`WAIVER ON FILE: ${hasWaiver ? 'yes' : 'no'}`);
  lines.push(`INTAKE SUBMISSIONS: ${(d.intake || []).length}`);

  // Sessions
  if (d.sessions && d.sessions.length) {
    const sorted = [...d.sessions].sort((a, b) =>
      (b.session_date || '') > (a.session_date || '') ? 1 : -1
    );
    const last = sorted[0];
    lines.push(`LAST SESSION: ${last.session_date || 'unknown'} | Status: ${last.status || '—'}`);
    lines.push(`UNPAID SESSIONS: ${d.sessions.filter(s => s.status === 'completed' && s.payment_status !== 'paid' && s.payment_status !== 'exchange').length}`);
  } else {
    lines.push('SESSIONS: None recorded');
  }

  // Recommendations
  const outstandingRecs = (d.recommendations || []).filter(r => r.purchased === 'unknown');
  lines.push(`OUTSTANDING RECOMMENDATIONS: ${outstandingRecs.length}`);

  // Follow-ups with severity
  const pendingFollowUps = (d.followUps || []);
  if (pendingFollowUps.length) {
    const overdue = pendingFollowUps.filter(f => {
      const dt = (f.date || f.scheduled_for || '').slice(0, 10);
      return dt && dt < today;
    });
    const criticalOverdue = overdue.filter(f => {
      const dt = (f.date || f.scheduled_for || '').slice(0, 10);
      return Math.floor((new Date(today) - new Date(dt)) / 86400000) >= 30;
    });
    const urgentOverdue = overdue.filter(f => {
      const dt = (f.date || f.scheduled_for || '').slice(0, 10);
      const days = Math.floor((new Date(today) - new Date(dt)) / 86400000);
      return days >= 14 && days < 30;
    });
    lines.push(`PENDING FOLLOW-UPS: ${pendingFollowUps.length} (${overdue.length} overdue — ${criticalOverdue.length} critical 30d+, ${urgentOverdue.length} urgent 14–30d)`);
  } else {
    lines.push('PENDING FOLLOW-UPS: None');
  }

  // Notes presence
  lines.push(`SESSION NOTES ON FILE: ${(d.notes || []).length}`);

  // Plans
  const activePlans = (d.plans || []).filter(p => p.status === 'active');
  lines.push(`ACTIVE ACTION PLANS: ${activePlans.length}`);

  // Recommendations with outcome_status
  const pendingOutcome = (d.recommendations || []).filter(r =>
    !r.outcome_status || r.outcome_status === 'recommended'
  );
  if (pendingOutcome.length !== (d.recommendations || []).filter(r => r.purchased === 'unknown').length) {
    lines.push(`RECOMMENDATIONS WITH NO OUTCOME: ${pendingOutcome.length}`);
  }

  // Environment
  if (d.recentEnvironment && d.recentEnvironment.length) {
    const latest = d.recentEnvironment[0];
    lines.push(`MOST RECENT ENV ENTRY: ${latest.date || 'unknown'}`);
  } else {
    lines.push('ENVIRONMENTAL RECORDS: None');
  }

  lines.push('\nBased only on the data above, return the JSON attention flags. Return only JSON.');
  return lines.join('\n');
}

// Deterministic fallback — used if AI call fails
function buildFallbackFlags(d) {
  const today = d.today || new Date().toISOString().slice(0, 10);
  const flags = [];

  const hasWaiver = (d.clientTags || []).some(t => t.toLowerCase() === 'waiver');
  if (!hasWaiver) {
    flags.push({ label: 'Waiver Missing', severity: 'urgent',
      reason: 'No waiver tag found on the client record.',
      source: 'documents',
      suggested_action: 'Collect a signed waiver before the next session.' });
  }

  if (!d.intake || !d.intake.length) {
    flags.push({ label: 'Intake Missing', severity: 'urgent',
      reason: 'No intake submission found for this client.',
      source: 'intake',
      suggested_action: 'Request intake form completion before the next session.' });
  }

  if (d.sessions && d.sessions.length) {
    const sorted = [...d.sessions].sort((a, b) =>
      (b.session_date || '') > (a.session_date || '') ? 1 : -1
    );
    const lastDate = sorted[0].session_date;
    if (lastDate) {
      const days = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
      if (days > 60) {
        flags.push({ label: 'No Session in 60 Days', severity: 'warning',
          reason: `Records indicate no session in the past ${days} days.`,
          source: 'sessions',
          suggested_action: 'Consider a check-in or outreach message.' });
      }
    }
    const unpaid = d.sessions.filter(s =>
      s.status === 'completed' && s.payment_status !== 'paid' && s.payment_status !== 'exchange'
    );
    if (unpaid.length) {
      flags.push({ label: 'Unpaid Sessions', severity: 'warning',
        reason: `${unpaid.length} completed session(s) show no payment recorded.`,
        source: 'sessions',
        suggested_action: 'Reconcile payment status in session log.' });
    }
  } else {
    flags.push({ label: 'No Sessions Recorded', severity: 'info',
      reason: 'No session records found for this client.',
      source: 'sessions',
      suggested_action: 'Add a session record after the first appointment.' });
  }

  const overdue = (d.followUps || []).filter(f => {
    const dt = (f.date || f.scheduled_for || '').slice(0, 10);
    return dt && dt < today;
  });
  if (overdue.length) {
    const maxDays = Math.max(...overdue.map(f => {
      const dt = (f.date || f.scheduled_for || '').slice(0, 10);
      return Math.floor((new Date(today) - new Date(dt)) / 86400000);
    }));
    const sev = maxDays >= 30 ? 'urgent' : maxDays >= 14 ? 'urgent' : 'warning';
    const sevLabel = maxDays >= 30 ? 'critical (30+ days)' : maxDays >= 14 ? 'urgent (14+ days)' : 'warning';
    flags.push({ label: 'Follow-Up Overdue', severity: sev,
      reason: `${overdue.length} follow-up item(s) past scheduled date — most overdue: ${maxDays} days (${sevLabel}).`,
      source: 'followups',
      suggested_action: 'Review and update follow-up status immediately.' });
  }

  const outstandingRecs = (d.recommendations || []).filter(r =>
    !r.outcome_status || r.outcome_status === 'recommended'
  );
  if (outstandingRecs.length > 2) {
    flags.push({ label: 'Recommendations Pending', severity: 'info',
      reason: `${outstandingRecs.length} recommendations have no outcome recorded.`,
      source: 'recommendations',
      suggested_action: 'Follow up on recommendation status at next session.' });
  }

  // No measurable improvement flag
  const sessionsWithState = (d.sessions || [])
    .filter(s => s.state_before != null && s.state_after != null)
    .sort((a, b) => (b.session_date || '') > (a.session_date || '') ? 1 : -1);
  if (sessionsWithState.length >= 2) {
    const recent = sessionsWithState.slice(0, 3);
    const noImprovement = recent.every(s => s.state_after <= s.state_before);
    if (noImprovement) {
      flags.push({ label: 'No Measurable Improvement', severity: 'warning',
        reason: `Records indicate state_after has not exceeded state_before in the last ${recent.length} tracked sessions.`,
        source: 'sessions',
        suggested_action: 'Consider reviewing session approach or checking in on client experience.' });
    }
  }

  // Recommendation feedback gap: purchased but no outcome after 14 days
  const purchasedNoOutcome = (d.recommendations || []).filter(r => {
    if (r.purchased !== 'yes' && r.outcome_status !== 'purchased') return false;
    if (r.outcome_status && r.outcome_status !== 'purchased') return false;
    const recDate = (r.recommended_at || r.created_at || '').slice(0, 10);
    if (!recDate) return false;
    const daysSince = Math.floor((new Date(today) - new Date(recDate)) / 86400000);
    return daysSince >= 14;
  });
  if (purchasedNoOutcome.length > 0) {
    flags.push({ label: 'Recommendation Feedback Gap', severity: 'warning',
      reason: `${purchasedNoOutcome.length} purchased recommendation(s) have no outcome recorded after 14+ days.`,
      source: 'recommendations',
      suggested_action: 'Ask client about their experience with the recommended product at next session.' });
  }

  // Follow-up risk flag: 3+ overdue for same client
  if (overdue.length >= 3) {
    flags.push({ label: 'Follow-Up Risk', severity: 'urgent',
      reason: `${overdue.length} follow-up items are overdue — pattern suggests follow-up process may need review.`,
      source: 'followups',
      suggested_action: 'Review all overdue follow-ups in the Follow-Up Center and complete or skip each one.' });
  }

  if (!flags.length) {
    flags.push({ label: 'Up To Date', severity: 'success',
      reason: 'No immediate attention items found from the available record.',
      source: 'all',
      suggested_action: '' });
  }

  return flags;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { requireAdmin } = require('./lib/auth');
  const { logAIUsage } = require('./lib/ai-log');
  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  if (!payload.clientName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clientName required' }) };
  }

  // If no API key, return deterministic flags without logging (no AI call was made)
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 200, body: JSON.stringify({ flags: buildFallbackFlags(payload), source: 'deterministic' }) };
  }

  const start = Date.now();
  try {
    const result = await callClaude(payload);
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error('Empty response');

    let parsed;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      logAIUsage({ feature: 'client_attention_flags', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: false, responseTimeMs: Date.now() - start, errorMessage: 'AI response was not valid JSON' });
      return { statusCode: 200, body: JSON.stringify({ flags: buildFallbackFlags(payload), source: 'deterministic' }) };
    }

    logAIUsage({ feature: 'client_attention_flags', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: true, responseTimeMs: Date.now() - start, tokensUsed: result?.usage?.output_tokens || null });
    const merged = mergeFlags(buildFallbackFlags(payload), parsed.flags || []);
    return { statusCode: 200, body: JSON.stringify({ flags: merged, source: 'merged' }) };
  } catch (err) {
    logAIUsage({ feature: 'client_attention_flags', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: false, responseTimeMs: Date.now() - start, errorMessage: err.message });
    return { statusCode: 200, body: JSON.stringify({ flags: buildFallbackFlags(payload), source: 'deterministic' }) };
  }
};

// Merge deterministic flags (always authoritative) with AI flags (additive).
// Deterministic flags always appear. AI flags are added if they cover a concept
// not already represented in the deterministic set (dedup by label similarity).
function mergeFlags(deterministicFlags, aiFlags) {
  // If only success flag from deterministic and AI has real flags, replace success
  const detReal = deterministicFlags.filter(f => f.severity !== 'success');
  const detSuccess = deterministicFlags.filter(f => f.severity === 'success');

  // Normalize label for comparison: lowercase, strip spaces/punctuation
  const normalize = label => (label || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const detLabels = new Set(detReal.map(f => normalize(f.label)));

  // Concepts already covered by deterministic flags (broader match)
  const detConcepts = new Set();
  detReal.forEach(f => {
    const n = normalize(f.label);
    // add each word as a concept signal for broader dedup
    n.split('').forEach((_, i) => {
      if (n.length >= 4) detConcepts.add(n.slice(0, Math.max(4, Math.round(n.length * 0.6))));
    });
    detConcepts.add(n);
  });

  // Add AI flags that don't duplicate deterministic concepts
  const addedAI = [];
  aiFlags.forEach(f => {
    if (f.severity === 'success') return; // skip AI "up to date" if we have real flags
    const n = normalize(f.label);
    // Skip if exact label already present
    if (detLabels.has(n)) return;
    // Skip if a deterministic flag covers the same root concept (>60% char prefix overlap)
    const isDup = detReal.some(det => {
      const dn = normalize(det.label);
      const minLen = Math.min(n.length, dn.length);
      if (minLen < 4) return false;
      const overlap = Math.round(minLen * 0.6);
      return n.slice(0, overlap) === dn.slice(0, overlap);
    });
    if (!isDup) addedAI.push({ ...f, source: f.source || 'ai', _fromAI: true });
  });

  const merged = [...detReal, ...addedAI];

  // If nothing at all, return success
  if (merged.length === 0) return detSuccess.length ? detSuccess : aiFlags;

  // Sort by severity: urgent → warning → info → success
  const order = { urgent: 0, warning: 1, info: 2, success: 3 };
  merged.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));

  return merged;
}
