begin;

-- Safe inbound-payment queue. Raw email bodies are intentionally not stored.
create table if not exists public.payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_reference_id text not null,
  provider_reference_key text generated always as (lower(provider) || ':' || lower(provider_reference_id)) stored,
  payer_display_name text,
  payer_email text,
  payer_phone text,
  amount numeric(8,2) not null,
  transaction_at timestamptz,
  memo text,
  recipient_context text,
  source_message_id text,
  detected_at timestamptz not null default now(),
  status text not null default 'needs_reconciliation',
  confidence text not null default 'none',
  match_reason text,
  candidate_matches jsonb not null default '[]'::jsonb,
  matched_client_id uuid references public.clients(id) on delete set null,
  matched_session_id uuid references public.sessions(id) on delete set null,
  amount_applied numeric(8,2) not null default 0,
  auto_attached boolean not null default false,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_reconciliation_provider_check check (provider in ('venmo','paypal','cash_app','zelle','stripe')),
  constraint payment_reconciliation_amount_check check (amount > 0 and amount <= 100000),
  constraint payment_reconciliation_status_check check (status in ('needs_reconciliation','matched','attached','unrelated','duplicate','error')),
  constraint payment_reconciliation_confidence_check check (confidence in ('none','medium','high')),
  constraint payment_reconciliation_ref_check check (length(trim(provider_reference_id)) between 1 and 240),
  constraint payment_reconciliation_memo_check check (memo is null or length(memo) <= 500),
  constraint payment_reconciliation_unique_key unique (provider_reference_key)
);

create index if not exists payment_reconciliation_status_idx on public.payment_reconciliation_items(status, detected_at desc);
create index if not exists payment_reconciliation_session_idx on public.payment_reconciliation_items(matched_session_id);
create index if not exists payment_reconciliation_email_idx on public.payment_reconciliation_items(lower(payer_email));

alter table public.payment_reconciliation_items
  add column if not exists candidate_matches jsonb not null default '[]'::jsonb;

create table if not exists public.payment_reconciliation_audit (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.payment_reconciliation_items(id) on delete cascade,
  action text not null,
  actor text not null,
  provider text,
  provider_reference_id text,
  matched_client_id uuid references public.clients(id) on delete set null,
  matched_session_id uuid references public.sessions(id) on delete set null,
  match_confidence text,
  match_reason text,
  amount_applied numeric(8,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists payment_reconciliation_audit_item_idx on public.payment_reconciliation_audit(reconciliation_id, created_at desc);

create table if not exists public.payment_reconciliation_checkpoints (
  id uuid primary key default gen_random_uuid(),
  source_name text not null unique,
  cursor text,
  last_success_at timestamptz,
  last_message_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.payment_reconciliation_items enable row level security;
alter table public.payment_reconciliation_audit enable row level security;
alter table public.payment_reconciliation_checkpoints enable row level security;

create or replace function public.payment_reconciliation_attach(
  p_item_id uuid,
  p_session_id uuid,
  p_actor text,
  p_mode text default 'manual'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item payment_reconciliation_items%rowtype;
  target sessions%rowtype;
  existing payments%rowtype;
  remaining numeric(8,2);
  next_paid numeric(8,2);
  next_status text;
  payment_id uuid;
  audit_action text;
begin
  select * into item from payment_reconciliation_items where id = p_item_id for update;
  if not found then raise exception 'reconciliation_item_not_found'; end if;
  if item.status in ('attached','unrelated','duplicate') then
    return jsonb_build_object('idempotent', true, 'status', item.status, 'session_id', item.matched_session_id);
  end if;
  if item.provider = 'stripe' then raise exception 'stripe_email_requires_webhook_authority'; end if;

  select * into target from sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if lower(coalesce(target.status,'')) in ('cancelled','no_show') then raise exception 'session_not_payable'; end if;
  if lower(coalesce(target.stripe_payment_status,'')) = 'paid' or target.stripe_payment_intent_id is not null then
    raise exception 'stripe_state_is_authoritative';
  end if;

  remaining := greatest(0, coalesce(target.amount_due,0) - coalesce(target.amount_paid,0));
  if item.amount > remaining then raise exception 'amount_conflict'; end if;
  select * into existing from payments where lower(coalesce(method,'')) = lower(item.provider) and reference_id = item.provider_reference_id limit 1;
  if found then
    update payment_reconciliation_items set status='duplicate', resolved_at=now(), resolved_by=p_actor, resolution_note='Existing payment reference', updated_at=now() where id=item.id;
    insert into payment_reconciliation_audit(reconciliation_id,action,actor,provider,provider_reference_id,matched_session_id,match_confidence,match_reason) values(item.id,'duplicate',p_actor,item.provider,item.provider_reference_id,p_session_id,item.confidence,'existing payment reference');
    return jsonb_build_object('idempotent', true, 'status', 'duplicate', 'session_id', p_session_id);
  end if;

  insert into payments(session_id,client_id,client_name,amount,method,reference_id,status,notes,paid_at)
    values(target.id,target.client_id,target.client_name,item.amount,item.provider,item.provider_reference_id,'received',item.memo,item.transaction_at) returning id into payment_id;
  next_paid := coalesce(target.amount_paid,0) + item.amount;
  next_status := case when coalesce(target.amount_due,0) > 0 and next_paid >= target.amount_due then 'paid' when next_paid > 0 then 'partial' else 'unpaid' end;
  update sessions set amount_paid=next_paid,payment_status=next_status,payment_method=item.provider,payment_reference=item.provider_reference_id,payment_note=item.memo,payment_source='manual_off_platform' where id=target.id;
  if to_regclass('public.ledger_entries') is not null then
    execute 'insert into public.ledger_entries(client_id,client_name,entry_type,description,amount,balance_impact,related_session_id,related_payment_id,created_by,notes,entry_date) values($1,$2,''payment'',$3,$4,-$4,$5,$6,$7,$8,current_date)'
      using target.client_id,target.client_name,'Imported '||item.provider||' payment',item.amount,target.id,payment_id,p_actor,item.memo;
  end if;
  audit_action := case when p_mode='automatic' then 'auto_attached' else 'attached' end;
  update payment_reconciliation_items set status='attached',matched_client_id=target.client_id,matched_session_id=target.id,amount_applied=item.amount,auto_attached=(p_mode='automatic'),resolved_at=now(),resolved_by=p_actor,updated_at=now() where id=item.id;
  insert into payment_reconciliation_audit(reconciliation_id,action,actor,provider,provider_reference_id,matched_client_id,matched_session_id,match_confidence,match_reason,amount_applied) values(item.id,audit_action,p_actor,item.provider,item.provider_reference_id,target.client_id,target.id,item.confidence,item.match_reason,item.amount);
  return jsonb_build_object('idempotent',false,'status','attached','payment_id',payment_id,'session_id',target.id,'payment_status',next_status,'amount_paid',next_paid);
end;
$$;

revoke all on function public.payment_reconciliation_attach(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.payment_reconciliation_attach(uuid,uuid,text,text) to service_role;
commit;
