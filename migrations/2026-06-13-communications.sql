-- ============================================================
-- Royal Energy Alchemy — Communications Layer Migration
-- Run in Supabase SQL Editor after 2026-06-12-financial-ops.sql
-- ============================================================

-- ── COMMUNICATIONS LOG ────────────────────────────────────────
-- Every outbound communication (email, future: SMS) is recorded here.
-- This is the single source of truth for delivery history.
CREATE TABLE IF NOT EXISTS communications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid        REFERENCES clients(id) ON DELETE SET NULL,
  channel             text        NOT NULL DEFAULT 'email',           -- email | sms (future)
  message_type        text        NOT NULL,                           -- appointment_reminder | followup_reminder |
                                                                       -- recommendation_delivery | invoice_notification |
                                                                       -- package_expiration_warning | general_message
  recipient           text        NOT NULL,                           -- email address or phone
  subject             text,
  status              text        NOT NULL DEFAULT 'sent',            -- sent | delivered | failed | bounced
  provider            text        NOT NULL DEFAULT 'resend',
  provider_message_id text,                                           -- Resend message ID for tracking
  template_id         uuid,                                           -- FK to email_templates if template was used
  metadata            jsonb,                                          -- optional: invoice_id, package_id, session_id, etc.
  sent_at             timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT comms_channel_check       CHECK (channel IN ('email','sms')),
  CONSTRAINT comms_status_check        CHECK (status IN ('sent','delivered','failed','bounced','pending')),
  CONSTRAINT comms_msg_type_check      CHECK (message_type IN (
    'appointment_reminder','followup_reminder','recommendation_delivery',
    'invoice_notification','package_expiration_warning','general_message'
  ))
);

CREATE INDEX IF NOT EXISTS comms_client_idx   ON communications(client_id);
CREATE INDEX IF NOT EXISTS comms_status_idx   ON communications(status);
CREATE INDEX IF NOT EXISTS comms_type_idx     ON communications(message_type);
CREATE INDEX IF NOT EXISTS comms_sent_idx     ON communications(sent_at DESC);
CREATE INDEX IF NOT EXISTS comms_deleted_idx  ON communications(deleted_at) WHERE deleted_at IS NULL;

-- ── EMAIL TEMPLATES ───────────────────────────────────────────
-- Template store with variable substitution support.
-- Variables use {{variable_name}} syntax.
CREATE TABLE IF NOT EXISTS email_templates (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL UNIQUE,
  type        text    NOT NULL,       -- maps to communications.message_type
  subject     text    NOT NULL,
  html_body   text    NOT NULL,
  text_body   text,
  variables   text[]  DEFAULT '{}',   -- list of variable names used in template
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text    DEFAULT 'daron',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT tmpl_type_check CHECK (type IN (
    'appointment_reminder','followup_reminder','recommendation_delivery',
    'invoice_notification','package_expiration_warning','general_message'
  ))
);

CREATE INDEX IF NOT EXISTS tmpl_type_idx    ON email_templates(type);
CREATE INDEX IF NOT EXISTS tmpl_active_idx  ON email_templates(is_active) WHERE is_active = true;

-- ── updated_at TRIGGERS ───────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION set_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS '
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    ';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'comms_updated_at'
  ) THEN
    CREATE TRIGGER comms_updated_at
      BEFORE UPDATE ON communications
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tmpl_updated_at'
  ) THEN
    CREATE TRIGGER tmpl_updated_at
      BEFORE UPDATE ON email_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE communications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

-- Service role (used by Netlify Functions) bypasses RLS entirely.
-- No public read policies — all access goes through server-side functions.

-- ── SEED DEFAULT TEMPLATES ────────────────────────────────────
INSERT INTO email_templates (name, type, subject, html_body, text_body, variables, created_by)
VALUES
(
  'Appointment Reminder',
  'appointment_reminder',
  'Your Appointment with Royal Energy Alchemy — {{appointment_date}}',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<p style="font-size:18px;line-height:1.7">This is a gentle reminder of your upcoming session:</p>
<div style="background:#0a0612;border:1px solid #e8b84b44;padding:20px 24px;margin:20px 0">
  <p style="font-family:serif;color:#e8b84b;letter-spacing:.1em;font-size:16px;margin:0 0 8px">{{appointment_date}} at {{appointment_time}}</p>
  <p style="color:#dddaeecc;font-size:16px;margin:0">{{service_type}}</p>
</div>
<p style="font-size:17px;line-height:1.7;color:#dddaeecc">{{notes}}</p>
<p style="font-size:17px;line-height:1.7">I look forward to our session.</p>
<p style="font-size:17px;color:#e8b84b">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

This is a gentle reminder of your upcoming session:

{{appointment_date}} at {{appointment_time}}
{{service_type}}

{{notes}}

I look forward to our session.

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','appointment_date','appointment_time','service_type','notes'],
  'daron'
),
(
  'Follow-Up Reminder',
  'followup_reminder',
  'Checking In — Your Royal Energy Alchemy Session',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<p style="font-size:18px;line-height:1.7">I am following up on your recent session on {{session_date}}. I wanted to check in and see how you are feeling.</p>
<p style="font-size:17px;line-height:1.7;color:#dddaeecc">{{message}}</p>
<p style="font-size:17px;line-height:1.7">Please feel free to reach out if you have any questions or would like to schedule your next session.</p>
<p style="font-size:17px;color:#e8b84b">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

I am following up on your recent session on {{session_date}}. I wanted to check in and see how you are feeling.

{{message}}

Please feel free to reach out if you have any questions.

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','session_date','message'],
  'daron'
),
(
  'Recommendation Delivery',
  'recommendation_delivery',
  'Your Personalized Recommendations — Royal Energy Alchemy',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<p style="font-size:18px;line-height:1.7">Following our session, I have put together personalized recommendations to support your healing journey.</p>
<div style="background:#0a0612;border:1px solid #22c98a44;padding:20px 24px;margin:20px 0">
  <p style="font-family:serif;color:#22c98a;letter-spacing:.1em;font-size:14px;margin:0 0 14px;text-transform:uppercase">Your Recommendations</p>
  {{recommendations_list}}
</div>
<p style="font-size:17px;line-height:1.7;color:#dddaeecc">{{notes}}</p>
<p style="font-size:17px;line-height:1.7">As always, reach out with any questions. I am here to support you.</p>
<p style="font-size:17px;color:#e8b84b">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

Following our session, I have put together personalized recommendations to support your healing journey.

YOUR RECOMMENDATIONS
{{recommendations_list}}

{{notes}}

As always, reach out with any questions.

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','recommendations_list','notes'],
  'daron'
),
(
  'Invoice Notification',
  'invoice_notification',
  'Invoice {{invoice_number}} — Royal Energy Alchemy',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<p style="font-size:18px;line-height:1.7">Please find your invoice details below.</p>
<div style="background:#0a0612;border:1px solid #e8b84b44;padding:20px 24px;margin:20px 0">
  <p style="font-family:serif;color:#e8b84b;letter-spacing:.1em;font-size:14px;margin:0 0 14px;text-transform:uppercase">Invoice {{invoice_number}}</p>
  <p style="color:#dddaeecc;font-size:16px;margin:6px 0">Amount Due: <strong style="color:#f0ecff">{{amount_due}}</strong></p>
  <p style="color:#dddaeecc;font-size:16px;margin:6px 0">Due Date: <strong style="color:#f0ecff">{{due_date}}</strong></p>
</div>
<p style="font-size:17px;line-height:1.7;color:#dddaeecc">{{notes}}</p>
<p style="font-size:17px;line-height:1.7">Thank you for your continued trust in my practice.</p>
<p style="font-size:17px;color:#e8b84b">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

INVOICE {{invoice_number}}
Amount Due: {{amount_due}}
Due Date: {{due_date}}

{{notes}}

Thank you for your continued trust.

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','invoice_number','amount_due','due_date','notes'],
  'daron'
),
(
  'Package Expiration Warning',
  'package_expiration_warning',
  'Your Session Package Expires Soon — Royal Energy Alchemy',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<p style="font-size:18px;line-height:1.7">This is a friendly reminder that your <strong>{{package_name}}</strong> expires on <strong>{{expiration_date}}</strong>.</p>
<div style="background:#0a0612;border:1px solid #f8a84b44;padding:20px 24px;margin:20px 0">
  <p style="color:#dddaeecc;font-size:16px;margin:6px 0">Package: <strong style="color:#f0ecff">{{package_name}}</strong></p>
  <p style="color:#dddaeecc;font-size:16px;margin:6px 0">Sessions Remaining: <strong style="color:#f0ecff">{{sessions_remaining}}</strong></p>
  <p style="color:#dddaeecc;font-size:16px;margin:6px 0">Expires: <strong style="color:#f8a84b">{{expiration_date}}</strong></p>
</div>
<p style="font-size:17px;line-height:1.7">Please reach out to schedule your remaining sessions before they expire.</p>
<p style="font-size:17px;color:#e8b84b">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

Your {{package_name}} expires on {{expiration_date}}.
Sessions Remaining: {{sessions_remaining}}

Please reach out to schedule your remaining sessions before they expire.

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','package_name','expiration_date','sessions_remaining'],
  'daron'
),
(
  'General Practitioner Message',
  'general_message',
  '{{subject}} — Royal Energy Alchemy',
  '<!DOCTYPE html><html><body style="background:#04020e;color:#f0ecff;font-family:Georgia,serif;padding:40px 20px;max-width:600px;margin:0 auto">
<h1 style="font-family:serif;color:#e8b84b;letter-spacing:.08em;font-size:28px;margin-bottom:6px">Royal Energy Alchemy</h1>
<p style="color:#e8b84b;font-size:13px;letter-spacing:.3em;text-transform:uppercase;margin-top:0">Energy Healing Practice</p>
<hr style="border:none;border-top:1px solid #e8b84b44;margin:24px 0">
<p style="font-size:18px;line-height:1.7">Hello {{client_name}},</p>
<div style="font-size:18px;line-height:1.8;color:#f0ecff">{{message_body}}</div>
<p style="font-size:17px;color:#e8b84b;margin-top:28px">With love and light,<br>Daron Royal</p>
<hr style="border:none;border-top:1px solid #e8b84b22;margin:30px 0">
<p style="font-size:13px;color:#dddaee44;font-family:serif">Royal Energy Alchemy · Erie, PA</p>
</body></html>',
  'Hello {{client_name}},

{{message_body}}

With love and light,
Daron Royal
Royal Energy Alchemy · Erie, PA',
  ARRAY['client_name','subject','message_body'],
  'daron'
)
ON CONFLICT (name) DO NOTHING;
