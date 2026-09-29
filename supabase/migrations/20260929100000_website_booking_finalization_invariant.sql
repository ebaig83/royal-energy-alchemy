-- Canonical website-booking finalization invariant.
-- This migration is additive and intentionally does not repair existing rows.
begin;

create or replace function public.website_booking_source(p_source text)
returns boolean
language sql immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select lower(coalesce(p_source,'')) in ('online','website','website_booking','website booking','website_form','booking')
$$;

-- Every website finalization path enters through this legacy-text implementation
-- via the UUID wrapper installed by correlation_id_normalization. Keep the
-- implementation here so the active UUID boundary and the historical name
-- cannot drift again.
create or replace function public.trusted_session_update_with_audit_legacy_text(
 p_id uuid, p_updates jsonb, p_actor_type text, p_actor_id text, p_actor_email text,
 p_source text, p_action text, p_correlation_id text, p_request_path text
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
 old public.sessions%rowtype;
 changed public.sessions%rowtype;
 actor_email text;
 website boolean;
 canonical_email text;
 canonical_phone text;
 waiver_done boolean;
begin
 if p_updates is null or jsonb_typeof(p_updates)<>'object'
    or nullif(btrim(p_actor_type),'') is null or nullif(btrim(p_source),'') is null
    or nullif(btrim(p_action),'') is null or nullif(btrim(p_correlation_id),'') is null
    or nullif(btrim(p_request_path),'') is null then
  raise exception 'Trusted mutation metadata is required';
 end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in
   ('status','booking_status','payment_status','amount_due','amount_paid','payment_paid_at',
    'waiver_status','waiver_completed','waiver_completed_at','client_email','client_phone',
    'session_date','session_time','service','location_type','seller_notes','square_booking_id',
    'stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status','stripe_charge_id',
    'stripe_refund_id','payment_hold_expires_at','refunded_amount','refund_status','refund_updated_at',
    'state_before','state_after','google_calendar_status','google_calendar_error',
    'google_calendar_synced_at','updated_at')) then
  raise exception 'Unsupported appointment field';
 end if;

 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;

 actor_email:=nullif(lower(btrim(p_actor_email)), '');
 website:=public.website_booking_source(old.source);
 if website and old.client_id is not null then
  select nullif(lower(btrim(c.email)),''), nullif(btrim(c.phone),'')
    into canonical_email, canonical_phone
  from public.clients c where c.id=old.client_id;
 end if;

 if p_actor_type='practitioner' then
  if p_source<>'dashboard' or p_actor_id is null or actor_email is null
     or not exists(select 1 from public.practitioner_users pu
                   where pu.id::text=p_actor_id and lower(pu.email)=actor_email and pu.active=true) then
   raise exception 'Practitioner actor is not active';
  end if;
 elsif p_actor_type='client' then
  if p_source<>'signed_waiver' or p_actor_id is distinct from old.client_id::text
     or actor_email is null or actor_email is distinct from coalesce(canonical_email,lower(old.client_email)) then
   raise exception 'Client actor does not match the signed session';
  end if;
 elsif p_actor_type='system' then
  if not ((p_source in ('stripe_webhook','stripe-webhook') and p_actor_id in ('stripe_webhook','stripe-webhook') and p_action in ('payment_confirmed','payment_failed','payment_expired','payment_refunded'))
     or (p_source='stripe-checkout' and p_actor_id='stripe-checkout' and p_action='checkout_session_created')
     or (p_source='expire-website-bookings' and p_actor_id='expire-website-bookings' and p_action='payment_hold_expired')
     or (p_source='calendar-worker' and p_actor_id='session-calendar-sync' and p_action in ('calendar_sync_completed','calendar_sync_failed'))
     or (p_source='reminder_worker' and p_actor_id='reminder_worker' and p_action='reminder_marked')) then
   raise exception 'Invalid internal worker context';
  end if;
 else
  raise exception 'Unsupported trusted actor type';
 end if;

 if p_action='payment_hold_expired' then
  if not website or lower(coalesce(old.payment_status,''))='paid' or old.payment_hold_expires_at is null
     or old.payment_hold_expires_at>now() or lower(coalesce(old.status,'')) in ('cancelled','expired','completed','no_show') then
   return jsonb_build_object('eligible',false,'session_id',p_id,'correlation_id',p_correlation_id);
  end if;
  p_updates:=jsonb_build_object('status','expired','booking_status','payment_expired','google_calendar_status','not_requested','updated_at',now());
 end if;
 if p_action='checkout_session_created' then
  if not website or lower(coalesce(old.status,''))<>'pending' or lower(coalesce(old.payment_status,'')) in ('paid','refunded','complimentary','waived')
     or old.payment_hold_expires_at is null or old.payment_hold_expires_at<=now() or old.stripe_checkout_session_id is not null then
   raise exception 'Booking is no longer eligible for checkout';
  end if;
 end if;
 if website and p_source not in ('stripe_webhook','stripe-webhook','expire-website-bookings','signed_waiver')
    and (lower(coalesce(p_updates->>'status',''))='confirmed'
      or lower(coalesce(p_updates->>'booking_status',''))='confirmed'
      or lower(coalesce(p_updates->>'payment_status',''))='paid') then
  raise exception 'Website confirmation requires verified workflow';
 end if;

 changed:=jsonb_populate_record(old,p_updates);
 if website then
  -- Linked client data is authoritative; request payload snapshots are never
  -- allowed to replace it. This is part of the same transaction as finalization.
  changed.client_email:=coalesce(canonical_email,nullif(btrim(old.client_email),''),nullif(btrim(changed.client_email),''));
  changed.client_phone:=coalesce(canonical_phone,nullif(btrim(old.client_phone),''),nullif(btrim(changed.client_phone),''));
 end if;
 waiver_done:=changed.waiver_completed=true or lower(coalesce(changed.waiver_status,'')) in ('complete','completed','signed');
 if website and lower(coalesce(changed.status,''))='confirmed' and lower(coalesce(changed.payment_status,''))='paid' and waiver_done then
  if lower(coalesce(changed.booking_status,''))<>'confirmed' then
   raise exception 'Website finalization invariant requires booking_status=confirmed';
  end if;
  if canonical_email is null or canonical_phone is null then
   raise exception 'Website finalization requires canonical client email and phone';
  end if;
  changed.client_email:=canonical_email;
  changed.client_phone:=canonical_phone;
  changed.waiver_completed:=true;
  if lower(coalesce(changed.waiver_status,'')) not in ('complete','completed','signed') then changed.waiver_status:='complete'; end if;
 end if;

 update public.sessions set
  status=changed.status,booking_status=changed.booking_status,payment_status=changed.payment_status,
  amount_due=changed.amount_due,amount_paid=changed.amount_paid,payment_paid_at=changed.payment_paid_at,
  waiver_status=changed.waiver_status,waiver_completed=changed.waiver_completed,waiver_completed_at=changed.waiver_completed_at,
  client_email=changed.client_email,client_phone=changed.client_phone,session_date=changed.session_date,session_time=changed.session_time,
  service=changed.service,location_type=changed.location_type,seller_notes=changed.seller_notes,square_booking_id=changed.square_booking_id,
  stripe_checkout_session_id=changed.stripe_checkout_session_id,stripe_payment_intent_id=changed.stripe_payment_intent_id,
  stripe_payment_status=changed.stripe_payment_status,stripe_charge_id=changed.stripe_charge_id,stripe_refund_id=changed.stripe_refund_id,
  payment_hold_expires_at=changed.payment_hold_expires_at,refunded_amount=changed.refunded_amount,refund_status=changed.refund_status,
  refund_updated_at=changed.refund_updated_at,state_before=changed.state_before,state_after=changed.state_after,
  google_calendar_status=changed.google_calendar_status,google_calendar_error=changed.google_calendar_error,
  google_calendar_synced_at=changed.google_calendar_synced_at,updated_at=coalesce(changed.updated_at,now())
 where id=p_id returning * into changed;
 if p_action='payment_hold_expired' then update public.availability_slots set status='available',session_id=null where session_id=p_id; end if;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,p_actor_type,p_actor_id,actor_email,p_source,p_action,
   jsonb_build_object('status',old.status,'payment_status',old.payment_status,'booking_status',old.booking_status,'client_email',old.client_email,'client_phone',old.client_phone,'session_date',old.session_date,'session_time',old.session_time,'service',old.service),
   jsonb_build_object('status',changed.status,'payment_status',changed.payment_status,'booking_status',changed.booking_status,'client_email',changed.client_email,'client_phone',changed.client_phone,'session_date',changed.session_date,'session_time',changed.session_time,'service',changed.service),
   p_correlation_id,p_request_path) on conflict (session_id,correlation_id,action) do nothing;
 return jsonb_build_object('eligible',true,'session',to_jsonb(changed),'correlation_id',p_correlation_id);
end;
$function$;

-- Keep the text overload as a compatibility boundary, but force it through
-- the exact same canonical implementation.
create or replace function public.trusted_session_update_with_audit(
 p_id uuid, p_updates jsonb, p_actor_type text, p_actor_id text, p_actor_email text,
 p_source text, p_action text, p_correlation_id text, p_request_path text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
begin
 return public.trusted_session_update_with_audit_legacy_text(p_id,p_updates,p_actor_type,p_actor_id,p_actor_email,p_source,p_action,p_correlation_id,p_request_path);
end;
$function$;

-- Block invalid future states even if a code path attempts to bypass the RPC.
create or replace function public.enforce_website_booking_finalization_invariant()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare email text; phone text; waiver_done boolean;
begin
 if public.website_booking_source(new.source)
    and lower(coalesce(new.status,''))='confirmed'
    and lower(coalesce(new.payment_status,''))='paid'
    and (new.waiver_completed=true or lower(coalesce(new.waiver_status,'')) in ('complete','completed','signed')) then
  select nullif(lower(btrim(c.email)),''),nullif(btrim(c.phone),'') into email,phone
  from public.clients c where c.id=new.client_id;
  if lower(coalesce(new.booking_status,''))<>'confirmed' then raise exception 'Website finalization invariant requires booking_status=confirmed'; end if;
  if email is null or phone is null then raise exception 'Website finalization requires canonical client email and phone'; end if;
  new.client_email:=email; new.client_phone:=phone; new.waiver_completed:=true;
  if lower(coalesce(new.waiver_status,'')) not in ('complete','completed','signed') then new.waiver_status:='complete'; end if;
 end if;
 return new;
end;
$function$;
drop trigger if exists website_booking_finalization_invariant on public.sessions;
create trigger website_booking_finalization_invariant
before insert or update of source,status,booking_status,payment_status,waiver_status,waiver_completed,client_id,client_email,client_phone
on public.sessions for each row execute function public.enforce_website_booking_finalization_invariant();

-- Audited, idempotent repair path for already affected records.
create or replace function public.repair_website_booking_finalization(
 p_session_id uuid, p_correlation_id uuid, p_request_path text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare s public.sessions%rowtype; c public.clients%rowtype; repaired public.sessions%rowtype;
begin
 if p_session_id is null or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Repair metadata is required'; end if;
 select * into s from public.sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if not public.website_booking_source(s.source) or lower(coalesce(s.status,''))<>'confirmed' or lower(coalesce(s.payment_status,''))<>'paid'
    or not (s.waiver_completed=true or lower(coalesce(s.waiver_status,'')) in ('complete','completed','signed')) then
  raise exception 'Session is not eligible for website finalization repair';
 end if;
 select * into c from public.clients where id=s.client_id;
 if not found or nullif(lower(btrim(c.email)),'') is null or nullif(btrim(c.phone),'') is null then raise exception 'Canonical client contact is incomplete'; end if;
 update public.sessions set booking_status='confirmed',client_email=lower(btrim(c.email)),client_phone=btrim(c.phone),waiver_completed=true,waiver_status='complete',updated_at=now() where id=s.id returning * into repaired;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'system','website-booking-invariant-repair',null,'website-booking-invariant-repair','website_booking_invariant_repaired',
   jsonb_build_object('status',s.status,'payment_status',s.payment_status,'booking_status',s.booking_status,'client_email',s.client_email,'client_phone',s.client_phone),
   jsonb_build_object('status',repaired.status,'payment_status',repaired.payment_status,'booking_status',repaired.booking_status,'client_email',repaired.client_email,'client_phone',repaired.client_phone),
   p_correlation_id::text,p_request_path) on conflict (session_id,correlation_id,action) do nothing;
 return jsonb_build_object('repaired',true,'session',to_jsonb(repaired),'correlation_id',p_correlation_id);
end;
$function$;
revoke all on function public.repair_website_booking_finalization(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.repair_website_booking_finalization(uuid,uuid,text) to service_role;

-- Read-only consistency contract used by the scheduled production monitor.
create or replace function public.website_booking_consistency_check()
returns table(session_id uuid,client_name text,session_date date,session_time time,issue_codes text[])
language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
with q as (
 select s.id,s.client_name,s.session_date,s.session_time,s.status,s.booking_status,s.payment_status,s.waiver_status,s.waiver_completed,
        s.client_email,s.client_phone,c.email as canonical_email,c.phone as canonical_phone,
        count(a.id) filter (where a.status='booked') as booked_slots,
        count(a.id) as linked_slots
 from public.sessions s left join public.clients c on c.id=s.client_id left join public.availability_slots a on a.session_id=s.id
 where public.website_booking_source(s.source)
 group by s.id,s.client_name,s.session_date,s.session_time,s.status,s.booking_status,s.payment_status,s.waiver_status,s.waiver_completed,s.client_email,s.client_phone,c.email,c.phone
), flagged as (
 select q.*,
   array_remove(array[
    case when lower(coalesce(status,''))='confirmed' and lower(coalesce(payment_status,''))='paid' and (waiver_completed=true or lower(coalesce(waiver_status,'')) in ('complete','completed','signed')) and lower(coalesce(booking_status,''))<>'confirmed' then 'confirmed_paid_waived_booking_status_mismatch' end,
    case when nullif(btrim(client_email),'') is null and nullif(btrim(canonical_email),'') is not null then 'missing_session_email_snapshot' end,
    case when nullif(btrim(client_phone),'') is null and nullif(btrim(canonical_phone),'') is not null then 'missing_session_phone_snapshot' end,
    case when lower(coalesce(status,''))='confirmed' and lower(coalesce(payment_status,''))='paid' and (waiver_completed=true or lower(coalesce(waiver_status,'')) in ('complete','completed','signed')) and (booked_slots=0 or linked_slots<>booked_slots) then 'booked_slot_not_linked' end,
    case when lower(coalesce(status,''))='confirmed' and lower(coalesce(payment_status,''))='paid' and (waiver_completed=true or lower(coalesce(waiver_status,'')) in ('complete','completed','signed')) and (lower(coalesce(booking_status,''))<>'confirmed' or nullif(btrim(coalesce(client_email,'')),'') is null or nullif(btrim(coalesce(client_phone,'')),'') is null) then 'operational_eligibility_missing' end
   ],null) as issues
 from q
)
select id,client_name,session_date,session_time,issues from flagged where cardinality(issues)>0 order by session_date,session_time,id;
$$;
revoke all on function public.website_booking_consistency_check() from public,anon,authenticated;
grant execute on function public.website_booking_consistency_check() to service_role;

commit;
