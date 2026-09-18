-- Multi-user dashboard access: additive, per-user identity and session authority.
-- Apply in staging first. Production owner-email mapping must be reviewed before apply.
begin;

create table if not exists public.practitioner_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null default '',
  password_hash text,
  role text not null default 'staff' check (role in ('owner','developer','staff','authorized_user')),
  active boolean not null default true,
  credential_version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  last_login_at timestamptz,
  invited_at timestamptz,
  invite_token_hash text,
  invite_expires_at timestamptz
);
create unique index if not exists practitioner_users_email_idx on public.practitioner_users (lower(email));
create index if not exists practitioner_users_active_role_idx on public.practitioner_users (active, role);
alter table public.practitioner_users enable row level security;
revoke all on public.practitioner_users from public, anon, authenticated;
grant all on public.practitioner_users to service_role;

alter table public.admin_sessions
  add column if not exists user_id uuid,
  add column if not exists role text not null default 'owner';
create index if not exists admin_sessions_user_policy_idx
  on public.admin_sessions (user_id, credential_version, expires_at, absolute_expires_at)
  where revoked_at is null;

alter table public.practitioner_recovery_tokens
  add column if not exists user_id uuid;
create index if not exists practitioner_recovery_tokens_user_idx
  on public.practitioner_recovery_tokens (user_id, expires_at)
  where used_at is null;

-- The owner is deliberately created from the most recent legacy session identity.
-- If staging has no session history, the deployment operator must insert the reviewed
-- owner email before enabling multi-user login; no password is copied to SQL text.
insert into public.practitioner_users (email, display_name, role, password_hash, credential_version)
select lower(s.actor_email), 'Daron Royal', 'owner', c.password_hash, c.version
from public.practitioner_credentials c
cross join lateral (
  select actor_email from public.admin_sessions
  where actor_email is not null and trim(actor_email) <> ''
  order by created_at desc limit 1
) s
where c.id = true and s.actor_email is not null
  and not exists (select 1 from public.practitioner_users where role = 'owner');

update public.admin_sessions s
set user_id = u.id, role = u.role
from public.practitioner_users u
where s.user_id is null and lower(s.actor_email) = lower(u.email);

update public.practitioner_recovery_tokens t
set user_id = u.id
from public.practitioner_users u
where t.user_id is null and u.role = 'owner';

insert into public.email_templates (name, type, subject, html_body, text_body, variables, is_active)
values (
  'practitioner_user_invitation', 'general_message',
  'You have been invited to Royal Energy Alchemy',
  '<p>You have been invited to access the Royal Energy Alchemy practitioner dashboard.</p><p><a href="{{invite_url}}">Set your password</a></p><p>This invitation expires in 20 minutes and can be used once.</p>',
  'You have been invited to access the Royal Energy Alchemy practitioner dashboard. Open this link to set your password: {{invite_url}}. This invitation expires in 20 minutes and can be used once.',
  ARRAY['invite_url'], true
)
on conflict (name) do update set type=excluded.type,subject=excluded.subject,html_body=excluded.html_body,text_body=excluded.text_body,variables=excluded.variables,is_active=true;

create or replace function public.practitioner_user_login_session(
  p_user_id uuid, p_token_hash text, p_remembered boolean,
  p_ip text default null, p_user_agent text default null
) returns table(session_id uuid, expires_at timestamptz, absolute_expires_at timestamptz, role text, credential_version bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.practitioner_users%rowtype;
declare issued_at timestamptz := clock_timestamp();
declare session_expiry timestamptz;
begin
  if p_user_id is null or length(p_token_hash) <> 64 then return; end if;
  select * into u from public.practitioner_users where id=p_user_id and active=true for share;
  if not found then return; end if;
  session_expiry := issued_at + case when coalesce(p_remembered,false) then interval '30 days' else interval '8 hours' end;
  return query
  insert into public.admin_sessions(token_hash,actor_email,user_id,role,created_at,expires_at,absolute_expires_at,last_seen_at,ip_address,user_agent,remembered,credential_version)
  values(p_token_hash,u.email,u.id,u.role,issued_at,session_expiry,session_expiry,issued_at,left(p_ip,128),left(p_user_agent,512),coalesce(p_remembered,false),u.credential_version)
  returning id,admin_sessions.expires_at,admin_sessions.absolute_expires_at,admin_sessions.role,admin_sessions.credential_version;
end $$;

create or replace function public.practitioner_user_change_password(
  p_user_id uuid, p_session uuid, p_hash text
) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.practitioner_users%rowtype;
begin
  if p_hash !~ '^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$' then return false; end if;
  select * into u from public.practitioner_users where id=p_user_id and active=true for update;
  if not found or not exists(select 1 from public.admin_sessions where id=p_session and user_id=p_user_id and revoked_at is null and expires_at>now()) then return false; end if;
  update public.practitioner_users set password_hash=p_hash,credential_version=credential_version+1,last_login_at=null where id=p_user_id;
  update public.admin_sessions set revoked_at=clock_timestamp() where user_id=p_user_id and revoked_at is null;
  return true;
end $$;

create or replace function public.practitioner_user_recover(
  p_token_hash text, p_hash text
) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.practitioner_recovery_tokens%rowtype;
begin
  if length(p_token_hash) <> 64 or p_hash !~ '^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$' then return false; end if;
  select * into t from public.practitioner_recovery_tokens
  where token_hash=p_token_hash and used_at is null and expires_at>now() for update;
  if not found or t.user_id is null then return false; end if;
  update public.practitioner_users set password_hash=p_hash,credential_version=credential_version+1 where id=t.user_id and active=true;
  if not found then return false; end if;
  update public.admin_sessions set revoked_at=clock_timestamp() where user_id=t.user_id and revoked_at is null;
  update public.practitioner_recovery_tokens set used_at=clock_timestamp() where token_hash=p_token_hash;
  return true;
end $$;

revoke all on function public.practitioner_user_login_session(uuid,text,boolean,text,text), public.practitioner_user_change_password(uuid,uuid,text), public.practitioner_user_recover(text,text) from public,anon,authenticated;
grant execute on function public.practitioner_user_login_session(uuid,text,boolean,text,text), public.practitioner_user_change_password(uuid,uuid,text), public.practitioner_user_recover(text,text) to service_role;
commit;
