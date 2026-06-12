// Intake Agent
// Called after a form submission is saved.
// 1. Finds or creates the client record
// 2. Creates a pending session record
// 3. Marks the submission as processed
// 4. Optionally calls Claude to generate an intake summary

async function runIntakeAgent({ submission, sb, ip }) {
  const { full_name, email, phone, service_requested, preferred_window_1, preferred_window_2, message } = submission;

  // ── 1. Match existing client: email → phone → needs_review ──────────────────
  let clientId    = null;
  let matchStatus = 'unmatched';
  const candidates = new Set();

  if (email) {
    const { data: rows } = await sb
      .from('clients').select('id').eq('email', email.toLowerCase());
    (rows || []).forEach(r => candidates.add(r.id));
  }

  if (phone) {
    const normalised = phone.replace(/\D/g, '');
    if (normalised.length >= 7) {
      const { data: rows } = await sb
        .from('clients').select('id, phone');
      (rows || []).forEach(r => {
        if (r.phone && r.phone.replace(/\D/g, '') === normalised) candidates.add(r.id);
      });
    }
  }

  if (candidates.size === 1) {
    clientId    = [...candidates][0];
    matchStatus = 'matched';
  } else if (candidates.size > 1) {
    // Multiple possible matches — flag for manual review, use first
    clientId    = [...candidates][0];
    matchStatus = 'needs_review';
  }

  // ── 2. Create client if not found ──────────────────────────────────────────
  if (!clientId) {
    const { data: newClient, error } = await sb
      .from('clients')
      .insert({
        full_name: full_name.trim(),
        email:     email  ? email.toLowerCase() : null,
        phone:     phone  || null,
        source:    'website_form',
        status:    'active',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Could not create client: ${error.message}`);
    clientId    = newClient.id;
    matchStatus = 'unmatched'; // new client, no prior record
  }

  // ── 3. Create a pending session ───────────────────────────────────
  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .insert({
      client_id:     clientId,
      client_name:   full_name.trim(),
      service:       service_requested || null,
      status:        'pending',
      payment_status:'unpaid',
      source:        'website_form',
      seller_notes:  message || null,
      location_type: 'distance',
    })
    .select('id')
    .single();

  if (sessErr) throw new Error(`Could not create session: ${sessErr.message}`);

  // ── 4. Optional Claude summary ────────────────────────────────────
  let agentSummary = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      agentSummary = await callClaude({
        prompt: buildIntakePrompt({ full_name, service_requested, preferred_window_1, preferred_window_2, message }),
      });
    } catch (err) {
      console.error('[intake-agent] Claude error:', err.message);
    }
  }

  // ── 5. Mark submission processed ─────────────────────────────────
  const coreUpdate = {
    processed:     true,
    processed_at:  new Date().toISOString(),
    client_id:     clientId,
    session_id:    session.id,
    agent_summary: agentSummary,
    match_status:  matchStatus,
    matched_at:    matchStatus === 'matched' || matchStatus === 'needs_review'
                     ? new Date().toISOString() : null,
  };
  const { error: updateErr } = await sb.from('intake_submissions').update(coreUpdate).eq('id', submission.id);
  // If Sprint 2 migration not yet run, retry without new columns so processed=true is always saved
  if (updateErr && (updateErr.message.includes('column') || updateErr.code === '42703')) {
    const { match_status: _ms, matched_at: _ma, ...baseUpdate } = coreUpdate;
    const { error: fallbackErr } = await sb.from('intake_submissions').update(baseUpdate).eq('id', submission.id);
    if (fallbackErr) console.error('[intake-agent] Failed to mark submission processed:', fallbackErr.message);
  } else if (updateErr) {
    console.error('[intake-agent] Unexpected update error:', updateErr.message);
  }

  return { clientId, sessionId: session.id, agentSummary };
}

function buildIntakePrompt({ full_name, service_requested, preferred_window_1, preferred_window_2, message }) {
  return `You are an intake assistant for Royal Energy Alchemy, an energy healing practice run by Daron Royal in Erie, PA.

A new client has submitted a booking request. Write a brief internal intake summary (3-5 sentences) that Daron can read at a glance before the session. Focus on what the client needs, what service they want, and any notable details from their message. Do not make up information not in the form.

Client name: ${full_name}
Service requested: ${service_requested || 'Not specified'}
Preferred time 1: ${preferred_window_1 || 'Not specified'}
Preferred time 2: ${preferred_window_2 || 'Not specified'}
Client message: ${message || 'No message provided'}

Write the summary in plain text, no bullet points.`;
}

async function callClaude({ prompt }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

module.exports = { runIntakeAgent };
