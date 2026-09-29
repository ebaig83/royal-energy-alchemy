-- Service-only mutations. Public clients call these through Netlify functions.
create or replace function public.start_booking_attempt(p_payload jsonb, p_idempotency_key text, p_correlation_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; raw_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if nullif(btrim(p_idempotency_key),'') is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Booking attempt payload and idempotency key are required'; end if;
  select * into a from public.booking_attempts where idempotency_key=p_idempotency_key for update;
  if found then
    return jsonb_build_object('attempt',to_jsonb(a),'resume_token',null,'duplicate',true);
  end if;
  if nullif(p_payload->>'slot_id','') is not null then
    perform 1 from public.availability_slots where id=(p_payload->>'slot_id')::uuid and status='available' for update;
    if not found then raise exception 'The requested slot is no longer available'; end if;
    update public.availability_slots set status='booked',session_id=null where id=(p_payload->>'slot_id')::uuid and status='available';
    if not found then raise exception 'The requested slot is no longer available'; end if;
  end if;
  insert into public.booking_attempts(idempotency_key,client_first_name,client_last_name,client_email,client_phone,client_timezone,client_preferences,service,service_id,session_date,session_time,location_type,service_address,slot_id,waiver_completed,payment_status,payment_amount,status,source,waitlist_offer_id,abandoned_at,expires_at,correlation_id)
  values(p_idempotency_key,nullif(btrim(coalesce(p_payload->>'first_name',p_payload->>'client_first_name')),''),nullif(btrim(coalesce(p_payload->>'last_name',p_payload->>'client_last_name')),''),lower(nullif(btrim(coalesce(p_payload->>'email',p_payload->>'client_email')),'')),nullif(btrim(coalesce(p_payload->>'phone',p_payload->>'client_phone')),''),coalesce(nullif(btrim(p_payload->>'timezone'),''),'America/New_York'),coalesce(p_payload->'preferences','{}'::jsonb),nullif(btrim(p_payload->>'service'),''),nullif(btrim(p_payload->>'service_id'),''),nullif(coalesce(p_payload->>'date',p_payload->>'session_date'),'')::date,nullif(coalesce(p_payload->>'time',p_payload->>'session_time'),'')::time,nullif(btrim(coalesce(p_payload->>'location_type',p_payload->>'mode')),''),p_payload->'service_address',nullif(p_payload->>'slot_id','')::uuid,coalesce((p_payload->>'waiver_completed')::boolean,false),coalesce(nullif(p_payload->>'payment_status',''),'pending'),nullif(p_payload->>'payment_amount','')::numeric,'incomplete',coalesce(nullif(p_payload->>'source',''),'website'),nullif(p_payload->>'waitlist_offer_id','')::uuid,null,now()+interval '48 hours',p_correlation_id) returning * into a;
  insert into public.booking_resume_tokens(attempt_id,token_hash,expires_at) values(a.id,encode(extensions.digest(raw_token,'sha256'),'hex'),now()+interval '48 hours');
  insert into public.booking_attempt_audit(attempt_id,action,new_state,correlation_id) values(a.id,'attempt_started',to_jsonb(a),p_correlation_id);
  return jsonb_build_object('attempt',to_jsonb(a),'resume_token',raw_token,'duplicate',false);
end; $$;
revoke all on function public.start_booking_attempt(jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.start_booking_attempt(jsonb,text,uuid) to service_role;

create or replace function public.resume_booking_attempt(p_resume_token text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; t public.booking_resume_tokens%rowtype;
begin
  if length(coalesce(p_resume_token,'')) < 64 then raise exception 'Invalid resume token'; end if;
  select * into t from public.booking_resume_tokens where token_hash=encode(extensions.digest(p_resume_token,'sha256'),'hex') and revoked_at is null and expires_at>now();
  if not found then raise exception 'Resume token is expired or invalid'; end if;
  select * into a from public.booking_attempts where id=t.attempt_id for update;
  if not found or a.status in ('completed','withdrawn','expired','unavailable','ineligible') then raise exception 'Booking attempt is no longer resumable'; end if;
  update public.booking_attempts set status='resumed',last_resumed_at=now() where id=a.id returning * into a;
  return jsonb_build_object('attempt',to_jsonb(a),'resume_token',p_resume_token);
end; $$;
revoke all on function public.resume_booking_attempt(text) from public,anon,authenticated;
grant execute on function public.resume_booking_attempt(text) to service_role;

create or replace function public.validate_booking_completion(p_attempt_id uuid, p_payment_status text default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; reasons text[] := '{}'; address_ok boolean := true; slot_ok boolean := false;
begin
  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Booking attempt not found'; end if;
  if nullif(btrim(a.client_first_name),'') is null then reasons:=array_append(reasons,'first_name'); end if;
  if nullif(btrim(a.client_last_name),'') is null then reasons:=array_append(reasons,'last_name'); end if;
  if a.client_email is null or a.client_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$' then reasons:=array_append(reasons,'email'); end if;
  if a.client_phone is null or length(regexp_replace(a.client_phone,'\D','','g')) not between 7 and 15 then reasons:=array_append(reasons,'phone'); end if;
  if a.service is null then reasons:=array_append(reasons,'service'); end if;
  if a.session_date is null then reasons:=array_append(reasons,'date'); end if;
  if a.session_time is null then reasons:=array_append(reasons,'time'); end if;
  if a.location_type is null then reasons:=array_append(reasons,'mode'); end if;
  if a.location_type in ('in_person','in-person') then address_ok:=a.service_address is not null and jsonb_typeof(a.service_address)='object' and not exists(select 1 from unnest(array['line1','city','state','postal_code','country']) k where nullif(btrim(a.service_address->>k),'') is null); if not address_ok then reasons:=array_append(reasons,'in_person_address'); end if; end if;
  if not a.waiver_completed then reasons:=array_append(reasons,'waiver'); end if;
  if coalesce(p_payment_status,a.payment_status)<>'paid' or coalesce(a.payment_amount,0)<=0 then reasons:=array_append(reasons,'payment'); end if;
  if a.slot_id is not null and exists(select 1 from public.availability_slots s where s.id=a.slot_id and s.status in ('available','booked') and s.session_id is null) then slot_ok:=true; end if;
  if not slot_ok then reasons:=array_append(reasons,'availability'); end if;
  return jsonb_build_object('valid',cardinality(reasons)=0,'reasons',to_jsonb(reasons),'attempt',to_jsonb(a));
end; $$;
revoke all on function public.validate_booking_completion(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_booking_completion(uuid,text) to service_role;

create or replace function public.expire_booking_attempts(p_now timestamptz default now()) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare n integer := 0; r integer := 0;
begin
  update public.booking_attempts set status='expired',updated_at=p_now where status in ('incomplete','resumed') and expires_at<=p_now;
  get diagnostics n = row_count;
  update public.appointment_slot_reservations resv set status='expired',released_at=p_now where resv.status='active' and resv.expires_at<=p_now;
  get diagnostics r = row_count;
  update public.availability_slots s set status='available',session_id=null where s.status='booked' and s.session_id is null and not exists(select 1 from public.booking_attempts a where a.slot_id=s.id and a.status in ('incomplete','resumed') and a.expires_at>p_now) and not exists(select 1 from public.appointment_slot_reservations rsv where rsv.slot_id=s.id and rsv.status='active' and rsv.expires_at>p_now);
  update public.waitlist_offers set status='expired' where status='offered' and expires_at<=p_now;
  update public.waitlist_entries set status='expired' where status not in ('won','lost','withdrawn','excluded','expired') and expires_at<=p_now;
  return jsonb_build_object('expired_attempts',coalesce(n,0),'expired_reservations',coalesce(r,0));
end; $$;
revoke all on function public.expire_booking_attempts(timestamptz) from public,anon,authenticated;
grant execute on function public.expire_booking_attempts(timestamptz) to service_role;

create or replace function public.finalize_booking_attempt(p_attempt_id uuid,p_payment_status text,p_idempotency_key text,p_correlation_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; s public.sessions%rowtype; slot public.availability_slots%rowtype; c public.clients%rowtype; client_count integer; validation jsonb; address_json jsonb;
begin
  if p_attempt_id is null or p_payment_status<>'paid' or nullif(btrim(p_idempotency_key),'') is null or p_correlation_id is null then raise exception 'Finalization context is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-finalize:'||p_idempotency_key,0));
  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Booking attempt not found'; end if;
  if a.status='completed' then select * into s from public.sessions where id=(select (new_state->>'session_id')::uuid from public.booking_attempt_audit where attempt_id=a.id and action='attempt_finalized' order by created_at desc limit 1); return jsonb_build_object('attempt',to_jsonb(a),'session',to_jsonb(s),'duplicate',true); end if;
  if a.status in ('expired','withdrawn','unavailable','ineligible') then raise exception 'Booking attempt is no longer finalizable'; end if;
  validation:=public.validate_booking_completion(a.id,p_payment_status);
  if coalesce((validation->>'valid')::boolean,false) is not true then raise exception 'Booking attempt is incomplete: %',validation->'reasons'; end if;
  select * into slot from public.availability_slots where id=a.slot_id for update;
  if not found or slot.session_id is not null or slot.status not in ('available','booked') then raise exception 'The requested slot is no longer available'; end if;
  select count(*) into client_count from public.clients where lower(email)=lower(a.client_email) or (phone is not null and regexp_replace(phone,'\D','','g')=regexp_replace(a.client_phone,'\D','','g'));
  if client_count>1 then raise exception 'Ambiguous client identity requires manual review'; end if;
  if client_count=1 then select * into c from public.clients where lower(email)=lower(a.client_email) or (phone is not null and regexp_replace(phone,'\D','','g')=regexp_replace(a.client_phone,'\D','','g')) limit 1 for update; else insert into public.clients(full_name,email,phone) values(a.client_first_name||' '||a.client_last_name,lower(a.client_email),a.client_phone) returning * into c; end if;
  insert into public.sessions(client_id,client_name,client_email,client_phone,service,session_date,session_time,location_type,status,payment_status,amount_due,amount_paid,source,booking_status,waiver_status,waiver_completed,waiver_completed_at,google_calendar_status)
  values(c.id,a.client_first_name||' '||a.client_last_name,a.client_email,a.client_phone,a.service,a.session_date,a.session_time,a.location_type,'confirmed','paid',a.payment_amount,a.payment_amount,case when a.waitlist_offer_id is not null then 'waitlist' else 'online' end,'confirmed','complete',true,a.waiver_completed_at,'pending') returning * into s;
  if a.payment_reference is not null then insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,paid_at) values(s.id,c.id,s.client_name,a.payment_amount,'stripe',a.payment_reference,'received',now()); end if;
  if a.location_type in ('in_person','in-person') then address_json:=a.service_address; if to_regclass('public.session_service_addresses') is not null then execute 'insert into public.session_service_addresses(session_id,address_line1,address_line2,city,state,postal_code,country) values ($1,$2,$3,$4,$5,$6,$7)' using s.id,a.service_address->>'line1',a.service_address->>'line2',a.service_address->>'city',a.service_address->>'state',a.service_address->>'postal_code',a.service_address->>'country'; end if; end if;
  update public.availability_slots set status='booked',session_id=s.id where id=slot.id;
  update public.booking_attempts set status='completed',client_id=c.id,completed_at=now(),updated_at=now() where id=a.id returning * into a;
  update public.appointment_slot_reservations set status='won',released_at=now() where attempt_id=a.id and status='active';
  if a.waitlist_offer_id is not null then update public.waitlist_offers set status='accepted',accepted_at=now() where id=a.waitlist_offer_id and status in ('offered','accepted'); update public.waitlist_offers set status='lost' where slot_id=a.slot_id and id<>a.waitlist_offer_id and status='offered'; update public.waitlist_entries set status='won' where id=(select waitlist_entry_id from public.waitlist_offers where id=a.waitlist_offer_id); end if;
  insert into public.booking_attempt_audit(attempt_id,action,previous_state,new_state,correlation_id) values(a.id,'attempt_finalized',jsonb_build_object('status','incomplete'),jsonb_build_object('status',a.status,'session_id',s.id,'client_id',c.id),p_correlation_id);
  return jsonb_build_object('attempt',to_jsonb(a),'session',to_jsonb(s),'address',address_json,'duplicate',false,'correlation_id',p_correlation_id);
end; $$;
revoke all on function public.finalize_booking_attempt(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.finalize_booking_attempt(uuid,text,text,uuid) to service_role;

create or replace function public.signup_waitlist(p_payload jsonb,p_correlation_id uuid) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare e public.waitlist_entries%rowtype; active_count integer;
begin
  if nullif(btrim(p_payload->>'first_name'),'') is null or nullif(btrim(p_payload->>'last_name'),'') is null or nullif(btrim(p_payload->>'email'),'') is null or nullif(btrim(p_payload->>'phone'),'') is null or nullif(btrim(p_payload->>'service'),'') is null or coalesce(p_payload->>'consent','false') <> 'true' then raise exception 'Waitlist name, contact, service, and consent are required'; end if;
  select count(*) into active_count from public.sessions s where s.client_email is not null and lower(s.client_email)=lower(p_payload->>'email') and coalesce(s.status,'pending') not in ('cancelled','completed','expired','no_show');
  if active_count>0 then raise exception 'Client already has an active appointment'; end if;
  select count(*) into active_count from public.booking_attempts a where lower(a.client_email)=lower(p_payload->>'email') and a.status in ('incomplete','resumed') and a.expires_at>now();
  if active_count>0 then raise exception 'Client has an unexpired booking commitment'; end if;
  insert into public.waitlist_entries(first_name,last_name,email,phone,service,preferred_days,preferred_times,timezone,consent_at) values(btrim(p_payload->>'first_name'),btrim(p_payload->>'last_name'),lower(btrim(p_payload->>'email')),btrim(p_payload->>'phone'),btrim(p_payload->>'service'),coalesce(array(select jsonb_array_elements_text(p_payload->'preferred_days')),'{}'),coalesce(array(select jsonb_array_elements_text(p_payload->'preferred_times')),'{}'),coalesce(nullif(btrim(p_payload->>'timezone'),''),'America/New_York'),now()) returning * into e;
  return to_jsonb(e);
end; $$;
revoke all on function public.signup_waitlist(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.signup_waitlist(jsonb,uuid) to service_role;

create or replace function public.record_booking_attempt_waiver(p_attempt_id uuid,p_resume_token text,p_correlation_id uuid) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; t public.booking_resume_tokens%rowtype;
begin
  select * into t from public.booking_resume_tokens where attempt_id=p_attempt_id and token_hash=encode(extensions.digest(p_resume_token,'sha256'),'hex') and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'Resume token is expired or invalid'; end if;
  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found or a.status in ('completed','expired','withdrawn','unavailable','ineligible') then raise exception 'Booking attempt is not writable'; end if;
  update public.booking_attempts set waiver_completed=true,waiver_completed_at=now(),status='resumed',updated_at=now() where id=a.id returning * into a;
  insert into public.booking_attempt_audit(attempt_id,action,previous_state,new_state,correlation_id) values(a.id,'waiver_completed',jsonb_build_object('waiver_completed',false),jsonb_build_object('waiver_completed',true),p_correlation_id);
  return to_jsonb(a);
end; $$;
revoke all on function public.record_booking_attempt_waiver(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_booking_attempt_waiver(uuid,text,uuid) to service_role;

create or replace function public.record_attempt_payment_and_finalize(p_attempt_id uuid,p_checkout_id text,p_payment_intent text,p_amount numeric,p_correlation_id uuid) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare a public.booking_attempts%rowtype; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('attempt-payment:'||p_attempt_id::text,0));
  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Booking attempt not found'; end if;
  if a.status='completed' then return jsonb_build_object('duplicate',true,'attempt',to_jsonb(a)); end if;
  if p_amount is null or p_amount<>a.payment_amount then raise exception 'Payment amount does not match booking attempt'; end if;
  update public.booking_attempts set payment_status='paid',payment_reference=coalesce(p_payment_intent,p_checkout_id),stripe_checkout_session_id=p_checkout_id,stripe_payment_intent_id=p_payment_intent,updated_at=now() where id=a.id returning * into a;
  result:=public.finalize_booking_attempt(a.id,'paid','stripe-attempt:'||a.id::text,p_correlation_id);
  return result;
end; $$;
revoke all on function public.record_attempt_payment_and_finalize(uuid,text,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.record_attempt_payment_and_finalize(uuid,text,text,numeric,uuid) to service_role;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='booking_attempt_waitlist_offer_fk') then
    alter table public.booking_attempts add constraint booking_attempt_waitlist_offer_fk foreign key (waitlist_offer_id) references public.waitlist_offers(id) on delete set null;
  end if;
end $$;

create or replace function public.match_waitlist_and_offer(p_slot_id uuid,p_service text,p_wave integer,p_correlation_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare e public.waitlist_entries%rowtype; o public.waitlist_offers%rowtype; raw_token text; out_rows jsonb:='[]'::jsonb; cap integer;
begin
  if p_wave not in (1,2) or p_slot_id is null or nullif(btrim(p_service),'') is null then raise exception 'Offer context is invalid'; end if;
  cap:=case when p_wave=1 then 3 else 2 end;
  for e in select w.* from public.waitlist_entries w where w.status='waiting' and w.expires_at>now() and lower(w.service)=lower(p_service) and not exists(select 1 from public.sessions s where lower(coalesce(s.client_email,''))=lower(w.email) and coalesce(s.status,'pending') not in ('cancelled','completed','expired','no_show')) and not exists(select 1 from public.booking_attempts a where lower(coalesce(a.client_email,''))=lower(w.email) and a.status in ('incomplete','resumed') and a.expires_at>now()) order by w.joined_at asc limit cap loop
    raw_token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into public.waitlist_offers(waitlist_entry_id,wave,slot_id,token_hash,correlation_id) values(e.id,p_wave,p_slot_id,encode(extensions.digest(raw_token,'sha256'),'hex'),p_correlation_id) returning * into o;
    update public.waitlist_entries set status='offered',updated_at=now() where id=e.id;
    out_rows:=out_rows||jsonb_build_array(jsonb_build_object('offer',to_jsonb(o),'offer_token',raw_token));
  end loop;
  return out_rows;
end; $$;
revoke all on function public.match_waitlist_and_offer(uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.match_waitlist_and_offer(uuid,text,integer,uuid) to service_role;

create or replace function public.accept_waitlist_offer(p_offer_token text,p_attempt_id uuid,p_correlation_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare o public.waitlist_offers%rowtype; r public.appointment_slot_reservations%rowtype; a public.booking_attempts%rowtype;
begin
  select * into o from public.waitlist_offers where token_hash=encode(extensions.digest(p_offer_token,'sha256'),'hex') for update;
  if not found or (o.status not in ('offered','accepted')) or o.expires_at<=now() then raise exception 'Waitlist offer is expired or unavailable'; end if;
  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found or a.status not in ('incomplete','resumed') then raise exception 'Booking attempt is not eligible for a waitlist hold'; end if;
  if o.status='accepted' then select * into r from public.appointment_slot_reservations where waitlist_offer_id=o.id and attempt_id=a.id order by reserved_at desc limit 1; if found then return jsonb_build_object('offer',to_jsonb(o),'reservation',to_jsonb(r),'attempt',to_jsonb(a),'duplicate',true); end if; raise exception 'Waitlist offer has already been claimed'; end if;
  insert into public.appointment_slot_reservations(slot_id,attempt_id,waitlist_offer_id,expires_at,correlation_id) values(o.slot_id,a.id,o.id,now()+interval '10 minutes',p_correlation_id) returning * into r;
  update public.availability_slots set status='booked',session_id=null where id=o.slot_id and status='available';
  update public.waitlist_offers set status='accepted',accepted_at=now() where id=o.id;
  update public.waitlist_entries set status='held',updated_at=now() where id=o.waitlist_entry_id;
  update public.booking_attempts set waitlist_offer_id=o.id,slot_id=o.slot_id,service=(select service from public.waitlist_entries where id=o.waitlist_entry_id),session_date=(select slot_date from public.availability_slots where id=o.slot_id),session_time=(select slot_time from public.availability_slots where id=o.slot_id),expires_at=now()+interval '10 minutes',updated_at=now() where id=a.id returning * into a;
  return jsonb_build_object('offer',to_jsonb(o),'reservation',to_jsonb(r),'attempt',to_jsonb(a));
end; $$;
revoke all on function public.accept_waitlist_offer(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_waitlist_offer(text,uuid,uuid) to service_role;

create or replace function public.inspect_waitlist_offer(p_offer_token text) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare o public.waitlist_offers%rowtype; e public.waitlist_entries%rowtype; s public.availability_slots%rowtype;
begin
  select * into o from public.waitlist_offers where token_hash=encode(extensions.digest(p_offer_token,'sha256'),'hex');
  if not found or o.status<>'offered' or o.expires_at<=now() then raise exception 'Waitlist offer is expired or unavailable'; end if;
  select * into e from public.waitlist_entries where id=o.waitlist_entry_id;
  select * into s from public.availability_slots where id=o.slot_id and status in ('available','booked') and session_id is null;
  if not found then raise exception 'The offered slot is no longer available'; end if;
  return jsonb_build_object('offer_id',o.id,'slot_id',o.slot_id,'service',e.service,'expires_at',o.expires_at,'first_name',e.first_name,'last_name',e.last_name,'email',e.email,'phone',e.phone,'slot_date',s.slot_date,'slot_time',s.slot_time);
end; $$;
revoke all on function public.inspect_waitlist_offer(text) from public,anon,authenticated;
grant execute on function public.inspect_waitlist_offer(text) to service_role;
