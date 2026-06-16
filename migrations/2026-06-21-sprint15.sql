-- ── Sprint 15 Migration ──────────────────────────────────────────────────────
-- Public Booking Flow + Audit Table + Waiver/Intake Tracking + Reminder Guard
-- Run in Supabase SQL Editor

-- ── appointment_management_audit (create if not exists) ───────────────────────
-- Use CREATE TABLE IF NOT EXISTS without client_id first, then ALTER TABLE to
-- add any columns that may be missing if the table already existed from a
-- prior partial run.

CREATE TABLE IF NOT EXISTS appointment_management_audit (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  action         text        NOT NULL,
  old_date       date,
  old_time       time,
  new_date       date,
  new_time       time,
  reason         text,
  refund_percent integer,
  performed_by   text,
  ip_address     text,
  user_agent     text,
  metadata       jsonb,
  created_at     timestamptz DEFAULT now()
);

-- Add columns that may be missing if the table pre-existed
ALTER TABLE appointment_management_audit
  ADD COLUMN IF NOT EXISTS client_id   uuid REFERENCES clients(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reschedule_count integer;

CREATE INDEX IF NOT EXISTS idx_appt_audit_session  ON appointment_management_audit (session_id);
CREATE INDEX IF NOT EXISTS idx_appt_audit_client   ON appointment_management_audit (client_id);
CREATE INDEX IF NOT EXISTS idx_appt_audit_action   ON appointment_management_audit (action);
CREATE INDEX IF NOT EXISTS idx_appt_audit_created  ON appointment_management_audit (created_at DESC);

-- ── Sessions: intake/waiver tracking ─────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS intake_status   text DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS intake_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS waiver_status   text DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS waiver_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_sent   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS source          text DEFAULT 'manual';

-- ── Clients: booking source + phone ──────────────────────────────────────────

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone           text,
  ADD COLUMN IF NOT EXISTS source          text DEFAULT 'manual';

-- ── System failure visibility index ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_system_failure
  ON audit_logs (action, created_at DESC)
  WHERE action = 'system_failure';

-- ── Reminder dedup index on communications ────────────────────────────────────
-- Index on message_type only (btree); metadata is jsonb so use a separate GIN
-- index for containment queries (.contains in Supabase).

CREATE INDEX IF NOT EXISTS idx_comms_message_type
  ON communications (message_type);

CREATE INDEX IF NOT EXISTS idx_comms_metadata_gin
  ON communications USING GIN (metadata);
