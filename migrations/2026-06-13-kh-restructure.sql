-- ============================================================
-- Royal Energy Alchemy — Knowledge Hub Restructure Migration
-- Adds summary column to kb_entries per the Phase C+ spec.
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── ADD MISSING COLUMNS ──────────────────────────────────────
-- summary: short blurb shown in browse cards (< content)
ALTER TABLE kb_entries
  ADD COLUMN IF NOT EXISTS summary text;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'kb_entries' ORDER BY ordinal_position;
-- Expected: id, title, content, category, tags, is_pinned,
--   fts, status, created_by, created_at, updated_at, deleted_at, summary
-- ─────────────────────────────────────────────────────────────
