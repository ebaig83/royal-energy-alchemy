-- ============================================================
-- Royal Energy Alchemy — Knowledge Base Lite Migration
-- Sprint 1 / Phase C
-- Normalizes the existing kb_entries table to the Phase C schema.
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── ADD MISSING COLUMNS ──────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS is a no-op when the column is already present.
-- NOT NULL columns carry a DEFAULT so the ALTER succeeds on tables with
-- existing rows.

ALTER TABLE kb_entries
  ADD COLUMN IF NOT EXISTS content    text,
  ADD COLUMN IF NOT EXISTS category   text,
  ADD COLUMN IF NOT EXISTS tags       text[],
  ADD COLUMN IF NOT EXISTS is_pinned  boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fts        tsvector,
  ADD COLUMN IF NOT EXISTS status     text         NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS created_by text         NOT NULL DEFAULT 'daron',
  ADD COLUMN IF NOT EXISTS created_at timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── CHECK CONSTRAINT ON status ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'kb_entries' AND c.conname = 'kb_entries_status_check'
  ) THEN
    ALTER TABLE kb_entries
      ADD CONSTRAINT kb_entries_status_check
        CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END $$;

-- ── INDEXES ───────────────────────────────────────────────────
-- GIN index for future full-text search (fts column is nullable
-- until a trigger or explicit update populates it).
CREATE INDEX IF NOT EXISTS kb_entries_fts_idx      ON kb_entries USING GIN(fts);
CREATE INDEX IF NOT EXISTS kb_entries_category_idx ON kb_entries(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS kb_entries_status_idx   ON kb_entries(status);
CREATE INDEX IF NOT EXISTS kb_entries_pinned_idx   ON kb_entries(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS kb_entries_deleted_idx  ON kb_entries(deleted_at) WHERE deleted_at IS NULL;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_entries TO service_role;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- Run after migration to confirm all columns exist:
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'kb_entries'
-- ORDER BY ordinal_position;
--
-- Expected columns: id, title, content, category, tags, is_pinned,
--   fts, status, created_by, created_at, updated_at, deleted_at
-- Expected indexes:  kb_entries_fts_idx, kb_entries_category_idx,
--   kb_entries_status_idx, kb_entries_pinned_idx, kb_entries_deleted_idx
-- Expected constraint: kb_entries_status_check
-- ─────────────────────────────────────────────────────────────
