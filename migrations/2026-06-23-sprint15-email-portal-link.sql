-- ── Sprint 15 — Appointment confirmation: client portal link ─────────────────
-- Ensures BOTH the HTML and plain-text appointment_confirmation bodies show a
-- clear "Required Client Documents" section with a button-style portal link.
-- Existing session details, intake link, manage/reschedule/cancel links, and
-- cancellation policy are all preserved.
--
-- Idempotent:
--   • text_body is overwritten deterministically (same result every run).
--   • html_body is patched via replace() guarded by NOT LIKE, so re-running
--     does not duplicate the block.
-- Safe to run after 2026-06-22-sprint15-policy-documents.sql.

-- ── 1. Register the variables used by the portal section ──────────────────────
UPDATE email_templates
SET variables = (
      SELECT ARRAY(SELECT DISTINCT unnest(
        variables || ARRAY['portal_url','documents_message','waiver_url','cancel_url','service_name']
      ))
    ),
    updated_at = now()
WHERE name = 'appointment_confirmation';

-- ── 2. Deterministic plain-text body (full, with documents section) ───────────
UPDATE email_templates
SET text_body = 'APPOINTMENT CONFIRMED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your session with Daron Royal is confirmed.

SESSION DETAILS
Service:  {{service}}
Date:     {{session_date}}
Time:     {{session_time}} {{timezone}}
Duration: {{duration}}
Location: {{location}}

{{#if intake_url}}
ACTION REQUIRED — COMPLETE YOUR INTAKE FORM
Please complete your Full Intake Form before your session:
{{intake_url}}
{{/if}}

REQUIRED CLIENT DOCUMENTS

Before your appointment, please complete your required documents in the client portal:
- Privacy Policy
- AI Use, Recording & Transcription Disclosure
- Recording Policy
- Cancellation Policy
- Payment Policy
- Waiver / Legal Agreement
- Full Intake

Open Client Portal:
{{portal_url}}

MANAGE YOUR APPOINTMENT
{{manage_url}}

CANCELLATION POLICY
72+ hours notice: Full refund or session credit
24–72 hours notice: 50% refund or session credit
Less than 24 hours: Non-refundable
No-show: Non-refundable — must prepay to rebook

Questions? Contact Daron:
{{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
    updated_at = now()
WHERE name = 'appointment_confirmation';

-- ── 3. Patch the HTML body — insert the documents block before "Manage" ───────
-- Uses email-safe inline styles + table layout (Resend / Gmail / mobile clients).
UPDATE email_templates
SET html_body = replace(
      html_body,
      '<tr><td style="padding:28px 0 8px"><p style="margin:0 0 16px;font-size:11px;letter-spacing:0.4em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Manage Your Appointment</p>',
      '<tr><td style="padding:24px 0 0"><table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(232,184,75,0.06);border:1px solid rgba(232,184,75,0.25)"><tr><td style="padding:20px 24px"><p style="margin:0 0 6px;font-size:10px;letter-spacing:0.4em;color:rgba(232,184,75,0.7);text-transform:uppercase">Required Client Documents</p><p style="margin:6px 0 12px;font-size:16px;color:#c8c4e0;line-height:1.7">Before your appointment, please complete your required documents in the client portal:</p><p style="margin:0 0 16px;font-size:14px;color:rgba(200,196,224,0.85);line-height:1.95">&bull; Privacy Policy<br>&bull; AI Use, Recording &amp; Transcription Disclosure<br>&bull; Recording Policy<br>&bull; Cancellation Policy<br>&bull; Payment Policy<br>&bull; Waiver / Legal Agreement<br>&bull; Full Intake</p><a href="{{portal_url}}" style="display:inline-block;background:linear-gradient(135deg,#f8e090,#e8b84b);color:#160a00;font-family:Georgia,serif;font-size:12px;letter-spacing:0.32em;text-transform:uppercase;text-decoration:none;padding:14px 26px;font-weight:bold">Open Client Portal &rarr;</a></td></tr></table></td></tr>' ||
      '<tr><td style="padding:28px 0 8px"><p style="margin:0 0 16px;font-size:11px;letter-spacing:0.4em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Manage Your Appointment</p>'
    ),
    updated_at = now()
WHERE name = 'appointment_confirmation'
  AND html_body NOT LIKE '%Required Client Documents%';
