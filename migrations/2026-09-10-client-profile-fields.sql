-- Additive, idempotent client profile fields. Existing records and relationships are unchanged.
BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS emergency_contact text,
  ADD COLUMN IF NOT EXISTS additional_information text;

COMMIT;
