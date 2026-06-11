# Royal Energy Alchemy — QA Agent Guide

The QA Agent (`qa/qa-agent.js`) must pass before any new milestone begins.
No milestone is considered complete until the agent exits 0 and all tests in the
active suite report PASS.

Run from the `website/` directory:

```
npm run qa
# or
node qa/qa-agent.js
```

Requires `qa/.env` (gitignored — never commit credentials):

```
QA_SITE_URL=https://royal-energy-alchemy.netlify.app
QA_SUPABASE_URL=https://pqlynrmacrorkfludmms.supabase.co
QA_SUPABASE_ANON=<supabase anon public key>
QA_ADMIN_EMAIL=droyal168@gmail.com
QA_ADMIN_PASSWORD=<daron dashboard password>
QA_VERBOSE=0
```

---

## Output format

Each test reports:

| Field | Meaning |
|---|---|
| PASS / FAIL / SKIP | Result |
| Error | Exact message or exception |
| Likely cause | Root cause category |
| File / table / endpoint | Where to look |
| Fix | Recommended remediation |

Summary line at end: `N passed | N failed | N skipped`
Exit 0 = all pass → advance milestone. Exit 1 = blockers → do not advance.

---

## Test suites

Suites are activated in order. A suite does not run if its predecessor failed.
Each suite maps to one milestone. The agent runs only the suite(s) enabled in
`qa/.env` via `QA_SUITE=<name>` (default: `clients`).

---

### Suite 0 — Deployment

> Milestone gate: every deploy. Runs automatically before any other suite.

| # | Test | Pass condition |
|---|---|---|
| 0.1 | Env vars present | All 5 QA vars set in `qa/.env` |
| 0.2 | Site reachable | `GET QA_SITE_URL` returns 200 |
| 0.3 | Netlify functions reachable | `GET /.netlify/functions/clients` returns 401 (auth gate, not 404/502) |
| 0.4 | Auth endpoint live | `POST /.netlify/functions/auth` accepts JSON |
| 0.5 | No build errors in response headers | No `X-Nf-Error` header on 200 responses |

---

### Suite 1 — Authentication

> Milestone gate: Auth milestone.

| # | Test | Pass condition |
|---|---|---|
| 1.1 | Valid login returns JWT | Supabase sign-in with admin creds returns `access_token` |
| 1.2 | JWT accepted by API | `GET /clients` with valid token returns 200 |
| 1.3 | Missing token rejected | `GET /clients` with no Authorization → 401 |
| 1.4 | Invalid token rejected | `GET /clients` with `Bearer garbage` → 401 |
| 1.5 | Non-admin email rejected | Sign in as non-admin Supabase user → API returns 403 |
| 1.6 | Session persists across requests | Two sequential authenticated calls both succeed |

---

### Suite 2 — Clients tab ✅ PASSED 2026-06-11

> Milestone gate: Clients tab milestone.

| # | Test | Pass condition |
|---|---|---|
| 2.1 | Load clients | `GET /clients` returns `{ clients: [...] }` with 200 |
| 2.2 | Create client | `POST /clients` with valid payload → 201, `id` in response |
| 2.3 | Refresh persistence | Re-fetch client list → newly created client present |
| 2.4 | Edit client | `PATCH /clients?id=<id>` with updated fields → 200, fields changed |
| 2.5 | Open profile modal | `GET /clients?id=<id>` returns `client`, `sessions`, `aftercare` |
| 2.6 | Open timeline modal | `GET /timeline?client_id=<id>` returns `client`, `stats`, `timeline` |
| 2.7 | Archive client | `PATCH /clients?id=<id>` `{status:"archived"}` → 200 |
| 2.8 | Archive is soft delete | Archived client still retrievable via `GET /clients?id=<id>` |
| 2.9 | Audit log entry written | `audit_logs` row exists for create + patch actions |
| 2.10 | No permission errors | No `permission denied for table` in any response |
| 2.11 | RLS blocks anon direct access | Anon Supabase client `SELECT * FROM clients` → empty / error, not data |
| 2.12 | service_role access works | Netlify function can INSERT + SELECT via service_role key |

**Result — 2026-06-11:** 12 passed · 0 failed · 0 skipped · Exit 0

**Known blocker (resolved):** `permission denied for table clients`
- **Root cause:** service_role Postgres role lacked explicit table-level GRANTs in this Supabase project config despite having `BYPASSRLS`.
- **Resolution:** `supabase/fix_service_role_grants.sql` — grants SELECT/INSERT/UPDATE/DELETE on all tables and sequences to service_role, plus `ALTER DEFAULT PRIVILEGES` for future tables. Run once in Supabase SQL Editor. Confirmed resolved.
- **Files:** `website/supabase/fix_service_role_grants.sql`, `website/netlify/functions/lib/supabase.js`

---

### Suite 3 — Client Timeline

> Milestone gate: Timeline milestone (part of Clients tab extended work).

| # | Test | Pass condition |
|---|---|---|
| 3.1 | Timeline loads for client | `GET /timeline?client_id=<id>` returns 200 with `timeline` array |
| 3.2 | Stats bar accurate | `stats.totalSessions` matches count of session rows for client |
| 3.3 | Session events present | Timeline contains at least one `type:"session"` entry if sessions exist |
| 3.4 | Manual event POST | `POST /session-notes` with `{client_id, note_type:"note", content}` → 201 |
| 3.5 | Manual event appears in timeline | Re-fetch timeline → new `type:"note"` entry visible |
| 3.6 | session_id optional | POST with only `client_id` (no `session_id`) → 201, not 400 |
| 3.7 | Empty timeline handled | Client with no events returns `timeline: []`, not 500 |

---

### Suite 4 — Session Notes + Compliance + Environment

> Milestone gate: Session Notes milestone. **NEXT ACTIVE SUITE.**

#### 4a — Session Notes API

| # | Test | Pass condition |
|---|---|---|
| 4.1 | Create session note | `POST /session-notes` with `session_id` → 201 |
| 4.2 | Note tied to session | `GET /session-notes?session_id=<id>` returns note |
| 4.3 | Note tied to client | `GET /session-notes?client_id=<id>` returns note |
| 4.4 | Note appears in client timeline | Note shows as `type:"note"` in `/timeline?client_id=<id>` |
| 4.5 | Edit note | `PATCH /session-notes?id=<id>` with updated content → 200 |
| 4.6 | Note type validation | POST with no `session_id` and no `client_id` → 400 |
| 4.7 | Content required | POST with empty `content` → 400 |
| 4.8 | Audit log entry | `audit_logs` row written for create + patch |
| 4.9 | Agent enhancement skipped without key | POST with `enhance:true` but no `ANTHROPIC_API_KEY` → 201, no crash |
| 4.10 | RLS blocks anon | Anon client cannot SELECT from `session_notes` |

#### 4b — Waiver status visibility

| # | Test | Pass condition |
|---|---|---|
| 4.11 | Waiver badge — missing | Client without `waiver` tag shows "⚠ Waiver Missing" badge in profile modal and session notes modal |
| 4.12 | Waiver badge — on file | Client with `tags` including `"waiver"` shows "✓ Waiver on File" badge in both modals |
| 4.13 | Waiver warning in missing requirements box | Profile modal shows "Waiver not on file" in Needs Completion block when tag absent |
| 4.14 | Waiver tag roundtrip | PATCH `/clients?id=<id>` with `tags:["waiver"]` → 200; badge updates on next profile open |

#### 4c — Assessment / Intake status visibility

| # | Test | Pass condition |
|---|---|---|
| 4.15 | Intake badge — missing | Client with no `intake_submissions` row shows "⚠ Intake Missing" badge |
| 4.16 | Intake badge — complete | Client with `intake_submissions` row shows "✓ Intake Complete · <date>" badge |
| 4.17 | Intake summary visible | Profile modal and session notes modal show intake `service_requested` and `message` when intake exists |
| 4.18 | Intake appears in timeline | `GET /timeline?client_id=<id>` returns `type:"intake"` event when submission exists |
| 4.19 | Intake warning in missing requirements | Profile shows "No intake on file" in Needs Completion when no submission |

#### 4d — Environmental data section

| # | Test | Pass condition |
|---|---|---|
| 4.20 | Env section renders in session notes modal | Opening any session shows "Environmental Context" section with observational disclaimer |
| 4.21 | Moon phase pill visible | When env log has data for session date, moon phase pill renders |
| 4.22 | Schumann pill visible | When env log has Schumann data, pill renders with correct color per level |
| 4.23 | Env notes textarea present | "Practitioner Environmental Notes" textarea renders and accepts input |
| 4.24 | Client sensitivity field present | "Client-Reported Environmental Sensitivity" input renders |
| 4.25 | Env notes save with note | POST `/session-notes` with `env_notes:{notes:"…"}` → 201; `env_notes` field in response |
| 4.26 | Env notes display on saved notes | Previously saved note with `env_notes` shows 🌿 env summary line in notes list |
| 4.27 | Env notes PATCH accepted | PATCH `/session-notes?id=<id>` with `{env_notes:{…}}` → 200 |
| 4.28 | No causal language in UI | Environmental section label includes "observational only, not causal" disclaimer |

#### 4e — Missing requirements alert

| # | Test | Pass condition |
|---|---|---|
| 4.29 | Missing requirements box renders | Profile modal and session notes modal both show Needs Completion block when items missing |
| 4.30 | Box clears when all complete | When waiver + intake + payment + notes all present, box is absent or shows "✓ All requirements complete" |
| 4.31 | Missing payment surfaced | Session with no payment records shows "No payment recorded" in Needs Completion |
| 4.32 | Missing notes surfaced | Session with no notes shows "No session notes yet" in Needs Completion |

---

### Suite 4f — Recommendations & Referrals

> Part of Session Notes / Client Profile milestone.

#### Recommendations

| # | Test | Pass condition |
|---|---|---|
| 4.33 | Create recommendation | `POST /recommendations` with `client_id`, `product_name`, `category` → 201 |
| 4.34 | List by client | `GET /recommendations?client_id=<id>` returns array |
| 4.35 | Fetch single | `GET /recommendations?id=<id>` returns record |
| 4.36 | Edit recommendation | `PATCH /recommendations?id=<id>` with `purchased:"yes"`, `client_outcome` → 200 |
| 4.37 | Recommendation appears in profile | Client profile shows rec row with product name, category, priority, purchased badges |
| 4.38 | Recommendation appears in timeline | `GET /timeline?client_id=<id>` returns `type:"recommendation"` event |
| 4.39 | Rec persists after refresh | Re-fetching profile shows same rec |
| 4.40 | Outstanding alert shows | Profile shows "N recommendations awaiting outcome" when `purchased:"unknown"` recs exist |
| 4.41 | Audit log entry | Written for create + patch |
| 4.42 | RLS blocks anon | Anon client cannot SELECT from `recommendations` |

#### Referrals

| # | Test | Pass condition |
|---|---|---|
| 4.43 | Create referral | `POST /referrals` with `client_id`, `provider_name`, `provider_type` → 201 |
| 4.44 | List by client | `GET /referrals?client_id=<id>` returns array |
| 4.45 | Fetch single | `GET /referrals?id=<id>` returns record |
| 4.46 | Edit referral | `PATCH /referrals?id=<id>` with `followed_through:"yes"`, `outcome_notes` → 200 |
| 4.47 | Referral appears in profile | Client profile shows referral row with provider, type, urgency, followed-through badges |
| 4.48 | Referral appears in timeline | `GET /timeline?client_id=<id>` returns `type:"referral"` event |
| 4.49 | Referral follow-up tracking | Profile shows "N referrals pending follow-up" stat chip |
| 4.50 | Stale referral alert | Referral older than 30 days with `followed_through:"unknown"` triggers red alert |
| 4.51 | Referral persists after refresh | Re-fetching profile shows same referral |
| 4.52 | Audit log entry | Written for create + patch |
| 4.53 | RLS blocks anon | Anon client cannot SELECT from `referrals` |

#### Timeline stats

| # | Test | Pass condition |
|---|---|---|
| 4.54 | `stats.totalRecs` returned | Timeline response includes `stats.totalRecs` count |
| 4.55 | `stats.activeRecs` returned | Count of recs with `purchased:"unknown"` |
| 4.56 | `stats.totalReferrals` returned | Timeline response includes `stats.totalReferrals` |
| 4.57 | `stats.pendingReferrals` returned | Count of referrals with `followed_through:"unknown"` |

---

### Suite 4g — Case File, Session-Linked Recs/Refs, and Action Plans

> Part of Session Notes / Client Profile milestone.
> **Do not advance to Suite 5 until 4g passes.**
>
> SQL prerequisite: `supabase/add_action_plans.sql` must be run before testing.

#### Case File view

| # | Test | Pass condition |
|---|---|---|
| 4.58 | Case file opens | `crmOpenProfile(id)` renders full case file modal without errors |
| 4.59 | Action plans section renders | Case file shows "Action Plans" section with stat chips and "+ Add" button |
| 4.60 | Stats bar shows 6 columns | Case file stats bar includes Active Recs and Pending Refs counts from `tlStats` |
| 4.61 | Card button is "Case File" | Client card button reads "📋 Case File" (not "Profile") |

#### Action Plans API

| # | Test | Pass condition |
|---|---|---|
| 4.62 | Create action plan | `POST /action-plans` with `client_id`, any content field → 201 |
| 4.63 | List by client | `GET /action-plans?client_id=<id>` returns array |
| 4.64 | List by session | `GET /action-plans?session_id=<id>` returns plans for that session |
| 4.65 | Fetch single | `GET /action-plans?id=<id>` returns record |
| 4.66 | Edit plan | `PATCH /action-plans?id=<id>` with `status:"completed"` → 200 |
| 4.67 | Plan appears in case file | Re-opening case file shows plan row with status/priority badges |
| 4.68 | Plan appears in timeline | `GET /timeline?client_id=<id>` returns `type:"action_plan"` event |
| 4.69 | `stats.totalActionPlans` returned | Timeline stats include `totalActionPlans` count |
| 4.70 | `stats.activeActionPlans` returned | Count of plans with `status:"active"` |
| 4.71 | Session action plan save | Filling action plan form in session notes modal and clicking Save calls `POST /action-plans` with `session_id` → 201 |
| 4.72 | Audit log entry | Written for create + patch |
| 4.73 | RLS blocks anon | Anon client cannot SELECT from `action_plans` |

#### Session-linked recommendations and referrals

| # | Test | Pass condition |
|---|---|---|
| 4.74 | Recs pre-populate in session notes | Opening session notes for a client who has recs shows active rec count and rec list in "Recommendations & Referrals" section |
| 4.75 | Refs pre-populate in session notes | Opening session notes for a client with referrals shows pending ref count and ref list |
| 4.76 | Quick-add rec from session | Clicking "+ Rec" in session notes modal shows inline form |
| 4.77 | Quick-add rec saves with session_id | Completing quick-add rec form → `POST /recommendations` with `session_id` present → 201 |
| 4.78 | New rec appears in session modal | After quick-add, rec count increments in session notes modal without full page reload |
| 4.79 | New rec appears in client case file | Re-opening case file shows the newly added rec with "Linked to session" indicator |
| 4.80 | Quick-add referral from session | Clicking "+ Referral" shows inline form |
| 4.81 | Quick-add referral saves with session_id | Completing form → `POST /referrals` with `session_id` present → 201 |
| 4.82 | New referral appears in session modal | After quick-add, ref count increments in session notes modal |
| 4.83 | New referral appears in client case file | Re-opening case file shows referral with "Linked to session" indicator |
| 4.84 | Session-linked rec/ref in timeline | Both appear as `type:"recommendation"` and `type:"referral"` in `/timeline` |
| 4.85 | No permission errors on parallel fetch | Session notes modal fetches timeline + clients + recs + refs in parallel — all return 200 |

---

### Suite 5 — Aftercare

> Milestone gate: Aftercare milestone.

| # | Test | Pass condition |
|---|---|---|
| 5.1 | Create aftercare record | `POST /aftercare` with `client_id`, `session_id`, `message_type` → 201 |
| 5.2 | List aftercare for client | `GET /aftercare?client_id=<id>` returns array |
| 5.3 | Aftercare appears in timeline | Shows as `type:"aftercare"` in client timeline |
| 5.4 | Mark sent | `PATCH /aftercare?id=<id>` `{status:"sent"}` → 200 |
| 5.5 | Pending count updates | `stats.pendingFollowUps` reflects scheduled-only rows |
| 5.6 | RLS blocks anon | Anon client cannot SELECT from `aftercare` |

---

### Suite 6 — Payments

> Milestone gate: Payments milestone.

| # | Test | Pass condition |
|---|---|---|
| 6.1 | Create payment | `POST /payments` with `client_id`, `amount`, `method` → 201 |
| 6.2 | List payments for client | `GET /payments?client_id=<id>` returns array |
| 6.3 | Payment appears in timeline | Shows as `type:"payment"` in client timeline |
| 6.4 | Total paid accurate | `stats.totalPaid` matches sum of payment `amount` for client |
| 6.5 | Edit payment | `PATCH /payments?id=<id>` updates allowed fields → 200 |
| 6.6 | Audit log entry | Written for create + patch |
| 6.7 | RLS blocks anon | Anon client cannot SELECT from `payments` |

---

### Suite 7 — Daily Briefing

> Milestone gate: Daily Briefing milestone.

| # | Test | Pass condition |
|---|---|---|
| 7.1 | Generate briefing | `POST /daily-briefings` creates entry → 201 |
| 7.2 | Fetch today's briefing | `GET /daily-briefings?date=<today>` returns briefing |
| 7.3 | Briefing contains today's sessions | Response includes sessions scheduled for the date |
| 7.4 | Briefing contains follow-ups | Pending aftercare items appear |
| 7.5 | Duplicate prevention | Second POST for same date returns existing or 409 |
| 7.6 | RLS blocks anon | Anon cannot SELECT from `daily_briefings` |

---

### Suite 8 — Audit Log

> Milestone gate: Audit Log milestone.

| # | Test | Pass condition |
|---|---|---|
| 8.1 | Log written on client create | Row exists in `audit_logs` for last client POST |
| 8.2 | Log written on client edit | Row exists for last client PATCH |
| 8.3 | Log written on note create | Row exists for last session-notes POST |
| 8.4 | Log entries include actor | `actor` field = admin email |
| 8.5 | Log entries include IP | `ip` field non-empty |
| 8.6 | Fetch audit logs | `GET /audit-logs` returns paginated array |
| 8.7 | Filter by table | `GET /audit-logs?table=clients` returns only clients rows |
| 8.8 | RLS blocks anon | Anon cannot SELECT from `audit_logs` |

---

### Suite 9 — Security / RLS / service-role

> Milestone gate: runs as part of every suite; summarized separately at end.

| # | Test | Pass condition |
|---|---|---|
| 9.1 | Anon blocked on clients | Direct Supabase anon SELECT returns no rows / RLS error |
| 9.2 | Anon blocked on sessions | Same |
| 9.3 | Anon blocked on session_notes | Same |
| 9.4 | Anon blocked on payments | Same |
| 9.5 | Anon blocked on aftercare | Same |
| 9.6 | Anon blocked on audit_logs | Same |
| 9.7 | service_role can read all tables | Netlify function SELECT succeeds on all 11 tables |
| 9.8 | service_role can write all tables | INSERT succeeds on all 11 tables |
| 9.9 | ANON_KEY never in Netlify function env | `process.env.SUPABASE_ANON_KEY` undefined in function context |
| 9.10 | SERVICE_ROLE_KEY never in browser bundle | Key string absent from all `website/*.js` and `website/*.html` files |

---

## Milestone progression

```
[✅] Suite 0 — Deployment
[✅] Suite 1 — Authentication
[✅] Suite 2 — Clients tab          ← passed 2026-06-11
[✅] Suite 3 — Client Timeline      ← passed 2026-06-11 (manual retest)
[🔲] Suite 4 — Session Notes + Compliance + Env + Rec/Ref + Case File + Action Plans  ← NEXT
[🔲] Suite 5 — Aftercare
[🔲] Suite 6 — Payments
[🔲] Suite 7 — Daily Briefing
[🔲] Suite 8 — Audit Log
[🔲] Suite 9 — Security (runs with each suite)
```

A suite is marked ✅ only after the QA Agent exits 0 for that suite
(or a manual production retest is confirmed and logged here with date).

---

## Adding tests to qa-agent.js

1. Add the test function inside the correct suite block.
2. Call `pass(name)`, `fail(name, {error, likelyCause, file, fix})`, or `skip(name, reason)`.
3. Increment the suite counter in the summary block.
4. Update this doc with the new row.

Do not mark a suite complete in this doc without a corresponding agent exit-0 or
a logged manual retest confirmation with date.
