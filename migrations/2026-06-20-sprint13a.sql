-- ============================================================
-- Royal Energy Alchemy — Sprint 13A Migration
-- Client Experience, Communications, Reporting & Intake Enhancement
-- Date: 2026-06-20
--
-- IDEMPOTENCY: All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- RUN ORDER: After 2026-06-19-repair-sprint9-sprint10.sql
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- PHASE 1 — INTAKE INTELLIGENCE COLUMNS
-- New self-management + protection fields on intake_submissions
-- ─────────────────────────────────────────────────────────────

ALTER TABLE intake_submissions
  ADD COLUMN IF NOT EXISTS methods_tried          text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS methods_effective      text,
  ADD COLUMN IF NOT EXISTS methods_ineffective    text,
  ADD COLUMN IF NOT EXISTS protection_practices   text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS practice_consistency   integer
    CHECK (practice_consistency BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS patterns_noticed       text;

COMMENT ON COLUMN intake_submissions.methods_tried        IS 'Multi-select: methods client has already used (Prayer, Meditation, Reiki, etc.)';
COMMENT ON COLUMN intake_submissions.methods_effective    IS 'Free text: which methods have been most effective';
COMMENT ON COLUMN intake_submissions.methods_ineffective  IS 'Free text: which methods have not helped';
COMMENT ON COLUMN intake_submissions.protection_practices IS 'Multi-select: spiritual/energetic protection practices currently used';
COMMENT ON COLUMN intake_submissions.practice_consistency IS 'Scale 1-5: consistency with current practices';
COMMENT ON COLUMN intake_submissions.patterns_noticed     IS 'Free text: recurring patterns noticed (triggers, cycles, themes)';

-- ─────────────────────────────────────────────────────────────
-- PHASE 2 — FOLLOW-UP INTELLIGENCE COLUMNS
-- Expand aftercare table for outcome/pattern intelligence
-- ─────────────────────────────────────────────────────────────

ALTER TABLE aftercare
  ADD COLUMN IF NOT EXISTS techniques_used           text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS practices_maintained      text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS protection_protocols_used text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS followup_patterns_noticed text,
  ADD COLUMN IF NOT EXISTS insights_received         text,
  ADD COLUMN IF NOT EXISTS symptoms_improved         text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS symptoms_worsened         text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS additional_support_needed text;

COMMENT ON COLUMN aftercare.techniques_used           IS 'Which session techniques the client recalls being used';
COMMENT ON COLUMN aftercare.practices_maintained      IS 'Self-care practices maintained since session';
COMMENT ON COLUMN aftercare.protection_protocols_used IS 'Protection/clearing protocols client is using';
COMMENT ON COLUMN aftercare.followup_patterns_noticed IS 'Patterns/triggers/cycles noticed since session';
COMMENT ON COLUMN aftercare.insights_received         IS 'Insights or realizations received since session';
COMMENT ON COLUMN aftercare.symptoms_improved         IS 'Specific symptoms that have improved';
COMMENT ON COLUMN aftercare.symptoms_worsened         IS 'Specific symptoms that have worsened';
COMMENT ON COLUMN aftercare.additional_support_needed IS 'Whether and what additional support is needed';

-- ─────────────────────────────────────────────────────────────
-- PHASE 4 — APPOINTMENT MANAGEMENT AUDIT TABLE
-- Records all appointment management actions (reschedule, cancel, view)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointment_management_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid        REFERENCES sessions(id) ON DELETE SET NULL,
  action        text        NOT NULL
    CHECK (action IN ('view','reschedule_request','cancel_request','contact_request','reschedule_confirmed','cancel_confirmed')),
  old_date      date,
  old_time      text,
  new_date      date,
  new_time      text,
  reason        text,
  client_name   text,
  client_email  text,
  ip_address    text,
  user_agent    text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apt_audit_session ON appointment_management_audit (session_id);
CREATE INDEX IF NOT EXISTS idx_apt_audit_action  ON appointment_management_audit (action);
CREATE INDEX IF NOT EXISTS idx_apt_audit_created ON appointment_management_audit (created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- PHASE 6 — REPORT EXPORTS TABLE
-- Tracks generated reports for audit and re-download
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_exports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type     text        NOT NULL
    CHECK (report_type IN (
      'tax_monthly','tax_annual','tax_by_service','expenses_deductible',
      'annual_summary','practitioner_performance','research_metrics','content_metrics'
    )),
  report_period   text,       -- e.g. '2026', '2026-06', 'Q2-2026'
  parameters      jsonb,
  row_count       integer,
  generated_by    text        NOT NULL DEFAULT 'daron',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_report_exports_type    ON report_exports (report_type);
CREATE INDEX IF NOT EXISTS idx_report_exports_created ON report_exports (generated_at DESC);

-- ─────────────────────────────────────────────────────────────
-- PHASE 3 — BRANDED APPOINTMENT CONFIRMATION EMAIL TEMPLATE
-- Seeded into email_templates for use by send-email.js
-- Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING
-- ─────────────────────────────────────────────────────────────

INSERT INTO email_templates (
  name, type, subject, html_body, text_body, variables, is_active, created_by
)
VALUES (
  'appointment_confirmation',
  'appointment_reminder',
  'Your Appointment is Confirmed — Royal Energy Alchemy',
  '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Appointment Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#04020e;font-family:Georgia,serif;color:#f0ecff">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#04020e;padding:40px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto">

      <!-- Header -->
      <tr>
        <td style="text-align:center;padding:32px 24px 24px;border-bottom:1px solid rgba(232,184,75,0.3)">
          <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.55em;color:rgba(232,184,75,0.7);text-transform:uppercase;margin:0 0 12px">Royal Energy Alchemy</p>
          <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#f8e090;margin:0 0 8px;letter-spacing:0.04em">Appointment Confirmed</h1>
          <p style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:rgba(208,204,240,0.8);margin:0">Hello {{client_name}}, your session is officially scheduled.</p>
        </td>
      </tr>

      <!-- Appointment Details Card -->
      <tr>
        <td style="padding:28px 24px 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(13,10,26,0.95);border:1px solid rgba(232,184,75,0.25);border-radius:4px">
            <tr><td style="padding:14px 20px;border-bottom:1px solid rgba(232,184,75,0.15);background:linear-gradient(90deg,rgba(42,31,16,0.9),rgba(18,13,28,0.9))">
              <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.4em;color:#e8b84b;text-transform:uppercase;margin:0">Appointment Details</p>
            </td></tr>
            <tr><td style="padding:20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08);width:40%">
                    <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Service</p>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:15px;color:#f0ecff;margin:0;font-weight:600">{{service}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Date</p>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:15px;color:#f0ecff;margin:0">{{session_date}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Time</p>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:15px;color:#f0ecff;margin:0">{{session_time}} {{timezone}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Duration</p>
                  </td>
                  <td style="padding:8px 0;border-bottom:1px solid rgba(232,184,75,0.08)">
                    <p style="font-family:Georgia,serif;font-size:15px;color:#f0ecff;margin:0">{{duration_minutes}} minutes</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0">
                    <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Payment</p>
                  </td>
                  <td style="padding:8px 0">
                    <p style="font-family:Georgia,serif;font-size:15px;color:#22c98a;margin:0;font-weight:600">{{payment_status}}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Intake Card -->
      <tr>
        <td style="padding:16px 24px 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(8,14,28,0.95);border:1px solid rgba(34,201,138,0.2);border-radius:4px">
            <tr><td style="padding:14px 20px;border-bottom:1px solid rgba(34,201,138,0.15);background:linear-gradient(90deg,rgba(8,22,16,0.95),rgba(8,14,28,0.95))">
              <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.4em;color:#22c98a;text-transform:uppercase;margin:0">Intake Appointment</p>
            </td></tr>
            <tr><td style="padding:20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;width:40%"><p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Date</p></td>
                  <td style="padding:6px 0"><p style="font-size:15px;color:#f0ecff;margin:0">{{intake_date}}</p></td>
                </tr>
                <tr>
                  <td style="padding:6px 0"><p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Time</p></td>
                  <td style="padding:6px 0"><p style="font-size:15px;color:#f0ecff;margin:0">{{intake_time}}</p></td>
                </tr>
                <tr>
                  <td style="padding:6px 0"><p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.2em;color:rgba(153,144,192,0.9);text-transform:uppercase;margin:0">Duration</p></td>
                  <td style="padding:6px 0"><p style="font-size:15px;color:#f0ecff;margin:0">{{intake_duration}}</p></td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Action Buttons -->
      <tr>
        <td style="padding:28px 24px 0;text-align:center">
          <table cellpadding="0" cellspacing="0" style="margin:0 auto">
            <tr>
              <td style="padding:6px">
                <a href="{{intake_url}}" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.45em;color:#000;text-transform:uppercase;background:linear-gradient(135deg,#f5d98a,#e8b84b);padding:14px 24px;text-decoration:none;font-weight:700">COMPLETE INTAKE</a>
              </td>
            </tr>
            <tr>
              <td style="padding:6px;text-align:center">
                <a href="{{manage_url}}" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:#22c98a;text-transform:uppercase;background:rgba(34,201,138,0.08);border:1px solid rgba(34,201,138,0.3);padding:12px 22px;text-decoration:none;margin-right:8px">MANAGE APPOINTMENT</a>
                <a href="{{manage_url}}?action=cancel" style="display:inline-block;font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:rgba(238,68,68,0.8);text-transform:uppercase;background:rgba(238,68,68,0.06);border:1px solid rgba(238,68,68,0.2);padding:12px 22px;text-decoration:none">CANCEL</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Preparation Instructions -->
      <tr>
        <td style="padding:28px 24px 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(8,6,22,0.8);border:1px solid rgba(232,184,75,0.15);border-radius:4px;padding:20px">
            <tr><td style="padding:16px 20px">
              <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.4em;color:#e8b84b;text-transform:uppercase;margin:0 0 12px">Preparation Instructions</p>
              <ul style="font-size:15px;color:rgba(208,204,240,0.85);line-height:1.9;margin:0;padding-left:20px">
                <li>Wear comfortable, loose-fitting clothing</li>
                <li>Avoid heavy meals 2 hours before your session</li>
                <li>Stay well-hydrated before and after</li>
                <li>Find a quiet, private space if your session is remote</li>
                <li>Set an intention for what you would like to address</li>
                <li>Have a journal nearby for any insights</li>
              </ul>
            </td></tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:32px 24px;text-align:center;border-top:1px solid rgba(232,184,75,0.15);margin-top:28px">
          <p style="font-family:Georgia,serif;font-size:13px;color:rgba(153,144,192,0.7);margin:0 0 8px">Questions? Contact us anytime.</p>
          <p style="font-family:Georgia,serif;font-size:13px;color:#e8b84b;margin:0 0 4px">royalenergyalchemy@gmail.com</p>
          <p style="font-family:Georgia,serif;font-size:13px;color:rgba(153,144,192,0.7);margin:0 0 16px">814-392-2095</p>
          <p style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.25em;color:rgba(153,144,192,0.4);text-transform:uppercase;margin:0">Royal Energy Alchemy LLC · Erie, Pennsylvania</p>
          <p style="font-family:Georgia,serif;font-size:11px;color:rgba(153,144,192,0.35);margin:8px 0 0;line-height:1.6">Spiritual and energetic services are complementary wellness offerings and are not medical, legal, or psychological advice.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>',
  'Your appointment with Royal Energy Alchemy is confirmed.

Hello {{client_name}},

SERVICE: {{service}}
DATE: {{session_date}}
TIME: {{session_time}} {{timezone}}
DURATION: {{duration_minutes}} minutes
PAYMENT: {{payment_status}}

INTAKE APPOINTMENT
Date: {{intake_date}}
Time: {{intake_time}}

Complete your intake: {{intake_url}}
Manage your appointment: {{manage_url}}

PREPARATION:
- Wear comfortable, loose-fitting clothing
- Avoid heavy meals 2 hours before
- Stay well-hydrated
- Find a quiet, private space if remote
- Set an intention for your session
- Have a journal nearby

Questions? royalenergyalchemy@gmail.com | 814-392-2095

Royal Energy Alchemy LLC · Erie, Pennsylvania',
  ARRAY['client_name','service','session_date','session_time','timezone','duration_minutes','payment_status','intake_url','manage_url','intake_date','intake_time','intake_duration'],
  true,
  'daron'
)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- PHASE 5 — COMMUNICATIONS DEFAULT TEMPLATES
-- Seed default templates for follow-up types
-- ─────────────────────────────────────────────────────────────

INSERT INTO email_templates (name, type, subject, html_body, text_body, variables, is_active, created_by)
VALUES (
  'followup_24hr',
  'followup_reminder',
  '24-Hour Check-In — How Are You Feeling? | Royal Energy Alchemy',
  '<p>Hello {{client_name}},</p><p>It has been 24 hours since your {{service}} session. Daron would love to hear how you are feeling. Your responses help track your progress and improve future sessions.</p><p><a href="{{checkin_url}}" style="color:#e8b84b">Complete Your 24-Hour Check-In</a></p><p>Royal Energy Alchemy LLC</p>',
  'Hello {{client_name}},

It has been 24 hours since your {{service}} session. Please complete your check-in:
{{checkin_url}}

Royal Energy Alchemy LLC',
  ARRAY['client_name','service','checkin_url'],
  true, 'daron'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO email_templates (name, type, subject, html_body, text_body, variables, is_active, created_by)
VALUES (
  'followup_1month',
  'followup_reminder',
  '1 Month Follow-Up — Royal Energy Alchemy',
  '<p>Hello {{client_name}},</p><p>It has been one month since your session. Daron would love to hear about your continued progress and any patterns you have noticed.</p><p><a href="{{checkin_url}}" style="color:#e8b84b">Complete Your 1-Month Check-In</a></p><p>Royal Energy Alchemy LLC</p>',
  'Hello {{client_name}},

One month has passed since your session. Complete your check-in:
{{checkin_url}}

Royal Energy Alchemy LLC',
  ARRAY['client_name','checkin_url'],
  true, 'daron'
)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- V1: New intake columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'intake_submissions'
  AND column_name IN ('methods_tried','methods_effective','methods_ineffective',
                      'protection_practices','practice_consistency','patterns_noticed')
ORDER BY column_name;
-- Expected: 6 rows

-- V2: New aftercare columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'aftercare'
  AND column_name IN ('techniques_used','practices_maintained','protection_protocols_used',
                      'followup_patterns_noticed','insights_received',
                      'symptoms_improved','symptoms_worsened','additional_support_needed')
ORDER BY column_name;
-- Expected: 8 rows

-- V3: New tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('appointment_management_audit','report_exports')
ORDER BY tablename;
-- Expected: 2 rows

-- V4: Email templates seeded
SELECT name, type, is_active FROM email_templates
WHERE name IN ('appointment_confirmation','followup_24hr','followup_1month')
ORDER BY name;
-- Expected: 3 rows
-- ============================================================
