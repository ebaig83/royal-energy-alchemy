-- ─────────────────────────────────────────────────────────────────────────────
-- fix_service_role_grants.sql
-- Run once in: Supabase → SQL Editor → New query → Run
--
-- Grants explicit table/sequence privileges to the service_role Postgres role.
-- The service_role is used by all Netlify Functions (server-side only).
-- RLS policies remain unchanged — anon and authenticated are still denied everything.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Schema usage
grant usage on schema public to service_role;

-- 2. All current tables — select, insert, update, delete
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- 3. All current sequences — usage (nextval) + select (currval) + update (setval)
grant usage, select, update
  on all sequences in schema public
  to service_role;

-- 4. Future tables and sequences created in public schema
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select, update on sequences to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing above touches anon or authenticated roles.
-- RLS deny-all policies on all 9 tables remain fully intact.
-- service_role bypasses RLS via BYPASSRLS + now has explicit table grants.
-- ─────────────────────────────────────────────────────────────────────────────
