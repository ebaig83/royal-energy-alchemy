-- ── Booking & Cancellation Sprint ── 2026-06-14
-- New tables: availability_slots, cancellation_requests

-- ── 1. AVAILABILITY SLOTS ─────────────────────────────────────────────────────
-- Single source of truth for Daron's public appointment availability.
-- Dashboard writes slots here; public calendar reads them.

CREATE TABLE IF NOT EXISTS availability_slots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date      date        NOT NULL,
  slot_time      time        NOT NULL,
  label          text,                          -- e.g. "Thu, Jun 19 at 7:00 PM"
  display_time   text,                          -- e.g. "7:00 PM"
  status         text        NOT NULL DEFAULT 'available'
                             CHECK (status IN ('available','booked','blocked','cancelled')),
  session_id     uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_date, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_avail_date   ON availability_slots (slot_date);
CREATE INDEX IF NOT EXISTS idx_avail_status ON availability_slots (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_availability_slots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_avail_updated ON availability_slots;
CREATE TRIGGER trg_avail_updated
  BEFORE UPDATE ON availability_slots
  FOR EACH ROW EXECUTE FUNCTION update_availability_slots_updated_at();

-- RLS: public can read available slots; only service role can write
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY avail_read_public ON availability_slots FOR SELECT USING (true);
CREATE POLICY avail_write_service ON availability_slots FOR ALL USING (false);

GRANT SELECT ON availability_slots TO anon, authenticated;


-- ── 2. CANCELLATION REQUESTS ──────────────────────────────────────────────────
-- Client-submitted cancellation requests; Daron approves/denies in dashboard.
-- Sessions are NEVER deleted — only marked cancelled.

CREATE TABLE IF NOT EXISTS cancellation_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Client info (submitted from public form)
  client_name          text        NOT NULL,
  email                text        NOT NULL,
  phone                text,
  appointment_date     date        NOT NULL,
  appointment_time     time,
  service              text,
  payment_method       text,
  reason               text        NOT NULL,
  wants_reschedule     boolean     NOT NULL DEFAULT false,
  additional_notes     text,

  -- Computed refund eligibility (calculated server-side at submission)
  hours_until_appt     numeric,
  refund_eligible      boolean     NOT NULL DEFAULT false,
  refund_estimate      text,       -- human-readable: "50% refund", "Non-refundable", etc.
  refund_pct           numeric,    -- 0–100

  -- Linked records (matched by email + date)
  session_id           uuid        REFERENCES sessions(id) ON DELETE SET NULL,

  -- Admin review
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','approved','denied','rescheduled','no_show')),
  admin_notes          text,
  refund_approved_amt  numeric,
  approved_by          text,
  approved_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cancel_email  ON cancellation_requests (email);
CREATE INDEX IF NOT EXISTS idx_cancel_date   ON cancellation_requests (appointment_date);
CREATE INDEX IF NOT EXISTS idx_cancel_status ON cancellation_requests (status);

CREATE OR REPLACE FUNCTION update_cancellation_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_cancel_updated ON cancellation_requests;
CREATE TRIGGER trg_cancel_updated
  BEFORE UPDATE ON cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION update_cancellation_requests_updated_at();

-- Public can INSERT (submit request); only service role can UPDATE
ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY cancel_insert_public ON cancellation_requests FOR INSERT WITH CHECK (true);
CREATE POLICY cancel_read_service  ON cancellation_requests FOR SELECT USING (false);
CREATE POLICY cancel_write_service ON cancellation_requests FOR UPDATE USING (false);

GRANT INSERT ON cancellation_requests TO anon, authenticated;

-- ── 3. ADD cancel_reason / refund_decision columns to sessions ────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS cancel_reason       text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_status        text CHECK (refund_status IN ('none','approved','denied','partial')),
  ADD COLUMN IF NOT EXISTS refund_amount        numeric;
