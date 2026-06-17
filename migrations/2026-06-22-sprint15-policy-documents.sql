-- ── Sprint 15 Document System Expansion ──────────────────────────────────────
-- Expands client_documents into a full client policy-document system.
-- Adds the five required policy document types plus the richer acknowledgment
-- tracking columns (viewed / acknowledged / signed / submitted, signature,
-- ip/ua audit fields). Each document remains SEPARATE — policies, waiver,
-- intake, and assessment are never collapsed into one another.
--
-- Idempotent — safe to re-run. Run after 2026-06-21-sprint15-direction-correction.sql.

-- ── 1. Expand client_documents columns ───────────────────────────────────────
ALTER TABLE client_documents
  ADD COLUMN IF NOT EXISTS document_url    text,
  ADD COLUMN IF NOT EXISTS viewed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature       text,
  ADD COLUMN IF NOT EXISTS ip_address      text,
  ADD COLUMN IF NOT EXISTS user_agent      text,
  ADD COLUMN IF NOT EXISTS consents        jsonb;

-- title may have been nullable in the original migration — keep it nullable
-- (we always supply a title from the app), and default status to not_started.
ALTER TABLE client_documents ALTER COLUMN status SET DEFAULT 'not_started';
ALTER TABLE client_documents ALTER COLUMN version SET DEFAULT 'v1';

-- ── 2. Broaden the document_type constraint to the full set ───────────────────
-- Statuses used by the app: not_started | viewed | acknowledged | signed |
--                           submitted | complete | expired
ALTER TABLE client_documents DROP CONSTRAINT IF EXISTS client_documents_type_check;
ALTER TABLE client_documents
  ADD CONSTRAINT client_documents_type_check CHECK (document_type IN (
    'privacy_policy',
    'ai_recording_transcription_policy',
    'recording_policy',
    'cancellation_policy',
    'payment_policy',
    'waiver',
    'intake',
    'assessment',
    'treatment_plan',
    'followup',
    -- retained from prior migration for backward compatibility
    'session_summary',
    'payment_receipt',
    'communication'
  ));

-- ── 2b. Booking confirmation → client portal link ────────────────────────────
-- Add a "Required Documents" block pointing the client to their portal, where
-- they complete every required document. One primary link — not a separate
-- link per document. Idempotent (guarded by NOT LIKE).
UPDATE email_templates
SET text_body = replace(
      text_body,
      'MANAGE YOUR APPOINTMENT',
      'REQUIRED DOCUMENTS' || chr(10) ||
      '{{documents_message}}' || chr(10) ||
      '{{portal_url}}' || chr(10) || chr(10) ||
      'MANAGE YOUR APPOINTMENT'),
    variables = (
      SELECT ARRAY(SELECT DISTINCT unnest(variables || ARRAY['portal_url','documents_message']))
    ),
    updated_at = now()
WHERE name = 'appointment_confirmation'
  AND text_body NOT LIKE '%REQUIRED DOCUMENTS%';

-- ── 3. One canonical row per (client, document_type, version) ─────────────────
-- The acknowledge/sign endpoint upserts on this key so re-acknowledging a new
-- version creates a new row while re-acknowledging the same version updates it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_documents_unique
  ON client_documents (client_id, document_type, version);
