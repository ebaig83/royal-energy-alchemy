-- ── Sprint 18 — Training interest leads ──────────────────────────────────────
-- Captures training waitlist / class-interest submissions so they reach the
-- practitioner dashboard (not just Netlify Forms). Written + read only via
-- service_role functions, so no RLS/grants are required. Idempotent.

CREATE TABLE IF NOT EXISTS training_interest (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name         text,
  email              text,
  interested_courses text,
  levels             text,
  source             text DEFAULT 'training_waitlist',
  status             text DEFAULT 'new',   -- new | contacted | enrolled | closed
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_interest_created ON training_interest (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_interest_email   ON training_interest (email);
