-- ============================================================
-- Royal Energy Alchemy - Reschedule Workflow Columns
-- Reschedule & Schedule Management Sprint
-- Run in Supabase SQL Editor
-- ============================================================

BEGIN;

-- Add reschedule tracking columns to sessions table
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS reschedule_count      integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reschedule_reason     text,
  ADD COLUMN IF NOT EXISTS last_rescheduled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_rescheduled_by   text;

-- Index for reporting on rescheduled sessions
CREATE INDEX IF NOT EXISTS idx_sessions_rescheduled
  ON sessions (last_rescheduled_at)
  WHERE last_rescheduled_at IS NOT NULL;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN (
    'reschedule_count','reschedule_reason',
    'last_rescheduled_at','last_rescheduled_by'
  )
ORDER BY column_name;

-- Expected: 4 rows
