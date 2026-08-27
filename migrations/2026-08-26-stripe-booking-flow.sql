-- Sprint: Stripe-backed booking completion flow
-- Additive only. Safe to run before deploying the updated booking functions.

alter table public.sessions
  add column if not exists booking_status text default 'booking_received',
  add column if not exists waiver_completed boolean not null default false,
  add column if not exists waiver_completed_at timestamptz,
  add column if not exists payment_paid_at timestamptz,
  add column if not exists payment_currency text default 'usd',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_payment_status text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text,
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists refund_status text,
  add column if not exists refund_updated_at timestamptz;

create index if not exists idx_sessions_booking_status
  on public.sessions (booking_status);

create unique index if not exists uq_sessions_stripe_checkout_session_id
  on public.sessions (stripe_checkout_session_id);

create unique index if not exists uq_sessions_stripe_payment_intent_id
  on public.sessions (stripe_payment_intent_id);

create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text,
  state text not null default 'processing',
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  processing_error text,
  attempt_count integer not null default 1,
  payload jsonb
);

alter table public.stripe_webhook_events
  add column if not exists state text not null default 'processing',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processing_started_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists attempt_count integer not null default 1;

do $$ begin
  alter table public.stripe_webhook_events
    add constraint stripe_webhook_events_state_check
    check (state in ('processing', 'processed', 'failed'));
exception when duplicate_object then null;
end $$;

alter table public.payments
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists refund_status text,
  add column if not exists refunded_at timestamptz,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text;

create unique index if not exists uq_payments_stripe_reference_id
  on public.payments (reference_id)
  where method = 'stripe' and reference_id is not null;

create index if not exists idx_stripe_webhook_events_type
  on public.stripe_webhook_events (type);

create index if not exists idx_stripe_webhook_events_state
  on public.stripe_webhook_events (state, received_at);

-- Optional normalization for new online bookings. Existing historical records
-- remain unchanged except where they already show both payment and waiver done.
update public.sessions
set booking_status = 'ready',
    updated_at = coalesce(updated_at, now())
where payment_status = 'paid'
  and (waiver_completed = true or lower(coalesce(waiver_status, '')) in ('complete', 'completed', 'signed'))
  and coalesce(booking_status, '') <> 'ready';
