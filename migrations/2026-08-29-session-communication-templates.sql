-- Additive only: seed the two automated session communication templates.
-- Existing rows are never changed.
INSERT INTO public.email_templates (name, subject, html_body, text_body, type, variables, is_active)
VALUES
('session_30_minute_reminder', 'Your session starts in 30 minutes', '<p>Hi {{client_name}}, your {{service}} session is scheduled for {{session_date}} at {{session_time}} {{timezone}}.</p>', 'Hi {{client_name}}, your {{service}} session is scheduled for {{session_date}} at {{session_time}} {{timezone}}.', 'appointment_reminder', ARRAY['client_name','service','session_date','session_time','timezone'], true),
('session_72_hour_followup', 'How are you feeling after your session?', '<p>Hi {{client_name}}, please share how you are feeling after your session: <a href="{{followup_url}}">complete your private follow-up</a>.</p>', 'Hi {{client_name}}, please complete your private follow-up: {{followup_url}}.', 'followup_reminder', ARRAY['client_name','followup_url'], true)
ON CONFLICT (name) DO NOTHING;
