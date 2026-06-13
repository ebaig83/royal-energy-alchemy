-- ============================================================
-- Royal Energy Alchemy — Content Generation Engine (Phase 2)
-- content_drafts table
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
--
-- Prerequisites (run first if not already done):
--   2026-06-13-content-studio.sql
--   2026-06-13-content-studio-addendum-a.sql
-- ============================================================

-- ── CONTENT DRAFTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_drafts (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  content_idea_id   uuid,
  title             text         NOT NULL,
  content_type      text         NOT NULL,
  draft_content     text,
  source_ids        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  generation_method text,
  status            text         NOT NULL DEFAULT 'draft',
  created_by        text         NOT NULL DEFAULT 'daron',
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- ── CHECK CONSTRAINTS ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_drafts' AND c.conname = 'content_drafts_status_check'
  ) THEN
    ALTER TABLE content_drafts
      ADD CONSTRAINT content_drafts_status_check
        CHECK (status IN ('draft','review','approved','published','archived'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_drafts' AND c.conname = 'content_drafts_type_check'
  ) THEN
    ALTER TABLE content_drafts
      ADD CONSTRAINT content_drafts_type_check
        CHECK (content_type IN (
          'social_post','video','newsletter','blog','training','book_chapter',
          'faq','faq_series','webinar','workshop','podcast_topic','course_module',
          'lead_magnet','case_study','certification_module'
        ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_drafts' AND c.conname = 'content_drafts_method_check'
  ) THEN
    ALTER TABLE content_drafts
      ADD CONSTRAINT content_drafts_method_check
        CHECK (generation_method IN ('generated','manual') OR generation_method IS NULL);
  END IF;
END $$;

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS cd_status_idx       ON content_drafts(status)            WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cd_type_idx         ON content_drafts(content_type)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cd_idea_idx         ON content_drafts(content_idea_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cd_deleted_idx      ON content_drafts(deleted_at)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cd_created_idx      ON content_drafts(created_at DESC);
CREATE INDEX IF NOT EXISTS cd_source_ids_idx   ON content_drafts USING GIN(source_ids);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON content_drafts TO service_role;
