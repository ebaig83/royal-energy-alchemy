-- Migration: add env_notes to session_notes
-- Run once in Supabase SQL Editor.
-- Stores practitioner-entered environmental context (moon, weather, geo, custom notes).

alter table session_notes
  add column if not exists env_notes jsonb default null;

-- Grant service_role access to new column (covered by existing table-level grant,
-- but explicit alter default privileges ensures future columns are covered too).
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
