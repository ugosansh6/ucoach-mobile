

-- SOURCE MIGRATION: 20260811023327_phase_b_performance_foundations.sql
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



-- SOURCE MIGRATION: 20260811023427_phase_b_performance_contract_guards.sql
ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_source_kind_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_source_kind_check
  CHECK (source_kind IN ('internal','external_import','manual'));

ALTER TABLE public.exercise_logs
  DROP CONSTRAINT IF EXISTS exercise_logs_actual_json_object_check;
ALTER TABLE public.exercise_logs
  ADD CONSTRAINT exercise_logs_actual_json_object_check
  CHECK (jsonb_typeof(actual_json) = 'object');

ALTER TABLE public.user_exercise_capabilities
  DROP CONSTRAINT IF EXISTS user_exercise_capabilities_envelopes_object_check;
ALTER TABLE public.user_exercise_capabilities
  ADD CONSTRAINT user_exercise_capabilities_envelopes_object_check CHECK (
    jsonb_typeof(reps_envelope)='object' AND
    jsonb_typeof(load_envelope)='object' AND
    jsonb_typeof(time_envelope)='object' AND
    jsonb_typeof(distance_envelope)='object' AND
    jsonb_typeof(pace_envelope)='object' AND
    jsonb_typeof(density_envelope)='object'
  );;



-- SOURCE MIGRATION: 20260811023521_phase_c_session_engine_contracts.sql
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



-- SOURCE MIGRATION: 20260811023538_phase_c_mechanic_kind.sql
ALTER TABLE public.workout_mechanics
  ADD COLUMN IF NOT EXISTS mechanic_kind text NOT NULL DEFAULT 'core';
ALTER TABLE public.workout_mechanics
  DROP CONSTRAINT IF EXISTS workout_mechanics_kind_check;
ALTER TABLE public.workout_mechanics
  ADD CONSTRAINT workout_mechanics_kind_check CHECK (mechanic_kind IN ('core','overlay'));;



-- SOURCE MIGRATION: 20260811023628_phase_c_hard_gate_candidate_function.sql
CREATE OR REPLACE FUNCTION public.session_hard_gate_candidates(
  p_zone_ids text[],
  p_inventory jsonb,
  p_usable_for text,
  p_max_complexity integer,
  p_max_difficulty text
) RETURNS TABLE (
  exercise_id varchar,
  exercise_name text,
  difficulty varchar,
  technical_complexity integer,
  movement_pattern varchar,
  exercise_family varchar,
  training_focus varchar,
  selection_weight integer
)
LANGUAGE sql STABLE AS $$
  WITH limits AS (
    SELECT CASE p_max_difficulty
      WHEN 'Débutant' THEN 1
      WHEN 'Intermédiaire' THEN 2
      WHEN 'Avancé' THEN 3
      ELSE 0 END AS difficulty_rank
  )
  SELECT e.id,e.name,e.difficulty,e.technical_complexity,e.movement_pattern,
         e.exercise_family,e.training_focus,e.selection_weight
  FROM public.exercises e CROSS JOIN limits l
  WHERE p_usable_for = ANY(e.usable_for)
    -- conservative unknown metadata rule
    AND e.difficulty IS NOT NULL
    AND e.technical_complexity IS NOT NULL
    AND e.movement_pattern IS NOT NULL
    AND e.exercise_family IS NOT NULL
    AND e.training_focus IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.exercise_body_zones z WHERE z.exercise_id=e.id)
    -- absolute user-declared discomfort gate
    AND public.exercise_safe_for_zones(e.id,p_zone_ids)
    -- actual inventory / ALL_OF + ANY_OF + quantities
    AND public.exercise_equipment_compatible(e.id,p_inventory)
    -- caller supplies today's capability ceilings
    AND e.technical_complexity <= p_max_complexity
    AND CASE e.difficulty WHEN 'Débutant' THEN 1 WHEN 'Intermédiaire' THEN 2 WHEN 'Avancé' THEN 3 ELSE 99 END <= l.difficulty_rank
  ORDER BY e.id;
$$;;



-- SOURCE MIGRATION: 20260811023704_phase_d_weekly_stimulus_ledger.sql
-- Phase D: weekly feedback loop. Planned stimulus and realized stimulus stay separate.

CREATE TABLE IF NOT EXISTS public.weekly_stimulus_targets (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  stimulus_type text NOT NULL,
  stimulus_key text NOT NULL,
  target_value numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'score',
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start, stimulus_type, stimulus_key),
  CONSTRAINT weekly_stimulus_targets_type_check CHECK (stimulus_type IN ('pattern','muscle','energy','focus','load','other')),
  CONSTRAINT weekly_stimulus_targets_value_check CHECK (target_value >= 0),
  CONSTRAINT weekly_stimulus_targets_context_check CHECK (jsonb_typeof(context_json)='object')
);

CREATE TABLE IF NOT EXISTS public.session_stimulus_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'internal',
  stimulus_type text NOT NULL,
  stimulus_key text NOT NULL,
  planned_value numeric NOT NULL DEFAULT 0,
  realized_value numeric,
  unit text NOT NULL DEFAULT 'score',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_stimulus_ledger_source_check CHECK (source_kind IN ('internal','external_import','manual')),
  CONSTRAINT session_stimulus_ledger_type_check CHECK (stimulus_type IN ('pattern','muscle','energy','focus','load','other')),
  CONSTRAINT session_stimulus_ledger_values_check CHECK (planned_value >= 0 AND (realized_value IS NULL OR realized_value >= 0)),
  CONSTRAINT session_stimulus_ledger_metadata_check CHECK (jsonb_typeof(metadata_json)='object')
);

CREATE INDEX IF NOT EXISTS idx_session_stimulus_user_time
  ON public.session_stimulus_ledger(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_stimulus_session
  ON public.session_stimulus_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_session_stimulus_dimension
  ON public.session_stimulus_ledger(stimulus_type, stimulus_key);

CREATE TABLE IF NOT EXISTS public.user_training_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sequence_index integer NOT NULL,
  recommended_date date,
  session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_training_plan_items_sequence_check CHECK (sequence_index >= 0),
  CONSTRAINT user_training_plan_items_status_check CHECK (status IN ('available','completed','skipped')),
  CONSTRAINT user_training_plan_items_completed_check CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_training_plan_user_sequence
  ON public.user_training_plan_items(user_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_training_plan_user_date
  ON public.user_training_plan_items(user_id, recommended_date);

ALTER TABLE public.weekly_stimulus_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_stimulus_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_training_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own weekly stimulus targets" ON public.weekly_stimulus_targets;
CREATE POLICY "Users own weekly stimulus targets" ON public.weekly_stimulus_targets
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users own session stimulus ledger" ON public.session_stimulus_ledger;
CREATE POLICY "Users own session stimulus ledger" ON public.session_stimulus_ledger
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users own training plan items" ON public.user_training_plan_items;
CREATE POLICY "Users own training plan items" ON public.user_training_plan_items
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

CREATE OR REPLACE VIEW public.weekly_stimulus_balance
WITH (security_invoker=true)
AS
WITH realized AS (
  SELECT
    user_id,
    date_trunc('week', occurred_at)::date AS week_start,
    stimulus_type,
    stimulus_key,
    unit,
    sum(planned_value) AS planned_from_sessions,
    sum(COALESCE(realized_value,0)) AS realized_value
  FROM public.session_stimulus_ledger
  GROUP BY user_id,date_trunc('week', occurred_at)::date,stimulus_type,stimulus_key,unit
), keys AS (
  SELECT user_id,week_start,stimulus_type,stimulus_key,unit FROM public.weekly_stimulus_targets
  UNION
  SELECT user_id,week_start,stimulus_type,stimulus_key,unit FROM realized
)
SELECT
  k.user_id,k.week_start,k.stimulus_type,k.stimulus_key,k.unit,
  t.target_value,
  r.planned_from_sessions,
  r.realized_value,
  CASE WHEN t.target_value IS NULL THEN NULL ELSE t.target_value - COALESCE(r.realized_value,0) END AS remaining_to_target
FROM keys k
LEFT JOIN public.weekly_stimulus_targets t
  ON t.user_id=k.user_id AND t.week_start=k.week_start AND t.stimulus_type=k.stimulus_type AND t.stimulus_key=k.stimulus_key AND t.unit=k.unit
LEFT JOIN realized r
  ON r.user_id=k.user_id AND r.week_start=k.week_start AND r.stimulus_type=k.stimulus_type AND r.stimulus_key=k.stimulus_key AND r.unit=k.unit;;



-- SOURCE MIGRATION: 20260811023738_phase_e_automatic_capture_contracts.sql
-- Phase E: backend contracts for automatic UX. No visual decisions here.

CREATE OR REPLACE VIEW public.exercise_completion_capture_schema
WITH (security_invoker=true)
AS
SELECT
  e.id AS exercise_id,
  e.name AS exercise_name,
  e.prescription_type,
  e.tracking_modes,
  e.movement_side,
  CASE
    WHEN e.prescription_type='reps_unilateral' THEN 'per_side'
    WHEN e.prescription_type LIKE 'reps%' THEN 'total'
    WHEN e.prescription_type='distance' AND e.movement_side='Unilateral' THEN 'per_side'
    WHEN e.prescription_type='isometric' AND e.movement_side='Unilateral' THEN 'per_side'
    ELSE NULL
  END AS side_semantics,
  CASE
    WHEN e.prescription_type LIKE 'reps%' THEN ARRAY['reps']::text[]
    WHEN e.prescription_type='isometric' THEN ARRAY['time']::text[]
    WHEN e.prescription_type='distance' THEN ARRAY['distance']::text[]
    ELSE ARRAY[]::text[]
  END AS required_fields,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN 'load'=ANY(e.tracking_modes) THEN 'load' END,
    CASE WHEN 'time'=ANY(e.tracking_modes) AND e.prescription_type<>'isometric' THEN 'time' END,
    CASE WHEN 'distance'=ANY(e.tracking_modes) AND e.prescription_type<>'distance' THEN 'distance' END,
    'rpe',
    'notes'
  ]::text[],NULL) AS optional_fields
FROM public.exercises e;

CREATE OR REPLACE VIEW public.user_auto_coach_snapshot
WITH (security_invoker=true)
AS
SELECT
  p.id AS user_id,
  p.experience,
  p.weekly_session_target,
  p.default_equipment,
  p.default_injured_zones,
  COALESCE(week_stats.completed_this_week,0) AS completed_this_week,
  latest_session.id AS latest_session_id,
  latest_session.completed_at AS latest_session_completed_at,
  latest_session.global_rpe AS latest_global_rpe,
  latest_session.post_workout_feeling AS latest_post_workout_feeling,
  latest_load.load_score AS latest_load_score,
  latest_load.readiness_before AS latest_readiness_before,
  next_plan.id AS next_plan_item_id,
  next_plan.sequence_index AS next_sequence_index,
  next_plan.recommended_date AS next_recommended_date
FROM public.profiles p
LEFT JOIN LATERAL (
  SELECT count(*)::int AS completed_this_week
  FROM public.workout_sessions ws
  WHERE ws.user_id=p.id
    AND ws.completed_at >= date_trunc('week',now())
    AND ws.completed_at < date_trunc('week',now()) + interval '7 days'
) week_stats ON true
LEFT JOIN LATERAL (
  SELECT ws.id,ws.completed_at,ws.global_rpe,ws.post_workout_feeling
  FROM public.workout_sessions ws
  WHERE ws.user_id=p.id AND ws.completed_at IS NOT NULL
  ORDER BY ws.completed_at DESC LIMIT 1
) latest_session ON true
LEFT JOIN LATERAL (
  SELECT utl.load_score,utl.readiness_before
  FROM public.user_training_load utl
  WHERE utl.user_id=p.id
  ORDER BY utl.calculated_at DESC LIMIT 1
) latest_load ON true
LEFT JOIN LATERAL (
  SELECT pi.id,pi.sequence_index,pi.recommended_date
  FROM public.user_training_plan_items pi
  WHERE pi.user_id=p.id AND pi.status='available'
  ORDER BY pi.sequence_index ASC,pi.created_at ASC LIMIT 1
) next_plan ON true;;



-- SOURCE MIGRATION: 20260811023812_phase_f_external_session_import_staging.sql
-- Phase F: external session import staging.
-- AI/parser output is staged and reviewed. No trigger writes user capabilities.

CREATE TABLE IF NOT EXISTS public.external_session_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  input_type text NOT NULL,
  source_uri text,
  raw_text text,
  source_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  parser_name text,
  parser_version text,
  parse_confidence numeric(4,3),
  parser_output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at timestamptz,
  committed_session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_session_imports_input_check CHECK (input_type IN ('text','photo','voice')),
  CONSTRAINT external_session_imports_confidence_check CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1)),
  CONSTRAINT external_session_imports_status_check CHECK (status IN ('received','parsed','needs_review','validated','rejected','committed')),
  CONSTRAINT external_session_imports_json_check CHECK (
    jsonb_typeof(source_metadata_json)='object' AND
    jsonb_typeof(parser_output_json)='object' AND
    jsonb_typeof(validation_json)='object'
  ),
  CONSTRAINT external_session_imports_validated_check CHECK (
    status NOT IN ('validated','committed') OR validated_at IS NOT NULL
  ),
  CONSTRAINT external_session_imports_committed_check CHECK (
    status <> 'committed' OR committed_session_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.external_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.external_session_imports(id) ON DELETE CASCADE,
  position integer NOT NULL,
  raw_name text NOT NULL,
  matched_exercise_id varchar REFERENCES public.exercises(id) ON DELETE SET NULL,
  match_confidence numeric(4,3),
  structured_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_session_items_position_check CHECK (position >= 0),
  CONSTRAINT external_session_items_confidence_check CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  CONSTRAINT external_session_items_structured_check CHECK (jsonb_typeof(structured_json)='object'),
  UNIQUE(import_id,position)
);

CREATE INDEX IF NOT EXISTS idx_external_imports_user_created
  ON public.external_session_imports(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_imports_status
  ON public.external_session_imports(status);
CREATE INDEX IF NOT EXISTS idx_external_items_import
  ON public.external_session_items(import_id,position);
CREATE INDEX IF NOT EXISTS idx_external_items_match
  ON public.external_session_items(matched_exercise_id);

ALTER TABLE public.external_session_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_session_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own external session imports" ON public.external_session_imports;
CREATE POLICY "Users own external session imports" ON public.external_session_imports
FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

DROP POLICY IF EXISTS "Users read own external session items" ON public.external_session_items;
CREATE POLICY "Users read own external session items" ON public.external_session_items
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users insert own external session items" ON public.external_session_items;
CREATE POLICY "Users insert own external session items" ON public.external_session_items
FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users update own external session items" ON public.external_session_items;
CREATE POLICY "Users update own external session items" ON public.external_session_items
FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);
DROP POLICY IF EXISTS "Users delete own external session items" ON public.external_session_items;
CREATE POLICY "Users delete own external session items" ON public.external_session_items
FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.external_session_imports i WHERE i.id=external_session_items.import_id AND i.user_id=auth.uid())
);

ALTER TABLE public.exercise_logs
  ADD COLUMN IF NOT EXISTS external_import_id uuid REFERENCES public.external_session_imports(id) ON DELETE SET NULL;
ALTER TABLE public.session_stimulus_ledger
  ADD COLUMN IF NOT EXISTS external_import_id uuid REFERENCES public.external_session_imports(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW public.external_import_review_queue
WITH (security_invoker=true)
AS
SELECT
  i.id AS import_id,
  i.user_id,
  i.input_type,
  i.status,
  i.parse_confidence,
  i.created_at,
  count(it.id) AS item_count,
  count(it.id) FILTER (WHERE it.matched_exercise_id IS NULL) AS unresolved_items,
  count(it.id) FILTER (WHERE NOT it.is_confirmed) AS unconfirmed_items
FROM public.external_session_imports i
LEFT JOIN public.external_session_items it ON it.import_id=i.id
WHERE i.status IN ('parsed','needs_review','validated')
GROUP BY i.id,i.user_id,i.input_type,i.status,i.parse_confidence,i.created_at;;



-- SOURCE MIGRATION: 20260811023909_phase_f_external_import_commit_guard.sql
CREATE OR REPLACE FUNCTION public.external_import_ready_to_commit(p_import_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.external_session_imports i
    WHERE i.id=p_import_id
      AND i.status='validated'
      AND i.validated_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.external_session_items it
        WHERE it.import_id=i.id
          AND (it.matched_exercise_id IS NULL OR NOT it.is_confirmed)
      )
  );
$$;;



-- SOURCE MIGRATION: 20260811024334_phase_c_body_zone_alias_normalization_v2.sql
CREATE TABLE IF NOT EXISTS public.body_zone_aliases (
  alias text PRIMARY KEY,
  body_zone_id text NOT NULL REFERENCES public.body_zones(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.body_zone_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on body_zone_aliases" ON public.body_zone_aliases;
CREATE POLICY "Allow public read on body_zone_aliases" ON public.body_zone_aliases
FOR SELECT TO public USING (true);

INSERT INTO public.body_zone_aliases(alias,body_zone_id,active) VALUES
('shoulder','shoulder',true),('Épaule','shoulder',true),('Epaule','shoulder',true),
('chest','chest',true),('Pectoraux','chest',true),
('arm_elbow','arm_elbow',true),('Bras / coude','arm_elbow',true),('Coude','arm_elbow',true),('Bras','arm_elbow',true),
('forearm_wrist_hand','forearm_wrist_hand',true),('Avant-bras / poignet / main','forearm_wrist_hand',true),('Poignet','forearm_wrist_hand',true),('Main','forearm_wrist_hand',true),('Avant-bras','forearm_wrist_hand',true),
('upper_back_neck','upper_back_neck',true),('Haut du dos / nuque','upper_back_neck',true),('Haut du dos','upper_back_neck',true),('Nuque','upper_back_neck',true),
('core_abdomen','core_abdomen',true),('Sangle abdominale','core_abdomen',true),('Abdominaux','core_abdomen',true),('Ventre','core_abdomen',true),
('lower_back','lower_back',true),('Bas du dos','lower_back',true),('Lombaires','lower_back',true),
('hip_glute_groin','hip_glute_groin',true),('Hanche / fessiers / aine','hip_glute_groin',true),('Hanche','hip_glute_groin',true),('Fessiers','hip_glute_groin',true),('Aine','hip_glute_groin',true),
('quadriceps','quadriceps',true),('Cuisse avant / quadriceps','quadriceps',true),('Quadriceps','quadriceps',true),('Cuisse avant','quadriceps',true),
('hamstring','hamstring',true),('Cuisse arrière / ischios','hamstring',true),('Ischios','hamstring',true),('Ischio-jambiers','hamstring',true),('Cuisse arrière','hamstring',true),
('knee','knee',true),('Genou','knee',true),
('calf_shin','calf_shin',true),('Mollet / tibia','calf_shin',true),('Mollet','calf_shin',true),('Tibia','calf_shin',true),
('ankle_foot','ankle_foot',true),('Cheville / pied','ankle_foot',true),('Cheville','ankle_foot',true),('Pied','ankle_foot',true)
ON CONFLICT(alias) DO UPDATE SET body_zone_id=EXCLUDED.body_zone_id,active=EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.normalize_body_zone_ids(p_terms text[])
RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT a.body_zone_id ORDER BY a.body_zone_id),'{}'::text[])
  FROM unnest(COALESCE(p_terms,'{}'::text[])) t(term)
  JOIN public.body_zone_aliases a ON lower(a.alias)=lower(trim(t.term)) AND a.active;
$$;

CREATE OR REPLACE FUNCTION public.body_zone_terms_all_known(p_terms text[])
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_terms,'{}'::text[])) t(term)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.body_zone_aliases a
      WHERE a.active AND lower(a.alias)=lower(trim(t.term))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.exercise_safe_for_zones(
  p_exercise_id varchar,
  p_zone_ids text[]
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_zone_ids IS NULL OR cardinality(p_zone_ids)=0 THEN true
    WHEN NOT public.body_zone_terms_all_known(p_zone_ids) THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM public.exercise_body_zones ebz
      WHERE ebz.exercise_id=p_exercise_id
        AND ebz.body_zone_id = ANY(public.normalize_body_zone_ids(p_zone_ids))
    )
  END;
$$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_default_injured_zones_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_default_injured_zones_check CHECK (
  public.body_zone_terms_all_known(default_injured_zones)
);;



-- SOURCE MIGRATION: 20260811071822_phase_b_cold_start_baseline_alignment.sql
ALTER TABLE public.user_athletic_baseline
  DROP CONSTRAINT IF EXISTS user_athletic_baseline_dimension_check;

ALTER TABLE public.user_athletic_baseline
  ADD CONSTRAINT user_athletic_baseline_dimension_check
  CHECK (dimension IN ('strength','conditioning','power','stability','mobility'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_athletic_baseline_user_dimension
  ON public.user_athletic_baseline(user_id, dimension);

CREATE OR REPLACE VIEW public.user_cold_start_prior
WITH (security_invoker=true)
AS
WITH dimensions AS (
  SELECT unnest(ARRAY['strength','conditioning','power','stability','mobility']::text[]) AS dimension
), profile_base AS (
  SELECT
    p.id AS user_id,
    p.experience,
    CASE p.experience::text
      WHEN 'beginner' THEN 2
      WHEN 'intermediate' THEN 3
      WHEN 'advanced' THEN 4
      ELSE 3
    END::smallint AS global_rating
  FROM public.profiles p
)
SELECT
  pb.user_id,
  d.dimension,
  pb.experience,
  pb.global_rating,
  b.self_rating AS explicit_self_rating,
  COALESCE(b.self_rating, pb.global_rating)::smallint AS effective_self_rating,
  CASE
    WHEN b.self_rating IS NOT NULL THEN 'dimension_self_assessment'
    ELSE 'global_experience_fallback'
  END AS prior_source,
  b.source AS baseline_source,
  b.benchmark_json
FROM profile_base pb
CROSS JOIN dimensions d
LEFT JOIN public.user_athletic_baseline b
  ON b.user_id=pb.user_id AND b.dimension=d.dimension;;



-- SOURCE MIGRATION: 20260811072643_phase_b_observation_quality_contracts.sql
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



-- SOURCE MIGRATION: 20260811073250_phase_b25_capability_update_engine_foundations.sql
-- B2.5 — capability update engine foundations.
-- The proposal function is pure: it never writes user capability state.

ALTER TABLE public.user_exercise_capabilities
  ADD COLUMN IF NOT EXISTS progressive_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT 'b2.5-draft-1';

ALTER TABLE public.user_exercise_capabilities
  DROP CONSTRAINT IF EXISTS user_exercise_capabilities_progressive_object_check;
ALTER TABLE public.user_exercise_capabilities
  ADD CONSTRAINT user_exercise_capabilities_progressive_object_check
  CHECK (jsonb_typeof(progressive_envelope)='object');

CREATE TABLE IF NOT EXISTS public.capability_update_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id varchar NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  exercise_log_id bigint REFERENCES public.exercise_logs(id) ON DELETE SET NULL,
  capability_family text NOT NULL,
  engine_version text NOT NULL,
  decision text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  observation_role text,
  quality_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  CONSTRAINT capability_update_events_family_check CHECK (
    capability_family IN ('reps','load_reps','time','pace','loaded_distance','density','progressive')
  ),
  CONSTRAINT capability_update_events_decision_check CHECK (
    decision IN ('EXCLUDE','CONFIRM','EXPAND','ADD_FRONTIER_POINT','HOLD','RECALIBRATE','REGRESS_CONFIRMED')
  ),
  CONSTRAINT capability_update_events_json_check CHECK (
    jsonb_typeof(quality_json)='object' AND
    jsonb_typeof(comparison_json)='object' AND
    jsonb_typeof(before_json)='object' AND
    jsonb_typeof(proposal_json)='object' AND
    (after_json IS NULL OR jsonb_typeof(after_json)='object')
  ),
  CONSTRAINT capability_update_events_applied_check CHECK (
    (NOT applied AND applied_at IS NULL) OR (applied AND applied_at IS NOT NULL AND after_json IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_capability_update_events_user_exercise_time
  ON public.capability_update_events(user_id,exercise_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_update_events_log
  ON public.capability_update_events(exercise_log_id);

ALTER TABLE public.capability_update_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own capability update events" ON public.capability_update_events;
CREATE POLICY "Users can read own capability update events"
  ON public.capability_update_events FOR SELECT TO authenticated
  USING (auth.uid()=user_id);

-- Utility: extract a numeric JSON value safely.
CREATE OR REPLACE FUNCTION public.jsonb_num(p_doc jsonb, p_key text)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_doc ? p_key AND jsonb_typeof(p_doc->p_key)='number' THEN (p_doc->>p_key)::numeric
    ELSE NULL
  END;
$$;

-- Utility: clamp numeric.
CREATE OR REPLACE FUNCTION public.num_clamp(p_value numeric,p_min numeric,p_max numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(p_max,GREATEST(p_min,p_value));
$$;

-- Pure proposal engine. No DB write.
-- Input current envelope is family-specific JSON. Observation must already be classified by B2.4.
CREATE OR REPLACE FUNCTION public.propose_capability_update(
  p_family text,
  p_current jsonb,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_confirmed boolean,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_current jsonb := COALESCE(p_current,'{}'::jsonb);
  v_quality numeric := public.num_clamp(COALESCE(p_quality,0),0,1);
  v_expected_rpe numeric := COALESCE(public.jsonb_num(p_expected,'target_rpe'),public.jsonb_num(p_expected,'target_rpe_max'));
  v_actual_rpe numeric := public.jsonb_num(p_actual,'rpe');
  v_rpe_delta numeric := CASE WHEN v_expected_rpe IS NOT NULL AND v_actual_rpe IS NOT NULL THEN v_actual_rpe-v_expected_rpe ELSE 0 END;
  v_result jsonb;
  v_reason text[] := '{}'::text[];
  v_decision text := 'HOLD';
  v_signal text := 'NEUTRAL';
  v_expected_value numeric;
  v_actual_value numeric;
  v_old_value numeric;
  v_load numeric;
  v_reps numeric;
  v_frontier jsonb;
  v_point jsonb;
  v_stage numeric;
  v_partial numeric;
BEGIN
  IF p_family NOT IN ('reps','load_reps','time','pace','loaded_distance','density','progressive') THEN
    RAISE EXCEPTION 'Unsupported capability family: %',p_family;
  END IF;

  IF NOT COALESCE(p_capability_eligible,false) OR COALESCE(p_pain_affected,false) THEN
    v_decision := 'EXCLUDE';
    v_reason := CASE WHEN COALESCE(p_pain_affected,false)
      THEN ARRAY['PAIN_STATE_ONLY']::text[] ELSE ARRAY['NOT_CAPABILITY_ELIGIBLE']::text[] END;
    RETURN jsonb_build_object(
      'engine_version','b2.5-draft-1','family',p_family,'decision',v_decision,
      'signal','NONE','reason_codes',v_reason,'before',v_current,'after',v_current,
      'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'observed_at',p_observed_at
    );
  END IF;

  IF v_quality <= 0 THEN
    RETURN jsonb_build_object(
      'engine_version','b2.5-draft-1','family',p_family,'decision','HOLD',
      'signal','NONE','reason_codes',ARRAY['ZERO_QUALITY']::text[],'before',v_current,'after',v_current,
      'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'observed_at',p_observed_at
    );
  END IF;

  IF p_family='reps' THEN
    v_expected_value := COALESCE(public.jsonb_num(p_expected,'reps_target'),public.jsonb_num(p_expected,'reps_max'),public.jsonb_num(p_expected,'reps_min'));
    v_actual_value := public.jsonb_num(p_actual,'reps');
    v_old_value := public.jsonb_num(v_current,'repeatable_reps');
    IF v_actual_value IS NULL THEN
      v_reason := ARRAY['MISSING_REPS'];
    ELSIF v_old_value IS NULL THEN
      v_decision := 'CONFIRM'; v_signal := 'INITIALIZE';
      v_current := v_current || jsonb_build_object('repeatable_reps',v_actual_value,'last_observed_at',p_observed_at);
      v_reason := ARRAY['FIRST_VALID_REPS'];
    ELSIF v_actual_value > v_old_value AND v_rpe_delta <= 0 THEN
      v_decision := CASE WHEN p_confirmed THEN 'EXPAND' ELSE 'HOLD' END;
      v_signal := 'POSITIVE';
      IF p_confirmed THEN v_current := v_current || jsonb_build_object('repeatable_reps',v_actual_value,'last_observed_at',p_observed_at); END IF;
      v_reason := CASE WHEN p_confirmed THEN ARRAY['HIGHER_REPS_CONFIRMED'] ELSE ARRAY['HIGHER_REPS_UNCONFIRMED'] END;
    ELSIF v_actual_value = v_old_value AND v_rpe_delta < 0 THEN
      v_decision := 'CONFIRM'; v_signal := 'POSITIVE_EFFICIENCY';
      v_reason := ARRAY['SAME_REPS_LOWER_RPE'];
    ELSIF v_actual_value < v_old_value AND v_rpe_delta > 0 THEN
      v_signal := 'NEGATIVE';
      IF p_confirmed THEN
        v_decision := 'REGRESS_CONFIRMED';
        v_current := v_current || jsonb_build_object('repeatable_reps',v_actual_value,'last_observed_at',p_observed_at);
        v_reason := ARRAY['LOWER_REPS_HIGHER_RPE_CONFIRMED'];
      ELSE
        v_decision := 'HOLD'; v_reason := ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY'];
      END IF;
    ELSE
      v_decision := 'CONFIRM'; v_reason := ARRAY['REPS_COMPATIBLE_WITH_ENVELOPE'];
    END IF;

  ELSIF p_family='time' THEN
    v_actual_value := public.jsonb_num(p_actual,'duration_seconds');
    v_old_value := public.jsonb_num(v_current,'repeatable_seconds');
    IF v_actual_value IS NULL THEN
      v_reason := ARRAY['MISSING_DURATION'];
    ELSIF v_old_value IS NULL THEN
      v_decision := 'CONFIRM'; v_signal := 'INITIALIZE';
      v_current := v_current || jsonb_build_object('repeatable_seconds',v_actual_value,'last_observed_at',p_observed_at);
      v_reason := ARRAY['FIRST_VALID_TIME'];
    ELSIF v_actual_value > v_old_value AND v_rpe_delta <= 0 THEN
      v_signal := 'POSITIVE';
      IF p_confirmed THEN v_decision := 'EXPAND'; v_current := v_current || jsonb_build_object('repeatable_seconds',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LONGER_HOLD_CONFIRMED'];
      ELSE v_decision := 'HOLD'; v_reason:=ARRAY['LONGER_HOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value < v_old_value AND v_rpe_delta > 0 THEN
      v_signal := 'NEGATIVE';
      IF p_confirmed THEN v_decision := 'REGRESS_CONFIRMED'; v_current := v_current || jsonb_build_object('repeatable_seconds',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['SHORTER_HOLD_HIGHER_RPE_CONFIRMED'];
      ELSE v_decision := 'HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE
      v_decision := 'CONFIRM'; v_reason:=ARRAY['TIME_COMPATIBLE_WITH_ENVELOPE'];
    END IF;

  ELSIF p_family='load_reps' THEN
    v_load := public.jsonb_num(p_actual,'load_kg');
    v_reps := public.jsonb_num(p_actual,'reps');
    IF v_load IS NULL OR v_reps IS NULL THEN
      v_reason := ARRAY['MISSING_LOAD_OR_REPS'];
    ELSE
      v_frontier := COALESCE(v_current->'frontier','[]'::jsonb);
      IF jsonb_typeof(v_frontier) <> 'array' THEN v_frontier := '[]'::jsonb; END IF;
      v_point := jsonb_build_object('load_kg',v_load,'reps',v_reps,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      -- Keep a Pareto frontier: remove points dominated by the new point.
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_frontier) x
        WHERE public.jsonb_num(x,'load_kg') >= v_load AND public.jsonb_num(x,'reps') >= v_reps
          AND (public.jsonb_num(x,'load_kg') > v_load OR public.jsonb_num(x,'reps') > v_reps)
      ) THEN
        v_signal := 'BELOW_FRONTIER';
        IF p_confirmed AND v_rpe_delta > 0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['BELOW_FRONTIER_CONFIRMED'];
        ELSE v_decision:='HOLD'; v_reason:=ARRAY['BELOW_FRONTIER_NOT_ENOUGH_TO_REGRESS']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier
        FROM jsonb_array_elements(v_frontier) x
        WHERE NOT (
          public.jsonb_num(x,'load_kg') <= v_load AND public.jsonb_num(x,'reps') <= v_reps
          AND (public.jsonb_num(x,'load_kg') < v_load OR public.jsonb_num(x,'reps') < v_reps)
        );
        v_frontier := v_frontier || jsonb_build_array(v_point);
        v_current := v_current || jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at);
        v_decision := 'ADD_FRONTIER_POINT'; v_signal := 'POSITIVE_OR_NEW_CAPACITY_POINT';
        v_reason := ARRAY['NON_DOMINATED_LOAD_REP_POINT'];
      END IF;
    END IF;

  ELSIF p_family='pace' THEN
    IF public.jsonb_num(p_actual,'distance_meters') IS NOT NULL AND public.jsonb_num(p_actual,'duration_seconds') IS NOT NULL AND public.jsonb_num(p_actual,'duration_seconds') > 0 THEN
      v_actual_value := public.jsonb_num(p_actual,'distance_meters') / public.jsonb_num(p_actual,'duration_seconds');
    END IF;
    v_old_value := public.jsonb_num(v_current,'repeatable_mps');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DISTANCE_OR_TIME'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('repeatable_mps',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_PACE'];
    ELSIF v_actual_value > v_old_value AND v_rpe_delta <= 0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('repeatable_mps',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FASTER_PACE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['FASTER_PACE_UNCONFIRMED']; END IF;
    ELSIF v_actual_value < v_old_value AND v_rpe_delta > 0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('repeatable_mps',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['SLOWER_PACE_HIGHER_RPE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['PACE_COMPATIBLE_WITH_ENVELOPE']; END IF;

  ELSIF p_family='loaded_distance' THEN
    v_load := public.jsonb_num(p_actual,'load_kg');
    IF public.jsonb_num(p_actual,'distance_meters') IS NOT NULL AND public.jsonb_num(p_actual,'duration_seconds') IS NOT NULL AND public.jsonb_num(p_actual,'duration_seconds') > 0 THEN
      v_actual_value := public.jsonb_num(p_actual,'distance_meters') / public.jsonb_num(p_actual,'duration_seconds');
    END IF;
    IF v_load IS NULL OR v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_LOAD_DISTANCE_OR_TIME'];
    ELSE
      v_frontier := COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('load_kg',v_load,'distance_meters',public.jsonb_num(p_actual,'distance_meters'),'duration_seconds',public.jsonb_num(p_actual,'duration_seconds'),'pace_mps',v_actual_value,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      -- For carries, do not scalarize load and pace. Keep non-dominated observations.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_frontier) x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'pace_mps')>=v_actual_value AND (public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'pace_mps')>v_actual_value)) THEN
        v_decision:='HOLD'; v_signal:='BELOW_FRONTIER'; v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER'];
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier) x
        WHERE NOT (public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'pace_mps')<=v_actual_value AND (public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'pace_mps')<v_actual_value));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at);
        v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_LOADED_DISTANCE_POINT'];
      END IF;
    END IF;

  ELSIF p_family='progressive' THEN
    v_stage := public.jsonb_num(p_actual,'last_completed_stage');
    v_partial := COALESCE(public.jsonb_num(p_actual,'partial_next_stage'),0);
    v_actual_value := CASE WHEN v_stage IS NULL THEN NULL ELSE v_stage + public.num_clamp(v_partial,0,0.999) END;
    v_old_value := public.jsonb_num(v_current,'threshold_stage_equivalent');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_PROGRESSIVE_STAGE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_PROGRESSIVE_THRESHOLD'];
    ELSIF v_actual_value > v_old_value THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value < v_old_value THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['PROGRESSIVE_THRESHOLD_CONFIRMED']; END IF;

  ELSE -- density
    v_expected_value := public.jsonb_num(p_actual,'density_value');
    v_old_value := public.jsonb_num(v_current,'repeatable_density');
    IF v_expected_value IS NULL THEN v_reason:=ARRAY['MISSING_DENSITY_VALUE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('repeatable_density',v_expected_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_DENSITY'];
    ELSIF v_expected_value > v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('repeatable_density',v_expected_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_DENSITY_UNCONFIRMED']; END IF;
    ELSIF v_expected_value < v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('repeatable_density',v_expected_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['DENSITY_COMPATIBLE_WITH_ENVELOPE']; END IF;
  END IF;

  v_result := jsonb_build_object(
    'engine_version','b2.5-draft-1','family',p_family,'decision',v_decision,'signal',v_signal,
    'reason_codes',v_reason,'before',COALESCE(p_current,'{}'::jsonb),'after',v_current,
    'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'rpe_delta',v_rpe_delta,
    'observed_at',p_observed_at
  );
  RETURN v_result;
END;
$$;;



-- SOURCE MIGRATION: 20260811073459_phase_b25_capability_update_engine_contextual_v2.sql
-- B2.5 draft-2: preserve multidimensional frontiers and protocol comparability.
DROP FUNCTION IF EXISTS public.propose_capability_update(text,jsonb,jsonb,jsonb,numeric,boolean,boolean,boolean,timestamptz);

CREATE OR REPLACE FUNCTION public.propose_capability_update(
  p_family text,
  p_current jsonb,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_confirmed boolean,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_current jsonb := COALESCE(p_current,'{}'::jsonb);
  v_before jsonb := COALESCE(p_current,'{}'::jsonb);
  v_quality numeric := public.num_clamp(COALESCE(p_quality,0),0,1);
  v_expected_rpe numeric := COALESCE(public.jsonb_num(p_expected,'target_rpe'),public.jsonb_num(p_expected,'target_rpe_max'));
  v_actual_rpe numeric := public.jsonb_num(p_actual,'rpe');
  v_rpe_delta numeric := CASE WHEN v_expected_rpe IS NOT NULL AND v_actual_rpe IS NOT NULL THEN v_actual_rpe-v_expected_rpe ELSE 0 END;
  v_reason text[] := '{}'::text[];
  v_decision text := 'HOLD';
  v_signal text := 'NEUTRAL';
  v_actual_value numeric;
  v_old_value numeric;
  v_load numeric;
  v_reps numeric;
  v_frontier jsonb;
  v_point jsonb;
  v_stage numeric;
  v_partial numeric;
  v_distance numeric;
  v_duration numeric;
  v_pace numeric;
  v_signature text := NULLIF(trim(COALESCE(p_comparison->>'protocol_signature','')),'');
  v_existing_signature text := NULLIF(trim(COALESCE(v_current->>'protocol_signature','')),'');
  v_mode text := COALESCE(NULLIF(trim(p_comparison->>'capability_mode'),''),'repeatable');
  v_value_key text;
BEGIN
  IF p_family NOT IN ('reps','load_reps','time','pace','loaded_distance','density','progressive') THEN
    RAISE EXCEPTION 'Unsupported capability family: %',p_family;
  END IF;
  IF v_mode NOT IN ('fresh','repeatable') THEN
    RAISE EXCEPTION 'Unsupported capability_mode: %',v_mode;
  END IF;

  IF NOT COALESCE(p_capability_eligible,false) OR COALESCE(p_pain_affected,false) THEN
    v_decision := 'EXCLUDE';
    v_reason := CASE WHEN COALESCE(p_pain_affected,false)
      THEN ARRAY['PAIN_STATE_ONLY']::text[] ELSE ARRAY['NOT_CAPABILITY_ELIGIBLE']::text[] END;
    RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision',v_decision,'signal','NONE','reason_codes',v_reason,'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
  END IF;
  IF v_quality <= 0 THEN
    RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['ZERO_QUALITY']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
  END IF;

  -- Context-sensitive mechanics cannot be compared without a protocol signature.
  IF p_family IN ('density','progressive') THEN
    IF v_signature IS NULL THEN
      RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['MISSING_PROTOCOL_SIGNATURE']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
    END IF;
    IF v_existing_signature IS NOT NULL AND v_existing_signature <> v_signature THEN
      RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','INCOMPARABLE_CONTEXT','reason_codes',ARRAY['PROTOCOL_SIGNATURE_MISMATCH']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
    END IF;
    v_current := v_current || jsonb_build_object('protocol_signature',v_signature);
  END IF;

  IF p_family='reps' THEN
    v_actual_value := public.jsonb_num(p_actual,'reps');
    v_value_key := CASE WHEN v_mode='fresh' THEN 'fresh_reps' ELSE 'repeatable_reps' END;
    v_old_value := public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_REPS'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_REPS'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_REPS_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_REPS_UNCONFIRMED']; END IF;
    ELSIF v_actual_value=v_old_value AND v_rpe_delta<0 THEN v_decision:='CONFIRM'; v_signal:='POSITIVE_EFFICIENCY'; v_reason:=ARRAY['SAME_REPS_LOWER_RPE'];
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_REPS_HIGHER_RPE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['REPS_COMPATIBLE_WITH_ENVELOPE']; END IF;

  ELSIF p_family='time' THEN
    v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
    v_value_key:=CASE WHEN v_mode='fresh' THEN 'fresh_seconds' ELSE 'repeatable_seconds' END;
    v_old_value:=public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DURATION'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_TIME'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LONGER_HOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['LONGER_HOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['SHORTER_HOLD_HIGHER_RPE_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['TIME_COMPATIBLE_WITH_ENVELOPE']; END IF;

  ELSIF p_family='load_reps' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg'); v_reps:=public.jsonb_num(p_actual,'reps');
    IF v_load IS NULL OR v_reps IS NULL THEN v_reason:=ARRAY['MISSING_LOAD_OR_REPS'];
    ELSE
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('load_kg',v_load,'reps',v_reps,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'reps')>=v_reps AND (public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'reps')>v_reps)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['BELOW_FRONTIER_NOT_ENOUGH_TO_REGRESS']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'reps')<=v_reps AND (public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'reps')<v_reps));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_LOAD_REP_POINT'];
      END IF;
    END IF;

  ELSIF p_family='pace' THEN
    v_distance:=public.jsonb_num(p_actual,'distance_meters'); v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_DISTANCE_OR_TIME'];
    ELSE
      v_pace:=v_distance/v_duration;
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND (public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND (public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_DISTANCE_PACE_POINT'];
      END IF;
    END IF;

  ELSIF p_family='loaded_distance' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg'); v_distance:=public.jsonb_num(p_actual,'distance_meters'); v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_load IS NULL OR v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_LOAD_DISTANCE_OR_TIME'];
    ELSE
      v_pace:=v_distance/v_duration;
      v_frontier:=COALESCE(v_current->'frontier','[]'::jsonb); IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]'::jsonb; END IF;
      v_point:=jsonb_build_object('load_kg',v_load,'distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND (public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN
        v_signal:='BELOW_FRONTIER'; IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED'; v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER']; END IF;
      ELSE
        SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND (public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));
        v_frontier:=v_frontier||jsonb_build_array(v_point); v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at); v_decision:='ADD_FRONTIER_POINT'; v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT'; v_reason:=ARRAY['NON_DOMINATED_LOADED_DISTANCE_POINT'];
      END IF;
    END IF;

  ELSIF p_family='progressive' THEN
    v_stage:=public.jsonb_num(p_actual,'last_completed_stage'); v_partial:=COALESCE(public.jsonb_num(p_actual,'partial_next_stage'),0); v_actual_value:=CASE WHEN v_stage IS NULL THEN NULL ELSE v_stage+public.num_clamp(v_partial,0,0.999) END; v_old_value:=public.jsonb_num(v_current,'threshold_stage_equivalent');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_PROGRESSIVE_STAGE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_PROGRESSIVE_THRESHOLD'];
    ELSIF v_actual_value>v_old_value THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_PROGRESSIVE_THRESHOLD_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['PROGRESSIVE_THRESHOLD_CONFIRMED']; END IF;

  ELSE -- density
    v_actual_value:=public.jsonb_num(p_actual,'density_value'); v_old_value:=public.jsonb_num(v_current,'repeatable_density');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DENSITY_VALUE'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM'; v_signal:='INITIALIZE'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['FIRST_VALID_DENSITY'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE'; IF p_confirmed THEN v_decision:='EXPAND'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['HIGHER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['HIGHER_DENSITY_UNCONFIRMED']; END IF;
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE'; IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED'; v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at); v_reason:=ARRAY['LOWER_DENSITY_CONFIRMED']; ELSE v_decision:='HOLD'; v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY']; END IF;
    ELSE v_decision:='CONFIRM'; v_reason:=ARRAY['DENSITY_COMPATIBLE_WITH_ENVELOPE']; END IF;
  END IF;

  RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision',v_decision,'signal',v_signal,'reason_codes',v_reason,'before',v_before,'after',v_current,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'rpe_delta',v_rpe_delta,'comparison',COALESCE(p_comparison,'{}'::jsonb),'observed_at',p_observed_at);
END;
$$;;



-- SOURCE MIGRATION: 20260811073654_phase_b25_frontier_confirmation_guard.sql
-- Patch draft-2 frontier families: first valid point initializes; later expansion requires confirmation.
CREATE OR REPLACE FUNCTION public.propose_capability_update(
  p_family text,
  p_current jsonb,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_confirmed boolean,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_current jsonb:=COALESCE(p_current,'{}'::jsonb); v_before jsonb:=COALESCE(p_current,'{}'::jsonb);
  v_quality numeric:=public.num_clamp(COALESCE(p_quality,0),0,1);
  v_expected_rpe numeric:=COALESCE(public.jsonb_num(p_expected,'target_rpe'),public.jsonb_num(p_expected,'target_rpe_max'));
  v_actual_rpe numeric:=public.jsonb_num(p_actual,'rpe');
  v_rpe_delta numeric:=CASE WHEN v_expected_rpe IS NOT NULL AND v_actual_rpe IS NOT NULL THEN v_actual_rpe-v_expected_rpe ELSE 0 END;
  v_reason text[]:='{}'; v_decision text:='HOLD'; v_signal text:='NEUTRAL';
  v_actual_value numeric; v_old_value numeric; v_load numeric; v_reps numeric; v_frontier jsonb; v_point jsonb;
  v_stage numeric; v_partial numeric; v_distance numeric; v_duration numeric; v_pace numeric;
  v_signature text:=NULLIF(trim(COALESCE(p_comparison->>'protocol_signature','')),'');
  v_existing_signature text:=NULLIF(trim(COALESCE(v_current->>'protocol_signature','')),'');
  v_mode text:=COALESCE(NULLIF(trim(p_comparison->>'capability_mode'),''),'repeatable'); v_value_key text; v_frontier_empty boolean;
BEGIN
  IF p_family NOT IN ('reps','load_reps','time','pace','loaded_distance','density','progressive') THEN RAISE EXCEPTION 'Unsupported capability family: %',p_family; END IF;
  IF v_mode NOT IN ('fresh','repeatable') THEN RAISE EXCEPTION 'Unsupported capability_mode: %',v_mode; END IF;
  IF NOT COALESCE(p_capability_eligible,false) OR COALESCE(p_pain_affected,false) THEN
    RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','EXCLUDE','signal','NONE','reason_codes',CASE WHEN p_pain_affected THEN ARRAY['PAIN_STATE_ONLY']::text[] ELSE ARRAY['NOT_CAPABILITY_ELIGIBLE']::text[] END,'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'),'observed_at',p_observed_at);
  END IF;
  IF v_quality<=0 THEN RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['ZERO_QUALITY']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'),'observed_at',p_observed_at); END IF;
  IF p_family IN ('density','progressive') THEN
    IF v_signature IS NULL THEN RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','NONE','reason_codes',ARRAY['MISSING_PROTOCOL_SIGNATURE']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'),'observed_at',p_observed_at); END IF;
    IF v_existing_signature IS NOT NULL AND v_existing_signature<>v_signature THEN RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision','HOLD','signal','INCOMPARABLE_CONTEXT','reason_codes',ARRAY['PROTOCOL_SIGNATURE_MISMATCH']::text[],'before',v_before,'after',v_before,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'comparison',COALESCE(p_comparison,'{}'),'observed_at',p_observed_at); END IF;
    v_current:=v_current||jsonb_build_object('protocol_signature',v_signature);
  END IF;

  IF p_family='reps' THEN
    v_actual_value:=public.jsonb_num(p_actual,'reps'); v_value_key:=CASE WHEN v_mode='fresh' THEN 'fresh_reps' ELSE 'repeatable_reps' END; v_old_value:=public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_REPS'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM';v_signal:='INITIALIZE';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['FIRST_VALID_REPS'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE';IF p_confirmed THEN v_decision:='EXPAND';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['HIGHER_REPS_CONFIRMED'];ELSE v_reason:=ARRAY['HIGHER_REPS_UNCONFIRMED'];END IF;
    ELSIF v_actual_value=v_old_value AND v_rpe_delta<0 THEN v_decision:='CONFIRM';v_signal:='POSITIVE_EFFICIENCY';v_reason:=ARRAY['SAME_REPS_LOWER_RPE'];
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE';IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['LOWER_REPS_HIGHER_RPE_CONFIRMED'];ELSE v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY'];END IF;
    ELSE v_decision:='CONFIRM';v_reason:=ARRAY['REPS_COMPATIBLE_WITH_ENVELOPE'];END IF;
  ELSIF p_family='time' THEN
    v_actual_value:=public.jsonb_num(p_actual,'duration_seconds'); v_value_key:=CASE WHEN v_mode='fresh' THEN 'fresh_seconds' ELSE 'repeatable_seconds' END; v_old_value:=public.jsonb_num(v_current,v_value_key);
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DURATION'];
    ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM';v_signal:='INITIALIZE';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['FIRST_VALID_TIME'];
    ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE';IF p_confirmed THEN v_decision:='EXPAND';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['LONGER_HOLD_CONFIRMED'];ELSE v_reason:=ARRAY['LONGER_HOLD_UNCONFIRMED'];END IF;
    ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE';IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED';v_current:=v_current||jsonb_build_object(v_value_key,v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['SHORTER_HOLD_HIGHER_RPE_CONFIRMED'];ELSE v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY'];END IF;
    ELSE v_decision:='CONFIRM';v_reason:=ARRAY['TIME_COMPATIBLE_WITH_ENVELOPE'];END IF;
  ELSIF p_family='load_reps' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg');v_reps:=public.jsonb_num(p_actual,'reps');
    IF v_load IS NULL OR v_reps IS NULL THEN v_reason:=ARRAY['MISSING_LOAD_OR_REPS']; ELSE
      v_frontier:=COALESCE(v_current->'frontier','[]');IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]';END IF;v_frontier_empty:=jsonb_array_length(v_frontier)=0;
      v_point:=jsonb_build_object('load_kg',v_load,'reps',v_reps,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'reps')>=v_reps AND(public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'reps')>v_reps)) THEN v_signal:='BELOW_FRONTIER';IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED';v_reason:=ARRAY['BELOW_FRONTIER_CONFIRMED'];ELSE v_reason:=ARRAY['BELOW_FRONTIER_NOT_ENOUGH_TO_REGRESS'];END IF;
      ELSIF v_frontier_empty OR p_confirmed THEN SELECT COALESCE(jsonb_agg(x),'[]') INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'reps')<=v_reps AND(public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'reps')<v_reps));v_frontier:=v_frontier||jsonb_build_array(v_point);v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at);v_decision:=CASE WHEN v_frontier_empty THEN 'CONFIRM' ELSE 'ADD_FRONTIER_POINT' END;v_signal:=CASE WHEN v_frontier_empty THEN 'INITIALIZE' ELSE 'POSITIVE_OR_NEW_CAPACITY_POINT' END;v_reason:=CASE WHEN v_frontier_empty THEN ARRAY['FIRST_VALID_LOAD_REP_POINT'] ELSE ARRAY['NON_DOMINATED_LOAD_REP_POINT_CONFIRMED'] END;
      ELSE v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT';v_reason:=ARRAY['NON_DOMINATED_LOAD_REP_POINT_UNCONFIRMED']; END IF; END IF;
  ELSIF p_family='pace' THEN
    v_distance:=public.jsonb_num(p_actual,'distance_meters');v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_DISTANCE_OR_TIME']; ELSE v_pace:=v_distance/v_duration;v_frontier:=COALESCE(v_current->'frontier','[]');IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]';END IF;v_frontier_empty:=jsonb_array_length(v_frontier)=0;v_point:=jsonb_build_object('distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND(public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN v_signal:='BELOW_FRONTIER';IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED';v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER_CONFIRMED'];ELSE v_reason:=ARRAY['PACE_DISTANCE_BELOW_FRONTIER'];END IF;
      ELSIF v_frontier_empty OR p_confirmed THEN SELECT COALESCE(jsonb_agg(x),'[]') INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND(public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));v_frontier:=v_frontier||jsonb_build_array(v_point);v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at);v_decision:=CASE WHEN v_frontier_empty THEN 'CONFIRM' ELSE 'ADD_FRONTIER_POINT' END;v_signal:=CASE WHEN v_frontier_empty THEN 'INITIALIZE' ELSE 'POSITIVE_OR_NEW_CAPACITY_POINT' END;v_reason:=CASE WHEN v_frontier_empty THEN ARRAY['FIRST_VALID_DISTANCE_PACE_POINT'] ELSE ARRAY['NON_DOMINATED_DISTANCE_PACE_POINT_CONFIRMED'] END;
      ELSE v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT';v_reason:=ARRAY['NON_DOMINATED_DISTANCE_PACE_POINT_UNCONFIRMED'];END IF;END IF;
  ELSIF p_family='loaded_distance' THEN
    v_load:=public.jsonb_num(p_actual,'load_kg');v_distance:=public.jsonb_num(p_actual,'distance_meters');v_duration:=public.jsonb_num(p_actual,'duration_seconds');
    IF v_load IS NULL OR v_distance IS NULL OR v_duration IS NULL OR v_duration<=0 THEN v_reason:=ARRAY['MISSING_LOAD_DISTANCE_OR_TIME']; ELSE v_pace:=v_distance/v_duration;v_frontier:=COALESCE(v_current->'frontier','[]');IF jsonb_typeof(v_frontier)<>'array' THEN v_frontier:='[]';END IF;v_frontier_empty:=jsonb_array_length(v_frontier)=0;v_point:=jsonb_build_object('load_kg',v_load,'distance_meters',v_distance,'duration_seconds',v_duration,'pace_mps',v_pace,'rpe',v_actual_rpe,'quality',v_quality,'observed_at',p_observed_at);
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_frontier)x WHERE public.jsonb_num(x,'load_kg')>=v_load AND public.jsonb_num(x,'distance_meters')>=v_distance AND public.jsonb_num(x,'pace_mps')>=v_pace AND(public.jsonb_num(x,'load_kg')>v_load OR public.jsonb_num(x,'distance_meters')>v_distance OR public.jsonb_num(x,'pace_mps')>v_pace)) THEN v_signal:='BELOW_FRONTIER';IF p_confirmed AND v_rpe_delta>0 THEN v_decision:='REGRESS_CONFIRMED';v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER_CONFIRMED'];ELSE v_reason:=ARRAY['LOADED_DISTANCE_BELOW_FRONTIER'];END IF;
      ELSIF v_frontier_empty OR p_confirmed THEN SELECT COALESCE(jsonb_agg(x),'[]') INTO v_frontier FROM jsonb_array_elements(v_frontier)x WHERE NOT(public.jsonb_num(x,'load_kg')<=v_load AND public.jsonb_num(x,'distance_meters')<=v_distance AND public.jsonb_num(x,'pace_mps')<=v_pace AND(public.jsonb_num(x,'load_kg')<v_load OR public.jsonb_num(x,'distance_meters')<v_distance OR public.jsonb_num(x,'pace_mps')<v_pace));v_frontier:=v_frontier||jsonb_build_array(v_point);v_current:=v_current||jsonb_build_object('frontier',v_frontier,'last_observed_at',p_observed_at);v_decision:=CASE WHEN v_frontier_empty THEN 'CONFIRM' ELSE 'ADD_FRONTIER_POINT' END;v_signal:=CASE WHEN v_frontier_empty THEN 'INITIALIZE' ELSE 'POSITIVE_OR_NEW_CAPACITY_POINT' END;v_reason:=CASE WHEN v_frontier_empty THEN ARRAY['FIRST_VALID_LOADED_DISTANCE_POINT'] ELSE ARRAY['NON_DOMINATED_LOADED_DISTANCE_POINT_CONFIRMED'] END;
      ELSE v_signal:='POSITIVE_OR_NEW_CAPACITY_POINT';v_reason:=ARRAY['NON_DOMINATED_LOADED_DISTANCE_POINT_UNCONFIRMED'];END IF;END IF;
  ELSIF p_family='progressive' THEN
    v_stage:=public.jsonb_num(p_actual,'last_completed_stage');v_partial:=COALESCE(public.jsonb_num(p_actual,'partial_next_stage'),0);v_actual_value:=CASE WHEN v_stage IS NULL THEN NULL ELSE v_stage+public.num_clamp(v_partial,0,0.999) END;v_old_value:=public.jsonb_num(v_current,'threshold_stage_equivalent');
    IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_PROGRESSIVE_STAGE'];ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM';v_signal:='INITIALIZE';v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at);v_reason:=ARRAY['FIRST_VALID_PROGRESSIVE_THRESHOLD'];ELSIF v_actual_value>v_old_value THEN v_signal:='POSITIVE';IF p_confirmed THEN v_decision:='EXPAND';v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at);v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_CONFIRMED'];ELSE v_reason:=ARRAY['HIGHER_PROGRESSIVE_THRESHOLD_UNCONFIRMED'];END IF;ELSIF v_actual_value<v_old_value THEN v_signal:='NEGATIVE';IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED';v_current:=v_current||jsonb_build_object('threshold_stage_equivalent',v_actual_value,'last_completed_stage',v_stage,'partial_next_stage',v_partial,'last_observed_at',p_observed_at);v_reason:=ARRAY['LOWER_PROGRESSIVE_THRESHOLD_CONFIRMED'];ELSE v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY'];END IF;ELSE v_decision:='CONFIRM';v_reason:=ARRAY['PROGRESSIVE_THRESHOLD_CONFIRMED'];END IF;
  ELSE
    v_actual_value:=public.jsonb_num(p_actual,'density_value');v_old_value:=public.jsonb_num(v_current,'repeatable_density');IF v_actual_value IS NULL THEN v_reason:=ARRAY['MISSING_DENSITY_VALUE'];ELSIF v_old_value IS NULL THEN v_decision:='CONFIRM';v_signal:='INITIALIZE';v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['FIRST_VALID_DENSITY'];ELSIF v_actual_value>v_old_value AND v_rpe_delta<=0 THEN v_signal:='POSITIVE';IF p_confirmed THEN v_decision:='EXPAND';v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['HIGHER_DENSITY_CONFIRMED'];ELSE v_reason:=ARRAY['HIGHER_DENSITY_UNCONFIRMED'];END IF;ELSIF v_actual_value<v_old_value AND v_rpe_delta>0 THEN v_signal:='NEGATIVE';IF p_confirmed THEN v_decision:='REGRESS_CONFIRMED';v_current:=v_current||jsonb_build_object('repeatable_density',v_actual_value,'last_observed_at',p_observed_at);v_reason:=ARRAY['LOWER_DENSITY_CONFIRMED'];ELSE v_reason:=ARRAY['NEGATIVE_UNCONFIRMED_STATE_ONLY'];END IF;ELSE v_decision:='CONFIRM';v_reason:=ARRAY['DENSITY_COMPATIBLE_WITH_ENVELOPE'];END IF;
  END IF;
  RETURN jsonb_build_object('engine_version','b2.5-draft-2','family',p_family,'decision',v_decision,'signal',v_signal,'reason_codes',v_reason,'before',v_before,'after',v_current,'quality',v_quality,'confirmed',COALESCE(p_confirmed,false),'rpe_delta',v_rpe_delta,'comparison',COALESCE(p_comparison,'{}'),'observed_at',p_observed_at);
END;
$$;;



-- SOURCE MIGRATION: 20260811073818_phase_b25_evidence_confirmation_policy_and_state_proposal.sql
CREATE TABLE IF NOT EXISTS public.performance_engine_policy (
  policy_key text PRIMARY KEY,
  engine_version text NOT NULL,
  positive_confirmations_required smallint NOT NULL,
  negative_confirmations_required smallint NOT NULL,
  confidence_half_evidence numeric NOT NULL,
  positive_candidate_evidence_factor numeric NOT NULL,
  negative_candidate_evidence_factor numeric NOT NULL,
  freshness_half_life_days numeric NOT NULL,
  active boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (positive_confirmations_required>=1),
  CHECK (negative_confirmations_required>=1),
  CHECK (confidence_half_evidence>0),
  CHECK (positive_candidate_evidence_factor BETWEEN 0 AND 1),
  CHECK (negative_candidate_evidence_factor BETWEEN 0 AND 1),
  CHECK (freshness_half_life_days>0)
);

INSERT INTO public.performance_engine_policy(
 policy_key,engine_version,positive_confirmations_required,negative_confirmations_required,
 confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
 freshness_half_life_days,active,notes
) VALUES (
 'b2.5-draft-default','b2.5-draft-2',2,3,2.0,0.50,0.25,45,false,
 'Simulation/tuning policy only. Values are product calibration parameters, not validated physiological constants.'
)
ON CONFLICT(policy_key) DO UPDATE SET
 engine_version=EXCLUDED.engine_version,
 positive_confirmations_required=EXCLUDED.positive_confirmations_required,
 negative_confirmations_required=EXCLUDED.negative_confirmations_required,
 confidence_half_evidence=EXCLUDED.confidence_half_evidence,
 positive_candidate_evidence_factor=EXCLUDED.positive_candidate_evidence_factor,
 negative_candidate_evidence_factor=EXCLUDED.negative_candidate_evidence_factor,
 freshness_half_life_days=EXCLUDED.freshness_half_life_days,
 notes=EXCLUDED.notes,
 updated_at=now();

ALTER TABLE public.performance_engine_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read performance engine policy" ON public.performance_engine_policy;
CREATE POLICY "Authenticated can read performance engine policy" ON public.performance_engine_policy
FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.capability_confidence_from_evidence(p_effective_evidence numeric,p_half_evidence numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN COALESCE(p_effective_evidence,0)<=0 THEN 0
 ELSE public.num_clamp(p_effective_evidence/(p_effective_evidence+p_half_evidence),0,0.999) END;
$$;

CREATE OR REPLACE FUNCTION public.capability_freshness_from_age(p_age_days numeric,p_half_life_days numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_age_days IS NULL THEN 0
 ELSE public.num_clamp(p_half_life_days/(p_half_life_days+GREATEST(0,p_age_days)),0,1) END;
$$;

CREATE OR REPLACE FUNCTION public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_policy_key text DEFAULT 'b2.5-draft-default',
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_state jsonb:=COALESCE(p_state,'{}'::jsonb);
  v_policy public.performance_engine_policy%ROWTYPE;
  v_mode text:=COALESCE(NULLIF(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=NULLIF(p_comparison->>'protocol_signature','');
  v_cap_key text;
  v_env_root_key text;
  v_env_root jsonb;
  v_subenv jsonb;
  v_probe jsonb;
  v_final jsonb;
  v_signal text;
  v_rpe_delta numeric;
  v_evidence_root jsonb:=COALESCE(v_state->'evidence_json','{}'::jsonb);
  v_conf_root jsonb:=COALESCE(v_state->'confidence_json','{}'::jsonb);
  v_fresh_root jsonb:=COALESCE(v_state->'freshness_json','{}'::jsonb);
  v_ev jsonb;
  v_total int;
  v_valid int;
  v_eff numeric;
  v_pos int;
  v_neg int;
  v_context text;
  v_prev_context text;
  v_confirmed boolean:=false;
  v_factor numeric:=1;
  v_conf numeric;
  v_quality numeric:=public.num_clamp(COALESCE(p_quality,0),0,1);
  v_after_subenv jsonb;
  v_decision text;
BEGIN
  SELECT * INTO v_policy FROM public.performance_engine_policy WHERE policy_key=p_policy_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown performance engine policy: %',p_policy_key; END IF;

  IF p_family IN ('density','progressive') THEN
    IF v_signature IS NULL THEN v_cap_key:=p_family||'|protocol:missing'; ELSE v_cap_key:=p_family||'|protocol:'||v_signature; END IF;
  ELSE
    v_cap_key:=p_family||'|'||v_mode;
  END IF;
  v_context:=COALESCE(v_signature,p_family||'|'||v_mode);

  v_env_root_key:=CASE p_family
    WHEN 'reps' THEN 'reps_envelope'
    WHEN 'load_reps' THEN 'load_envelope'
    WHEN 'time' THEN 'time_envelope'
    WHEN 'pace' THEN 'pace_envelope'
    WHEN 'loaded_distance' THEN 'distance_envelope'
    WHEN 'density' THEN 'density_envelope'
    WHEN 'progressive' THEN 'progressive_envelope'
  END;
  IF v_env_root_key IS NULL THEN RAISE EXCEPTION 'Unsupported family: %',p_family; END IF;

  v_env_root:=COALESCE(v_state->v_env_root_key,'{}'::jsonb);
  IF p_family IN ('density','progressive') THEN
    v_subenv:=COALESCE(v_env_root#>ARRAY['protocols',COALESCE(v_signature,'missing')],'{}'::jsonb);
  ELSE
    v_subenv:=COALESCE(v_env_root->v_mode,'{}'::jsonb);
  END IF;

  -- First pass never confirms: it classifies the current observation.
  v_probe:=public.propose_capability_update(p_family,v_subenv,p_expected,p_actual,v_quality,false,p_capability_eligible,p_pain_affected,p_comparison,p_observed_at);
  v_signal:=COALESCE(v_probe->>'signal','NONE');
  v_rpe_delta:=COALESCE(public.jsonb_num(v_probe,'rpe_delta'),0);

  v_ev:=COALESCE(v_evidence_root->v_cap_key,'{}'::jsonb);
  v_total:=COALESCE((v_ev->>'total_count')::int,0)+1;
  v_valid:=COALESCE((v_ev->>'valid_count')::int,0);
  v_eff:=COALESCE(public.jsonb_num(v_ev,'effective_evidence'),0);
  v_pos:=COALESCE((v_ev->>'pending_positive_count')::int,0);
  v_neg:=COALESCE((v_ev->>'pending_negative_count')::int,0);
  v_prev_context:=v_ev->>'pending_context';

  IF COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND v_quality>0
     AND COALESCE(v_probe->>'decision','HOLD')<>'EXCLUDE'
     AND NOT (v_probe->'reason_codes' ? 'MISSING_PROTOCOL_SIGNATURE')
     AND NOT (v_probe->'reason_codes' ? 'PROTOCOL_SIGNATURE_MISMATCH') THEN
    v_valid:=v_valid+1;

    IF v_signal IN ('POSITIVE','POSITIVE_OR_NEW_CAPACITY_POINT') THEN
      IF v_prev_context IS DISTINCT FROM v_context THEN v_pos:=1; ELSE v_pos:=v_pos+1; END IF;
      v_neg:=0;
      v_confirmed:=v_pos>=v_policy.positive_confirmations_required;
      v_factor:=CASE WHEN v_confirmed THEN 1 ELSE v_policy.positive_candidate_evidence_factor END;
    ELSIF v_signal IN ('NEGATIVE','BELOW_FRONTIER') AND v_rpe_delta>0 THEN
      IF v_prev_context IS DISTINCT FROM v_context THEN v_neg:=1; ELSE v_neg:=v_neg+1; END IF;
      v_pos:=0;
      v_confirmed:=v_neg>=v_policy.negative_confirmations_required;
      v_factor:=CASE WHEN v_confirmed THEN 1 ELSE v_policy.negative_candidate_evidence_factor END;
    ELSE
      v_pos:=0; v_neg:=0; v_confirmed:=false; v_factor:=1;
    END IF;
    v_eff:=v_eff+(v_quality*v_factor);
  END IF;

  -- Second pass applies confirmation only when enough comparable evidence has accumulated.
  IF v_confirmed THEN
    v_final:=public.propose_capability_update(p_family,v_subenv,p_expected,p_actual,v_quality,true,p_capability_eligible,p_pain_affected,p_comparison,p_observed_at);
    IF v_signal IN ('POSITIVE','POSITIVE_OR_NEW_CAPACITY_POINT') THEN v_pos:=0; ELSE v_neg:=0; END IF;
  ELSE
    v_final:=v_probe;
  END IF;
  v_after_subenv:=COALESCE(v_final->'after',v_subenv);
  v_decision:=COALESCE(v_final->>'decision','HOLD');

  IF p_family IN ('density','progressive') THEN
    v_env_root:=jsonb_set(v_env_root,ARRAY['protocols',COALESCE(v_signature,'missing')],v_after_subenv,true);
  ELSE
    v_env_root:=jsonb_set(v_env_root,ARRAY[v_mode],v_after_subenv,true);
  END IF;
  v_state:=jsonb_set(v_state,ARRAY[v_env_root_key],v_env_root,true);

  v_evidence_root:=jsonb_set(v_evidence_root,ARRAY[v_cap_key],jsonb_build_object(
    'total_count',v_total,'valid_count',v_valid,'effective_evidence',round(v_eff,4),
    'pending_positive_count',v_pos,'pending_negative_count',v_neg,'pending_context',v_context,
    'last_signal',v_signal,'last_decision',v_decision,'last_observed_at',p_observed_at
  ),true);
  v_conf:=public.capability_confidence_from_evidence(v_eff,v_policy.confidence_half_evidence);
  v_conf_root:=jsonb_set(v_conf_root,ARRAY[v_cap_key],jsonb_build_object('score',round(v_conf,4),'effective_evidence',round(v_eff,4),'policy',p_policy_key),true);
  IF COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND v_quality>0 THEN
    v_fresh_root:=jsonb_set(v_fresh_root,ARRAY[v_cap_key],jsonb_build_object('last_valid_observed_at',p_observed_at,'half_life_days',v_policy.freshness_half_life_days),true);
  END IF;

  v_state:=jsonb_set(v_state,ARRAY['evidence_json'],v_evidence_root,true);
  v_state:=jsonb_set(v_state,ARRAY['confidence_json'],v_conf_root,true);
  v_state:=jsonb_set(v_state,ARRAY['freshness_json'],v_fresh_root,true);
  v_state:=jsonb_set(v_state,ARRAY['engine_version'],to_jsonb(v_policy.engine_version),true);

  RETURN jsonb_build_object(
    'engine_version',v_policy.engine_version,
    'policy_key',p_policy_key,
    'capability_key',v_cap_key,
    'signal',v_signal,
    'confirmed_now',v_confirmed,
    'decision',v_decision,
    'quality',v_quality,
    'effective_evidence',round(v_eff,4),
    'confidence',round(v_conf,4),
    'proposal',v_final,
    'after_state',v_state
  );
END;
$$;;



-- SOURCE MIGRATION: 20260811073949_phase_b25_safe_recalibration_wrapper.sql
ALTER FUNCTION public.propose_capability_state_update(jsonb,text,jsonb,jsonb,numeric,boolean,boolean,jsonb,text,timestamptz)
  RENAME TO propose_capability_state_update_core;

CREATE OR REPLACE FUNCTION public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_policy_key text DEFAULT 'b2.5-draft-default',
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
  v_state jsonb;
  v_cap_key text;
  v_mode text:=COALESCE(NULLIF(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=NULLIF(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_candidate jsonb;
BEGIN
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  IF COALESCE(v_result->>'decision','') <> 'REGRESS_CONFIRMED' THEN
    RETURN v_result;
  END IF;

  -- A confirmed negative observation starts recalibration; it never erases
  -- established/historical capability in one step.
  v_state:=COALESCE(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=CASE p_family
    WHEN 'reps' THEN 'reps_envelope'
    WHEN 'load_reps' THEN 'load_envelope'
    WHEN 'time' THEN 'time_envelope'
    WHEN 'pace' THEN 'pace_envelope'
    WHEN 'loaded_distance' THEN 'distance_envelope'
    WHEN 'density' THEN 'density_envelope'
    WHEN 'progressive' THEN 'progressive_envelope'
  END;

  v_root:=COALESCE(p_state->v_env_key,'{}'::jsonb);
  IF p_family IN ('density','progressive') THEN
    v_sub:=COALESCE(v_root#>ARRAY['protocols',COALESCE(v_signature,'missing')],'{}'::jsonb);
  ELSE
    v_sub:=COALESCE(v_root->v_mode,'{}'::jsonb);
  END IF;

  v_candidate:=jsonb_build_object(
    'actual',COALESCE(p_actual,'{}'::jsonb),
    'expected',COALESCE(p_expected,'{}'::jsonb),
    'quality',public.num_clamp(COALESCE(p_quality,0),0,1),
    'comparison',COALESCE(p_comparison,'{}'::jsonb),
    'observed_at',p_observed_at,
    'status','CONFIRMED_NEGATIVE_RECALIBRATION'
  );
  v_sub:=jsonb_set(v_sub,ARRAY['recalibration_candidate'],v_candidate,true);

  IF p_family IN ('density','progressive') THEN
    v_root:=jsonb_set(v_root,ARRAY['protocols',COALESCE(v_signature,'missing')],v_sub,true);
  ELSE
    v_root:=jsonb_set(v_root,ARRAY[v_mode],v_sub,true);
  END IF;
  v_state:=jsonb_set(v_state,ARRAY[v_env_key],v_root,true);

  IF v_cap_key IS NOT NULL THEN
    v_state:=jsonb_set(v_state,ARRAY['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
  END IF;

  v_result:=jsonb_set(v_result,ARRAY['decision'],to_jsonb('RECALIBRATE'::text),true);
  v_result:=jsonb_set(v_result,ARRAY['after_state'],v_state,true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','after'],v_sub,true);
  v_result:=jsonb_set(v_result,ARRAY['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
  RETURN v_result;
END;
$$;;



-- SOURCE MIGRATION: 20260811074055_phase_b25_transactional_capability_apply.sql
CREATE OR REPLACE FUNCTION public.apply_capability_observation(
  p_user_id uuid,
  p_exercise_id varchar,
  p_exercise_log_id bigint,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_observation_role text,
  p_comparison jsonb DEFAULT '{}'::jsonb,
  p_policy_key text DEFAULT 'b2.5-draft-default',
  p_observed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row public.user_exercise_capabilities%ROWTYPE;
  v_state jsonb;
  v_result jsonb;
  v_after jsonb;
  v_conf numeric:=0;
  v_fresh numeric:=0;
  v_total int:=0;
  v_valid int:=0;
  v_reason text[]:='{}'::text[];
  v_decision text;
  v_event_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>p_user_id THEN
    RAISE EXCEPTION 'Cannot update another user capability';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exercises WHERE id=p_exercise_id) THEN
    RAISE EXCEPTION 'Unknown exercise %',p_exercise_id;
  END IF;

  SELECT * INTO v_row
  FROM public.user_exercise_capabilities
  WHERE user_id=p_user_id AND exercise_id=p_exercise_id
  FOR UPDATE;

  IF FOUND THEN
    v_state:=jsonb_build_object(
      'reps_envelope',v_row.reps_envelope,
      'load_envelope',v_row.load_envelope,
      'time_envelope',v_row.time_envelope,
      'distance_envelope',v_row.distance_envelope,
      'pace_envelope',v_row.pace_envelope,
      'density_envelope',v_row.density_envelope,
      'progressive_envelope',v_row.progressive_envelope,
      'confidence_json',v_row.confidence_json,
      'freshness_json',v_row.freshness_json,
      'evidence_json',v_row.evidence_json,
      'engine_version',v_row.engine_version
    );
  ELSE
    v_state:=jsonb_build_object(
      'reps_envelope','{}'::jsonb,'load_envelope','{}'::jsonb,'time_envelope','{}'::jsonb,
      'distance_envelope','{}'::jsonb,'pace_envelope','{}'::jsonb,'density_envelope','{}'::jsonb,
      'progressive_envelope','{}'::jsonb,'confidence_json','{}'::jsonb,'freshness_json','{}'::jsonb,
      'evidence_json','{}'::jsonb,'engine_version','b2.5-draft-2'
    );
  END IF;

  v_result:=public.propose_capability_state_update(
    v_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );
  v_after:=v_result->'after_state';
  v_decision:=v_result->>'decision';

  SELECT COALESCE(avg(public.jsonb_num(value,'score')),0)
  INTO v_conf FROM jsonb_each(COALESCE(v_after->'confidence_json','{}'::jsonb));

  SELECT
    COALESCE(sum(COALESCE((value->>'total_count')::int,0)),0),
    COALESCE(sum(COALESCE((value->>'valid_count')::int,0)),0)
  INTO v_total,v_valid
  FROM jsonb_each(COALESCE(v_after->'evidence_json','{}'::jsonb));

  -- Stored scalar freshness is only a compatibility snapshot at write time.
  -- Dynamic freshness must be computed from freshness_json + observation age when read.
  SELECT COALESCE(avg(
    public.capability_freshness_from_age(
      EXTRACT(EPOCH FROM (p_observed_at-(value->>'last_valid_observed_at')::timestamptz))/86400.0,
      COALESCE(public.jsonb_num(value,'half_life_days'),45)
    )
  ),0)
  INTO v_fresh
  FROM jsonb_each(COALESCE(v_after->'freshness_json','{}'::jsonb))
  WHERE value ? 'last_valid_observed_at';

  INSERT INTO public.user_exercise_capabilities(
    user_id,exercise_id,reps_envelope,load_envelope,time_envelope,distance_envelope,pace_envelope,
    density_envelope,progressive_envelope,confidence,freshness,evidence_count,valid_evidence_count,
    last_observed_at,last_valid_observed_at,updated_at,confidence_json,freshness_json,evidence_json,engine_version
  ) VALUES (
    p_user_id,p_exercise_id,
    COALESCE(v_after->'reps_envelope','{}'),COALESCE(v_after->'load_envelope','{}'),COALESCE(v_after->'time_envelope','{}'),
    COALESCE(v_after->'distance_envelope','{}'),COALESCE(v_after->'pace_envelope','{}'),COALESCE(v_after->'density_envelope','{}'),
    COALESCE(v_after->'progressive_envelope','{}'),v_conf,v_fresh,v_total,v_valid,p_observed_at,
    CASE WHEN COALESCE(p_capability_eligible,false) AND NOT COALESCE(p_pain_affected,false) AND COALESCE(p_quality,0)>0 THEN p_observed_at ELSE COALESCE(v_row.last_valid_observed_at,NULL) END,
    now(),COALESCE(v_after->'confidence_json','{}'),COALESCE(v_after->'freshness_json','{}'),COALESCE(v_after->'evidence_json','{}'),COALESCE(v_after->>'engine_version','b2.5-draft-2')
  )
  ON CONFLICT(user_id,exercise_id) DO UPDATE SET
    reps_envelope=EXCLUDED.reps_envelope,load_envelope=EXCLUDED.load_envelope,time_envelope=EXCLUDED.time_envelope,
    distance_envelope=EXCLUDED.distance_envelope,pace_envelope=EXCLUDED.pace_envelope,density_envelope=EXCLUDED.density_envelope,
    progressive_envelope=EXCLUDED.progressive_envelope,confidence=EXCLUDED.confidence,freshness=EXCLUDED.freshness,
    evidence_count=EXCLUDED.evidence_count,valid_evidence_count=EXCLUDED.valid_evidence_count,last_observed_at=EXCLUDED.last_observed_at,
    last_valid_observed_at=COALESCE(EXCLUDED.last_valid_observed_at,user_exercise_capabilities.last_valid_observed_at),
    updated_at=now(),confidence_json=EXCLUDED.confidence_json,freshness_json=EXCLUDED.freshness_json,
    evidence_json=EXCLUDED.evidence_json,engine_version=EXCLUDED.engine_version;

  IF v_result->'proposal' ? 'reason_codes' THEN
    SELECT COALESCE(array_agg(x),'{}'::text[]) INTO v_reason
    FROM jsonb_array_elements_text(v_result->'proposal'->'reason_codes') x;
  END IF;

  INSERT INTO public.capability_update_events(
    user_id,exercise_id,exercise_log_id,capability_family,engine_version,decision,reason_codes,
    observation_role,quality_json,comparison_json,before_json,proposal_json,after_json,applied,created_at,applied_at
  ) VALUES (
    p_user_id,p_exercise_id,p_exercise_log_id,p_family,COALESCE(v_result->>'engine_version','b2.5-draft-2'),
    v_decision,v_reason,p_observation_role,jsonb_build_object('score',p_quality),COALESCE(p_comparison,'{}'),
    v_state,COALESCE(v_result->'proposal','{}'),v_after,true,now(),now()
  ) RETURNING id INTO v_event_id;

  RETURN v_result||jsonb_build_object('applied',true,'event_id',v_event_id);
END;
$$;

CREATE OR REPLACE VIEW public.user_exercise_capability_runtime
WITH (security_invoker=true)
AS
SELECT
  c.*,
  COALESCE((
    SELECT avg(public.jsonb_num(v,'score'))
    FROM jsonb_each(c.confidence_json) e(k,v)
  ),0) AS runtime_confidence,
  COALESCE((
    SELECT avg(public.capability_freshness_from_age(
      EXTRACT(EPOCH FROM (now()-(v->>'last_valid_observed_at')::timestamptz))/86400.0,
      COALESCE(public.jsonb_num(v,'half_life_days'),45)
    ))
    FROM jsonb_each(c.freshness_json) e(k,v)
    WHERE v ? 'last_valid_observed_at'
  ),0) AS runtime_freshness
FROM public.user_exercise_capabilities c;;



-- SOURCE MIGRATION: 20260811081455_phase_b26_observation_instance_contract.sql
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
  ON e.id = el.exercise_id;;



-- SOURCE MIGRATION: 20260811082255_phase_b26_capability_observation_adapter.sql
create table if not exists public.performance_observation_quality_policy (
  policy_key text not null,
  context_key text not null,
  fresh_quality numeric(4,3) not null,
  repeatable_quality numeric(4,3) not null,
  notes text,
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (policy_key, context_key),
  check (fresh_quality between 0 and 1),
  check (repeatable_quality between 0 and 1)
);

insert into public.performance_observation_quality_policy(
  policy_key,context_key,fresh_quality,repeatable_quality,notes,active
) values
  ('b2.6-adapter-draft-1','benchmark',0.950,0.800,'Calibration produit: benchmark standardisé. Paramètres de simulation, non constantes physiologiques.',false),
  ('b2.6-adapter-draft-1','skill',0.900,0.600,'Calibration produit: série fraîche / skill.',false),
  ('b2.6-adapter-draft-1','strength',0.850,0.800,'Calibration produit: bloc force.',false),
  ('b2.6-adapter-draft-1','wod',0.550,0.900,'Calibration produit: effort contextuel / répétable en WOD.',false),
  ('b2.6-adapter-draft-1','tabata',0.300,0.900,'Calibration produit: Tabata Core 20/10, faible preuve fraîche, forte preuve répétable.',false),
  ('b2.6-adapter-draft-1','warm_up',0.250,0.250,'Calibration produit: échauffement = preuve faible.',false),
  ('b2.6-adapter-draft-1','external',0.600,0.600,'Calibration produit: import externe validé.',false),
  ('b2.6-adapter-draft-1','manual',0.550,0.550,'Calibration produit: saisie manuelle.',false),
  ('b2.6-adapter-draft-1','unknown',0.350,0.350,'Fallback conservateur.',false)
on conflict (policy_key,context_key) do update set
  fresh_quality=excluded.fresh_quality,
  repeatable_quality=excluded.repeatable_quality,
  notes=excluded.notes,
  updated_at=now();

alter table public.performance_observation_quality_policy enable row level security;
drop policy if exists "Authenticated can read observation quality policy" on public.performance_observation_quality_policy;
create policy "Authenticated can read observation quality policy"
  on public.performance_observation_quality_policy
  for select to authenticated
  using (true);

grant select on public.performance_observation_quality_policy to authenticated;

create or replace function public.capability_family_from_tracking(
  p_tracking_modes text[],
  p_prescription_type text default null
) returns text
language plpgsql immutable
as $$
begin
  if coalesce(p_tracking_modes,'{}'::text[]) @> array['reps','load']::text[] then
    return 'load_reps';
  end if;

  if coalesce(p_prescription_type,'') like 'reps%'
     or 'reps'=any(coalesce(p_tracking_modes,'{}'::text[])) then
    return 'reps';
  end if;

  if coalesce(p_tracking_modes,'{}'::text[]) @> array['distance','time','load']::text[] then
    return 'loaded_distance';
  end if;

  if coalesce(p_tracking_modes,'{}'::text[]) @> array['distance','time']::text[] then
    return 'pace';
  end if;

  if 'time'=any(coalesce(p_tracking_modes,'{}'::text[])) then
    return 'time';
  end if;

  return null;
end;
$$;

create or replace function public.performance_context_key(
  p_source_kind text,
  p_block_key text
) returns text
language sql immutable
as $$
  select case
    when p_source_kind='external_import' then 'external'
    when p_source_kind='manual' then 'manual'
    when lower(coalesce(p_block_key,'')) in ('benchmark','test') then 'benchmark'
    when lower(coalesce(p_block_key,'')) in ('skill') then 'skill'
    when lower(coalesce(p_block_key,'')) in ('strength','force') then 'strength'
    when lower(coalesce(p_block_key,'')) in ('tabata','core') then 'tabata'
    when lower(coalesce(p_block_key,'')) in ('warm_up','warmup') then 'warm_up'
    when lower(coalesce(p_block_key,''))='wod' then 'wod'
    else 'unknown'
  end;
$$;

create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql stable
security invoker
as $$
declare
  v_obs record;
  v_tracking text[];
  v_prescription_type text;
  v_movement_side text;
  v_family text;
  v_context_key text;
  v_mechanic text;
  v_side_semantics text;
  v_protocol_signature text;
  v_fresh_quality numeric;
  v_repeatable_quality numeric;
  v_updates jsonb := '[]'::jsonb;
  v_base_comparison jsonb;
  v_observation_context jsonb;
  v_quality_json jsonb;
  v_is_candidate boolean;
begin
  select
    poc.*,
    e.tracking_modes,
    e.prescription_type,
    e.movement_side,
    coalesce(
      nullif(ws.mechanic_json->>'kind',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      nullif(ws.generated_workout->'meta'->>'format',''),
      'unknown'
    ) as mechanic
  into v_obs
  from public.performance_observation_contract poc
  join public.exercises e on e.id::text=poc.exercise_id
  left join public.workout_sessions ws on ws.id=poc.session_id
  where poc.exercise_log_id=p_exercise_log_id;

  if not found then
    raise exception 'Unknown exercise_log_id %', p_exercise_log_id;
  end if;

  v_tracking := coalesce(v_obs.tracking_modes,'{}'::text[]);
  v_prescription_type := v_obs.prescription_type;
  v_movement_side := v_obs.movement_side;
  v_family := public.capability_family_from_tracking(v_tracking,v_prescription_type);
  v_context_key := public.performance_context_key(v_obs.source_kind,v_obs.block_key);
  v_mechanic := coalesce(v_obs.mechanic,'unknown');

  v_side_semantics := case
    when v_prescription_type='reps_unilateral' then 'per_side'
    when v_prescription_type like 'reps%' then 'total'
    when v_prescription_type='distance' and v_movement_side='Unilateral' then 'per_side'
    when v_prescription_type='isometric' and v_movement_side='Unilateral' then 'per_side'
    else null
  end;

  select fresh_quality,repeatable_quality
  into v_fresh_quality,v_repeatable_quality
  from public.performance_observation_quality_policy
  where policy_key=p_quality_policy_key and context_key=v_context_key;

  if not found then
    raise exception 'No quality policy % for context %',p_quality_policy_key,v_context_key;
  end if;

  v_protocol_signature := concat_ws('|',
    'context='||v_context_key,
    'mechanic='||lower(v_mechanic),
    'prescription='||coalesce(v_prescription_type,'unknown'),
    'side='||coalesce(v_side_semantics,'na')
  );

  v_observation_context := jsonb_strip_nulls(jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-1',
    'quality_policy_key',p_quality_policy_key,
    'source_kind',v_obs.source_kind,
    'block_key',v_obs.block_key,
    'position',v_obs.position,
    'context_key',v_context_key,
    'mechanic',v_mechanic,
    'tracking_modes',v_tracking,
    'prescription_type',v_prescription_type,
    'movement_side',v_movement_side,
    'side_semantics',v_side_semantics,
    'session_exercise_id',v_obs.session_exercise_id
  ));

  v_quality_json := jsonb_build_object(
    'policy_key',p_quality_policy_key,
    'context_key',v_context_key,
    'fresh',v_fresh_quality,
    'repeatable',v_repeatable_quality
  );

  v_base_comparison := jsonb_strip_nulls(jsonb_build_object(
    'protocol_signature',v_protocol_signature,
    'context_key',v_context_key,
    'mechanic',v_mechanic,
    'prescription_type',v_prescription_type,
    'side_semantics',v_side_semantics
  ));

  v_is_candidate := (
    v_obs.observation_role='CAPABILITY_CANDIDATE'
    and coalesce(v_obs.capability_eligible,false)
    and not coalesce(v_obs.pain_affected,false)
    and v_family is not null
  );

  if v_is_candidate then
    v_updates := jsonb_build_array(
      jsonb_build_object(
        'family',v_family,
        'capability_mode','fresh',
        'quality',v_fresh_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','fresh')
      ),
      jsonb_build_object(
        'family',v_family,
        'capability_mode','repeatable',
        'quality',v_repeatable_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','repeatable')
      )
    );
  end if;

  return jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-1',
    'exercise_log_id',v_obs.exercise_log_id,
    'session_exercise_id',v_obs.session_exercise_id,
    'user_id',v_obs.user_id,
    'exercise_id',v_obs.exercise_id,
    'exercise_name',v_obs.exercise_name,
    'family',v_family,
    'observation_role',v_obs.observation_role,
    'capability_eligible',v_obs.capability_eligible,
    'pain_affected',v_obs.pain_affected,
    'expected',v_obs.expected_json,
    'actual',v_obs.actual_json,
    'observation_context',v_observation_context,
    'observation_quality',v_quality_json,
    'comparison_context',v_base_comparison,
    'updates',v_updates,
    'excluded',not v_is_candidate,
    'exclusion_reason',case
      when v_obs.pain_affected then 'PAIN_STATE_ONLY'
      when not coalesce(v_obs.capability_eligible,false) then 'NOT_CAPABILITY_ELIGIBLE'
      when v_obs.observation_role<>'CAPABILITY_CANDIDATE' then v_obs.observation_role
      when v_family is null then 'UNSUPPORTED_TRACKING_FAMILY'
      else null
    end
  );
end;
$$;

grant execute on function public.build_capability_observation_inputs(bigint,text) to authenticated;
grant execute on function public.capability_family_from_tracking(text[],text) to authenticated;
grant execute on function public.performance_context_key(text,text) to authenticated;

comment on table public.performance_observation_quality_policy is
'B2.6 simulation/tuning quality policy. Numeric values are configurable product calibration parameters, not validated physiological constants.';
comment on function public.build_capability_observation_inputs(bigint,text) is
'Pure adapter for B2.6 shadow integration: maps one exercise log into zero or more capability-update inputs without mutating capability state.';;



-- SOURCE MIGRATION: 20260811082357_phase_b26_adapter_context_signature_fix.sql
create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql stable
security invoker
as $$
declare
  v_obs record;
  v_tracking text[];
  v_prescription_type text;
  v_movement_side text;
  v_family text;
  v_context_key text;
  v_session_mechanic text;
  v_mechanic_context text;
  v_side_semantics text;
  v_protocol_signature text;
  v_fresh_quality numeric;
  v_repeatable_quality numeric;
  v_updates jsonb := '[]'::jsonb;
  v_base_comparison jsonb;
  v_observation_context jsonb;
  v_quality_json jsonb;
  v_is_candidate boolean;
begin
  select
    poc.*,
    e.tracking_modes,
    e.prescription_type,
    e.movement_side,
    coalesce(
      nullif(ws.mechanic_json->>'kind',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      nullif(ws.generated_workout->'meta'->>'format',''),
      'unknown'
    ) as session_mechanic
  into v_obs
  from public.performance_observation_contract poc
  join public.exercises e on e.id::text=poc.exercise_id
  left join public.workout_sessions ws on ws.id=poc.session_id
  where poc.exercise_log_id=p_exercise_log_id;

  if not found then
    raise exception 'Unknown exercise_log_id %', p_exercise_log_id;
  end if;

  v_tracking := coalesce(v_obs.tracking_modes,'{}'::text[]);
  v_prescription_type := v_obs.prescription_type;
  v_movement_side := v_obs.movement_side;
  v_family := public.capability_family_from_tracking(v_tracking,v_prescription_type);
  v_context_key := public.performance_context_key(v_obs.source_kind,v_obs.block_key);
  v_session_mechanic := coalesce(v_obs.session_mechanic,'unknown');

  v_mechanic_context := case v_context_key
    when 'wod' then lower(v_session_mechanic)
    when 'tabata' then 'tabata_20_10'
    when 'skill' then 'skill'
    when 'strength' then 'strength'
    when 'warm_up' then 'warm_up'
    when 'benchmark' then 'benchmark'
    when 'external' then 'external'
    when 'manual' then 'manual'
    else 'unknown'
  end;

  v_side_semantics := case
    when v_prescription_type='reps_unilateral' then 'per_side'
    when 'reps'=any(v_tracking) then 'total'
    when v_prescription_type='distance' and v_movement_side='Unilateral' then 'per_side'
    when v_prescription_type='isometric' and v_movement_side='Unilateral' then 'per_side'
    else null
  end;

  select fresh_quality,repeatable_quality
  into v_fresh_quality,v_repeatable_quality
  from public.performance_observation_quality_policy
  where policy_key=p_quality_policy_key and context_key=v_context_key;

  if not found then
    raise exception 'No quality policy % for context %',p_quality_policy_key,v_context_key;
  end if;

  v_protocol_signature := concat_ws('|',
    'context='||v_context_key,
    'mechanic='||v_mechanic_context,
    'prescription='||coalesce(v_prescription_type,'unknown'),
    'side='||coalesce(v_side_semantics,'na')
  );

  v_observation_context := jsonb_strip_nulls(jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-2',
    'quality_policy_key',p_quality_policy_key,
    'source_kind',v_obs.source_kind,
    'block_key',v_obs.block_key,
    'position',v_obs.position,
    'context_key',v_context_key,
    'session_mechanic',v_session_mechanic,
    'comparison_mechanic',v_mechanic_context,
    'tracking_modes',v_tracking,
    'prescription_type',v_prescription_type,
    'movement_side',v_movement_side,
    'side_semantics',v_side_semantics,
    'session_exercise_id',v_obs.session_exercise_id
  ));

  v_quality_json := jsonb_build_object(
    'policy_key',p_quality_policy_key,
    'context_key',v_context_key,
    'fresh',v_fresh_quality,
    'repeatable',v_repeatable_quality
  );

  v_base_comparison := jsonb_strip_nulls(jsonb_build_object(
    'protocol_signature',v_protocol_signature,
    'context_key',v_context_key,
    'mechanic',v_mechanic_context,
    'prescription_type',v_prescription_type,
    'side_semantics',v_side_semantics
  ));

  v_is_candidate := (
    v_obs.observation_role='CAPABILITY_CANDIDATE'
    and coalesce(v_obs.capability_eligible,false)
    and not coalesce(v_obs.pain_affected,false)
    and v_family is not null
  );

  if v_is_candidate then
    v_updates := jsonb_build_array(
      jsonb_build_object(
        'family',v_family,
        'capability_mode','fresh',
        'quality',v_fresh_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','fresh')
      ),
      jsonb_build_object(
        'family',v_family,
        'capability_mode','repeatable',
        'quality',v_repeatable_quality,
        'comparison',v_base_comparison || jsonb_build_object('capability_mode','repeatable')
      )
    );
  end if;

  return jsonb_build_object(
    'adapter_version','b2.6-adapter-draft-2',
    'exercise_log_id',v_obs.exercise_log_id,
    'session_exercise_id',v_obs.session_exercise_id,
    'user_id',v_obs.user_id,
    'exercise_id',v_obs.exercise_id,
    'exercise_name',v_obs.exercise_name,
    'family',v_family,
    'observation_role',v_obs.observation_role,
    'capability_eligible',v_obs.capability_eligible,
    'pain_affected',v_obs.pain_affected,
    'expected',v_obs.expected_json,
    'actual',v_obs.actual_json,
    'observation_context',v_observation_context,
    'observation_quality',v_quality_json,
    'comparison_context',v_base_comparison,
    'updates',v_updates,
    'excluded',not v_is_candidate,
    'exclusion_reason',case
      when v_obs.pain_affected then 'PAIN_STATE_ONLY'
      when not coalesce(v_obs.capability_eligible,false) then 'NOT_CAPABILITY_ELIGIBLE'
      when v_obs.observation_role<>'CAPABILITY_CANDIDATE' then v_obs.observation_role
      when v_family is null then 'UNSUPPORTED_TRACKING_FAMILY'
      else null
    end
  );
end;
$$;

comment on function public.build_capability_observation_inputs(bigint,text) is
'B2.6 draft-2 pure shadow adapter. Session WOD mechanic only affects WOD observations; warm-up/skill/tabata use their own protocol class. Reps tracking defaults to total unless explicitly unilateral.';;



-- SOURCE MIGRATION: 20260811082917_phase_b263_shadow_mode.sql
drop index if exists public.uq_capability_update_events_log_family_applied;
create unique index if not exists uq_capability_update_events_log_family_mode_applied
on public.capability_update_events(
  exercise_log_id,
  capability_family,
  (coalesce(comparison_json->>'capability_mode','repeatable'))
)
where exercise_log_id is not null and applied;

create or replace function public.empty_capability_state()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'reps_envelope','{}'::jsonb,
    'load_envelope','{}'::jsonb,
    'time_envelope','{}'::jsonb,
    'distance_envelope','{}'::jsonb,
    'pace_envelope','{}'::jsonb,
    'density_envelope','{}'::jsonb,
    'progressive_envelope','{}'::jsonb,
    'confidence_json','{}'::jsonb,
    'freshness_json','{}'::jsonb,
    'evidence_json','{}'::jsonb,
    'engine_version','b2.5-draft-2'
  );
$$;

create or replace function public.capability_state_snapshot(
  p_user_id uuid,
  p_exercise_id varchar
) returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_row public.user_exercise_capabilities%rowtype;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot read another user capability state';
  end if;

  select * into v_row
  from public.user_exercise_capabilities
  where user_id=p_user_id and exercise_id=p_exercise_id;

  if not found then
    return public.empty_capability_state();
  end if;

  return jsonb_build_object(
    'reps_envelope',v_row.reps_envelope,
    'load_envelope',v_row.load_envelope,
    'time_envelope',v_row.time_envelope,
    'distance_envelope',v_row.distance_envelope,
    'pace_envelope',v_row.pace_envelope,
    'density_envelope',v_row.density_envelope,
    'progressive_envelope',v_row.progressive_envelope,
    'confidence_json',v_row.confidence_json,
    'freshness_json',v_row.freshness_json,
    'evidence_json',v_row.evidence_json,
    'engine_version',v_row.engine_version
  );
end;
$$;

create or replace function public.shadow_capability_observation_from_state(
  p_exercise_log_id bigint,
  p_state jsonb,
  p_engine_policy_key text default 'b2.5-draft-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_adapter jsonb;
  v_state jsonb:=coalesce(p_state,public.empty_capability_state());
  v_initial jsonb:=coalesce(p_state,public.empty_capability_state());
  v_update jsonb;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_observed_at timestamptz;
  v_user_id uuid;
  v_exercise_id varchar;
  v_count int:=0;
begin
  select user_id,exercise_id,created_at
  into v_user_id,v_exercise_id,v_observed_at
  from public.exercise_logs
  where id=p_exercise_log_id;

  if not found then
    raise exception 'Unknown exercise_log_id %',p_exercise_log_id;
  end if;

  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot shadow another user observation';
  end if;

  v_adapter:=public.build_capability_observation_inputs(
    p_exercise_log_id,
    p_quality_policy_key
  );

  for v_update in
    select value
    from jsonb_array_elements(coalesce(v_adapter->'updates','[]'::jsonb))
  loop
    v_result:=public.propose_capability_state_update(
      v_state,
      v_update->>'family',
      coalesce(v_adapter->'expected','{}'::jsonb),
      coalesce(v_adapter->'actual','{}'::jsonb),
      coalesce((v_update->>'quality')::numeric,0),
      coalesce((v_adapter->>'capability_eligible')::boolean,false),
      coalesce((v_adapter->>'pain_affected')::boolean,false),
      coalesce(v_update->'comparison','{}'::jsonb),
      p_engine_policy_key,
      coalesce(v_observed_at,now())
    );

    v_state:=coalesce(v_result->'after_state',v_state);
    v_count:=v_count+1;
    v_results:=v_results||jsonb_build_array(
      jsonb_build_object(
        'capability_mode',v_update->>'capability_mode',
        'family',v_update->>'family',
        'quality',v_update->'quality',
        'decision',v_result->>'decision',
        'signal',v_result->>'signal',
        'confirmed_now',coalesce((v_result->>'confirmed_now')::boolean,false),
        'effective_evidence',v_result->'effective_evidence',
        'confidence',v_result->'confidence',
        'reason_codes',coalesce(v_result->'proposal'->'reason_codes','[]'::jsonb),
        'comparison',v_update->'comparison',
        'result',v_result
      )
    );
  end loop;

  return jsonb_build_object(
    'shadow_version','b2.6.3-shadow-1',
    'mutated',false,
    'exercise_log_id',p_exercise_log_id,
    'user_id',v_user_id,
    'exercise_id',v_exercise_id,
    'adapter',v_adapter,
    'proposal_count',v_count,
    'initial_state',v_initial,
    'proposals',v_results,
    'final_shadow_state',v_state
  );
end;
$$;

create or replace function public.shadow_capability_observation(
  p_exercise_log_id bigint,
  p_engine_policy_key text default 'b2.5-draft-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_user_id uuid;
  v_exercise_id varchar;
  v_state jsonb;
begin
  select user_id,exercise_id
  into v_user_id,v_exercise_id
  from public.exercise_logs
  where id=p_exercise_log_id;

  if not found then
    raise exception 'Unknown exercise_log_id %',p_exercise_log_id;
  end if;

  v_state:=public.capability_state_snapshot(v_user_id,v_exercise_id);

  return public.shadow_capability_observation_from_state(
    p_exercise_log_id,
    v_state,
    p_engine_policy_key,
    p_quality_policy_key
  );
end;
$$;

create or replace function public.shadow_capability_session(
  p_session_id uuid,
  p_engine_policy_key text default 'b2.5-draft-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_session_user uuid;
  v_log record;
  v_states jsonb:='{}'::jsonb;
  v_state jsonb;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_count int:=0;
begin
  select user_id into v_session_user
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    raise exception 'Unknown session_id %',p_session_id;
  end if;

  if auth.uid() is not null and auth.uid()<>v_session_user then
    raise exception 'Cannot shadow another user session';
  end if;

  for v_log in
    select id,exercise_id,user_id,created_at
    from public.exercise_logs
    where session_id=p_session_id
    order by created_at,id
  loop
    if v_states ? v_log.exercise_id then
      v_state:=v_states->v_log.exercise_id;
    else
      v_state:=public.capability_state_snapshot(v_log.user_id,v_log.exercise_id::varchar);
    end if;

    v_result:=public.shadow_capability_observation_from_state(
      v_log.id,
      v_state,
      p_engine_policy_key,
      p_quality_policy_key
    );

    v_states:=jsonb_set(
      v_states,
      array[v_log.exercise_id],
      coalesce(v_result->'final_shadow_state',v_state),
      true
    );

    v_results:=v_results||jsonb_build_array(v_result);
    v_count:=v_count+1;
  end loop;

  return jsonb_build_object(
    'shadow_version','b2.6.3-shadow-1',
    'mutated',false,
    'session_id',p_session_id,
    'user_id',v_session_user,
    'observation_count',v_count,
    'results',v_results,
    'final_shadow_states',v_states
  );
end;
$$;

grant execute on function public.empty_capability_state() to authenticated;
grant execute on function public.capability_state_snapshot(uuid,varchar) to authenticated;
grant execute on function public.shadow_capability_observation_from_state(bigint,jsonb,text,text) to authenticated;
grant execute on function public.shadow_capability_observation(bigint,text,text) to authenticated;
grant execute on function public.shadow_capability_session(uuid,text,text) to authenticated;

comment on function public.shadow_capability_observation_from_state(bigint,jsonb,text,text) is
'B2.6.3 pure shadow execution. Applies B2.5 proposals only to an in-memory JSON state; never writes user_exercise_capabilities or capability_update_events.';
comment on function public.shadow_capability_session(uuid,text,text) is
'B2.6.3 session-level shadow runner. Replays exercise logs chronologically into in-memory capability states and returns decisions without persistence.';;



-- SOURCE MIGRATION: 20260811083150_phase_b263_shadow_runtime.sql
create table if not exists public.user_exercise_capabilities_shadow (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  engine_policy_key text not null default 'b2.5-draft-default',
  quality_policy_key text not null default 'b2.6-adapter-draft-1',
  last_observed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,exercise_id),
  check (jsonb_typeof(state_json)='object')
);

create table if not exists public.capability_shadow_events (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  exercise_log_id bigint not null references public.exercise_logs(id) on delete cascade,
  session_exercise_id uuid references public.workout_session_exercises(id) on delete set null,
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  capability_family text not null,
  capability_mode text not null,
  decision text not null,
  signal text not null,
  confirmed_now boolean not null default false,
  quality numeric(6,4) not null,
  effective_evidence numeric(10,4),
  confidence numeric(10,4),
  reason_codes text[] not null default '{}'::text[],
  comparison_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (capability_mode in ('fresh','repeatable')),
  check (quality between 0 and 1),
  unique(exercise_log_id,capability_family,capability_mode)
);

create table if not exists public.capability_shadow_run_errors (
  id bigint generated by default as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  error_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_capability_shadow_events_user_exercise_time
  on public.capability_shadow_events(user_id,exercise_id,created_at desc);
create index if not exists idx_capability_shadow_events_session
  on public.capability_shadow_events(session_id);
create index if not exists idx_capability_shadow_errors_session
  on public.capability_shadow_run_errors(session_id,created_at desc);

alter table public.user_exercise_capabilities_shadow enable row level security;
alter table public.capability_shadow_events enable row level security;
alter table public.capability_shadow_run_errors enable row level security;

drop policy if exists "Users can read own capability shadow state" on public.user_exercise_capabilities_shadow;
create policy "Users can read own capability shadow state"
  on public.user_exercise_capabilities_shadow
  for select to authenticated
  using (auth.uid()=user_id);

drop policy if exists "Users can read own capability shadow events" on public.capability_shadow_events;
create policy "Users can read own capability shadow events"
  on public.capability_shadow_events
  for select to authenticated
  using (auth.uid()=user_id);

drop policy if exists "Users can read own capability shadow errors" on public.capability_shadow_run_errors;
create policy "Users can read own capability shadow errors"
  on public.capability_shadow_run_errors
  for select to authenticated
  using (auth.uid()=user_id);

grant select on public.user_exercise_capabilities_shadow to authenticated;
grant select on public.capability_shadow_events to authenticated;
grant select on public.capability_shadow_run_errors to authenticated;

create or replace function public.resolve_exercise_log_instance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session_user uuid;
  v_match_count int;
  v_match_id uuid;
begin
  if new.session_id is null then
    return new;
  end if;

  select user_id into v_session_user
  from public.workout_sessions
  where id=new.session_id;

  if not found then
    raise exception 'Unknown workout session %',new.session_id;
  end if;

  if new.user_id<>v_session_user then
    raise exception 'exercise_logs user_id does not own session %',new.session_id;
  end if;

  if new.session_exercise_id is not null then
    if not exists(
      select 1 from public.workout_session_exercises wse
      where wse.id=new.session_exercise_id
        and wse.session_id=new.session_id
        and wse.exercise_id=new.exercise_id
    ) then
      raise exception 'session_exercise_id % does not match session/exercise',new.session_exercise_id;
    end if;
    return new;
  end if;

  select count(*),min(id)
  into v_match_count,v_match_id
  from public.workout_session_exercises
  where session_id=new.session_id
    and exercise_id=new.exercise_id;

  if v_match_count=1 then
    new.session_exercise_id:=v_match_id;
  elsif v_match_count=0 then
    if coalesce(new.source_kind,'internal')='internal' then
      raise exception 'No workout_session_exercise instance for session %, exercise %',new.session_id,new.exercise_id;
    end if;
  else
    raise exception 'Ambiguous exercise instance for session %, exercise %. Pass session_exercise_id explicitly.',new.session_id,new.exercise_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolve_exercise_log_instance on public.exercise_logs;
create trigger trg_resolve_exercise_log_instance
before insert or update of session_id,exercise_id,session_exercise_id
on public.exercise_logs
for each row
execute function public.resolve_exercise_log_instance();

create or replace function public.run_capability_shadow_session(
  p_session_id uuid,
  p_engine_policy_key text default 'b2.5-draft-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
) returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_log record;
  v_state jsonb;
  v_adapter jsonb;
  v_update jsonb;
  v_result jsonb;
  v_processed int:=0;
  v_skipped_existing int:=0;
  v_mode text;
  v_family text;
  v_reason text[];
begin
  select user_id into v_user_id
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    raise exception 'Unknown session %',p_session_id;
  end if;

  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot run shadow for another user session';
  end if;

  for v_log in
    select id,user_id,exercise_id,session_exercise_id,created_at
    from public.exercise_logs
    where session_id=p_session_id
    order by created_at,id
  loop
    select state_json into v_state
    from public.user_exercise_capabilities_shadow
    where user_id=v_log.user_id and exercise_id=v_log.exercise_id
    for update;

    if not found then
      v_state:=public.capability_state_snapshot(v_log.user_id,v_log.exercise_id::varchar);
    end if;

    v_adapter:=public.build_capability_observation_inputs(v_log.id,p_quality_policy_key);

    for v_update in
      select value from jsonb_array_elements(coalesce(v_adapter->'updates','[]'::jsonb))
    loop
      v_family:=v_update->>'family';
      v_mode:=v_update->>'capability_mode';

      if exists(
        select 1 from public.capability_shadow_events
        where exercise_log_id=v_log.id
          and capability_family=v_family
          and capability_mode=v_mode
      ) then
        v_skipped_existing:=v_skipped_existing+1;
        continue;
      end if;

      v_result:=public.propose_capability_state_update(
        v_state,
        v_family,
        coalesce(v_adapter->'expected','{}'::jsonb),
        coalesce(v_adapter->'actual','{}'::jsonb),
        coalesce((v_update->>'quality')::numeric,0),
        coalesce((v_adapter->>'capability_eligible')::boolean,false),
        coalesce((v_adapter->>'pain_affected')::boolean,false),
        coalesce(v_update->'comparison','{}'::jsonb),
        p_engine_policy_key,
        coalesce(v_log.created_at,now())
      );

      v_state:=coalesce(v_result->'after_state',v_state);

      select coalesce(array_agg(x),'{}'::text[])
      into v_reason
      from jsonb_array_elements_text(coalesce(v_result->'proposal'->'reason_codes','[]'::jsonb)) x;

      insert into public.capability_shadow_events(
        user_id,session_id,exercise_log_id,session_exercise_id,exercise_id,
        capability_family,capability_mode,decision,signal,confirmed_now,
        quality,effective_evidence,confidence,reason_codes,comparison_json,result_json
      ) values (
        v_log.user_id,p_session_id,v_log.id,v_log.session_exercise_id,v_log.exercise_id,
        v_family,v_mode,coalesce(v_result->>'decision','HOLD'),coalesce(v_result->>'signal','NONE'),
        coalesce((v_result->>'confirmed_now')::boolean,false),coalesce((v_update->>'quality')::numeric,0),
        nullif(v_result->>'effective_evidence','')::numeric,
        nullif(v_result->>'confidence','')::numeric,
        v_reason,coalesce(v_update->'comparison','{}'::jsonb),v_result
      );

      v_processed:=v_processed+1;
    end loop;

    insert into public.user_exercise_capabilities_shadow(
      user_id,exercise_id,state_json,engine_policy_key,quality_policy_key,last_observed_at,updated_at
    ) values (
      v_log.user_id,v_log.exercise_id,v_state,p_engine_policy_key,p_quality_policy_key,v_log.created_at,now()
    )
    on conflict(user_id,exercise_id) do update set
      state_json=excluded.state_json,
      engine_policy_key=excluded.engine_policy_key,
      quality_policy_key=excluded.quality_policy_key,
      last_observed_at=greatest(public.user_exercise_capabilities_shadow.last_observed_at,excluded.last_observed_at),
      updated_at=now();
  end loop;

  return jsonb_build_object(
    'shadow_version','b2.6.3-runtime-1',
    'session_id',p_session_id,
    'user_id',v_user_id,
    'processed_proposals',v_processed,
    'skipped_existing_proposals',v_skipped_existing,
    'real_capability_mutated',false
  );
end;
$$;

revoke all on function public.run_capability_shadow_session(uuid,text,text) from public;
grant execute on function public.run_capability_shadow_session(uuid,text,text) to authenticated;

create or replace function public.capability_shadow_on_session_complete()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    begin
      perform public.run_capability_shadow_session(new.id);
    exception when others then
      insert into public.capability_shadow_run_errors(user_id,session_id,error_text)
      values(new.user_id,new.id,sqlerrm);
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_capability_shadow_on_session_complete on public.workout_sessions;
create trigger trg_capability_shadow_on_session_complete
after update of status on public.workout_sessions
for each row
execute function public.capability_shadow_on_session_complete();

comment on table public.user_exercise_capabilities_shadow is
'B2.6.3 isolated shadow state. Never consumed by the production session engine and never writes user_exercise_capabilities.';
comment on table public.capability_shadow_events is
'B2.6.3 shadow decisions generated from completed sessions for comparison/stress testing only.';
comment on function public.run_capability_shadow_session(uuid,text,text) is
'Runs B2.5 capability proposals against isolated shadow state. Does not mutate real user capabilities.';;



-- SOURCE MIGRATION: 20260811095538_onboarding_athletic_starting_profile.sql
alter table public.profiles
  add column if not exists athletic_starting_profile jsonb not null
  default '{"version":1,"source":"onboarding_self_assessment","unsure":true,"strengths":[],"weaknesses":[],"scores":{"strength":3,"cardio_endurance":3,"bodyweight":3,"explosiveness":3,"mobility":3}}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_athletic_starting_profile_object;

alter table public.profiles
  add constraint profiles_athletic_starting_profile_object
  check (jsonb_typeof(athletic_starting_profile) = 'object');

comment on column public.profiles.athletic_starting_profile is
  'Cold-start self-assessment only. Neutral=3/5, declared strengths=4/5, declared weaknesses=2/5. Real performance observations must supersede this prior.';;



-- SOURCE MIGRATION: 20260811110135_coach_warmup_contract_catalogue_and_pain_hard_gate.sql
alter table public.exercises
  add column if not exists warmup_eligible boolean not null default false,
  add column if not exists warmup_role text,
  add column if not exists warmup_intensity smallint,
  add column if not exists warmup_only boolean not null default false;

alter table public.exercises
  drop constraint if exists exercises_warmup_role_check,
  add constraint exercises_warmup_role_check
    check (warmup_role is null or warmup_role in ('mobility','activation','movement_prep','pulse_raiser')),
  drop constraint if exists exercises_warmup_intensity_check,
  add constraint exercises_warmup_intensity_check
    check (warmup_intensity is null or warmup_intensity between 1 and 3),
  drop constraint if exists exercises_warmup_contract_check,
  add constraint exercises_warmup_contract_check
    check (
      not warmup_eligible
      or (
        warmup_role is not null
        and warmup_intensity is not null
        and coalesce(fatigue_score,99) <= 2
        and coalesce(joint_impact,99) <= 2
        and coalesce(prescription_type,'') <> 'reps_heavy'
        and coalesce(training_focus,'') in ('Mobility','Stability','Conditioning')
      )
    );

update public.exercises
set warmup_eligible = false,
    warmup_role = null,
    warmup_intensity = null,
    warmup_only = false,
    usable_for = array_remove(coalesce(usable_for,'{}'::text[]), 'Warm-up')
where 'Warm-up' = any(coalesce(usable_for,'{}'::text[]));

update public.exercises
set warmup_eligible = true,
    warmup_role = case
      when id in ('EX158','EX159','EX160','EX161','EX162','EX163','EX164','EX166','EX323','EX324') then 'mobility'
      when id in ('EX081','EX101','EX135','EX141','EX322','EX404','EX406','EX407','EX413') then 'activation'
      else 'movement_prep'
    end,
    warmup_intensity = case when id in ('EX322','EX404') then 2 else 1 end,
    usable_for = case
      when not ('Warm-up' = any(coalesce(usable_for,'{}'::text[])))
        then array_append(coalesce(usable_for,'{}'::text[]),'Warm-up')
      else usable_for
    end
where id in (
  'EX081','EX101','EX135','EX141',
  'EX158','EX159','EX160','EX161','EX162','EX163','EX164','EX166',
  'EX322','EX323','EX324','EX404','EX406','EX407','EX413'
);

insert into public.exercises (
  id,name,description,instructions,tips,exercise_type,difficulty,technical_complexity,
  movement_pattern,exercise_family,body_region,training_focus,equipment_requirement,
  fatigue_score,cardio_score,joint_impact,stability_requirement,mobility_requirement,
  energy_system,movement_side,starting_position,transition_cost,selection_weight,
  usable_for,home_friendly,notes,prescription_type,image_path,tracking_modes,tabata_eligible,
  warmup_eligible,warmup_role,warmup_intensity,warmup_only
) values
('EX421','Ankle Dorsiflexion Rock','Mobilité douce de cheville pour préparer squat, fente et locomotion.','1. Place un pied au sol face à un mur.\n2. Avance doucement le genou vers l’avant sans décoller le talon.\n3. Reviens puis répète avant de changer de côté.','Garde le talon au sol et reste dans une amplitude confortable.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — mobilité cheville.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX422','90/90 Hip Switch','Mobilité active des hanches en rotation interne et externe.','1. Assieds-toi avec les deux genoux fléchis.\n2. Fais basculer les genoux d’un côté puis de l’autre.\n3. Garde le mouvement lent et contrôlé.','Ne force pas la rotation ; cherche la fluidité.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Alternating','Seated',1,10,array['Warm-up'],true,'Warm-up only — mobilité hanches.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX423','Adductor Rock Back','Mobilité dynamique des adducteurs et de la hanche.','1. Place-toi à quatre appuis et tends une jambe sur le côté.\n2. Recule doucement les hanches.\n3. Reviens sans perdre la position du dos.','Amplitude confortable, sans rebond.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Unilateral','Quadruped',1,9,array['Warm-up'],true,'Warm-up only — mobilité adducteurs.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX424','Hip Flexor Rock + Reach','Mobilité dynamique du fléchisseur de hanche avec ouverture du tronc.','1. Mets-toi en demi-fente genou arrière au sol.\n2. Avance légèrement le bassin.\n3. Monte le bras du côté du genou arrière puis reviens.','Garde les côtes basses et évite de cambrer.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,2,4,'Mixed','Unilateral','Half Kneeling',1,9,array['Warm-up'],true,'Warm-up only — mobilité hanche.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX425','Hamstring Sweep','Mobilité dynamique des ischio-jambiers sans charge.','1. Avance un pied avec le talon posé.\n2. Recule les hanches et balaie les mains vers le pied.\n3. Reviens debout puis alterne.','Le mouvement doit rester fluide, sans étirement forcé.','mobility','Débutant',1,'Mobility','Mobility','Lower','Mobility','none',1,1,1,1,4,'Mixed','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — mobilité ischios.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX426','Standing Hip CARs','Cercles de hanche contrôlés pour explorer l’amplitude active.','1. Tiens-toi debout avec un appui si besoin.\n2. Monte un genou puis ouvre la hanche.\n3. Termine le cercle lentement puis change de sens.','Garde le bassin stable.','mobility','Débutant',2,'Mobility','Mobility','Lower','Mobility','none',1,1,1,3,4,'Mixed','Unilateral','Standing',1,8,array['Warm-up'],true,'Warm-up only — contrôle hanche.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX427','Squat to Stand','Préparation douce du pattern squat avec mobilité de hanches et chevilles.','1. Penche-toi pour saisir les pointes de pieds ou les tibias.\n2. Descends en squat confortable.\n3. Redresse les hanches puis recommence.','Reste lent ; ce n’est pas un exercice de force.','mobility','Débutant',2,'Squat','Squat','Lower','Mobility','none',2,1,1,2,4,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — préparation squat.','reps_standard',null,array['reps'],false,true,'movement_prep',2,true),
('EX428','Assisted Lateral Squat Shift','Déplacement latéral contrôlé pour préparer les fentes et l’ouverture de hanche.','1. Prends un écartement large et utilise un support si besoin.\n2. Transfère doucement le poids vers une jambe.\n3. Reviens au centre puis alterne.','Reste haut si la mobilité est limitée.','mobility','Débutant',2,'Lunge','Lunge','Lower','Mobility','none',2,1,1,2,4,'Mixed','Alternating','Standing',1,8,array['Warm-up'],true,'Warm-up only — préparation lunge.','reps_unilateral',null,array['reps'],false,true,'movement_prep',2,true),
('EX429','Hip Hinge Wall Drill','Apprentissage du recul de hanches sans charge pour préparer les hinges.','1. Place-toi dos au mur à environ un pied de distance.\n2. Recule les hanches jusqu’à toucher le mur.\n3. Reviens debout en gardant le dos neutre.','Cherche le déplacement des hanches, pas la profondeur.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,2,'Mixed','Bilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — pattern hinge sans charge.','reps_standard',null,array['reps'],false,true,'movement_prep',1,true),
('EX430','Glute Bridge Iso Squeeze','Activation légère des fessiers avant un travail de jambes ou de hinge.','1. Allonge-toi sur le dos, pieds au sol.\n2. Monte le bassin.\n3. Maintiens une contraction douce des fessiers puis redescends.','Ne cherche pas une contraction maximale ; garde les côtes basses.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Supine',1,10,array['Warm-up'],true,'Warm-up only — activation fessiers.','isometric',null,array['time'],false,true,'activation',1,true),
('EX431','Clamshell','Activation légère des muscles latéraux de hanche.','1. Allonge-toi sur le côté, genoux fléchis.\n2. Garde les pieds ensemble et ouvre le genou supérieur.\n3. Referme lentement puis change de côté.','Évite de rouler le bassin vers l’arrière.','activation','Débutant',1,'Hinge','Hinge','Lower','Stability','none',1,1,1,2,1,'Mixed','Unilateral','Side Lying',1,9,array['Warm-up'],true,'Warm-up only — activation hanche.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX432','Mini-Band Lateral Walk','Activation latérale des fessiers avec élastique léger.','1. Place l’élastique autour des genoux ou des chevilles.\n2. Fléchis légèrement les genoux.\n3. Fais de petits pas latéraux contrôlés.','Utilise une résistance légère : le but est d’activer, pas de fatiguer.','activation','Débutant',1,'Lunge','Lunge','Lower','Stability','required',2,1,1,2,1,'Mixed','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation avec élastique léger.','reps_unilateral',null,array['reps'],false,true,'activation',2,true),
('EX433','Dead Bug Breathing','Activation du tronc associée à une respiration contrôlée.','1. Allonge-toi sur le dos, hanches et genoux à 90°.\n2. Expire en gardant le bas du dos stable.\n3. Alterne une extension courte bras/jambe opposés.','La respiration et le contrôle priment sur l’amplitude.','activation','Débutant',1,'Anti-Extension','Core','Core','Stability','none',1,1,1,2,1,'Mixed','Alternating','Supine',1,10,array['Warm-up'],true,'Warm-up only — activation core.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX434','Bird Dog Reach','Activation du tronc et contrôle croisé à quatre appuis.','1. Place-toi à quatre appuis.\n2. Allonge bras et jambe opposés.\n3. Reviens sans bouger le bassin puis alterne.','Garde le mouvement court si le bassin tourne.','activation','Débutant',1,'Anti-Rotation','Core','Core','Stability','none',1,1,1,2,1,'Mixed','Alternating','Quadruped',1,9,array['Warm-up'],true,'Warm-up only — activation core.','reps_unilateral',null,array['reps'],false,true,'activation',1,true),
('EX435','Thoracic Open Book','Rotation thoracique douce pour préparer le haut du corps.','1. Allonge-toi sur le côté, genoux fléchis.\n2. Ouvre le bras supérieur vers l’arrière.\n3. Reviens lentement puis change de côté.','Garde les genoux ensemble pour cibler le haut du dos.','mobility','Débutant',1,'Mobility','Mobility','Full Body','Mobility','none',1,1,1,1,4,'Mixed','Unilateral','Side Lying',1,9,array['Warm-up'],true,'Warm-up only — mobilité thoracique.','reps_unilateral',null,array['reps'],false,true,'mobility',1,true),
('EX436','Scapular Wall Slide','Préparation légère des épaules et des omoplates contre un mur.','1. Place le dos contre le mur et les avant-bras devant toi.\n2. Fais glisser les bras vers le haut.\n3. Redescends sans hausser les épaules.','Reste dans une amplitude indolore.','activation','Débutant',1,'Push Vertical','Push','Upper','Stability','none',1,1,1,2,2,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation scapulaire.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX437','Wall Angel','Mobilité active des épaules et du haut du dos contre un mur.','1. Place le dos contre le mur.\n2. Fais glisser les bras de bas en haut.\n3. Garde le mouvement lent et confortable.','Ne force pas le contact des mains avec le mur.','mobility','Débutant',1,'Pull Horizontal','Pull','Upper','Mobility','none',1,1,1,2,3,'Mixed','Bilateral','Standing',1,8,array['Warm-up'],true,'Warm-up only — mobilité épaules.','reps_standard',null,array['reps'],false,true,'mobility',1,true),
('EX438','Band External Rotation','Activation légère de la coiffe des rotateurs avec élastique.','1. Garde les coudes près du corps.\n2. Écarte doucement les mains contre l’élastique.\n3. Reviens lentement.','Choisis une résistance très légère.','activation','Débutant',1,'Pull Horizontal','Pull','Upper','Stability','required',1,1,1,2,1,'Mixed','Bilateral','Standing',1,10,array['Warm-up'],true,'Warm-up only — activation épaule avec élastique léger.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX439','Scapular Wall Push','Activation des omoplates en appui léger contre un mur.','1. Place les mains contre un mur, bras tendus.\n2. Laisse les omoplates se rapprocher légèrement.\n3. Repousse le mur pour les écarter sans plier les coudes.','L’appui doit rester léger.','activation','Débutant',1,'Push Horizontal','Push','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation scapulaire en appui léger.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX440','Prone Y Raise','Activation légère des stabilisateurs de l’omoplate au sol.','1. Allonge-toi sur le ventre.\n2. Place les bras en Y.\n3. Décolle légèrement les mains puis repose avec contrôle.','Très petite amplitude, sans charge.','activation','Débutant',1,'Pull Vertical','Pull','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Prone',1,8,array['Warm-up'],true,'Warm-up only — activation haut du dos.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX441','Serratus Wall Slide','Activation du dentelé et contrôle de l’omoplate contre un mur.','1. Place les avant-bras sur le mur.\n2. Fais-les glisser vers le haut en poussant légèrement dans le mur.\n3. Redescends sans hausser les épaules.','Pression légère et mouvement contrôlé.','activation','Débutant',1,'Push Vertical','Push','Upper','Stability','none',1,1,1,2,1,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — activation serratus.','reps_standard',null,array['reps'],false,true,'activation',1,true),
('EX442','March in Place','Montée en température très progressive sans impact important.','1. Marche sur place.\n2. Monte les genoux à hauteur confortable.\n3. Garde un rythme facile et régulier.','Tu dois pouvoir parler facilement pendant le mouvement.','conditioning','Débutant',1,'Locomotion','Locomotion','Full Body','Conditioning','none',1,2,1,1,1,'Aerobic','Alternating','Standing',1,9,array['Warm-up'],true,'Warm-up only — pulse raiser faible impact.','reps_unilateral',null,array['reps'],false,true,'pulse_raiser',1,true),
('EX443','Low Impact Step Jack','Version sans saut du jumping jack pour monter progressivement la température.','1. Fais un pas latéral avec une jambe.\n2. Monte les bras confortablement.\n3. Reviens au centre puis alterne.','Pas de saut ; garde une intensité facile.','conditioning','Débutant',1,'Conditioning','Conditioning','Full Body','Conditioning','none',2,2,1,1,1,'Aerobic','Alternating','Standing',1,8,array['Warm-up'],true,'Warm-up only — pulse raiser sans saut.','reps_unilateral',null,array['reps'],false,true,'pulse_raiser',2,true),
('EX444','Arm Circles','Mobilité active simple des épaules sans charge.','1. Tends les bras sur les côtés.\n2. Dessine de petits cercles contrôlés.\n3. Change de sens après quelques répétitions.','Commence petit puis augmente légèrement l’amplitude.','mobility','Débutant',1,'Mobility','Mobility','Upper','Mobility','none',1,1,1,1,3,'Mixed','Bilateral','Standing',1,9,array['Warm-up'],true,'Warm-up only — mobilité épaules.','reps_standard',null,array['reps'],false,true,'mobility',1,true)
on conflict (id) do update set
  name=excluded.name,description=excluded.description,instructions=excluded.instructions,tips=excluded.tips,
  exercise_type=excluded.exercise_type,difficulty=excluded.difficulty,technical_complexity=excluded.technical_complexity,
  movement_pattern=excluded.movement_pattern,exercise_family=excluded.exercise_family,body_region=excluded.body_region,
  training_focus=excluded.training_focus,equipment_requirement=excluded.equipment_requirement,
  fatigue_score=excluded.fatigue_score,cardio_score=excluded.cardio_score,joint_impact=excluded.joint_impact,
  stability_requirement=excluded.stability_requirement,mobility_requirement=excluded.mobility_requirement,
  energy_system=excluded.energy_system,movement_side=excluded.movement_side,starting_position=excluded.starting_position,
  transition_cost=excluded.transition_cost,selection_weight=excluded.selection_weight,usable_for=excluded.usable_for,
  home_friendly=excluded.home_friendly,notes=excluded.notes,prescription_type=excluded.prescription_type,
  tracking_modes=excluded.tracking_modes,tabata_eligible=excluded.tabata_eligible,
  warmup_eligible=excluded.warmup_eligible,warmup_role=excluded.warmup_role,
  warmup_intensity=excluded.warmup_intensity,warmup_only=excluded.warmup_only;

insert into public.exercise_equipment (exercise_id,equipment_id)
values ('EX432','E05'),('EX438','E05')
on conflict do nothing;

insert into public.exercise_equipment_requirements_v2
  (exercise_id,option_group,equipment_id,min_quantity,is_optional,notes)
values
  ('EX432',1,'E05',1,false,'Élastique léger pour activation latérale.'),
  ('EX438',1,'E05',1,false,'Élastique très léger pour rotation externe.')
on conflict do nothing;

insert into public.exercise_muscles (exercise_id,muscle_id,priority) values
('EX421','M09','primary'),('EX421','M15','secondary'),
('EX422','M08','primary'),('EX422','M15','secondary'),
('EX423','M08','primary'),('EX423','M07','secondary'),('EX423','M15','secondary'),
('EX424','M14','primary'),('EX424','M06','secondary'),('EX424','M15','secondary'),
('EX425','M07','primary'),('EX425','M09','secondary'),('EX425','M15','secondary'),
('EX426','M08','primary'),('EX426','M14','secondary'),('EX426','M15','secondary'),
('EX427','M06','primary'),('EX427','M08','secondary'),('EX427','M07','secondary'),('EX427','M15','secondary'),
('EX428','M08','primary'),('EX428','M06','secondary'),('EX428','M15','secondary'),
('EX429','M07','primary'),('EX429','M08','secondary'),('EX429','M12','secondary'),
('EX430','M08','primary'),('EX430','M07','secondary'),('EX430','M10','secondary'),
('EX431','M08','primary'),('EX431','M11','secondary'),
('EX432','M08','primary'),('EX432','M06','secondary'),
('EX433','M10','primary'),('EX433','M14','secondary'),
('EX434','M10','primary'),('EX434','M08','secondary'),('EX434','M03','secondary'),
('EX435','M13','primary'),('EX435','M11','secondary'),('EX435','M15','secondary'),
('EX436','M03','primary'),('EX436','M13','secondary'),
('EX437','M13','primary'),('EX437','M03','secondary'),('EX437','M15','secondary'),
('EX438','M03','primary'),('EX438','M13','secondary'),
('EX439','M03','primary'),('EX439','M01','secondary'),('EX439','M05','secondary'),
('EX440','M13','primary'),('EX440','M03','secondary'),
('EX441','M03','primary'),('EX441','M13','secondary'),
('EX442','M16','primary'),('EX442','M06','secondary'),('EX442','M14','secondary'),
('EX443','M16','primary'),('EX443','M06','secondary'),('EX443','M03','secondary'),
('EX444','M03','primary'),('EX444','M15','secondary')
on conflict do nothing;

insert into public.exercise_body_zones (exercise_id,body_zone_id,involvement,source,notes) values
('EX421','ankle_foot','primary','reviewed',null),('EX421','calf_shin','secondary','reviewed',null),
('EX422','hip_glute_groin','primary','reviewed',null),
('EX423','hip_glute_groin','primary','reviewed',null),('EX423','hamstring','secondary','reviewed',null),
('EX424','hip_glute_groin','primary','reviewed',null),('EX424','quadriceps','secondary','reviewed',null),
('EX425','hamstring','primary','reviewed',null),('EX425','calf_shin','secondary','reviewed',null),
('EX426','hip_glute_groin','primary','reviewed',null),
('EX427','knee','primary','reviewed',null),('EX427','hip_glute_groin','secondary','reviewed',null),('EX427','ankle_foot','secondary','reviewed',null),('EX427','quadriceps','secondary','reviewed',null),
('EX428','knee','primary','reviewed',null),('EX428','hip_glute_groin','secondary','reviewed',null),('EX428','ankle_foot','secondary','reviewed',null),('EX428','quadriceps','secondary','reviewed',null),
('EX429','lower_back','secondary','reviewed','Le hinge implique la zone lombaire même sans charge.'),('EX429','hamstring','primary','reviewed',null),('EX429','hip_glute_groin','secondary','reviewed',null),
('EX430','hip_glute_groin','primary','reviewed',null),('EX430','hamstring','secondary','reviewed',null),('EX430','lower_back','secondary','reviewed',null),
('EX431','hip_glute_groin','primary','reviewed',null),
('EX432','hip_glute_groin','primary','reviewed',null),('EX432','knee','secondary','reviewed',null),
('EX433','core_abdomen','primary','reviewed',null),('EX433','lower_back','secondary','reviewed',null),
('EX434','core_abdomen','primary','reviewed',null),('EX434','shoulder','secondary','reviewed',null),('EX434','forearm_wrist_hand','secondary','reviewed',null),('EX434','hip_glute_groin','secondary','reviewed',null),
('EX435','upper_back_neck','primary','reviewed',null),('EX435','shoulder','secondary','reviewed',null),
('EX436','shoulder','primary','reviewed',null),('EX436','upper_back_neck','secondary','reviewed',null),('EX436','arm_elbow','secondary','reviewed',null),
('EX437','shoulder','primary','reviewed',null),('EX437','upper_back_neck','secondary','reviewed',null),
('EX438','shoulder','primary','reviewed',null),('EX438','arm_elbow','secondary','reviewed',null),('EX438','forearm_wrist_hand','secondary','reviewed',null),
('EX439','shoulder','primary','reviewed',null),('EX439','arm_elbow','secondary','reviewed',null),('EX439','forearm_wrist_hand','secondary','reviewed',null),
('EX440','shoulder','primary','reviewed',null),('EX440','upper_back_neck','secondary','reviewed',null),
('EX441','shoulder','primary','reviewed',null),('EX441','upper_back_neck','secondary','reviewed',null),
('EX442','knee','secondary','reviewed',null),('EX442','ankle_foot','secondary','reviewed',null),('EX442','hip_glute_groin','secondary','reviewed',null),('EX442','calf_shin','secondary','reviewed',null),
('EX443','knee','secondary','reviewed',null),('EX443','ankle_foot','secondary','reviewed',null),('EX443','shoulder','secondary','reviewed',null),
('EX444','shoulder','primary','reviewed',null)
on conflict do nothing;

insert into public.exercise_tags (exercise_id,tag)
select id,'warmup_only' from public.exercises where warmup_only
on conflict do nothing;
insert into public.exercise_tags (exercise_id,tag)
select id,'warmup_role:'||warmup_role from public.exercises where warmup_eligible and warmup_role is not null
on conflict do nothing;

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_wrist',
       'Zone poignet/main impliquée : exclure si gêne ou douleur déclarée au poignet.',
       'critical','wrist','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='forearm_wrist_hand'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_wrist');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_elbow',
       'Zone bras/coude impliquée : exclure si gêne ou douleur déclarée au coude.',
       'critical','elbow','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='arm_elbow'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_elbow');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_shoulder',
       'Zone épaule impliquée : exclure si gêne ou douleur déclarée à l’épaule.',
       'critical','shoulder','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='shoulder'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_shoulder');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_knee',
       'Zone genou impliquée : exclure si gêne ou douleur déclarée au genou.',
       'critical','knee','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='knee'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_knee');

insert into public.exercise_constraints
  (exercise_id,constraint_name,reason,priority,body_zone,rule_type,severity)
select ebz.exercise_id,'auto_hard_gate_lower_back',
       'Zone lombaire impliquée : exclure si gêne ou douleur déclarée au bas du dos.',
       'critical','lower_back','avoid',3
from public.exercise_body_zones ebz
where ebz.body_zone_id='lower_back'
  and not exists (select 1 from public.exercise_constraints c where c.exercise_id=ebz.exercise_id and c.constraint_name='auto_hard_gate_lower_back');

create or replace function public.sync_exercise_warmup_contract()
returns trigger
language plpgsql
as $$
begin
  if new.warmup_only then
    new.warmup_eligible := true;
  end if;
  if new.warmup_eligible then
    if new.warmup_role is null or new.warmup_intensity is null then
      raise exception 'warmup_eligible requires warmup_role and warmup_intensity for exercise %', new.id;
    end if;
    if not ('Warm-up' = any(coalesce(new.usable_for,'{}'::text[]))) then
      new.usable_for := array_append(coalesce(new.usable_for,'{}'::text[]),'Warm-up');
    end if;
    if new.warmup_only then
      new.usable_for := array['Warm-up'];
    end if;
  else
    new.usable_for := array_remove(coalesce(new.usable_for,'{}'::text[]),'Warm-up');
    new.warmup_role := null;
    new.warmup_intensity := null;
    new.warmup_only := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_exercise_warmup_contract on public.exercises;
create trigger trg_sync_exercise_warmup_contract
before insert or update of warmup_eligible,warmup_role,warmup_intensity,warmup_only,usable_for
on public.exercises
for each row execute function public.sync_exercise_warmup_contract();

comment on column public.exercises.warmup_eligible is 'True only for low-fatigue exercises suitable for warm-up selection.';
comment on column public.exercises.warmup_role is 'Coach warm-up role: mobility, activation, movement_prep, pulse_raiser.';
comment on column public.exercises.warmup_intensity is 'Warm-up intensity 1-3; V1 catalogue intentionally stays at 1-2.';
comment on column public.exercises.warmup_only is 'If true, the exercise is dedicated exclusively to Warm-up.';;

