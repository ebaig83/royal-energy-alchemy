-- Audited practitioner release for unpaid/incomplete attempts, plus a
-- consistency guard for stale booked slots without an operational session.
create or replace function public.release_booking_attempt(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_request_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog, public, pg_temp
as $$
declare
  a public.booking_attempts%rowtype;
  previous_state jsonb;
  new_state jsonb;
  now_at timestamptz := now();
  released_slots integer := 0;
  cancelled_recovery integer := 0;
begin
  if p_attempt_id is null or p_actor_id is null or p_request_id is null or nullif(trim(coalesce(p_actor_email,'')), '') is null then
    raise exception 'Release request is incomplete';
  end if;

  if not exists (
    select 1 from public.practitioner_users u
    where u.id=p_actor_id and u.active=true
      and lower(u.email)=lower(trim(p_actor_email))
  ) then
    raise exception 'Practitioner is not authorized to release booking attempts';
  end if;

  select * into a from public.booking_attempts where id=p_attempt_id for update;
  if not found then raise exception 'Booking attempt not found'; end if;

  if a.status='completed' or a.payment_status in ('paid','refunded') then
    raise exception 'Confirmed or paid booking attempts cannot be released here';
  end if;

  if a.status in ('withdrawn','abandoned','expired','unavailable','ineligible') then
    return jsonb_build_object('duplicate',true,'attempt_id',a.id,'status',a.status,'payment_status',a.payment_status,'slot_id',a.slot_id,'slot_released',false,'recovery_events_cancelled',0);
  end if;

  previous_state := jsonb_build_object(
    'status',a.status,'payment_status',a.payment_status,'slot_id',a.slot_id,
    'correlation_id',a.correlation_id
  );

  update public.booking_attempts
     set status='withdrawn',
         abandoned_at=coalesce(abandoned_at,now_at),
         withdrawn_at=now_at,
         expires_at=now_at,
         updated_at=now_at
   where id=a.id;

  update public.booking_resume_tokens
     set revoked_at=coalesce(revoked_at,now_at)
   where attempt_id=a.id and revoked_at is null;

  update public.booking_recovery_events
     set status='cancelled',
         error_message=coalesce(error_message,'Cancelled by practitioner release')
   where attempt_id=a.id and status in ('scheduled','queued');
  get diagnostics cancelled_recovery=row_count;

  update public.appointment_slot_reservations
     set status='released',released_at=now_at
   where attempt_id=a.id and status='active';

  if a.slot_id is not null then
    update public.availability_slots s
       set status='available',session_id=null,held_until=null,held_for=null,updated_at=now_at
     where s.id=a.slot_id and s.status='booked' and s.session_id is null
       and not exists (
         select 1 from public.appointment_slot_reservations r
         where r.slot_id=s.id and r.status='active'
           and (r.expires_at is null or r.expires_at>now_at)
       )
       and not exists (
         select 1 from public.booking_attempts other
         where other.slot_id=s.id and other.id<>a.id
           and other.status in ('incomplete','resumed')
           and other.expires_at>now_at
       );
    get diagnostics released_slots=row_count;
  end if;

  new_state := jsonb_build_object(
    'status','withdrawn','payment_status',a.payment_status,'slot_id',a.slot_id,
    'slot_released',released_slots>0,'recovery_events_cancelled',cancelled_recovery,
    'reason',nullif(left(coalesce(p_reason,''),500), '')
  );

  insert into public.booking_attempt_audit(
    attempt_id,action,previous_state,new_state,correlation_id,actor_type,actor_id
  ) values (
    a.id,'attempt_released',previous_state,new_state,p_request_id,'practitioner',p_actor_id::text
  );

  return jsonb_build_object(
    'duplicate',false,'attempt_id',a.id,'status','withdrawn',
    'payment_status',a.payment_status,'slot_id',a.slot_id,
    'slot_released',released_slots>0,'recovery_events_cancelled',cancelled_recovery
  );
end;
$$;

revoke all on function public.release_booking_attempt(uuid,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.release_booking_attempt(uuid,uuid,text,uuid,text) to service_role;

create or replace function public.expire_booking_attempts(p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare
  attempt_count integer := 0;
  reservation_count integer := 0;
  slot_count integer := 0;
begin
  update public.booking_attempts
     set status='expired',updated_at=p_now
   where status in ('incomplete','resumed') and expires_at<=p_now;
  get diagnostics attempt_count=row_count;

  update public.appointment_slot_reservations
     set status='expired',released_at=p_now
   where status='active' and expires_at<=p_now;
  get diagnostics reservation_count=row_count;

  -- A slot is protected by a live reservation, not merely by a historical
  -- attempt row. This releases stale booked+sessionless slots while preserving
  -- legitimate active checkout holds.
  with released as (
    update public.availability_slots s
       set status='available',session_id=null,held_until=null,held_for=null,updated_at=p_now
     where s.status='booked' and s.session_id is null
       and not exists (
         select 1 from public.appointment_slot_reservations r
         where r.slot_id=s.id and r.status='active'
           and (r.expires_at is null or r.expires_at>p_now)
       )
     returning s.id
  )
  insert into public.booking_attempt_audit(
    attempt_id,action,previous_state,new_state,correlation_id,actor_type,actor_id
  )
  select a.id,'stale_slot_released',
    jsonb_build_object('status',a.status,'slot_id',a.slot_id,'slot_status','booked'),
    jsonb_build_object('slot_status','available','reason','booked slot had no live reservation or operational session'),
    extensions.gen_random_uuid(),'system','expire-booking-attempts'
  from released s
  join public.booking_attempts a on a.slot_id=s.id;
  get diagnostics slot_count=row_count;

  update public.waitlist_offers
     set status='expired'
   where status in ('offered','held') and expires_at<=p_now;

  update public.waitlist_entries
     set status='expired'
   where status='waiting' and expires_at<=p_now;

  return jsonb_build_object(
    'expired_attempts',attempt_count,
    'expired_reservations',reservation_count,
    'released_stale_slots',slot_count
  );
end;
$$;

revoke all on function public.expire_booking_attempts(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_booking_attempts(timestamptz) to service_role;
