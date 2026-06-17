-- ── Sprint 17 (Phase A) — Client Portal Accounts + RLS ───────────────────────
-- Adds account/auth tracking to clients and enables Row Level Security so an
-- authenticated client can only ever read their OWN client record, sessions,
-- and documents. service_role (used by all Netlify functions) bypasses RLS, so
-- the existing token-path functions are unaffected.
--
-- Idempotent. Does NOT touch email_templates or any verified field.

-- ── 1. Account / auth tracking columns ───────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS auth_user_id          uuid,
  ADD COLUMN IF NOT EXISTS portal_account_created timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_login      timestamptz,
  ADD COLUMN IF NOT EXISTS portal_login_count     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_access_method   text,      -- token | account | both
  ADD COLUMN IF NOT EXISTS duplicate_flag         boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_auth_user_id ON clients (auth_user_id);

-- ── 2. Row Level Security ────────────────────────────────────────────────────
-- Enabling RLS denies all access EXCEPT rows matched by a policy. service_role
-- bypasses RLS entirely, so server functions keep full access. We add SELECT
-- policies for the 'authenticated' role scoped to the caller's own client.

ALTER TABLE clients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;

-- clients: a logged-in user sees only the client row linked to their auth uid.
DROP POLICY IF EXISTS client_self_select ON clients;
CREATE POLICY client_self_select ON clients
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- sessions: rows belonging to the caller's linked client.
DROP POLICY IF EXISTS session_self_select ON sessions;
CREATE POLICY session_self_select ON sessions
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));

-- client_documents: rows belonging to the caller's linked client.
DROP POLICY IF EXISTS client_documents_self_select ON client_documents;
CREATE POLICY client_documents_self_select ON client_documents
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid()));
