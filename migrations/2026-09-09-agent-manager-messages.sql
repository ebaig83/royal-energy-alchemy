BEGIN;

CREATE TABLE IF NOT EXISTS agent_manager_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  message_body text NOT NULL CHECK (char_length(message_body) BETWEEN 1 AND 4000),
  category text NOT NULL CHECK (category IN ('General Update','Question','Approval Needed','Action Needed','Warning','Release Update','Issue Resolved')),
  priority text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal','Important','Urgent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  acknowledged_at timestamptz,
  related_commit text CHECK (related_commit IS NULL OR related_commit ~ '^[0-9a-f]{7,64}$'),
  related_deploy_id text CHECK (related_deploy_id IS NULL OR char_length(related_deploy_id) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS agent_manager_messages_recent_idx
  ON agent_manager_messages (is_active, created_at DESC);

ALTER TABLE agent_manager_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_manager_messages FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON agent_manager_messages TO service_role;

COMMIT;
