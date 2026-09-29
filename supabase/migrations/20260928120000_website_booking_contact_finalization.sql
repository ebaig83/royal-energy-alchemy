-- Keep verified website finalization authoritative and carry only the exact
-- linked client's contact data into the session snapshot.
create or replace function public.trusted_session_update_with_audit(
 p_id uuid, p_updates jsonb, p_actor_type text, p_actor_id text, p_actor_email text,
 p_source text, p_action text, p_correlation_id text, p_request_path text
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare old public.sessions%rowtype; changed public.sessions%rowtype; actor_email text; website boolean;
begin
 if p_updates is null or jsonb_typeof(p_updates)<>'object' or nullif(btrim(p_actor_type),'') is null or nullif(btrim(p_source),'') is null or nullif(btrim(p_action),'') is null or nullif(btrim(p_correlation_id),'') is null or nullif(btrim(p_request_path),'') is null then raise exception 'Trusted mutation metadata is required'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('status','booking_status','payment_status','amount_due','amount_paid','payment_paid_at','waiver_status','waiver_completed','waiver_completed_at','client_email','client_phone','session_date','session_time','service','location_type','seller_notes','square_booking_id','stripe_checkout_session_id','stripe_payment_intent_id','stripe_payment_status','stripe_charge_id','stripe_refund_id','payment_hold_expires_at','refunded_amount','refund_status','refund_updated_at','state_before','state_after','google_calendar_status','google_calendar_error','google_calendar_synced_at','updated_at')) then raise exception 'Unsupported appointment field'; end if;
 select * into old from public.sessions where id=p_id for update;
 if not found then raise exception 'Session not found'; end if;
 actor_email:=nullif(lower(btrim(p_actor_email)), '');
 website:=lower(coalesce(old.source,'')) in ('online','website','website_booking','website booking','website_form','booking');
 if p_actor_type='practitioner' then
  if p_source<>'dashboard' or p_actor_id is null or actor_email is null or not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=actor_email and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 elsif p_actor_type='client' then
  if p_source<>'signed_waiver' or p_actor_id is distinct from old.client_id::text or actor_email is null or actor_email is distinct from coalesce((select lower(c.email) from public.clients c where c.id=old.client_id),lower(old.client_email)) then raise exception 'Client actor does not match the signed session'; end if;
  if p_updates ? 'client_email' or p_updates ? 'client_phone' then raise exception 'Client contact snapshot is server-authoritative'; end if;
 elsif p_actor_type='system' then
  if not ((p_source in ('stripe_webhook','stripe-webhook') and p_actor_id in ('stripe_webhook','stripe-webhook') and p_action in ('payment_confirmed','payment_failed','payment_expired','payment_refunded')) or (p_source='stripe-checkout' and p_actor_id='stripe-checkout' and p_action='checkout_session_created') or (p_source='expire-website-bookings' and p_actor_id='expire-website-bookings' and p_action='payment_hold_expired') or (p_source='calendar-worker' and p_actor_id='session-calendar-sync' and p_action in ('calendar_sync_completed','calendar_sync_failed')) or (p_source='reminder_worker' and p_actor_id='reminder_worker' and p_action='reminder_marked')) then raise exception 'Invalid internal worker context'; end if;
 else raise exception 'Unsupported trusted actor type'; end if;
 if p_action='payment_hold_expired' then
  if not website or lower(coalesce(old.payment_status,''))='paid' or old.payment_hold_expires_at is null or old.payment_hold_expires_at>now() or lower(coalesce(old.status,'')) in ('cancelled','expired','completed','no_show') then return jsonb_build_object('eligible',false,'session_id',p_id,'correlation_id',p_correlation_id); end if;
  p_updates:=jsonb_build_object('status','expired','booking_status','payment_expired','google_calendar_status','not_requested','updated_at',now());
 end if;
 if p_action='checkout_session_created' then
  if not website or lower(coalesce(old.status,''))<>'pending' or lower(coalesce(old.payment_status,'')) in ('paid','refunded','complimentary','waived') or old.payment_hold_expires_at is null or old.payment_hold_expires_at<=now() or old.stripe_checkout_session_id is not null then raise exception 'Booking is no longer eligible for checkout'; end if;
 end if;
 if website and p_source not in ('stripe_webhook','stripe-webhook','expire-website-bookings','signed_waiver') and (lower(coalesce(p_updates->>'status',''))='confirmed' or lower(coalesce(p_updates->>'booking_status',''))='confirmed' or lower(coalesce(p_updates->>'payment_status',''))='paid') then raise exception 'Website confirmation requires verified workflow'; end if;
 changed:=jsonb_populate_record(old,p_updates);
 update public.sessions set status=changed.status,booking_status=changed.booking_status,payment_status=changed.payment_status,amount_due=changed.amount_due,amount_paid=changed.amount_paid,payment_paid_at=changed.payment_paid_at,waiver_status=changed.waiver_status,waiver_completed=changed.waiver_completed,waiver_completed_at=changed.waiver_completed_at,client_email=coalesce(nullif(btrim(old.client_email),''),nullif(btrim(changed.client_email),'')),client_phone=coalesce(nullif(btrim(old.client_phone),''),nullif(btrim(changed.client_phone),'')),session_date=changed.session_date,session_time=changed.session_time,service=changed.service,location_type=changed.location_type,seller_notes=changed.seller_notes,square_booking_id=changed.square_booking_id,stripe_checkout_session_id=changed.stripe_checkout_session_id,stripe_payment_intent_id=changed.stripe_payment_intent_id,stripe_payment_status=changed.stripe_payment_status,stripe_charge_id=changed.stripe_charge_id,stripe_refund_id=changed.stripe_refund_id,payment_hold_expires_at=changed.payment_hold_expires_at,refunded_amount=changed.refunded_amount,refund_status=changed.refund_status,refund_updated_at=changed.refund_updated_at,state_before=changed.state_before,state_after=changed.state_after,google_calendar_status=changed.google_calendar_status,google_calendar_error=changed.google_calendar_error,google_calendar_synced_at=changed.google_calendar_synced_at,updated_at=coalesce(changed.updated_at,now()) where id=p_id returning * into changed;
 if p_action='payment_hold_expired' then update public.availability_slots set status='available',session_id=null where session_id=p_id; end if;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(p_id,p_actor_type,p_actor_id,actor_email,p_source,p_action,jsonb_build_object('status',old.status,'payment_status',old.payment_status,'booking_status',old.booking_status,'client_email',old.client_email,'client_phone',old.client_phone,'session_date',old.session_date,'session_time',old.session_time,'service',old.service),jsonb_build_object('status',changed.status,'payment_status',changed.payment_status,'booking_status',changed.booking_status,'client_email',changed.client_email,'client_phone',changed.client_phone,'session_date',changed.session_date,'session_time',changed.session_time,'service',changed.service),p_correlation_id,p_request_path)
 on conflict (session_id,correlation_id,action) do nothing;
 return jsonb_build_object('eligible',true,'session',to_jsonb(changed),'correlation_id',p_correlation_id);
end;
$function$;
revoke all on function public.trusted_session_update_with_audit(uuid,jsonb,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.trusted_session_update_with_audit(uuid,jsonb,text,text,text,text,text,text,text) to service_role;
