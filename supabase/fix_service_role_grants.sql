-- fix_service_role_grants.sql
-- Run this in Supabase → SQL Editor → New query
--
-- WHY: Supabase's service_role has BYPASSRLS but in some project configurations
-- it still needs explicit table-level GRANTs. Without them, PostgREST returns
-- "permission denied for table <name>" even though RLS is bypassed.
--
-- This is a one-time fix. Safe to run multiple times (IF NOT EXISTS / OR REPLACE
-- logic is handled by GRANT being idempotent).

-- 1. Schema usage
grant usage on schema public to service_role;

-- 2. All existing tables
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all routines  in schema public to service_role;

-- 3. All future tables/sequences created in public schema
alter default privileges in schema public
  grant all on tables    to service_role;

alter default privileges in schema public
  grant all on sequences to service_role;

alter default privileges in schema public
  grant all on routines  to service_role;

-- 4. Verify (optional — returns rows for each table if grants applied)
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'service_role'
-- order by table_name, privilege_type;
