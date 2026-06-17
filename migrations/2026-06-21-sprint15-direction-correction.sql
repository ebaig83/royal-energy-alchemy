-- ── Sprint 15 Direction Correction ───────────────────────────────────────────
-- Reverses the "waiver absorbed into full intake" hotfix and restores the
-- waiver as a SEPARATE client document. Also lays the foundation for the
-- client portal / document hub via a unified `client_documents` table.
--
-- Canonical principle: each document (assessment, waiver, intake, treatment
-- plan, session summary, follow-up) is tracked independently. Intake
-- completion does NOT imply waiver completion, and vice versa.
--
-- Run in Supabase SQL Editor (safe to re-run — all IF NOT EXISTS / idempotent).

-- ── 1. Restore separate waiver tracking on sessions ──────────────────────────
-- sprint15.sql already added intake_status, waiver_status, waiver_sent_at.
-- Add the signature/version columns so a signed waiver is fully recorded
-- independently of the intake submission.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS waiver_signature text,
  ADD COLUMN IF NOT EXISTS waiver_version   text;

-- ── 2. Retire the waiver-into-intake columns ─────────────────────────────────
-- These were added by 2026-06-16-sprint15-waiver-hotfix.sql when the waiver
-- was (incorrectly) embedded in the full intake form. The waiver is now its
-- own document, so these are no longer the source of truth. We keep the
-- columns (rather than DROP) to avoid data loss from any rows already written,
-- but they are deprecated — do not read waiver status from intake_submissions.
COMMENT ON COLUMN intake_submissions.waiver_accepted IS
  'DEPRECATED (Sprint 15 direction correction). Waiver is now a separate document — read waiver status from sessions.waiver_status / client_documents.';

-- Drop the compliance index that assumed waiver lived on intake_submissions.
DROP INDEX IF EXISTS idx_intake_waiver_accepted;

-- ── 3. client_documents — unified document hub model ─────────────────────────
-- One row per client document of any type. Powers the client portal and gives
-- Daron a clean, structured client file.

CREATE TABLE IF NOT EXISTS client_documents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        REFERENCES clients(id)  ON DELETE CASCADE,
  session_id    uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  document_type text        NOT NULL,   -- assessment | waiver | intake | treatment_plan | session_summary | followup | payment_receipt | communication
  title         text,
  status        text        NOT NULL DEFAULT 'pending',  -- pending | sent | in_progress | complete | signed | submitted
  url           text,
  signed_at     timestamptz,
  submitted_at  timestamptz,
  version       text,
  metadata      jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_documents_client  ON client_documents (client_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_session ON client_documents (session_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_type    ON client_documents (document_type);
CREATE INDEX IF NOT EXISTS idx_client_documents_status  ON client_documents (status);

-- Constrain document_type to the known set (additive — extend as needed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_documents_type_check'
  ) THEN
    ALTER TABLE client_documents
      ADD CONSTRAINT client_documents_type_check CHECK (document_type IN (
        'assessment','waiver','intake','treatment_plan',
        'session_summary','followup','payment_receipt','communication'
      ));
  END IF;
END $$;

-- Keep updated_at fresh on every change.
CREATE OR REPLACE FUNCTION set_client_documents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_documents_updated_at ON client_documents;
CREATE TRIGGER trg_client_documents_updated_at
  BEFORE UPDATE ON client_documents
  FOR EACH ROW EXECUTE FUNCTION set_client_documents_updated_at();

-- ── 4. Portal access token on clients ────────────────────────────────────────
-- Clients reach their portal by secure token (not dashboard login). The token
-- is a long random string stored on the client record; the portal validates it
-- server-side before returning any documents.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS portal_token        text,
  ADD COLUMN IF NOT EXISTS portal_token_issued timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_token
  ON clients (portal_token)
  WHERE portal_token IS NOT NULL;
