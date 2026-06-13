-- ============================================================
-- Royal Energy Alchemy — Training Center Repair
-- Adds missing columns to certifications table.
-- Run in: Supabase → SQL Editor → New query → Run
-- Safe to run more than once (IF NOT EXISTS / IF NULL guards).
-- ============================================================

-- Add title column if missing (was absent from initial table creation)
ALTER TABLE certifications
  ADD COLUMN IF NOT EXISTS title text;

-- Backfill any existing rows that ended up with NULL
UPDATE certifications SET title = 'Untitled' WHERE title IS NULL;

-- Enforce NOT NULL now that all rows have a value
ALTER TABLE certifications ALTER COLUMN title SET NOT NULL;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'certifications'
ORDER BY ordinal_position;
