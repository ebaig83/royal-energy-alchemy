begin;

create table if not exists public.transactional_notifications (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  stripe_event_id text,
  recipient text not null,
  notification_type text not null,
  status text not null default 'reserved',
  attempt_count integer not null default 1,
  provider_message_id text,
  reserved_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactional_notifications_status_check
    check (status in ('reserved', 'sent', 'failed'))
);

create index if not exists idx_transactional_notifications_event
  on public.transactional_notifications (stripe_event_id, notification_type);

alter table public.transactional_notifications enable row level security;

insert into public.email_templates (name, subject, html_body, text_body, variables, type, is_active)
values
(
  'booking_received_pending_payment',
  'Booking Received — Complete Waiver and Payment',
  '<p>Dear {{client_name}},</p><p>We received your booking request for <strong>{{service}}</strong> on {{session_date}} at {{session_time}} {{timezone}}.</p><p><strong>Your appointment is not confirmed yet.</strong> Please complete your waiver and secure online payment:</p><p><a href="{{waiver_url}}">Complete waiver and payment</a></p><p>Reference: {{session_reference}}</p>',
  'Dear {{client_name}},\n\nWe received your booking request for {{service}} on {{session_date}} at {{session_time}} {{timezone}}.\n\nYour appointment is not confirmed yet. Complete your waiver and secure online payment: {{waiver_url}}\n\nReference: {{session_reference}}',
  array['client_name','service','session_date','session_time','timezone','waiver_url','session_reference'],
  'transactional', true
),
(
  'stripe_payment_confirmed_client',
  'Payment Received — Appointment Confirmed',
  '<p>Dear {{client_name}},</p><p>Your payment has been confirmed and your appointment is now confirmed.</p><p><strong>{{service}}</strong><br>{{session_date}} at {{session_time}} {{timezone}}<br>Amount paid: ${{amount_paid}}</p><p>Booking reference: {{session_reference}}<br>Payment reference: {{payment_reference}}</p><p>Please keep your appointment time available and complete any remaining client documents. <a href="{{manage_url}}">Manage your appointment</a>.</p>',
  'Dear {{client_name}},\n\nYour payment has been confirmed and your appointment is now confirmed.\n\n{{service}}\n{{session_date}} at {{session_time}} {{timezone}}\nAmount paid: ${{amount_paid}}\nBooking reference: {{session_reference}}\nPayment reference: {{payment_reference}}\n\nManage your appointment: {{manage_url}}',
  array['client_name','service','session_date','session_time','timezone','amount_paid','session_reference','payment_reference','manage_url'],
  'transactional', true
),
(
  'stripe_payment_confirmed_practitioner',
  'New Paid Booking — {{client_name}}',
  '<p>A new booking has been paid and confirmed.</p><p>Client: {{client_name}}<br>Service: {{service}}<br>Appointment: {{session_date}} at {{session_time}} {{timezone}}<br>Amount paid: ${{amount_paid}}<br>Session: {{session_reference}}<br>Payment: {{payment_reference}}</p><p><a href="{{dashboard_url}}">Open dashboard</a></p>',
  'New paid booking\n\nClient: {{client_name}}\nService: {{service}}\nAppointment: {{session_date}} at {{session_time}} {{timezone}}\nAmount paid: ${{amount_paid}}\nSession: {{session_reference}}\nPayment: {{payment_reference}}\nDashboard: {{dashboard_url}}',
  array['client_name','service','session_date','session_time','timezone','amount_paid','session_reference','payment_reference','dashboard_url'],
  'transactional', true
),
(
  'stripe_refund_confirmed_client',
  'Refund Confirmed — Royal Energy Alchemy',
  '<p>Dear {{client_name}},</p><p>Stripe has confirmed a refund of <strong>${{refunded_amount}}</strong> for session {{session_reference}}.</p><p>Refund reference: {{refund_reference}}</p><p>Posting time varies by bank, card, and payment method.</p>',
  'Dear {{client_name}},\n\nStripe has confirmed a refund of ${{refunded_amount}} for session {{session_reference}}.\nRefund reference: {{refund_reference}}\n\nPosting time varies by bank, card, and payment method.',
  array['client_name','refunded_amount','session_reference','refund_reference'],
  'transactional', true
),
(
  'stripe_refund_confirmed_practitioner',
  'Refund Processed — {{client_name}}',
  '<p>A Stripe refund has been confirmed.</p><p>Client: {{client_name}}<br>Service: {{service}}<br>Appointment: {{session_date}} at {{session_time}}<br>Refunded: ${{refunded_amount}}<br>Session: {{session_reference}}<br>Refund: {{refund_reference}}</p>',
  'Stripe refund confirmed\n\nClient: {{client_name}}\nService: {{service}}\nAppointment: {{session_date}} at {{session_time}}\nRefunded: ${{refunded_amount}}\nSession: {{session_reference}}\nRefund: {{refund_reference}}',
  array['client_name','service','session_date','session_time','refunded_amount','session_reference','refund_reference'],
  'transactional', true
),
(
  'stripe_payment_failed_client',
  'Payment Was Not Completed — Retry Securely',
  '<p>Dear {{client_name}},</p><p>Your payment for {{service}} was not completed. No card or wallet details are included in this email.</p><p><a href="{{retry_url}}">Return to secure payment</a></p><p>Session reference: {{session_reference}}</p>',
  'Dear {{client_name}},\n\nYour payment for {{service}} was not completed. No card or wallet details are included in this email.\n\nRetry securely: {{retry_url}}\nSession reference: {{session_reference}}',
  array['client_name','service','retry_url','session_reference'],
  'transactional', true
)
on conflict (name) do update set
  subject = excluded.subject,
  html_body = excluded.html_body,
  text_body = excluded.text_body,
  variables = excluded.variables,
  type = excluded.type,
  is_active = excluded.is_active,
  updated_at = now();

commit;
