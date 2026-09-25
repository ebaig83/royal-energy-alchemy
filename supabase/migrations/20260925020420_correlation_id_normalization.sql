-- Additive request-correlation normalization. Legacy text columns remain intact;
-- non-UUID historical/provider values are never cast or rewritten.
begin;

alter table public.payments add column if not exists correlation_uuid uuid;
alter table public.payment_mutation_audit add column if not exists correlation_uuid uuid;
alter table public.appointment_action_audit add column if not exists correlation_uuid uuid;
alter table public.appointment_notices add column if not exists correlation_uuid uuid;
alter table public.cancellation_requests add column if not exists correlation_uuid uuid;
alter table public.payment_reconciliation_audit add column if not exists correlation_uuid uuid;
alter table public.session_outcomes add column if not exists correlation_uuid uuid;
alter table public.stripe_webhook_events add column if not exists correlation_uuid uuid;
alter table public.communications add column if not exists correlation_uuid uuid;
alter table public.transactional_notifications add column if not exists correlation_uuid uuid;

-- Preserve the Stripe provider identifier as a distinct external reference.
alter table public.stripe_webhook_events add column if not exists stripe_event_id text;
update public.stripe_webhook_events set stripe_event_id=id where stripe_event_id is null;

-- Safe backfill: only syntactically valid UUID legacy values are copied. All
-- other legacy values remain queryable in their original text columns.
do $$
declare t text;
begin
 foreach t in array array[
  'payments','payment_mutation_audit','appointment_action_audit',
  'appointment_notices','cancellation_requests','payment_reconciliation_audit',
  'session_outcomes','stripe_webhook_events','communications',
  'transactional_notifications'
 ] loop
  if to_regclass('public.'||t) is not null
     and exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='correlation_id'
     ) then
   execute format(
    'update public.%I set correlation_uuid = correlation_id::uuid where correlation_uuid is null and correlation_id ~* %L',
    t, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   );
  end if;
 end loop;
end $$;

create index if not exists payments_correlation_uuid_idx on public.payments(correlation_uuid) where correlation_uuid is not null;
create index if not exists payment_mutation_audit_correlation_uuid_idx on public.payment_mutation_audit(correlation_uuid) where correlation_uuid is not null;
create index if not exists appointment_action_audit_correlation_uuid_idx on public.appointment_action_audit(correlation_uuid) where correlation_uuid is not null;
create index if not exists appointment_notices_correlation_uuid_idx on public.appointment_notices(correlation_uuid) where correlation_uuid is not null;
create index if not exists cancellation_requests_correlation_uuid_idx on public.cancellation_requests(correlation_uuid) where correlation_uuid is not null;
create index if not exists payment_reconciliation_audit_correlation_uuid_idx on public.payment_reconciliation_audit(correlation_uuid) where correlation_uuid is not null;
create index if not exists session_outcomes_correlation_uuid_idx on public.session_outcomes(correlation_uuid) where correlation_uuid is not null;
create index if not exists stripe_webhook_events_correlation_uuid_idx on public.stripe_webhook_events(correlation_uuid) where correlation_uuid is not null;
create index if not exists communications_correlation_uuid_idx on public.communications(correlation_uuid) where correlation_uuid is not null;
create index if not exists transactional_notifications_correlation_uuid_idx on public.transactional_notifications(correlation_uuid) where correlation_uuid is not null;

create or replace function public.sync_legacy_correlation_uuid()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare legacy text;
begin
 if to_jsonb(new) ? 'correlation_id' then
  legacy := to_jsonb(new)->>'correlation_id';
  if legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   new := jsonb_populate_record(new,jsonb_build_object('correlation_uuid',legacy::uuid));
  end if;
 end if;
 return new;
end $$;
revoke all on function public.sync_legacy_correlation_uuid() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['payments','payment_mutation_audit','appointment_action_audit','appointment_notices','cancellation_requests','payment_reconciliation_audit','session_outcomes','stripe_webhook_events'] loop
  if not exists (
    select 1 from pg_trigger tr
    where tr.tgrelid=to_regclass(format('public.%I',t))
      and tr.tgname='correlation_uuid_sync' and not tr.tgisinternal
  ) then
   execute format('create trigger correlation_uuid_sync before insert or update of correlation_id on public.%I for each row execute function public.sync_legacy_correlation_uuid()',t);
  end if;
 end loop;
end $$;

-- Replace active text-typed correlation RPC entry points with UUID-typed
-- wrappers. Their legacy implementations retain the historical text storage
-- contract internally; the trigger above writes the new UUID field atomically.
do $$
declare r record; args text; call_args text; result_type text; legacy_name text; body text; uuid_identity_args text;
begin
 for r in
  select p.oid,p.proname,pg_get_function_arguments(p.oid) as args,
         pg_get_function_identity_arguments(p.oid) as identity_args,
         pg_get_function_result(p.oid) as result_type,
         p.proargnames,p.pronargs,p.proargtypes
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
   'create_client_cancellation_request_with_audit','create_intake_session_with_audit',
   'create_website_booking_with_audit','payment_reconciliation_attach_with_audit',
   'practitioner_create_session_with_audit','practitioner_decide_cancellation_request',
   'practitioner_record_session_outcome_with_audit','record_appointment_action',
   'record_session_reminder_with_audit','trusted_session_update_with_audit'
  ) and exists (
   select 1 from unnest(p.proargnames) with ordinality a(name,ord)
   where a.name in ('p_correlation_id','p_correlation')
     and p.proargtypes[a.ord-1] = 'text'::regtype
  )
 loop
  legacy_name := r.proname||'_legacy_text';
  args := regexp_replace(r.args,'(p_correlation_id|p_correlation) text','\1 uuid','g');
  select string_agg(case when a.name in ('p_correlation_id','p_correlation') then quote_ident(a.name)||'::text' else quote_ident(a.name) end,', ' order by a.ord)
   into call_args from unnest(r.proargnames) with ordinality a(name,ord) where a.ord<=r.pronargs;
  select string_agg(case when a.name in ('p_correlation_id','p_correlation') then 'uuid' else format_type(r.proargtypes[a.ord-1],null) end,', ' order by a.ord)
   into uuid_identity_args from unnest(r.proargnames) with ordinality a(name,ord) where a.ord<=r.pronargs;
  execute format('alter function public.%I(%s) rename to %I',r.proname,r.identity_args,legacy_name);
  if r.result_type='void' then
   body := format('begin perform public.%I(%s); return; end',legacy_name,call_args);
  else
   body := format('begin return public.%I(%s); end',legacy_name,call_args);
  end if;
  -- The legacy implementation is deliberately revoked from application roles.
  -- Run the UUID boundary wrapper as its migration owner so the wrapper can
  -- delegate safely; the wrapper itself remains executable only by service_role.
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path=pg_catalog,public,pg_temp as %L',r.proname,args,r.result_type,body);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',r.proname,uuid_identity_args);
  execute format('grant execute on function public.%I(%s) to service_role',r.proname,uuid_identity_args);
  -- Keep legacy definitions only as inert compatibility artifacts. Active
  -- service callers must enter through the UUID-typed wrapper.
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',legacy_name,r.identity_args);
 end loop;
end $$;

-- The Stripe RPC is authored once, in the booking-integrity migration, in its
-- final form. Do not mutate its source text here: catalog string-replacement
-- was brittle and made clean replay depend on exact whitespace/body wording.
do $stripe_rpc_contract$
declare d text;
begin
 select regexp_replace(pg_get_functiondef(
   'public.process_stripe_webhook_event_with_audit(text,text,jsonb,uuid,jsonb,jsonb,text,text)'::regprocedure
 ), '[[:space:]]+', '', 'g') into d;
 if d not like '%v_correlation_iduuid:=gen_random_uuid()%'
    or d not like '%correlation_uuid=v_correlation_id%'
    or d not like '%stripe_event_id=p_event_id%' then
   raise exception 'Stripe RPC is missing its UUID correlation/provider-event contract';
 end if;
end
$stripe_rpc_contract$;

-- These operational message stores are server-only. Keep RLS enabled and
-- ensure the service role retains access while direct client roles do not.
alter table public.communications enable row level security;
alter table public.transactional_notifications enable row level security;
do $communication_constraints$
begin
 if not exists (select 1 from pg_constraint where conrelid='public.communications'::regclass and conname='communications_message_type_nonblank') then
  alter table public.communications add constraint communications_message_type_nonblank
   check (length(btrim(message_type)) > 0) not valid;
 end if;
end;
$communication_constraints$;
revoke all on public.communications, public.transactional_notifications from public, anon, authenticated;
grant all on public.communications, public.transactional_notifications to service_role;

commit;
