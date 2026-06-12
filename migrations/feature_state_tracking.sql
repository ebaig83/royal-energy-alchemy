-- Feature: Before/After Client State Tracking
-- Adds state_before and state_after (1–5 scale) to sessions table

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS state_before smallint
    CONSTRAINT sessions_state_before_check CHECK (state_before BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS state_after smallint
    CONSTRAINT sessions_state_after_check  CHECK (state_after  BETWEEN 1 AND 5);

COMMENT ON COLUMN public.sessions.state_before IS '1=Very Poor, 2=Poor, 3=Neutral, 4=Good, 5=Very Good — practitioner-observed or client-reported state at session start';
COMMENT ON COLUMN public.sessions.state_after  IS '1=Very Poor, 2=Poor, 3=Neutral, 4=Good, 5=Very Good — practitioner-observed or client-reported state at session end';


-- Feature: Recommendation Outcome Tracking
-- Adds outcome_status and outcome_date to recommendations table

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS outcome_status text
    CONSTRAINT recommendations_outcome_status_check
      CHECK (outcome_status IN ('recommended','purchased','tried','helpful','not_helpful','declined')),
  ADD COLUMN IF NOT EXISTS outcome_date date;

COMMENT ON COLUMN public.recommendations.outcome_status IS 'recommended=no action yet, purchased=bought, tried=used once, helpful=positive outcome, not_helpful=negative, declined=client refused';
COMMENT ON COLUMN public.recommendations.outcome_date   IS 'Date the outcome was recorded';

-- Index for querying recommendations by outcome
CREATE INDEX IF NOT EXISTS idx_recommendations_outcome_status ON public.recommendations(outcome_status);
