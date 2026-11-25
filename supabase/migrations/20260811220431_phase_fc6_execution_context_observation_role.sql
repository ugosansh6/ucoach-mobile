create or replace view public.performance_observation_contract as
select
  el.id as exercise_log_id,
  el.user_id,
  el.session_id,
  el.session_exercise_id,
  el.exercise_id,
  e.name as exercise_name,
  wse.block_key,
  wse.position,
  el.source_kind,
  coalesce(
    nullif(wse.expected_outcome_json,'{}'::jsonb),
    nullif(wse.prescription_json,'{}'::jsonb),
    el.prescription_json,
    '{}'::jsonb
  ) as expected_json,
  case
    when el.actual_json <> '{}'::jsonb then el.actual_json
    else jsonb_strip_nulls(jsonb_build_object(
      'reps',el.reps_completed,
      'load_kg',el.weight_kg,
      'duration_seconds',el.duration_seconds,
      'distance_meters',el.distance_meters,
      'rpe',el.rpe,
      'status',el.status,
      'user_execution_status',el.user_execution_status,
      'execution_reason_code',el.execution_reason_code
    ))
  end as actual_json,
  el.observation_context_json,
  el.observation_quality_json,
  el.comparison_context_json,
  el.observation_quality as legacy_quality_scalar,
  el.capability_eligible,
  el.pain_affected,
  el.pain_zones,
  el.skip_reason,
  case
    when el.pain_affected then 'STATE_ONLY_PAIN'::text
    when el.user_execution_status='adapted' then 'CAPABILITY_EXCLUDED'::text
    when el.user_execution_status='not_completed'
         and lower(coalesce(el.execution_reason_code,el.skip_reason,'')) in (
           'equipment','material','time','lack_of_time','motivation'
         ) then 'CONTEXT_ONLY'::text
    when el.status='skipped'::text
         and lower(coalesce(el.skip_reason,'')) in (
           'equipment','material','time','lack_of_time','motivation'
         ) then 'CONTEXT_ONLY'::text
    when el.user_execution_status='not_completed' or el.status='skipped'::text then 'NON_PERFORMANCE_OBSERVATION'::text
    when not el.capability_eligible then 'CAPABILITY_EXCLUDED'::text
    else 'CAPABILITY_CANDIDATE'::text
  end as observation_role,
  el.created_at as observed_at,
  el.user_execution_status,
  el.execution_reason_code
from public.exercise_logs el
left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
left join public.exercises e on e.id::text=el.exercise_id;;
