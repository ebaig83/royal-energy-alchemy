-- ============================================================
-- Royal Energy Alchemy - Scheduling Rules Engine
-- Calendar Authority Sprint
-- Run in Supabase SQL Editor
-- ============================================================

BEGIN;

-- Expand availability_slots status to include held, past, cancelled
-- Drop existing constraint (if any) and recreate with full set
ALTER TABLE availability_slots DROP CONSTRAINT IF EXISTS availability_slots_status_check;
ALTER TABLE availability_slots
  ADD CONSTRAINT availability_slots_status_check
  CHECK (status IN ('available', 'booked', 'held', 'blocked', 'cancelled', 'past'));

-- Add slot_type column for categorizing slots (if not exists)
ALTER TABLE availability_slots
  ADD COLUMN IF NOT EXISTS slot_type   text DEFAULT 'standard'
    CHECK (slot_type IN ('standard', 'onboarding', 'followup', 'vip')),
  ADD COLUMN IF NOT EXISTS held_until  timestamptz,
  ADD COLUMN IF NOT EXISTS held_for    text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- Index for fast availability queries
CREATE INDEX IF NOT EXISTS idx_slots_date_status ON availability_slots (slot_date, status);
CREATE INDEX IF NOT EXISTS idx_slots_session ON availability_slots (session_id) WHERE session_id IS NOT NULL;

-- Function: automatically mark past slots as 'past' status
-- Run manually or via pg_cron nightly
CREATE OR REPLACE FUNCTION lock_past_slots()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE availability_slots
  SET status = 'past'
  WHERE slot_date < CURRENT_DATE
    AND status = 'available';
END;
$$;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Confirm constraint includes all 6 statuses
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'availability_slots'::regclass
  AND conname = 'availability_slots_status_check';

-- 2. Confirm new columns added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'availability_slots'
  AND column_name IN ('slot_type','held_until','held_for','cancelled_at','cancelled_reason')
ORDER BY column_name;

-- 3. Confirm indexes
SELECT indexname FROM pg_indexes
WHERE tablename = 'availability_slots'
  AND indexname IN ('idx_slots_date_status','idx_slots_session');
