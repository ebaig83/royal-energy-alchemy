-- ============================================================
-- Royal Energy Alchemy — Training Certifications
-- Creates training_certifications (curriculum cert tracking).
-- Also restores the practitioner certifications table to its
-- original state (undoes accidental repair1 + repair2 changes).
-- Run in: Supabase → SQL Editor → New query → Run
-- All statements idempotent — safe to run more than once.
-- ============================================================

-- ── 1. RESTORE practitioner certifications table ──────────────
-- Remove the erroneously added "title" column (from repair1)
ALTER TABLE certifications DROP COLUMN IF EXISTS title;

-- Restore the original "name" column (dropped by repair2)
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS name text;
UPDATE certifications SET name = '' WHERE name IS NULL;
ALTER TABLE certifications ALTER COLUMN name SET NOT NULL;

-- ── 2. CREATE training_certifications ────────────────────────
-- Curriculum certification records for the Training Center.
-- Completely separate from practitioner credential tracking.
CREATE TABLE IF NOT EXISTS training_certifications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text         NOT NULL,
  description      text,
  required_modules uuid[]       NOT NULL DEFAULT '{}',
  status           text         NOT NULL DEFAULT 'draft',
  created_by       text         NOT NULL DEFAULT 'daron',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- CHECK constraint (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'training_certifications' AND c.conname = 'tcert_status_check'
  ) THEN
    ALTER TABLE training_certifications
      ADD CONSTRAINT tcert_status_check
        CHECK (status IN ('draft','review','approved','published','archived'));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS tcert_status_idx  ON training_certifications(status)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tcert_deleted_idx ON training_certifications(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tcert_created_idx ON training_certifications(created_at DESC);

-- Security
ALTER TABLE training_certifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON training_certifications TO service_role;

-- ── 3. VERIFY ─────────────────────────────────────────────────
SELECT 'training_certifications' AS table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'training_certifications'
ORDER BY ordinal_position;
