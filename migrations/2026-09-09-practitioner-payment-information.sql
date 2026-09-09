begin;

-- Appointment-level payment metadata only. Raw card, bank, PIN and CVV data
-- must never be stored here. Stripe remains authoritative for Stripe payments.
alter table public.sessions
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists payment_note text,
  add column if not exists payment_source text not null default 'none';

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_status%'
  loop
    execute format('alter table public.sessions drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table public.sessions
  add constraint sessions_payment_status_check
  check (payment_status in ('unpaid','pending','partial','paid','refunded','waived','complimentary'));

alter table public.sessions
  add constraint sessions_payment_source_check
  check (payment_source in ('none','manual_off_platform','stripe','complimentary'));

create index if not exists idx_sessions_payment_source
  on public.sessions (payment_source);

commit;
