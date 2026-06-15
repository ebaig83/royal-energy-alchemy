# Administrator Technical Guide

**Royal Energy Alchemy — Architecture & Operations Reference**

---

## Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Hosting | Netlify | Static site + serverless functions |
| Database | Supabase (PostgreSQL) | `pqlynrmacrorkfludmms.supabase.co` |
| Frontend | Vanilla HTML/CSS/JS | No framework, no build step |
| Functions | Node.js 18 | `website/netlify/functions/` |
| Auth | Custom PIN + JWT-style token | `verify-pin` function |
| DNS/CDN | Netlify Edge | Automatic HTTPS |

**Production URL:** https://royal-energy-alchemy.netlify.app  
**Repository branch:** `main` → auto-deploys on push

---

## Repository Structure

```
royal-energy-alchemy/
  website/
    netlify/
      functions/          # 38 serverless functions
        verify-pin.js
        clients.js
        sessions.js
        outcomes.js
        analytics.js
        knowledge-engine.js
        aftercare.js
        recommendations.js
        goals.js
        … (29 more)
    migrations/           # SQL migration files (run manually in Supabase)
    docs/                 # This documentation
    qa/                   # QA test suites
    dashboard.html        # Practitioner OS
    research.html         # Research Intelligence Center
    index.html            # Landing page
```

---

## Database Schema

### Core Tables (Sprint 1–8)
- `clients` — client profiles
- `sessions` — session records (linked to clients)
- `aftercare` — aftercare records + satisfaction survey columns
- `recommendations` — product recommendations per session

### Outcome & Research Tables (Sprint 9–10)
- `session_outcomes` — structured outcome records (linked to sessions + clients)
- `client_goals` — client healing goals (linked to clients)
- `patterns` — AI-detected patterns (unique constraint on `title`)
- `research_insights` — curated insights for publication
- `case_studies` — anonymized session narratives

### Key Constraints
- `patterns.title` has a `UNIQUE` index (`idx_patterns_title`)
- `session_outcomes.outcome_category` CHECK: `improved|no_change|worse|mixed`
- `patterns.pattern_type` CHECK: `concern|intervention|outcome|recommendation|retention|service`
- `patterns.confidence_level` CHECK: `emerging|moderate|strong`

---

## Authentication Flow

1. User submits PIN to `POST /.netlify/functions/verify-pin`
2. Function compares PIN to `PRACTITIONER_PIN` env var (Netlify dashboard)
3. On match: returns `{ token }` (a signed or random token stored in `DASHBOARD_TOKEN` env var)
4. Frontend stores token in `sessionStorage` as `rea_api_token`
5. All subsequent API calls include `X-Dashboard-Token: <token>` header
6. Each function validates the header before processing

**Environment variables required:**
- `PRACTITIONER_PIN` — the 6-digit PIN
- `DASHBOARD_TOKEN` — the session token returned on valid login
- `SUPABASE_URL` — `https://pqlynrmacrorkfludmms.supabase.co`
- `SUPABASE_SERVICE_KEY` — service role key (from Supabase dashboard)

---

## Serverless Functions Reference

### `knowledge-engine.js`
Multi-route function for research intelligence. Route via `?section=`:

| `?section=` | Returns |
|-------------|---------|
| `dashboard` | Aggregate KPIs, recent patterns, recent insights |
| `patterns` | Full pattern list |
| `detect` | Runs AI pattern detection, upserts results |
| `insights` | Research insights list |
| `case_studies` | Case studies list |
| `rec_intelligence` | Product recommendation performance |
| `service_intelligence` | Per-service outcome and retention stats |

POST to `knowledge-engine` creates a new pattern: `{ pattern_type, title, description, supporting_count, confidence_level, content_tags }`. Returns 409 if `title` already exists (unique constraint).

### `outcomes.js`
- `GET ?research=1` — all outcomes where `research_flag = true`
- `GET ?session_id=<id>` — outcomes for a session
- `GET ?goals=1&client_id=<id>` — goals for a client
- `POST` — create outcome record

### `analytics.js`
- `GET ?section=outcomes` — aggregate outcome summary + recent list
- `GET ?section=practitioner-outcomes` — breakdown by practitioner (future)
- `GET ?section=cross-client` — cross-client pattern summary
- `GET ?section=data-quality` — data completeness checks

---

## Running Migrations

Migrations are plain SQL files. Run them manually in the **Supabase SQL Editor**:

1. Go to https://supabase.com/dashboard → project → SQL Editor
2. Open the migration file from `website/migrations/`
3. Paste and run

**Migration order:**
1. `2026-06-16-outcome-tracking.sql` (session_outcomes, client_goals, aftercare columns)
2. `2026-06-17-knowledge-engine.sql` (patterns, research_insights, case_studies)
3. `2026-06-19-repair-sprint9-sprint10.sql` (idempotent repair — safe to re-run)
4. `2026-06-18-seed-data.sql` (25 clients, 62 sessions, 40 outcomes, seed records)

---

## QA Suite

Located in `website/qa/`. Run with Node.js against the live production URL:

```bash
node qa/sprint11-qa.js
```

The suite runs 12 phases covering all major API endpoints. Expected baseline: **PASS: 177, FAIL: 0, WARN: 0, SKIP: ≥1**.

A SKIP on `patterns.create` is normal — it means the unique constraint is working correctly (duplicate title was skipped).

---

## Deploying

Push to `main` branch → Netlify auto-deploys within ~60 seconds.

```bash
git add <files>
git commit -m "message"
git push origin main
```

Monitor deploy status at: https://app.netlify.com (or check the Netlify badge in the repo).

---

## Common Issues

**"HTTP 401" on API calls:** Token expired or missing. User needs to re-enter PIN. Check `DASHBOARD_TOKEN` env var matches what `verify-pin` returns.

**"HTTP 500" on knowledge-engine:** Usually a Supabase query error. Check `SUPABASE_SERVICE_KEY` is valid and tables exist.

**"HTTP 404" on functions locally:** Netlify functions don't run on the static file server. Use `netlify dev` for local function testing, or test against production.

**Pattern creation returns 409:** Expected behavior — a pattern with that title already exists. The QA suite treats this as SKIP (not FAIL).
