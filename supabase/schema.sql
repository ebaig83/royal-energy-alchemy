-- ─────────────────────────────────────────────────────────────────────────────
-- Royal Energy Alchemy — Supabase Schema
-- Run this entire file in your Supabase SQL Editor (project → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENTS
-- One row per unique client. Created on first intake or manual entry.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text,
  phone           text,
  source          text default 'website_form',  -- website_form | square | manual
  status          text default 'active',         -- active | inactive | flagged
  notes           text,
  tags            text[],
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists clients_email_idx on clients(email);
create index if not exists clients_name_idx  on clients(full_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- SESSIONS
-- Every booking — website form, Square, or manual entry.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists sessions (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete set null,
  client_name         text,                        -- denormalized for fast display
  service             text,
  session_date        date,
  session_time        time,
  duration_minutes    integer default 60,
  location_type       text default 'distance',     -- distance | local | phone | video
  status              text default 'pending',      -- pending | confirmed | completed | cancelled | no_show
  payment_status      text default 'unpaid',       -- unpaid | paid | partial | refunded
  amount_due          numeric(8,2),
  amount_paid         numeric(8,2) default 0,
  square_booking_id   text,
  square_customer_id  text,
  source              text default 'website_form', -- website_form | square | manual
  seller_notes        text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists sessions_client_id_idx on sessions(client_id);
create index if not exists sessions_date_idx      on sessions(session_date);
create index if not exists sessions_status_idx    on sessions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- INTAKE SUBMISSIONS
-- Raw form submissions before they are processed into clients/sessions.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists intake_submissions (
  id                      uuid primary key default gen_random_uuid(),
  netlify_submission_id   text unique,
  client_id               uuid references clients(id) on delete set null,
  session_id              uuid references sessions(id) on delete set null,
  full_name               text,
  email                   text,
  phone                   text,
  service_requested       text,
  preferred_window_1      text,
  preferred_window_2      text,
  message                 text,
  raw_data                jsonb,                   -- full original submission
  processed               boolean default false,
  processed_at            timestamptz,
  agent_summary           text,                    -- intake agent output
  spam_suspect            boolean default false,
  source                  text default 'website_form',
  created_at              timestamptz default now()
);

create index if not exists intake_processed_idx on intake_submissions(processed);
create index if not exists intake_email_idx     on intake_submissions(email);

-- ─────────────────────────────────────────────────────────────────────────────
-- SESSION NOTES
-- Daron's notes per session — intake assessment, during-session, post-session.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists session_notes (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references sessions(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  note_type       text default 'session',   -- intake | session | post_session | follow_up
  content         text not null,
  agent_enhanced  text,                      -- agent-polished version of the note
  energy_findings text,                      -- structured: what was found energetically
  removals_done   text[],                    -- list of things removed/cleared
  recommendations text,                      -- what Daron recommends next
  authored_by     text default 'daron',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists notes_session_idx on session_notes(session_id);
create index if not exists notes_client_idx  on session_notes(client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- AFTERCARE
-- Scheduled follow-up records: 24h, 48h, 72h, 1mo, 3mo
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists aftercare (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references sessions(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  client_name     text,
  followup_type   text not null,             -- 24h | 48h | 72h | 1mo | 3mo
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  status          text default 'scheduled',  -- scheduled | sent | skipped | bounced
  channel         text default 'email',      -- email | sms | messenger
  message_body    text,                       -- agent-generated message
  client_response text,                       -- if they replied
  created_at      timestamptz default now()
);

create index if not exists aftercare_session_idx      on aftercare(session_id);
create index if not exists aftercare_scheduled_idx    on aftercare(scheduled_for);
create index if not exists aftercare_status_idx       on aftercare(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS
-- Every payment record — manual entry or Square sync.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid references sessions(id) on delete set null,
  client_id           uuid references clients(id) on delete set null,
  client_name         text,
  amount              numeric(8,2) not null,
  method              text,                  -- cash_app | paypal | venmo | zelle | square | cash
  reference_id        text,                  -- payment app transaction ID if available
  status              text default 'received', -- received | pending | refunded | failed
  notes               text,
  paid_at             timestamptz default now(),
  created_at          timestamptz default now()
);

create index if not exists payments_session_idx on payments(session_id);
create index if not exists payments_client_idx  on payments(client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- WAITLIST
-- Clients who filled the waitlist form.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists waitlist (
  id                      uuid primary key default gen_random_uuid(),
  netlify_submission_id   text unique,
  full_name               text,
  email                   text,
  phone                   text,
  service_interest        text,
  message                 text,
  status                  text default 'waiting',  -- waiting | contacted | converted | removed
  converted_client_id     uuid references clients(id) on delete set null,
  created_at              timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DAILY BRIEFINGS
-- One record per day — generated by the daily briefing agent.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists daily_briefings (
  id              uuid primary key default gen_random_uuid(),
  briefing_date   date unique not null default current_date,
  sessions_count  integer default 0,
  revenue_due     numeric(8,2) default 0,
  revenue_paid    numeric(8,2) default 0,
  follow_ups_due  integer default 0,
  new_intakes     integer default 0,
  issues          jsonb,     -- array of flagged items
  summary_text    text,      -- agent-written briefing in plain English
  raw_data        jsonb,     -- full snapshot used to generate it
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOGS
-- Every write action across the system. Never deleted.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists audit_logs (
  id          bigserial primary key,
  actor       text default 'daron',         -- who did it (admin user email or 'system')
  action      text not null,                -- created | updated | deleted | processed | sent | synced
  table_name  text not null,
  record_id   text,                          -- UUID of the affected row
  old_data    jsonb,
  new_data    jsonb,
  context     text,                          -- short human description e.g. "Marked session complete"
  ip_address  text,
  created_at  timestamptz default now()
);

create index if not exists audit_table_idx  on audit_logs(table_name);
create index if not exists audit_actor_idx  on audit_logs(actor);
create index if not exists audit_time_idx   on audit_logs(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at on clients and sessions
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at
  before update on clients
  for each row execute function touch_updated_at();

create trigger sessions_updated_at
  before update on sessions
  for each row execute function touch_updated_at();

create trigger session_notes_updated_at
  before update on session_notes
  for each row execute function touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- All tables locked down — only service_role key (used by Netlify Functions)
-- can read/write. The anon key cannot access anything.
-- ─────────────────────────────────────────────────────────────────────────────
alter table clients             enable row level security;
alter table sessions            enable row level security;
alter table intake_submissions  enable row level security;
alter table session_notes       enable row level security;
alter table aftercare           enable row level security;
alter table payments            enable row level security;
alter table waitlist            enable row level security;
alter table daily_briefings     enable row level security;
alter table audit_logs          enable row level security;

-- Service role bypasses RLS automatically — no policy needed for it.
-- Deny everything for anon and authenticated roles on all tables.
-- (Netlify Functions use service_role key, so they always get through.)

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'clients','sessions','intake_submissions','session_notes',
    'aftercare','payments','waitlist','daily_briefings','audit_logs'
  ] loop
    execute format(
      'create policy "deny_all_%s" on %I as restrictive
       for all to anon, authenticated using (false)',
      tbl, tbl
    );
  end loop;
end;
$$;
