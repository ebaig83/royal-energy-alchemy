// Session Notes Agent
// Takes Daron's raw session note and returns a polished summary + recommendations.

async function runSessionNotesAgent({ note, sb }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set.');
  }

  // Fetch client history for context
  let clientContext = '';
  if (note.client_id) {
    const { data: prevNotes } = await sb
      .from('session_notes')
      .select('content, energy_findings, recommendations, created_at')
      .eq('client_id', note.client_id)
      .neq('id', note.id)
      .order('created_at', { ascending: false })
      .limit(3);

    if (prevNotes && prevNotes.length > 0) {
      clientContext = '\n\nPrevious session context:\n' + prevNotes
        .map(n => `[${n.created_at?.slice(0,10)}] ${n.energy_findings || n.content}`)
        .join('\n');
    }
  }

  const prompt = `You are an assistant for Daron Royal, an energy healer. Your job is to take his raw session notes and produce a clean, structured summary for his records.

Raw session note:
${note.content}

${note.energy_findings ? `Energy findings noted: ${note.energy_findings}` : ''}
${note.removals_done?.length ? `Work done: ${note.removals_done.join(', ')}` : ''}
${clientContext}

Produce a JSON object with exactly these keys:
- "summary": A clean 2-4 sentence summary of the session in professional but accessible language
- "recommendations": What Daron should recommend to the client next (1-3 sentences, practical)

Respond with only valid JSON, no extra text.`;

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
  const text = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(text);
  } catch {
    return { summary: text, recommendations: null };
  }
}

module.exports = { runSessionNotesAgent };
