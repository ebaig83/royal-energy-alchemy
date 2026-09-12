-- Auth UX Phase 2A: server-controlled remembered practitioner sessions.
-- Repository artifact only. Apply after separate Manager review.
begin;

alter table public.admin_sessions
  add column if not exists remembered boolean not null default false,
  add column if not exists credential_version integer,
  add column if not exists absolute_expires_at timestamptz;

update public.admin_sessions
set credential_version = coalesce(credential_version, (select version from public.practitioner_credentials where id = true), 0),
    absolute_expires_at = coalesce(absolute_expires_at, expires_at)
where credential_version is null or absolute_expires_at is null;

alter table public.admin_sessions
  alter column credential_version set default 0,
  alter column credential_version set not null,
  alter column absolute_expires_at set not null;

create index if not exists admin_sessions_policy_idx
  on public.admin_sessions (credential_version, expires_at, absolute_expires_at)
  where revoked_at is null;

create or replace function public.practitioner_login_session(
  p_version integer, p_token_hash text, p_email text, p_remembered boolean,
  p_ip text default null, p_user_agent text default null
) returns table(session_id uuid, expires_at timestamptz, absolute_expires_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_version integer;
declare issued_at timestamptz := clock_timestamp();
declare session_expiry timestamptz;
begin
  if p_version is null or p_version < 0 or length(p_token_hash) <> 64 or p_email is null then return; end if;
  select version into current_version from practitioner_credentials where id = true for share;
  if current_version is null or current_version <> p_version then return; end if;
  session_expiry := issued_at + case when coalesce(p_remembered, false) then interval '30 days' else interval '8 hours' end;
  return query
  insert into admin_sessions(token_hash, actor_email, created_at, expires_at, absolute_expires_at, last_seen_at, ip_address, user_agent, remembered, credential_version)
  values(p_token_hash, p_email, issued_at, session_expiry, session_expiry, issued_at, left(p_ip, 128), left(p_user_agent, 512), coalesce(p_remembered, false), current_version)
  returning id, admin_sessions.expires_at, admin_sessions.absolute_expires_at;
end $$;

revoke all on function public.practitioner_login_session(integer,text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.practitioner_login_session(integer,text,text,boolean,text,text) to service_role;
commit;
