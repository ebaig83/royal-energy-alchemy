begin;

alter table public.sessions
  add column if not exists payment_hold_expires_at timestamptz;

create index if not exists idx_sessions_unpaid_hold_expiry
  on public.sessions (payment_hold_expires_at)
  where booking_status in ('booking_received', 'payment_pending', 'payment_expired')
    and payment_status in ('pending', 'unpaid');

create or replace function public.expire_unpaid_booking_holds(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_ids uuid[];
  released_count integer := 0;
begin
  with eligible as (
    select s.id
    from public.sessions s
    where s.payment_status in ('pending', 'unpaid')
      and s.booking_status in ('booking_received', 'payment_pending', 'payment_expired')
      and s.payment_hold_expires_at is not null
      and s.payment_hold_expires_at <= p_now
      and s.status in ('pending', 'expired')
      and s.stripe_checkout_session_id is null
      and s.stripe_payment_intent_id is null
      and s.stripe_payment_status is null
      and s.google_calendar_event_id is null
      and s.google_meet_url is null
      and (s.google_calendar_status is null or s.google_calendar_status = 'not_requested')
      and not exists (
        select 1
        from public.stripe_webhook_events e
        where (e.payload->'data'->'object'->'metadata'->>'session_id') = s.id::text
           or (e.payload->'data'->'object'->'metadata'->>'booking_id') = s.id::text
           or (e.payload->'data'->'object'->>'client_reference_id') = s.id::text
      )
  ), newly_expired as (
    update public.sessions
       set booking_status = 'payment_expired', updated_at = p_now
     where id in (select id from eligible)
       and booking_status in ('booking_received', 'payment_pending')
     returning id
  ), expired as (
    select id from newly_expired
    union
    select id from eligible
     where id not in (select id from newly_expired)
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into expired_ids from expired;

  update public.availability_slots
     set status = 'available', session_id = null, held_until = null, held_for = null
   where session_id = any(expired_ids)
     and status in ('booked', 'held');
  get diagnostics released_count = row_count;

  return jsonb_build_object(
    'expired_count', cardinality(expired_ids),
    'released_slot_count', released_count,
    'session_ids', to_jsonb(expired_ids)
  );
end;
$$;

revoke all on function public.expire_unpaid_booking_holds(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_unpaid_booking_holds(timestamptz) to service_role;

insert into public.email_templates (name, subject, html_body, text_body, variables, type, is_active)
values (
  'booking_received_practitioner',
  'Booking received — payment pending — {{client_name}}',
  '<p>A website booking request was received. <strong>Payment has not been completed and the appointment is not confirmed.</strong></p><p>Client: {{client_name}}<br>Email: {{client_email}}<br>Phone: {{client_phone}}<br>Service: {{service}}<br>Requested time: {{session_date}} at {{session_time}} {{timezone}}<br>Amount due: ${{amount_due}}<br>Hold expires: {{payment_hold_expires_at}}<br>Session: {{session_reference}}</p>',
  'Website booking received. Payment has not been completed and the appointment is not confirmed.\n\nClient: {{client_name}}\nEmail: {{client_email}}\nPhone: {{client_phone}}\nService: {{service}}\nRequested time: {{session_date}} at {{session_time}} {{timezone}}\nAmount due: ${{amount_due}}\nHold expires: {{payment_hold_expires_at}}\nSession: {{session_reference}}',
  array['client_name','client_email','client_phone','service','session_date','session_time','timezone','amount_due','payment_hold_expires_at','session_reference'],
  'transactional',
  true
)
on conflict (name) do update set
  subject = excluded.subject,
  html_body = excluded.html_body,
  text_body = excluded.text_body,
  variables = excluded.variables,
  type = excluded.type,
  is_active = excluded.is_active,
  updated_at = now();

commit;
