-- Phase C: Session Engine contracts and deterministic hard gates.

ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS progression_intent text,
  ADD COLUMN IF NOT EXISTS planning_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_stimulus_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mechanic_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_gate_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.workout_sessions
  DROP CONSTRAINT IF EXISTS workout_sessions_progression_intent_check;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_progression_intent_check CHECK (
    progression_intent IS NULL OR progression_intent IN (
      'MAINTAIN','PROGRESS','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE'
    )
  );
ALTER TABLE public.workout_sessions
  DROP CONSTRAINT IF EXISTS workout_sessions_phase_c_json_objects_check;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_phase_c_json_objects_check CHECK (
    jsonb_typeof(planning_context_json)='object' AND
    jsonb_typeof(expected_stimulus_json)='object' AND
    jsonb_typeof(mechanic_json)='object' AND
    jsonb_typeof(quality_gate_json)='object'
  );

ALTER TABLE public.workout_session_exercises
  ADD COLUMN IF NOT EXISTS expected_outcome_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_rpe_min numeric(4,2),
  ADD COLUMN IF NOT EXISTS expected_rpe_max numeric(4,2),
  ADD COLUMN IF NOT EXISTS capacity_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS solver_decision_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.workout_session_exercises
  DROP CONSTRAINT IF EXISTS workout_session_exercises_expected_rpe_check;
ALTER TABLE public.workout_session_exercises
  ADD CONSTRAINT workout_session_exercises_expected_rpe_check CHECK (
    (expected_rpe_min IS NULL OR (expected_rpe_min >= 1 AND expected_rpe_min <= 10)) AND
    (expected_rpe_max IS NULL OR (expected_rpe_max >= 1 AND expected_rpe_max <= 10)) AND
    (expected_rpe_min IS NULL OR expected_rpe_max IS NULL OR expected_rpe_min <= expected_rpe_max)
  );
ALTER TABLE public.workout_session_exercises
  DROP CONSTRAINT IF EXISTS workout_session_exercises_phase_c_json_objects_check;
ALTER TABLE public.workout_session_exercises
  ADD CONSTRAINT workout_session_exercises_phase_c_json_objects_check CHECK (
    jsonb_typeof(expected_outcome_json)='object' AND
    jsonb_typeof(capacity_snapshot_json)='object' AND
    jsonb_typeof(solver_decision_json)='object'
  );

CREATE TABLE IF NOT EXISTS public.workout_mechanics (
  mechanic_key text PRIMARY KEY,
  display_name text NOT NULL,
  format_family text NOT NULL,
  auto_free_eligible boolean NOT NULL DEFAULT false,
  manual_premium_eligible boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text
);

CREATE TABLE IF NOT EXISTS public.workout_mechanic_variants (
  variant_key text PRIMARY KEY,
  mechanic_key text NOT NULL REFERENCES public.workout_mechanics(mechanic_key) ON DELETE CASCADE,
  display_name text NOT NULL,
  progression_rule_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text
);

-- Public reference data: same access model as exercise catalogue.
ALTER TABLE public.workout_mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_mechanic_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read workout mechanics" ON public.workout_mechanics;
CREATE POLICY "Authenticated can read workout mechanics" ON public.workout_mechanics
FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated can read workout mechanic variants" ON public.workout_mechanic_variants;
CREATE POLICY "Authenticated can read workout mechanic variants" ON public.workout_mechanic_variants
FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.exercise_safe_for_zones(
  p_exercise_id varchar,
  p_zone_ids text[]
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_zone_ids IS NULL OR cardinality(p_zone_ids)=0 THEN true
    ELSE NOT EXISTS (
      SELECT 1 FROM public.exercise_body_zones ebz
      WHERE ebz.exercise_id=p_exercise_id
        AND ebz.body_zone_id = ANY(p_zone_ids)
    )
  END;
$$;

-- Inventory contract: JSON array of {equipment_id, quantity}.
-- Optional requirements never block. A required option_group succeeds only if ALL rows in that group are satisfied.
CREATE OR REPLACE FUNCTION public.exercise_equipment_compatible(
  p_exercise_id varchar,
  p_inventory jsonb
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH inv AS (
    SELECT
      x->>'equipment_id' AS equipment_id,
      GREATEST(COALESCE((x->>'quantity')::int,0),0) AS quantity
    FROM jsonb_array_elements(COALESCE(p_inventory,'[]'::jsonb)) x
    WHERE jsonb_typeof(COALESCE(p_inventory,'[]'::jsonb))='array'
  ), required_groups AS (
    SELECT r.option_group,
           bool_and(COALESCE(i.quantity,0) >= r.min_quantity) AS group_ok
    FROM public.exercise_equipment_requirements_v2 r
    LEFT JOIN inv i ON i.equipment_id=r.equipment_id
    WHERE r.exercise_id=p_exercise_id AND NOT r.is_optional
    GROUP BY r.option_group
  )
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.exercise_equipment_requirements_v2 r
      WHERE r.exercise_id=p_exercise_id AND NOT r.is_optional
    ) THEN true
    ELSE COALESCE((SELECT bool_or(group_ok) FROM required_groups),false)
  END;
$$;

CREATE OR REPLACE FUNCTION public.exercise_hard_gate_status(
  p_exercise_id varchar,
  p_zone_ids text[],
  p_inventory jsonb
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'exercise_id', p_exercise_id,
    'safety_ok', public.exercise_safe_for_zones(p_exercise_id,p_zone_ids),
    'equipment_ok', public.exercise_equipment_compatible(p_exercise_id,p_inventory),
    'eligible', public.exercise_safe_for_zones(p_exercise_id,p_zone_ids)
                AND public.exercise_equipment_compatible(p_exercise_id,p_inventory)
  );
$$;;
