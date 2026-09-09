BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS payment_request_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_payment_request_reference_uidx
  ON public.sessions (payment_request_reference)
  WHERE payment_request_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.practitioner_payment_settings (
  practitioner_key text PRIMARY KEY,
  venmo_enabled boolean NOT NULL DEFAULT false,
  venmo_label text,
  venmo_destination text,
  cash_app_enabled boolean NOT NULL DEFAULT false,
  cash_app_label text,
  cash_app_destination text,
  paypal_enabled boolean NOT NULL DEFAULT false,
  paypal_label text,
  paypal_destination text,
  zelle_enabled boolean NOT NULL DEFAULT false,
  zelle_label text,
  zelle_destination text,
  other_enabled boolean NOT NULL DEFAULT false,
  other_label text,
  other_destination text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practitioner_payment_settings_length CHECK (
    coalesce(length(venmo_label), 0) <= 120 AND coalesce(length(venmo_destination), 0) <= 500 AND
    coalesce(length(cash_app_label), 0) <= 120 AND coalesce(length(cash_app_destination), 0) <= 500 AND
    coalesce(length(paypal_label), 0) <= 120 AND coalesce(length(paypal_destination), 0) <= 500 AND
    coalesce(length(zelle_label), 0) <= 120 AND coalesce(length(zelle_destination), 0) <= 500 AND
    coalesce(length(other_label), 0) <= 120 AND coalesce(length(other_destination), 0) <= 1000
  )
);

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('venmo', 'cash_app', 'paypal', 'zelle', 'other')),
  amount_due numeric(12,2) NOT NULL CHECK (amount_due > 0),
  safe_reference text NOT NULL UNIQUE CHECK (safe_reference ~ '^REA-[A-Z0-9]{6,12}$'),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practitioner_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.practitioner_payment_settings FROM anon, authenticated;
REVOKE ALL ON public.payment_requests FROM anon, authenticated;
GRANT ALL ON public.practitioner_payment_settings TO service_role;
GRANT ALL ON public.payment_requests TO service_role;

INSERT INTO public.practitioner_payment_settings (practitioner_key)
VALUES ('default')
ON CONFLICT (practitioner_key) DO NOTHING;

INSERT INTO public.email_templates (name, type, subject, html_body, text_body, variables, is_active)
VALUES (
  'practitioner_off_platform_payment_request',
  'general_message',
  'Payment instructions for your Royal Energy Alchemy session',
  '<p>Hi {{client_name}},</p><p>Please send <strong>{{amount_due}}</strong> using {{payment_provider}} for your upcoming {{service}} session.</p><p>{{payment_instructions}}</p><p>Appointment: {{session_date}} {{session_time}} Eastern</p><p>Payment reference: <strong>{{payment_reference}}</strong></p><p>This request does not confirm payment. Your appointment remains subject to payment verification.</p>',
  'Hi {{client_name}}, please send {{amount_due}} using {{payment_provider}} for your {{service}} session.\n{{payment_instructions}}\nAppointment: {{session_date}} {{session_time}} Eastern\nPayment reference: {{payment_reference}}\nThis request does not confirm payment.',
  ARRAY['client_name','amount_due','payment_provider','payment_instructions','session_date','session_time','service','payment_reference'],
  true
)
ON CONFLICT (name) DO UPDATE SET
  type = EXCLUDED.type,
  subject = EXCLUDED.subject,
  html_body = EXCLUDED.html_body,
  text_body = EXCLUDED.text_body,
  variables = EXCLUDED.variables,
  is_active = true;

COMMIT;
