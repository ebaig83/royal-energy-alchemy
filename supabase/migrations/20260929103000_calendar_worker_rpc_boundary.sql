begin;

-- PostgREST cannot disambiguate the historical text and UUID overloads of
-- trusted_session_update_with_audit from a JSON RPC payload. Keep both
-- compatibility overloads intact and expose a unique UUID boundary for the
-- Calendar worker only.
create or replace function public.trusted_session_update_with_audit_calendar(
 p_id uuid, p_updates jsonb, p_actor_type text, p_actor_id text,
 p_actor_email text, p_source text, p_action text,
 p_correlation_id uuid, p_request_path text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
 return public.trusted_session_update_with_audit(
   p_id, p_updates, p_actor_type, p_actor_id, p_actor_email,
   p_source, p_action, p_correlation_id, p_request_path
 );
end;
$function$;

revoke all on function public.trusted_session_update_with_audit_calendar(uuid,jsonb,text,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.trusted_session_update_with_audit_calendar(uuid,jsonb,text,text,text,text,text,uuid,text)
  to service_role;

commit;
