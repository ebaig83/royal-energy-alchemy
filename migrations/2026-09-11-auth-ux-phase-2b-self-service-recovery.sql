-- Auth UX Phase 2B: public, generic, single-use practitioner recovery.
-- Repository artifact only. Apply after separate Manager review.
begin;

alter table public.practitioner_recovery_tokens
  add column if not exists request_email_hash text,
  add column if not exists request_ip_hash text,
  add column if not exists provider_message_id text;

create table if not exists public.practitioner_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  outcome text not null,
  identifier_hash text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
alter table public.practitioner_recovery_audit enable row level security;
revoke all on public.practitioner_recovery_audit from public, anon, authenticated;
grant all on public.practitioner_recovery_audit to service_role;
create index if not exists practitioner_recovery_audit_created_idx on public.practitioner_recovery_audit(created_at desc);

create or replace function public.practitioner_recovery_request_attempt(p_bucket text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  if length(p_bucket)<>64 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('practitioner-recovery-request-attempts'));
  delete from practitioner_recovery_attempts where started_at < now()-interval '15 minutes';
  insert into practitioner_recovery_attempts values(p_bucket,1,now())
    on conflict(bucket) do update set attempts=practitioner_recovery_attempts.attempts+1 returning attempts into n;
  return n<=3;
end $$;

revoke all on function public.practitioner_recovery_request_attempt(text) from public, anon, authenticated;
grant execute on function public.practitioner_recovery_request_attempt(text) to service_role;

INSERT INTO public.email_templates (name, type, subject, html_body, text_body, variables, is_active)
VALUES (
  'practitioner_password_recovery',
  'general_message',
  'Reset your Royal Energy Alchemy practitioner password',
  '<p>Hello Daron,</p><p>We received a request to reset your practitioner dashboard password.</p><p><a href="{{reset_url}}" style="display:inline-block;padding:12px 18px;background:#1d7a88;color:#fff;text-decoration:none;border-radius:6px">Create a new password</a></p><p>This link expires in 20 minutes and can be used once. If you did not request this, you can safely ignore this email.</p>',
  'Hello Daron,\n\nWe received a request to reset your practitioner dashboard password. Open this link to create a new password: {{reset_url}}\n\nThis link expires in 20 minutes and can be used once. If you did not request this, you can safely ignore this email.',
  ARRAY['reset_url'],
  true
)
ON CONFLICT (name) DO UPDATE SET type=EXCLUDED.type, subject=EXCLUDED.subject, html_body=EXCLUDED.html_body, text_body=EXCLUDED.text_body, variables=EXCLUDED.variables, is_active=true;

commit;
