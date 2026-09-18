-- Staging correction for the multi-user recovery RPC hash-format validator.
-- Apply to staging only while validating the multi-user release.
begin;

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
  select * into t from public.practitioner_recovery_tokens where token_hash=p_token_hash and used_at is null and expires_at>now() for update;
  if not found or t.user_id is null then return false; end if;
  update public.practitioner_users set password_hash=p_hash,credential_version=credential_version+1 where id=t.user_id and active=true;
  if not found then return false; end if;
  update public.admin_sessions set revoked_at=clock_timestamp() where user_id=t.user_id and revoked_at is null;
  update public.practitioner_recovery_tokens set used_at=clock_timestamp() where token_hash=p_token_hash;
  return true;
end $$;

revoke all on function public.practitioner_user_change_password(uuid,uuid,text), public.practitioner_user_recover(text,text) from public,anon,authenticated;
grant execute on function public.practitioner_user_change_password(uuid,uuid,text), public.practitioner_user_recover(text,text) to service_role;
commit;
