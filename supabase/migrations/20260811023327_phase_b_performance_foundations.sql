-- Phase B: neutral Performance/Calibration foundations.
-- Additive only: existing V2.1 progress engine remains intact.

ALTER TABLE public.exercise_logs
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS observation_quality numeric(4,3),
  ADD COLUMN IF NOT EXISTS capability_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS pain_affected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_zones text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS actual_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_observation_quality_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_observation_quality_check
  CHECK (observation_quality IS NULL OR (observation_quality >= 0 AND observation_quality <= 1));

CREATE TABLE IF NOT EXISTS public.user_exercise_capabilities (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id varchar NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  reps_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  load_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  distance_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  pace_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  density_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  freshness numeric(4,3) NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  valid_evidence_count integer NOT NULL DEFAULT 0,
  last_observed_at timestamptz,
  last_valid_observed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id),
  CONSTRAINT user_exercise_capabilities_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT user_exercise_capabilities_freshness_check CHECK (freshness >= 0 AND freshness <= 1),
  CONSTRAINT user_exercise_capabilities_evidence_check CHECK (evidence_count >= 0 AND valid_evidence_count >= 0 AND valid_evidence_count <= evidence_count)
);

CREATE INDEX IF NOT EXISTS idx_user_exercise_capabilities_user_updated
  ON public.user_exercise_capabilities(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_exercise_capabilities_exercise
  ON public.user_exercise_capabilities(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_observed
  ON public.exercise_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_source_kind
  ON public.exercise_logs(source_kind);

ALTER TABLE public.user_exercise_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own exercise capabilities" ON public.user_exercise_capabilities;
CREATE POLICY "Users can read own exercise capabilities"
  ON public.user_exercise_capabilities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own exercise capabilities" ON public.user_exercise_capabilities;
CREATE POLICY "Users can insert own exercise capabilities"
  ON public.user_exercise_capabilities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own exercise capabilities" ON public.user_exercise_capabilities;
CREATE POLICY "Users can update own exercise capabilities"
  ON public.user_exercise_capabilities FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own exercise capabilities" ON public.user_exercise_capabilities;
CREATE POLICY "Users can delete own exercise capabilities"
  ON public.user_exercise_capabilities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE VIEW public.performance_observation_source
WITH (security_invoker=true)
AS
SELECT
  el.id AS exercise_log_id,
  el.user_id,
  el.session_id,
  wse.id AS session_exercise_id,
  el.exercise_id,
  el.source_kind,
  COALESCE(NULLIF(wse.prescription_json, '{}'::jsonb), el.prescription_json, '{}'::jsonb) AS expected_json,
  CASE WHEN el.actual_json <> '{}'::jsonb THEN el.actual_json ELSE jsonb_strip_nulls(jsonb_build_object(
    'reps', el.reps_completed,
    'load_kg', el.weight_kg,
    'duration_seconds', el.duration_seconds,
    'distance_meters', el.distance_meters,
    'rpe', el.rpe,
    'status', el.status
  )) END AS actual_json,
  el.observation_quality,
  el.capability_eligible,
  (el.capability_eligible AND el.status = 'completed' AND NOT el.pain_affected) AS effective_capability_eligible,
  el.skip_reason,
  el.pain_affected,
  el.pain_zones,
  el.created_at AS observed_at
FROM public.exercise_logs el
LEFT JOIN public.workout_session_exercises wse
  ON wse.session_id = el.session_id AND wse.exercise_id = el.exercise_id;

CREATE OR REPLACE VIEW public.user_exercise_coach_state
WITH (security_invoker=true)
AS
SELECT
  COALESCE(p.user_id,c.user_id) AS user_id,
  COALESCE(p.exercise_id,c.exercise_id) AS exercise_id,
  p.exposure_count,
  p.completed_count,
  p.skipped_count,
  p.avg_rpe,
  p.last_rpe,
  p.rpe_trend,
  p.adherence_score,
  p.performance_trend,
  p.consistency_score,
  p.mastery_score,
  p.state,
  p.recommendation,
  p.performance_score,
  p.performance_confidence,
  p.mastery_confidence,
  p.overall_confidence,
  p.best_performance_json,
  p.current_performance_json,
  p.performance_delta,
  c.reps_envelope,
  c.load_envelope,
  c.time_envelope,
  c.distance_envelope,
  c.pace_envelope,
  c.density_envelope,
  c.confidence AS capability_confidence,
  c.freshness AS capability_freshness,
  c.evidence_count,
  c.valid_evidence_count,
  GREATEST(p.last_observed_at,c.last_observed_at) AS last_observed_at
FROM public.user_exercise_progress p
FULL OUTER JOIN public.user_exercise_capabilities c
  ON c.user_id=p.user_id AND c.exercise_id=p.exercise_id;;
