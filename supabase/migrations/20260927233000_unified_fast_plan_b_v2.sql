-- PERF-005: unified fast whole-session Plan B.
-- HOME/BOX/OUTDOOR first reuse the validated session and try a quality-gated
-- WOD alternative. GYM keeps its dedicated fast generator.
-- Full regeneration remains the last-resort authority.

create or replace function public.change_workout_session_wod_fast_v1(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '12s'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_old_wod_ids text[]:='{}'::text[];
  v_new_wod_ids text[]:='{}'::text[];
  v_preview jsonb;
  v_wod_row record;
  v_new_session_id uuid;
  v_blocks jsonb;
  v_generated jsonb;
  v_apply jsonb;
  v_warmup_refresh jsonb:='{}'::jsonb;
  v_plan_item_id uuid;
  v_started_at timestamptz:=clock_timestamp();
  v_elapsed_ms int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text||':session-plan-b-wod-fast:'||p_session_id::text,0)
  );

  select *
  into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  select coalesce(array_agg(exercise_id order by position),'{}'::text[])
  into v_old_wod_ids
  from public.workout_session_exercises
  where session_id=p_session_id and block_key='wod';

  if cardinality(v_old_wod_ids)=0 then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','NO_WOD_BLOCK_FOR_FAST_ALTERNATIVE',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  -- Read-only search first. Nothing is cloned until a safe alternative already
  -- passed the existing C4 swap quality gate.
  for v_wod_row in
    select id,position,exercise_id
    from public.workout_session_exercises
    where session_id=p_session_id and block_key='wod'
    order by position
  loop
    v_preview:=public.c4_wod_swap_candidate_v3_base(
      p_user_id,
      v_wod_row.id,
      'equivalent',
      v_old_wod_ids,
      null
    );

    if coalesce(v_preview->>'status','')='AVAILABLE' then
      exit;
    end if;

    v_preview:=null;
  end loop;

  if v_preview is null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','NO_SAFE_WOD_FAST_ALTERNATIVE',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  -- Clone the validated session/check-in. No Program Coach, weekly budget or
  -- full C4 generation is rerun here; the candidate itself has already passed
  -- the authoritative C4 swap gate above.
  insert into public.workout_sessions(
    user_id,status,duration_minutes,target_region,readiness,focus,
    available_equipment,injured_zones,generated_workout,progression_intent,
    planning_context_json,expected_stimulus_json,mechanic_json,quality_gate_json,
    generation_local_date,format_change_count,wod_format_anchor_json,
    wod_manual_swap_overrides_json,wod_manual_swap_history_json,
    context_recalculation_count,context_recalculation_root_session_id,
    context_recalculation_parent_session_id,planned_environment_code,
    planned_environment_source,planned_environment_selected_at,planned_surface_code
  )
  values(
    p_user_id,'generated',v_session.duration_minutes,v_session.target_region,
    v_session.readiness,v_session.focus,
    coalesce(v_session.available_equipment,'{}'::text[]),
    coalesce(v_session.injured_zones,'{}'::text[]),
    coalesce(v_session.generated_workout,'{}'::jsonb),
    v_session.progression_intent,
    coalesce(v_session.planning_context_json,'{}'::jsonb),
    coalesce(v_session.expected_stimulus_json,'{}'::jsonb),
    coalesce(v_session.mechanic_json,'{}'::jsonb),
    coalesce(v_session.quality_gate_json,'{}'::jsonb),
    coalesce(v_session.generation_local_date,public.ugerod_effective_session_anchor_date_v1()),
    v_session.format_change_count,
    coalesce(v_session.wod_format_anchor_json,'{}'::jsonb),
    coalesce(v_session.wod_manual_swap_overrides_json,'{}'::jsonb),
    coalesce(v_session.wod_manual_swap_history_json,'{}'::jsonb),
    v_session.context_recalculation_count,
    v_session.context_recalculation_root_session_id,
    v_session.context_recalculation_parent_session_id,
    v_session.planned_environment_code,
    v_session.planned_environment_source,
    v_session.planned_environment_selected_at,
    v_session.planned_surface_code
  )
  returning id into v_new_session_id;

  insert into public.workout_session_exercises(
    session_id,exercise_id,exercise_name,block_key,position,status,prescription,
    rounds,reps_completed,weight_kg,rpe,notes,duration_seconds,distance_meters,
    prescription_json,expected_outcome_json,expected_rpe_min,expected_rpe_max,
    capacity_snapshot_json,solver_decision_json,user_execution_status,
    execution_reason_code,selection_provenance
  )
  select
    v_new_session_id,exercise_id,exercise_name,block_key,position,'pending',
    prescription,rounds,null,null,null,null,null,null,prescription_json,
    expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,
    coalesce(solver_decision_json,'{}'::jsonb)
      ||jsonb_build_object('session_plan_b_fast_copy',true),
    'pending',null,selection_provenance
  from public.workout_session_exercises
  where session_id=p_session_id;

  -- Rebind every copied exercise instance id in generated_workout. Blocks that
  -- do not contain an exercise array (e.g. pure cardio protocol) remain intact.
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(b->'exercises')='array' then
          jsonb_set(
            b,
            '{exercises}',
            coalesce((
              select jsonb_agg(
                ex||jsonb_build_object(
                  'id',coalesce(ex->>'exercise_id',ex->>'id'),
                  'session_exercise_id',(
                    select wse.id
                    from public.workout_session_exercises wse
                    where wse.session_id=v_new_session_id
                      and wse.block_key=case
                        when b->>'block_key'='warmup' then 'warm_up'
                        else b->>'block_key'
                      end
                      and wse.position=ord2
                    limit 1
                  )
                )
                order by ord2
              )
              from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb))
                   with ordinality y(ex,ord2)
            ),'[]'::jsonb),
            true
          )
        else b
      end
      order by ord
    ),
    '[]'::jsonb
  )
  into v_blocks
  from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb))
       with ordinality x(b,ord);

  v_generated:=jsonb_set(
    coalesce(v_session.generated_workout,'{}'::jsonb),
    '{blocks}',
    v_blocks,
    true
  );
  v_generated:=v_generated||jsonb_build_object(
    'session_id',v_new_session_id
  );

  update public.workout_sessions
  set generated_workout=v_generated,
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
        ||jsonb_build_object(
          'session_plan_b',
          jsonb_build_object(
            'version','whole-session-plan-b-wod-fast-v1',
            'source_session_id',p_session_id,
            'scope','SESSION_DAY_ONLY',
            'same_checkin_preserved',true,
            'validated_source_blocks_reused',true,
            'quality_gate_reused_from_swap_preview',true,
            'preference_not_pain',true,
            'does_not_change_level',true,
            'does_not_create_training_debt',true,
            'fast_path',true
          )
        ),
      updated_at=now()
  where id=v_new_session_id and user_id=p_user_id;

  v_apply:=public.c4_apply_wod_candidate(
    p_user_id,
    v_new_session_id,
    v_preview->'candidate',
    coalesce(v_preview->'quality_gate','{}'::jsonb),
    'WHOLE_SESSION_PLAN_B_WOD_FAST'
  );

  select coalesce(array_agg(exercise_id order by position),'{}'::text[])
  into v_new_wod_ids
  from public.workout_session_exercises
  where session_id=v_new_session_id and block_key='wod';

  if v_new_wod_ids is not distinct from v_old_wod_ids then
    raise exception 'SESSION_PLAN_B_WOD_FAST_DID_NOT_CHANGE';
  end if;

  if exists(
    select 1 from public.workout_session_exercises
    where session_id=v_new_session_id and block_key='warm_up'
  ) then
    v_warmup_refresh:=public.c4_refresh_specific_warmup_session_v1(
      p_user_id,v_new_session_id
    );
  end if;

  select id
  into v_plan_item_id
  from public.user_training_plan_items
  where user_id=p_user_id and session_id=p_session_id
  order by updated_at desc
  limit 1
  for update;

  if v_plan_item_id is not null then
    update public.user_training_plan_items
    set session_id=v_new_session_id,
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          ||jsonb_build_object(
            'session_plan_b',
            jsonb_build_object(
              'version','whole-session-plan-b-wod-fast-v1',
              'replaced_session_id',p_session_id,
              'preference_not_pain',true,
              'creates_training_debt',false,
              'fast_path',true
            )
          ),
        updated_at=now()
    where id=v_plan_item_id and user_id=p_user_id;
  end if;

  update public.workout_sessions
  set status='abandoned',
      planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
        ||jsonb_build_object(
          'replacement',
          jsonb_build_object(
            'version','whole-session-plan-b-wod-fast-v1',
            'reason','USER_REQUESTED_ALTERNATIVE_BEFORE_START',
            'replacement_session_id',v_new_session_id,
            'preference_not_pain',true,
            'actual_training_abandonment',false,
            'creates_training_debt',false,
            'fast_path',true
          )
        ),
      updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  v_elapsed_ms:=round(
    extract(epoch from (clock_timestamp()-v_started_at))*1000
  )::int;

  return jsonb_build_object(
    'status','APPLIED',
    'version','whole-session-plan-b-wod-fast-v1',
    'old_session_id',p_session_id,
    'new_session_id',v_new_session_id,
    'old_wod_exercise_ids',to_jsonb(v_old_wod_ids),
    'new_wod_exercise_ids',to_jsonb(v_new_wod_ids),
    'meaningfully_different',true,
    'wod_changed',true,
    'same_checkin_preserved',true,
    'validated_source_blocks_reused',true,
    'quality_gate_reused_from_swap_preview',true,
    'preference_not_pain',true,
    'does_not_change_level',true,
    'does_not_create_training_debt',true,
    'warmup_refresh',v_warmup_refresh,
    'fast_path',true,
    'fast_path_kind','WOD_SWAP_CLONE',
    'elapsed_ms',v_elapsed_ms
  );
end;
$function$;

create or replace function public.change_workout_session_plan_fast_v2(
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_current_path text;
  v_fast jsonb;
  v_started_at timestamptz:=clock_timestamp();
  v_elapsed_ms int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select *
  into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status<>'generated' or v_session.started_at is not null then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_PLAN_B_ONLY_BEFORE_SESSION_START',
      'session_id',p_session_id,
      'fast_path',true
    );
  end if;

  v_current_path:=coalesce(
    nullif(v_session.generated_workout#>>'{meta,architecture,skill_path,path_key}',''),
    nullif(v_session.planning_context_json#>>'{architecture,skill_path,path_key}','')
  );

  -- 1) Cheapest meaningful change: replace Skill and copy every other block.
  if v_current_path is not null then
    begin
      v_fast:=public.change_workout_skill_plan_fast_v1(
        p_user_id,p_session_id,'ALTERNATE_SKILL'
      );
    exception when others then
      v_fast:=null;
    end;

    if coalesce(v_fast->>'status','')='APPLIED' then
      return v_fast||jsonb_build_object(
        'fast_path_kind','SKILL_CLONE',
        'whole_session_router_version','whole-session-fast-router-v2'
      );
    end if;
  end if;

  -- 2) Same check-in + validated blocks + one quality-gated WOD change.
  begin
    v_fast:=public.change_workout_session_wod_fast_v1(
      p_user_id,p_session_id
    );
  exception when others then
    v_fast:=null;
  end;

  if coalesce(v_fast->>'status','')='APPLIED' then
    return v_fast||jsonb_build_object(
      'whole_session_router_version','whole-session-fast-router-v2'
    );
  end if;

  -- 3) Last resort: keep the existing complete generator and all of its guards.
  v_fast:=public.change_workout_session_plan_v1(
    p_user_id,p_session_id
  );

  v_elapsed_ms:=round(
    extract(epoch from (clock_timestamp()-v_started_at))*1000
  )::int;

  return coalesce(v_fast,'{}'::jsonb)||jsonb_build_object(
    'whole_session_router_version','whole-session-fast-router-v2',
    'fast_path',false,
    'fast_path_kind','FULL_GENERATION_FALLBACK',
    'router_elapsed_ms',v_elapsed_ms
  );
end;
$function$;

revoke all on function public.change_workout_session_wod_fast_v1(uuid,uuid) from public;
revoke all on function public.change_workout_session_wod_fast_v1(uuid,uuid) from anon;
grant execute on function public.change_workout_session_wod_fast_v1(uuid,uuid) to service_role;

revoke all on function public.change_workout_session_plan_fast_v2(uuid,uuid) from public;
revoke all on function public.change_workout_session_plan_fast_v2(uuid,uuid) from anon;
grant execute on function public.change_workout_session_plan_fast_v2(uuid,uuid) to service_role;
