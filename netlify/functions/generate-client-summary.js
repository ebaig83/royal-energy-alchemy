const https = require("https");

const SYSTEM_PROMPT = `You are a documentation assistant for a holistic energy healing practitioner. Your role is to produce concise, factual client summaries based only on the data provided. You must follow these rules without exception:

- Use only the data provided. Do not invent, infer, or speculate beyond what is explicitly stated.
- Never diagnose, assess, or suggest any medical, psychological, or clinical condition.
- Never make certainty claims about outcomes (e.g. do not say "the session resolved X").
- Use practitioner-safe language throughout: "client reports," "notes indicate," "intake states," "recommended follow-up," "session records show."
- Write in third person (e.g. "Client reports…" not "You reported…").
- Do not include any statement that could be read as a promise, guarantee, or medical opinion.
- If a field is absent or empty, omit it — do not speculate.
- Format as plain prose paragraphs, no markdown headers or bullet lists.`;

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(payload) }]
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Failed to parse Claude response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(d) {
  const lines = [];
  lines.push(`CLIENT NAME: ${d.clientName}`);
  lines.push(`STATUS: ${d.status || "active"}`);

  if (d.contactInfo && (d.contactInfo.city || d.contactInfo.state)) {
    lines.push(`LOCATION: ${[d.contactInfo.city, d.contactInfo.state].filter(Boolean).join(", ")}`);
  }
  if (d.contactInfo && d.contactInfo.servicePreference) {
    lines.push(`SERVICE PREFERENCE: ${d.contactInfo.servicePreference}`);
  }

  if (d.sessions && d.sessions.length) {
    lines.push(`\nSESSION RECORDS (${d.sessions.length} total):`);
    d.sessions.slice(0, 10).forEach((s) => {
      const parts = [`Date: ${s.date}`, `Round: ${s.round || 1}`];
      if (s.price > 0) parts.push(`Amount: $${s.price}`);
      if (s.tags && s.tags.length) parts.push(`Tags: ${s.tags.join(", ")}`);
      if (s.notes) parts.push(`Notes: ${s.notes}`);
      lines.push("  - " + parts.join(" | "));
    });
  }

  if (d.intake && d.intake.length) {
    lines.push(`\nINTAKE DATA:`);
    d.intake.slice(0, 3).forEach((i) => {
      const fields = [];
      if (i.concern)   fields.push(`Concern: ${i.concern}`);
      if (i.goals)     fields.push(`Goals: ${i.goals}`);
      if (i.symptoms)  fields.push(`Symptoms noted: ${i.symptoms}`);
      if (i.medical)   fields.push(`Medical notes: ${i.medical}`);
      if (i.service)   fields.push(`Service requested: ${i.service}`);
      if (fields.length) lines.push("  " + fields.join(" | "));
    });
  }

  if (d.followUps && d.followUps.length) {
    lines.push(`\nFOLLOW-UP RECORDS:`);
    d.followUps.slice(0, 5).forEach((f) => {
      const parts = [];
      if (f.date)   parts.push(`Date: ${f.date}`);
      if (f.status) parts.push(`Status: ${f.status}`);
      if (f.report) parts.push(`Client report: ${f.report}`);
      lines.push("  - " + parts.join(" | "));
    });
  }

  if (d.timeline && d.timeline.length) {
    lines.push(`\nTIMELINE NOTES (most recent first):`);
    d.timeline.slice(0, 8).forEach((t) => {
      lines.push(`  [${t.date || t.createdAt || "—"}] ${t.description || ""}`);
    });
  }

  if (d.recentEnvironment && d.recentEnvironment.length) {
    lines.push(`\nRECENT ENVIRONMENTAL CONDITIONS (for context only):`);
    d.recentEnvironment.slice(0, 3).forEach((e) => {
      if (e.date && e.schumann) lines.push(`  ${e.date} — Schumann: ${e.schumann}`);
    });
  }

  lines.push(`\nUsing only the data above, write a 3–4 sentence practitioner summary of this client's history and recommended follow-up. Use practitioner-safe language. Do not diagnose or invent any information.`);

  return lines.join("\n");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const { requireAdmin, respond } = require("./lib/auth");
  const { logAIUsage } = require("./lib/ai-log");
  const auth = requireAdmin(event);
  if (auth.error) return auth.error;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!payload.clientName) {
    return { statusCode: 400, body: JSON.stringify({ error: "clientName required" }) };
  }

  const start = Date.now();
  try {
    const result = await callClaude(payload);
    const summary = result?.content?.[0]?.text;
    if (!summary) throw new Error("Empty response from Claude");
    logAIUsage({ feature: 'generate_client_summary', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: true, responseTimeMs: Date.now() - start, tokensUsed: result?.usage?.output_tokens || null });
    return { statusCode: 200, body: JSON.stringify({ summary }) };
  } catch (err) {
    logAIUsage({ feature: 'generate_client_summary', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: false, responseTimeMs: Date.now() - start, errorMessage: err.message });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
