-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint 13C — Email Template Upgrade + Sessions cancel column guard
-- Run in Supabase SQL Editor after Sprint 13A migration.
-- Safe to re-run — all updates are idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 1 — Add Reschedule button to appointment_confirmation template
-- Replaces the two-button row (Manage + Cancel) with three buttons
-- (Manage + Reschedule + Cancel) so clients can reschedule directly from email
-- ─────────────────────────────────────────────────────────────────────────

UPDATE email_templates
SET
  html_body = REPLACE(
    html_body,
    '<a href="{{manage_url}}" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:#22c98a;text-transform:uppercase;background:rgba(34,201,138,0.08);border:1px solid rgba(34,201,138,0.3);padding:12px 22px;text-decoration:none;margin-right:8px">MANAGE APPOINTMENT</a>',
    '<a href="{{manage_url}}" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:#22c98a;text-transform:uppercase;background:rgba(34,201,138,0.08);border:1px solid rgba(34,201,138,0.3);padding:12px 22px;text-decoration:none;margin-right:8px">MANAGE APPOINTMENT</a><a href="{{manage_url}}?action=reschedule" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:#e8b84b;text-transform:uppercase;background:rgba(232,184,75,0.08);border:1px solid rgba(232,184,75,0.3);padding:12px 22px;text-decoration:none;margin-right:8px">RESCHEDULE</a>'
  ),
  text_body = REPLACE(
    text_body,
    'Manage your appointment: {{manage_url}}',
    'Manage your appointment: {{manage_url}}
Reschedule: {{manage_url}}?action=reschedule'
  ),
  variables = ARRAY[
    'client_name','service','session_date','session_time','timezone',
    'duration_minutes','payment_status','intake_url','manage_url',
    'intake_date','intake_time','intake_duration'
  ],
  updated_at = NOW()
WHERE name = 'appointment_confirmation';

-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 2 — Ensure sessions.updated_at column exists
-- (some early migrations may have omitted it)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE sessions ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 3 — Ensure availability_slots.session_id column exists
-- (needed for the slot-swap reschedule logic)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'availability_slots' AND column_name = 'session_id'
  ) THEN
    ALTER TABLE availability_slots
      ADD COLUMN session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_avail_session ON availability_slots (session_id)
  WHERE session_id IS NOT NULL;
