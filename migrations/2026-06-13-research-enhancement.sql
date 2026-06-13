-- ============================================================
-- Royal Energy Alchemy — Research Lite Enhancement Migration
-- Adds visibility, client_id; GIN index on tags for pattern queries.
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── ADD MISSING COLUMNS ──────────────────────────────────────
ALTER TABLE research_notes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS client_id  uuid REFERENCES clients(id) ON DELETE SET NULL;

-- ── ADD CHECK CONSTRAINT ON visibility ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'research_notes' AND c.conname = 'research_notes_visibility_check'
  ) THEN
    ALTER TABLE research_notes
      ADD CONSTRAINT research_notes_visibility_check
        CHECK (visibility IN ('private', 'practice_notes'));
  END IF;
END $$;

-- ── INDEXES ───────────────────────────────────────────────────
-- GIN index enables fast tag-array containment queries for Pattern Library
CREATE INDEX IF NOT EXISTS research_notes_tags_idx
  ON research_notes USING GIN(tags);

-- Client index for cross-client Insights queries
CREATE INDEX IF NOT EXISTS research_notes_client_idx
  ON research_notes(client_id) WHERE client_id IS NOT NULL;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON research_notes TO service_role;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- Run after migration to confirm all columns exist:
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'research_notes'
-- ORDER BY ordinal_position;
--
-- Expected new columns: visibility (text, NOT NULL, 'private'), client_id (uuid, nullable)
-- Expected new indexes: research_notes_tags_idx, research_notes_client_idx
-- ─────────────────────────────────────────────────────────────
