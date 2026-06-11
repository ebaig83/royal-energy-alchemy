-- Migration: recommendations + referrals tables
-- Run once in Supabase SQL Editor.

-- ── RECOMMENDATIONS ──────────────────────────────────────────────────────────
create table if not exists recommendations (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  session_id       uuid references sessions(id) on delete set null,
  product_name     text not null,
  category         text not null default 'other',
    -- supplement | crystal | essential_oil | book | course | device | service | other
  reason           text,
  priority         text not null default 'medium',   -- high | medium | low
  practitioner_notes text,
  purchased        text not null default 'unknown',  -- yes | no | unknown
  client_outcome   text,
  recommended_at   date not null default current_date,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists rec_client_idx  on recommendations(client_id);
create index if not exists rec_session_idx on recommendations(session_id);

-- ── REFERRALS ─────────────────────────────────────────────────────────────────
create table if not exists referrals (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  session_id       uuid references sessions(id) on delete set null,
  provider_name    text not null,
  provider_type    text not null default 'other',
    -- pcp | therapist | psychiatrist | nutritionist | functional_medicine |
    -- neurologist | physical_therapist | energy_practitioner | other
  contact_info     text,
  reason           text,
  urgency          text not null default 'routine',  -- urgent | soon | routine
  referred_at      date not null default current_date,
  followed_through text not null default 'unknown',  -- yes | no | unknown
  outcome_notes    text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists ref_client_idx  on referrals(client_id);
create index if not exists ref_session_idx on referrals(session_id);

-- ── RLS (deny all — service_role bypasses via BYPASSRLS) ─────────────────────
alter table recommendations enable row level security;
alter table referrals        enable row level security;

create policy "deny_all_anon_rec"  on recommendations for all to anon        using (false);
create policy "deny_all_auth_rec"  on recommendations for all to authenticated using (false);
create policy "deny_all_anon_ref"  on referrals        for all to anon        using (false);
create policy "deny_all_auth_ref"  on referrals        for all to authenticated using (false);

-- ── Grant service_role explicit table access ──────────────────────────────────
grant select, insert, update, delete on recommendations to service_role;
grant select, insert, update, delete on referrals        to service_role;

-- Updated_at triggers
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger rec_updated_at
  before update on recommendations
  for each row execute function touch_updated_at();

create trigger ref_updated_at
  before update on referrals
  for each row execute function touch_updated_at();
