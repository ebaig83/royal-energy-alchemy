-- Review-only migration: do not apply until the P1 production review is approved.
-- Private worker heartbeat metadata; no business data, PII, tokens or provider payloads.
create table if not exists public.worker_health (
  worker text primary key check (worker in ('calendar','communications')),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null check (status in ('running','healthy','attention','failed')),
  failed_count integer check (failed_count >= 0)
);
alter table public.worker_health enable row level security;
revoke all on public.worker_health from anon, authenticated;
grant select, insert, update on public.worker_health to service_role;
