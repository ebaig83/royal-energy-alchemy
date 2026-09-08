begin;
create table if not exists public.practitioner_recovery_tokens (
 token_hash text primary key check (length(token_hash)=64),
 expires_at timestamptz not null,
 used_at timestamptz
);
create index if not exists practitioner_recovery_tokens_expiry_idx on public.practitioner_recovery_tokens (expires_at);
create table if not exists public.practitioner_recovery_attempts (
 bucket text primary key check (length(bucket)=64),
 attempts integer not null,
 started_at timestamptz not null
);
alter table public.practitioner_recovery_tokens enable row level security;
alter table public.practitioner_recovery_attempts enable row level security;
revoke all on public.practitioner_recovery_tokens,public.practitioner_recovery_attempts from public,anon,authenticated;
grant all on public.practitioner_recovery_tokens,public.practitioner_recovery_attempts to service_role;
create or replace function public.practitioner_recovery_attempt(p_bucket text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 if length(p_bucket)<>64 then return false; end if;
 perform pg_advisory_xact_lock(hashtext('practitioner-recovery-attempts'));
 delete from practitioner_recovery_attempts where started_at < now()-interval '15 minutes';
 insert into practitioner_recovery_attempts values(p_bucket,1,now()) on conflict(bucket) do update set attempts=practitioner_recovery_attempts.attempts+1 returning attempts into n;
 return n<=3;
end $$;
create or replace function public.practitioner_recover(p_token_hash text,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare found_token text;
begin
 if length(p_token_hash)<>64 or p_hash !~ '^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$' then return false; end if;
 select token_hash into found_token from practitioner_recovery_tokens where token_hash=p_token_hash and used_at is null and expires_at>now() for update;
 if found_token is null then return false; end if;
 update practitioner_credentials set password_hash=p_hash,version=version+1,password_changed_at=clock_timestamp() where id=true;
 if not found then return false; end if;
 update admin_sessions set revoked_at=clock_timestamp() where revoked_at is null;
 update practitioner_recovery_tokens set used_at=clock_timestamp() where token_hash=p_token_hash;
 return true;
end $$;
revoke all on function public.practitioner_recovery_attempt(text),public.practitioner_recover(text,text) from public,anon,authenticated;
grant execute on function public.practitioner_recovery_attempt(text),public.practitioner_recover(text,text) to service_role;
commit;
