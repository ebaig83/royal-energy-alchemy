-- Additive repair for practitioner-created sessions.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS client_email text,
  ADD COLUMN IF NOT EXISTS client_phone text;

COMMENT ON COLUMN public.sessions.client_email IS 'Optional contact email captured for this appointment.';
COMMENT ON COLUMN public.sessions.client_phone IS 'Optional contact telephone captured for this appointment.';

