-- B2.6.1 — harden observation identity before wiring hyper-api to the capability engine.
-- Additive and DEV-only.

ALTER TABLE public.exercise_logs
  ADD COLUMN IF NOT EXISTS session_exercise_id uuid;

-- Existing DEV logs are currently unambiguous: one workout_session_exercises row
-- per (session_id, exercise_id). Backfill the instance identity now.
UPDATE public.exercise_logs el
SET session_exercise_id = wse.id
FROM public.workout_session_exercises wse
WHERE el.session_exercise_id IS NULL
  AND el.session_id = wse.session_id
  AND el.exercise_id = wse.exercise_id
  AND (
    SELECT count(*)
    FROM public.workout_session_exercises wse2
    WHERE wse2.session_id = el.session_id
      AND wse2.exercise_id = el.exercise_id
  ) = 1;

ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_session_exercise_id_fkey;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_session_exercise_id_fkey
  FOREIGN KEY (session_exercise_id)
  REFERENCES public.workout_session_exercises(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_logs_session_exercise_id
  ON public.exercise_logs(session_exercise_id);

-- One internal performance observation per concrete exercise instance.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_logs_internal_session_exercise
  ON public.exercise_logs(session_exercise_id)
  WHERE source_kind = 'internal' AND session_exercise_id IS NOT NULL;

-- A given observation/family must never be applied twice to capability state.
CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_update_events_log_family_applied
  ON public.capability_update_events(exercise_log_id, capability_family)
  WHERE exercise_log_id IS NOT NULL AND applied;

-- B2.4 contract now resolves context through the concrete session exercise instance,
-- instead of the ambiguous (session_id, exercise_id) pair.
CREATE OR REPLACE VIEW public.performance_observation_contract
WITH (security_invoker=true)
AS
SELECT
  el.id AS exercise_log_id,
  el.user_id,
  el.session_id,
  el.session_exercise_id,
  el.exercise_id,
  e.name AS exercise_name,
  wse.block_key,
  wse.position,
  el.source_kind,
  COALESCE(
    NULLIF(wse.expected_outcome_json,'{}'::jsonb),
    NULLIF(wse.prescription_json,'{}'::jsonb),
    el.prescription_json,
    '{}'::jsonb
  ) AS expected_json,
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
  ON wse.id = el.session_exercise_id
LEFT JOIN public.exercises e
  ON e.id = el.exercise_id;
