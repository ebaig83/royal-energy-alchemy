BEGIN;

CREATE TABLE IF NOT EXISTS agent_status (
  agent_key text PRIMARY KEY CHECK (agent_key IN ('website','dashboard','manager')),
  agent_name text NOT NULL,
  branch text NOT NULL,
  last_heartbeat_at timestamptz,
  current_task_summary text,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','working','blocked','needs-review','complete')),
  latest_handoff_summary text,
  blocker_summary text,
  last_test_summary text,
  last_agent_commit text,
  manager_review_status text NOT NULL DEFAULT 'not-reviewed',
  production_status text NOT NULL DEFAULT 'not-deployed',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_operations_state (
  state_key text PRIMARY KEY CHECK (state_key = 'current'),
  daron_status text,
  release_approval text NOT NULL DEFAULT 'pending',
  deploy_id text,
  deploy_status text NOT NULL DEFAULT 'not-deployed',
  production_health_summary text,
  final_blocker_summary text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_operations_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_status FROM anon, authenticated;
REVOKE ALL ON agent_operations_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON agent_status TO service_role;
GRANT SELECT, INSERT, UPDATE ON agent_operations_state TO service_role;

INSERT INTO agent_status (agent_key, agent_name, branch)
VALUES
  ('website', 'REA Website Agent', 'agent/website'),
  ('dashboard', 'REA Dashboard Agent', 'agent/dashboard'),
  ('manager', 'REA Manager Agent', 'agent/manager')
ON CONFLICT (agent_key) DO NOTHING;

INSERT INTO agent_operations_state (state_key)
VALUES ('current')
ON CONFLICT (state_key) DO NOTHING;

COMMIT;
