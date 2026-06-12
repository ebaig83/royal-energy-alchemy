-- Sprint 2 Migration
-- 2026-06-12
-- Changes: intake matching fields, aftercare POST support

-- ── 1. intake_submissions: add match tracking columns ─────────────────────────
ALTER TABLE public.intake_submissions
  ADD COLUMN IF NOT EXISTS match_status text
    DEFAULT 'unmatched'
    CONSTRAINT intake_submissions_match_status_check
      CHECK (match_status IN ('matched','needs_review','unmatched')),
  ADD COLUMN IF NOT EXISTS matched_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.intake_submissions.match_status IS
  'matched=linked to existing client, needs_review=multiple possible matches found, unmatched=no client found yet';
COMMENT ON COLUMN public.intake_submissions.matched_at IS
  'Timestamp when client match was established (auto or manual)';

CREATE INDEX IF NOT EXISTS idx_intake_submissions_match_status
  ON public.intake_submissions(match_status);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_email
  ON public.intake_submissions(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_submissions_phone
  ON public.intake_submissions(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_submissions_client_id
  ON public.intake_submissions(client_id) WHERE client_id IS NOT NULL;

-- ── 2. aftercare: add source column for ad-hoc follow-ups ─────────────────────
ALTER TABLE public.aftercare
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'session'
    CONSTRAINT aftercare_source_check
      CHECK (source IN ('session','manual','system'));
COMMENT ON COLUMN public.aftercare.source IS
  'session=created during session workflow, manual=created from Follow-Up Center, system=auto-generated';

ALTER TABLE public.aftercare
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;
COMMENT ON COLUMN public.aftercare.notes IS
  'Practitioner notes on this follow-up item (for ad-hoc/manual follow-ups)';

ALTER TABLE public.aftercare
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium'
    CONSTRAINT aftercare_priority_check
      CHECK (priority IN ('low','medium','high','critical'));
COMMENT ON COLUMN public.aftercare.priority IS
  'Follow-up urgency: low, medium, high, critical';

-- ── Validation queries ────────────────────────────────────────────────────────
-- Run after migration:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('intake_submissions','aftercare')
ORDER BY table_name, ordinal_position;
