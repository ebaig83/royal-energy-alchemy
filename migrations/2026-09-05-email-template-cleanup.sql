-- Remove retired Client Portal content and align templates with current flows.
-- Apply after code deployment so intake_invitation and strict rendering ship together.

UPDATE public.email_templates
SET subject = 'Your Appointment is Confirmed — Royal Energy Alchemy',
    html_body = $html$<!doctype html><html><body style="margin:0;background:#04020e;color:#f0ecff;font-family:Georgia,serif"><div style="max-width:600px;margin:auto;padding:40px 24px"><h1 style="color:#e8b84b">Your Appointment is Confirmed</h1><p>Dear {{client_name}},</p><p>Your session with Daron Royal is confirmed.</p><table style="width:100%;background:#100b20;border:1px solid #6b5428;padding:20px"><tr><td>Service</td><td>{{service}}</td></tr><tr><td>Date</td><td>{{session_date}}</td></tr><tr><td>Time</td><td>{{session_time}} {{timezone}}</td></tr>{{#if duration}}<tr><td>Duration</td><td>{{duration}}</td></tr>{{/if}}{{#if location}}<tr><td>Location</td><td>{{location}}</td></tr>{{/if}}</table>{{#if intake_url}}<p><a href="{{intake_url}}">Complete intake form</a></p>{{/if}}<p><a href="{{manage_url}}">Manage appointment</a> · <a href="{{manage_url}}&action=reschedule">Reschedule</a> · <a href="{{manage_url}}&action=cancel">Cancel</a></p><h2 style="color:#e8b84b;font-size:16px">Cancellation Policy</h2><p>72+ hours notice: Full refund or session credit<br>24–72 hours notice: 50% refund or session credit<br>Less than 24 hours: Non-refundable<br>No-show: Non-refundable — must prepay to rebook</p><p>Questions? Contact Daron at <a href="mailto:{{contact_email}}" style="color:#e8b84b">{{contact_email}}</a> or 814-392-2095.</p></div></body></html>$html$,
    text_body = $text$APPOINTMENT CONFIRMED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your session with Daron Royal is confirmed.

Service: {{service}}
Date: {{session_date}}
Time: {{session_time}} {{timezone}}
{{#if duration}}Duration: {{duration}}
{{/if}}{{#if location}}Location: {{location}}
{{/if}}
{{#if intake_url}}Complete intake form: {{intake_url}}
{{/if}}Manage, reschedule, or cancel: {{manage_url}}

Questions? {{contact_email}} | 814-392-2095$text$,
    variables = ARRAY['client_name','service','session_date','session_time','timezone','duration','location','manage_url','intake_url','contact_email'],
    updated_at = now()
WHERE name = 'appointment_confirmation';

INSERT INTO public.email_templates (name, subject, html_body, text_body, variables, type, is_active)
VALUES (
  'intake_invitation',
  'Please Complete Your Intake — Royal Energy Alchemy',
  '<p>Dear {{client_name}},</p><p>Please complete your intake for <strong>{{service}}</strong> before your appointment.</p><p><a href="{{intake_url}}">Complete intake form</a></p><p>Questions? {{contact_email}}</p>',
  E'Dear {{client_name}},\n\nPlease complete your intake for {{service}} before your appointment:\n{{intake_url}}\n\nQuestions? {{contact_email}}',
  ARRAY['client_name','service','intake_url','contact_email'], 'transactional', true
)
ON CONFLICT (name) DO UPDATE SET subject=EXCLUDED.subject, html_body=EXCLUDED.html_body,
  text_body=EXCLUDED.text_body, variables=EXCLUDED.variables, type=EXCLUDED.type,
  is_active=true, updated_at=now();

UPDATE public.email_templates
SET html_body = '<p>Dear {{client_name}},</p><p>Your payment has been confirmed and your appointment is now confirmed.</p><p><strong>{{service}}</strong><br>{{session_date}} at {{session_time}} {{timezone}}<br>Amount paid: ${{amount_paid}}</p><p>Booking reference: {{session_reference}}<br>Payment reference: {{payment_reference}}</p><p><a href="{{manage_url}}">Manage your appointment</a>.</p>',
    text_body = E'Dear {{client_name}},\n\nYour payment has been confirmed and your appointment is now confirmed.\n\n{{service}}\n{{session_date}} at {{session_time}} {{timezone}}\nAmount paid: ${{amount_paid}}\nBooking reference: {{session_reference}}\nPayment reference: {{payment_reference}}\n\nManage your appointment: {{manage_url}}',
    updated_at = now()
WHERE name = 'stripe_payment_confirmed_client';

UPDATE public.email_templates
SET subject = 'Following Up — Royal Energy Alchemy',
    html_body = '<p>Dear {{client_name}},</p><p>Daron is checking in after your session.</p><p><a href="{{followup_url}}">Complete your private follow-up</a></p><p>Questions? {{contact_email}}</p>',
    text_body = E'Dear {{client_name}},\n\nDaron is checking in after your session. Complete your private follow-up:\n{{followup_url}}\n\nQuestions? {{contact_email}}',
    variables = ARRAY['client_name','followup_url','contact_email'],
    updated_at = now()
WHERE name = 'followup_scheduled';

-- Defense in depth: retired portal language may not remain in any active template.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.email_templates
    WHERE is_active = true AND (
      coalesce(subject,'') ~* 'client[ -]?portal' OR
      coalesce(html_body,'') ~* 'client[ -]?portal|/client-portal' OR
      coalesce(text_body,'') ~* 'client[ -]?portal|/client-portal'
    )
  ) THEN
    RAISE EXCEPTION 'Active email template still contains retired Client Portal content';
  END IF;
END $$;
