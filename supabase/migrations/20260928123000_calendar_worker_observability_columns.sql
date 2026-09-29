-- Calendar worker writes sanitized failure/sync markers on sessions.
-- Additive and safe for existing records.
alter table public.sessions add column if not exists google_calendar_error text;
alter table public.sessions add column if not exists google_calendar_synced_at timestamptz;
