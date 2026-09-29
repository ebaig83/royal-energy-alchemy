-- Royal Energy Alchemy: durable non-operational booking attempts.
-- Additive only. Incomplete attempts deliberately do not reference sessions.
create extension if not exists pgcrypto;

create table if not exists public.booking_attempts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  client_first_name text,
  client_last_name text,
  client_email text,
  client_phone text,
  client_timezone text,
  client_preferences jsonb not null default '{}'::jsonb,
  service text,
  service_id text,
  session_date date,
  session_time time,
  location_type text,
  service_address jsonb,
  slot_id uuid references public.availability_slots(id) on delete set null,
  waiver_completed boolean not null default false,
  waiver_completed_at timestamptz,
  payment_status text not null default 'pending',
  payment_reference text,
  payment_amount numeric(8,2),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  status text not null default 'incomplete',
  source text not null default 'website',
  waitlist_offer_id uuid,
  abandoned_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  last_resumed_at timestamptz,
  recovery_1_scheduled_at timestamptz,
  recovery_1_sent_at timestamptz,
  recovery_2_scheduled_at timestamptz,
  recovery_2_sent_at timestamptz,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_attempt_status_ck check (status in ('incomplete','resumed','completed','withdrawn','expired','unavailable','ineligible')),
  constraint booking_attempt_payment_ck check (payment_status in ('pending','paid','failed','refunded','not_required')),
  constraint booking_attempt_name_ck check (client_first_name is null or length(btrim(client_first_name)) between 1 and 100),
  constraint booking_attempt_email_ck check (client_email is null or position('@' in client_email) > 1),
  constraint booking_attempt_location_ck check (location_type is null or location_type in ('distance','remote','phone','in_person','in-person','local'))
);

create table if not exists public.booking_resume_tokens (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.booking_attempts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_recovery_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.booking_attempts(id) on delete cascade,
  reminder_number integer not null,
  status text not null default 'scheduled',
  recipient_email text,
  provider_message_id text,
  correlation_id uuid,
  error_message text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_recovery_number_ck check (reminder_number in (1,2)),
  constraint booking_recovery_status_ck check (status in ('scheduled','sent','failed','suppressed','cancelled')),
  unique (attempt_id, reminder_number)
);

create table if not exists public.booking_attempt_audit (
  id bigserial primary key,
  attempt_id uuid not null references public.booking_attempts(id) on delete restrict,
  action text not null,
  previous_state jsonb,
  new_state jsonb,
  correlation_id uuid,
  actor_type text not null default 'system',
  actor_id text,
  created_at timestamptz not null default now()
);

create index if not exists booking_attempt_status_expiry_idx on public.booking_attempts(status, expires_at);
create index if not exists booking_attempt_recovery_idx on public.booking_attempts(status, abandoned_at, recovery_1_sent_at, recovery_2_sent_at);
create index if not exists booking_attempt_slot_idx on public.booking_attempts(slot_id) where slot_id is not null;
create index if not exists booking_resume_expiry_idx on public.booking_resume_tokens(expires_at) where revoked_at is null;
create index if not exists booking_recovery_due_idx on public.booking_recovery_events(status, scheduled_at);

alter table public.booking_attempts enable row level security;
alter table public.booking_resume_tokens enable row level security;
alter table public.booking_recovery_events enable row level security;
alter table public.booking_attempt_audit enable row level security;
revoke all on public.booking_attempts, public.booking_resume_tokens, public.booking_recovery_events, public.booking_attempt_audit from public, anon, authenticated;
grant select, insert, update, delete on public.booking_attempts, public.booking_resume_tokens, public.booking_recovery_events to service_role;
grant select, insert on public.booking_attempt_audit to service_role;

create or replace function public.touch_booking_attempt_updated_at() returns trigger language plpgsql set search_path=pg_catalog, public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;
;
drop trigger if exists booking_attempts_updated_at on public.booking_attempts;
create trigger booking_attempts_updated_at before update on public.booking_attempts for each row execute function public.touch_booking_attempt_updated_at();
