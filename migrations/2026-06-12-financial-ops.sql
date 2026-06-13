-- ============================================================
-- Royal Energy Alchemy — Financial Operations Migration
-- Run in Supabase SQL Editor
-- ============================================================

-- ── PACKAGES ─────────────────────────────────────────────────
-- Tracks purchase of session bundles. Source of truth for
-- how many sessions a client has bought, used, and remaining.
CREATE TABLE IF NOT EXISTS packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_name       text,                   -- denormalized for fast display
  package_type      text NOT NULL,          -- single | 3_session | 5_session | 10_session | custom
  package_name      text NOT NULL,          -- display name (can be customized)
  sessions_included integer NOT NULL DEFAULT 1,
  sessions_used     integer NOT NULL DEFAULT 0,
  sessions_remaining integer GENERATED ALWAYS AS (sessions_included - sessions_used) STORED,
  purchase_date     date NOT NULL DEFAULT CURRENT_DATE,
  expiration_date   date,                   -- NULL = no expiry
  purchase_price    numeric(8,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active',  -- active | completed | expired | cancelled
  notes             text,
  created_by        text DEFAULT 'daron',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT packages_status_check CHECK (status IN ('active','completed','expired','cancelled')),
  CONSTRAINT packages_type_check   CHECK (package_type IN ('single','3_session','5_session','10_session','custom')),
  CONSTRAINT packages_used_check   CHECK (sessions_used >= 0 AND sessions_used <= sessions_included)
);

CREATE INDEX IF NOT EXISTS packages_client_idx  ON packages(client_id);
CREATE INDEX IF NOT EXISTS packages_status_idx  ON packages(status);
CREATE INDEX IF NOT EXISTS packages_expiry_idx  ON packages(expiration_date) WHERE expiration_date IS NOT NULL;

-- ── PACKAGE SESSIONS (junction) ───────────────────────────────
-- Links a completed session to the package it consumed.
CREATE TABLE IF NOT EXISTS package_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  used_at     timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pkg_sess_package_idx ON package_sessions(package_id);
CREATE INDEX IF NOT EXISTS pkg_sess_session_idx ON package_sessions(session_id);

-- ── LEDGER ENTRIES ────────────────────────────────────────────
-- Financial source of truth. All money movement flows here.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_name   text,                       -- denormalized
  entry_type    text NOT NULL,              -- charge | payment | credit | refund | adjustment | write_off
  description   text NOT NULL,
  amount        numeric(8,2) NOT NULL,      -- always positive
  balance_impact numeric(8,2) NOT NULL,     -- positive = increases balance owed, negative = reduces it
  related_session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  related_payment_id  uuid REFERENCES payments(id) ON DELETE SET NULL,
  related_package_id  uuid REFERENCES packages(id) ON DELETE SET NULL,
  invoice_id    uuid,                       -- FK added after invoices table created below
  created_by    text DEFAULT 'daron',
  notes         text,
  entry_date    date NOT NULL DEFAULT CURRENT_DATE,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT ledger_entry_type_check CHECK (entry_type IN ('charge','payment','credit','refund','adjustment','write_off'))
);

CREATE INDEX IF NOT EXISTS ledger_client_idx ON ledger_entries(client_id);
CREATE INDEX IF NOT EXISTS ledger_date_idx   ON ledger_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS ledger_type_idx   ON ledger_entries(entry_type);

-- ── INVOICES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text UNIQUE NOT NULL,     -- INV-2026-001 format
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_name     text,
  issue_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date        date,
  subtotal        numeric(8,2) NOT NULL DEFAULT 0,
  adjustment      numeric(8,2) NOT NULL DEFAULT 0,   -- negative = discount, positive = fee
  total           numeric(8,2) GENERATED ALWAYS AS (subtotal + adjustment) STORED,
  amount_paid     numeric(8,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft',     -- draft | sent | paid | partial | overdue | cancelled
  notes           text,
  created_by      text DEFAULT 'daron',
  sent_at         timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT invoices_status_check CHECK (status IN ('draft','sent','paid','partial','overdue','cancelled'))
);

CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices(client_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);
CREATE INDEX IF NOT EXISTS invoices_date_idx   ON invoices(issue_date DESC);

-- ── INVOICE ITEMS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1,
  unit_price  numeric(8,2) NOT NULL,
  amount      numeric(8,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  package_id  uuid REFERENCES packages(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_items_inv_idx ON invoice_items(invoice_id);

-- Now wire the invoice FK back into ledger_entries (idempotent)
DO $$ BEGIN
  ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_invoice_fk
    FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END; $$;

-- ── PAYMENT REQUESTS ──────────────────────────────────────────
-- Architecture for future payment link integrations (CashApp, Stripe, etc.)
CREATE TABLE IF NOT EXISTS payment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  client_name   text,
  invoice_id    uuid REFERENCES invoices(id) ON DELETE SET NULL,
  amount        numeric(8,2) NOT NULL,
  method        text DEFAULT 'cash_app',    -- cash_app | stripe | square | venmo | zelle | paypal
  status        text DEFAULT 'pending',     -- pending | sent | paid | expired | cancelled
  request_url   text,                       -- future: payment link URL
  external_id   text,                       -- future: processor transaction ID
  expires_at    timestamptz,
  paid_at       timestamptz,
  notes         text,
  created_by    text DEFAULT 'daron',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT payment_requests_status_check CHECK (status IN ('pending','sent','paid','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS pay_req_client_idx  ON payment_requests(client_id);
CREATE INDEX IF NOT EXISTS pay_req_status_idx  ON payment_requests(status);

-- ── FINANCIAL ALERTS ──────────────────────────────────────────
-- Machine-generated alerts for the practitioner (1 session left, package expiring, etc.)
CREATE TABLE IF NOT EXISTS financial_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id) ON DELETE CASCADE,
  client_name   text,
  alert_type    text NOT NULL,  -- package_expiring | package_low | package_expired | outstanding_balance | renewal_opportunity
  severity      text DEFAULT 'medium',     -- low | medium | high | critical
  title         text NOT NULL,
  body          text,
  related_package_id  uuid REFERENCES packages(id) ON DELETE CASCADE,
  related_invoice_id  uuid REFERENCES invoices(id) ON DELETE SET NULL,
  is_read       boolean DEFAULT false,
  resolved_at   timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  CONSTRAINT fin_alert_type_check CHECK (alert_type IN (
    'package_expiring','package_low','package_expired',
    'outstanding_balance','renewal_opportunity','invoice_overdue'
  )),
  CONSTRAINT fin_alert_sev_check CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS fin_alert_client_idx ON financial_alerts(client_id);
CREATE INDEX IF NOT EXISTS fin_alert_type_idx   ON financial_alerts(alert_type);
CREATE INDEX IF NOT EXISTS fin_alert_read_idx   ON financial_alerts(is_read) WHERE NOT is_read;

-- ── RLS — deny direct browser access; service_role bypasses ──
ALTER TABLE packages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_alerts  ENABLE ROW LEVEL SECURITY;

-- ── auto touch_updated_at triggers ────────────────────────────
CREATE TRIGGER packages_updated_at
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER ledger_updated_at
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER payment_requests_updated_at
  BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER financial_alerts_updated_at
  BEFORE UPDATE ON financial_alerts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Invoice number sequence helper ────────────────────────────
-- Usage: SELECT nextval('invoice_number_seq');
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- ── Seed: demo package types (no client data — just config reference)
-- (No seed data — all packages are created by the practitioner)

-- ── Validation ────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'packages','package_sessions','ledger_entries',
    'invoices','invoice_items','payment_requests','financial_alerts'
  )
ORDER BY table_name;
