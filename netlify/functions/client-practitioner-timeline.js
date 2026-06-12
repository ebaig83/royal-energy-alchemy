// /.netlify/functions/client-practitioner-timeline
// Transforms existing client records into a chronological practitioner timeline.
// Never diagnoses. Uses only supplied data. Returns JSON only.

const https = require('https');

const SYSTEM_PROMPT = `You are a documentation assistant for a holistic energy healing practitioner. Transform the client record below into a structured chronological practitioner timeline.

Rules you must follow without exception:
- Use only the data provided. Do not invent dates, events, or facts.
- Never diagnose or suggest any medical, psychological, or clinical condition.
- Use practitioner-safe language: "client reports," "records indicate," "intake states," "session notes show," "follow-up was scheduled."
- Write in third person. Keep summaries to one concise sentence.
- If a date is missing, use "undated" as the date value.
- Return ONLY valid JSON — no markdown, no prose outside the JSON.

Importance levels:
- "high": first intake, first session, urgent referral, missed critical follow-up
- "medium": completed sessions, new recommendations, scheduled follow-ups, action plans
- "low": minor notes, routine check-ins, informational entries

Categories:
- "intake" | "session" | "recommendation" | "followup" | "document" | "environment" | "note" | "referral" | "plan"

Return this exact structure, newest items first:
{
  "items": [
    {
      "date": "YYYY-MM-DD or undated",
      "title": "short title (3-7 words)",
      "summary": "one practitioner-safe sentence",
      "category": "intake | session | recommendation | followup | document | environment | note | referral | plan",
      "importance": "low | medium | high",
      "source": "string describing data source"
    }
  ]
}`;

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
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
  lines.push(`CLIENT: ${d.clientName} | Status: ${d.status || 'active'}`);

  if (d.intake && d.intake.length) {
    lines.push(`\nINTAKE SUBMISSIONS (${d.intake.length}):`);
    d.intake.slice(0, 3).forEach((i, idx) => {
      const parts = [];
      if (i.created_at || i.submitted_at) parts.push(`Date: ${(i.created_at || i.submitted_at || '').slice(0, 10)}`);
      if (i.service_requested) parts.push(`Service: ${i.service_requested}`);
      if (i.message)           parts.push(`Concern: ${i.message.slice(0, 150)}`);
      if (i.agent_summary)     parts.push(`Summary: ${i.agent_summary.slice(0, 150)}`);
      lines.push(`  [Intake ${idx + 1}] ${parts.join(' | ')}`);
    });
  }

  if (d.sessions && d.sessions.length) {
    lines.push(`\nSESSIONS (${d.sessions.length}):`);
    [...d.sessions]
      .sort((a, b) => (b.session_date || '') > (a.session_date || '') ? 1 : -1)
      .slice(0, 12)
      .forEach(s => {
        const parts = [`Date: ${s.session_date || 'undated'}`, `Service: ${s.service || s.service_type || '—'}`, `Status: ${s.status || '—'}`];
        if (s.payment_status) parts.push(`Payment: ${s.payment_status}`);
        lines.push(`  - ${parts.join(' | ')}`);
      });
  }

  if (d.notes && d.notes.length) {
    lines.push(`\nSESSION NOTES (${d.notes.length} entries, most recent first):`);
    d.notes.slice(0, 5).forEach(n => {
      const txt = (n.content || n.raw_notes || '').slice(0, 200);
      const date = (n.created_at || '').slice(0, 10) || 'undated';
      if (txt) lines.push(`  [${date}] ${txt}`);
    });
  }

  if (d.recommendations && d.recommendations.length) {
    lines.push(`\nRECOMMENDATIONS (${d.recommendations.length}):`);
    d.recommendations.slice(0, 6).forEach(r => {
      lines.push(`  - ${r.recommended_at || 'undated'} | ${r.product_name} (${r.category || 'other'}) | Purchased: ${r.purchased || 'unknown'}`);
    });
  }

  if (d.followUps && d.followUps.length) {
    lines.push(`\nFOLLOW-UPS / AFTERCARE (${d.followUps.length}):`);
    d.followUps.slice(0, 6).forEach(f => {
      const parts = [`Date: ${f.date || f.scheduled_for || 'undated'}`];
      if (f.message_type) parts.push(`Type: ${f.message_type}`);
      if (f.status)       parts.push(`Status: ${f.status}`);
      lines.push(`  - ${parts.join(' | ')}`);
    });
  }

  if (d.referrals && d.referrals.length) {
    lines.push(`\nREFERRALS (${d.referrals.length}):`);
    d.referrals.slice(0, 4).forEach(r => {
      lines.push(`  - ${r.referred_at || 'undated'} | ${r.provider_name} (${r.provider_type || 'other'}) | Followed: ${r.followed_through || 'unknown'}`);
    });
  }

  if (d.plans && d.plans.length) {
    lines.push(`\nACTION PLANS (${d.plans.length}):`);
    d.plans.slice(0, 4).forEach(p => {
      const parts = [`Date: ${p.created_at ? p.created_at.slice(0, 10) : 'undated'}`, `Status: ${p.status || '—'}`];
      if (p.immediate_steps) parts.push(`Steps: ${p.immediate_steps.slice(0, 80)}`);
      lines.push(`  - ${parts.join(' | ')}`);
    });
  }

  lines.push('\nTransform all records above into the JSON practitioner timeline. Newest items first. Return only JSON.');
  return lines.join('\n');
}

// Deterministic fallback — produces a basic timeline without AI
function buildFallbackTimeline(d) {
  const items = [];

  (d.intake || []).slice(0, 3).forEach((i, idx) => {
    const date = (i.created_at || i.submitted_at || '').slice(0, 10) || 'undated';
    items.push({
      date,
      title: 'Intake Form Submitted',
      summary: i.service_requested
        ? `Client intake states service requested: ${i.service_requested}.`
        : 'Client intake form submission recorded.',
      category: 'intake',
      importance: idx === 0 ? 'high' : 'medium',
      source: 'intake'
    });
  });

  [...(d.sessions || [])]
    .sort((a, b) => (b.session_date || '') > (a.session_date || '') ? 1 : -1)
    .slice(0, 10)
    .forEach(s => {
      items.push({
        date: s.session_date || 'undated',
        title: `Session — ${s.service || s.service_type || 'Energy Work'}`,
        summary: `Session records show ${s.service || 'a session'} with status: ${s.status || 'unknown'}.`,
        category: 'session',
        importance: s.status === 'completed' ? 'medium' : 'low',
        source: 'sessions'
      });
    });

  (d.recommendations || []).slice(0, 5).forEach(r => {
    items.push({
      date: r.recommended_at || 'undated',
      title: `Recommendation: ${r.product_name}`,
      summary: `Records indicate ${r.product_name} was recommended${r.reason ? ': ' + r.reason.slice(0, 80) : ''}.`,
      category: 'recommendation',
      importance: r.priority === 'high' ? 'high' : 'low',
      source: 'recommendations'
    });
  });

  (d.followUps || []).slice(0, 5).forEach(f => {
    items.push({
      date: f.date || f.scheduled_for || 'undated',
      title: 'Follow-up Scheduled',
      summary: `A follow-up${f.message_type ? ' (' + f.message_type + ')' : ''} was scheduled with status: ${f.status || 'pending'}.`,
      category: 'followup',
      importance: 'low',
      source: 'followups'
    });
  });

  (d.referrals || []).slice(0, 3).forEach(r => {
    items.push({
      date: r.referred_at || 'undated',
      title: `Referral — ${r.provider_name}`,
      summary: `Client was referred to ${r.provider_name}${r.reason ? ': ' + r.reason.slice(0, 80) : ''}.`,
      category: 'referral',
      importance: r.urgency === 'urgent' ? 'high' : 'medium',
      source: 'referrals'
    });
  });

  // Sort: dated items newest first, undated last
  items.sort((a, b) => {
    if (a.date === 'undated' && b.date === 'undated') return 0;
    if (a.date === 'undated') return 1;
    if (b.date === 'undated') return -1;
    return b.date > a.date ? 1 : -1;
  });

  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { requireAdmin } = require('./lib/auth');
  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  if (!payload.clientName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'clientName required' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 200, body: JSON.stringify({ items: buildFallbackTimeline(payload), source: 'deterministic' }) };
  }

  try {
    const result = await callClaude(payload);
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error('Empty response');

    let parsed;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return { statusCode: 200, body: JSON.stringify({ items: buildFallbackTimeline(payload), source: 'deterministic' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ items: parsed.items || [], source: 'ai' }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ items: buildFallbackTimeline(payload), source: 'deterministic' }) };
  }
};
