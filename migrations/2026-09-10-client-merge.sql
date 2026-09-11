-- Additive, idempotent soft-merge infrastructure. This migration does not merge or rewrite existing records.
BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS merged_into_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_by text;

CREATE INDEX IF NOT EXISTS clients_merged_into_idx ON public.clients (merged_into_client_id) WHERE merged_into_client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.client_merge_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_client_id uuid NOT NULL REFERENCES public.clients(id),
  duplicate_client_id uuid NOT NULL REFERENCES public.clients(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  merged_by text NOT NULL,
  reassigned_counts jsonb NOT NULL DEFAULT '{}',
  conflict_resolution_summary jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT client_merge_audits_distinct CHECK (primary_client_id <> duplicate_client_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_merge_duplicate_once_idx ON public.client_merge_audits (duplicate_client_id);
CREATE INDEX IF NOT EXISTS client_merge_primary_idx ON public.client_merge_audits (primary_client_id);
ALTER TABLE public.client_merge_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_merge_audits FROM anon, authenticated;
GRANT SELECT, INSERT ON public.client_merge_audits TO service_role;

CREATE OR REPLACE FUNCTION public.merge_client_profiles(p_primary_id uuid, p_duplicate_id uuid, p_resolutions jsonb, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  primary_row clients%ROWTYPE; duplicate_row clients%ROWTYPE; merged_row clients%ROWTYPE;
  field text; fields text[] := ARRAY['full_name','email','phone','address','date_of_birth','emergency_contact','additional_information','preferred_contact'];
  primary_value text; duplicate_value text; chosen jsonb := '{}'; counts jsonb := '{}'; n bigint; table_name text;
  related_tables text[] := ARRAY['sessions','communications','payments','session_notes','aftercare','intakes','intake_submissions','client_documents','recommendations','referrals','action_plans','packages','invoices','payment_requests','financial_alerts'];
BEGIN
  IF p_primary_id IS NULL OR p_duplicate_id IS NULL OR p_primary_id = p_duplicate_id THEN RAISE EXCEPTION 'self merge is not allowed'; END IF;
  SELECT * INTO primary_row FROM clients WHERE id = p_primary_id FOR UPDATE;
  SELECT * INTO duplicate_row FROM clients WHERE id = p_duplicate_id FOR UPDATE;
  IF primary_row.id IS NULL OR duplicate_row.id IS NULL THEN RAISE EXCEPTION 'both client profiles are required'; END IF;
  IF primary_row.merged_into_client_id IS NOT NULL OR duplicate_row.merged_into_client_id IS NOT NULL THEN RAISE EXCEPTION 'profile is already merged'; END IF;
  IF p_resolutions IS NULL OR jsonb_typeof(p_resolutions) <> 'object' THEN RAISE EXCEPTION 'explicit conflict resolutions are required'; END IF;
  FOREACH field IN ARRAY fields LOOP
    primary_value := to_jsonb(primary_row)->>field; duplicate_value := to_jsonb(duplicate_row)->>field;
    IF primary_value IS NOT NULL AND duplicate_value IS NOT NULL AND btrim(primary_value) <> btrim(duplicate_value) AND NOT (p_resolutions ? field) THEN RAISE EXCEPTION 'conflict requires explicit resolution: %', field; END IF;
    IF p_resolutions ? field THEN chosen := chosen || jsonb_build_object(field, p_resolutions->field);
    ELSIF primary_value IS NULL AND duplicate_value IS NOT NULL THEN chosen := chosen || jsonb_build_object(field, duplicate_value);
    END IF;
  END LOOP;
  merged_row := jsonb_populate_record(primary_row, chosen);
  UPDATE clients SET full_name=merged_row.full_name,email=merged_row.email,phone=merged_row.phone,address=merged_row.address,date_of_birth=merged_row.date_of_birth,emergency_contact=merged_row.emergency_contact,additional_information=merged_row.additional_information,preferred_contact=merged_row.preferred_contact WHERE id=p_primary_id;
  FOREACH table_name IN ARRAY related_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE client_id = $1', table_name) INTO n USING p_duplicate_id;
      EXECUTE format('UPDATE public.%I SET client_id = $1 WHERE client_id = $2', table_name) USING p_primary_id, p_duplicate_id;
      counts := counts || jsonb_build_object(table_name, n);
    END IF;
  END LOOP;
  IF to_regclass('public.client_relationships') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.client_relationships WHERE related_client_id = $1' INTO n USING p_duplicate_id;
    EXECUTE 'UPDATE public.client_relationships SET related_client_id = $1 WHERE related_client_id = $2' USING p_primary_id, p_duplicate_id;
    counts := counts || jsonb_build_object('client_relationships_related', n);
  END IF;
  UPDATE clients SET status='archived', merged_into_client_id=p_primary_id, merged_at=now(), merged_by=p_actor WHERE id=p_duplicate_id;
  INSERT INTO client_merge_audits(primary_client_id,duplicate_client_id,merged_by,reassigned_counts,conflict_resolution_summary) VALUES(p_primary_id,p_duplicate_id,p_actor,counts,jsonb_build_object('fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(chosen) AS key)));
  RETURN jsonb_build_object('primary_client_id',p_primary_id,'duplicate_client_id',p_duplicate_id,'reassigned_counts',counts);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_client_profiles(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_client_profiles(uuid,uuid,jsonb,text) TO service_role;
COMMIT;
