-- Additive client rebooking control. Existing history is untouched.
BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS booking_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_block_reason text;

CREATE INDEX IF NOT EXISTS clients_booking_blocked_idx
  ON public.clients (booking_blocked)
  WHERE booking_blocked = true;

COMMIT;
