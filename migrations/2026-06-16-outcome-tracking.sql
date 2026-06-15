-- ============================================================
-- Royal Energy Alchemy - Client Lifecycle Intelligence
-- Sprint 9: Outcome Tracking, Goals, Follow-Up Surveys
-- Run in Supabase SQL Editor
-- ============================================================

BEGIN;

-- ── session_outcomes ────────────────────────────────────────
-- Structured outcome per completed session.
-- Complements sessions.state_before/state_after (1-5 numeric) with
-- practitioner-entered category, notes, and research flag.
CREATE TABLE IF NOT EXISTS session_outcomes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        REFERENCES sessions(id) ON DELETE CASCADE,
  client_id         uuid        REFERENCES clients(id) ON DELETE SET NULL,
  client_name       text,
  session_date      date,
  outcome_category  text        NOT NULL
    CHECK (outcome_category IN ('improved','no_change','worse','mixed')),
  improvement_level integer
    CHECK (improvement_level BETWEEN 1 AND 10),
  energy_shift      text,
  practitioner_notes text,
  notable_findings  text[],
  research_flag     boolean     NOT NULL DEFAULT false,
  research_notes    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_outcomes_session   ON session_outcomes (session_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_client    ON session_outcomes (client_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_research  ON session_outcomes (research_flag) WHERE research_flag = true;

-- ── client_goals ─────────────────────────────────────────────
-- Tracks healing goals per client through their journey.
CREATE TABLE IF NOT EXISTS client_goals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid        REFERENCES clients(id) ON DELETE CASCADE,
  client_name     text,
  goal_text       text        NOT NULL,
  goal_category   text        NOT NULL DEFAULT 'general'
    CHECK (goal_category IN ('healing','energy','mental','physical','spiritual','emotional','general')),
  expected_outcome text,
  target_date     date,
  status          text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','achieved','abandoned','paused')),
  outcome_notes   text,
  achieved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_goals_client ON client_goals (client_id);
CREATE INDEX IF NOT EXISTS idx_client_goals_status ON client_goals (status) WHERE status = 'active';

-- ── aftercare follow-up survey fields ────────────────────────
-- Captures client-reported outcomes when they respond to aftercare.
ALTER TABLE aftercare
  ADD COLUMN IF NOT EXISTS satisfaction_score    integer
    CHECK (satisfaction_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS perceived_improvement text
    CHECK (perceived_improvement IN ('much_better','somewhat_better','same','somewhat_worse','much_worse')),
  ADD COLUMN IF NOT EXISTS would_return          boolean,
  ADD COLUMN IF NOT EXISTS would_recommend       boolean,
  ADD COLUMN IF NOT EXISTS outcome_response_at   timestamptz;

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Confirm session_outcomes table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'session_outcomes'
ORDER BY ordinal_position;

-- 2. Confirm client_goals table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'client_goals'
ORDER BY ordinal_position;

-- 3. Confirm aftercare survey columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'aftercare'
  AND column_name IN (
    'satisfaction_score','perceived_improvement',
    'would_return','would_recommend','outcome_response_at'
  )
ORDER BY column_name;

-- Expected: 5 rows for aftercare
