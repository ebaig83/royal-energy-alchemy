# AI Architecture Blueprint

**Royal Energy Alchemy — Current State & Future Vision**

---

## What "AI" Means in This System Today

The system's AI layer is a **statistical pattern detection engine** — not a large language model. It scans structured session, outcome, and recommendation data to surface recurring patterns that a practitioner might not notice manually.

This is intentional. Statistical patterns are:
- Explainable (you can see exactly why a pattern was flagged)
- Reproducible (running detection twice gives the same result)
- Auditable (every pattern is stored in the database with its supporting count)
- Free to run (no API costs — pure database queries)

---

## Current AI Capabilities

### Pattern Detection Engine (`knowledge-engine.js` → `detectPatterns`)

Triggered by: `GET /.netlify/functions/knowledge-engine?section=detect`

**What it scans:**

| Signal | Pattern Type | Example |
|--------|-------------|---------|
| Recurring client concerns | `concern` | "Lower back pain appears in 8+ sessions" |
| Outcome category trends | `outcome` | "Distance Healing shows 72% improvement rate" |
| High-performing interventions | `intervention` | "Crystal Therapy + Sound Healing combo improves outcomes" |
| Product recommendation results | `recommendation` | "Product X has 85% helpful rate across 12 clients" |
| Client retention patterns | `retention` | "Clients with 4+ sessions show higher goal achievement" |
| Service mix patterns | `service` | "Chakra Alignment most popular for energy concerns" |

**How detection works:**
1. Query session_outcomes, sessions, recommendations, and aftercare tables
2. Aggregate by category/type/service using counts and thresholds
3. For each candidate pattern above threshold: upsert to `patterns` table
4. If pattern already exists: increment `supporting_count` (stronger evidence)
5. Return all saved patterns as a list

**Confidence levels:**
- `emerging` — just surfaced, limited data points
- `moderate` — consistent across multiple sessions/clients
- `strong` — highly consistent, large sample

---

## Current AI Outputs

All AI outputs are stored in the database and visible in the Research Intelligence Center:

- **`patterns` table** — detected statistical patterns
- **`research_insights` table** — manually curated interpretations of patterns
- **`case_studies` table** — narrative records generated from flagged sessions

---

## The Phase 2 Vision: 5-System Architecture

The current system is Phase 1 — a single practitioner's operating system. The long-term vision separates it into 5 specialized centers:

### 1. Practitioner OS (`/dashboard`)
*Status: Built*  
Daily operations: clients, sessions, outcomes, goals, aftercare, recommendations.

### 2. Research Intelligence Center (`/research.html`)
*Status: Built (Sprint 12)*  
Pattern library, outcome analytics, case studies, recommendation and service intelligence.

### 3. Knowledge & Content Center (planned)
Turn research insights into publishable content. AI-assisted drafting of:
- Blog posts from case studies
- Social media content from patterns
- Methodology documentation from accumulated insights

**AI role here:** LLM-assisted content generation using structured research data as the factual foundation.

### 4. Training Academy (planned)
Structured learning modules for practitioners who want to replicate the REA methodology. Tracks completion, certifies competency.

**AI role here:** Personalized learning paths based on practitioner knowledge gaps.

### 5. AI Command Center (planned)
A natural-language interface over the entire system. Ask questions like:
- "Which clients haven't had a session in 60 days?"
- "What's my improvement rate for Distance Healing this quarter?"
- "Generate a case study from session X"

**AI role here:** LLM with function-calling over all existing API endpoints.

---

## Proposed LLM Integration (Future)

When LLM capabilities are added, the recommended approach is:

```
User prompt
  → Intent classification (local, fast)
  → Route to appropriate API function(s)
  → Fetch structured data
  → Pass data + prompt to LLM (Claude API)
  → Return narrative response
```

This keeps AI costs low (only charged when user explicitly requests AI output) while grounding all LLM responses in real database data — no hallucination risk on client facts.

**Recommended model:** Claude Haiku 4.5 for fast Q&A, Claude Sonnet 4.6 for content generation.

---

## Multi-Practitioner Expansion

The current schema is single-practitioner. The path to multi-practitioner:

1. Add `practitioner_id` column to: `sessions`, `clients`, `session_outcomes`, `patterns`
2. Add row-level security policies in Supabase (each practitioner sees only their data)
3. Add a practitioner registry table
4. Replace single PIN auth with practitioner-specific credentials

The pattern detection engine would then run per-practitioner **and** across the network — surfacing both individual patterns and cross-practitioner insights. This is the core value proposition of the Healer Network model: individual practitioners get their own intelligence, but the network produces aggregate research no single practitioner could generate alone.

---

## Data Quality Requirements for Good AI Output

The pattern detection engine is only as good as the data going in. Key completeness requirements:

| Field | Why It Matters |
|-------|---------------|
| `outcome_category` on every session with an outcome | Required for improvement rate calculations |
| `improvement_level` (1–10) | Powers quantitative pattern thresholds |
| `research_flag` on notable sessions | Surfaces raw material for case studies |
| `outcome_status` on recommendations | Required for helpful rate calculations |
| Client goals with `status` updates | Required for retention and goal achievement patterns |

**Target:** >80% of completed sessions should have an outcome record. The data quality report (`analytics?section=data-quality`) tracks this metric.
