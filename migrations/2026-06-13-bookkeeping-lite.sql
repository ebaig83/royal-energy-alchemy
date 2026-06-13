-- ============================================================
-- Royal Energy Alchemy — Bookkeeping Lite Migration
-- Sprint 1 / Phase A
-- Run in: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── EXPENSES ─────────────────────────────────────────────────
-- Business expense tracking for P&L and tax preparation.
-- One row per expense entry. Soft-deleted via deleted_at.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expenses (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date       date         NOT NULL DEFAULT CURRENT_DATE,
  category           text         NOT NULL,
  description        text         NOT NULL,
  amount             numeric(8,2) NOT NULL,
  vendor             text,
  payment_method     text         NOT NULL DEFAULT 'personal',
  tax_deductible     boolean      NOT NULL DEFAULT false,
  receipt_url        text,
  related_session_id uuid         REFERENCES sessions(id) ON DELETE SET NULL,
  notes              text,
  created_by         text         NOT NULL DEFAULT 'daron',
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT expenses_category_check CHECK (
    category IN (
      'supplies','marketing','education','software',
      'professional','travel','other'
    )
  ),
  CONSTRAINT expenses_payment_method_check CHECK (
    payment_method IN ('personal','business','venmo','cash','check','card')
  ),
  CONSTRAINT expenses_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS expenses_date_idx        ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS expenses_category_idx    ON expenses(category);
CREATE INDEX IF NOT EXISTS expenses_tax_idx         ON expenses(tax_deductible);
CREATE INDEX IF NOT EXISTS expenses_deleted_idx     ON expenses(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS expenses_session_idx     ON expenses(related_session_id) WHERE related_session_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────
-- service_role bypasses RLS. Anon and authenticated roles are
-- denied all access. Same pattern as every other table in schema.

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
-- Must run after table creation. Mirrors fix_service_role_grants.sql.
-- The ALTER DEFAULT PRIVILEGES in that file covers future tables,
-- but running the explicit grant here ensures it takes effect
-- immediately without relying on session order.

GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO service_role;

-- ── VALIDATION QUERY ─────────────────────────────────────────
-- Run after migration to confirm table and columns exist:
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'expenses'
-- ORDER BY ordinal_position;
--
-- Expected: 16 columns (id through deleted_at)
-- ─────────────────────────────────────────────────────────────
