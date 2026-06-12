-- Sprint: SNM Supabase Persistence
-- Adds env_notes and snm_json columns to session_notes.
-- env_notes: JSON string for environmental conditions (moon phase, weather, season)
-- snm_json: full structured Session Notes Modal data object for reloading the UI

ALTER TABLE public.session_notes
  ADD COLUMN IF NOT EXISTS env_notes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snm_json jsonb DEFAULT NULL;

COMMENT ON COLUMN public.session_notes.env_notes IS 'Environmental conditions at time of session — JSON string with moon phase, weather, season. Used in session prep and retrospective review.';


COMMENT ON COLUMN public.session_notes.snm_json IS
  'Full structured JSON from the Session Notes Modal — all checkbox fields, env conditions, state ratings, resources, follow-up status. Used to reload the SNM from Supabase. The content column contains the human-readable plain-text version for AI features.';

CREATE INDEX IF NOT EXISTS idx_session_notes_session_id
  ON public.session_notes(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_notes_client_id
  ON public.session_notes(client_id)
  WHERE client_id IS NOT NULL;
