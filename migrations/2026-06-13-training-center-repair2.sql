-- ============================================================
-- Royal Energy Alchemy — Training Center Repair 2
-- Drops legacy "name" column from certifications table.
-- The original table was created with "name NOT NULL" instead of
-- "title NOT NULL". Repair 1 added "title"; this removes "name".
-- Run in: Supabase → SQL Editor → New query → Run
-- Safe to run more than once (IF EXISTS guard).
-- ============================================================

-- Remove the legacy name column (replaced by title)
ALTER TABLE certifications DROP COLUMN IF EXISTS name;

-- Verify final schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'certifications'
ORDER BY ordinal_position;
