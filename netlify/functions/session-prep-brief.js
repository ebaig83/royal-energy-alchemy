// /.netlify/functions/session-prep-brief
// Generates a structured JSON session preparation brief from existing client data.
// Never diagnoses. Uses only supplied data. Returns six structured sections.

const https = require("https");

const SYSTEM_PROMPT = `You are a documentation assistant for a holistic energy healing practitioner. Your task is to produce a structured session preparation brief based strictly on the client data provided.

Rules you must follow without exception:
- Use only the data provided. Do not invent, infer, or speculate beyond what is explicitly stated.
- Never diagnose or suggest any medical, psychological, or clinical condition.
- Never make certainty claims about outcomes or causes.
- Use practitioner-safe language throughout: "client reports," "notes indicate," "records show," "intake states," "recommended follow-up."
- Write in third person.
- If a field has no data to support it, return an empty array or null — do not fabricate content.
- Return ONLY valid JSON with exactly this structure. No markdown. No prose outside the JSON:
{
  "lastSessionDate": "string describing last session date and service, or null",
  "lastSessionOutcome": "string in format 'State: X → Y (±Z net)' using state_before/state_after, or null if no state data",
  "improvementTrend": "Improving | Stable | Declining | Insufficient Data — based on state arc across sessions",
  "primaryConcerns": ["up to 4 short strings from intake or session notes"],
  "outstandingRecs": ["short string per unpurchased recommendation, up to 5"],
  "followUpItems": ["short string per pending follow-up or aftercare item, up to 5"],
  "environmentalStatus": "one sentence on env conditions from session notes (moon phase, weather, season), or null if no env_notes available",
  "discussionTopics": ["3 to 5 suggested practitioner discussion topics based on the record"]
}`;

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
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
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("Failed to parse Claude response")); }
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
  lines.push(`CLIENT: ${d.clientName} | Status: ${d.status || "active"}`);

  // Sessions + state tracking
  if (d.sessions && d.sessions.length) {
    const sorted = [...d.sessions].sort((a, b) =>
      (b.session_date || "") > (a.session_date || "") ? 1 : -1
    );
    const last = sorted[0];
    lines.push(`\nLAST SESSION: ${last.session_date || "—"} | Service: ${last.service || last.service_type || "—"} | Status: ${last.status || "—"}`);
    if (last.state_before != null && last.state_after != null) {
      const net = last.state_after - last.state_before;
      lines.push(`LAST SESSION STATE: Before=${last.state_before} → After=${last.state_after} | Net change: ${net >= 0 ? '+' : ''}${net}`);
    }
    lines.push(`TOTAL SESSIONS: ${d.sessions.length} (${d.sessions.filter(s => s.status === "completed").length} completed)`);

    // Improvement trend from state data
    const withState = sorted.filter(s => s.state_before != null && s.state_after != null);
    if (withState.length >= 2) {
      const nets = withState.map(s => s.state_after - s.state_before);
      const avgNet = nets.reduce((a, b) => a + b, 0) / nets.length;
      const trend = avgNet > 0.3 ? 'Improving' : avgNet < -0.3 ? 'Declining' : 'Stable';
      lines.push(`STATE TREND (${withState.length} sessions with data): avg net change ${avgNet >= 0 ? '+' : ''}${avgNet.toFixed(1)} → ${trend}`);
      // No-improvement flag
      const noImprovement = withState.slice(0, 3).every(s => s.state_after <= s.state_before);
      if (noImprovement && withState.length >= 2) {
        lines.push(`FLAG: Last ${Math.min(3, withState.length)} sessions show no measurable improvement (state_after <= state_before each time)`);
      }
    } else if (withState.length === 1) {
      lines.push(`STATE TREND: Insufficient data (only 1 session with state tracking)`);
    } else {
      lines.push(`STATE TREND: No state tracking data available`);
    }
  } else {
    lines.push(`\nSESSIONS: None on record`);
  }

  // Intake
  if (d.intake && d.intake.length) {
    lines.push(`\nINTAKE DATA:`);
    d.intake.slice(0, 3).forEach((i) => {
      const f = [];
      if (i.service_requested) f.push(`Service: ${i.service_requested}`);
      if (i.message)           f.push(`Concern: ${i.message.slice(0, 200)}`);
      if (i.agent_summary)     f.push(`Assessment summary: ${i.agent_summary.slice(0, 250)}`);
      if (f.length) lines.push("  " + f.join(" | "));
    });
  }

  // Session notes + env_notes extraction
  if (d.notes && d.notes.length) {
    lines.push(`\nSESSION NOTES (most recent first):`);
    d.notes.slice(0, 4).forEach((n) => {
      const txt = (n.content || n.raw_notes || "").slice(0, 250);
      if (txt) lines.push(`  [${(n.created_at || "—").slice(0, 10)}] ${txt}`);
      if (n.env_notes) {
        try {
          const env = typeof n.env_notes === 'string' ? JSON.parse(n.env_notes) : n.env_notes;
          const parts = [];
          if (env.moon)    parts.push(`Moon: ${env.moon}`);
          if (env.weather) parts.push(`Weather: ${env.weather}`);
          if (env.season)  parts.push(`Season: ${env.season}`);
          if (parts.length) lines.push(`  ENV [${(n.created_at || "—").slice(0, 10)}]: ${parts.join(', ')}`);
        } catch (_) { /* ignore malformed env_notes */ }
      }
    });
  }

  // Recommendations
  if (d.recommendations && d.recommendations.length) {
    const outstanding = d.recommendations.filter((r) =>
      !r.outcome_status || r.outcome_status === "recommended"
    );
    if (outstanding.length) {
      lines.push(`\nOUTSTANDING RECOMMENDATIONS (${outstanding.length} awaiting outcome):`);
      outstanding.slice(0, 6).forEach((r) => {
        const status = r.outcome_status || (r.purchased === "yes" ? "purchased" : r.purchased === "no" ? "declined" : "recommended");
        lines.push(
          `  - ${r.product_name} (${r.category || "other"}, ${r.priority || "medium"} priority, status: ${status})` +
          (r.reason ? ` — ${r.reason.slice(0, 100)}` : "")
        );
      });
    }
  }

  // Follow-ups / aftercare
  if (d.followUps && d.followUps.length) {
    lines.push(`\nPENDING FOLLOW-UPS / AFTERCARE (${d.followUps.length}):`);
    d.followUps.slice(0, 6).forEach((f) => {
      const parts = [];
      if (f.scheduled_for || f.date) parts.push(`Due: ${f.scheduled_for || f.date}`);
      if (f.message_type)            parts.push(`Type: ${f.message_type}`);
      if (f.report || f.outcome_notes)
        parts.push(`Note: ${(f.report || f.outcome_notes || "").slice(0, 100)}`);
      lines.push("  - " + (parts.join(" | ") || "Pending item"));
    });
  }

  // Active action plans
  if (d.plans && d.plans.length) {
    const active = d.plans.filter((p) => p.status === "active");
    if (active.length) {
      lines.push(`\nACTIVE ACTION PLANS:`);
      active.slice(0, 3).forEach((p) => {
        if (p.immediate_steps)       lines.push(`  Steps: ${p.immediate_steps.slice(0, 120)}`);
        if (p.aftercare_tasks)       lines.push(`  Aftercare: ${p.aftercare_tasks.slice(0, 100)}`);
        if (p.environmental_actions) lines.push(`  Env actions: ${p.environmental_actions.slice(0, 100)}`);
      });
    }
  }

  // Environmental conditions
  if (d.recentEnvironment && d.recentEnvironment.length) {
    lines.push(`\nRECENT ENVIRONMENTAL CONDITIONS (for context only):`);
    d.recentEnvironment.slice(0, 4).forEach((e) => {
      const parts = [];
      if (e.date)          parts.push(e.date);
      if (e.schumann_level || e.schumann) parts.push(`Schumann: ${e.schumann_level || e.schumann}`);
      if (e.solar_flux)    parts.push(`Solar: ${e.solar_flux}`);
      if (e.notes)         parts.push(e.notes.slice(0, 80));
      if (parts.length) lines.push("  " + parts.join(" | "));
    });
  }

  lines.push(`\nReturn only the JSON session preparation brief. No other text.`);
  return lines.join("\n");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const { requireAdmin } = require("./lib/auth");
  const { logAIUsage } = require("./lib/ai-log");
  const auth = await requireAdmin(event);
  if (auth.error) return auth.error;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };
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
    const text = result?.content?.[0]?.text;
    if (!text) throw new Error("Empty response from Claude");

    let brief;
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
      brief = JSON.parse(cleaned);
    } catch {
      throw new Error("Response was not valid JSON — try regenerating");
    }

    logAIUsage({ feature: 'session_prep_brief', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: true, responseTimeMs: Date.now() - start, tokensUsed: result?.usage?.output_tokens || null });
    return { statusCode: 200, body: JSON.stringify({ brief }) };
  } catch (err) {
    logAIUsage({ feature: 'session_prep_brief', model: 'claude-haiku-4-5-20251001', clientId: payload.clientId || null, success: false, responseTimeMs: Date.now() - start, errorMessage: err.message });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
