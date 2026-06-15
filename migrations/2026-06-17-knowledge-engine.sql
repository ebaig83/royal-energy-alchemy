-- ============================================================
-- Royal Energy Alchemy - Knowledge Extraction Engine
-- Sprint 10: Pattern Intelligence, Research Insights, Case Studies
-- Run in Supabase SQL Editor
-- ============================================================

BEGIN;

-- ── patterns ─────────────────────────────────────────────────
-- Auto-detected statistical patterns from session/outcome/recommendation data.
-- Distinct from tag-based Pattern Library in research_notes.
CREATE TABLE IF NOT EXISTS patterns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type     text        NOT NULL
    CHECK (pattern_type IN ('concern','intervention','outcome','recommendation','retention','service')),
  title            text        NOT NULL,
  description      text,
  supporting_count integer     NOT NULL DEFAULT 0,
  confidence_level text        NOT NULL DEFAULT 'emerging'
    CHECK (confidence_level IN ('emerging','moderate','strong')),
  status           text        NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','confirmed','dismissed')),
  data_snapshot    jsonb,
  content_tags     text[],
  detected_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_type   ON patterns (pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patterns_title ON patterns (title);

-- ── research_insights ─────────────────────────────────────────
-- Structured, curated insights ready for publication or content use.
-- Distinct from unstructured research_notes.
CREATE TABLE IF NOT EXISTS research_insights (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text        NOT NULL,
  category              text        NOT NULL DEFAULT 'other'
    CHECK (category IN ('outcome','recommendation','retention','service','client_pattern','intervention','other')),
  description           text        NOT NULL,
  supporting_pattern_ids uuid[],
  confidence_level      text        NOT NULL DEFAULT 'emerging'
    CHECK (confidence_level IN ('emerging','moderate','strong')),
  status                text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','under_review','published','archived')),
  content_tags          text[],
  practitioner_notes    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_insights_status   ON research_insights (status);
CREATE INDEX IF NOT EXISTS idx_research_insights_category ON research_insights (category);

-- ── case_studies ──────────────────────────────────────────────
-- Generated from session + outcome data. Anonymized by default.
CREATE TABLE IF NOT EXISTS case_studies (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  outcome_id        uuid        REFERENCES session_outcomes(id) ON DELETE SET NULL,
  title             text,
  client_alias      text,
  service           text,
  problem           text,
  intervention      text,
  outcome           text,
  lessons_learned   text,
  outcome_category  text,
  improvement_level integer,
  status            text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','under_review','published','archived')),
  content_tags      text[],
  anonymized        boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_studies_status ON case_studies (status);

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('patterns','research_insights','case_studies')
ORDER BY table_name, ordinal_position;

-- Expected: patterns (10 cols), research_insights (9 cols), case_studies (16 cols)
