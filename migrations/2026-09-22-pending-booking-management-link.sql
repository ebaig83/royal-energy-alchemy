begin;

-- These messages already receive a scoped signed manage_url from their
-- handlers. Expose it to clients; never authorize appointment actions by UUID.
update public.email_templates
set html_body = coalesce(html_body, '') || '<p><a href="{{manage_url}}">Manage Appointment</a> to cancel or request a different time.</p>',
    text_body = coalesce(text_body, '') || E'\n\nManage Appointment (cancel or request a different time): {{manage_url}}',
    variables = case when 'manage_url' = any(variables) then variables else array_append(variables, 'manage_url') end,
    updated_at = now()
where name in ('booking_received_pending_payment', 'session_google_meet_ready', 'session_30_minute_reminder')
  and position('{{manage_url}}' in coalesce(html_body, '') || coalesce(text_body, '')) = 0;

commit;
