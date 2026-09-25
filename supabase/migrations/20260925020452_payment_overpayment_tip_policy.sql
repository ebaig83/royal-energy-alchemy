begin;

alter table public.sessions add column if not exists correlation_id uuid;

-- Keep the full receipt while separating service revenue, tip revenue, and
-- customer credit. Existing receipts remain unclassified (zero tip/credit).
alter table public.payments
  add column if not exists tip_amount numeric(12,2) not null default 0,
  add column if not exists client_credit_amount numeric(12,2) not null default 0,
  add column if not exists excess_allocation text;

alter table public.ledger_entries
  add column if not exists tip_amount numeric(12,2) not null default 0,
  add column if not exists client_credit_amount numeric(12,2) not null default 0,
  add column if not exists excess_allocation text;

update public.payments set excess_allocation=case when tip_amount>0 then 'tip' when client_credit_amount>0 then 'client_credit' else null end where excess_allocation is null;
update public.ledger_entries set excess_allocation=case when tip_amount>0 then 'tip' when client_credit_amount>0 then 'client_credit' else null end where excess_allocation is null;

do $constraints$
begin
 if not exists (select 1 from pg_constraint where conrelid='public.payments'::regclass and conname='payments_tip_credit_within_amount') then
  alter table public.payments add constraint payments_tip_credit_within_amount
   check (tip_amount>=0 and client_credit_amount>=0 and tip_amount+client_credit_amount<=amount);
 end if;
 if not exists (select 1 from pg_constraint where conrelid='public.ledger_entries'::regclass and conname='ledger_tip_credit_within_amount') then
  alter table public.ledger_entries add constraint ledger_tip_credit_within_amount
   check (tip_amount>=0 and client_credit_amount>=0 and tip_amount+client_credit_amount<=amount);
 end if;
end;$constraints$;

do $allocation_constraints$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.payments'::regclass and conname='payments_excess_allocation_valid') then
  alter table public.payments add constraint payments_excess_allocation_valid check ((excess_allocation is null and tip_amount=0 and client_credit_amount=0) or (excess_allocation='tip' and tip_amount>0 and client_credit_amount=0) or (excess_allocation='client_credit' and client_credit_amount>0 and tip_amount=0));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.ledger_entries'::regclass and conname='ledger_excess_allocation_valid') then
  alter table public.ledger_entries add constraint ledger_excess_allocation_valid check ((excess_allocation is null and tip_amount=0 and client_credit_amount=0) or (excess_allocation='tip' and tip_amount>0 and client_credit_amount=0) or (excess_allocation='client_credit' and client_credit_amount>0 and tip_amount=0));
 end if;
end;$allocation_constraints$;

create or replace function public.allocate_payment_excess(
  p_amount numeric, p_service_amount numeric, p_memo text, p_excess_allocation text default null
) returns jsonb
language plpgsql immutable security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare received numeric(12,2); service numeric(12,2); excess numeric(12,2); tip numeric(12,2); client_credit numeric(12,2);
begin
 if p_amount is null or p_amount<0 or p_service_amount is null or p_service_amount<0 or p_service_amount>p_amount then
  raise exception 'Invalid payment allocation';
 end if;
 received:=round(p_amount,2); service:=round(p_service_amount,2); excess:=received-service;
 tip:=0; client_credit:=0;
 if p_excess_allocation is not null and p_excess_allocation not in ('tip','client_credit') then raise exception 'Invalid excess allocation'; end if;
 if excess>0 then
  if p_excess_allocation is not null then
   if p_excess_allocation='client_credit' then client_credit:=excess; else tip:=excess; end if;
  elsif lower(coalesce(p_memo,'')) ~ '(not|no|never|do not|don.t)[[:space:][:alpha:]]{0,24}(client|future)[[:space:]-]+credit' then
   tip:=excess;
  elsif lower(coalesce(p_memo,'')) ~ '(^|[^[:alpha:]])(client[[:space:]-]+credit|future[[:space:]-]+credit)([^[:alpha:]]|$)' then
   client_credit:=excess;
  else
   tip:=excess;
  end if;
 end if;
 return jsonb_build_object('amount',received,'service_amount',service,'tip_amount',tip,'client_credit_amount',client_credit,'excess_allocation',case when excess=0 then null when tip>0 then 'tip' else 'client_credit' end);
end;$function$;
revoke all on function public.allocate_payment_excess(numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.allocate_payment_excess(numeric,numeric,text,text) to service_role;
do $retire_legacy_allocation$
begin
 if to_regprocedure('public.allocate_payment_excess(numeric,numeric,text)') is not null then
  revoke all on function public.allocate_payment_excess(numeric,numeric,text) from public,anon,authenticated,service_role;
 end if;
end;
$retire_legacy_allocation$;

-- A linked manual receipt retains gross amount, applies only the service due
-- to the session, and classifies excess using an explicit client-credit memo.
create or replace function public.practitioner_record_manual_payment_with_audit(
 p_session_id uuid,p_payment jsonb,p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare s public.sessions%rowtype; pay public.payments%rowtype; gross numeric(12,2); service_amount numeric(12,2); next_total numeric(12,2); next_status text; next_calendar text; prior jsonb; prior_audit public.payment_mutation_audit%rowtype; allocation jsonb;
begin
 if p_payment is null or jsonb_typeof(p_payment)<>'object' or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and trusted correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 gross:=round(coalesce(nullif(p_payment->>'amount','')::numeric,0),2);
 if gross<=0 then raise exception 'Payment amount must be positive'; end if;
 if lower(coalesce(p_payment->>'method','cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if coalesce(p_payment->>'status','received')<>'received' then raise exception 'Manual session payments must represent received funds'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id::text for update;
 if found then
  if prior_audit.action<>'manual_payment_recorded' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.source<>'dashboard' or prior_audit.session_id is distinct from p_session_id then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=prior_audit.payment_id;
  select * into s from public.sessions where id=p_session_id;
  if pay.id is null or s.id is null then raise exception 'Previously recorded payment state is incomplete'; end if;
  if pay.amount is distinct from gross or pay.method is distinct from coalesce(nullif(p_payment->>'method',''),'cash_app') or pay.reference_id is distinct from nullif(p_payment->>'reference_id','') then raise exception 'Payment idempotency key was reused with different payment details'; end if;
  return jsonb_build_object('payment',to_jsonb(pay),'session',to_jsonb(s),'correlation_id',p_correlation_id,'duplicate',true);
 end if;
 select * into s from public.sessions where id=p_session_id for update;
 if not found then raise exception 'Session not found'; end if;
 if lower(coalesce(s.source,'')) in ('online','website','website_booking','website booking','website_form','booking') then raise exception 'Website bookings require verified Stripe processing'; end if;
 service_amount:=least(gross,greatest(round(coalesce(s.amount_due,0)-coalesce(s.amount_paid,0),2),0));
 if p_payment ? 'service_amount' then
  if coalesce(nullif(p_payment->>'service_amount','')::numeric,-1)<0 or (p_payment->>'service_amount')::numeric>service_amount then raise exception 'Service allocation exceeds the outstanding session amount'; end if;
  service_amount:=round((p_payment->>'service_amount')::numeric,2);
 end if;
 allocation:=public.allocate_payment_excess(gross,service_amount,p_payment->>'notes',nullif(p_payment->>'excess_allocation',''));
 prior:=jsonb_build_object('status',s.status,'payment_status',s.payment_status,'amount_paid',s.amount_paid,'booking_status',s.booking_status,'google_calendar_status',s.google_calendar_status);
 next_total:=coalesce(s.amount_paid,0)+service_amount;
 next_status:=case when coalesce(s.amount_due,0)>0 and next_total>=s.amount_due then 'paid' when next_total>0 then 'partial' else 'unpaid' end;
 next_calendar:=case when next_status='paid' and s.status='confirmed' and s.google_calendar_status='not_requested' and s.source in ('manual','manual_practitioner','manual_practitioner_calendar') then 'pending' else s.google_calendar_status end;
 insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source,tip_amount,client_credit_amount,excess_allocation)
 values(s.id,s.client_id,coalesce(nullif(p_payment->>'client_name',''),s.client_name),gross,coalesce(nullif(p_payment->>'method',''),'cash_app'),nullif(p_payment->>'reference_id',''),coalesce(nullif(p_payment->>'status',''),'received'),nullif(p_payment->>'notes',''),coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),p_correlation_id::text,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',(allocation->>'tip_amount')::numeric,(allocation->>'client_credit_amount')::numeric,allocation->>'excess_allocation') returning * into pay;
 update public.sessions set amount_paid=next_total,payment_status=next_status,payment_method=pay.method,payment_reference=pay.reference_id,payment_note=pay.notes,payment_source='manual_off_platform',google_calendar_status=next_calendar,correlation_id=p_correlation_id,updated_at=now() where id=s.id returning * into s;
 insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_recorded',prior,jsonb_build_object('status',s.status,'payment_status',s.payment_status,'amount_paid',s.amount_paid,'booking_status',s.booking_status,'google_calendar_status',s.google_calendar_status),p_correlation_id::text,p_request_path);
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_recorded',null,to_jsonb(pay),p_correlation_id::text,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'session',to_jsonb(s),'correlation_id',p_correlation_id,'allocation',allocation);
end;$function$;
revoke all on function public.practitioner_record_manual_payment_with_audit(uuid,jsonb,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_record_manual_payment_with_audit(uuid,jsonb,text,text,uuid,text) to service_role;

create or replace function public.practitioner_create_standalone_payment_with_audit(
 p_payment jsonb,p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare pay public.payments%rowtype; prior_audit public.payment_mutation_audit%rowtype;
begin
 if p_payment is null or jsonb_typeof(p_payment)<>'object' or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and trusted correlation metadata are required'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if nullif(p_payment->>'session_id','') is not null then raise exception 'Standalone payment cannot reference a session'; end if;
 if lower(coalesce(p_payment->>'method','cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if coalesce(nullif(p_payment->>'amount','')::numeric,0)<=0 then raise exception 'Payment amount must be positive'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id::text,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id::text for update;
 if found then
  if prior_audit.action<>'standalone_payment_recorded' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.source<>'dashboard' then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=prior_audit.payment_id;
  if pay.id is null then raise exception 'Previously recorded standalone payment is missing'; end if;
  if pay.amount is distinct from (p_payment->>'amount')::numeric or pay.method is distinct from coalesce(nullif(p_payment->>'method',''),'cash_app') or pay.client_id is distinct from nullif(p_payment->>'client_id','')::uuid then raise exception 'Payment idempotency key was reused with different payment details'; end if;
  return jsonb_build_object('payment',to_jsonb(pay),'correlation_id',p_correlation_id,'duplicate',true);
 end if;
 insert into public.payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at,correlation_id,actor_type,actor_id,actor_email,source,tip_amount,client_credit_amount,excess_allocation)
 values(null,nullif(p_payment->>'client_id','')::uuid,nullif(p_payment->>'client_name',''),(p_payment->>'amount')::numeric,coalesce(nullif(p_payment->>'method',''),'cash_app'),nullif(p_payment->>'reference_id',''),coalesce(nullif(p_payment->>'status',''),'received'),nullif(p_payment->>'notes',''),coalesce(nullif(p_payment->>'paid_at','')::timestamptz,now()),p_correlation_id::text,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',0,0,null) returning * into pay;
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,null,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','standalone_payment_recorded',null,to_jsonb(pay),p_correlation_id::text,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'correlation_id',p_correlation_id,'duplicate',false);
end;$function$;
revoke all on function public.practitioner_create_standalone_payment_with_audit(jsonb,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_create_standalone_payment_with_audit(jsonb,text,text,uuid,text) to service_role;

-- Invoice payments preserve the whole received amount, but only the remaining
-- service balance affects invoice status and receivable balance.
create or replace function public.practitioner_record_financial_payment_with_audit(
 p_client_id uuid,p_client_name text,p_session_id uuid,p_invoice_id uuid,p_payment_id uuid,
 p_amount numeric,p_method text,p_description text,p_entry_date date,p_notes text,
 p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text,p_excess_allocation text default null
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare prior public.financial_ledger_audit%rowtype; e public.ledger_entries%rowtype; inv public.invoices%rowtype; s public.sessions%rowtype; pay_result jsonb; pay_id uuid; old_invoice jsonb; request_data jsonb; received numeric(12,2); service_amount numeric(12,2); allocation jsonb; applied numeric(12,2); next_status text;
begin
 if p_client_id is null or p_amount is null or p_amount<=0 or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment and correlation metadata are required'; end if;
 if lower(coalesce(p_method,'cash_app'))='stripe' then raise exception 'Stripe payments require verified webhook processing'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 received:=round(p_amount,2);
 request_data:=jsonb_build_object('client_id',p_client_id,'client_name',p_client_name,'session_id',p_session_id,'invoice_id',p_invoice_id,'payment_id',p_payment_id,'amount',received,'method',coalesce(p_method,'cash_app'),'description',coalesce(p_description,'Payment received'),'entry_date',p_entry_date,'notes',p_notes);
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
 service_amount:=received;
 if p_invoice_id is not null then
  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found or inv.client_id is distinct from p_client_id or inv.status='cancelled' then raise exception 'Invoice is missing, cancelled, or belongs to another client'; end if;
  old_invoice:=to_jsonb(inv);
  service_amount:=least(service_amount,greatest(round(coalesce(inv.total,0)-coalesce(inv.amount_paid,0),2),0));
 end if;
 if p_session_id is not null then
  select * into s from public.sessions where id=p_session_id for update;
  if not found or s.client_id is distinct from p_client_id then raise exception 'Session is missing or belongs to another client'; end if;
  service_amount:=least(service_amount,greatest(round(coalesce(s.amount_due,0)-coalesce(s.amount_paid,0),2),0));
  pay_result:=public.practitioner_record_manual_payment_with_audit(p_session_id,
   jsonb_build_object('amount',received,'service_amount',service_amount,'method',coalesce(p_method,'cash_app'),'reference_id',null,'status','received','notes',p_notes,'client_name',coalesce(p_client_name,s.client_name),'paid_at',now(),'excess_allocation',p_excess_allocation),
   p_actor_id,p_actor_email,p_correlation_id,p_request_path);
  pay_id:=nullif(pay_result->'payment'->>'id','')::uuid;
  select * into s from jsonb_populate_record(null::public.sessions,pay_result->'session');
 end if;
 allocation:=public.allocate_payment_excess(received,service_amount,p_notes,p_excess_allocation);
 insert into public.ledger_entries(client_id,client_name,entry_type,description,amount,balance_impact,related_session_id,related_payment_id,invoice_id,entry_date,notes,created_by,correlation_id,actor_type,actor_id,actor_email,source,tip_amount,client_credit_amount,excess_allocation)
 values(p_client_id,p_client_name,'payment',coalesce(nullif(p_description,''),'Payment received'),received,-service_amount,p_session_id,coalesce(pay_id,p_payment_id),p_invoice_id,coalesce(p_entry_date,current_date),p_notes,lower(btrim(p_actor_email)),p_correlation_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard',(allocation->>'tip_amount')::numeric,(allocation->>'client_credit_amount')::numeric,allocation->>'excess_allocation') returning * into e;
 if p_invoice_id is not null then
  applied:=coalesce(inv.amount_paid,0)+service_amount;
  next_status:=case when inv.total>0 and applied>=inv.total then 'paid' when applied>0 then 'partial' else inv.status end;
  update public.invoices set amount_paid=applied,status=next_status,paid_at=case when next_status='paid' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=inv.id returning * into inv;
 end if;
 insert into public.financial_ledger_audit(ledger_entry_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,request_payload,correlation_id,request_path)
 values(e.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','financial_payment_recorded',old_invoice,jsonb_build_object('entry',to_jsonb(e),'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'session',case when s.id is not null then to_jsonb(s) else null end,'allocation',allocation),request_data,p_correlation_id,p_request_path);
 return jsonb_build_object('entry',to_jsonb(e),'payment',pay_result->'payment','session',case when s.id is not null then to_jsonb(s) else null end,'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'allocation',allocation,'duplicate',false,'correlation_id',p_correlation_id);
end;$function$;
revoke all on function public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text,text) to service_role;

-- Editing a linked receipt must recalculate service allocation rather than
-- treating gross receipts (including tips/credits) as session amount paid.
create or replace function public.practitioner_update_payment_with_audit(
 p_payment_id uuid,p_updates jsonb,p_actor_id text,p_actor_email text,p_correlation_id uuid,p_request_path text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
declare pay public.payments%rowtype; prior_audit public.payment_mutation_audit%rowtype; s public.sessions%rowtype; inv public.invoices%rowtype;
 old_session jsonb; old_payment_state jsonb; old_invoice jsonb; new_total numeric(12,2); other_service numeric(12,2); invoice_paid numeric(12,2); v_invoice_id uuid; ledger_id uuid;
 service_amount numeric(12,2); gross numeric(12,2); new_status text; new_calendar text; allocation jsonb;
begin
 if p_payment_id is null or p_updates is null or jsonb_typeof(p_updates)<>'object' or p_updates='{}'::jsonb or p_correlation_id is null or nullif(btrim(p_request_path),'') is null then raise exception 'Payment updates and trusted correlation metadata are required'; end if;
 if exists(select 1 from jsonb_object_keys(p_updates) k where k not in ('amount','method','reference_id','status','notes','paid_at','excess_allocation')) then raise exception 'Unsupported payment field'; end if;
 if p_updates ? 'excess_allocation' and p_updates->>'excess_allocation' not in ('tip','client_credit') then raise exception 'Invalid excess allocation'; end if;
 if not exists(select 1 from public.practitioner_users pu where pu.id::text=p_actor_id and lower(pu.email)=lower(btrim(p_actor_email)) and pu.active=true) then raise exception 'Practitioner actor is not active'; end if;
 if lower(coalesce(p_updates->>'method',''))='stripe' then raise exception 'Stripe payments cannot be edited manually'; end if;
 if p_updates ? 'amount' and coalesce(nullif(p_updates->>'amount','')::numeric,0)<=0 then raise exception 'Payment amount must be positive'; end if;
 perform pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0));
 select * into prior_audit from public.payment_mutation_audit where correlation_id=p_correlation_id::text for update;
 if found then
  if prior_audit.action<>'payment_updated' or prior_audit.actor_id is distinct from p_actor_id or prior_audit.payment_id is distinct from p_payment_id then raise exception 'Payment idempotency key belongs to another mutation'; end if;
  select * into pay from public.payments where id=p_payment_id;
  if pay.id is null then raise exception 'Previously updated payment is missing'; end if;
  if (p_updates ? 'amount' and pay.amount is distinct from nullif(p_updates->>'amount','')::numeric)
   or (p_updates ? 'method' and pay.method is distinct from p_updates->>'method')
   or (p_updates ? 'reference_id' and pay.reference_id is distinct from nullif(p_updates->>'reference_id',''))
   or (p_updates ? 'status' and pay.status is distinct from p_updates->>'status')
   or (p_updates ? 'notes' and pay.notes is distinct from nullif(p_updates->>'notes',''))
   or (p_updates ? 'paid_at' and pay.paid_at is distinct from nullif(p_updates->>'paid_at','')::timestamptz)
   or (p_updates ? 'excess_allocation' and pay.excess_allocation is distinct from p_updates->>'excess_allocation') then raise exception 'Payment idempotency key was reused with different updates'; end if;
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
 select le.id,le.invoice_id into ledger_id,v_invoice_id from public.ledger_entries le where le.related_payment_id=pay.id and le.entry_type='payment' order by le.created_at limit 1 for update;
 if v_invoice_id is not null then
  select * into inv from public.invoices where id=v_invoice_id for update;
  if not found then raise exception 'Linked invoice not found'; end if;
  old_invoice:=to_jsonb(inv);
 end if;
 gross:=round(coalesce(nullif(p_updates->>'amount','')::numeric,pay.amount),2);
 update public.payments set amount=gross,
  method=coalesce(nullif(p_updates->>'method',''),method),
  reference_id=case when p_updates ? 'reference_id' then nullif(p_updates->>'reference_id','') else reference_id end,
  status=coalesce(nullif(p_updates->>'status',''),status),
  notes=case when p_updates ? 'notes' then nullif(p_updates->>'notes','') else notes end,
  paid_at=coalesce(nullif(p_updates->>'paid_at','')::timestamptz,paid_at),
  correlation_id=p_correlation_id::text,actor_type='practitioner',actor_id=p_actor_id,actor_email=lower(btrim(p_actor_email)),source='dashboard'
 where id=p_payment_id returning * into pay;
 if pay.session_id is not null then
  select coalesce(sum(greatest(0,p.amount-coalesce(p.tip_amount,0)-coalesce(p.client_credit_amount,0))),0)
   into other_service from public.payments p where p.session_id=pay.session_id and p.id<>pay.id and p.status='received';
  service_amount:=case when pay.status='received' then least(gross,greatest(round(coalesce(s.amount_due,0)-other_service,2),0)) else 0 end;
 else
  service_amount:=gross;
 end if;
 if v_invoice_id is not null then
  select coalesce(sum(greatest(0,-le.balance_impact)),0) into other_service from public.ledger_entries le where le.invoice_id=v_invoice_id and le.entry_type='payment' and le.related_payment_id is distinct from pay.id and le.deleted_at is null;
  service_amount:=case when pay.status='received' then least(service_amount,greatest(round(coalesce(inv.total,0)-other_service,2),0)) else 0 end;
 end if;
 allocation:=public.allocate_payment_excess(gross,service_amount,pay.notes,coalesce(nullif(p_updates->>'excess_allocation',''),pay.excess_allocation));
 update public.payments set tip_amount=(allocation->>'tip_amount')::numeric,client_credit_amount=(allocation->>'client_credit_amount')::numeric,excess_allocation=allocation->>'excess_allocation' where id=pay.id returning * into pay;
 if pay.session_id is not null then
  new_total:=other_service+service_amount;
  select coalesce(sum(greatest(0,p.amount-coalesce(p.tip_amount,0)-coalesce(p.client_credit_amount,0))),0) into other_service from public.payments p where p.session_id=pay.session_id and p.id<>pay.id and p.status='received';
  new_total:=other_service+service_amount;
  new_status:=case when coalesce(s.amount_due,0)>0 and new_total>=s.amount_due then 'paid' when new_total>0 then 'partial' else 'unpaid' end;
  new_calendar:=case when new_status='paid' and s.status='confirmed' and s.google_calendar_status='not_requested' then 'pending'
    when new_status<>'paid' and s.google_calendar_event_id is not null then 'cancel_pending'
    when new_status<>'paid' then 'not_requested' else s.google_calendar_status end;
  update public.sessions set amount_paid=new_total,payment_status=new_status,payment_method=pay.method,payment_reference=pay.reference_id,payment_note=pay.notes,payment_source='manual_off_platform',google_calendar_status=new_calendar,google_calendar_error=null,correlation_id=p_correlation_id,updated_at=now()
   where id=pay.session_id returning * into s;
 end if;
 if ledger_id is not null then
  update public.ledger_entries set amount=pay.amount,balance_impact=-service_amount,tip_amount=pay.tip_amount,
   client_credit_amount=pay.client_credit_amount,excess_allocation=pay.excess_allocation,notes=pay.notes,correlation_id=p_correlation_id,
   actor_type='practitioner',actor_id=p_actor_id,actor_email=lower(btrim(p_actor_email)),source='dashboard'
   where related_payment_id=pay.id and entry_type='payment';
 end if;
 if v_invoice_id is not null then
  select coalesce(sum(greatest(0,-le.balance_impact)),0) into invoice_paid from public.ledger_entries le where le.invoice_id=v_invoice_id and le.entry_type='payment' and le.deleted_at is null;
  update public.invoices set amount_paid=invoice_paid,status=case when total>0 and invoice_paid>=total then 'paid' when invoice_paid>0 then 'partial' when status in ('paid','partial') then 'sent' else status end,paid_at=case when invoice_paid>=total and total>0 then coalesce(paid_at,now()) else null end,updated_at=now() where id=v_invoice_id returning * into inv;
  insert into public.financial_ledger_audit(ledger_entry_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,request_payload,correlation_id,request_path)
   values(ledger_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','financial_payment_updated',old_invoice,jsonb_build_object('payment',to_jsonb(pay),'invoice',to_jsonb(inv),'session',case when s.id is not null then to_jsonb(s) else null end,'allocation',allocation),p_updates,p_correlation_id,p_request_path);
 end if;
 if pay.session_id is not null then
  insert into public.appointment_action_audit(session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
   values(s.id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','manual_payment_updated',old_session,jsonb_build_object('payment_status',s.payment_status,'amount_paid',s.amount_paid,'google_calendar_status',s.google_calendar_status),p_correlation_id::text,p_request_path);
 end if;
 insert into public.payment_mutation_audit(payment_id,session_id,actor_type,actor_id,actor_email,source,action,previous_state,new_state,correlation_id,request_path)
 values(pay.id,pay.session_id,'practitioner',p_actor_id,lower(btrim(p_actor_email)),'dashboard','payment_updated',jsonb_build_object('payment',old_payment_state,'invoice',old_invoice,'session',old_session),jsonb_build_object('payment',to_jsonb(pay),'invoice',case when inv.id is not null then to_jsonb(inv) else null end,'session',case when s.id is not null then to_jsonb(s) else null end),p_correlation_id::text,p_request_path);
 return jsonb_build_object('payment',to_jsonb(pay),'session',case when pay.session_id is not null then to_jsonb(s) else null end,'correlation_id',p_correlation_id,'duplicate',false);
end;$function$;
revoke all on function public.practitioner_update_payment_with_audit(uuid,jsonb,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.practitioner_update_payment_with_audit(uuid,jsonb,text,text,uuid,text) to service_role;

-- Retire the legacy text-correlation overloads without destructive DDL.
-- They remain cataloged for rollback/auditability but are no longer callable.
do $retire_legacy_payment_rpc$
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
$retire_legacy_payment_rpc$;

-- These records are consumed only by authenticated Netlify server functions
-- using service_role; do not expose them to anon/authenticated PostgREST roles.
do $service_only$
declare t text;
begin
 foreach t in array array['session_outcomes','client_goals','stripe_webhook_events','appointment_notices'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_service_role_only') then
   execute format('create policy %I on public.%I for all to service_role using (true) with check (true)',t||'_service_role_only',t);
  end if;
 end loop;
end;$service_only$;

commit;
