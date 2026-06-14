-- ============================================================
-- Royal Energy Alchemy — Practitioner Network (Sprint 8)
-- Tables: practitioners, practitioner_applications,
--         practitioner_certifications, practitioner_referrals
-- All statements idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── 1. PRACTITIONERS ─────────────────────────────────────────
-- Master registry of REA network practitioners.
-- Separate from `clients` (who receive healing services).
CREATE TABLE IF NOT EXISTS practitioners (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  email               text,
  phone               text,
  location            text,
  specialties         text[]      NOT NULL DEFAULT '{}',
  bio                 text,
  status              text        NOT NULL DEFAULT 'applied',
  application_date    date                 DEFAULT CURRENT_DATE,
  approval_date       date,
  certification_level text        NOT NULL DEFAULT 'none',
  directory_visible   boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'practitioners' AND c.conname = 'pn_status_check'
  ) THEN
    ALTER TABLE practitioners ADD CONSTRAINT pn_status_check
      CHECK (status IN ('applied','review','approved','active','suspended','archived'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'practitioners' AND c.conname = 'pn_cert_level_check'
  ) THEN
    ALTER TABLE practitioners ADD CONSTRAINT pn_cert_level_check
      CHECK (certification_level IN ('none','foundation','practitioner','advanced','master'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pn_status_idx      ON practitioners(status)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pn_email_idx       ON practitioners(email)         WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS pn_deleted_idx     ON practitioners(deleted_at)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pn_specialties_idx ON practitioners USING GIN(specialties);
CREATE INDEX IF NOT EXISTS pn_directory_idx   ON practitioners(directory_visible) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pn_created_idx     ON practitioners(created_at DESC);

ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON practitioners TO service_role;

-- ── 2. PRACTITIONER_APPLICATIONS ────────────────────────────
-- Application pipeline for practitioner recruitment.
CREATE TABLE IF NOT EXISTS practitioner_applications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id  uuid        REFERENCES practitioners(id) ON DELETE CASCADE,
  application_text text,
  experience       text,
  training_history text,
  references       text,
  review_notes     text,
  status           text        NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'practitioner_applications' AND c.conname = 'pa_status_check'
  ) THEN
    ALTER TABLE practitioner_applications ADD CONSTRAINT pa_status_check
      CHECK (status IN ('pending','review','approved','rejected','withdrawn'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pa_practitioner_idx ON practitioner_applications(practitioner_id);
CREATE INDEX IF NOT EXISTS pa_status_idx       ON practitioner_applications(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pa_deleted_idx      ON practitioner_applications(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pa_created_idx      ON practitioner_applications(created_at DESC);

ALTER TABLE practitioner_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON practitioner_applications TO service_role;

-- ── 3. PRACTITIONER_CERTIFICATIONS ──────────────────────────
-- Links practitioners to training_certifications.
-- Tracks completion, expiration, and renewal.
CREATE TABLE IF NOT EXISTS practitioner_certifications (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id           uuid        REFERENCES practitioners(id) ON DELETE CASCADE,
  training_certification_id uuid,
  completion_date           date,
  expiration_date           date,
  status                    text        NOT NULL DEFAULT 'active',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'practitioner_certifications' AND c.conname = 'pc_status_check'
  ) THEN
    ALTER TABLE practitioner_certifications ADD CONSTRAINT pc_status_check
      CHECK (status IN ('active','expired','revoked','pending'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pc_practitioner_idx ON practitioner_certifications(practitioner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pc_cert_idx         ON practitioner_certifications(training_certification_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pc_status_idx       ON practitioner_certifications(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pc_deleted_idx      ON practitioner_certifications(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE practitioner_certifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON practitioner_certifications TO service_role;

-- ── 4. PRACTITIONER_REFERRALS ────────────────────────────────
-- Routes clients to REA network practitioners.
-- Separate from `referrals` (Daron's outbound provider referrals).
CREATE TABLE IF NOT EXISTS practitioner_referrals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid,
  practitioner_id uuid        REFERENCES practitioners(id) ON DELETE CASCADE,
  reason          text,
  status          text        NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'practitioner_referrals' AND c.conname = 'pr_status_check'
  ) THEN
    ALTER TABLE practitioner_referrals ADD CONSTRAINT pr_status_check
      CHECK (status IN ('pending','accepted','completed','declined','archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pr_client_idx      ON practitioner_referrals(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pr_practitioner_idx ON practitioner_referrals(practitioner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pr_status_idx      ON practitioner_referrals(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pr_deleted_idx     ON practitioner_referrals(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pr_created_idx     ON practitioner_referrals(created_at DESC);

ALTER TABLE practitioner_referrals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON practitioner_referrals TO service_role;

-- ── VERIFY ───────────────────────────────────────────────────
SELECT table_name, COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('practitioners','practitioner_applications','practitioner_certifications','practitioner_referrals')
GROUP BY table_name
ORDER BY table_name;
