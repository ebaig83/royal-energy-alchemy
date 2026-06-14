-- ============================================================
-- Royal Energy Alchemy — Referral & Lead Pipeline (Sprint 9)
-- Tables: leads, referral_sources
-- All statements idempotent — safe to run more than once.
-- Run in: Supabase → SQL Editor → New query → Run
--
-- NOTE: The existing `referrals` table (referrals.js) tracks
-- outbound provider referrals (therapist, PCP, etc.) and is
-- NOT modified here. `referral_sources` tracks who sends leads
-- to REA — a completely separate concept.
-- ============================================================

-- ── 1. REFERRAL_SOURCES ──────────────────────────────────────
-- Who/what sends leads to REA.
-- Separate from `referrals` (outbound provider referrals).
CREATE TABLE IF NOT EXISTS referral_sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  source_type   text        NOT NULL DEFAULT 'other',
  contact_info  text,
  notes         text,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'referral_sources' AND c.conname = 'rs_type_check'
  ) THEN
    ALTER TABLE referral_sources ADD CONSTRAINT rs_type_check
      CHECK (source_type IN (
        'client','practitioner','business','social_media',
        'website','event','workshop','other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rs_type_idx    ON referral_sources(source_type);
CREATE INDEX IF NOT EXISTS rs_active_idx  ON referral_sources(active);
CREATE INDEX IF NOT EXISTS rs_created_idx ON referral_sources(created_at DESC);

ALTER TABLE referral_sources ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON referral_sources TO service_role;

-- ── 2. LEADS ────────────────────────────────────────────────
-- Prospect pipeline from first contact through conversion.
CREATE TABLE IF NOT EXISTS leads (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name          text        NOT NULL,
  last_name           text,
  email               text,
  phone               text,
  source              text        NOT NULL DEFAULT 'other',
  source_detail       text,
  referral_source_id  uuid        REFERENCES referral_sources(id) ON DELETE SET NULL,
  interested_service  text,
  status              text        NOT NULL DEFAULT 'new',
  notes               text,
  assigned_to         text,
  first_contact_date  date,
  last_contact_date   date,
  converted_client_id uuid,
  converted_at        timestamptz,
  converted_service   text,
  converted_revenue   numeric(10,2),
  contact_count       integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'leads' AND c.conname = 'leads_status_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_status_check
      CHECK (status IN ('new','contacted','consultation','booked','converted','lost','archived'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'leads' AND c.conname = 'leads_source_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_source_check
      CHECK (source IN (
        'website','facebook','instagram','tiktok','youtube',
        'referral','workshop','event','returning_client',
        'google','email','phone','other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_status_idx      ON leads(status)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_source_idx      ON leads(source)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_email_idx       ON leads(email)               WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_deleted_idx     ON leads(deleted_at)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_created_idx     ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS leads_referral_idx    ON leads(referral_source_id)  WHERE referral_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_converted_idx   ON leads(converted_client_id) WHERE converted_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_contact_idx     ON leads(last_contact_date)   WHERE deleted_at IS NULL;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads TO service_role;

-- ── VERIFY ───────────────────────────────────────────────────
SELECT table_name, COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('leads','referral_sources')
GROUP BY table_name
ORDER BY table_name;
