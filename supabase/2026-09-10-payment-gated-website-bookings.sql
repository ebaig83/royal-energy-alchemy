-- Additive, transactional migration. Existing rows are preserved.
begin;
alter table sessions add column if not exists payment_hold_expires_at timestamptz;
create index if not exists sessions_payment_hold_expiry_idx on sessions(payment_hold_expires_at) where payment_hold_expires_at is not null and payment_status <> 'paid';
create index if not exists availability_slots_session_id_idx on availability_slots(session_id) where session_id is not null;
commit;
