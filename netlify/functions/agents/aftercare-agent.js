// Aftercare Agent
// Called when a session is marked completed.
// Schedules the 5 follow-up records: 24h, 48h, 72h, 1mo, 3mo.
// Optionally generates a personalized message for each.

const FOLLOWUP_OFFSETS = [
  { type: '24h',  hours: 24 },
  { type: '48h',  hours: 48 },
  { type: '72h',  hours: 72 },
  { type: '1mo',  hours: 24 * 30 },
  { type: '3mo',  hours: 24 * 90 },
];

async function scheduleAftercare({ session, sb }) {
  const baseDate = new Date(session.session_date + 'T12:00:00Z'); // noon on session day

  // Don't duplicate — check if aftercare already exists for this session
  const { data: existing } = await sb
    .from('aftercare')
    .select('id')
    .eq('session_id', session.id)
    .limit(1);

  if (existing && existing.length > 0) return;

  const rows = FOLLOWUP_OFFSETS.map(({ type, hours }) => ({
    session_id:     session.id,
    client_id:      session.client_id   || null,
    client_name:    session.client_name || null,
    followup_type:  type,
    scheduled_for:  new Date(baseDate.getTime() + hours * 3600 * 1000).toISOString(),
    status:         'scheduled',
    channel:        'email',
    message_body:   null, // generated on demand when sent
  }));

  await sb.from('aftercare').insert(rows);
}

async function generateAfterMessage({ aftercare, session, sb }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // Fetch session notes for context
  const { data: notes } = await sb
    .from('session_notes')
    .select('content, energy_findings, recommendations')
    .eq('session_id', aftercare.session_id)
    .limit(3);

  const noteContext = (notes || [])
    .map(n => [n.energy_findings, n.content, n.recommendations].filter(Boolean).join(' — '))
    .join('\n');

  const prompt = `You are writing a follow-up message on behalf of Daron Royal, an energy healer in Erie, PA.

This is a ${aftercare.followup_type} follow-up message to a client named ${aftercare.client_name || 'the client'} after their ${session?.service || 'energy healing'} session.

Session notes context:
${noteContext || 'No notes available.'}

Write a warm, personal, professional follow-up message (3-5 sentences). Ask how they are feeling. Reference the session naturally without being clinical. Invite them to reply or book again if needed. Do not include a subject line — just the message body. Write as Daron Royal.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error('[aftercare-agent] Claude error:', err.message);
    return null;
  }
}

module.exports = { scheduleAftercare, generateAfterMessage };
