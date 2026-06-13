# Royal Energy Alchemy — Platform Architecture & Documentation

**Generated:** 2026-06-13  
**Platform State:** Production (Netlify + Supabase)  
**Version:** Post–Knowledge Hub Restructure Sprint

---

## Table of Contents

1. [Database Dictionary](#1-database-dictionary)
2. [API Function Inventory](#2-api-function-inventory)
3. [Dashboard Map](#3-dashboard-map)
4. [Agent Map](#4-agent-map)
5. [Data Flow Map](#5-data-flow-map)
6. [Migration Ledger](#6-migration-ledger)
7. [Technical Debt Review](#7-technical-debt-review)
8. [Platform Roadmap](#8-platform-roadmap)

---

## 1. Database Dictionary

### Entity Relationship Overview

```
clients ──────────────────────────────────────────────────┐
   │                                                       │
   ├──< sessions >──< session_notes                        │
   │        │                                              │
   │        ├──< payments                                  │
   │        ├──< aftercare                                 │
   │        └──< session_notes >── (env_notes, snm_json)  │
   │                                                       │
   ├──< intake_submissions                                 │
   ├──< recommendations                                    │
   ├──< referrals                                          │
   ├──< action_plans                                       │
   ├──< research_notes                                     │
   ├──< communications                                     │
   │                                                       │
   └── (FK in packages, invoices, ledger_entries) ─────────┘

Financial Layer (independent):
   packages ──< ledger_entries
   invoices ──< invoice_items
   invoices ──< ledger_entries

Platform Layer (no FK):
   kb_entries        (Knowledge Base — practitioner articles)
   expenses          (Bookkeeping)
   email_templates   (Communications)
   audit_logs        (Security & observability)
   daily_briefings   (Cached AI briefings)
   qa_results        (QA automation history)
```

---

### Table: `clients`

**Purpose:** Master client registry. Central FK target for all session, financial, and communication data.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| full_name | text | ✅ | — | Display name |
| email | text | — | — | Unique contact |
| phone | text | — | — | |
| date_of_birth | date | — | — | |
| address | text | — | — | |
| intake_source | text | — | — | web_form / manual / referral |
| intake_date | date | — | now() | |
| service_history | text[] | — | — | Array of service types |
| tags | text[] | — | — | qa / test / vip / etc. |
| notes | text | — | — | Practitioner freeform |
| status | text | — | 'active' | active / inactive / archived |
| deleted_at | timestamptz | — | — | Soft delete |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |

**Soft Delete:** `deleted_at IS NULL` filter on all reads  
**Indexes:** email, status, deleted_at  
**RLS:** Enabled — service_role bypass  
**Relationships:** Referenced by sessions, aftercare, payments, recommendations, referrals, action_plans, research_notes, communications, packages, invoices, intake_submissions

---

### Table: `sessions`

**Purpose:** Every booked or completed energy healing session. Central operational record.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| client_id | uuid | — | — | FK → clients.id ON DELETE SET NULL |
| client_name | text | — | — | Denormalized for display |
| session_date | date | — | — | |
| session_time | text | — | — | HH:MM string |
| service | text | — | — | Service type |
| status | text | — | 'pending' | pending / confirmed / completed / cancelled / no_show |
| duration_minutes | integer | — | — | |
| amount_due | numeric(8,2) | — | — | |
| amount_paid | numeric(8,2) | — | 0 | |
| payment_status | text | — | 'unpaid' | unpaid / partial / paid / waived |
| notes | text | — | — | Quick session notes |
| state_before | smallint | — | — | 1–5 scale (added: feature_state_tracking) |
| state_after | smallint | — | — | 1–5 scale (added: feature_state_tracking) |
| deleted_at | timestamptz | — | — | Soft delete |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |

**Soft Delete:** `deleted_at IS NULL`  
**Indexes:** client_id, session_date, status, payment_status  
**Relationships:** Parent of session_notes, payments, aftercare. Referenced by expenses (related_session_id), action_plans, timeline

---

### Table: `session_notes`

**Purpose:** Structured practitioner notes per session. Feeds AI briefing, pattern analysis, and timeline.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| session_id | uuid | — | — | FK → sessions.id |
| client_id | uuid | — | — | Denormalized FK → clients.id |
| content | text | — | — | Plain-text note for AI |
| energy_findings | text | — | — | Practitioner energy observations |
| recommendations | text | — | — | Practitioner recommendations text |
| env_notes | text | — | — | Environmental JSON (moon phase, weather, season) |
| snm_json | jsonb | — | — | Full Session Notes Modal state for UI reload |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |

**Soft Delete:** None (delete cascades from session)  
**Indexes:** session_id (WHERE NOT NULL), client_id (WHERE NOT NULL)  
**Relationships:** Child of sessions, referenced by analytics, session-prep-brief

---

### Table: `aftercare`

**Purpose:** Structured post-session follow-up schedule. 5 records auto-created per completed session.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| session_id | uuid | — | — | FK → sessions.id |
| client_id | uuid | — | — | FK → clients.id |
| client_name | text | — | — | Denormalized |
| followup_type | text | ✅ | — | 24h / 48h / 72h / 1mo / 3mo |
| scheduled_for | timestamptz | ✅ | — | When to send |
| status | text | ✅ | 'scheduled' | scheduled / sent / skipped |
| message | text | — | — | Personalized follow-up message |
| response | text | — | — | Client response (if captured) |
| source | text | — | 'session' | session / manual |
| sent_at | timestamptz | — | — | |
| created_at | timestamptz | ✅ | now() | |

**Soft Delete:** None — status transitions to 'sent' or 'skipped'  
**Indexes:** session_id, client_id, status, scheduled_for  
**Relationships:** Child of sessions and clients; displayed in Follow-Up Center

---

### Table: `intake_submissions`

**Purpose:** Raw form submissions from public intake form. Processed by Intake Agent into clients + sessions.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| full_name | text | — | — | |
| email | text | — | — | |
| phone | text | — | — | |
| service_requested | text | — | — | |
| preferred_window_1 | text | — | — | |
| preferred_window_2 | text | — | — | |
| message | text | — | — | |
| client_id | uuid | — | — | FK → clients.id (set after matching) |
| match_status | text | — | 'unmatched' | matched / needs_review / unmatched |
| matched_at | timestamptz | — | — | When match was established |
| processed | boolean | — | false | |
| created_at | timestamptz | ✅ | now() | |

**Indexes:** match_status, email (WHERE NOT NULL), phone (WHERE NOT NULL), client_id (WHERE NOT NULL)  
**Rate Limiting:** 5/10min and 20/24h per IP, checked against audit_logs

---

### Table: `payments`

**Purpose:** Payment records linked to sessions. Separate from financial ledger (operational vs. accounting).

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| session_id | uuid | — | — | FK → sessions.id |
| client_id | uuid | — | — | FK → clients.id |
| client_name | text | — | — | Denormalized |
| amount | numeric(8,2) | ✅ | — | |
| method | text | — | — | cash / card / venmo / zelle / other |
| status | text | — | 'paid' | paid / refunded / partial |
| paid_at | timestamptz | — | now() | |
| notes | text | — | — | |
| created_at | timestamptz | ✅ | now() | |

**Relationships:** Child of sessions and clients

---

### Table: `expenses`

**Purpose:** Business expense tracking for P&L and tax preparation.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| expense_date | date | ✅ | CURRENT_DATE | |
| category | text | ✅ | — | supplies / equipment / marketing / professional_services / education / utilities / rent / insurance / travel / other |
| description | text | ✅ | — | |
| amount | numeric(8,2) | ✅ | — | |
| vendor | text | — | — | |
| payment_method | text | ✅ | 'personal' | personal / business_card / bank_transfer / cash / other |
| tax_deductible | boolean | ✅ | false | |
| receipt_url | text | — | — | |
| related_session_id | uuid | — | — | FK → sessions.id ON DELETE SET NULL |
| notes | text | — | — | |
| created_by | text | ✅ | 'daron' | |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |
| deleted_at | timestamptz | — | — | Soft delete |

**Constraints:** expenses_amount_positive (amount > 0), expenses_category_check, expenses_payment_method_check  
**Indexes:** expense_date, category, tax_deductible, deleted_at, related_session_id  
**RLS:** Enabled — service_role bypass

---

### Table: `packages`

**Purpose:** Session bundle purchases. Source of truth for sessions_remaining.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| client_id | uuid | — | — | FK → clients.id ON DELETE SET NULL |
| client_name | text | — | — | Denormalized |
| package_type | text | ✅ | — | single / 3_session / 5_session / 10_session / custom |
| package_name | text | ✅ | — | Display name |
| sessions_included | integer | ✅ | 1 | |
| sessions_used | integer | ✅ | 0 | |
| sessions_remaining | integer | — | — | GENERATED: included − used |
| purchase_date | date | ✅ | CURRENT_DATE | |
| expiration_date | date | — | — | NULL = no expiry |
| purchase_price | numeric(8,2) | ✅ | 0 | |
| status | text | ✅ | 'active' | active / completed / expired / cancelled |
| notes | text | — | — | |
| created_by | text | — | 'daron' | |
| created_at | timestamptz | — | now() | |
| updated_at | timestamptz | — | now() | |
| deleted_at | timestamptz | — | — | Soft delete |

**Constraints:** packages_status_check, packages_type_check, packages_used_check (used ≥ 0 AND used ≤ included)

---

### Table: `invoices`

**Purpose:** Draft and issued invoices. Separate from payments (formal billing vs. operational payment).

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| client_id | uuid | — | — | FK → clients.id ON DELETE SET NULL |
| client_name | text | — | — | Denormalized |
| invoice_number | text | ✅ | — | Format: INV-YYYY-NNN (auto-generated) |
| status | text | ✅ | 'draft' | draft / sent / paid / cancelled / overdue |
| subtotal | numeric(8,2) | ✅ | 0 | Sum of invoice_items |
| tax_rate | numeric(5,4) | — | 0 | |
| tax_amount | numeric(8,2) | — | 0 | |
| total | numeric(8,2) | ✅ | 0 | |
| due_date | date | — | — | |
| paid_at | timestamptz | — | — | |
| notes | text | — | — | |
| created_by | text | — | 'daron' | |
| created_at | timestamptz | — | now() | |
| updated_at | timestamptz | — | now() | |
| deleted_at | timestamptz | — | — | Soft delete |

**Child table:** `invoice_items` (id, invoice_id, description, quantity, unit_price, amount)

---

### Table: `ledger_entries`

**Purpose:** Double-entry accounting ledger. Every financial event (package purchase, payment, refund) creates a ledger entry.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| entry_type | text | charge / payment / refund / adjustment / package_purchase |
| amount | numeric(8,2) | Positive = owed, Negative = credit |
| balance_impact | numeric(8,2) | Signed impact on client balance |
| description | text | |
| reference_id | uuid | FK to invoice, package, or session |
| reference_type | text | invoice / package / session / manual |
| created_by | text | |
| created_at | timestamptz | |

---

### Table: `communications`

**Purpose:** Complete outbound communication log. Every email sent is recorded here.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients ON DELETE SET NULL | |
| channel | text | email / sms (future) |
| message_type | text | appointment_reminder / followup_reminder / recommendation_delivery / invoice_notification / package_expiration_warning / general_message |
| recipient | text | Email address |
| subject | text | |
| status | text | sent / delivered / failed / bounced / pending |
| provider | text | resend |
| provider_message_id | text | For delivery tracking |
| template_id | uuid FK → email_templates | If template was used |
| metadata | jsonb | invoice_id, session_id, etc. |
| sent_at | timestamptz | |
| deleted_at | timestamptz | Soft delete |

**Child table:** `email_templates` (id, name, subject_template, body_template, active, created_at)

---

### Table: `research_notes`

**Purpose:** Practitioner's private research and pattern notes. Powers Pattern Library and Insights Feed.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| title | text | ✅ | 'Untitled' | |
| content | text | — | — | Note body |
| source_url | text | — | — | Reference link |
| tags | text[] | — | — | GIN-indexed for pattern queries |
| session_id | uuid | — | — | Optional link to session |
| client_id | uuid | — | — | FK → clients.id ON DELETE SET NULL |
| visibility | text | ✅ | 'private' | private / practice_notes |
| created_by | text | ✅ | 'daron' | |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |
| deleted_at | timestamptz | — | — | Soft delete |

**Constraints:** research_notes_visibility_check  
**Indexes:** created_at DESC, deleted_at (WHERE NULL), tags GIN, client_id (WHERE NOT NULL)  
**RLS:** Enabled — service_role bypass

---

### Table: `kb_entries`

**Purpose:** Practitioner knowledge base articles. Protocols, FAQs, procedures, training materials.

| Column | Type | Not Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | ✅ | gen_random_uuid() | PK |
| title | text | ✅ | — | |
| summary | text | — | — | Short blurb for cards |
| content | text | — | — | Full article body (renamed from legacy `body`) |
| category | text | — | — | Protocol / FAQ / Training / Practitioner Guide / Procedure / Reference |
| tags | text[] | — | — | |
| is_pinned | boolean | ✅ | false | Pinned entries sort first |
| fts | tsvector | — | — | Full-text search vector (GIN-indexed) |
| status | text | ✅ | 'draft' | draft / published / archived |
| created_by | text | ✅ | 'daron' | |
| created_at | timestamptz | ✅ | now() | |
| updated_at | timestamptz | ✅ | now() | |
| deleted_at | timestamptz | — | — | Soft delete |

**Constraints:** kb_entries_status_check (status IN draft/published/archived)  
**Indexes:** fts GIN, category (WHERE NOT NULL), status, is_pinned (WHERE true), deleted_at (WHERE NULL)  
**RLS:** Enabled — service_role bypass  
**Legacy note:** Original table had `body text NOT NULL`; renamed to `content` by 2026-06-13-kb-lite.sql

---

### Table: `recommendations`

**Purpose:** Products and services recommended to clients. Tracks purchase and outcome.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| session_id | uuid FK → sessions | Optional link |
| category | text | supplement / crystal / essential_oil / book / course / device / service / other |
| name | text | |
| description | text | |
| priority | text | high / medium / low |
| purchased | text | yes / no / unknown |
| outcome_status | text | recommended / purchased / tried / helpful / not_helpful / declined |
| outcome_date | date | |
| recommended_at | timestamptz | |
| created_at | timestamptz | |

**Indexes:** outcome_status  
**Relationships:** Displayed in client profile and Session Prep Brief

---

### Table: `referrals`

**Purpose:** Practitioner referrals to other healthcare providers.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| referral_type | text | pcp / therapist / psychiatrist / nutritionist / functional_medicine / neurologist / physical_therapist / energy_practitioner / other |
| provider_name | text | |
| urgency | text | urgent / soon / routine |
| reason | text | |
| followed_up | text | yes / no / unknown |
| referred_at | timestamptz | |
| created_at | timestamptz | |

---

### Table: `action_plans`

**Purpose:** Structured treatment plans with priorities and timelines.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| session_id | uuid FK → sessions | |
| title | text | |
| description | text | |
| priority | text | high / medium / low |
| status | text | draft / active / completed |
| due_date | date | |
| created_at | timestamptz | |

---

### Table: `audit_logs`

**Purpose:** Security, observability, and rate-limiting. Every write action is logged.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| action | text | pin_attempt_failed / intake_submission / client_created / session_updated / etc. |
| table_name | text | Which table was affected |
| record_id | uuid | The affected record |
| actor | text | Email of admin who performed action |
| ip_address | text | For rate limiting |
| details | jsonb | Before/after snapshots, metadata |
| created_at | timestamptz | |

**Special role:** Used by verify-pin for rate limiting (5 failed attempts / 15 min) and intake.js for IP rate limiting.

---

### Table: `daily_briefings`

**Purpose:** Cached AI-generated daily briefings. One row per date.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| briefing_date | date | Unique per day |
| content | text | Plain-English briefing text |
| raw_data | jsonb | Snapshot of session/aftercare/intake data used |
| created_at | timestamptz | |

---

### Table: `qa_results`

**Purpose:** Stores qa-agent.js run history for observability.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| overall | text | PASS / FAIL / WARN |
| summary | jsonb | {pass, fail, warn, skip, total} |
| checks | jsonb | Full check results array |
| console_errors | jsonb | |
| network_fails | jsonb | |
| url | text | Dashboard URL tested |
| git_sha | text | |
| triggered_by | text | |
| created_at | timestamptz | |

---

## 2. API Function Inventory

### Authentication Pattern

All admin functions use `requireAdmin(event)` from `lib/auth.js`:
- Reads `X-Dashboard-Token` header
- Validates against Supabase service_role session
- Returns `{ user }` on success or `{ error }` with HTTP response

Public exception: `intake.js` POST is unauthenticated (rate-limited by IP).

### Environment Variables Required

| Variable | Used By | Purpose |
|---|---|---|
| SUPABASE_URL | All functions | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | All functions | Bypasses RLS |
| ANTHROPIC_API_KEY | session-prep-brief, client-attention-flags, generate-client-summary, daily-briefing, session-notes | Claude API access |
| RESEND_API_KEY | send-email | Email delivery (never exposed to frontend) |
| FROM_EMAIL | send-email | Verified sender address |
| DASHBOARD_PIN | verify-pin | Dashboard access PIN |

---

### Function: `verify-pin`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/verify-pin` |
| **Auth** | None (PIN-based, rate-limited) |
| **Purpose** | Validates dashboard PIN, issues session token |
| **Rate Limit** | 5 failed attempts / 15 min per IP (via audit_logs) |
| **Inputs** | `{ pin: string }` |
| **Outputs** | `{ token: string }` or `{ error }` |
| **Tables** | audit_logs (rate check + log) |

---

### Function: `clients`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/clients` |
| **Auth** | Admin |
| **Purpose** | Client registry CRUD + session/aftercare lookup |
| **Tables** | clients, sessions, aftercare |

| Method | Params | Returns |
|---|---|---|
| GET | (none) | All active clients (QA-filtered) |
| GET | `?id=uuid` | Client + sessions + aftercare |
| GET | `?search=name` | Matching clients |
| POST | Body: client fields | Created client |
| PATCH | `?id=uuid` + body | Updated client |

---

### Function: `sessions`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/sessions` |
| **Auth** | Admin |
| **Purpose** | Session lifecycle management |
| **Tables** | sessions, session_notes, payments, aftercare |
| **Side Effects** | On status=completed: triggers aftercare-agent |

| Method | Params | Returns |
|---|---|---|
| GET | (none) | Last 90 days |
| GET | `?id=uuid` | Session + notes + payments + aftercare |
| GET | `?client_id=uuid` | All client sessions |
| GET | `?date=YYYY-MM-DD` | Sessions on date |
| GET | `?upcoming=1` | Next 30 days, pending+confirmed |
| POST | Body: session fields | Created session |
| PATCH | `?id=uuid` + body | Updated session |

---

### Function: `session-notes`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/session-notes` |
| **Auth** | Admin |
| **Purpose** | Structured session notes with optional AI enhancement |
| **Tables** | session_notes |
| **Side Effects** | POST optionally calls session-notes-agent (Claude) |

---

### Function: `aftercare`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/aftercare` |
| **Auth** | Admin |
| **Purpose** | Post-session follow-up schedule management |
| **Tables** | aftercare, sessions |

| Method | Params | Returns |
|---|---|---|
| GET | `?session_id=uuid` | Follow-ups for session |
| GET | `?client_id=uuid` | All follow-ups for client |
| GET | `?due=1` | All overdue/due-today |
| GET | `?all=1` | All follow-ups (paginated) |
| POST | Body: {client_id, scheduled_for, followup_type} | Ad-hoc follow-up |
| PATCH | `?id=uuid` | Mark sent/skipped, add response |

---

### Function: `intake`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/intake` (public) / `GET/PATCH` (admin) |
| **Auth** | POST: none (rate-limited) / GET+PATCH: admin |
| **Purpose** | Intake form receiver + agent trigger |
| **Tables** | intake_submissions, clients, sessions, audit_logs |
| **Side Effects** | POST runs intake-agent (client match/create, session create) |

---

### Function: `payments`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/payments` |
| **Auth** | Admin |
| **Purpose** | Session payment recording |
| **Tables** | payments, sessions |
| **Side Effects** | POST updates session.payment_status |

---

### Function: `financial`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/financial` |
| **Auth** | Admin |
| **Purpose** | Full financial operations: packages, invoices, ledger, bookkeeping, P&L, schema validation |
| **Tables** | packages, invoices, invoice_items, ledger_entries, financial_alerts, expenses |

| Section | Returns |
|---|---|
| `overview` | KPI dashboard (revenue, outstanding, packages) |
| `packages` | Package list (filterable by client_id) |
| `invoices` | Invoice list with items |
| `ledger` | Full ledger history |
| `revenue` | Revenue analytics |
| `alerts` | Unread financial alerts |
| `client_summary` | Full financial profile for one client |
| `expenses` | Expense list (category/tax/date filters) |
| `expenses_summary` | Month/YTD/category KPIs |
| `pnl` | 12-month P&L (revenue vs. expenses) |
| `schema_validation` | Live DB schema check for expenses, research_notes, kb_entries |

---

### Function: `research`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/research` |
| **Auth** | Admin |
| **Purpose** | Practitioner research notes + Pattern Library + Insights Feed |
| **Tables** | research_notes |

| Section/Action | Returns |
|---|---|
| `section=notes` | All notes (soft-deleted excluded) |
| `section=notes&search=q` | Keyword search |
| `section=pattern_library` | Tag aggregation with counts + excerpts |
| `section=pattern_library&search=q` | Filtered by tag keyword |
| `section=insights` | Cross-note analysis (shared tags, modalities, emotional themes) |
| `section=analytics` | KPIs: totalNotes, activeTags, notesThisMonth, mostCommonTag |
| `action=create_note` (POST) | Create note |
| `action=update_note` (PATCH) | Edit note |
| `action=delete_note` (PATCH) | Soft-delete |

---

### Function: `kb`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/kb` |
| **Auth** | Admin |
| **Purpose** | Knowledge Base article CRUD |
| **Tables** | kb_entries |

| Section/Action | Returns |
|---|---|
| `section=entries` | All entries (pinned first, then newest) |
| `section=entries&category=X` | Category filter |
| `section=entries&search=q` | Keyword search |
| `section=entry&id=uuid` | Single entry |
| `section=categories` | Distinct category list |
| `action=create_entry` (POST) | Create article |
| `action=update_entry` (PATCH) | Edit article (incl. is_pinned, status, summary) |
| `action=delete_entry` (PATCH) | Soft-delete |

---

### Function: `communications`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/communications` |
| **Auth** | Admin |
| **Purpose** | Email log + template management |
| **Tables** | communications, email_templates |

---

### Function: `send-email`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/send-email` |
| **Auth** | Admin |
| **Purpose** | Send email via Resend API + log to communications |
| **Dependencies** | RESEND_API_KEY, FROM_EMAIL (Netlify env) |
| **Tables** | communications |
| **Security** | API key never returned in any response |

| Action | Inputs |
|---|---|
| `send_email` | {to, subject, html, client_id?} |
| `send_template` | {template_id, client_id, variables} |

---

### Function: `analytics`

| | |
|---|---|
| **Endpoint** | `GET /.netlify/functions/analytics` |
| **Auth** | Admin |
| **Purpose** | Practice intelligence across multiple dimensions |
| **Tables** | clients, sessions, session_notes, recommendations |
| **QA Filtering** | Excludes clients tagged qa/test/seed/demo |

| Section | Returns |
|---|---|
| `recommendations` | Recommendation intelligence (category trends, outcomes) |
| `outcomes` | State before/after analysis (min 3 sessions) |
| `retention` | Client retention metrics (min 3 clients with 2+ sessions) |
| `cross-client` | Aggregate patterns with no PII (min 5 records) |
| `data-quality` | Missing fields audit by severity |
| `audit-detail` | Record-level quality investigation |

---

### Function: `daily-briefing`

| | |
|---|---|
| **Endpoint** | `GET/POST /.netlify/functions/daily-briefing` |
| **Auth** | Admin |
| **Purpose** | AI-generated daily practitioner briefing (cached per date) |
| **Tables** | daily_briefings, sessions, aftercare, intake_submissions, payments |
| **AI** | Claude Haiku via daily-briefing-agent |

---

### Function: `session-prep-brief`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/session-prep-brief` |
| **Auth** | Admin |
| **Purpose** | Structured JSON session prep from client history |
| **AI** | Claude Haiku — strict JSON output, no diagnosis |
| **Inputs** | {client_id, session_id} |
| **Outputs** | Structured JSON: lastSessionDate, lastSessionOutcome, improvementTrend, primaryConcerns, outstandingRecs, followUpItems, environmentalStatus, discussionTopics |

---

### Function: `client-attention-flags`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/client-attention-flags` |
| **Auth** | Admin |
| **Purpose** | AI-evaluated flags for incomplete/overdue items |
| **AI** | Claude Haiku — returns severity-tagged flags |
| **Output** | `{ flags: [{ label, severity, reason, source, suggested_action }] }` |

---

### Function: `generate-client-summary`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/generate-client-summary` |
| **Auth** | Admin |
| **Purpose** | Plain-prose client summary for profile modal |
| **AI** | Claude Haiku — practitioner-safe language, no diagnosis |

---

### Function: `client-practitioner-timeline`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/client-practitioner-timeline` |
| **Auth** | Admin |
| **Purpose** | AI-curated chronological narrative of client's journey |
| **AI** | Claude Haiku |

---

### Function: `timeline`

| | |
|---|---|
| **Endpoint** | `GET /.netlify/functions/timeline?client_id=uuid` |
| **Auth** | Admin |
| **Purpose** | Full merged chronological timeline for one client |
| **Tables** | clients, sessions, session_notes, payments, aftercare, intake_submissions, recommendations, referrals, action_plans |

---

### Function: `recommendations`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/recommendations` |
| **Auth** | Admin |
| **Tables** | recommendations |
| **Validated fields** | category, priority, purchased, outcome_status |

---

### Function: `referrals`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/referrals` |
| **Auth** | Admin |
| **Tables** | referrals |
| **Validated fields** | referral_type, urgency, followed_up |

---

### Function: `action-plans`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/action-plans` |
| **Auth** | Admin |
| **Tables** | action_plans |

---

### Function: `knowledge-hub`

| | |
|---|---|
| **Endpoint** | `GET/POST/PATCH /.netlify/functions/knowledge-hub` |
| **Auth** | Admin |
| **Purpose** | Legacy hub: social content, book projects, training courses, script vault |
| **Status** | ⚠️ Legacy — predates kb.js; may overlap with future Content Studio |
| **Tables** | Reads from sessions, session_notes for research intelligence |

---

### Function: `audit-log`

| | |
|---|---|
| **Endpoint** | `GET /.netlify/functions/audit-log` |
| **Auth** | Admin |
| **Tables** | audit_logs |
| **Filters** | table, actor, limit/offset |

---

### Function: `operations-health`

| | |
|---|---|
| **Endpoint** | `GET /.netlify/functions/operations-health` |
| **Auth** | Admin |
| **Purpose** | System health check — pings all functions, checks DB, returns status |
| **Returns** | { system, functions, errors, ai, audit, deploy, qa } |

---

### Function: `store-qa-result`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/store-qa-result` |
| **Auth** | Admin |
| **Purpose** | Persist qa-agent.js run results to Supabase |
| **Tables** | qa_results |

---

### Function: `log-system-error`

| | |
|---|---|
| **Endpoint** | `POST /.netlify/functions/log-system-error` |
| **Auth** | Admin |
| **Purpose** | Frontend error logging to audit_logs |
| **Tables** | audit_logs |

---

## 3. Dashboard Map

### Navigation Structure (Current)

```
Dashboard (dashboard.html)
│
├── 🏠 Home               ← Default tab
├── 👤 Clients
├── 📋 Sessions
├── ✉  Check-Ins
├── 🔔 Follow-Ups
├── 📅 Booking
├── ⭐ Ratings
├── 📊 Analytics
├── 💰 Financial Center
├── 📡 Communications
├── ◈  KNOWLEDGE HUB      ← Unified (replaced Research + KB + old Hub)
├── 🌐 Environment
└── ⚙  Operations
```

---

### Tab: Home

**Data Sources:** daily-briefing, sessions (upcoming), aftercare (due), payments (unpaid)  
**Functions:** `daily-briefing`, `sessions?upcoming=1`, `aftercare?due=1`, `payments?unpaid=1`  
**Tables:** daily_briefings, sessions, aftercare, payments  
**Sections:** Today's AI briefing, schedule, urgent attention, recent activity, business metrics

---

### Tab: Clients (`clients-module.js`)

**Functions:** `clients`, `timeline`, `session-prep-brief`, `client-attention-flags`, `client-practitioner-timeline`, `generate-client-summary`  
**Tables:** clients, sessions, session_notes, aftercare, payments, recommendations, referrals  
**Sections:** Client list, search, active/inactive filter, client profile modal (with AI features)

---

### Tab: Sessions (`sessions-module.js`)

**Functions:** `sessions`, `session-notes`, `payments`  
**Tables:** sessions, session_notes, payments, aftercare  
**Sections:** Session list, date filter, session detail, Session Notes Modal (SNM), state tracking

---

### Tab: Check-Ins

**Functions:** `intake` (GET admin)  
**Tables:** intake_submissions  
**Sections:** Unprocessed submissions, match status, manual link to client

---

### Tab: Follow-Ups

**Functions:** `aftercare`  
**Tables:** aftercare, sessions  
**Sections:** Due/overdue follow-ups, all follow-ups, mark sent/skipped, ad-hoc creation

---

### Tab: Booking

**Functions:** `sessions`  
**Tables:** sessions  
**Sections:** Calendar view, quick-book form

---

### Tab: Ratings

**Functions:** `sessions`, `analytics`  
**Tables:** sessions (state_before, state_after)  
**Sections:** State tracking history, improvement trends

---

### Tab: Analytics

**Functions:** `analytics`  
**Tables:** clients, sessions, session_notes, recommendations  
**Sections:** Recommendation intelligence, outcomes, retention, cross-client, data quality

---

### Tab: Financial Center (`financial-module.js`)

**Functions:** `financial`  
**Tables:** packages, invoices, invoice_items, ledger_entries, expenses  
**Sub-tabs:**
- Overview (KPI bar: revenue, outstanding, packages)
- Packages (create, use session, expire)
- Invoices (create, add items, record payment, mark paid)
- Ledger (full transaction history)
- Bookkeeping (expenses CRUD, category filter, tax filter)
- P&L (12-month revenue vs. expenses chart)

---

### Tab: Communications (`communications-module.js`)

**Functions:** `communications`, `send-email`  
**Tables:** communications, email_templates  
**Sections:** Communication log, template library, compose email, template composer

---

### Tab: KNOWLEDGE HUB (`kh-module.js`)

**Functions:** `kb`, `research`  
**Tables:** kb_entries, research_notes  
**Sub-sections:**

| Sub-section | Function | Returns |
|---|---|---|
| Dashboard | kb + research | KPI row (articles, notes, tags, patterns), recent articles, quick actions |
| Knowledge Base | kb | Article CRUD (Protocol/FAQ/Training/Practitioner Guide/Procedure/Reference) |
| Research | research | Research note CRUD, search |
| Pattern Library | research?section=pattern_library | Tag grid with counts and excerpts |
| Insights Feed | research?section=insights | Bar charts: top tags, cross-client, modalities, emotional themes |

---

### Tab: Environment

**Functions:** `sessions` (env_notes from session_notes)  
**Tables:** session_notes (env_notes column)  
**Sections:** Moon phase tracker, seasonal patterns, environmental conditions

---

### Tab: Operations

**Functions:** `operations-health`, `audit-log`, `store-qa-result`  
**Tables:** audit_logs, qa_results  
**Sections:** System health, function status, error log, QA history

---

### Frontend Module Files

| File | Manages |
|---|---|
| `clients-module.js` | Client tab |
| `sessions-module.js` | Sessions tab |
| `financial-module.js` | Financial Center |
| `communications-module.js` | Communications tab |
| `research-module.js` | Legacy Research tab (still loaded; IIFE) |
| `kb-module.js` | Legacy KB tab (still loaded; IIFE) |
| `kh-module.js` | KNOWLEDGE HUB (active unified module) |
| `pin-lock.js` | PIN gate overlay |
| `site-nav.js` | Sidebar navigation |

---

## 4. Agent Map

### Agent: Intake Agent

```
TRIGGER: intake.js POST (form submission received)
INPUT:   { full_name, email, phone, service_requested,
           preferred_window_1/2, message }

PROCESSING:
  1. Rate limit check (5/10min, 20/24h per IP) via audit_logs
  2. Honeypot check (bot_field) — silent accept if bot
  3. Match existing client: email → phone → needs_review
  4. If no match: CREATE new client record
  5. CREATE pending session record with service + preferred times
  6. Mark submission processed + record match_status
  7. LOG to audit_logs (action=intake_submission)

OUTPUT:
  { success: true, client_id, session_id, match_status }

TABLES WRITTEN:
  intake_submissions (processed=true, client_id, match_status, matched_at)
  clients            (INSERT if new)
  sessions           (INSERT pending session)
  audit_logs         (intake_submission event)
```

---

### Agent: Aftercare Agent

```
TRIGGER: sessions.js PATCH (when status transitions to 'completed')
INPUT:   { session } (full session record)

PROCESSING:
  1. Check if aftercare already exists for session (idempotent)
  2. Calculate 5 follow-up timestamps from session_date:
     - 24h, 48h, 72h, 1 month (30d), 3 months (90d)
  3. Insert 5 aftercare records with status='scheduled'

OUTPUT:
  { aftercare: [...5 records] }

TABLES WRITTEN:
  aftercare (5 INSERT rows per completed session)
```

---

### Agent: Session Notes Agent

```
TRIGGER: session-notes.js POST (when note is saved with AI=true)
INPUT:   { note } (full session note record)

PROCESSING:
  1. Fetch up to 3 previous session notes for client (context)
  2. Build prompt with note content + client history
  3. Call Claude Haiku — generate:
     - Polished summary
     - Key energy findings
     - Practitioner recommendations
  4. Update session_notes record with AI output

AI MODEL: claude-haiku-4-5-20251001
OUTPUT: Updated session_notes record

TABLES WRITTEN:
  session_notes (UPDATE content, energy_findings, recommendations)
```

---

### Agent: Daily Briefing Agent

```
TRIGGER: daily-briefing.js GET or POST
INPUT:   {
  date,
  todaySessions   (sessions for today),
  dueAftercare    (follow-ups due today or overdue),
  unpaidSessions  (sessions with unpaid/partial payment),
  newIntakes      (unprocessed submissions)
}

PROCESSING:
  1. Check daily_briefings cache for today's date
  2. If cached: return immediately (no AI call)
  3. If not cached:
     a. Compile data snapshot from 4 tables
     b. Build plain-English prompt
     c. Call Claude Haiku
     d. Save result to daily_briefings (date-keyed)

AI MODEL: claude-haiku-4-5-20251001
OUTPUT: { briefing: { content, date, raw_data }, cached: bool }

TABLES READ:
  sessions, aftercare, intake_submissions, payments
TABLES WRITTEN:
  daily_briefings (INSERT or cache hit)
```

---

### AI Feature: Session Prep Brief

```
TRIGGER: Client profile modal → "Session Prep Brief" button
INPUT:   { client_id, session_id }
         → Fetches: client, sessions, session_notes, aftercare,
           recommendations, referrals, action_plans

PROCESSING:
  Claude Haiku with strict system prompt:
  - Never diagnose
  - Practitioner-safe language only
  - Return exactly 8-field JSON

OUTPUT: {
  lastSessionDate, lastSessionOutcome, improvementTrend,
  primaryConcerns, outstandingRecs, followUpItems,
  environmentalStatus, discussionTopics
}
```

---

### AI Feature: Client Attention Flags

```
TRIGGER: Client profile modal → "Attention Flags" button
INPUT:   { client_id } → Fetches full client record

PROCESSING:
  Claude Haiku evaluates for:
  - Missing documentation (urgent)
  - Pending/overdue items (warning)
  - Optional improvements (info)
  - All up to date (success)

OUTPUT: {
  flags: [{ label, severity, reason, source, suggested_action }]
}
```

---

## 5. Data Flow Map

### Flow: Client Intake → Session → Follow-Up → Research → Knowledge Hub → Analytics

```
1. PUBLIC INTAKE FORM (index.html)
   │ POST /intake
   ▼
2. INTAKE AGENT
   │ Match/create client in `clients`
   │ Create pending session in `sessions`
   │ Log to `audit_logs`
   ▼
3. SESSION (scheduled → confirmed → completed)
   │ Practitioner updates via dashboard
   │ PATCH /sessions?id=uuid {status: 'completed'}
   ▼
4. AFTERCARE AGENT (auto-triggered on completion)
   │ Creates 5 records in `aftercare`
   │ (24h, 48h, 72h, 1mo, 3mo)
   ▼
5. SESSION NOTES MODAL
   │ Practitioner fills: energy findings, recommendations,
   │ env conditions, state_before/after
   │ POST /session-notes → saved to `session_notes`
   │ Optional: session-notes-agent (Claude) enhances note
   ▼
6. FOLLOW-UP CENTER
   │ Dashboard polls `aftercare?due=1`
   │ Practitioner marks as sent/skipped
   │ PATCH /aftercare?id=uuid
   ▼
7. PAYMENT
   │ POST /payments → `payments` record
   │ Auto-updates session.payment_status
   │ Optional: PATCH /financial?action=record_payment
   │   → creates `ledger_entries` record
   ▼
8. RESEARCH NOTES (Knowledge Hub → Research)
   │ Practitioner creates research note
   │ POST /research?action=create_note → `research_notes`
   │ Tags accumulate → Pattern Library
   ▼
9. KNOWLEDGE BASE (Knowledge Hub → Knowledge Base)
   │ Practitioner writes protocol/procedure
   │ POST /kb?action=create_entry → `kb_entries`
   ▼
10. ANALYTICS (Dashboard → Analytics tab)
    │ GET /analytics?section=outcomes
    │   → Reads session_notes state_before/after trends
    │ GET /analytics?section=cross-client
    │   → Aggregate patterns across clients (no PII)
    │ GET /research?section=insights
    │   → Cross-note tag analysis, modalities, themes
    ▼
11. DAILY BRIEFING (Auto each morning)
    │ GET /daily-briefing
    │ Aggregates: today's sessions + due aftercare +
    │   unpaid + new intakes
    │ Claude Haiku → plain-English briefing
    │ Cached in `daily_briefings`
```

---

## 6. Migration Ledger

| File | Date | Purpose | Tables Modified | Status |
|---|---|---|---|---|
| `feature_state_tracking.sql` | Pre-sprint | Add state_before/after to sessions; outcome_status to recommendations | sessions, recommendations | ✅ Active |
| `snm_supabase_persistence.sql` | Pre-sprint | Add env_notes + snm_json to session_notes | session_notes | ✅ Active |
| `2026-06-12-sprint2.sql` | 2026-06-12 | Intake match tracking (match_status, matched_at); aftercare source column | intake_submissions, aftercare | ✅ Active |
| `2026-06-12-financial-ops.sql` | 2026-06-12 | Create packages, invoices, invoice_items, ledger_entries, financial_alerts | packages, invoices, invoice_items, ledger_entries, financial_alerts | ✅ Active |
| `2026-06-13-bookkeeping-lite.sql` | 2026-06-13 | Create expenses table (Sprint 1 Phase A) | expenses | ✅ Active |
| `2026-06-13-communications.sql` | 2026-06-13 | Create communications + email_templates | communications, email_templates | ✅ Active |
| `2026-06-13-research-lite.sql` | 2026-06-13 | Normalize research_notes (add title, content, tags, timestamps) | research_notes | ✅ Active |
| `2026-06-13-research-enhancement.sql` | 2026-06-13 | Add visibility, client_id; GIN index on tags | research_notes | ✅ Active |
| `2026-06-13-kb-lite.sql` | 2026-06-13 | Normalize kb_entries; rename body→content; add is_pinned, status, fts, timestamps; GIN index | kb_entries | ✅ Active |
| `2026-06-13-kh-restructure.sql` | 2026-06-13 | Add summary column to kb_entries | kb_entries | ✅ Active |

**No deprecated or replaced migrations.** All are additive and idempotent.

---

## 7. Technical Debt Review

### CRITICAL

| Item | Location | Description |
|---|---|---|
| `knowledge-hub.js` function overlap | `netlify/functions/knowledge-hub.js` | Legacy function predating the Phase C KB system. Reads session/client data for "research intelligence" but overlaps with `research.js`. Routes for books/training/social are unimplemented stubs. Should be audited and either retired or scoped to Content Studio. |

---

### HIGH

| Item | Location | Description |
|---|---|---|
| `research-module.js` + `kb-module.js` still loaded | `dashboard.html` lines 10860-10861 | Both files are loaded via `<script>` tags and their `window.rnInit()` / `window.kbInit()` remain callable. The nav no longer shows their tabs but the `tab-research` and `tab-kb` divs still exist in DOM. Low risk but adds ~60KB of unused JS. |
| Legacy `tab-research` + `tab-kb` divs | `dashboard.html` ~line 2626-2629 | Orphaned DOM elements. Still dispatched via `showTab('research')` and `showTab('kb')` in the JS block for backward compatibility but never shown in nav. |
| `body` column on `kb_entries` | Supabase | If migration ran on a table with existing `body text NOT NULL` and both body+content now exist, the `body` column is nullable but unused. Dead column — should be dropped after confirming no legacy reads. |
| `check_*.js` / `chk_*.js` / `fix_*.py` / `patch_*.py` files | `website/` root | ~15 scratch scripts left in project root from development debugging. Not deployed (Netlify only deploys specific paths) but pollute the repo. |

---

### MEDIUM

| Item | Location | Description |
|---|---|---|
| Schema validation WARNs | `financial.js:validateSprint1Schema` | The schema validator cannot reach `information_schema` or `pg_catalog` via PostgREST — all constraint/index/RLS checks return WARN. The validator probes column presence via SELECT only. A service-role SQL function in Supabase could resolve this. |
| Denormalized `client_name` in 5 tables | sessions, aftercare, payments, packages, invoices | Client name duplicated across tables. If client name changes, display names are stale. Acceptable for a solo-practitioner app but should be noted for any multi-practitioner expansion. |
| `payments` table vs. `ledger_entries` dual system | payments.js + financial.js | Session payments recorded in `payments` (operational) AND optionally in `ledger_entries` (accounting). These are not automatically synced. The financial function's `record_payment` creates a ledger entry separately. |
| `daily_briefings` accumulates indefinitely | Supabase | One row per date, never cleaned up. Should add a periodic pruning job (e.g., keep 90 days). |
| `QA_TIMEOUT` vs `AI_TIMEOUT` inconsistency | `qa-agent.js` | Some KH section waits use TIMEOUT (20s) where AI_TIMEOUT (35s) is needed. Fixed for RN-11 but worth auditing remaining KH checks. |

---

### LOW

| Item | Location | Description |
|---|---|---|
| `clients-data.js` | `website/clients-data.js` | Static client data file — likely seed/demo data or an early prototype artifact. |
| `booking-check.js` / `script.js` | `website/` | General-purpose scripts whose current role is unclear. |
| `netlify-forms-sync.js` | `netlify/functions/` | Netlify Forms integration — role unclear given intake.js handles form submissions. May be a legacy webhook. |
| `square-sync.js` | `netlify/functions/` | Square payment integration — not referenced in dashboard or QA. Potential dead code or future feature. |
| `health-check-functions.js` | `netlify/functions/` | Separate from `operations-health.js`. Potential duplication. |
| `audit_logs` not exposed via API | `financial.js` schema validator | Schema validation WARNs on audit_logs because the table isn't queryable via the schema_validation endpoint. Minor — by design (security). |

---

## 8. Platform Roadmap

### Current State Summary

The platform is a **solo-practitioner operating system** with:
- ✅ Client & session management (CRUD, full lifecycle)
- ✅ AI-powered session intelligence (prep brief, attention flags, timeline, summary)
- ✅ Aftercare automation (5-touchpoint follow-up scheduling)
- ✅ Financial operations (packages, invoices, ledger, bookkeeping, P&L)
- ✅ Communication layer (email via Resend, template management)
- ✅ Research & Knowledge Hub (notes, pattern library, insights, articles)
- ✅ Analytics intelligence (outcomes, retention, cross-client, data quality)
- ✅ Operations center (health monitoring, QA persistence, audit log)

---

### Phase 1 — Architecture Stabilization (Current Sprint)
**Goal:** Make the platform maintainable and transferable.

- [x] Platform documentation (this document)
- [ ] Retire `knowledge-hub.js` legacy function or scope it
- [ ] Remove orphaned `tab-research` / `tab-kb` DOM elements
- [ ] Drop unused `body` column from `kb_entries` (post-validation)
- [ ] Clean `check_*.js` / `patch_*.py` debug files from repo
- [ ] Add `daily_briefings` pruning (keep 90 days)

---

### Phase 2 — Knowledge Hub Stabilization
**Goal:** Make Knowledge Hub the single practitioner intelligence center.

- [ ] Add FTS trigger on kb_entries (auto-populate `fts` column on insert/update)
- [ ] Add article version history (kb_entry_versions table)
- [ ] Add summary field to Pattern Library cards
- [ ] Add `client_id` cross-reference on research notes for per-client pattern view
- [ ] KB browse view: public-facing `/knowledge` page for published articles

---

### Phase 3 — Content Studio
**Goal:** Daron can produce social content, blog posts, and educational materials from session patterns.

- [ ] Content calendar (scheduled posts with draft/published/archived)
- [ ] Social post generator (Claude → post from pattern/insight)
- [ ] Script vault (video/podcast scripts linked to research notes)
- [ ] Book project tracker (chapter outlines, evidence mapping)
- [ ] Content analytics (what's been published, platform, engagement tracking)
- [ ] Replaces legacy `knowledge-hub.js` stubs for social/books/training

---

### Phase 4 — Marketing CRM
**Goal:** Close the loop between client outcomes and client acquisition.

- [ ] Lead pipeline (inquiry → consult → client)
- [ ] Referral source tracking (which channel brings which clients)
- [ ] Campaign tracking (email sequences, offers)
- [ ] Client lifecycle stages (prospect / active / lapsed / alumni)
- [ ] Testimonial capture (post-session prompts, consent workflow)
- [ ] Revenue attribution (which marketing → which package)

---

### Phase 5 — Referral Tracking
**Goal:** Systematize both inbound referrals (clients referred to Daron) and outbound (clients referred by Daron to other providers).

- [ ] Referral network map (practitioners, MDs, therapists)
- [ ] Track referral source per client (extend `intake_source`)
- [ ] Track practitioner referrals (extend `referrals` table)
- [ ] Reciprocal referral dashboard (who refers to whom, outcomes)
- [ ] Referral thank-you automation (Communications layer)

---

### Phase 6 — Training Center
**Goal:** Daron can teach and certify other practitioners.

- [ ] Course catalog (modules, lessons, quizzes)
- [ ] Student enrollment (student profiles linked to courses)
- [ ] Progress tracking (lesson completion, quiz scores)
- [ ] Certificate generation (PDF on completion)
- [ ] Video hosting integration (Vimeo/Bunny CDN)
- [ ] Prerequisite chains (course dependency graph)

---

### Phase 7 — Certification Management
**Goal:** Track who has been certified, in what, and when it needs renewal.

- [ ] Certification registry (student → certification → expiry)
- [ ] Renewal notifications (Communications layer automation)
- [ ] CE credit tracking (continuing education hours)
- [ ] Verification endpoint (public `/verify?cert_id=` for certificate lookup)
- [ ] Tiered certification levels (Foundation / Practitioner / Advanced / Master)

---

### Phase 8 — Practitioner Network
**Goal:** Extend platform to serve a network of certified healers under Daron's brand.

- [ ] Multi-practitioner accounts (each practitioner = isolated data scope)
- [ ] Network directory (public practitioner finder by location/modality)
- [ ] Revenue sharing (Daron earns from network referrals)
- [ ] Quality assurance (session log review, client satisfaction scores)
- [ ] Centralized Knowledge Hub (Daron's protocols available to network)
- [ ] Connects to Erika's Healer Network project (institution-funded access model)

---

*Document generated from live codebase analysis — 2026-06-13*  
*Platform: Netlify (Functions + Static) + Supabase (PostgreSQL)*  
*Stack: Node.js (serverless) · Vanilla JS (frontend) · PostgreSQL · Claude AI*
