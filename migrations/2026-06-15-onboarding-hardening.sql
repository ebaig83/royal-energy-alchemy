-- ============================================================
-- Royal Energy Alchemy — Onboarding Hardening
-- Post-QA remediation sprint
-- Run in Supabase SQL Editor after 2026-06-14-intake-system.sql
-- ============================================================

BEGIN;

-- ── INTAKES: AI intake call preparation fields ─────────────
ALTER TABLE intakes
  ADD COLUMN IF NOT EXISTS time_zone        text,
  ADD COLUMN IF NOT EXISTS call_consent     boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_consent       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recording_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intake_duration_min integer;  -- target call duration in minutes

-- ── ONBOARDING_PACKAGES: payment tracking ──────────────────
ALTER TABLE onboarding_packages
  ADD COLUMN IF NOT EXISTS payment_status  text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','pending','paid','refunded','waived')),
  ADD COLUMN IF NOT EXISTS amount_due      numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_method  text,
  ADD COLUMN IF NOT EXISTS payment_ref     text,
  ADD COLUMN IF NOT EXISTS paid_at         timestamptz;

-- Index for payment reporting
CREATE INDEX IF NOT EXISTS idx_ob_pkg_payment ON onboarding_packages (payment_status);

-- ── ONBOARDING_PACKAGES: expand package_status ─────────────
-- Allow needs_followup state (drop + recreate constraint)
ALTER TABLE onboarding_packages DROP CONSTRAINT IF EXISTS onboarding_packages_package_status_check;
ALTER TABLE onboarding_packages
  ADD CONSTRAINT onboarding_packages_package_status_check
  CHECK (package_status IN (
    'intake_pending','intake_complete',
    'review_pending','review_complete',
    'session_scheduled','session_complete',
    'aftercare_sent','follow_up_complete',
    'needs_followup',
    'cancelled'
  ));

COMMIT;

-- ============================================================
-- VERIFICATION — run after COMMIT to confirm migration applied
-- ============================================================

-- 1. Column presence + types
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('intakes', 'onboarding_packages')
  AND column_name IN (
    'time_zone',
    'call_consent',
    'ai_consent',
    'recording_consent',
    'intake_duration_min',
    'payment_status',
    'amount_due',
    'payment_method',
    'payment_ref',
    'paid_at'
  )
ORDER BY table_name, column_name;

-- Expected: 10 rows
-- intakes      → ai_consent, call_consent, intake_duration_min, recording_consent, time_zone
-- onboarding_packages → amount_due, paid_at, payment_method, payment_ref, payment_status

-- 2. Package status constraint (must include needs_followup)
SELECT conname, pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'onboarding_packages'::regclass
  AND conname = 'onboarding_packages_package_status_check';

-- Expected: 1 row, constraint includes 'needs_followup' and 'cancelled'

-- 3. Payment index
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'onboarding_packages'
  AND indexname = 'idx_ob_pkg_payment';

-- Expected: 1 row
