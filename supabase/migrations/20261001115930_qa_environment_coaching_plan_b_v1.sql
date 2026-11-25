
create or replace function public.qa_environment_coaching_plan_b_v1(
  p_user_id uuid,
  p_environment_code text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '40s'
as $$
declare
  v_environment text := upper(coalesce(trim(p_environment_code),''));
  v_session_id uuid;
  v_before_status text;
  v_after_status text;
  v_result jsonb := null;
  v_error text := null;
  v_forced_rollback boolean := false;
begin
  if v_environment not in ('HOME','BOX','GYM','OUTDOOR') then
    return jsonb_build_object(
      'status','INVALID_ENVIRONMENT',
      'environment_code',v_environment
    );
  end if;

  select id,status
  into v_session_id,v_before_status
  from public.workout_sessions
  where user_id=p_user_id
    and upper(coalesce(planned_environment_code,''))=v_environment
    and status='generated'
    and started_at is null
  order by created_at desc
  limit 1;

  if v_session_id is null then
    return jsonb_build_object(
      'status','NO_GENERATED_FIXTURE',
      'environment_code',v_environment
    );
  end if;

  begin
    v_result := public.change_workout_session_plan_fast_v3(
      p_user_id,v_session_id
    );

    if coalesce(v_result->>'status','')='APPLIED' then
      if not coalesce((v_result->>'whole_session_difference_enforced')::boolean,false)
         and not coalesce((v_result#>>'{difference,meaningfully_different}')::boolean,false) then
        raise exception 'QA_PLAN_B_DIFFERENCE_CONTRACT_MISSING';
      end if;

      if not coalesce((v_result#>>'{difference,meaningfully_different}')::boolean,false) then
        raise exception 'QA_PLAN_B_NOT_MEANINGFULLY_DIFFERENT';
      end if;
    end if;

    raise exception 'QA_FORCE_ROLLBACK';
  exception when others then
    if sqlerrm='QA_FORCE_ROLLBACK' then
      v_forced_rollback := true;
    else
      v_error := sqlerrm;
    end if;
  end;

  select status
  into v_after_status
  from public.workout_sessions
  where id=v_session_id;

  return jsonb_build_object(
    'status',case
      when v_error is not null then 'ERROR'
      when v_after_status is distinct from v_before_status then 'ROLLBACK_FAILED'
      when coalesce(v_result->>'status','')='APPLIED' then 'PASS_APPLIED'
      else 'PASS_NO_SAFE_ALTERNATIVE'
    end,
    'version','qa-environment-coaching-plan-b-v1',
    'environment_code',v_environment,
    'source_session_id',v_session_id,
    'source_status_before',v_before_status,
    'source_status_after',v_after_status,
    'forced_rollback',v_forced_rollback,
    'plan_b_result',v_result,
    'error',v_error
  );
end;
$$;

revoke all on function public.qa_environment_coaching_plan_b_v1(uuid,text) from public;
