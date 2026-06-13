-- ============================================================
-- Royal Energy Alchemy — Research Lite Migration
-- Sprint 1 / Phase B
-- Normalizes the existing research_notes table to the Phase B schema.
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── ADD MISSING COLUMNS ──────────────────────────────────────
-- Adds any column that does not already exist.
-- ADD COLUMN IF NOT EXISTS is a no-op when the column is present.
-- NOT NULL columns carry a default so the ALTER succeeds even if
-- existing rows are present ('Untitled' for title, 'daron' for
-- created_by, now() for timestamps).

ALTER TABLE research_notes
  ADD COLUMN IF NOT EXISTS title      text         NOT NULL DEFAULT 'Untitled',
  ADD COLUMN IF NOT EXISTS content    text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS tags       text[],
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS created_by text         NOT NULL DEFAULT 'daron',
  ADD COLUMN IF NOT EXISTS created_at timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS research_notes_created_idx ON research_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS research_notes_deleted_idx ON research_notes(deleted_at) WHERE deleted_at IS NULL;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE research_notes ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON research_notes TO service_role;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- Run after migration to confirm all columns exist:
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'research_notes'
-- ORDER BY ordinal_position;
--
-- Expected columns: id, (any pre-existing), title, content,
--   source_url, tags, session_id, created_by, created_at,
--   updated_at, deleted_at
-- ─────────────────────────────────────────────────────────────
