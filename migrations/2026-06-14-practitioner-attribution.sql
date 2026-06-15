-- ============================================================
-- Royal Energy Alchemy — Sprint 10A Phase 1
-- Practitioner Attribution: adds practitioner_id to sessions
-- Idempotent — safe to run multiple times.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS practitioner_id uuid
  REFERENCES practitioners(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_practitioner_idx
  ON sessions(practitioner_id)
  WHERE practitioner_id IS NOT NULL;
