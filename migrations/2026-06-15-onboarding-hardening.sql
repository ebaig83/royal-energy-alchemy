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
