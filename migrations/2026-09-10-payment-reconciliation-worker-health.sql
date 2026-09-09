BEGIN;

ALTER TABLE public.worker_health
  DROP CONSTRAINT IF EXISTS worker_health_worker_check;

ALTER TABLE public.worker_health
  ADD CONSTRAINT worker_health_worker_check
  CHECK (worker IN ('calendar', 'communications', 'payment-reconciliation'));

ALTER TABLE public.worker_health
  ADD COLUMN IF NOT EXISTS scanned_count integer CHECK (scanned_count IS NULL OR scanned_count >= 0),
  ADD COLUMN IF NOT EXISTS processed_count integer CHECK (processed_count IS NULL OR processed_count >= 0),
  ADD COLUMN IF NOT EXISTS error_summary text;

COMMIT;
