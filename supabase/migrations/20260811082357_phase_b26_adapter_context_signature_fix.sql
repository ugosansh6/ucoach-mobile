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
