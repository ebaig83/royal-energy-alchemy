-- ============================================================
-- Royal Energy Alchemy — Content Studio Addendum A
-- External Content Intelligence Layer
-- All statements are idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── CONTENT SOURCES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_sources (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text         NOT NULL,
  source_title     text         NOT NULL,
  source_url       text,
  source_summary   text,
  source_tags      text[]                   DEFAULT '{}',
  source_date      date,
  relevance_score  integer                  DEFAULT 5,
  created_at       timestamptz  NOT NULL    DEFAULT now(),
  updated_at       timestamptz  NOT NULL    DEFAULT now(),
  deleted_at       timestamptz
);

-- ── CHECK CONSTRAINTS on content_sources ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_sources' AND c.conname = 'content_sources_type_check'
  ) THEN
    ALTER TABLE content_sources
      ADD CONSTRAINT content_sources_type_check
        CHECK (source_type IN ('search_trend','article','podcast','book','video','webinar','competitor','research','community'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_sources' AND c.conname = 'content_sources_score_check'
  ) THEN
    ALTER TABLE content_sources
      ADD CONSTRAINT content_sources_score_check
        CHECK (relevance_score BETWEEN 1 AND 10);
  END IF;
END $$;

-- ── ADD SCORING COLUMNS TO content_ideas ─────────────────────
ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS internal_score    integer,
  ADD COLUMN IF NOT EXISTS market_score      integer,
  ADD COLUMN IF NOT EXISTS educational_score integer,
  ADD COLUMN IF NOT EXISTS business_score    integer,
  ADD COLUMN IF NOT EXISTS priority          text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_ideas' AND c.conname = 'content_ideas_priority_check'
  ) THEN
    ALTER TABLE content_ideas
      ADD CONSTRAINT content_ideas_priority_check
        CHECK (priority IN ('low','medium','high','critical'));
  END IF;
END $$;

-- ── EXPAND content_type VALUES ────────────────────────────────
-- Drop old constraint, re-add with expanded type list.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'content_ideas' AND c.conname = 'content_ideas_content_type_check'
  ) THEN
    ALTER TABLE content_ideas DROP CONSTRAINT content_ideas_content_type_check;
  END IF;
  ALTER TABLE content_ideas
    ADD CONSTRAINT content_ideas_content_type_check
      CHECK (content_type IN (
        'social_post','video','newsletter','blog','training','book_chapter',
        'faq','webinar','workshop','podcast_topic','course_module',
        'lead_magnet','case_study','faq_series','certification_module'
      ));
END $$;

-- ── INDEXES on content_sources ────────────────────────────────
CREATE INDEX IF NOT EXISTS cs_type_idx      ON content_sources(source_type)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cs_score_idx     ON content_sources(relevance_score DESC);
CREATE INDEX IF NOT EXISTS cs_deleted_idx   ON content_sources(deleted_at)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cs_date_idx      ON content_sources(source_date DESC);
CREATE INDEX IF NOT EXISTS cs_tags_idx      ON content_sources USING GIN(source_tags);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON content_sources TO service_role;
