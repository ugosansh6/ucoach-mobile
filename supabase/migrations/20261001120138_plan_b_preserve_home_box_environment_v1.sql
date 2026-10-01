
create or replace function public.change_workout_session_plan_fast_v3(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_environment text;
  v_result jsonb;
  v_new_session_id uuid;
  v_difference jsonb;
  v_error text := null;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'version','whole-session-environment-router-v4'
    );
  end if;

  v_environment := upper(coalesce(v_session.planned_environment_code,'UNKNOWN'));

  if v_environment='GYM' then
    return public.change_gym_session_plan_fast_v2(p_user_id,p_session_id)
      || jsonb_build_object('whole_session_router_version','whole-session-environment-router-v4');
  end if;

  if v_environment='OUTDOOR' then
    begin
      v_result := public.change_outdoor_session_plan_fast_v1(
        p_user_id,p_session_id
      );

      if coalesce(v_result->>'status','')<>'APPLIED'
         or nullif(v_result->>'new_session_id','') is null then
        raise exception 'OUTDOOR_PLAN_B_GENERATION_NOT_AVAILABLE';
      end if;

      v_new_session_id := (v_result->>'new_session_id')::uuid;
      v_difference := public.ugerod_session_plan_difference_v1(
        p_session_id,v_new_session_id
      );

      if not coalesce((v_difference->>'meaningfully_different')::boolean,false) then
        raise exception 'OUTDOOR_PLAN_B_NOT_MEANINGFULLY_DIFFERENT';
      end if;

      update public.workout_sessions
      set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
            || jsonb_build_object('whole_session_difference',v_difference),
          updated_at=now()
      where id=v_new_session_id and user_id=p_user_id;

      return v_result || jsonb_build_object(
        'whole_session_router_version','whole-session-environment-router-v4',
        'difference',v_difference,
        'whole_session_difference_enforced',true
      );
    exception when others then
      v_error:=sqlerrm;
    end;

    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE',
      'session_id',p_session_id,
      'environment_code',v_environment,
      'version','whole-session-environment-router-v4',
      'whole_session_difference_enforced',true,
      'diagnostic',v_error
    );
  end if;

  begin
    if v_environment in ('HOME','BOX') then
      perform set_config('ugerod.session_environment',v_environment,true);
    end if;

    v_result := public.change_workout_session_plan_v1(
      p_user_id,p_session_id
    );

    if coalesce(v_result->>'status','')<>'APPLIED'
       or nullif(v_result->>'new_session_id','') is null then
      raise exception 'WHOLE_SESSION_PLAN_B_GENERATION_NOT_AVAILABLE';
    end if;

    v_new_session_id := (v_result->>'new_session_id')::uuid;

    if v_environment in ('HOME','BOX') then
      update public.workout_sessions
      set planned_environment_code=v_environment,
          planned_environment_source='PLAN_B_PRESERVED',
          planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
            || jsonb_build_object(
              'environment_code',v_environment,
              'environment_source','PLAN_B_PRESERVED'
            ),
          generated_workout=jsonb_set(
            coalesce(generated_workout,'{}'::jsonb),
            '{meta}',
            coalesce(generated_workout->'meta','{}'::jsonb)
              || jsonb_build_object(
                'environment_code',v_environment,
                'environment_source','PLAN_B_PRESERVED'
              ),
            true
          ),
          updated_at=now()
      where id=v_new_session_id and user_id=p_user_id;
    end if;

    v_difference := public.ugerod_session_plan_difference_v1(
      p_session_id,v_new_session_id
    );

    if not coalesce((v_difference->>'meaningfully_different')::boolean,false) then
      raise exception 'SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE';
    end if;

    update public.workout_sessions
    set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object('whole_session_difference',v_difference),
        updated_at=now()
    where id=v_new_session_id and user_id=p_user_id;

    return v_result || jsonb_build_object(
      'whole_session_router_version','whole-session-environment-router-v4',
      'fast_path',false,
      'fast_path_kind','FULL_SESSION_MEANINGFUL_ALTERNATIVE',
      'environment_code',v_environment,
      'environment_preserved',v_environment in ('HOME','BOX'),
      'difference',v_difference,
      'whole_session_difference_enforced',true
    );
  exception when others then
    v_error:=sqlerrm;
  end;

  return jsonb_build_object(
    'status','NOT_AVAILABLE',
    'reason','SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE',
    'session_id',p_session_id,
    'environment_code',v_environment,
    'version','whole-session-environment-router-v4',
    'whole_session_difference_enforced',true,
    'diagnostic',v_error
  );
end;
$$;
