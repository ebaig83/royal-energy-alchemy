-- ── Sprint 16 — Separate Public Assessment from Full Assessment ──────────────
-- Adds the 'full_assessment' client document type. The existing 'assessment'
-- type remains the PUBLIC (marketing / lead-gen) assessment from /assess.html.
-- 'full_assessment' is the portal-only practitioner/client-care document.
--
-- Idempotent. Does NOT touch email_templates or any other previously-verified
-- data. Safe to re-run.

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
    'assessment',        -- public assessment (marketing / lead-gen)
    'full_assessment',   -- portal-only practitioner/client-care assessment
    'treatment_plan',
    'followup',
    -- retained for backward compatibility
    'session_summary',
    'payment_receipt',
    'communication'
  ));
