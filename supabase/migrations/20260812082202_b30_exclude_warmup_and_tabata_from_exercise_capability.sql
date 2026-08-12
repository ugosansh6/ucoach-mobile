alter function public.build_capability_observation_inputs(bigint,text)
rename to build_capability_observation_inputs_pre_block_filter;

create or replace function public.build_capability_observation_inputs(
  p_exercise_log_id bigint,
  p_quality_policy_key text default 'b2.6-adapter-draft-1'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_block text;
begin
  v_result:=public.build_capability_observation_inputs_pre_block_filter(p_exercise_log_id,p_quality_policy_key);

  select lower(coalesce(wse.block_key,'')) into v_block
  from public.exercise_logs el
  left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
  where el.id=p_exercise_log_id;

  if v_block in ('warmup','warm_up','tabata') then
    v_result:=jsonb_set(v_result,'{excluded}','true'::jsonb,true);
    v_result:=jsonb_set(v_result,'{capability_eligible}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_role}',to_jsonb('CONTEXT_ONLY'::text),true);
    v_result:=jsonb_set(v_result,'{exclusion_reason}',to_jsonb('BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'::text),true);
    v_result:=jsonb_set(v_result,'{updates}','[]'::jsonb,true);
    v_result:=jsonb_set(v_result,'{observation_context,capability_block_policy}',to_jsonb('warmup_tabata_history_only'::text),true);
  end if;

  return v_result;
end;
$function$;

alter function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb)
rename to complete_workout_session_v1_pre_block_filter;

create or replace function public.complete_workout_session_v1(
  p_session_id uuid,
  p_global_rpe integer,
  p_post_workout_feeling integer,
  p_notes text default null,
  p_exercises jsonb default '[]'::jsonb,
  p_protocol_outcome jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_excluded_count int:=0;
begin
  v_result:=public.complete_workout_session_v1_pre_block_filter(
    p_session_id,p_global_rpe,p_post_workout_feeling,p_notes,p_exercises,p_protocol_outcome
  );

  -- Keep preparation/core context in history but never let it mutate the
  -- general per-exercise capability model.
  update public.exercise_logs el
  set capability_eligible=false,
      observation_quality_json=coalesce(el.observation_quality_json,'{}'::jsonb)||jsonb_build_object(
        'capability_eligible',false,
        'block_policy','history_only'
      ),
      comparison_context_json=coalesce(el.comparison_context_json,'{}'::jsonb)||jsonb_build_object(
        'capability_exclusion_reason','BLOCK_NOT_EXERCISE_CAPABILITY_ELIGIBLE'
      )
  from public.workout_session_exercises wse
  where el.session_exercise_id=wse.id
    and el.session_id=p_session_id
    and lower(coalesce(wse.block_key,'')) in ('warmup','warm_up','tabata')
    and el.capability_eligible=true;
  get diagnostics v_excluded_count=row_count;

  return v_result||jsonb_build_object(
    'exercise_capability_block_policy','skill_and_wod_only',
    'history_only_logs',v_excluded_count
  );
end;
$function$;

revoke execute on function public.complete_workout_session_v1_pre_block_filter(uuid,integer,integer,text,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) from public,anon;
grant execute on function public.complete_workout_session_v1(uuid,integer,integer,text,jsonb,jsonb) to authenticated;;
