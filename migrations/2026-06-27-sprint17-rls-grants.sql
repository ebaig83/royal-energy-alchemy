-- ── Sprint 17 (Phase A) — RLS grants for authenticated clients ───────────────
-- Enabling RLS (2026-06-25) restricts WHICH rows are visible, but Postgres also
-- requires a base table privilege for the role. Without it, authenticated
-- clients get "permission denied for table ..." before policies are evaluated.
--
-- Grant SELECT to the 'authenticated' role ONLY. RLS policies already constrain
-- each authenticated client to their OWN rows, so this does not expose other
-- clients' data. The 'anon' (unauthenticated) role is intentionally NOT granted.
--
-- Idempotent (GRANT is repeatable). service_role is unaffected (bypasses RLS).

GRANT SELECT ON clients          TO authenticated;
GRANT SELECT ON sessions         TO authenticated;
GRANT SELECT ON client_documents TO authenticated;
