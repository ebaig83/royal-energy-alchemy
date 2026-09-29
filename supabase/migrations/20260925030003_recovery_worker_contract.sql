-- Recovery scheduling is bounded to two messages and 48 hours.
create or replace function public.schedule_booking_recovery(p_now timestamptz default now()) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare scheduled jsonb;
begin
  insert into public.booking_recovery_events(attempt_id,reminder_number,recipient_email,scheduled_at)
  select a.id,1,a.client_email,a.abandoned_at+interval '9 hours' from public.booking_attempts a
  where a.status in ('incomplete','resumed') and a.client_email is not null and a.abandoned_at is not null and a.abandoned_at+interval '6 hours'<=p_now and a.abandoned_at+interval '48 hours'>p_now
  on conflict (attempt_id,reminder_number) do nothing;
  insert into public.booking_recovery_events(attempt_id,reminder_number,recipient_email,scheduled_at)
  select a.id,2,a.client_email,a.abandoned_at+interval '33 hours' from public.booking_attempts a
  where a.status in ('incomplete','resumed') and a.client_email is not null and a.abandoned_at is not null and a.abandoned_at+interval '30 hours'<=p_now and a.abandoned_at+interval '48 hours'>p_now
  on conflict (attempt_id,reminder_number) do nothing;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into scheduled from public.booking_recovery_events e where e.status='scheduled' and e.scheduled_at<=p_now;
  return scheduled;
end; $$;
revoke all on function public.schedule_booking_recovery(timestamptz) from public,anon,authenticated;
grant execute on function public.schedule_booking_recovery(timestamptz) to service_role;

create or replace function public.record_booking_recovery_result(p_event_id uuid,p_status text,p_provider_message_id text default null,p_error text default null) returns jsonb language plpgsql security invoker set search_path=pg_catalog, public, pg_temp as $$
declare e public.booking_recovery_events%rowtype;
begin
  if p_status not in ('sent','failed','suppressed','cancelled') then raise exception 'Invalid recovery result'; end if;
  update public.booking_recovery_events set status=p_status,provider_message_id=p_provider_message_id,error_message=p_error,sent_at=case when p_status='sent' then now() else sent_at end where id=p_event_id and status='scheduled' returning * into e;
  if not found then select * into e from public.booking_recovery_events where id=p_event_id; end if;
  if e.id is null then raise exception 'Recovery event not found'; end if;
  if p_status='sent' then update public.booking_attempts set recovery_1_sent_at=case when e.reminder_number=1 then now() else recovery_1_sent_at end,recovery_2_sent_at=case when e.reminder_number=2 then now() else recovery_2_sent_at end where id=e.attempt_id; end if;
  return to_jsonb(e);
end; $$;
revoke all on function public.record_booking_recovery_result(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_booking_recovery_result(uuid,text,text,text) to service_role;
