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
'B2.6.3 session-level shadow runner. Replays exercise logs chronologically into in-memory capability states and returns decisions without persistence.';