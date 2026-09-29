-- Royal Energy Alchemy: waitlist and short-lived checkout reservations.
create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  service text not null,
  preferred_days text[] not null default '{}',
  preferred_times text[] not null default '{}',
  timezone text not null default 'America/New_York',
  consent_at timestamptz not null,
  status text not null default 'waiting',
  exclusion_reason text,
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_status_ck check (status in ('waiting','offered','held','won','lost','expired','excluded','withdrawn'))
);

create table if not exists public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  waitlist_entry_id uuid not null references public.waitlist_entries(id) on delete cascade,
  wave integer not null,
  slot_id uuid references public.availability_slots(id) on delete set null,
  token_hash text not null unique,
  status text not null default 'offered',
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  accepted_at timestamptz,
  declined_at timestamptz,
  correlation_id uuid,
  constraint waitlist_offer_wave_ck check (wave in (1,2)),
  constraint waitlist_offer_status_ck check (status in ('offered','accepted','expired','lost','declined','cancelled'))
);

create table if not exists public.appointment_slot_reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.availability_slots(id) on delete cascade,
  attempt_id uuid references public.booking_attempts(id) on delete cascade,
  waitlist_offer_id uuid references public.waitlist_offers(id) on delete set null,
  status text not null default 'active',
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  correlation_id uuid,
  constraint reservation_status_ck check (status in ('active','released','won','expired')),
  constraint reservation_owner_ck check (attempt_id is not null or waitlist_offer_id is not null)
);

create unique index if not exists one_active_reservation_per_slot_idx on public.appointment_slot_reservations(slot_id) where status = 'active';
create index if not exists waitlist_match_idx on public.waitlist_entries(status, service, joined_at);
create index if not exists waitlist_expiry_idx on public.waitlist_entries(expires_at, status);
create index if not exists waitlist_offer_expiry_idx on public.waitlist_offers(expires_at, status);
create index if not exists reservation_expiry_idx on public.appointment_slot_reservations(expires_at, status);

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_offers enable row level security;
alter table public.appointment_slot_reservations enable row level security;
revoke all on public.waitlist_entries, public.waitlist_offers, public.appointment_slot_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.waitlist_entries, public.waitlist_offers, public.appointment_slot_reservations to service_role;
