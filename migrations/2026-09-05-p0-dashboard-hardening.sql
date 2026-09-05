-- P0 dashboard hardening: short-lived, revocable administrator sessions.
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  actor_email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  ip_address text,
  user_agent text
);

create index if not exists admin_sessions_active_hash_idx
  on public.admin_sessions (token_hash, expires_at)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;
drop policy if exists "deny_all_admin_sessions" on public.admin_sessions;
create policy "deny_all_admin_sessions" on public.admin_sessions as restrictive
  for all to anon, authenticated using (false);

grant select, insert, update, delete on public.admin_sessions to service_role;
