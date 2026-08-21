create or replace function public.w4_performance_context_v1(
  p_exercise_log_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_log public.exercise_logs%rowtype;
  v_session public.workout_sessions%rowtype;
  v_exercise public.exercises%rowtype;
  v_wse public.workout_session_exercises%rowtype;
  v_has_session boolean := false;
  v_has_exercise boolean := false;
  v_has_wse boolean := false;
  v_block_key text;
  v_position integer;
  v_expected jsonb := '{}'::jsonb;
  v_obs_context jsonb := '{}'::jsonb;
  v_obs_quality jsonb := '{}'::jsonb;
  v_comparison_context jsonb := '{}'::jsonb;
  v_observation_role text;
  v_observed_at timestamptz;
  v_primary_muscles jsonb := '[]'::jsonb;
  v_wod_muscle_ledger jsonb := '[]'::jsonb;
  v_dominant_muscle jsonb := null;
  v_block_exercise_count integer := 0;
  v_prev_exercise_id text;
  v_prev_exercise_name text;
  v_prev_position integer;
  v_next_exercise_id text;
  v_next_exercise_name text;
  v_next_position integer;
  v_wrap_exercise_id text;
  v_wrap_exercise_name text;
  v_wrap_position integer;
  v_prev_overlap jsonb := '[]'::jsonb;
  v_wrap_overlap jsonb := '[]'::jsonb;
  v_protocol_repeats boolean := false;
  v_mechanic text;
  v_variant text;
  v_readiness text;
  v_context_key text;
  v_status text;
begin
  select * into v_log from public.exercise_logs where id = p_exercise_log_id;
  if not found then
    return jsonb_build_object('version','w4-performance-context-v1','status','NO_OBSERVATION','exercise_log_id',p_exercise_log_id);
  end if;

  if auth.uid() is not null and auth.uid() <> v_log.user_id then
    return jsonb_build_object('version','w4-performance-context-v1','status','NOT_FOUND_OR_FORBIDDEN','exercise_log_id',p_exercise_log_id);
  end if;

  select poc.block_key,poc.position,coalesce(poc.expected_json,'{}'::jsonb),coalesce(poc.observation_context_json,'{}'::jsonb),coalesce(poc.observation_quality_json,'{}'::jsonb),coalesce(poc.comparison_context_json,'{}'::jsonb),poc.observation_role,poc.observed_at
    into v_block_key,v_position,v_expected,v_obs_context,v_obs_quality,v_comparison_context,v_observation_role,v_observed_at
  from public.performance_observation_contract poc
  where poc.exercise_log_id = v_log.id;

  if v_log.session_id is not null then
    select * into v_session from public.workout_sessions where id = v_log.session_id;
    v_has_session := found;
  end if;

  select * into v_exercise from public.exercises where id = v_log.exercise_id;
  v_has_exercise := found;

  if v_log.session_exercise_id is not null then
    select * into v_wse
    from public.workout_session_exercises
    where id = v_log.session_exercise_id
      and (v_log.session_id is null or session_id = v_log.session_id);
    v_has_wse := found;
  end if;

  v_block_key := coalesce(v_block_key,case when v_has_wse then v_wse.block_key else null end,v_obs_context->>'block_key');
  v_position := coalesce(v_position,case when v_has_wse then v_wse.position::integer else null end,nullif(v_obs_context->>'position','')::integer);

  select coalesce(jsonb_agg(jsonb_build_object('muscle_id',em.muscle_id,'muscle_name',m.name,'priority',em.priority,'local_fatigue_eligible',coalesce(m.local_fatigue_eligible,false)) order by em.muscle_id),'[]'::jsonb)
    into v_primary_muscles
  from public.exercise_muscles em
  join public.muscles m on m.id=em.muscle_id
  where em.exercise_id=v_log.exercise_id and em.priority='primary';

  if jsonb_typeof(v_expected #> '{whole_wod_metrics,primary_muscle_exposure_ledger}')='array' then
    v_wod_muscle_ledger := coalesce(v_expected #> '{whole_wod_metrics,primary_muscle_exposure_ledger}','[]'::jsonb);
    select elem into v_dominant_muscle
    from jsonb_array_elements(v_wod_muscle_ledger) elem
    order by coalesce((elem->>'share')::numeric,-1) desc
    limit 1;
  end if;

  if v_has_wse then
    select count(*)::integer into v_block_exercise_count
    from public.workout_session_exercises se
    where se.session_id=v_wse.session_id and se.block_key=v_wse.block_key;

    select se.exercise_id,se.exercise_name,se.position::integer into v_prev_exercise_id,v_prev_exercise_name,v_prev_position
    from public.workout_session_exercises se
    where se.session_id=v_wse.session_id and se.block_key=v_wse.block_key and se.position<v_wse.position
    order by se.position desc limit 1;

    select se.exercise_id,se.exercise_name,se.position::integer into v_next_exercise_id,v_next_exercise_name,v_next_position
    from public.workout_session_exercises se
    where se.session_id=v_wse.session_id and se.block_key=v_wse.block_key and se.position>v_wse.position
    order by se.position asc limit 1;

    if v_prev_exercise_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('muscle_id',cur.muscle_id,'muscle_name',m.name,'current_priority',cur.priority,'previous_priority',prev.priority) order by cur.muscle_id),'[]'::jsonb)
        into v_prev_overlap
      from public.exercise_muscles cur
      join public.exercise_muscles prev on prev.muscle_id=cur.muscle_id and prev.exercise_id=v_prev_exercise_id
      join public.muscles m on m.id=cur.muscle_id
      where cur.exercise_id=v_log.exercise_id and cur.priority='primary' and prev.priority='primary' and coalesce(m.local_fatigue_eligible,false)=true;
    end if;
  end if;

  v_mechanic := coalesce(case when v_has_session then v_session.mechanic_json->>'mechanic_key' else null end,v_obs_context->>'mechanic',v_expected->>'mechanic');
  v_variant := case when v_has_session then v_session.mechanic_json->>'variant_key' else null end;
  v_readiness := coalesce(case when v_has_session then v_session.readiness else null end,v_obs_context->>'readiness');

  if v_has_session and v_block_key='wod' then
    v_protocol_repeats := coalesce(
      nullif(v_session.actual_protocol_outcome_json->>'rounds_completed','')::numeric>1,
      nullif(v_session.actual_protocol_outcome_json->>'planned_rounds','')::numeric>1,
      nullif(v_session.mechanic_json#>>'{parameters,rounds}','')::numeric>1,
      nullif(v_expected#>>'{block_parameters,rounds}','')::numeric>1,
      false
    );
  end if;

  if v_has_wse and v_block_key='wod' and v_protocol_repeats and v_wse.position=1 and v_block_exercise_count>1 then
    select se.exercise_id,se.exercise_name,se.position::integer into v_wrap_exercise_id,v_wrap_exercise_name,v_wrap_position
    from public.workout_session_exercises se
    where se.session_id=v_wse.session_id and se.block_key=v_wse.block_key
    order by se.position desc limit 1;

    if v_wrap_exercise_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('muscle_id',cur.muscle_id,'muscle_name',m.name,'current_priority',cur.priority,'previous_cycle_priority',prev.priority) order by cur.muscle_id),'[]'::jsonb)
        into v_wrap_overlap
      from public.exercise_muscles cur
      join public.exercise_muscles prev on prev.muscle_id=cur.muscle_id and prev.exercise_id=v_wrap_exercise_id
      join public.muscles m on m.id=cur.muscle_id
      where cur.exercise_id=v_log.exercise_id and cur.priority='primary' and prev.priority='primary' and coalesce(m.local_fatigue_eligible,false)=true;
    end if;
  end if;

  v_status := case when v_has_session and v_has_wse and v_has_exercise then 'CONTEXT_AVAILABLE' else 'PARTIAL_CONTEXT' end;
  v_context_key := concat_ws('|','mechanic='||coalesce(v_mechanic,'unknown'),'variant='||coalesce(v_variant,'none'),'block='||coalesce(v_block_key,'unknown'),'pattern='||coalesce(case when v_has_exercise then v_exercise.movement_pattern else null end,'unknown'),'position='||coalesce(v_position::text,'unknown'),'readiness='||coalesce(v_readiness,'unknown'));

  return jsonb_build_object(
    'version','w4-performance-context-v1',
    'status',v_status,
    'context_key',v_context_key,
    'semantics',jsonb_build_object('raw_performance_immutable',true,'context_separate_from_raw_performance',true,'no_context_score_in_v1',true,'no_comparison_weight_in_v1',true,'missing_context_is_not_weakness',true),
    'observation',jsonb_build_object(
      'exercise_log_id',v_log.id,'user_id',v_log.user_id,'session_id',v_log.session_id,'session_exercise_id',v_log.session_exercise_id,'source_kind',v_log.source_kind,'observation_role',v_observation_role,'observed_at',coalesce(v_observed_at,v_log.created_at),'quality',v_obs_quality,'comparison_context_existing',v_comparison_context,
      'raw_performance',jsonb_build_object('reps_completed',v_log.reps_completed,'weight_kg',v_log.weight_kg,'duration_seconds',v_log.duration_seconds,'distance_meters',v_log.distance_meters,'rpe',v_log.rpe,'status',v_log.status,'user_execution_status',v_log.user_execution_status,'execution_reason_code',v_log.execution_reason_code,'actual_json',coalesce(v_log.actual_json,'{}'::jsonb))
    ),
    'exercise',jsonb_build_object('exercise_id',v_log.exercise_id,'exercise_name',case when v_has_exercise then v_exercise.name else null end,'exercise_type',case when v_has_exercise then v_exercise.exercise_type else null end,'movement_pattern',case when v_has_exercise then v_exercise.movement_pattern else null end,'exercise_family',case when v_has_exercise then v_exercise.exercise_family else null end,'body_region',case when v_has_exercise then v_exercise.body_region else null end,'training_focus',case when v_has_exercise then v_exercise.training_focus else null end,'technical_complexity',case when v_has_exercise then v_exercise.technical_complexity else null end,'prescription_type',case when v_has_exercise then v_exercise.prescription_type else null end,'tracking_modes',case when v_has_exercise then to_jsonb(v_exercise.tracking_modes) else '[]'::jsonb end,'catalog_fatigue_score',case when v_has_exercise then v_exercise.fatigue_score else null end,'primary_muscles',v_primary_muscles),
    'session_context',jsonb_build_object('available',v_has_session,'status',case when v_has_session then v_session.status else null end,'duration_minutes',case when v_has_session then v_session.duration_minutes else null end,'mechanic',v_mechanic,'variant',v_variant,'mechanic_parameters',case when v_has_session then v_session.mechanic_json->'parameters' else null end,'focus',coalesce(case when v_has_session then v_session.focus else null end,v_obs_context->>'focus'),'target_region',coalesce(case when v_has_session then v_session.target_region else null end,v_obs_context->>'target_region'),'readiness',v_readiness,'progression_intent',case when v_has_session then v_session.progression_intent else null end,'available_equipment',case when v_has_session then to_jsonb(v_session.available_equipment) else '[]'::jsonb end,'injured_zones',case when v_has_session then to_jsonb(v_session.injured_zones) else '[]'::jsonb end,'global_rpe',case when v_has_session then v_session.global_rpe else null end,'post_workout_feeling',case when v_has_session then v_session.post_workout_feeling else null end,'completed_at',case when v_has_session then v_session.completed_at else null end),
    'prescription_structure',jsonb_build_object('block_key',v_block_key,'position',v_position,'text',case when v_has_wse then v_wse.prescription else null end,'session_exercise_prescription_json',case when v_has_wse then coalesce(v_wse.prescription_json,'{}'::jsonb) else '{}'::jsonb end,'observation_prescription_json',coalesce(v_log.prescription_json,'{}'::jsonb),'expected_json',v_expected,'planned_rounds',case when v_has_wse then v_wse.rounds else null end,'expected_rpe_min',case when v_has_wse then v_wse.expected_rpe_min else null end,'expected_rpe_max',case when v_has_wse then v_wse.expected_rpe_max else null end),
    'density_context',jsonb_build_object('available',((v_has_session and v_session.expected_stimulus_json?'density') or v_expected#>'{whole_wod_metrics,density_percent}' is not null or v_expected#>'{whole_wod_metrics,density_fit}' is not null or v_expected#>'{whole_wod_metrics,time_utilization_percent}' is not null),'session_expected_density',case when v_has_session then v_session.expected_stimulus_json->'density' else null end,'whole_wod_density_percent',v_expected#>'{whole_wod_metrics,density_percent}','whole_wod_density_fit',v_expected#>'{whole_wod_metrics,density_fit}','time_utilization_percent',coalesce(v_expected#>'{whole_wod_metrics,time_utilization_percent}',case when v_has_session then v_session.mechanic_json->'time_utilization_percent' else null end),'predicted_block_volume',v_expected->'predicted_block_volume','actual_protocol_elapsed_seconds',case when v_has_session then v_session.actual_protocol_outcome_json->'elapsed_seconds' else null end,'actual_protocol_completion_ratio',case when v_has_session then v_session.actual_protocol_outcome_json->'completion_ratio' else null end),
    'muscle_context',jsonb_build_object('dominant_share_available',v_dominant_muscle is not null,'dominant_primary_muscle_exposure',v_dominant_muscle,'primary_muscle_exposure_ledger',v_wod_muscle_ledger,'share_source',case when v_dominant_muscle is not null then 'expected_json.whole_wod_metrics.primary_muscle_exposure_ledger' else null end,'catalog_primary_muscles',v_primary_muscles),
    'sequence_context',jsonb_build_object('available',v_has_wse,'block_key',v_block_key,'position',v_position,'block_exercise_count',v_block_exercise_count,'previous',case when v_prev_exercise_id is null then null else jsonb_build_object('exercise_id',v_prev_exercise_id,'exercise_name',v_prev_exercise_name,'position',v_prev_position,'primary_local_muscle_overlap',v_prev_overlap,'has_primary_local_muscle_overlap',jsonb_array_length(v_prev_overlap)>0) end,'next',case when v_next_exercise_id is null then null else jsonb_build_object('exercise_id',v_next_exercise_id,'exercise_name',v_next_exercise_name,'position',v_next_position) end,'protocol_repeat_evidence',v_protocol_repeats,'cycle_predecessor',case when v_wrap_exercise_id is null then null else jsonb_build_object('exercise_id',v_wrap_exercise_id,'exercise_name',v_wrap_exercise_name,'position',v_wrap_position,'primary_local_muscle_overlap',v_wrap_overlap,'has_primary_local_muscle_overlap',jsonb_array_length(v_wrap_overlap)>0) end,'consecutive_local_loading_is_raw_overlap_not_score',true),
    'fatigue_context',jsonb_build_object('available',((v_has_exercise and v_exercise.fatigue_score is not null) or (v_has_session and v_session.expected_stimulus_json?'local_fatigue') or v_expected#>'{whole_wod_metrics,local_fatigue_fit}' is not null or v_expected#>'{whole_wod_metrics,local_fatigue_concentration_index}' is not null or v_log.rpe is not null or (v_has_session and v_session.global_rpe is not null)),'catalog_exercise_fatigue_score',case when v_has_exercise then v_exercise.fatigue_score else null end,'session_expected_local_fatigue',case when v_has_session then v_session.expected_stimulus_json->'local_fatigue' else null end,'whole_wod_local_fatigue_fit',v_expected#>'{whole_wod_metrics,local_fatigue_fit}','whole_wod_local_fatigue_concentration_index',v_expected#>'{whole_wod_metrics,local_fatigue_concentration_index}','exercise_rpe',v_log.rpe,'session_global_rpe',case when v_has_session then v_session.global_rpe else null end,'post_workout_feeling',case when v_has_session then v_session.post_workout_feeling else null end,'pain_affected',v_log.pain_affected,'pain_zones',to_jsonb(v_log.pain_zones)),
    'source_trace',jsonb_build_object('raw_performance','exercise_logs','observation_contract','performance_observation_contract','session',case when v_has_session then 'workout_sessions' else null end,'session_exercise',case when v_has_wse then 'workout_session_exercises' else null end,'exercise_catalog',case when v_has_exercise then 'exercises + exercise_muscles + muscles' else null end,'protocol_outcome',case when v_has_session and v_session.actual_protocol_outcome_json<>'{}'::jsonb then 'workout_sessions.actual_protocol_outcome_json' else null end)
  );
end;
$$;

revoke all on function public.w4_performance_context_v1(bigint) from public;
revoke all on function public.w4_performance_context_v1(bigint) from anon;
grant execute on function public.w4_performance_context_v1(bigint) to authenticated;
grant execute on function public.w4_performance_context_v1(bigint) to service_role;
comment on function public.w4_performance_context_v1(bigint) is 'W4 CTX-001: read-only performance context descriptor. Raw performance is immutable; context is separate; no comparison score or weighting is introduced in v1.';

create or replace function public.w4_session_performance_context_v1(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_contexts jsonb := '[]'::jsonb;
begin
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if not found then
    return jsonb_build_object('version','w4-session-performance-context-v1','status','NO_SESSION','session_id',p_session_id,'contexts','[]'::jsonb);
  end if;

  if auth.uid() is not null and auth.uid() <> v_user_id then
    return jsonb_build_object('version','w4-session-performance-context-v1','status','NOT_FOUND_OR_FORBIDDEN','session_id',p_session_id,'contexts','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(public.w4_performance_context_v1(el.id) order by el.created_at,el.id),'[]'::jsonb)
    into v_contexts
  from public.exercise_logs el
  where el.session_id=p_session_id;

  return jsonb_build_object(
    'version','w4-session-performance-context-v1',
    'status',case when jsonb_array_length(v_contexts)>0 then 'CONTEXT_AVAILABLE' else 'NO_OBSERVATIONS' end,
    'session_id',p_session_id,
    'observation_count',jsonb_array_length(v_contexts),
    'contexts',v_contexts,
    'semantics',jsonb_build_object('raw_performance_immutable',true,'context_separate_from_raw_performance',true,'comparison_weighting_deferred_to_ctx_002',true)
  );
end;
$$;

revoke all on function public.w4_session_performance_context_v1(uuid) from public;
revoke all on function public.w4_session_performance_context_v1(uuid) from anon;
grant execute on function public.w4_session_performance_context_v1(uuid) to authenticated;
grant execute on function public.w4_session_performance_context_v1(uuid) to service_role;
comment on function public.w4_session_performance_context_v1(uuid) is 'W4 CTX-001 convenience reader: returns the per-observation context descriptors for one session without mutating performance data.';
