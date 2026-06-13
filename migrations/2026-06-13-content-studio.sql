-- ============================================================
-- Royal Energy Alchemy — Content Studio Migration
-- Sprint: Content Studio Lite
-- Creates: content_ideas table
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── CONTENT IDEAS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_ideas (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text         NOT NULL,
  content_type   text         NOT NULL,
  source_type    text,
  source_ids     jsonb                    DEFAULT '[]'::jsonb,
  topic          text,
  summary        text,
  status         text         NOT NULL    DEFAULT 'draft',
  scheduled_date date,
  created_by     text         NOT NULL    DEFAULT 'daron',
  created_at     timestamptz  NOT NULL    DEFAULT now(),
  updated_at     timestamptz  NOT NULL    DEFAULT now(),
  deleted_at     timestamptz
);

-- ── CHECK CONSTRAINTS ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_ideas' AND c.conname = 'content_ideas_content_type_check'
  ) THEN
    ALTER TABLE content_ideas
      ADD CONSTRAINT content_ideas_content_type_check
        CHECK (content_type IN ('social_post','video','newsletter','blog','training','book_chapter','faq','webinar'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_ideas' AND c.conname = 'content_ideas_status_check'
  ) THEN
    ALTER TABLE content_ideas
      ADD CONSTRAINT content_ideas_status_check
        CHECK (status IN ('draft','approved','archived'));
  END IF;
END $$;

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ci_status_idx        ON content_ideas(status)         WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ci_content_type_idx  ON content_ideas(content_type)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ci_scheduled_idx     ON content_ideas(scheduled_date) WHERE scheduled_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS ci_deleted_idx       ON content_ideas(deleted_at)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ci_created_idx       ON content_ideas(created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE content_ideas ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON content_ideas TO service_role;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- Run after migration to confirm:
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'content_ideas'
-- ORDER BY ordinal_position;
--
-- Expected columns: id, title, content_type, source_type, source_ids,
--   topic, summary, status, scheduled_date, created_by, created_at,
--   updated_at, deleted_at
-- Expected constraints: content_ideas_content_type_check, content_ideas_status_check
-- ─────────────────────────────────────────────────────────────
