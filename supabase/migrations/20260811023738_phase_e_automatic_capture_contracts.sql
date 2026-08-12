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
