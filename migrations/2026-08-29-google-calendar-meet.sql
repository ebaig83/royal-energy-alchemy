-- Additive, opt-in fields. Existing sessions remain unsynchronized.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS google_calendar_event_id text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS google_meet_url text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS google_calendar_status text NOT NULL DEFAULT 'not_requested';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS google_calendar_error text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS google_calendar_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_google_calendar_event_id_unique
ON public.sessions (google_calendar_event_id)
WHERE google_calendar_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_google_calendar_sync_queue
ON public.sessions (google_calendar_status, session_date)
WHERE google_calendar_status IN ('pending','retryable_error','reschedule_pending','cancel_pending');

-- Extend reminder payload and add the one-time meeting-ready message.
UPDATE public.email_templates
SET html_body = CASE
      WHEN html_body IS NULL THEN NULL
      WHEN strpos(html_body, '<p>{{#if google_meet_url}}<a href="{{google_meet_url}}">JOIN GOOGLE MEET</a>{{/if}}</p>') > 0 THEN html_body
      ELSE html_body || '<p>{{#if google_meet_url}}<a href="{{google_meet_url}}">JOIN GOOGLE MEET</a>{{/if}}</p>'
    END,
    text_body = CASE
      WHEN text_body IS NULL THEN NULL
      WHEN strpos(text_body, E'\n{{#if google_meet_url}}Join Google Meet: {{google_meet_url}}{{/if}}') > 0 THEN text_body
      ELSE text_body || E'\n{{#if google_meet_url}}Join Google Meet: {{google_meet_url}}{{/if}}'
    END,
    variables = CASE
      WHEN variables IS NULL THEN ARRAY['google_meet_url']
      WHEN 'google_meet_url' = ANY(variables) THEN variables
      ELSE array_append(variables, 'google_meet_url')
    END
WHERE name = 'session_30_minute_reminder';
INSERT INTO public.email_templates (name, subject, html_body, text_body, type, variables, is_active)
VALUES ('session_google_meet_ready', 'Your Google Meet Link for Royal Energy Alchemy', '<p>Hi {{client_name}}, your {{service}} session is scheduled for {{session_date}} at {{session_time}} {{timezone}}.</p><p><a href="{{google_meet_url}}">JOIN GOOGLE MEET</a></p>', 'Your Google Meet link: {{google_meet_url}}', 'appointment_meeting_ready', ARRAY['client_name','service','session_date','session_time','timezone','google_meet_url'], true)
ON CONFLICT (name) DO NOTHING;
