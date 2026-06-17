-- Sprint 13D Migration
-- Booking Confirmation Email, Cancellation Policy, Appointment Lifecycle
-- Run in Supabase SQL Editor

-- ── 1. Aftercare: new columns for expanded check-in intelligence ──────────
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS response_data               jsonb;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS outcome_response_at         timestamptz;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS completed_at                timestamptz;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS recommendations_not_followed text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS protection_frequency         text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS breakthroughs               text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS challenges_remaining         text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS techniques_used             text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS symptoms_improved           text;
ALTER TABLE aftercare ADD COLUMN IF NOT EXISTS symptoms_worsened           text;

-- ── 1b. Client communication preferences ─────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_contact   text DEFAULT 'email';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS followup_preference text DEFAULT 'email';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_consent       boolean DEFAULT true;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_consent         boolean DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS call_consent        boolean DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_call_consent     boolean DEFAULT false;

-- ── 2. Redesign appointment_confirmation email template ───────────────────
UPDATE email_templates
SET
  subject    = 'Your Appointment is Confirmed — Royal Energy Alchemy',
  html_body  = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Appointment Confirmed</title></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(232,184,75,0.3);padding:40px 40px 32px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;border-bottom:1px solid rgba(232,184,75,0.2)"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0;font-size:28px;color:#e8b84b;font-weight:normal;letter-spacing:0.06em">Your Appointment<br>is Confirmed</h1></td></tr><tr><td style="padding:28px 0 20px"><p style="margin:0 0 20px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 20px;font-size:16px;color:#c8c4e0;line-height:1.8;font-style:italic">Your session with Daron Royal is confirmed. Everything you need to know is below.</p></td></tr><tr><td style="background:rgba(232,184,75,0.06);border:1px solid rgba(232,184,75,0.25);padding:24px 28px;margin-bottom:24px"><p style="margin:0 0 6px;font-size:10px;letter-spacing:0.4em;color:rgba(232,184,75,0.7);text-transform:uppercase;font-family:Georgia,serif">Your Session</p><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="padding:6px 0;font-size:11px;letter-spacing:0.3em;color:rgba(153,144,192,0.7);text-transform:uppercase;width:40%">Service</td><td style="padding:6px 0;font-size:17px;color:#f0ecff;font-weight:bold">{{service}}</td></tr><tr><td style="padding:6px 0;font-size:11px;letter-spacing:0.3em;color:rgba(153,144,192,0.7);text-transform:uppercase">Date</td><td style="padding:6px 0;font-size:17px;color:#f0ecff">{{session_date}}</td></tr><tr><td style="padding:6px 0;font-size:11px;letter-spacing:0.3em;color:rgba(153,144,192,0.7);text-transform:uppercase">Time</td><td style="padding:6px 0;font-size:17px;color:#f0ecff">{{session_time}} {{timezone}}</td></tr><tr><td style="padding:6px 0;font-size:11px;letter-spacing:0.3em;color:rgba(153,144,192,0.7);text-transform:uppercase">Duration</td><td style="padding:6px 0;font-size:17px;color:#f0ecff">{{duration}}</td></tr><tr><td style="padding:6px 0;font-size:11px;letter-spacing:0.3em;color:rgba(153,144,192,0.7);text-transform:uppercase">Location</td><td style="padding:6px 0;font-size:17px;color:#f0ecff">{{location}}</td></tr></table></td></tr>{{#if intake_url}}<tr><td style="padding:24px 0 0"><table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(34,201,138,0.06);border:1px solid rgba(34,201,138,0.25);padding:20px 24px"><tr><td><p style="margin:0 0 6px;font-size:10px;letter-spacing:0.4em;color:rgba(34,201,138,0.7);text-transform:uppercase">Action Required</p><p style="margin:6px 0 14px;font-size:16px;color:#c8c4e0;line-height:1.7">Please complete your Full Intake Form before your session. This helps Daron prepare the most effective healing work for you.</p><a href="{{intake_url}}" style="display:inline-block;background:linear-gradient(135deg,#34e89e,#22c98a);color:#000;font-family:Georgia,serif;font-size:12px;letter-spacing:0.35em;text-transform:uppercase;text-decoration:none;padding:14px 24px">Complete Intake Form →</a></td></tr></table></td></tr>{{/if}}<tr><td style="padding:28px 0 8px"><p style="margin:0 0 16px;font-size:11px;letter-spacing:0.4em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Manage Your Appointment</p><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-right:8px;width:33%"><a href="{{manage_url}}" style="display:block;text-align:center;border:1px solid rgba(232,184,75,0.35);padding:12px 8px;color:#e8b84b;text-decoration:none;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-family:Georgia,serif">Manage</a></td><td style="padding-right:8px;width:33%"><a href="{{manage_url}}&action=reschedule" style="display:block;text-align:center;border:1px solid rgba(232,184,75,0.25);padding:12px 8px;color:#c8c4e0;text-decoration:none;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-family:Georgia,serif">Reschedule</a></td><td style="width:33%"><a href="{{manage_url}}&action=cancel" style="display:block;text-align:center;border:1px solid rgba(238,68,68,0.25);padding:12px 8px;color:#cc8888;text-decoration:none;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;font-family:Georgia,serif">Cancel</a></td></tr></table></td></tr><tr><td style="padding:24px 0 0;border-top:1px solid rgba(232,184,75,0.15)"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.35em;color:rgba(232,184,75,0.5);text-transform:uppercase">Cancellation Policy</p><p style="margin:0 0 4px;font-size:14px;color:rgba(200,196,224,0.8);line-height:1.7">72+ hours notice: Full refund or session credit</p><p style="margin:0 0 4px;font-size:14px;color:rgba(200,196,224,0.8);line-height:1.7">24–72 hours notice: 50% refund or session credit</p><p style="margin:0 0 4px;font-size:14px;color:rgba(200,196,224,0.8);line-height:1.7">Less than 24 hours: Non-refundable</p><p style="margin:0;font-size:14px;color:rgba(200,196,224,0.8);line-height:1.7">No-show: Non-refundable — must prepay to rebook</p></td></tr><tr><td align="center" style="padding:28px 0 0;border-top:1px solid rgba(232,184,75,0.1);margin-top:24px"><p style="margin:0 0 4px;font-size:13px;color:rgba(200,196,224,0.6)">Questions? Contact Daron directly.</p><p style="margin:0;font-size:13px;color:rgba(232,184,75,0.7)">{{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:12px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></td></tr></table></body></html>',
  text_body  = 'APPOINTMENT CONFIRMED — ROYAL ENERGY ALCHEMY

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
  variables  = ARRAY['client_name','service','session_date','session_time','timezone','duration','location','manage_url','intake_url','contact_email'],
  updated_at = now()
WHERE name = 'appointment_confirmation';

-- ── 3. Insert new transactional email templates ───────────────────────────

INSERT INTO email_templates (name, subject, html_body, text_body, variables, type, is_active)
VALUES
(
  'intake_received',
  'Intake Received — Royal Energy Alchemy',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(34,201,138,0.3)"><tr><td style="padding:40px"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(34,201,138,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0 0 24px;font-size:24px;color:#22c98a;font-weight:normal">Intake Received</h1><p style="margin:0 0 16px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 16px;font-size:16px;color:#c8c4e0;line-height:1.8">Your intake form for <strong style="color:#f0ecff">{{service}}</strong> has been received. Daron will review it before your session to ensure the work is tailored specifically to you.</p><p style="margin:0 0 24px;font-size:16px;color:#c8c4e0;line-height:1.8">No further action is needed on your part. If anything changes or you want to add to your intake, reply to this email.</p><p style="margin:24px 0 0;font-size:13px;color:rgba(200,196,224,0.6)">{{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:8px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></body></html>',
  'INTAKE RECEIVED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your intake form for {{service}} has been received.

Daron will review it before your session to ensure the work is tailored specifically to you. No further action is needed.

If anything changes or you want to add to your intake, reply to this email.

{{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','service','contact_email'],
  'transactional',
  true
),
(
  'appointment_rescheduled',
  'Appointment Rescheduled — Royal Energy Alchemy',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(232,184,75,0.3)"><tr><td style="padding:40px"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0 0 24px;font-size:24px;color:#e8b84b;font-weight:normal">Appointment Rescheduled</h1><p style="margin:0 0 16px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 20px;font-size:16px;color:#c8c4e0;line-height:1.8">Your <strong style="color:#f0ecff">{{service}}</strong> appointment has been rescheduled.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(232,184,75,0.06);border:1px solid rgba(232,184,75,0.25);padding:20px 24px;margin-bottom:20px"><tr><td><p style="margin:0 0 12px;font-size:10px;letter-spacing:0.4em;color:rgba(232,184,75,0.6);text-transform:uppercase">Previous Time</p><p style="margin:0;font-size:16px;color:rgba(200,196,224,0.6);text-decoration:line-through">{{old_date}} at {{old_time}} {{timezone}}</p></td></tr><tr><td style="padding-top:16px"><p style="margin:0 0 12px;font-size:10px;letter-spacing:0.4em;color:rgba(34,201,138,0.7);text-transform:uppercase">New Time</p><p style="margin:0;font-size:20px;color:#f0ecff;font-weight:bold">{{new_date}} at {{new_time}} {{timezone}}</p></td></tr></table><a href="{{manage_url}}" style="display:inline-block;border:1px solid rgba(232,184,75,0.4);color:#e8b84b;font-family:Georgia,serif;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;text-decoration:none;padding:12px 20px">Manage Appointment →</a><p style="margin:24px 0 0;font-size:13px;color:rgba(200,196,224,0.6)">Questions? {{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:8px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></body></html>',
  'APPOINTMENT RESCHEDULED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your {{service}} appointment has been rescheduled.

Previous: {{old_date}} at {{old_time}} {{timezone}}
New:      {{new_date}} at {{new_time}} {{timezone}}

Manage your appointment: {{manage_url}}

Questions? {{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','service','old_date','old_time','new_date','new_time','timezone','manage_url','contact_email'],
  'transactional',
  true
),
(
  'appointment_cancelled',
  'Appointment Cancelled — Royal Energy Alchemy',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(238,68,68,0.3)"><tr><td style="padding:40px"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0 0 24px;font-size:24px;color:#ee7070;font-weight:normal">Appointment Cancelled</h1><p style="margin:0 0 16px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 16px;font-size:16px;color:#c8c4e0;line-height:1.8">Your <strong style="color:#f0ecff">{{service}}</strong> session scheduled for <strong style="color:#f0ecff">{{session_date}} at {{session_time}} {{timezone}}</strong> has been cancelled.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(238,68,68,0.06);border:1px solid rgba(238,68,68,0.2);padding:18px 22px;margin:16px 0"><tr><td><p style="margin:0 0 8px;font-size:14px;color:#e0b0b0;font-weight:bold">Refund Status</p><p style="margin:0;font-size:15px;color:#c8c4e0;line-height:1.7">{{refund_summary}}</p></td></tr></table><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.35em;color:rgba(232,184,75,0.5);text-transform:uppercase">Cancellation Policy</p><p style="margin:0 0 4px;font-size:13px;color:rgba(200,196,224,0.7)">{{policy_line_1}}</p><p style="margin:0 0 4px;font-size:13px;color:rgba(200,196,224,0.7)">{{policy_line_2}}</p><p style="margin:0 0 4px;font-size:13px;color:rgba(200,196,224,0.7)">{{policy_line_3}}</p><p style="margin:0 0 20px;font-size:13px;color:rgba(200,196,224,0.7)">{{policy_line_4}}</p><p style="margin:0 0 16px;font-size:15px;color:#c8c4e0;line-height:1.8">If you would like to rebook in the future, visit our website or contact Daron directly.</p><p style="margin:24px 0 0;font-size:13px;color:rgba(200,196,224,0.6)">{{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:8px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></body></html>',
  'APPOINTMENT CANCELLED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your {{service}} session scheduled for {{session_date}} at {{session_time}} {{timezone}} has been cancelled.

REFUND STATUS
{{refund_summary}}

CANCELLATION POLICY
{{policy_line_1}}
{{policy_line_2}}
{{policy_line_3}}
{{policy_line_4}}

If you would like to rebook, contact Daron directly.

{{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','service','session_date','session_time','timezone','refund_summary','policy_line_1','policy_line_2','policy_line_3','policy_line_4','contact_email'],
  'transactional',
  true
),
(
  'booking_created',
  'New Booking Received — Royal Energy Alchemy',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(232,184,75,0.3)"><tr><td style="padding:40px"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(232,184,75,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0 0 24px;font-size:24px;color:#e8b84b;font-weight:normal">Booking Confirmed</h1><p style="margin:0 0 16px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 16px;font-size:16px;color:#c8c4e0;line-height:1.8">Your booking for <strong style="color:#f0ecff">{{service}}</strong> on <strong style="color:#f0ecff">{{session_date}} at {{session_time}} {{timezone}}</strong> has been received.</p><p style="margin:0 0 24px;font-size:16px;color:#c8c4e0;line-height:1.8">You will receive a full confirmation email with your appointment details, intake form link, and management options shortly.</p><p style="margin:24px 0 0;font-size:13px;color:rgba(200,196,224,0.6)">{{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:8px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></body></html>',
  'BOOKING RECEIVED — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

Your booking for {{service}} on {{session_date}} at {{session_time}} {{timezone}} has been received.

You will receive a full confirmation email with your appointment details, intake form link, and management options shortly.

{{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','service','session_date','session_time','timezone','contact_email'],
  'transactional',
  true
),
(
  'followup_scheduled',
  'Following Up — Royal Energy Alchemy',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:linear-gradient(135deg,#16112a,#0d0a1a);border:1px solid rgba(176,158,248,0.3)"><tr><td style="padding:40px"><p style="margin:0 0 8px;font-size:11px;letter-spacing:0.45em;color:rgba(176,158,248,0.6);text-transform:uppercase;font-family:Georgia,serif">Royal Energy Alchemy</p><h1 style="margin:0 0 24px;font-size:24px;color:#b09ef8;font-weight:normal">Following Up With You</h1><p style="margin:0 0 16px;font-size:17px;color:#d8d4f0;line-height:1.8">Dear {{client_name}},</p><p style="margin:0 0 16px;font-size:16px;color:#c8c4e0;line-height:1.8;font-style:italic">{{message_body}}</p><p style="margin:0 0 24px;font-size:16px;color:#c8c4e0;line-height:1.8">This is a personal follow-up from Daron. Reply directly to this email if you would like to respond.</p><p style="margin:24px 0 0;font-size:13px;color:rgba(200,196,224,0.6)">{{contact_email}} &nbsp;|&nbsp; 814-392-2095</p><p style="margin:8px 0 0;font-size:11px;letter-spacing:0.3em;color:rgba(232,184,75,0.3);text-transform:uppercase">Royal Energy Alchemy LLC · Erie, Pennsylvania</p></td></tr></table></td></tr></table></body></html>',
  'FOLLOWING UP — ROYAL ENERGY ALCHEMY

Dear {{client_name}},

{{message_body}}

This is a personal follow-up from Daron. Reply directly to this email if you would like to respond.

{{contact_email}} | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','message_body','contact_email'],
  'transactional',
  true
)
ON CONFLICT (name) DO NOTHING;
