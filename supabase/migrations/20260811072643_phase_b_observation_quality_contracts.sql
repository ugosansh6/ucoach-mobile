-- B2.4: multidimensional observation quality / confidence / freshness contracts.
-- No physiological coefficients are hard-coded here.

ALTER TABLE public.exercise_logs
  ADD COLUMN IF NOT EXISTS observation_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS observation_quality_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS comparison_context_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_b24_json_objects_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_b24_json_objects_check CHECK (
    jsonb_typeof(observation_context_json)='object' AND
    jsonb_typeof(observation_quality_json)='object' AND
    jsonb_typeof(comparison_context_json)='object'
  );

ALTER TABLE public.user_exercise_capabilities
  ADD COLUMN IF NOT EXISTS confidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS freshness_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_exercise_capabilities
  DROP CONSTRAINT IF EXISTS user_exercise_capabilities_b24_json_objects_check;
ALTER TABLE public.user_exercise_capabilities
  ADD CONSTRAINT user_exercise_capabilities_b24_json_objects_check CHECK (
    jsonb_typeof(confidence_json)='object' AND
    jsonb_typeof(freshness_json)='object' AND
    jsonb_typeof(evidence_json)='object'
  );

CREATE OR REPLACE VIEW public.performance_observation_contract
WITH (security_invoker=true)
AS
SELECT
  el.id AS exercise_log_id,
  el.user_id,
  el.session_id,
  wse.id AS session_exercise_id,
  el.exercise_id,
  e.name AS exercise_name,
  wse.block_key,
  wse.position,
  el.source_kind,
  COALESCE(NULLIF(wse.expected_outcome_json,'{}'::jsonb), NULLIF(wse.prescription_json,'{}'::jsonb), el.prescription_json, '{}'::jsonb) AS expected_json,
  CASE
    WHEN el.actual_json <> '{}'::jsonb THEN el.actual_json
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'reps',el.reps_completed,
      'load_kg',el.weight_kg,
      'duration_seconds',el.duration_seconds,
      'distance_meters',el.distance_meters,
      'rpe',el.rpe,
      'status',el.status
    ))
  END AS actual_json,
  el.observation_context_json,
  el.observation_quality_json,
  el.comparison_context_json,
  el.observation_quality AS legacy_quality_scalar,
  el.capability_eligible,
  el.pain_affected,
  el.pain_zones,
  el.skip_reason,
  CASE
    WHEN el.pain_affected THEN 'STATE_ONLY_PAIN'
    WHEN el.status='skipped' AND el.skip_reason IN ('equipment','material','time','lack_of_time') THEN 'CONTEXT_ONLY'
    WHEN el.status='skipped' THEN 'NON_PERFORMANCE_OBSERVATION'
    WHEN NOT el.capability_eligible THEN 'CAPABILITY_EXCLUDED'
    ELSE 'CAPABILITY_CANDIDATE'
  END AS observation_role,
  el.created_at AS observed_at
FROM public.exercise_logs el
LEFT JOIN public.workout_session_exercises wse
  ON wse.session_id=el.session_id AND wse.exercise_id=el.exercise_id
LEFT JOIN public.exercises e
  ON e.id=el.exercise_id;

COMMENT ON COLUMN public.exercise_logs.observation_quality_json IS
'Per-capability observation quality. Example keys may include fresh, repeatable, load_reps, pace, density, progressive. Values are derived by the Performance engine; no fixed coefficients are imposed by schema.';

COMMENT ON COLUMN public.exercise_logs.comparison_context_json IS
'Protocol/context signature used to decide whether observations are comparable (mechanic, block, load, interval, work/rest, exercise position, etc.).';

COMMENT ON COLUMN public.user_exercise_capabilities.confidence_json IS
'Per-envelope confidence; the scalar confidence column remains a summary for compatibility/UI.';

COMMENT ON COLUMN public.user_exercise_capabilities.freshness_json IS
'Per-envelope freshness/recency; the scalar freshness column remains a summary for compatibility/UI.';

COMMENT ON COLUMN public.user_exercise_capabilities.evidence_json IS
'Per-envelope effective evidence metadata, including weighted evidence count and confirmation state.';;
