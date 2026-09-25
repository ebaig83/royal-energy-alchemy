begin;

-- This UUID is consumed by the audited reconciliation/session mutation below.
-- Keep it ahead of those RPC definitions; the later normalization migration's
-- ADD COLUMN IF NOT EXISTS remains a harmless compatibility guard.
alter table public.sessions add column if not exists correlation_id uuid;

create table if not exists public.session_service_addresses (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.session_service_addresses enable row level security;
revoke all on public.session_service_addresses from public, anon, authenticated;
grant select,insert,update,delete on public.session_service_addresses to service_role;

create table if not exists public.appointment_action_audit (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  actor_type text not null,
  actor_id text,
  actor_email text,
  source text not null,
  action text not null,
  previous_state jsonb,
  new_state jsonb,
  correlation_id text not null,
  request_path text,
  created_at timestamptz not null default now(),
  constraint appointment_action_audit_actor_type_check
    check (actor_type in ('practitioner','client','system','admin','unknown'))
);

create index if not exists appointment_action_audit_session_created_idx
  on public.appointment_action_audit(session_id, created_at desc);
create unique index if not exists appointment_action_audit_correlation_action_idx
  on public.appointment_action_audit(session_id, correlation_id, action);

alter table public.appointment_action_audit enable row level security;
revoke all on public.appointment_action_audit from public, anon, authenticated;
grant all on public.appointment_action_audit to service_role;

alter table public.appointment_notices
  add column if not exists actor_type text,
  add column if not exists actor_id text,
  add column if not exists actor_email text,
  add column if not exists source text,
  add column if not exists correlation_id text,
  add column if not exists request_path text,
  add column if not exists previous_state jsonb,
  add column if not exists new_state jsonb;

-- Existing rows deliberately remain NULL: historical actor identity is unknown.
create or replace function public.record_appointment_action(
  p_session_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_actor_email text,
  p_source text,
  p_action text,
  p_previous_state jsonb,
  p_new_state jsonb,
  p_correlation_id text,
  p_request_path text default null
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare audit_id uuid;
begin
  if p_actor_type is null or p_actor_type not in ('practitioner','client','system','admin','unknown') then
    raise exception 'Invalid appointment actor type';
  end if;
  if nullif(btrim(p_source), '') is null or nullif(btrim(p_action), '') is null or nullif(btrim(p_correlation_id), '') is null then
    raise exception 'Appointment audit source, action, and correlation ID are required';
  end if;
  insert into public.appointment_action_audit(
    session_id, actor_type, actor_id, actor_email, source, action,
    previous_state, new_state, correlation_id, request_path
  ) values (
    p_session_id, p_actor_type, p_actor_id, nullif(lower(btrim(p_actor_email)), ''),
    p_source, p_action, p_previous_state, p_new_state, p_correlation_id, p_request_path
  ) on conflict (session_id, correlation_id, action) do nothing
  returning id into audit_id;
  if audit_id is null then
    select id into audit_id from public.appointment_action_audit
    where session_id is not distinct from p_session_id
      and correlation_id = p_correlation_id and action = p_action;
  end if;
  return audit_id;
end;
$function$;

revoke all on function public.record_appointment_action(uuid,text,text,text,text,text,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.record_appointment_action(uuid,text,text,text,text,text,jsonb,jsonb,text,text) to service_role;

create or replace function public.practitioner_appointment_change(
 p_id uuid, p_action text, p_expected_date date, p_expected_time time without time zone,
 p_date date, p_time time without time zone, p_actor_type text, p_actor_id text,
 p_actor_email text, p_source text, p_request_path text, p_reason text,
 p_request uuid, p_correlation uuid, p_slot uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
 old public.sessions%rowtype;
 changed public.sessions%rowtype;
 target public.availability_slots%rowtype;
 prior public.appointment_notices%rowtype;
 starts timestamp;
 ends timestamp;
 actor_type text := p_actor_type;
 actor_id text := p_actor_id;
 actor_email text := lower(btrim(p_actor_email));
 action_source text := p_source;
 previous_state jsonb;
 new_state jsonb;
begin
 if p_action not in ('reschedule','cancel') then raise exception 'Unsupported action'; end if;
 if actor_type is null or action_source is null or (actor_type='practitioner' and action_source<>'dashboard') or (actor_type='client' and action_source<>'manage_appointment') or actor_type not in ('practitioner','client') then raise exception 'Invalid trusted actor context'; end if;
 if p_request is null or p_correlation is null then raise exception 'Request and correlation identifiers are required'; end if;
 if nullif(btrim(p_request_path),'') is null then raise exception 'Trusted request path is required'; end if;
 if actor_type='practitioner' and (actor_email is null or actor_id is null or not exists(select 1 from public.practitioner_users pu where pu.id::text=actor_id and lower(pu.email)=actor_email and pu.active=true)) then raise exception 'Practitioner actor is not active'; end if;
 lock table public.sessions in share row exclusive mode;
 lock table public.availability_slots in share row exclusive mode;
 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;
 select * into prior from public.appointment_notices where id=p_request;
 if found then
  if prior.session_id<>p_id or prior.action<>p_action then raise exception 'Request already used'; end if;
  return jsonb_build_object('session',to_jsonb(old),'duplicate',true,'correlation_id',prior.correlation_id);
 end if;
 if old.session_date is distinct from p_expected_date or old.session_time is distinct from p_expected_time then raise exception 'Appointment changed. Reload and review.'; end if;
 if old.status in ('cancelled','completed','no_show','expired') then raise exception 'Appointment is not active'; end if;
 if p_action='reschedule' then
  if p_date is null or p_time is null then raise exception 'New date and time required'; end if;
  starts:=p_date+p_time; ends:=starts+make_interval(mins=>coalesce(nullif(old.duration_minutes,0),60));
  if starts at time zone 'America/New_York'<=now() then raise exception 'Choose a future time'; end if;
  if p_date=old.session_date and p_time=old.session_time then raise exception 'Choose a different time'; end if;
  if exists(select 1 from public.sessions s where s.id<>p_id and coalesce(s.status,'pending') not in ('cancelled','completed','no_show','expired') and s.session_date+s.session_time<ends and s.session_date+s.session_time+make_interval(mins=>coalesce(nullif(s.duration_minutes,0),60))>starts) then raise exception 'Appointment overlaps an existing session'; end if;
  if p_slot is not null then
   select * into target from public.availability_slots where id=p_slot;
   if not found or target.slot_date<>p_date or target.slot_time<>p_time or target.status<>'available' then raise exception 'Selected time slot is unavailable'; end if;
  end if;
  if exists(select 1 from public.availability_slots where slot_date=p_date and slot_time>=p_time and slot_date+slot_time<ends and status<>'available' and session_id is distinct from p_id) then raise exception 'Time is blocked'; end if;
 end if;
 previous_state:=jsonb_build_object('status',old.status,'payment_status',old.payment_status,'booking_status',old.booking_status,'session_date',old.session_date,'session_time',old.session_time,'service',old.service,'location_type',old.location_type);
 update public.availability_slots set status='available',session_id=null where session_id=p_id;
 if p_action='reschedule' then
  update public.availability_slots set status='booked',session_id=p_id where slot_date=p_date and slot_time>=p_time and slot_date+slot_time<ends;
  update public.sessions set session_date=p_date,session_time=p_time,
   status=case when lower(coalesce(source,'')) in ('online','website','website_booking','website booking','website_form','booking') and (lower(coalesce(payment_status,''))<>'paid' or lower(coalesce(booking_status,''))<>'confirmed') then 'pending' else 'confirmed' end,
   booking_status=case when lower(coalesce(source,'')) in ('online','website','website_booking','website booking','website_form','booking') and (lower(coalesce(payment_status,''))<>'paid' or lower(coalesce(booking_status,''))<>'confirmed') then 'payment_required' else booking_status end,
   reschedule_count=coalesce(reschedule_count,0)+1,reschedule_reason=left(p_reason,500),last_rescheduled_at=now(),last_rescheduled_by=actor_email,
   google_calendar_status=case when lower(coalesce(source,'')) in ('online','website','website_booking','website booking','website_form','booking') and (lower(coalesce(payment_status,''))<>'paid' or lower(coalesce(booking_status,''))<>'confirmed') then case when google_calendar_event_id is not null then 'cancel_pending' else 'not_requested' end when google_calendar_event_id is not null then 'reschedule_pending' when payment_status='paid' and booking_status='confirmed' and location_type in ('remote','distance') and source is distinct from 'manual_planner_import_20260905' then 'pending' else 'not_requested' end,
   google_calendar_error=null where id=p_id returning * into changed;
 else
  update public.sessions set status='cancelled',google_calendar_status=case when google_calendar_event_id is not null then 'cancel_pending' else 'cancelled' end,google_calendar_error=null where id=p_id returning * into changed;
 end if;
 new_state:=jsonb_build_object('status',changed.status,'payment_status',changed.payment_status,'booking_status',changed.booking_status,'session_date',changed.session_date,'session_time',changed.session_time,'service',changed.service,'location_type',changed.location_type);
 if actor_type='client' and (actor_id is distinct from old.client_id::text or actor_email is distinct from (select lower(c.email) from public.clients c where c.id=old.client_id)) then raise exception 'Client actor does not match the session'; end if;
 insert into public.appointment_notices(id,session_id,action,old_date,old_time,new_date,new_time,actor_type,actor_id,actor_email,source,correlation_id,request_path,previous_state,new_state)
 values(p_request,p_id,p_action,old.session_date,old.session_time,changed.session_date,changed.session_time,actor_type,actor_id,actor_email,action_source,p_correlation::text,p_request_path,previous_state,new_state);
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,actor_type,actor_id,actor_email,action_source,p_action,previous_state,new_state,p_correlation::text,p_request_path)
 on conflict (session_id,correlation_id,action) do nothing;
 return jsonb_build_object('session',to_jsonb(changed),'duplicate',false);
end;
$function$;

revoke all on function public.practitioner_appointment_change(uuid,text,date,time,date,time,text,text,text,text,text,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.practitioner_appointment_change(uuid,text,date,time,date,time,text,text,text,text,text,text,uuid,uuid,uuid) to service_role;

-- Restoring an appointment and reclaiming its original slot are one transaction.
create or replace function public.practitioner_restore_appointment(
 p_id uuid, p_actor_id text, p_actor_email text, p_request uuid,
 p_calendar_status text default 'not_requested', p_request_path text default '/.netlify/functions/sessions', p_website_eligible boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare old public.sessions%rowtype; changed public.sessions%rowtype; target public.availability_slots%rowtype; next_status text; prior_status text; slot_found boolean:=false;
begin
 if p_request is null or p_actor_id is null or nullif(btrim(p_actor_email),'') is null then raise exception 'Trusted practitioner context and correlation ID are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if p_calendar_status is null or p_calendar_status not in ('pending','not_requested','reschedule_pending') then raise exception 'Invalid Calendar state'; end if;
 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;
 if lower(coalesce(old.status,''))<>'cancelled' then raise exception 'Only cancelled sessions can be restored'; end if;
 select * into target from public.availability_slots where slot_date=old.session_date and slot_time=old.session_time for update;
 slot_found:=found;
 if slot_found and target.status='booked' and target.session_id is not null and target.session_id<>p_id then raise exception 'The original time is now booked'; end if;
 if slot_found then update public.availability_slots set status='booked',session_id=p_id where id=target.id; end if;
 select a.previous_state->>'status' into prior_status from public.appointment_action_audit a where a.session_id=p_id and a.action='cancel' and a.new_state->>'status'='cancelled' order by a.created_at desc limit 1;
 next_status:=case
  when lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') and p_website_eligible then 'confirmed'
  when lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then 'pending'
  else coalesce(prior_status,case when lower(coalesce(old.payment_status,'')) in ('paid','complimentary','exchange') then 'confirmed' else 'pending' end) end;
 update public.sessions set status=next_status,
   booking_status=case when lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') and next_status<>'confirmed' then case when lower(coalesce(old.payment_status,''))='paid' then 'payment_received_incomplete' else 'payment_required' end when lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then 'confirmed' else old.booking_status end,
   google_calendar_status=case when lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') and not p_website_eligible then 'not_requested' else p_calendar_status end,
   google_calendar_error=null,updated_at=now()
 where id=p_id returning * into changed;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','session_restored',
  jsonb_build_object('status',old.status,'booking_status',old.booking_status,'session_date',old.session_date,'session_time',old.session_time),
  jsonb_build_object('status',changed.status,'booking_status',changed.booking_status,'session_date',changed.session_date,'session_time',changed.session_time),p_request::text,p_request_path);
 return jsonb_build_object('session',to_jsonb(changed),'slot_restored',slot_found,'correlation_id',p_request::text);
end;
$function$;
revoke all on function public.practitioner_restore_appointment(uuid,text,text,uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.practitioner_restore_appointment(uuid,text,text,uuid,text,text,boolean) to service_role;

-- Dashboard field edits and their audit record commit as one statement/transaction.
create or replace function public.practitioner_update_session_with_audit(
 p_id uuid, p_updates jsonb, p_actor_id text, p_actor_email text, p_request uuid,
 p_request_path text default '/.netlify/functions/sessions'
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare old public.sessions%rowtype; changed public.sessions%rowtype;
begin
 if p_request is null or p_actor_id is null or nullif(btrim(p_actor_email),'') is null or p_updates is null or jsonb_typeof(p_updates)<>'object' then raise exception 'Trusted practitioner context, correlation ID, and update object are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('status','booking_status','payment_status','amount_due','amount_paid','payment_paid_at','waiver_status','waiver_completed','waiver_completed_at','session_date','session_time','service','location_type','seller_notes','square_booking_id','stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status','state_before','state_after','google_calendar_status','google_calendar_error')) then raise exception 'Unsupported appointment field'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k in ('status','booking_status','payment_status','amount_paid','payment_paid_at','session_date','session_time','stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status')) then raise exception 'Use the dedicated audited appointment lifecycle or payment workflow'; end if;
 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;
 if lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking') and (lower(coalesce(p_updates->>'status',''))='confirmed' or lower(coalesce(p_updates->>'booking_status',''))='confirmed' or lower(coalesce(p_updates->>'payment_status',''))='paid' or lower(coalesce(p_updates->>'stripe_payment_status',''))='paid') then raise exception 'Website booking confirmation requires verified payment workflow'; end if;
 if lower(coalesce(p_updates->>'status',''))='cancelled' then raise exception 'Use the atomic cancellation workflow'; end if;
 changed:=jsonb_populate_record(old,p_updates);
 update public.sessions set status=changed.status,booking_status=changed.booking_status,payment_status=changed.payment_status,amount_due=changed.amount_due,amount_paid=changed.amount_paid,payment_paid_at=changed.payment_paid_at,waiver_status=changed.waiver_status,waiver_completed=changed.waiver_completed,waiver_completed_at=changed.waiver_completed_at,session_date=changed.session_date,session_time=changed.session_time,service=changed.service,location_type=changed.location_type,seller_notes=changed.seller_notes,square_booking_id=changed.square_booking_id,stripe_checkout_session_id=changed.stripe_checkout_session_id,stripe_payment_intent_id=changed.stripe_payment_intent_id,stripe_payment_status=changed.stripe_payment_status,state_before=changed.state_before,state_after=changed.state_after,google_calendar_status=changed.google_calendar_status,google_calendar_error=changed.google_calendar_error,updated_at=now()
 where id=p_id returning * into changed;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','session_updated',jsonb_build_object('status',old.status,'payment_status',old.payment_status,'booking_status',old.booking_status,'session_date',old.session_date,'session_time',old.session_time,'service',old.service),jsonb_build_object('status',changed.status,'payment_status',changed.payment_status,'booking_status',changed.booking_status,'session_date',changed.session_date,'session_time',changed.session_time,'service',changed.service),p_request::text,p_request_path);
 return jsonb_build_object('session',to_jsonb(changed),'correlation_id',p_request::text);
end;
$function$;
revoke all on function public.practitioner_update_session_with_audit(uuid,jsonb,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.practitioner_update_session_with_audit(uuid,jsonb,text,text,uuid,text) to service_role;

-- Practitioner-created appointment, slot reservation, and audit are atomic.
create or replace function public.practitioner_create_appointment_with_audit(
 p_session jsonb, p_slot_id uuid, p_actor_id text, p_actor_email text, p_request uuid,
 p_request_path text default '/.netlify/functions/practitioner-create-session'
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare s public.sessions%rowtype; slot public.availability_slots%rowtype; pay public.payments%rowtype; d date; t time without time zone; duration integer; due numeric; paid numeric; payment_status text; payment_method text;
begin
 if p_request is null or p_slot_id is null or p_actor_id is null or nullif(btrim(p_actor_email),'') is null or jsonb_typeof(p_session)<>'object' then raise exception 'Trusted practitioner context, correlation ID, appointment and slot are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if lower(coalesce(p_session->>'source','')) not in ('manual_practitioner','manual_practitioner_calendar') then raise exception 'Only practitioner-created appointments are accepted'; end if;
 payment_status:=lower(coalesce(p_session->>'payment_status','unpaid')); payment_method:=lower(coalesce(p_session->>'payment_method','')); due:=coalesce(nullif(p_session->>'amount_due','')::numeric,0); paid:=coalesce(nullif(p_session->>'amount_paid','')::numeric,0);
 if payment_status in ('paid','partial') then
  if payment_method in ('','none','stripe') or paid<=0 or paid>due or (payment_status='paid' and paid<>due) or (payment_status='partial' and paid>=due) then raise exception 'Manual payment must be a valid received non-Stripe amount'; end if;
 elsif paid<>0 or payment_status not in ('unpaid','pending','complimentary') then raise exception 'Appointment creation cannot assert an unrecorded payment'; end if;
 d:=nullif(p_session->>'session_date','')::date; t:=nullif(p_session->>'session_time','')::time; duration:=coalesce(nullif(p_session->>'duration_minutes','')::integer,60);
 if d is null or t is null or duration<1 or duration>1440 then raise exception 'Invalid appointment date, time, or duration'; end if;
 lock table public.sessions in share row exclusive mode;
 select * into slot from public.availability_slots where id=p_slot_id for update;
 if not found or slot.status<>'available' or slot.session_id is not null or slot.slot_date<>d or slot.slot_time<>t then raise exception 'The selected availability slot is no longer available'; end if;
 if exists(select 1 from public.sessions x where coalesce(lower(x.status),'pending') not in ('cancelled','completed','no_show','expired') and x.session_date+x.session_time < d+t+make_interval(mins=>duration) and x.session_date+x.session_time+make_interval(mins=>coalesce(nullif(x.duration_minutes,0),60)) > d+t) then raise exception 'Appointment overlaps an existing session'; end if;
 insert into public.sessions(client_id,client_name,client_email,client_phone,service,session_date,session_time,duration_minutes,amount_due,amount_paid,payment_status,payment_method,payment_reference,payment_note,payment_source,location_type,status,source,google_calendar_status,seller_notes)
 values(nullif(p_session->>'client_id','')::uuid,nullif(p_session->>'client_name',''),nullif(p_session->>'client_email',''),nullif(p_session->>'client_phone',''),nullif(p_session->>'service',''),d,t,duration,nullif(p_session->>'amount_due','')::numeric,coalesce(nullif(p_session->>'amount_paid','')::numeric,0),coalesce(nullif(p_session->>'payment_status',''),'unpaid'),nullif(p_session->>'payment_method',''),nullif(p_session->>'payment_reference',''),nullif(p_session->>'payment_note',''),coalesce(nullif(p_session->>'payment_source',''),'none'),coalesce(nullif(p_session->>'location_type',''),'distance'),coalesce(nullif(p_session->>'status',''),'pending'),p_session->>'source',coalesce(nullif(p_session->>'google_calendar_status',''),'not_requested'),nullif(p_session->>'seller_notes',''))
 returning * into s;
 if payment_status in ('paid','partial') then
  insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source)
  values(s.id,s.client_id,s.client_name,paid,payment_method,nullif(p_session->>'payment_reference',''),'received',nullif(p_session->>'payment_note',''),now(),p_request::text,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard') returning * into pay;
  insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  values(pay.id,s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_recorded_at_appointment_creation',null,to_jsonb(pay),p_request::text,p_request_path);
 end if;
 update public.availability_slots set status='booked',session_id=s.id where id=slot.id;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_appointment_created',null,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service,'source',s.source),p_request::text,p_request_path);
 return jsonb_build_object('session',to_jsonb(s),'payment',case when pay.id is not null then to_jsonb(pay) else null end,'correlation_id',p_request::text);
end;
$function$;
revoke all on function public.practitioner_create_appointment_with_audit(jsonb,uuid,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.practitioner_create_appointment_with_audit(jsonb,uuid,text,text,uuid,text) to service_role;

-- Client-waiver, trusted system payment, and hold-expiry transitions are audited atomically.
create or replace function public.trusted_session_update_with_audit(
 p_id uuid, p_updates jsonb, p_actor_type text, p_actor_id text, p_actor_email text,
 p_source text, p_action text, p_correlation_id text, p_request_path text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare old public.sessions%rowtype; changed public.sessions%rowtype; actor_email text; website boolean;
begin
 if p_updates is null or jsonb_typeof(p_updates)<>'object' or nullif(btrim(p_actor_type),'') is null or nullif(btrim(p_source),'') is null or nullif(btrim(p_action),'') is null or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Trusted mutation metadata is required'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('status','booking_status','payment_status','amount_due','amount_paid','payment_paid_at','waiver_status','waiver_completed','waiver_completed_at','session_date','session_time','service','location_type','seller_notes','square_booking_id','stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status','stripe_charge_id','stripe_refund_id','payment_hold_expires_at','refunded_amount','refund_status','refund_updated_at','state_before','state_after','google_calendar_status','google_calendar_error','google_calendar_synced_at','updated_at')) then raise exception 'Unsupported appointment field'; end if;
 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;
 actor_email:=nullif(lower(btrim(p_actor_email)),'');
 website:=lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking');
 if p_actor_type='practitioner' then
  if p_source<>'dashboard' or p_actor_id is null or actor_email is null or not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=actor_email and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 elsif p_actor_type='client' then
  if p_source<>'signed_waiver' or p_actor_id is distinct from old.client_id::text or actor_email is null or actor_email is distinct from coalesce((select lower(c.email) from public.clients c where c.id=old.client_id),lower(old.client_email)) then raise exception 'Client actor does not match the signed session'; end if;
 elsif p_actor_type='system' then
  if not ((p_source in ('stripe_webhook','stripe-webhook') and p_actor_id in ('stripe_webhook','stripe-webhook') and p_action in ('payment_confirmed','payment_failed','payment_expired','payment_refunded')) or (p_source='stripe-checkout' and p_actor_id='stripe-checkout' and p_action='checkout_session_created') or (p_source='expire-website-bookings' and p_actor_id='expire-website-bookings' and p_action='payment_hold_expired') or (p_source='calendar-worker' and p_actor_id='session-calendar-sync' and p_action in ('calendar_sync_completed','calendar_sync_failed')) or (p_source='reminder_worker' and p_actor_id='reminder_worker' and p_action='reminder_marked')) then raise exception 'Invalid internal worker context'; end if;
 else raise exception 'Unsupported trusted actor type';
 end if;
 if p_action='payment_hold_expired' then
  if not website or lower(coalesce(old.payment_status,''))='paid' or old.payment_hold_expires_at is null or old.payment_hold_expires_at>now() or lower(coalesce(old.status,'')) in ('cancelled','expired','completed','no_show') then return jsonb_build_object('eligible',false,'session_id',p_id,'correlation_id',p_correlation_id); end if;
  p_updates:=jsonb_build_object('status','expired','booking_status','payment_expired','google_calendar_status','not_requested','updated_at',now());
 end if;
 if p_action='checkout_session_created' then
  if not website or lower(coalesce(old.status,''))<>'pending' or lower(coalesce(old.payment_status,'')) in ('paid','refunded','complimentary','waived') or old.payment_hold_expires_at is null or old.payment_hold_expires_at<=now() or old.stripe_checkout_session_id is not null then raise exception 'Booking is no longer eligible for checkout'; end if;
 end if;
 if website and p_source not in ('stripe_webhook','stripe-webhook','expire-website-bookings','signed_waiver') and (lower(coalesce(p_updates->>'status',''))='confirmed' or lower(coalesce(p_updates->>'booking_status',''))='confirmed' or lower(coalesce(p_updates->>'payment_status',''))='paid') then raise exception 'Website confirmation requires verified workflow'; end if;
 changed:=jsonb_populate_record(old,p_updates);
 update public.sessions set status=changed.status,booking_status=changed.booking_status,payment_status=changed.payment_status,amount_due=changed.amount_due,amount_paid=changed.amount_paid,payment_paid_at=changed.payment_paid_at,waiver_status=changed.waiver_status,waiver_completed=changed.waiver_completed,waiver_completed_at=changed.waiver_completed_at,session_date=changed.session_date,session_time=changed.session_time,service=changed.service,location_type=changed.location_type,seller_notes=changed.seller_notes,square_booking_id=changed.square_booking_id,stripe_checkout_session_id=changed.stripe_checkout_session_id,stripe_payment_intent_id=changed.stripe_payment_intent_id,stripe_payment_status=changed.stripe_payment_status,stripe_charge_id=changed.stripe_charge_id,stripe_refund_id=changed.stripe_refund_id,payment_hold_expires_at=changed.payment_hold_expires_at,refunded_amount=changed.refunded_amount,refund_status=changed.refund_status,refund_updated_at=changed.refund_updated_at,state_before=changed.state_before,state_after=changed.state_after,google_calendar_status=changed.google_calendar_status,google_calendar_error=changed.google_calendar_error,google_calendar_synced_at=changed.google_calendar_synced_at,updated_at=coalesce(changed.updated_at,now()) where id=p_id returning * into changed;
 if p_action='payment_hold_expired' then update public.availability_slots set status='available',session_id=null where session_id=p_id; end if;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,p_actor_type,p_actor_id,actor_email,p_source,p_action,jsonb_build_object('status',old.status,'payment_status',old.payment_status,'booking_status',old.booking_status,'session_date',old.session_date,'session_time',old.session_time,'service',old.service),jsonb_build_object('status',changed.status,'payment_status',changed.payment_status,'booking_status',changed.booking_status,'session_date',changed.session_date,'session_time',changed.session_time,'service',changed.service),p_correlation_id,p_request_path)
 on conflict (session_id,correlation_id,action) do nothing;
 return jsonb_build_object('eligible',true,'session',to_jsonb(changed),'correlation_id',p_correlation_id);
end;
$function$;
revoke all on function public.trusted_session_update_with_audit(uuid,jsonb,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.trusted_session_update_with_audit(uuid,jsonb,text,text,text,text,text,text,text) to service_role;

-- Replace the legacy hold cleanup with a single atomic, auditable, idempotent RPC.
create or replace function public.expire_unpaid_booking_holds(p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare result jsonb;
begin
 with eligible as materialized (
  select s.id,s.status,s.payment_status,s.booking_status,s.session_date,s.session_time,s.service,s.payment_hold_expires_at,gen_random_uuid()::text as correlation_id
  from public.sessions s
  where lower(coalesce(s.source,'')) in ('online','website','website_booking','website booking','website_form','booking')
    and lower(coalesce(s.payment_status,'')) in ('pending','unpaid')
    and lower(coalesce(s.booking_status,'')) in ('booking_received','payment_pending','payment_required')
    and s.payment_hold_expires_at is not null and s.payment_hold_expires_at<=p_now
    and lower(coalesce(s.status,''))='pending'
    and s.stripe_checkout_session_id is null and s.stripe_payment_intent_id is null and s.stripe_payment_status is null
    and s.stripe_charge_id is null and s.stripe_refund_id is null
    and s.google_calendar_event_id is null and s.google_meet_url is null
    and coalesce(s.google_calendar_status,'not_requested')='not_requested'
    and not exists(select 1 from public.payments p where p.session_id=s.id)
    and not exists(select 1 from public.stripe_webhook_events e where (e.payload->'data'->'object'->'metadata'->>'session_id')=s.id::text or (e.payload->'data'->'object'->'metadata'->>'booking_id')=s.id::text or (e.payload->'data'->'object'->>'client_reference_id')=s.id::text)
    and (select count(*) from public.availability_slots a where a.session_id=s.id)<=1
    and not exists(select 1 from public.availability_slots a where a.session_id=s.id and a.status not in ('booked','held'))
  for update of s skip locked
 ), updated as (
  update public.sessions s set status='expired',booking_status='payment_expired',google_calendar_status='not_requested',google_calendar_error=null,updated_at=p_now
  from eligible e where s.id=e.id and s.status='pending' and s.payment_status in ('pending','unpaid')
  returning s.id,s.status,s.payment_status,s.booking_status,s.session_date,s.session_time,s.service
 ), audited as (
  insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  select u.id,'system','expire-payment-holds',null,'expire-payment-holds','payment_hold_expired',
   jsonb_build_object('status',e.status,'payment_status',e.payment_status,'booking_status',e.booking_status,'session_date',e.session_date,'session_time',e.session_time,'service',e.service),
   jsonb_build_object('status',u.status,'payment_status',u.payment_status,'booking_status',u.booking_status,'session_date',u.session_date,'session_time',u.session_time,'service',u.service),e.correlation_id,'/.netlify/functions/expire-payment-holds'
  from updated u join eligible e on e.id=u.id
  returning session_id,correlation_id
 ), released as (
  update public.availability_slots a set status='available',session_id=null,held_until=null,held_for=null
  where a.session_id in (select session_id from audited) and a.status in ('booked','held')
  returning a.id
 )
 select jsonb_build_object(
  'expired_count',(select count(*) from audited),
  'released_slot_count',(select count(*) from released),
  'session_ids',coalesce((select jsonb_agg(session_id) from audited),'[]'::jsonb),
  'actions',coalesce((select jsonb_agg(jsonb_build_object('session_id',session_id,'correlation_id',correlation_id)) from audited),'[]'::jsonb)
 ) into result;
 return result;
end;
$function$;
revoke all on function public.expire_unpaid_booking_holds(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_unpaid_booking_holds(timestamptz) to service_role;

-- A new public website request stores its private address, links its slot, and audits atomically.
create or replace function public.create_website_booking_with_audit(
 p_session jsonb, p_slot_id uuid, p_address jsonb, p_correlation_id text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare s public.sessions%rowtype; slot public.availability_slots%rowtype; d date; t time without time zone; location text; hold_exp timestamptz;
begin
 if p_slot_id is null or nullif(btrim(p_correlation_id),'') is null or p_session is null or jsonb_typeof(p_session)<>'object' then raise exception 'Booking, slot, and correlation ID are required'; end if;
 if p_session->>'source'<>'online' or p_session->>'status'<>'pending' or p_session->>'payment_status'<>'pending' or p_session->>'booking_status'<>'payment_required' or p_session->>'google_calendar_status'<>'not_requested' then raise exception 'Public booking must start pending and payment-gated'; end if;
 if nullif(btrim(p_session->>'client_name'),'') is null or nullif(btrim(p_session->>'client_email'),'') is null or nullif(btrim(p_session->>'client_phone'),'') is null or nullif(btrim(p_session->>'service'),'') is null then raise exception 'Booking identity and service fields are required'; end if;
 if (p_session->>'client_email') !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$' or length(regexp_replace(p_session->>'client_phone','\D','','g')) not between 7 and 15 then raise exception 'Booking contact fields are invalid'; end if;
 d:=nullif(p_session->>'session_date','')::date; t:=nullif(p_session->>'session_time','')::time; location:=lower(coalesce(p_session->>'location_type','distance'));
 hold_exp:=nullif(p_session->>'payment_hold_expires_at','')::timestamptz;
 if d is null or t is null or coalesce(nullif(p_session->>'duration_minutes','')::integer,0)<1 or coalesce(nullif(p_session->>'amount_due','')::numeric,0)<=0 then raise exception 'Booking date, time, duration, and price are required'; end if;
 if hold_exp is null or hold_exp<=now() or hold_exp>now()+interval '31 minutes' then raise exception 'Payment hold must be between now and 31 minutes'; end if;
 if location in ('in_person','in-person') then
  if p_address is null or jsonb_typeof(p_address)<>'object' or exists(select 1 from unnest(array['line1','city','state','postal_code','country']) k where nullif(btrim(p_address->>k),'') is null) then raise exception 'Complete in-person address is required'; end if;
 elsif p_address is not null then raise exception 'Remote bookings may not include a service address'; end if;
 lock table public.sessions in share row exclusive mode;
 select * into slot from public.availability_slots where id=p_slot_id for update;
 if not found or slot.status<>'booked' or slot.session_id is not null or slot.slot_date<>d or slot.slot_time<>t then raise exception 'The requested slot is no longer held by this request'; end if;
 if exists(select 1 from public.sessions x where coalesce(lower(x.status),'pending') not in ('cancelled','completed','no_show','expired') and x.session_date+x.session_time < d+t+make_interval(mins=>coalesce(nullif(p_session->>'duration_minutes','')::integer,60)) and x.session_date+x.session_time+make_interval(mins=>coalesce(nullif(x.duration_minutes,0),60)) > d+t) then raise exception 'Requested slot conflicts with an existing session'; end if;
 insert into public.sessions(client_id,client_name,service,session_date,session_time,duration_minutes,location_type,status,payment_status,payment_hold_expires_at,amount_due,amount_paid,client_email,client_phone,source,intake_status,waiver_status,waiver_completed,booking_status,google_calendar_status)
 values(nullif(p_session->>'client_id','')::uuid,btrim(p_session->>'client_name'),btrim(p_session->>'service'),d,t,(p_session->>'duration_minutes')::integer,location,'pending','pending',(p_session->>'payment_hold_expires_at')::timestamptz,(p_session->>'amount_due')::numeric,0,lower(btrim(p_session->>'client_email')),btrim(p_session->>'client_phone'),'online','pending','pending',false,'payment_required','not_requested')
 returning * into s;
 if location in ('in_person','in-person') then
  insert into public.session_service_addresses(session_id,address_line1,address_line2,city,state,postal_code,country)
  values(s.id,btrim(p_address->>'line1'),nullif(btrim(p_address->>'line2'),''),btrim(p_address->>'city'),btrim(p_address->>'state'),btrim(p_address->>'postal_code'),btrim(p_address->>'country'));
 end if;
 update public.availability_slots set session_id=s.id where id=slot.id and status='booked' and session_id is null;
 if not found then raise exception 'Requested slot hold changed during booking'; end if;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'system','public-booking',null,'website_booking','booking_created',null,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service,'location_type',s.location_type),p_correlation_id,'/.netlify/functions/booking');
 return jsonb_build_object('session',to_jsonb(s),'correlation_id',p_correlation_id);
end;
$function$;
revoke all on function public.create_website_booking_with_audit(jsonb,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_website_booking_with_audit(jsonb,uuid,jsonb,text) to service_role;

-- Approved manual payments keep the ledger, session state, and audit in one transaction.
alter table public.payments
 add column if not exists correlation_id text,
 add column if not exists correlation_uuid uuid,
 add column if not exists actor_type text,
 add column if not exists actor_id text,
 add column if not exists actor_email text,
 add column if not exists source text;
create unique index if not exists payments_correlation_id_unique_idx
 on public.payments(correlation_id) where correlation_id is not null;

create table if not exists public.payment_mutation_audit (
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.payments(id) on delete restrict,
 session_id uuid references public.sessions(id) on delete set null,
 actor_type text not null check(actor_type in ('practitioner','system')),
 actor_id text,
 actor_email text,
 source text not null,
 action text not null,
 previous_state jsonb,
 new_state jsonb not null,
 correlation_id text not null unique,
 correlation_uuid uuid,
 request_path text not null,
 created_at timestamptz not null default now()
);
alter table public.payment_mutation_audit enable row level security;
revoke all on public.payment_mutation_audit from public,anon,authenticated;
grant all on public.payment_mutation_audit to service_role;

/* Transitional payment writers intentionally omitted from clean replay.
   The final UUID/allocation-aware RPC definitions are installed only after
   payment allocation columns exist in the final payment-policy migration.
create or replace function public.practitioner_record_manual_payment_with_audit(
 p_session_id uuid,p_payment jsonb,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype; pay public.payments%rowtype; total numeric; next_payment_status text; next_calendar_status text; prior jsonb; prior_audit public.payment_mutation_audit%rowtype;
begin
 if p_payment is null or jsonb_typeof(p_payment)<>'object' or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and trusted correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if coalesce(nullif(p_payment->>'amount','')::numeric,0)<=0 then raise exception 'Payment amount must be positive'; end if;
 if lower(coalesce(p_payment->>'method','cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if coalesce(p_payment->>'status','received')<>'received' then raise exception 'Manual session payments must represent received funds'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id for update;
 if found then
  if prior_audit.action<>'manual_payment_recorded' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.source<>'dashboard' or prior_audit.session_id is distinct from p_session_id then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=prior_audit.payment_id;
  select * into s from public.sessions where id=p_session_id;
  if pay.id is null or s.id is null then raise exception 'Previously recorded payment state is incomplete'; end if;
  if pay.amount is distinct from (p_payment->>'amount')::numeric or pay.method is distinct from coalesce(nullif(p_payment->>'method',''),'cash_app') or pay.reference_id is distinct from nullif(p_payment->>'reference_id','') then raise exception 'Payment idempotency key was reused with different payment details'; end if;
  return jsonb_build_object('payment',to_jsonb(pay),'session',to_jsonb(s),'correlation_id',p_correlation_id,'duplicate',true);
 end if;
 select * into s from public.sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if lower(coalesce(s.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then raise exception 'Website bookings require verified Stripe processing'; end if;
 prior:=jsonb_build_object('status',s.status,'payment_status',s.payment_status,'amount_paid',s.amount_paid,'booking_status',s.booking_status);
 total:=coalesce(s.amount_paid,0)+(p_payment->>'amount')::numeric;
 next_payment_status:=case when coalesce(s.amount_due,0)>0 and total>=s.amount_due then 'paid' when total>0 then 'partial' else 'unpaid' end;
 next_calendar_status:=case when next_payment_status='paid' and s.status='confirmed' and s.google_calendar_status='not_requested' and s.source in ('manual','manual_practitioner','manual_practitioner_calendar') then 'pending' else s.google_calendar_status end;
 insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source)
 values(s.id,s.client_id,coalesce(nullif(p_payment->>'client_name',''),s.client_name),(p_payment->>'amount')::numeric,coalesce(nullif(p_payment->>'method',''),'cash_app'),nullif(p_payment->>'reference_id',''),coalesce(nullif(p_payment->>'status',''),'received'),nullif(p_payment->>'notes',''),coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),p_correlation_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard') returning * into pay;
 update public.sessions set amount_paid=total,payment_status=next_payment_status,payment_method=pay.method,payment_reference=pay.reference_id,payment_note=pay.notes,payment_source='manual_off_platform',google_calendar_status=next_calendar_status,updated_at=now() where id=s.id returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_recorded',prior,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'amount_paid',s.amount_paid,'booking_status',s.booking_status),p_correlation_id,p_request_path);
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_recorded',null,to_jsonb(pay),p_correlation_id,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'session',to_jsonb(s),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_record_manual_payment_with_audit(uuid,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_record_manual_payment_with_audit(uuid,jsonb,text,text,text,text) to service_role;

create or replace function public.practitioner_create_standalone_payment_with_audit(
 p_payment jsonb,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare pay public.payments%rowtype; prior_audit public.payment_mutation_audit%rowtype;
begin
 if p_payment is null or jsonb_typeof(p_payment)<>'object' or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and trusted correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if nullif(p_payment->>'session_id','') is not null then raise exception 'Standalone payment cannot reference a session'; end if;
 if lower(coalesce(p_payment->>'method','cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if coalesce(nullif(p_payment->>'amount','')::numeric,0)<=0 then raise exception 'Payment amount must be positive'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id for update;
 if found then
  if prior_audit.action<>'standalone_payment_recorded' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.source<>'dashboard' then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=prior_audit.payment_id;
  if pay.id is null then raise exception 'Previously recorded standalone payment is missing'; end if;
  if pay.amount is distinct from (p_payment->>'amount')::numeric or pay.method is distinct from coalesce(nullif(p_payment->>'method',''),'cash_app') or pay.client_id is distinct from nullif(p_payment->>'client_id','')::uuid then raise exception 'Payment idempotency key was reused with different payment details'; end if;
  return jsonb_build_object('payment',to_jsonb(pay),'correlation_id',p_correlation_id,'duplicate',true);
 end if;
 insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source)
 values(null,nullif(p_payment->>'client_id','')::uuid,nullif(p_payment->>'client_name',''),(p_payment->>'amount')::numeric,coalesce(nullif(p_payment->>'method',''),'cash_app'),nullif(p_payment->>'reference_id',''),coalesce(nullif(p_payment->>'status',''),'received'),nullif(p_payment->>'notes',''),coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),p_correlation_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard') returning * into pay;
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,null,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','standalone_payment_recorded',null,to_jsonb(pay),p_correlation_id,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'correlation_id',p_correlation_id,'duplicate',false);
end;$function$;
revoke all on function public.practitioner_create_standalone_payment_with_audit(jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_create_standalone_payment_with_audit(jsonb,text,text,text,text) to service_role;

create or replace function public.practitioner_update_payment_with_audit(
 p_payment_id uuid,p_updates jsonb,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare pay public.payments%rowtype; prior_audit public.payment_mutation_audit%rowtype; s public.sessions%rowtype; old_session jsonb; old_payment_state jsonb; new_total numeric; new_status text; new_calendar text;
begin
 if p_payment_id is null or p_updates is null or jsonb_typeof(p_updates)<>'object' or p_updates='{}'::jsonb or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment updates and trusted correlation metadata are required'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('amount','method','reference_id','status','notes','paid_at')) then raise exception 'Unsupported payment field'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if lower(coalesce(p_updates->>'method',''))='stripe' then raise exception 'Stripe payments cannot be edited manually'; end if;
 if p_updates ? 'amount' and coalesce(nullif(p_updates->>'amount','')::numeric,0)<=0 then raise exception 'Payment amount must be positive'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id for update;
 if found then
  if prior_audit.action<>'payment_updated' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.payment_id is distinct from p_payment_id then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=p_payment_id;
  if pay.id is null then raise exception 'Previously updated payment is missing'; end if;
  if (p_updates ? 'amount' and pay.amount is distinct from nullif(p_updates->>'amount','')::numeric)
   or (p_updates ? 'method' and pay.method is distinct from p_updates->>'method')
   or (p_updates ? 'reference_id' and pay.reference_id is distinct from nullif(p_updates->>'reference_id',''))
   or (p_updates ? 'status' and pay.status is distinct from p_updates->>'status')
   or (p_updates ? 'notes' and pay.notes is distinct from nullif(p_updates->>'notes',''))
   or (p_updates ? 'paid_at' and pay.paid_at is distinct from nullif(p_updates->>'paid_at','')::timestamptz) then raise exception 'Payment idempotency key was reused with different updates'; end if;
  if pay.session_id is not null then select * into s from public.sessions where id=pay.session_id; end if;
  return jsonb_build_object('payment',to_jsonb(pay),'session',case when pay.session_id is not null then to_jsonb(s) else null end,'correlation_id',p_correlation_id,'duplicate',true);
 end if;
 select * into pay from public.payments where id=p_payment_id for update;
 if not found then raise exception 'Payment not found'; end if;
 if lower(coalesce(pay.method,''))='stripe' then raise exception 'Stripe payments cannot be edited manually'; end if;
 old_payment_state:=to_jsonb(pay);
 if pay.session_id is not null then
  select * into s from public.sessions where id=pay.session_id for update;
  if not found then raise exception 'Linked session not found'; end if;
  if lower(coalesce(s.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then raise exception 'Website payment state must use verified Stripe processing'; end if;
  old_session:=jsonb_build_object('payment_status',s.payment_status,'amount_paid',s.amount_paid,'google_calendar_status',s.google_calendar_status);
 end if;
 update public.payments set
  amount=coalesce(nullif(p_updates->>'amount','')::numeric,amount),
  method=coalesce(nullif(p_updates->>'method',''),method),
  reference_id=case when p_updates ? 'reference_id' then nullif(p_updates->>'reference_id','') else reference_id end,
  status=coalesce(nullif(p_updates->>'status',''),status),
  notes=case when p_updates ? 'notes' then nullif(p_updates->>'notes','') else notes end,
  paid_at=coalesce(nullif(p_updates->>'paid_at','')::timestamptz,paid_at),
  correlation_id=p_correlation_id,actor_type='practitioner',actor_id=p_actor_id,actor_email=lower(btrim(p_actor_email)),source='dashboard'
 where id=p_payment_id returning * into pay;
 if pay.session_id is not null then
  select coalesce(sum(case when p.id=pay.id then case when pay.status='received' then pay.amount else 0 end else case when p.status='received' then p.amount else 0 end end),0)
   into new_total from public.payments p where p.session_id=pay.session_id;
  new_status:=case when coalesce(s.amount_due,0)>0 and new_total>=s.amount_due then 'paid' when new_total>0 then 'partial' else 'unpaid' end;
  new_calendar:=case when new_status='paid' and s.status='confirmed' and s.google_calendar_status='not_requested' then 'pending'
    when new_status<>'paid' and s.google_calendar_event_id is not null then 'cancel_pending'
    when new_status<>'paid' then 'not_requested' else s.google_calendar_status end;
  update public.sessions set amount_paid=new_total,payment_status=new_status,payment_method=pay.method,payment_reference=pay.reference_id,payment_note=pay.notes,payment_source='manual_off_platform',google_calendar_status=new_calendar,google_calendar_error=null,updated_at=now()
   where id=pay.session_id returning * into s;
  insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
   values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_updated',old_session,jsonb_build_object('payment_status',s.payment_status,'amount_paid',s.amount_paid,'google_calendar_status',s.google_calendar_status),p_correlation_id,p_request_path);
 end if;
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,pay.session_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','payment_updated',old_payment_state,to_jsonb(pay),p_correlation_id,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'session',case when pay.session_id is not null then to_jsonb(s) else null end,'correlation_id',p_correlation_id,'duplicate',false);
end;$function$;
revoke all on function public.practitioner_update_payment_with_audit(uuid,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_update_payment_with_audit(uuid,jsonb,text,text,text,text) to service_role;
*/

-- Replace the legacy email-reconciliation payment writer with a trusted,
-- correlated transaction; the old caller-supplied actor entry point is retired.
alter table public.payment_reconciliation_audit add column if not exists correlation_id text;
grant select,insert,update on public.payment_reconciliation_items,public.payment_reconciliation_audit to service_role;
do $retire_legacy_reconciliation_rpc$
begin
 if to_regprocedure('public.payment_reconciliation_attach(uuid,uuid,text,text)') is not null then
  revoke all on function public.payment_reconciliation_attach(uuid,uuid,text,text) from public,anon,authenticated,service_role;
 end if;
end;
$retire_legacy_reconciliation_rpc$;
create or replace function public.payment_reconciliation_attach(p_item_id uuid,p_session_id uuid,p_actor text,p_mode text default 'manual')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $function$
begin
 raise exception 'Legacy payment reconciliation mutation is retired; use payment_reconciliation_attach_with_audit';
end;$function$;
revoke all on function public.payment_reconciliation_attach(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.payment_reconciliation_attach_with_audit(
 p_item_id uuid,p_session_id uuid,p_actor_type text,p_actor_id text,p_actor_email text,p_source text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare item public.payment_reconciliation_items%rowtype; target public.sessions%rowtype; prior_payment public.payments%rowtype; pay public.payments%rowtype; paid_total numeric; next_status text; next_calendar text; prior_state jsonb;
begin
 if p_item_id is null or p_session_id is null or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Invalid payment reconciliation context'; end if;
 if p_actor_type='practitioner' then
  if p_source<>'dashboard' or p_request_path<>'/.netlify/functions/payment-reconciliation' or not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Invalid practitioner reconciliation context'; end if;
 elsif p_actor_type='system' then
  if p_actor_id<>'payment-email-reconcile' or p_actor_email is not null or p_source<>'payment_email_reconcile' or p_request_path<>'/.netlify/functions/payment-email-reconcile' then raise exception 'Invalid worker reconciliation context'; end if;
 else raise exception 'Unsupported reconciliation actor'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-reconciliation:'||p_item_id::text,0));
 select * into item from public.payment_reconciliation_items where id=p_item_id for update;
 if not found then raise exception 'reconciliation_item_not_found'; end if;
 if item.status in ('attached','unrelated','duplicate') then return jsonb_build_object('idempotent',true,'status',item.status,'session_id',item.matched_session_id,'correlation_id',p_correlation_id); end if;
 if item.provider='stripe' then raise exception 'stripe_email_requires_webhook_authority'; end if;
 select * into target from public.sessions where id=p_session_id for update;
 if not found then raise exception 'session_not_found'; end if;
 if lower(coalesce(target.status,'')) in ('cancelled','no_show','completed','expired') then raise exception 'session_not_payable'; end if;
 if lower(coalesce(target.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then raise exception 'website_payment_requires_verified_checkout'; end if;
 if lower(coalesce(target.stripe_payment_status,''))='paid' or target.stripe_payment_intent_id is not null then raise exception 'stripe_state_is_authoritative'; end if;
 if item.amount>greatest(0,coalesce(target.amount_due,0)-coalesce(target.amount_paid,0)) then raise exception 'amount_conflict'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-reference:'||lower(item.provider)||':'||lower(item.provider_reference_id),0));
 select * into prior_payment from public.payments where lower(coalesce(method,''))=lower(item.provider) and reference_id=item.provider_reference_id limit 1 for update;
 if found then
  update public.payment_reconciliation_items set status='duplicate',resolved_at=now(),resolved_by=coalesce(p_actor_email,p_actor_id),resolution_note='Existing payment reference',updated_at=now() where id=item.id returning * into item;
  insert into public.payment_reconciliation_audit(reconciliation_id,action,actor,provider,provider_reference_id,matched_session_id,match_confidence,match_reason,correlation_id)
   values(item.id,'duplicate',coalesce(p_actor_email,p_actor_id),item.provider,item.provider_reference_id,p_session_id,item.confidence,'existing payment reference',p_correlation_id::text);
  return jsonb_build_object('idempotent',true,'status','duplicate','session_id',p_session_id,'correlation_id',p_correlation_id);
 end if;
 prior_state:=jsonb_build_object('payment_status',target.payment_status,'amount_paid',target.amount_paid,'booking_status',target.booking_status,'google_calendar_status',target.google_calendar_status);
 insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source)
  values(target.id,target.client_id,target.client_name,item.amount,item.provider,item.provider_reference_id,'received',item.memo,item.transaction_at,p_correlation_id::text,p_actor_type,p_actor_id,p_actor_email,p_source) returning * into pay;
 select coalesce(sum(amount),0) into paid_total from public.payments where session_id=target.id and status='received';
 next_status:=case when coalesce(target.amount_due,0)>0 and paid_total>=target.amount_due then 'paid' when paid_total>0 then 'partial' else 'unpaid' end;
 next_calendar:=case when next_status='paid' and target.status='confirmed' and target.source in ('manual','manual_practitioner','manual_practitioner_calendar') and target.google_calendar_status='not_requested' then 'pending' else target.google_calendar_status end;
 update public.sessions set amount_paid=paid_total,payment_status=next_status,payment_method=item.provider,payment_reference=item.provider_reference_id,payment_note=item.memo,payment_source='manual_off_platform',google_calendar_status=next_calendar,correlation_id=p_correlation_id,updated_at=now() where id=target.id returning * into target;
 if to_regclass('public.ledger_entries') is not null then
  execute 'insert into public.ledger_entries(client_id,client_name,entry_type,description,amount,balance_impact,related_session_id,related_payment_id,created_by,notes,entry_date,correlation_id,actor_type,actor_id,actor_email,source) values($1,$2,''payment'',$3,$4,-$4,$5,$6,$7,$8,current_date,$9,$10,$11,$12,$13)'
   using target.client_id,target.client_name,'Imported '||item.provider||' payment',item.amount,target.id,pay.id,coalesce(p_actor_email,p_actor_id),item.memo,p_correlation_id,p_actor_type,p_actor_id,p_actor_email,p_source;
 end if;
 update public.payment_reconciliation_items set status='attached',matched_client_id=target.client_id,matched_session_id=target.id,amount_applied=item.amount,auto_attached=(p_actor_type='system'),resolved_at=now(),resolved_by=coalesce(p_actor_email,p_actor_id),updated_at=now() where id=item.id returning * into item;
 insert into public.payment_reconciliation_audit(reconciliation_id,action,actor,provider,provider_reference_id,matched_client_id,matched_session_id,match_confidence,match_reason,amount_applied,correlation_id)
  values(item.id,case when p_actor_type='system' then 'auto_attached' else 'manually_attached' end,coalesce(p_actor_email,p_actor_id),item.provider,item.provider_reference_id,target.client_id,target.id,item.confidence,item.match_reason,item.amount,p_correlation_id::text);
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  values(pay.id,target.id,p_actor_type,p_actor_id,p_actor_email,p_source,'reconciliation_payment_attached',null,to_jsonb(pay),p_correlation_id::text,p_request_path);
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  values(target.id,p_actor_type,p_actor_id,p_actor_email,p_source,'manual_payment_reconciled',prior_state,jsonb_build_object('payment_status',target.payment_status,'amount_paid',target.amount_paid,'booking_status',target.booking_status,'google_calendar_status',target.google_calendar_status),p_correlation_id::text,p_request_path);
 return jsonb_build_object('idempotent',false,'status','attached','payment_id',pay.id,'session_id',target.id,'payment_status',next_status,'amount_paid',paid_total,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.payment_reconciliation_attach_with_audit(uuid,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.payment_reconciliation_attach_with_audit(uuid,uuid,text,text,text,text,uuid,text) to service_role;

-- Resolution-only dashboard actions update the reconciliation item and its audit
-- record atomically; practitioner identity is validated against the active roster.
create or replace function public.practitioner_decide_payment_reconciliation_item_with_audit(
 p_item_id uuid,p_action text,p_note text,p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare item public.payment_reconciliation_items%rowtype;
begin
 if p_action not in ('unrelated','duplicate') or p_item_id is null or p_correlation_id is null
    or p_request_path<>'/.netlify/functions/payment-reconciliation'
    or not exists(select 1 from public.practitioner_users u where u.id::text=p_actor_id and lower(u.email)=lower(btrim(p_actor_email)) and u.active) then
  raise exception 'Invalid reconciliation decision context';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-reconciliation:'||p_item_id::text,0));
 select * into item from public.payment_reconciliation_items where id=p_item_id for update;
 if not found then raise exception 'reconciliation_item_not_found'; end if;
 if item.status in ('unrelated','duplicate') then return jsonb_build_object('idempotent',true,'status',item.status); end if;
 if item.status not in ('needs_reconciliation','matched') then raise exception 'reconciliation_item_not_decidable'; end if;
 update public.payment_reconciliation_items set status=p_action,resolved_at=now(),resolved_by=lower(btrim(p_actor_email)),
   resolution_note=left(p_note,500),updated_at=now() where id=item.id returning * into item;
 insert into public.payment_reconciliation_audit(reconciliation_id,action,actor,provider,provider_reference_id,
   matched_client_id,matched_session_id,match_confidence,match_reason,correlation_id)
 values(item.id,p_action,lower(btrim(p_actor_email)),item.provider,item.provider_reference_id,item.matched_client_id,
   item.matched_session_id,item.confidence,item.match_reason,p_correlation_id::text);
 return jsonb_build_object('idempotent',false,'status',item.status,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_decide_payment_reconciliation_item_with_audit(uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_decide_payment_reconciliation_item_with_audit(uuid,text,text,text,text,uuid,text) to service_role;

-- A completed outcome and its session completion/status changes are committed or rolled back together.
alter table public.session_outcomes add column if not exists correlation_id text;
create or replace function public.practitioner_record_session_outcome_with_audit(
 p_session_id uuid,p_outcome jsonb,p_updates jsonb,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype; o public.session_outcomes%rowtype; prior jsonb; done boolean;
begin
 if p_outcome is null or jsonb_typeof(p_outcome)<>'object' or p_updates is null or jsonb_typeof(p_updates)<>'object' or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Outcome and trusted correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if p_outcome->>'outcome_category' not in ('improved','no_change','worse','mixed') then raise exception 'Invalid outcome category'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('state_before','state_after','status')) then raise exception 'Unsupported outcome session field'; end if;
 select * into s from public.sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 done:=lower(coalesce(p_updates->>'status',''))='completed';
 if done and lower(coalesce(s.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then
  if s.status<>'confirmed' or s.booking_status<>'confirmed' or s.payment_status<>'paid' or not (s.waiver_completed or lower(coalesce(s.waiver_status,'')) in ('complete','completed','signed')) or nullif(btrim(s.client_name),'') is null or nullif(btrim(s.client_email),'') is null or nullif(btrim(s.client_phone),'') is null or nullif(btrim(s.service),'') is null or s.session_date is null or s.session_time is null then raise exception 'Website booking does not meet completion eligibility'; end if;
  if lower(coalesce(s.location_type,'')) in ('in_person','in-person') and not exists(select 1 from public.session_service_addresses a where a.session_id=s.id and nullif(btrim(a.address_line1),'') is not null and nullif(btrim(a.city),'') is not null and nullif(btrim(a.state),'') is not null and nullif(btrim(a.postal_code),'') is not null and nullif(btrim(a.country),'') is not null) then raise exception 'In-person service address is incomplete'; end if;
 end if;
 prior:=jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service,'state_before',s.state_before,'state_after',s.state_after);
 insert into public.session_outcomes(session_id,client_id,client_name,session_date,outcome_category,improvement_level,energy_shift,practitioner_notes,notable_findings,research_flag,research_notes,correlation_id)
 values(s.id,s.client_id,s.client_name,s.session_date,p_outcome->>'outcome_category',nullif(p_outcome->>'improvement_level','')::integer,nullif(p_outcome->>'energy_shift',''),nullif(p_outcome->>'practitioner_notes',''),array(select jsonb_array_elements_text(coalesce(p_outcome->'notable_findings','[]'::jsonb))),coalesce((p_outcome->>'research_flag')::boolean,false),nullif(p_outcome->>'research_notes',''),p_correlation_id) returning * into o;
 update public.sessions set state_before=coalesce(nullif(p_updates->>'state_before','')::smallint,state_before),state_after=coalesce(nullif(p_updates->>'state_after','')::smallint,state_after),status=case when done then 'completed' else status end,updated_at=now() where id=s.id returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',case when done then 'session_completed_with_outcome' else 'session_outcome_recorded' end,prior,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service,'state_before',s.state_before,'state_after',s.state_after),p_correlation_id,p_request_path);
 return jsonb_build_object('outcome',to_jsonb(o),'session',to_jsonb(s),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_record_session_outcome_with_audit(uuid,jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_record_session_outcome_with_audit(uuid,jsonb,jsonb,text,text,text,text) to service_role;

-- Cancellation decisions, linked session transition, slot release, audit, and notice enqueue are atomic.
alter table public.cancellation_requests
 add column if not exists actor_type text,
 add column if not exists actor_id text,
 add column if not exists actor_email text,
 add column if not exists source text,
 add column if not exists correlation_id text,
 add column if not exists request_path text;
create or replace function public.practitioner_decide_cancellation_request(
 p_request_id uuid,p_status text,p_admin_notes text,p_refund_amount numeric,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare cr public.cancellation_requests%rowtype; s public.sessions%rowtype; prior jsonb; notice_id uuid; action_name text;
begin
 if p_status not in ('approved','denied','rescheduled','no_show') or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Invalid cancellation decision metadata'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 select * into cr from public.cancellation_requests where id=p_request_id for update;
 if not found then raise exception 'Cancellation request not found'; end if;
 select * into s from public.sessions where id=cr.session_id for update;
 if cr.session_id is not null and not found then raise exception 'Linked session not found'; end if;
 if cr.session_id is not null then prior:=jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service); end if;
 update public.cancellation_requests set status=p_status,admin_notes=coalesce(p_admin_notes,admin_notes),refund_approved_amt=p_refund_amount,approved_by=lower(btrim(p_actor_email)),approved_at=now(),updated_at=now(),actor_type='practitioner',actor_id=p_actor_id,actor_email=lower(btrim(p_actor_email)),source='dashboard',correlation_id=p_correlation_id,request_path=p_request_path where id=p_request_id returning * into cr;
 if cr.session_id is not null and p_status in ('approved','no_show') then
  action_name:=case when p_status='approved' then 'cancel' else 'no_show' end;
  update public.sessions set status=case when p_status='approved' then 'cancelled' else 'no_show' end,cancel_reason=case when p_status='approved' then cr.reason else 'No-show / no-call' end,
   refund_status=case when p_status='approved' and p_refund_amount is not null then case when p_refund_amount>0 then 'approved' else 'denied' end when p_status='no_show' then 'denied' else refund_status end,
   refund_amount=case when p_status='approved' and p_refund_amount is not null then p_refund_amount else refund_amount end,
   payment_status=case when p_status='approved' and p_refund_amount is not null and p_refund_amount>=coalesce(amount_paid,0) and p_refund_amount>0 then 'refunded' when p_status='approved' and p_refund_amount>0 then 'partially_refunded' else payment_status end,
   google_calendar_status=case when google_calendar_event_id is not null then 'cancel_pending' else 'cancelled' end,google_calendar_error=null,updated_at=now() where id=cr.session_id returning * into s;
  update public.availability_slots set status='available',session_id=null,held_until=null,held_for=null where session_id=cr.session_id;
  if p_status='approved' then
   notice_id:=gen_random_uuid();
   insert into public.appointment_notices(id,session_id,action,old_date,old_time,new_date,new_time,status,actor_type,actor_id,actor_email,source,correlation_id,request_path,previous_state,new_state)
   values(notice_id,s.id,'cancel',s.session_date,s.session_time,null,null,'pending','practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',p_correlation_id,p_request_path,prior,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service));
  end if;
  insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',case when p_status='approved' then 'cancellation_approved' else 'appointment_no_show' end,prior,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service),p_correlation_id,p_request_path);
 elsif cr.session_id is not null then
  insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
  values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','cancellation_request_'||p_status,prior,prior,p_correlation_id,p_request_path);
 end if;
 return jsonb_build_object('request',to_jsonb(cr),'session',case when cr.session_id is not null then to_jsonb(s) else null end,'notice_id',notice_id,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_decide_cancellation_request(uuid,text,text,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_decide_cancellation_request(uuid,text,text,numeric,text,text,text,text) to service_role;

-- Public cancellation requests remain requests (not cancellations) and are auditable without trusting caller identity.
create or replace function public.create_client_cancellation_request_with_audit(p_request jsonb,p_correlation_id text,p_request_path text)
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare r public.cancellation_requests%rowtype;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Cancellation request and correlation metadata are required'; end if;
 if nullif(btrim(p_request->>'client_name'),'') is null or nullif(btrim(p_request->>'email'),'') is null or nullif(btrim(p_request->>'reason'),'') is null then raise exception 'Cancellation request identity and reason are required'; end if;
 insert into public.cancellation_requests(client_name,email,phone,appointment_date,appointment_time,service,payment_method,reason,wants_reschedule,additional_notes,hours_until_appt,refund_eligible,refund_estimate,refund_pct,session_id,status,actor_type,actor_id,actor_email,source,correlation_id,request_path)
 values(btrim(p_request->>'client_name'),lower(btrim(p_request->>'email')),nullif(btrim(p_request->>'phone'),''),(p_request->>'appointment_date')::date,nullif(p_request->>'appointment_time','')::time,nullif(p_request->>'service',''),nullif(p_request->>'payment_method',''),btrim(p_request->>'reason'),coalesce((p_request->>'wants_reschedule')::boolean,false),nullif(p_request->>'additional_notes',''),nullif(p_request->>'hours_until_appt','')::numeric,coalesce((p_request->>'refund_eligible')::boolean,false),nullif(p_request->>'refund_estimate',''),nullif(p_request->>'refund_pct','')::numeric,null,'pending','unknown',null,null,'public_cancellation_form',p_correlation_id,p_request_path)
 returning * into r;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(null,'unknown',null,null,'public_cancellation_form','client_cancellation_requested',null,jsonb_build_object('request_id',r.id,'status',r.status,'appointment_date',r.appointment_date,'appointment_time',r.appointment_time),p_correlation_id,p_request_path);
 return jsonb_build_object('request',to_jsonb(r),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.create_client_cancellation_request_with_audit(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_client_cancellation_request_with_audit(jsonb,text,text) to service_role;

-- Legacy practitioner session creation remains available only through an audited server-side transaction.
create or replace function public.practitioner_create_session_with_audit(p_session jsonb,p_actor_id text,p_actor_email text,p_correlation_id text,p_request_path text)
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype; d date; t time without time zone; duration integer;
begin
 if p_session is null or jsonb_typeof(p_session)<>'object' or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Session and trusted audit metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if lower(coalesce(p_session->>'source','')) not in ('manual','manual_practitioner','manual_practitioner_calendar','historical_manual_import') then raise exception 'This source must use its dedicated booking or import workflow'; end if;
 if lower(coalesce(p_session->>'status','pending')) in ('cancelled','completed','no_show','expired') then raise exception 'Lifecycle-terminal sessions must use their dedicated workflow'; end if;
 if lower(coalesce(p_session->>'source',''))<>'historical_manual_import' and (lower(coalesce(p_session->>'payment_status','unpaid')) not in ('unpaid','pending') or coalesce(nullif(p_session->>'amount_paid','')::numeric,0)<>0) then raise exception 'Use the audited payment workflow to record funds'; end if;
 d:=nullif(p_session->>'session_date','')::date; t:=nullif(p_session->>'session_time','')::time; duration:=coalesce(nullif(p_session->>'duration_minutes','')::integer,60);
 if duration<1 or duration>1440 or ((d is null)<>(t is null)) then raise exception 'Session date/time or duration is invalid'; end if;
 if d is not null then lock table public.sessions in share row exclusive mode; if exists(select 1 from public.sessions x where coalesce(lower(x.status),'pending') not in ('cancelled','completed','no_show','expired') and x.session_date+x.session_time<d+t+make_interval(mins=>duration) and x.session_date+x.session_time+make_interval(mins=>coalesce(nullif(x.duration_minutes,0),60))>d+t) then raise exception 'Session overlaps an existing appointment'; end if; end if;
 insert into public.sessions(client_id,client_name,client_email,client_phone,service,session_date,session_time,duration_minutes,amount_due,amount_paid,payment_status,payment_method,payment_reference,payment_note,payment_source,square_booking_id,location_type,status,source,booking_status,waiver_status,waiver_completed,seller_notes,state_before,state_after,google_calendar_status)
 values(nullif(p_session->>'client_id','')::uuid,nullif(p_session->>'client_name',''),nullif(p_session->>'client_email',''),nullif(p_session->>'client_phone',''),nullif(p_session->>'service',''),d,t,duration,nullif(p_session->>'amount_due','')::numeric,coalesce(nullif(p_session->>'amount_paid','')::numeric,0),coalesce(nullif(p_session->>'payment_status',''),'unpaid'),nullif(p_session->>'payment_method',''),nullif(p_session->>'payment_reference',''),nullif(p_session->>'payment_note',''),coalesce(nullif(p_session->>'payment_source',''),'none'),nullif(p_session->>'square_booking_id',''),coalesce(nullif(p_session->>'location_type',''),'distance'),coalesce(nullif(p_session->>'status',''),'pending'),coalesce(nullif(p_session->>'source',''),'manual'),nullif(p_session->>'booking_status',''),nullif(p_session->>'waiver_status',''),coalesce(nullif(p_session->>'waiver_completed','')::boolean,false),nullif(p_session->>'seller_notes',''),nullif(p_session->>'state_before','')::smallint,nullif(p_session->>'state_after','')::smallint,coalesce(nullif(p_session->>'google_calendar_status',''),'not_requested')) returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','session_created',null,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'session_date',s.session_date,'session_time',s.session_time,'service',s.service,'source',s.source),p_correlation_id,p_request_path);
 return jsonb_build_object('session',to_jsonb(s),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_create_session_with_audit(jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_create_session_with_audit(jsonb,text,text,text,text) to service_role;

-- Intake-only requests may create a pending session shell, but can never assert a booked/paid appointment.
create or replace function public.create_intake_session_with_audit(p_session jsonb,p_source text,p_correlation_id text,p_request_path text)
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype;
begin
 if p_source not in ('onboarding_form','website_form') or p_session is null or jsonb_typeof(p_session)<>'object' or p_session->>'source'<>p_source or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Invalid intake session request'; end if;
 if lower(coalesce(p_session->>'status','pending'))<>'pending' or lower(coalesce(p_session->>'payment_status','unpaid')) not in ('unpaid','pending') or nullif(p_session->>'session_date','') is not null or nullif(p_session->>'session_time','') is not null then raise exception 'Intake sessions cannot represent a booked or paid appointment'; end if;
 insert into public.sessions(client_id,client_name,client_email,client_phone,service,session_date,session_time,duration_minutes,amount_due,amount_paid,payment_status,location_type,status,source,seller_notes,booking_status,google_calendar_status)
 values(nullif(p_session->>'client_id','')::uuid,nullif(p_session->>'client_name',''),nullif(p_session->>'client_email',''),nullif(p_session->>'client_phone',''),nullif(p_session->>'service',''),null,null,coalesce(nullif(p_session->>'duration_minutes','')::integer,60),nullif(p_session->>'amount_due','')::numeric,0,'unpaid',coalesce(nullif(p_session->>'location_type',''),'distance'),'pending',p_source,nullif(p_session->>'seller_notes',''),null,'not_requested') returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'system',p_source,null,p_source,'intake_session_created',null,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'session_date',s.session_date,'session_time',s.session_time,'source',s.source),p_correlation_id,p_request_path);
 return jsonb_build_object('session',to_jsonb(s),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.create_intake_session_with_audit(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.create_intake_session_with_audit(jsonb,text,text,text) to service_role;

-- Reminder markers and their audit record are one transaction. Actor metadata
-- is accepted only from the internal worker identity or a verified practitioner.
create or replace function public.record_session_reminder_with_audit(
 p_session_id uuid,p_actor_type text,p_actor_id text,p_actor_email text,
 p_source text,p_correlation_id text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype; old_reminder boolean; old_at timestamptz; actor_email text;
begin
 if p_session_id is null or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Reminder mutation metadata is required'; end if;
 actor_email:=nullif(lower(btrim(p_actor_email)),'');
 if p_actor_type='system' then
  if p_actor_id is distinct from 'reminder_worker' or p_source is distinct from 'reminder_worker' or actor_email is not null then raise exception 'Invalid reminder worker identity'; end if;
 elsif p_actor_type='practitioner' then
  if p_source is distinct from 'dashboard' or p_actor_id is null or actor_email is null or not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=actor_email and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 else raise exception 'Unsupported reminder actor type';
 end if;
 select * into s from public.sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if coalesce(s.reminder_sent,false) then return jsonb_build_object('updated',false,'duplicate',true,'session',to_jsonb(s),'correlation_id',p_correlation_id); end if;
 old_reminder:=coalesce(s.reminder_sent,false); old_at:=s.reminder_sent_at;
 update public.sessions set reminder_sent=true,reminder_sent_at=now(),updated_at=now() where id=p_session_id returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_session_id,p_actor_type,p_actor_id,actor_email,p_source,'reminder_marked',jsonb_build_object('reminder_sent',old_reminder,'reminder_sent_at',old_at),jsonb_build_object('reminder_sent',s.reminder_sent,'reminder_sent_at',s.reminder_sent_at),p_correlation_id,p_request_path);
 return jsonb_build_object('updated',true,'duplicate',false,'session',to_jsonb(s),'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.record_session_reminder_with_audit(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_session_reminder_with_audit(uuid,text,text,text,text,text,text) to service_role;

-- The event claim, canonical Stripe ledger mutation, session transition and
-- audit all commit together. Email/Calendar work remains outside this RPC.
alter table public.stripe_webhook_events
 add column if not exists business_committed_at timestamptz,
 add column if not exists session_id uuid,
 add column if not exists correlation_id text,
 add column if not exists correlation_uuid uuid;

create or replace function public.process_stripe_webhook_event_with_audit(
 p_event_id text,p_event_type text,p_payload jsonb,p_session_id uuid,
 p_updates jsonb,p_payment jsonb,p_payment_action text,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare ev public.stripe_webhook_events%rowtype; mutation jsonb; s public.sessions%rowtype; payment_id uuid; v_reference_id text; payment_row public.payments%rowtype; payment_previous jsonb; v_correlation_id uuid := gen_random_uuid();
begin
 if nullif(btrim(p_event_id),'') is null or p_event_type is null or p_payload is null or p_payload->>'id' is distinct from p_event_id or p_payload->>'type' is distinct from p_event_type or nullif(btrim(p_request_path),'') is null then raise exception 'Verified Stripe event metadata is invalid'; end if;
 if p_payment_action is null or p_payment_action not in ('none','upsert','refund') then raise exception 'Unsupported Stripe ledger operation'; end if;
 if (p_updates is null)<>(p_session_id is null) then raise exception 'Session ID and session updates must be provided together'; end if;
 if p_payment_action='none' and p_payment is not null then raise exception 'Unexpected Stripe payment payload'; end if;
 if p_payment_action<>'none' and p_payment is null then raise exception 'Stripe ledger payload is required'; end if;
 if p_payment_action='upsert' and p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then raise exception 'This Stripe event cannot create a payment ledger entry'; end if;
 if p_payment_action='refund' and p_event_type<>'charge.refunded' then raise exception 'This Stripe event cannot update a refund ledger entry'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-event:'||p_event_id,0));
 select * into ev from public.stripe_webhook_events where id=p_event_id for update;
 if found then
  if ev.state='processed' then
   if ev.session_id is not null then select * into s from public.sessions where id=ev.session_id; end if;
   return jsonb_build_object('duplicate',true,'already_committed',true,'session',case when ev.session_id is not null then to_jsonb(s) else null end,'correlation_id',coalesce(ev.correlation_uuid::text,ev.correlation_id,p_event_id));
  end if;
  if ev.business_committed_at is not null then
   if ev.session_id is not null then select * into s from public.sessions where id=ev.session_id; end if;
   return jsonb_build_object('duplicate',true,'already_committed',true,'session',case when ev.session_id is not null then to_jsonb(s) else null end,'correlation_id',coalesce(ev.correlation_uuid::text,ev.correlation_id,p_event_id));
  end if;
  if ev.state='processing' then raise exception 'Stripe event is already being processed'; end if;
  update public.stripe_webhook_events set type=p_event_type,state='processing',payload=p_payload,processing_error=null,processing_started_at=now(),attempt_count=coalesce(attempt_count,0)+1 where id=p_event_id;
 else
  insert into public.stripe_webhook_events(id,type,state,received_at,processing_started_at,attempt_count,payload)
  values(p_event_id,p_event_type,'processing',now(),now(),1,p_payload);
 end if;

 if p_session_id is not null then
  if p_updates is null or jsonb_typeof(p_updates)<>'object' then raise exception 'Stripe session update payload is invalid'; end if;
  if p_event_type='charge.refunded' then
   if not exists(select 1 from public.sessions x where x.id=p_session_id and x.stripe_payment_intent_id=p_payload->'data'->'object'->>'payment_intent') then raise exception 'Refund event does not match the session PaymentIntent'; end if;
  elsif coalesce(p_payload->'data'->'object'->'metadata'->>'session_id',p_payload->'data'->'object'->'metadata'->>'booking_id',p_payload->'data'->'object'->>'client_reference_id') is distinct from p_session_id::text then
   raise exception 'Stripe event does not identify the requested session';
  end if;
  mutation:=public.trusted_session_update_with_audit(
   p_session_id,p_updates,'system','stripe_webhook',null,'stripe_webhook',
   case when p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then 'payment_confirmed'
        when p_event_type='charge.refunded' then 'payment_refunded'
        when p_event_type='checkout.session.expired' then 'payment_expired' else 'payment_failed' end,
   v_correlation_id,p_request_path);
  if mutation->'session' is null then raise exception 'Stripe session transition was not committed'; end if;
  s:=jsonb_populate_record(null::public.sessions,mutation->'session');
 end if;

 if p_payment_action='upsert' then
  v_reference_id:=nullif(btrim(p_payment->>'reference_id'),'');
  if v_reference_id is null or p_payment->>'method'<>'stripe' or nullif(p_payment->>'session_id','')::uuid is distinct from p_session_id or coalesce(nullif(p_payment->>'amount','')::numeric,0)<=0 then raise exception 'Stripe payment ledger payload is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-payment:'||v_reference_id,0));
  select p.* into payment_row from public.payments p where p.method='stripe' and p.reference_id=v_reference_id for update;
  if found then payment_id:=payment_row.id; payment_previous:=to_jsonb(payment_row); end if;
  if payment_id is null then
   insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,correlation_uuid,actor_type,actor_id,actor_email,source)
   values(p_session_id,nullif(p_payment->>'client_id','')::uuid,nullif(p_payment->>'client_name',''),(p_payment->>'amount')::numeric,'stripe',v_reference_id,coalesce(nullif(p_payment->>'status',''),'received'),nullif(p_payment->>'notes',''),coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),v_correlation_id::text,v_correlation_id,'system','stripe_webhook',null,'stripe_webhook') returning id into payment_id;
  else
   update public.payments set session_id=p_session_id,client_id=nullif(p_payment->>'client_id','')::uuid,client_name=nullif(p_payment->>'client_name',''),amount=(p_payment->>'amount')::numeric,status=coalesce(nullif(p_payment->>'status',''),'received'),notes=nullif(p_payment->>'notes',''),paid_at=coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),correlation_id=v_correlation_id::text,correlation_uuid=v_correlation_id,actor_type='system',actor_id='stripe_webhook',actor_email=null,source='stripe_webhook' where id=payment_id;
  end if;
 elsif p_payment_action='refund' then
  v_reference_id:=nullif(btrim(p_payment->>'reference_id'),'');
  if v_reference_id is null or p_payment->>'method'<>'stripe' then raise exception 'Stripe refund ledger payload is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-payment:'||v_reference_id,0));
  select * into payment_row from public.payments where method='stripe' and reference_id=v_reference_id for update;
  if not found then raise exception 'Stripe refund has no matching payment ledger row'; end if;
  payment_id:=payment_row.id; payment_previous:=to_jsonb(payment_row);
  update public.payments set refunded_amount=nullif(p_payment->>'refunded_amount','')::numeric,refunded_at=coalesce(nullif(p_payment->>'refunded_at','')::timestamptz,now()),refund_status=nullif(p_payment->>'refund_status',''),stripe_charge_id=nullif(p_payment->>'stripe_charge_id',''),stripe_refund_id=nullif(p_payment->>'stripe_refund_id',''),status=case when p_payment->>'refund_status'='full' then 'refunded' else status end,correlation_id=v_correlation_id::text,correlation_uuid=v_correlation_id,actor_type='system',actor_id='stripe_webhook',actor_email=null,source='stripe_webhook'
   where id=payment_id;
 end if;

 if payment_id is not null then
  select * into payment_row from public.payments where id=payment_id;
  insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,correlation_uuid,request_path)
  values(payment_id,p_session_id,'system','stripe_webhook',null,'stripe_webhook',case when p_payment_action='refund' then 'stripe_refund_updated' else 'stripe_payment_recorded' end,payment_previous,to_jsonb(payment_row),v_correlation_id::text,v_correlation_id,p_request_path);
 end if;

 update public.stripe_webhook_events set business_committed_at=now(),session_id=p_session_id,correlation_id=v_correlation_id::text,correlation_uuid=v_correlation_id,stripe_event_id=p_event_id where id=p_event_id;
 return jsonb_build_object('duplicate',false,'already_committed',false,'session',case when p_session_id is not null then to_jsonb(s) else null end,'payment_id',payment_id,'correlation_id',v_correlation_id);
end;$function$;
revoke all on function public.process_stripe_webhook_event_with_audit(text,text,jsonb,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.process_stripe_webhook_event_with_audit(text,text,jsonb,uuid,jsonb,jsonb,text,text) to service_role;

create or replace function public.finalize_stripe_webhook_event(p_event_id text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $function$
begin
 update public.stripe_webhook_events set state='processed',processed_at=now(),processing_error=null where id=p_event_id and business_committed_at is not null;
 return found;
end;$function$;
revoke all on function public.finalize_stripe_webhook_event(text) from public,anon,authenticated;
grant execute on function public.finalize_stripe_webhook_event(text) to service_role;

-- Financial bookkeeping has a separate ledger from operational payments. Keep
-- those standalone accounting entries in that ledger, but persist trusted
-- actor/correlation audit atomically with each entry. Linked payments wrap the
-- operational payment RPC so ledger, session, invoice, and both audits share
-- one outer PostgreSQL transaction.
alter table public.ledger_entries
 add column if not exists correlation_id uuid,
 add column if not exists actor_type text,
 add column if not exists actor_id text,
 add column if not exists actor_email text,
 add column if not exists source text;
create unique index if not exists ledger_entries_correlation_id_unique_idx
 on public.ledger_entries(correlation_id) where correlation_id is not null;

create table if not exists public.financial_ledger_audit (
 id uuid primary key default gen_random_uuid(),
 ledger_entry_id uuid not null references public.ledger_entries(id) on delete restrict,
 actor_type text not null check(actor_type='practitioner'),
 actor_id text not null,
 actor_email text not null,
 source text not null check(source='dashboard'),
 action text not null,
 previous_state jsonb,
 new_state jsonb not null,
 request_payload jsonb not null,
 correlation_id uuid not null unique,
 request_path text not null,
 created_at timestamptz not null default now()
);
alter table public.financial_ledger_audit enable row level security;
revoke all on public.financial_ledger_audit from public,anon,authenticated;
grant all on public.financial_ledger_audit to service_role;

create or replace function public.practitioner_create_ledger_entry_with_audit(
 p_entry jsonb,p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare e public.ledger_entries%rowtype; prior public.financial_ledger_audit%rowtype; request_data jsonb;
begin
 if p_entry is null or jsonb_typeof(p_entry)<>'object' or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Ledger input and correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if p_entry->>'entry_type' not in ('charge','payment','credit','refund','adjustment','write_off') or coalesce(nullif(p_entry->>'amount','')::numeric,0)<=0 or nullif(btrim(p_entry->>'description'),'') is null then raise exception 'Ledger entry is invalid'; end if;
 if p_entry->>'entry_type'='payment' and nullif(p_entry->>'related_session_id','') is not null then raise exception 'Session-linked payments must use the financial payment transaction'; end if;
 request_data:=p_entry;
 perform pg_advisory_xact_lock(hashtextextended('financial-ledger:'||p_correlation_id::text,0));
 select * into prior from public.financial_ledger_audit where correlation_id=p_correlation_id for update;
 if found then
  if prior.actor_id is distinct from p_actor_id or prior.actor_email is distinct from lower(btrim(p_actor_email)) or prior.request_payload is distinct from request_data then raise exception 'Ledger idempotency key was reused with different details'; end if;
  select * into e from public.ledger_entries where id=prior.ledger_entry_id;
  if not found then raise exception 'Previously audited ledger entry is missing'; end if;
  return jsonb_build_object('entry',to_jsonb(e),'duplicate',true,'correlation_id',p_correlation_id);
 end if;
 insert into public.ledger_entries(client_id,client_name,entry_type,description,amount,balance_impact,related_session_id,related_payment_id,related_package_id,invoice_id,entry_date,notes,created_by,correlation_id,actor_type,actor_id,actor_email,source)
 values(nullif(p_entry->>'client_id','')::uuid,nullif(p_entry->>'client_name',''),p_entry->>'entry_type',p_entry->>'description',abs((p_entry->>'amount')::numeric),coalesce(nullif(p_entry->>'balance_impact','')::numeric,case when p_entry->>'entry_type'='charge' then abs((p_entry->>'amount')::numeric) else -abs((p_entry->>'amount')::numeric) end),nullif(p_entry->>'related_session_id','')::uuid,nullif(p_entry->>'related_payment_id','')::uuid,nullif(p_entry->>'related_package_id','')::uuid,nullif(p_entry->>'invoice_id','')::uuid,coalesce(nullif(p_entry->>'entry_date','')::date,current_date),nullif(p_entry->>'notes',''),lower(btrim(p_actor_email)),p_correlation_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard') returning * into e;
 insert into public.financial_ledger_audit(ledger_entry_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,request_payload,correlation_id,request_path)
 values(e.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','ledger_entry_created',null,to_jsonb(e),request_data,p_correlation_id,p_request_path);
 return jsonb_build_object('entry',to_jsonb(e),'duplicate',false,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_create_ledger_entry_with_audit(jsonb,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_create_ledger_entry_with_audit(jsonb,text,text,uuid,text) to service_role;

/* Transitional financial-payment writer intentionally omitted from clean
   replay. The final allocation-aware signature is installed by the last
   payment-policy migration after all dependent columns exist.
create or replace function public.practitioner_record_financial_payment_with_audit(
 p_client_id uuid,p_client_name text,p_session_id uuid,p_invoice_id uuid,p_payment_id uuid,
 p_amount numeric,p_method text,p_description text,p_entry_date date,p_notes text,
 p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare prior public.financial_ledger_audit%rowtype; e public.ledger_entries%rowtype; inv public.invoices%rowtype; s public.sessions%rowtype; pay_result jsonb; pay_id uuid; old_invoice jsonb; request_data jsonb; paid numeric; next_status text;
begin
 if p_client_id is null or p_amount is null or p_amount<=0 or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and correlation metadata are required'; end if;
 if lower(coalesce(p_method,'cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 request_data:=jsonb_build_object('client_id',p_client_id,'client_name',p_client_name,'session_id',p_session_id,'invoice_id',p_invoice_id,'payment_id',p_payment_id,'amount',p_amount,'method',coalesce(p_method,'cash_app'),'description',coalesce(p_description,'Payment received'),'entry_date',p_entry_date,'notes',p_notes);
 perform pg_advisory_xact_lock(hashtextextended('financial-ledger:'||p_correlation_id::text,0));
 select * into prior from public.financial_ledger_audit where correlation_id=p_correlation_id for update;
 if found then
  if prior.actor_id is distinct from p_actor_id or prior.actor_email is distinct from lower(btrim(p_actor_email)) or prior.action<>'financial_payment_recorded' or prior.request_payload is distinct from request_data then raise exception 'Payment idempotency key was reused with different details'; end if;
  select * into e from public.ledger_entries where id=prior.ledger_entry_id;
  if not found then raise exception 'Previously audited payment ledger entry is missing'; end if;
  if p_session_id is not null then select * into s from public.sessions where id=p_session_id; end if;
  if p_invoice_id is not null then select * into inv from public.invoices where id=p_invoice_id; end if;
  return jsonb_build_object('entry',to_jsonb(e),'session',case when s.id is not null then to_jsonb(s) else null end,'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'duplicate',true,'correlation_id',p_correlation_id);
 end if;
 if p_invoice_id is not null then
  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found or inv.client_id is distinct from p_client_id or inv.status='cancelled' then raise exception 'Invoice is missing, cancelled, or belongs to another client'; end if;
  old_invoice:=to_jsonb(inv);
 end if;
 if p_session_id is not null then
  select * into s from public.sessions where id=p_session_id for update;
  if not found or s.client_id is distinct from p_client_id then raise exception 'Session is missing or belongs to another client'; end if;
  pay_result:=public.practitioner_record_manual_payment_with_audit(
   p_session_id,
   jsonb_build_object('amount',p_amount,'method',coalesce(p_method,'cash_app'),'reference_id',null,'status','received','notes',p_notes,'client_name',coalesce(p_client_name,s.client_name),'paid_at',now()),
   p_actor_id,p_actor_email,p_correlation_id::text,p_request_path
  );
  pay_id:=nullif(pay_result->'payment'->>'id','')::uuid;
  select * into s from jsonb_populate_record(null::public.sessions,pay_result->'session');
 end if;
 insert into public.ledger_entries(client_id,client_name,entry_type,description,amount,balance_impact,related_session_id,related_payment_id,invoice_id,entry_date,notes,created_by,correlation_id,actor_type,actor_id,actor_email,source)
 values(p_client_id,p_client_name,'payment',coalesce(nullif(p_description,''),'Payment received'),p_amount,-p_amount,p_session_id,coalesce(pay_id,p_payment_id),p_invoice_id,coalesce(p_entry_date,current_date),p_notes,lower(btrim(p_actor_email)),p_correlation_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard') returning * into e;
 if p_invoice_id is not null then
  paid:=coalesce(inv.amount_paid,0)+p_amount;
  next_status:=case when inv.total>0 and paid>=inv.total then 'paid' when paid>0 then 'partial' else inv.status end;
  update public.invoices set amount_paid=paid,status=next_status,paid_at=case when next_status='paid' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=inv.id returning * into inv;
 end if;
 insert into public.financial_ledger_audit(ledger_entry_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,request_payload,correlation_id,request_path)
 values(e.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','financial_payment_recorded',old_invoice,jsonb_build_object('entry',to_jsonb(e),'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'session',case when s.id is not null then to_jsonb(s) else null end),request_data,p_correlation_id,p_request_path);
 return jsonb_build_object('entry',to_jsonb(e),'payment',pay_result->'payment','session',case when s.id is not null then to_jsonb(s) else null end,'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'duplicate',false,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text) to service_role;
*/

-- These text-correlation payment overloads are transitional definitions only.
-- Keep them cataloged for migration provenance, but never leave an operational
-- payment writer callable between this schema migration and the final UUID and
-- allocation-aware definitions in 20260923130000_payment_overpayment_tip_policy.
do $retire_transitional_payment_rpc$
declare signature text;
begin
 foreach signature in array array[
  'public.practitioner_record_manual_payment_with_audit(uuid,jsonb,text,text,text,text)',
  'public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text)',
  'public.practitioner_update_payment_with_audit(uuid,jsonb,text,text,text,text)',
  'public.practitioner_create_standalone_payment_with_audit(jsonb,text,text,text,text)'
 ] loop
  if to_regprocedure(signature) is not null then
   execute format('revoke all on function %s from public,anon,authenticated,service_role',to_regprocedure(signature)::regprocedure);
  end if;
 end loop;
end;
$retire_transitional_payment_rpc$;

commit;
