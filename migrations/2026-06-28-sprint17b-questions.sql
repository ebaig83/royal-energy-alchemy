-- ── Sprint 17 (Phase B) — Client Questions ───────────────────────────────────
-- A client question workflow inside the portal. Questions are created/read via
-- service_role functions (function-enforced ownership); RLS + grants provide
-- defense-in-depth so an authenticated client can only ever read/insert their
-- OWN questions. Idempotent.

CREATE TABLE IF NOT EXISTS client_questions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid REFERENCES clients(id)  ON DELETE CASCADE,
  session_id               uuid REFERENCES sessions(id) ON DELETE SET NULL,
  question                 text NOT NULL,
  category                 text,
  priority                 text DEFAULT 'normal',
  preferred_contact_method text,
  status                   text DEFAULT 'new',
  practitioner_response    text,
  submitted_at             timestamptz DEFAULT now(),
  responded_at             timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_questions_client ON client_questions (client_id);
CREATE INDEX IF NOT EXISTS idx_client_questions_status ON client_questions (status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_questions_priority_check') THEN
    ALTER TABLE client_questions ADD CONSTRAINT client_questions_priority_check
      CHECK (priority IN ('low','normal','high','urgent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_questions_status_check') THEN
    ALTER TABLE client_questions ADD CONSTRAINT client_questions_status_check
      CHECK (status IN ('new','in_review','responded','closed'));
  END IF;
END $$;

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION set_client_questions_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_client_questions_updated_at ON client_questions;
CREATE TRIGGER trg_client_questions_updated_at
  BEFORE UPDATE ON client_questions
  FOR EACH ROW EXECUTE FUNCTION set_client_questions_updated_at();

-- ── RLS + grants (own rows only for authenticated; service_role bypasses) ─────
ALTER TABLE client_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_questions_self_select ON client_questions;
CREATE POLICY client_questions_self_select ON client_questions
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS client_questions_self_insert ON client_questions;
CREATE POLICY client_questions_self_insert ON client_questions
  FOR INSERT TO authenticated
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));

GRANT SELECT, INSERT ON client_questions TO authenticated;
