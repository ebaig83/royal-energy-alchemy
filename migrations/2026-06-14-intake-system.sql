-- ============================================================
-- Royal Energy Alchemy — Client Onboarding / Intake System
-- Run once in Supabase SQL Editor
-- ============================================================

BEGIN;

-- ── INTAKES TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intakes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links
  client_id          uuid        REFERENCES clients(id)  ON DELETE SET NULL,
  session_id         uuid        REFERENCES sessions(id) ON DELETE SET NULL,

  -- Client identity (denormalised for quick reads)
  client_name        text        NOT NULL,
  client_email       text,
  client_phone       text,

  -- Method: 'written' or 'ai_call'
  method             text        NOT NULL DEFAULT 'written'
                                 CHECK (method IN ('written','ai_call')),

  -- Intake appointment scheduling (used when method = 'ai_call')
  intake_date        date,
  intake_time        time,

  -- Workflow status
  intake_status      text        NOT NULL DEFAULT 'scheduled'
                                 CHECK (intake_status IN (
                                   'scheduled','completed','summary_generated',
                                   'reviewed','ready_for_session',
                                   'missed','cancelled','needs_followup'
                                 )),

  -- Written questionnaire responses (JSON object, keyed by question slug)
  responses          jsonb       NOT NULL DEFAULT '{}',

  -- Auto-generated or AI-generated summary fields
  summary            text,
  key_themes         text[],
  risk_flags         jsonb       DEFAULT '[]',
  recommendations    text,
  suggested_focus    text,

  -- Review tracking
  reviewed_by        text,
  reviewed_at        timestamptz,
  review_notes       text,

  -- Meta
  source             text        DEFAULT 'website_form',
  seller_notes       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intakes_client_id   ON intakes (client_id);
CREATE INDEX IF NOT EXISTS idx_intakes_session_id  ON intakes (session_id);
CREATE INDEX IF NOT EXISTS idx_intakes_status      ON intakes (intake_status);
CREATE INDEX IF NOT EXISTS idx_intakes_date        ON intakes (intake_date);
CREATE INDEX IF NOT EXISTS idx_intakes_email       ON intakes (client_email);
CREATE INDEX IF NOT EXISTS idx_intakes_created     ON intakes (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_intakes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_intakes_updated ON intakes;
CREATE TRIGGER trg_intakes_updated
  BEFORE UPDATE ON intakes
  FOR EACH ROW EXECUTE FUNCTION update_intakes_updated_at();

-- RLS — service role bypasses automatically; anon can INSERT (submit form)
ALTER TABLE intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intakes_public_insert ON intakes;
CREATE POLICY intakes_public_insert ON intakes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS intakes_service_all ON intakes;
CREATE POLICY intakes_service_all ON intakes
  FOR ALL USING (false);  -- blocks anon SELECT/UPDATE/DELETE; service role bypasses

GRANT INSERT ON intakes TO anon, authenticated;
GRANT SELECT, UPDATE ON intakes TO authenticated;

-- ── ONBOARDING PACKAGES TABLE ─────────────────────────────────
-- Tracks the paired intake + session as a single onboarding record
CREATE TABLE IF NOT EXISTS onboarding_packages (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id          uuid        REFERENCES intakes(id)  ON DELETE CASCADE,
  session_id         uuid        REFERENCES sessions(id) ON DELETE SET NULL,

  client_name        text        NOT NULL,
  client_email       text,

  package_status     text        NOT NULL DEFAULT 'intake_pending'
                                 CHECK (package_status IN (
                                   'intake_pending','intake_complete',
                                   'review_pending','review_complete',
                                   'session_scheduled','session_complete',
                                   'aftercare_sent','follow_up_complete',
                                   'cancelled'
                                 )),

  buffer_hours       integer     NOT NULL DEFAULT 48,   -- min hours between intake and session
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_intake   ON onboarding_packages (intake_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_session  ON onboarding_packages (session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status   ON onboarding_packages (package_status);

CREATE OR REPLACE FUNCTION update_onboarding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_updated ON onboarding_packages;
CREATE TRIGGER trg_onboarding_updated
  BEFORE UPDATE ON onboarding_packages
  FOR EACH ROW EXECUTE FUNCTION update_onboarding_updated_at();

ALTER TABLE onboarding_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_public_insert ON onboarding_packages;
CREATE POLICY onboarding_public_insert ON onboarding_packages
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS onboarding_service_all ON onboarding_packages;
CREATE POLICY onboarding_service_all ON onboarding_packages
  FOR ALL USING (false);

GRANT INSERT ON onboarding_packages TO anon, authenticated;
GRANT SELECT, UPDATE ON onboarding_packages TO authenticated;

COMMIT;
