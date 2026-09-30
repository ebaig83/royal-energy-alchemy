-- Allow the Calendar worker to persist the event and Meet fields it already
-- receives from Google. Keep this boundary limited to system Calendar work.
create or replace function public.trusted_session_update_with_audit_calendar(
  p_id uuid,
  p_updates jsonb,
  p_actor_type text,
  p_actor_id text,
  p_actor_email text,
  p_source text,
  p_action text,
  p_correlation_id uuid,
  p_request_path text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  old public.sessions%rowtype;
  changed public.sessions%rowtype;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'object'
     or p_actor_type <> 'system'
     or p_actor_id <> 'session-calendar-sync'
     or p_source <> 'calendar-worker'
     or p_action not in ('calendar_sync_completed', 'calendar_sync_failed')
     or p_correlation_id is null
     or nullif(btrim(p_request_path), '') is null then
    raise exception 'Invalid internal worker context';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_updates) k where k not in (
      'google_calendar_event_id',
      'google_meet_url',
      'google_calendar_status',
      'google_calendar_error',
      'google_calendar_synced_at',
      'updated_at'
    )
  ) then
    raise exception 'Unsupported Calendar appointment field';
  end if;

  select * into old from public.sessions where id = p_id for update;
  if not found then raise exception 'Session not found'; end if;

  changed := jsonb_populate_record(old, p_updates);
  update public.sessions set
    google_calendar_event_id = changed.google_calendar_event_id,
    google_meet_url = changed.google_meet_url,
    google_calendar_status = changed.google_calendar_status,
    google_calendar_error = changed.google_calendar_error,
    google_calendar_synced_at = changed.google_calendar_synced_at,
    updated_at = coalesce(changed.updated_at, now())
  where id = p_id
  returning * into changed;

  insert into public.appointment_action_audit(
    session_id, actor_type, actor_id, actor_email, source, action,
    previous_state, new_state, correlation_id, request_path
  ) values (
    p_id, p_actor_type, p_actor_id, nullif(lower(btrim(p_actor_email)), ''),
    p_source, p_action,
    jsonb_build_object(
      'google_calendar_status', old.google_calendar_status,
      'google_calendar_event_id', old.google_calendar_event_id,
      'google_meet_url', old.google_meet_url
    ),
    jsonb_build_object(
      'google_calendar_status', changed.google_calendar_status,
      'google_calendar_event_id', changed.google_calendar_event_id,
      'google_meet_url', changed.google_meet_url
    ),
    p_correlation_id::text, p_request_path
  ) on conflict (session_id, correlation_id, action) do nothing;

  return jsonb_build_object(
    'eligible', true,
    'session', to_jsonb(changed),
    'correlation_id', p_correlation_id::text
  );
end;
$function$;

revoke all on function public.trusted_session_update_with_audit_calendar(
  uuid, jsonb, text, text, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.trusted_session_update_with_audit_calendar(
  uuid, jsonb, text, text, text, text, text, uuid, text
) to service_role;
