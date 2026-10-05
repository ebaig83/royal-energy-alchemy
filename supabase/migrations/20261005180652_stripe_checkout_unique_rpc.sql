-- A unique RPC name avoids PostgREST ambiguity between text/UUID overloads.
-- The invoker retains the existing service-role authorization and audited gate.
create or replace function public.save_stripe_checkout_with_audit(p_id uuid, p_checkout_session_id text, p_correlation_id uuid)
returns jsonb language plpgsql security invoker set search_path to pg_catalog, public, pg_temp as $$
begin
 if p_checkout_session_id is null or p_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$' then raise exception 'Invalid Stripe checkout reference'; end if;
 return public.trusted_session_update_with_audit(p_id,
  jsonb_build_object('payment_status','pending','booking_status','payment_pending','stripe_checkout_session_id',p_checkout_session_id,'updated_at',now()),
  'system'::text,'stripe-checkout'::text,null::text,'stripe-checkout'::text,'checkout_session_created'::text,
  p_correlation_id,'/.netlify/functions/create-stripe-checkout'::text);
end; $$;
revoke all on function public.save_stripe_checkout_with_audit(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.save_stripe_checkout_with_audit(uuid,text,uuid) to service_role;
notify pgrst, 'reload schema';
