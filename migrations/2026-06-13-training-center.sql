-- ============================================================
-- Royal Energy Alchemy — Training Center Lite
-- Tables: training_modules, learning_paths, certifications
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
--
-- Prerequisites (run first if not already done):
--   2026-06-13-content-studio.sql
--   2026-06-13-content-studio-addendum-a.sql
--   2026-06-13-content-drafts.sql
-- ============================================================

-- ── TRAINING MODULES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_modules (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text         NOT NULL,
  summary             text,
  module_type         text         NOT NULL DEFAULT 'onboarding',
  source_ids          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  content_draft_id    uuid,
  difficulty_level    text         NOT NULL DEFAULT 'beginner',
  estimated_duration  integer,
  status              text         NOT NULL DEFAULT 'draft',
  learning_objectives jsonb        NOT NULL DEFAULT '[]'::jsonb,
  key_concepts        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  discussion_questions jsonb       NOT NULL DEFAULT '[]'::jsonb,
  module_content      text,
  created_by          text         NOT NULL DEFAULT 'daron',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'training_modules' AND c.conname = 'tm_type_check'
  ) THEN
    ALTER TABLE training_modules
      ADD CONSTRAINT tm_type_check
        CHECK (module_type IN ('onboarding','practitioner','client','workshop','certification','continuing_education'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'training_modules' AND c.conname = 'tm_difficulty_check'
  ) THEN
    ALTER TABLE training_modules
      ADD CONSTRAINT tm_difficulty_check
        CHECK (difficulty_level IN ('beginner','intermediate','advanced'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'training_modules' AND c.conname = 'tm_status_check'
  ) THEN
    ALTER TABLE training_modules
      ADD CONSTRAINT tm_status_check
        CHECK (status IN ('draft','review','approved','published','archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tm_status_idx    ON training_modules(status)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tm_type_idx      ON training_modules(module_type)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tm_difficulty_idx ON training_modules(difficulty_level) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tm_deleted_idx   ON training_modules(deleted_at)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tm_created_idx   ON training_modules(created_at DESC);
CREATE INDEX IF NOT EXISTS tm_source_ids_idx ON training_modules USING GIN(source_ids);
CREATE INDEX IF NOT EXISTS tm_objectives_idx ON training_modules USING GIN(learning_objectives);

ALTER TABLE training_modules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON training_modules TO service_role;

-- ── LEARNING PATHS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_paths (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text         NOT NULL,
  description         text,
  path_type           text         NOT NULL DEFAULT 'practitioner',
  module_ids          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  status              text         NOT NULL DEFAULT 'draft',
  estimated_duration  integer,
  created_by          text         NOT NULL DEFAULT 'daron',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'learning_paths' AND c.conname = 'lp_type_check'
  ) THEN
    ALTER TABLE learning_paths
      ADD CONSTRAINT lp_type_check
        CHECK (path_type IN ('practitioner','client','certification','workshop'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'learning_paths' AND c.conname = 'lp_status_check'
  ) THEN
    ALTER TABLE learning_paths
      ADD CONSTRAINT lp_status_check
        CHECK (status IN ('draft','review','approved','published','archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lp_status_idx  ON learning_paths(status)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lp_type_idx    ON learning_paths(path_type)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lp_deleted_idx ON learning_paths(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lp_created_idx ON learning_paths(created_at DESC);

ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_paths TO service_role;

-- ── CERTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certifications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text         NOT NULL,
  description      text,
  required_modules jsonb        NOT NULL DEFAULT '[]'::jsonb,
  status           text         NOT NULL DEFAULT 'draft',
  created_by       text         NOT NULL DEFAULT 'daron',
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'certifications' AND c.conname = 'cert_status_check'
  ) THEN
    ALTER TABLE certifications
      ADD CONSTRAINT cert_status_check
        CHECK (status IN ('draft','review','approved','published','archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cert_status_idx  ON certifications(status)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cert_deleted_idx ON certifications(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cert_created_idx ON certifications(created_at DESC);

ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON certifications TO service_role;
