-- ── Sprint 17 (Phase A) — Confirmation email: website portal access line ─────
-- Adds one sentence telling clients they can also reach the portal from the
-- website using their booked email. Appended right after the existing
-- {{portal_url}} block in BOTH bodies. Idempotent (guarded by NOT LIKE) and
-- preserves every previously-verified field.

-- Plain text
UPDATE email_templates
SET text_body = replace(
      text_body,
      'Open Client Portal:' || chr(10) || '{{portal_url}}',
      'Open Client Portal:' || chr(10) || '{{portal_url}}' || chr(10) || chr(10) ||
      'You may also access your Client Portal from the website using the email you booked with.'),
    updated_at = now()
WHERE name = 'appointment_confirmation'
  AND text_body LIKE '%Open Client Portal:%'
  AND text_body NOT LIKE '%using the email you booked with%';

-- HTML
UPDATE email_templates
SET html_body = replace(
      html_body,
      'Open Client Portal &rarr;</a>',
      'Open Client Portal &rarr;</a><p style="margin:12px 0 0;font-size:13px;color:rgba(200,196,224,0.8);line-height:1.6">You may also access your Client Portal from the website using the email you booked with.</p>'),
    updated_at = now()
WHERE name = 'appointment_confirmation'
  AND html_body LIKE '%Open Client Portal &rarr;</a>%'
  AND html_body NOT LIKE '%using the email you booked with%';
