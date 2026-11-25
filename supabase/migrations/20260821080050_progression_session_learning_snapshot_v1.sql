create or replace function public.progression_session_learning_snapshot_v1(
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_status text;
  v_completed_at timestamptz;
  v_local_date date;
  v_global_rpe numeric;
  v_feeling numeric;
  v_protocol jsonb;
  v_wod_exercises jsonb := '[]'::jsonb;
  v_concentration jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_total int := 0;
  v_reference int := 0;
  v_context_only int := 0;
  v_state_signal int := 0;
  v_history_only int := 0;
  v_excluded int := 0;
  v_missing_metric int := 0;
begin
  select
    ws.user_id,
    ws.status,
    ws.completed_at,
    coalesce(ws.started_local_date, ws.generation_local_date, ws.completed_at::date, ws.created_at::date),
    ws.global_rpe,
    ws.post_workout_feeling,
    ws.actual_protocol_outcome_json
  into
    v_user_id,
    v_status,
    v_completed_at,
    v_local_date,
    v_global_rpe,
    v_feeling,
    v_protocol
  from public.workout_sessions ws
  where ws.id = p_session_id;

  if not found then
    raise exception 'Unknown session %', p_session_id;
  end if;

  if auth.uid() is not null and auth.uid() <> v_user_id then
    raise exception 'Forbidden session';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('exercise_id', wse.exercise_id)
    order by wse.position
  ), '[]'::jsonb)
  into v_wod_exercises
  from public.workout_session_exercises wse
  where wse.session_id = p_session_id
    and lower(coalesce(wse.block_key, '')) = 'wod';

  v_concentration := public.c4_wod_primary_muscle_concentration_v1(v_wod_exercises);

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'exercise_log_id', q.exercise_log_id,
      'session_exercise_id', q.session_exercise_id,
      'exercise_id', q.exercise_id,
      'exercise_name', q.exercise_name,
      'block_key', q.block_key,
      'position', q.position,
      'execution_status', q.user_execution_status,
      'execution_reason_code', q.execution_reason_code,
      'observation_role', q.observation_role,
      'proof_class', q.proof_class,
      'metric_state', case when q.has_complete_metric then 'COMPLETE' else 'MISSING_OR_NOT_REQUIRED' end,
      'capability_eligible', q.capability_eligible,
      'pain_affected', q.pain_affected,
      'exclusion_reason', q.exclusion_reason,
      'primary_muscle_id', q.primary_muscle_id,
      'primary_muscle', q.primary_muscle,
      'quality', q.observation_quality,
      'actual', q.actual,
      'expected', q.expected,
      'comparison_context', q.comparison_context,
      'context_modifiers', case
        when q.block_key = 'wod'
          and coalesce(v_concentration->>'status', '') = 'SOFT_OVERCONCENTRATION'
        then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'type', 'LOCAL_MUSCLE_CONCENTRATION',
          'dominant_primary_muscle_id', v_concentration->>'dominant_primary_muscle_id',
          'dominant_primary_muscle', v_concentration->>'dominant_primary_muscle',
          'dominant_share', (v_concentration->>'dominant_share')::numeric,
          'max_consecutive_same_primary', (v_concentration->>'max_consecutive_same_primary')::int,
          'exercise_matches_dominant_muscle', q.primary_muscle_id = (v_concentration->>'dominant_primary_muscle_id')
        )))
        else '[]'::jsonb
      end
    )) order by q.block_order, q.position, q.exercise_log_id
  ), '[]'::jsonb)
  into v_items
  from (
    select
      el.id as exercise_log_id,
      el.session_exercise_id,
      el.exercise_id,
      poc.exercise_name,
      lower(coalesce(poc.block_key, '')) as block_key,
      poc.position,
      case lower(coalesce(poc.block_key, ''))
        when 'unlock' then 1
        when 'warmup' then 2
        when 'warm_up' then 2
        when 'tabata' then 3
        when 'skill' then 4
        when 'wod' then 5
        else 9
      end as block_order,
      poc.user_execution_status,
      poc.execution_reason_code,
      poc.observation_role,
      poc.capability_eligible,
      poc.pain_affected,
      adapter.payload->>'exclusion_reason' as exclusion_reason,
      coalesce(adapter.payload->'observation_quality', '{}'::jsonb) as observation_quality,
      coalesce(adapter.payload->'actual', '{}'::jsonb) as actual,
      coalesce(adapter.payload->'expected', '{}'::jsonb) as expected,
      coalesce(adapter.payload->'comparison_context', '{}'::jsonb) as comparison_context,
      coalesce(metric.has_complete_metric, false) as has_complete_metric,
      pm.muscle_id as primary_muscle_id,
      pm.muscle_name as primary_muscle,
      case
        when lower(coalesce(poc.block_key, '')) in ('unlock', 'warmup', 'warm_up', 'tabata') then 'HISTORY_ONLY'
        when coalesce(poc.pain_affected, false) then 'STATE_SIGNAL'
        when poc.observation_role = 'NON_PERFORMANCE_OBSERVATION' then 'STATE_SIGNAL'
        when poc.observation_role = 'CONTEXT_ONLY' then 'CONTEXT_ONLY'
        when poc.observation_role = 'CAPABILITY_CANDIDATE'
          and coalesce(metric.has_complete_metric, false)
          and lower(coalesce(poc.block_key, '')) = 'wod' then 'CONTEXTUAL_REFERENCE'
        when poc.observation_role = 'CAPABILITY_CANDIDATE'
          and coalesce(metric.has_complete_metric, false) then 'MEASURABLE_REFERENCE'
        when poc.observation_role = 'CAPABILITY_CANDIDATE' then 'MISSING_METRIC'
        else 'EXCLUDED'
      end as proof_class
    from public.exercise_logs el
    join public.performance_observation_contract poc
      on poc.exercise_log_id = el.id
    cross join lateral (
      select public.build_capability_observation_inputs(el.id, 'b2.6-adapter-draft-1') as payload
    ) adapter
    left join lateral (
      select coalesce(bool_or(public.m89_capability_actual_complete(
        u.value->>'family',
        coalesce(adapter.payload->'actual', '{}'::jsonb)
      )), false) as has_complete_metric
      from jsonb_array_elements(coalesce(adapter.payload->'updates', '[]'::jsonb)) u(value)
    ) metric on true
    left join lateral (
      select em.muscle_id, m.name as muscle_name
      from public.exercise_muscles em
      join public.muscles m on m.id = em.muscle_id
      where em.exercise_id = el.exercise_id
        and lower(coalesce(em.priority, '')) = 'primary'
      order by em.muscle_id
      limit 1
    ) pm on true
    where el.session_id = p_session_id
  ) q;

  select
    count(*)::int,
    count(*) filter(where value->>'proof_class' in ('MEASURABLE_REFERENCE', 'CONTEXTUAL_REFERENCE'))::int,
    count(*) filter(where value->>'proof_class' = 'CONTEXT_ONLY')::int,
    count(*) filter(where value->>'proof_class' = 'STATE_SIGNAL')::int,
    count(*) filter(where value->>'proof_class' = 'HISTORY_ONLY')::int,
    count(*) filter(where value->>'proof_class' = 'EXCLUDED')::int,
    count(*) filter(where value->>'proof_class' = 'MISSING_METRIC')::int
  into
    v_total,
    v_reference,
    v_context_only,
    v_state_signal,
    v_history_only,
    v_excluded,
    v_missing_metric
  from jsonb_array_elements(v_items);

  return jsonb_build_object(
    'version', 'w1-session-learning-snapshot-v1',
    'session', jsonb_strip_nulls(jsonb_build_object(
      'session_id', p_session_id,
      'status', v_status,
      'local_date', v_local_date,
      'completed_at', v_completed_at,
      'global_rpe', v_global_rpe,
      'post_workout_feeling', v_feeling,
      'protocol_outcome', v_protocol
    )),
    'summary', jsonb_build_object(
      'observations', v_total,
      'reference_observations', v_reference,
      'context_only_observations', v_context_only,
      'state_signal_observations', v_state_signal,
      'history_only_observations', v_history_only,
      'excluded_observations', v_excluded,
      'missing_metric_observations', v_missing_metric
    ),
    'wod_performance_context', jsonb_build_object(
      'muscular_concentration', v_concentration,
      'decision_authority', false,
      'use', 'POST_SESSION_PERFORMANCE_CONTEXT'
    ),
    'observations', v_items,
    'proof_classes', jsonb_build_object(
      'MEASURABLE_REFERENCE', 'Mesure exploitable produite dans un contexte relativement direct.',
      'CONTEXTUAL_REFERENCE', 'Mesure exploitable produite dans un WOD et à interpréter avec son contexte.',
      'STATE_SIGNAL', 'Information utile sur l’état ou une difficulté, sans inférence directe de capacité.',
      'CONTEXT_ONLY', 'Information de contexte sans lecture de performance.',
      'HISTORY_ONLY', 'Exposition historisée mais exclue de la capacité exercice.',
      'MISSING_METRIC', 'Exercice éligible mais métrique insuffisante pour constituer une preuve.',
      'EXCLUDED', 'Observation exclue de la capacité.'
    ),
    'semantics', jsonb_build_object(
      'read_only', true,
      'does_not_mutate_capability_state', true,
      'muscular_concentration_is_post_session_context_only', true,
      'raw_performance_is_never_rewritten', true,
      'no_new_sports_threshold_added', true,
      'existing_quality_policy_is_preserved', true
    )
  );
end;
$function$;

revoke all on function public.progression_session_learning_snapshot_v1(uuid) from public, anon;
grant execute on function public.progression_session_learning_snapshot_v1(uuid) to authenticated, service_role;
