// Daily Briefing Agent
// Takes the raw dashboard snapshot and writes a plain-English briefing for Daron.

async function runDailyBriefingAgent({ rawData }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set.');
  }

  const { date, todaySessions, dueAftercare, unpaidSessions, newIntakes } = rawData;

  const sessionList = todaySessions.length
    ? todaySessions.map(s => `  - ${s.session_time || '?'} — ${s.client_name || 'Unknown'} (${s.service || 'session'}) — ${s.status}`).join('\n')
    : '  No sessions today.';

  const followupList = dueAftercare.length
    ? dueAftercare.map(a => `  - ${a.client_name} — ${a.followup_type} follow-up`).join('\n')
    : '  None due.';

  const unpaidList = unpaidSessions.length
    ? unpaidSessions.map(s => `  - ${s.client_name} — $${s.amount_due || '?'} (${s.payment_status})`).join('\n')
    : '  None.';

  const intakeList = newIntakes.length
    ? newIntakes.map(i => `  - ${i.full_name} — ${i.service_requested || 'general inquiry'}`).join('\n')
    : '  None.';

  const prompt = `You are writing a daily briefing for Daron Royal, an energy healer in Erie, PA who runs Royal Energy Alchemy.

Date: ${date}

TODAY'S SESSIONS:
${sessionList}

FOLLOW-UPS DUE:
${followupList}

UNPAID SESSIONS (last 30 days):
${unpaidList}

NEW UNPROCESSED INTAKES:
${intakeList}

Write a short, friendly, practical briefing in plain English — like a trusted assistant giving Daron a morning update. 4-7 sentences. Cover what's happening today, what needs attention, and any quick wins. Be specific. No bullet points — flowing paragraphs only.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text || null;
}

module.exports = { runDailyBriefingAgent };
