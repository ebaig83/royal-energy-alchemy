begin;
create table if not exists public.practitioner_credentials (
 id boolean primary key default true check(id), password_hash text,
 version bigint not null default 0, created_at timestamptz not null default now(), password_changed_at timestamptz
);
insert into public.practitioner_credentials(id) values(true) on conflict do nothing;
create table if not exists public.practitioner_attempts (
 bucket text primary key, attempts integer not null, started_at timestamptz not null
);
alter table public.practitioner_credentials enable row level security;
alter table public.practitioner_attempts enable row level security;
revoke all on public.practitioner_credentials,public.practitioner_attempts from public,anon,authenticated;
grant all on public.practitioner_credentials,public.practitioner_attempts to service_role;
create or replace function public.practitioner_attempt(p_bucket text,p_kind text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; total integer;
begin
 if p_kind not in ('login','change') or length(p_bucket)<>64 then return false; end if;
 perform pg_advisory_xact_lock(hashtext('practitioner-auth-attempts'));
 delete from practitioner_attempts where started_at < now()-interval '15 minutes';
 insert into practitioner_attempts values(p_bucket,1,now()) on conflict(bucket) do update set attempts=practitioner_attempts.attempts+1 returning attempts into n;
 select coalesce(sum(attempts),0) into total from practitioner_attempts;
 return n<=5 and total<=50;
end $$;
create or replace function public.practitioner_login(p_version bigint,p_token_hash text,p_email text,p_expires timestamptz) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v bigint;
begin
 select version into v from practitioner_credentials where id=true for update;
 if v is distinct from p_version then return false; end if;
 insert into admin_sessions(token_hash,actor_email,expires_at) values(p_token_hash,p_email,p_expires);
 return true;
end $$;
create or replace function public.practitioner_change(p_version bigint,p_session uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v bigint;
begin
 select version into v from practitioner_credentials where id=true for update;
 if v is distinct from p_version or p_hash !~ '^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$' then return false; end if;
 if not exists(select 1 from admin_sessions where id=p_session and revoked_at is null and expires_at>now()) then return false; end if;
 update practitioner_credentials set password_hash=p_hash,version=version+1,password_changed_at=clock_timestamp() where id=true;
 update admin_sessions set revoked_at=clock_timestamp() where revoked_at is null;
 return true;
end $$;
revoke all on function public.practitioner_attempt(text,text),public.practitioner_login(bigint,text,text,timestamptz),public.practitioner_change(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_attempt(text,text),public.practitioner_login(bigint,text,text,timestamptz),public.practitioner_change(bigint,uuid,text) to service_role;
commit;
