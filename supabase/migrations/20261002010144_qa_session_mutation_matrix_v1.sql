-- POINT 5 — mutation lifecycle QA matrix.
-- Consolidated definition matching the final DEV contract after iterative QA hardening.
-- Real runs are rollback-safe and operator-only.

CREATE OR REPLACE FUNCTION public.qa_session_mutation_lifecycle_v1(p_user_id uuid, p_environment_code text, p_anchor_date date DEFAULT (CURRENT_DATE + 45))
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '180s'
AS $function$
declare
  v_env text := public.normalize_session_environment_v1(p_environment_code);
  v_anchor date := coalesce(p_anchor_date,current_date+45);
  v_surface text := null;
  v_place text := null;
  v_equipment text[] := '{}'::text[];
  v_inventory jsonb := '[]'::jsonb;

  v_generation jsonb;
  v_plan_b jsonb;
  v_plan_b_after_start jsonb;
  v_start jsonb;
  v_swap_availability jsonb;
  v_swap jsonb;
  v_adapt jsonb;
  v_adapt_after_wod jsonb;
  v_reveal jsonb;
  v_wod_start_before_reveal jsonb;
  v_wod_start jsonb;
  v_completion jsonb;

  v_source_session_id uuid;
  v_active_session_id uuid;
  v_any_wse_id uuid;
  v_protected_wse_id uuid;
  v_wod_wse_id uuid;
  v_swap_wse_id uuid;
  v_direction text;
  v_module text;

  v_source_status text;
  v_active_status text;
  v_active_env text;
  v_active_surface text;
  v_active_target_region text;
  v_after_env text;
  v_after_surface text;
  v_after_target_region text;

  v_checkin_before jsonb;
  v_checkin_after jsonb;
  v_protected_before jsonb;
  v_protected_after jsonb;
  v_wod_before_second_adapt jsonb;
  v_wod_after_second_adapt jsonb;
  v_completion_payload jsonb;

  v_guard_prestart boolean := false;
  v_guard_wod_before_start boolean := false;
  v_swap_done boolean := false;
  v_swap_phase text := null;
  v_stage text := 'INIT';
  v_error text := null;
  v_forced_rollback boolean := false;
  v_checks jsonb := '{}'::jsonb;

  v_sessions_before bigint := 0;
  v_sessions_after bigint := 0;
  v_swaps_before bigint := 0;
  v_swaps_after bigint := 0;
  v_prefs_before bigint := 0;
  v_prefs_after bigint := 0;
  v_logs_before bigint := 0;
  v_logs_after bigint := 0;
  v_anchor_session_count_before_adapt int := 0;
  v_anchor_session_count_after_adapt int := 0;

  r record;
begin
  if p_user_id is null then
    raise exception 'QA user required';
  end if;

  if v_env not in ('HOME','BOX','GYM','OUTDOOR') then
    return jsonb_build_object(
      'status','INVALID_ENVIRONMENT',
      'pass',false,
      'environment_code',v_env,
      'version','qa-session-mutation-lifecycle-v1'
    );
  end if;

  -- These QA functions are operator-only, but the production RPCs require
  -- an authenticated owner. Set a transaction-local JWT claim for the QA user.
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);

  v_surface := case when v_env='OUTDOOR' then 'TRAIL' else null end;
  v_place := case when v_env='OUTDOOR' then 'FOREST_PATH' else null end;

  v_equipment := case v_env
    when 'HOME' then array['E01','E03','E05','E07']::text[]
    when 'BOX' then array['E04','E07','E10','E14','E15','E17','E22','E23']::text[]
    when 'GYM' then array['E03','E08','E14','E15','E16','E17','E23','E27','E28','E31','E32','E35','E36','E37','E39','E48']::text[]
    else '{}'::text[]
  end;

  v_inventory := public.resolve_user_equipment_inventory(
    p_user_id,
    v_equipment,
    'c4-final-default'
  );

  select count(*) into v_sessions_before
  from public.workout_sessions where user_id=p_user_id;

  select count(*) into v_swaps_before
  from public.workout_session_swap_history where user_id=p_user_id;

  select count(*) into v_prefs_before
  from public.user_skill_session_preferences where user_id=p_user_id;

  select count(*) into v_logs_before
  from public.exercise_logs where user_id=p_user_id;

  begin
    v_stage := 'GENERATION';

    if v_env in ('HOME','BOX') then
      -- Mirror coach-handler: HOME / BOX still use the adaptive V3 authority.
      v_generation := public.d_generate_adaptive_session_v3(
        p_user_id,
        'General Fitness',
        45,
        'normal',
        'Full Body',
        'MAINTAIN',
        '{}'::text[],
        coalesce(v_inventory,'[]'::jsonb),
        v_equipment,
        4,
        'Intermédiaire',
        12,
        'c4-final-default',
        v_anchor,
        false,
        '{}'::uuid[],
        v_env,
        null,
        'QA_MUTATION_MATRIX'
      );
    else
      -- GYM / OUTDOOR use the environment generator V4 in production.
      v_generation := public.generate_environment_session_v4(
        p_user_id,
        v_env,
        v_surface,
        null,
        case when v_env='GYM' then 'CLASSIC_SETS' else null end,
        'General Fitness',
        45,
        'normal',
        case when v_env='GYM' then null else 'Full Body' end,
        'MAINTAIN',
        '{}'::text[],
        coalesce(v_inventory,'[]'::jsonb),
        v_equipment,
        v_place,
        false,
        true,
        false,
        4,
        'Intermédiaire',
        20,
        'c4-final-default',
        false,
        v_anchor
      );
    end if;

    begin
      v_source_session_id := nullif(v_generation->>'session_id','')::uuid;
    exception when others then
      v_source_session_id := null;
    end;

    if v_source_session_id is null then
      raise exception 'QA_GENERATION_NO_SESSION: %',v_generation;
    end if;

    select
      status,
      planned_environment_code,
      jsonb_build_object(
        'focus',focus,
        'duration_minutes',duration_minutes,
        'readiness',readiness,
        'target_region',target_region,
        'progression_intent',progression_intent,
        'injured_zones',coalesce(to_jsonb(injured_zones),'[]'::jsonb),
        'available_equipment',coalesce(to_jsonb(available_equipment),'[]'::jsonb),
        'planned_surface_code',planned_surface_code,
        'planned_environment_code',planned_environment_code
      )
    into v_source_status,v_active_env,v_checkin_before
    from public.workout_sessions
    where id=v_source_session_id and user_id=p_user_id;

    if v_source_status<>'generated' then
      raise exception 'QA_GENERATION_NOT_GENERATED: %',v_source_status;
    end if;
    if upper(coalesce(v_active_env,''))<>v_env then
      raise exception 'QA_GENERATION_ENVIRONMENT_DRIFT: expected %, got %',v_env,v_active_env;
    end if;

    v_checks := v_checks || jsonb_build_object(
      'generation',jsonb_build_object(
        'pass',true,
        'session_id',v_source_session_id,
        'environment_code',v_active_env,
        'status',v_source_status
      )
    );

    -- A generated session must reject execution persistence.
    v_stage := 'PRESTART_EXECUTION_GUARD';
    select id into v_any_wse_id
    from public.workout_session_exercises
    where session_id=v_source_session_id
    order by position,id
    limit 1;

    if v_any_wse_id is null then
      raise exception 'QA_GENERATION_NO_SESSION_EXERCISES';
    end if;

    v_guard_prestart := false;
    begin
      update public.workout_session_exercises
      set status='completed',
          user_execution_status='completed',
          updated_at=now()
      where id=v_any_wse_id;
    exception when others then
      v_guard_prestart := position('SESSION_LIFECYCLE:' in sqlerrm)>0;
    end;

    if not v_guard_prestart then
      raise exception 'QA_PRESTART_EXECUTION_GUARD_FAILED';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'execution_before_start',jsonb_build_object('pass',true,'blocked',true)
    );

    -- Whole-session Plan B must replace before start and preserve the check-in.
    v_stage := 'PLAN_B_BEFORE_START';
    v_plan_b := public.change_workout_session_plan_fast_v3(
      p_user_id,v_source_session_id
    );

    if coalesce(v_plan_b->>'status','')<>'APPLIED'
       or nullif(v_plan_b->>'new_session_id','') is null then
      raise exception 'QA_PLAN_B_BEFORE_START_NOT_APPLIED: %',v_plan_b;
    end if;

    v_active_session_id := (v_plan_b->>'new_session_id')::uuid;

    if v_active_session_id=v_source_session_id then
      raise exception 'QA_PLAN_B_DID_NOT_REPLACE_SESSION';
    end if;

    select status into v_source_status
    from public.workout_sessions
    where id=v_source_session_id and user_id=p_user_id;

    select
      status,
      planned_environment_code,
      planned_surface_code,
      target_region,
      jsonb_build_object(
        'focus',focus,
        'duration_minutes',duration_minutes,
        'readiness',readiness,
        'target_region',target_region,
        'progression_intent',progression_intent,
        'injured_zones',coalesce(to_jsonb(injured_zones),'[]'::jsonb),
        'available_equipment',coalesce(to_jsonb(available_equipment),'[]'::jsonb),
        'planned_surface_code',planned_surface_code,
        'planned_environment_code',planned_environment_code
      )
    into v_active_status,v_active_env,v_active_surface,v_active_target_region,v_checkin_after
    from public.workout_sessions
    where id=v_active_session_id and user_id=p_user_id;

    if v_source_status<>'abandoned' then
      raise exception 'QA_PLAN_B_SOURCE_NOT_ABANDONED: %',v_source_status;
    end if;
    if v_active_status<>'generated' then
      raise exception 'QA_PLAN_B_REPLACEMENT_NOT_GENERATED: %',v_active_status;
    end if;
    if upper(coalesce(v_active_env,''))<>v_env then
      raise exception 'QA_PLAN_B_ENVIRONMENT_DRIFT: expected %, got %',v_env,v_active_env;
    end if;
    if v_checkin_before is distinct from v_checkin_after then
      raise exception 'QA_PLAN_B_CHECKIN_DRIFT: before=% after=%',v_checkin_before,v_checkin_after;
    end if;
    if coalesce((v_plan_b#>>'{difference,meaningfully_different}')::boolean,
                (v_plan_b->>'meaningfully_different')::boolean,
                false) is not true then
      raise exception 'QA_PLAN_B_NOT_MEANINGFULLY_DIFFERENT: %',v_plan_b;
    end if;

    v_checks := v_checks || jsonb_build_object(
      'plan_b_before_start',jsonb_build_object(
        'pass',true,
        'old_session_id',v_source_session_id,
        'new_session_id',v_active_session_id,
        'old_session_status',v_source_status,
        'new_session_status',v_active_status,
        'environment_preserved',true,
        'checkin_preserved',true,
        'meaningfully_different',true
      )
    );

    -- Explicit session start.
    v_stage := 'START_SESSION';
    v_start := public.e_mark_session_started(v_active_session_id,v_anchor);
    if coalesce(v_start->>'status','')<>'IN_PROGRESS' then
      raise exception 'QA_SESSION_START_FAILED: %',v_start;
    end if;

    select status,planned_environment_code,planned_surface_code,target_region
    into v_active_status,v_after_env,v_after_surface,v_after_target_region
    from public.workout_sessions
    where id=v_active_session_id and user_id=p_user_id;

    if v_active_status<>'in_progress' or upper(coalesce(v_after_env,''))<>v_env then
      raise exception 'QA_SESSION_START_IDENTITY_FAILED';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'session_start',jsonb_build_object(
        'pass',true,
        'status',v_active_status,
        'environment_preserved',true
      )
    );

    -- Plan B must close immediately after explicit start.
    v_stage := 'PLAN_B_AFTER_START';
    v_plan_b_after_start := public.change_workout_session_plan_fast_v3(
      p_user_id,v_active_session_id
    );

    if coalesce(v_plan_b_after_start->>'status','')<>'NOT_AVAILABLE'
       or coalesce(v_plan_b_after_start->>'reason','')<>'SESSION_PLAN_B_ONLY_BEFORE_SESSION_START' then
      raise exception 'QA_PLAN_B_AFTER_START_NOT_BLOCKED: %',v_plan_b_after_start;
    end if;

    v_checks := v_checks || jsonb_build_object(
      'plan_b_after_start',jsonb_build_object('pass',true,'blocked',true)
    );

    -- WOD execution remains forbidden until both reveal and WOD start.
    v_stage := 'WOD_EXECUTION_GUARD_BEFORE_REVEAL';
    select id into v_wod_wse_id
    from public.workout_session_exercises
    where session_id=v_active_session_id and lower(coalesce(block_key,''))='wod'
    order by position,id
    limit 1;

    if v_wod_wse_id is null then
      raise exception 'QA_NO_WOD_INSTANCE';
    end if;

    v_guard_wod_before_start := false;
    begin
      update public.workout_session_exercises
      set status='completed',
          user_execution_status='completed',
          updated_at=now()
      where id=v_wod_wse_id;
    exception when others then
      v_guard_wod_before_start := position('WOD execution requires WOD reveal and WOD start' in sqlerrm)>0;
    end;

    if not v_guard_wod_before_start then
      raise exception 'QA_WOD_EXECUTION_GUARD_FAILED';
    end if;

    -- Mark one visible, non-WOD exercise as actually completed. This row becomes
    -- the protected-progress fixture for the fatigue adaptation.
    v_stage := 'PROTECTED_PROGRESS_FIXTURE';
    select id into v_protected_wse_id
    from public.workout_session_exercises
    where session_id=v_active_session_id
      and lower(coalesce(block_key,''))<>'wod'
    order by
      case lower(coalesce(block_key,''))
        when 'skill' then 0
        when 'tabata' then 1
        when 'warm_up' then 2
        when 'unlock' then 3
        else 9
      end,
      position,id
    limit 1;

    if v_protected_wse_id is null then
      raise exception 'QA_NO_NON_WOD_PROGRESS_FIXTURE';
    end if;

    update public.workout_session_exercises
    set status='completed',
        user_execution_status='completed',
        rpe=5,
        updated_at=now()
    where id=v_protected_wse_id;

    select jsonb_build_object(
      'id',id,
      'exercise_id',exercise_id,
      'exercise_name',exercise_name,
      'prescription',prescription,
      'prescription_json',prescription_json,
      'status',status,
      'user_execution_status',user_execution_status,
      'reps_completed',reps_completed,
      'weight_kg',weight_kg,
      'duration_seconds',duration_seconds,
      'distance_meters',distance_meters,
      'rpe',rpe,
      'actual_attempts_json',actual_attempts_json
    )
    into v_protected_before
    from public.workout_session_exercises
    where id=v_protected_wse_id;

    -- Exercise-level Adapter / swap: first try visible non-WOD work.
    v_stage := 'SWAP_VISIBLE_EXERCISE';
    v_swap_done := false;

    for r in
      select
        wse.id,
        wse.block_key,
        wse.solver_decision_json->>'module_code' as module_code
      from public.workout_session_exercises wse
      where wse.session_id=v_active_session_id
        and wse.id<>v_protected_wse_id
        and lower(coalesce(wse.block_key,''))<>'wod'
        and coalesce(wse.user_execution_status,'pending')='pending'
      order by position,id
    loop
      v_swap_availability := public.get_workout_swap_availability_for_exercise_v1(r.id);

      v_direction := case
        when coalesce((v_swap_availability#>>'{item,directions,equivalent,available}')::boolean,false) then 'equivalent'
        when coalesce((v_swap_availability#>>'{item,directions,easier,available}')::boolean,false) then 'easier'
        when coalesce((v_swap_availability#>>'{item,directions,harder,available}')::boolean,false) then 'harder'
        else null
      end;

      if v_direction is null then
        continue;
      end if;

      v_swap := public.c4_swap_session_exercise_v3(
        p_user_id,r.id,v_direction,'{}'::text[],false
      );

      if coalesce(v_swap->>'status','')='APPLIED'
         and coalesce((v_swap->>'mutated')::boolean,false) then
        v_swap_done := true;
        v_swap_wse_id := r.id;
        v_swap_phase := 'VISIBLE_NON_WOD';
        exit;
      end if;
    end loop;

    -- Global fatigue adaptation must stay on the same session and preserve
    -- every already-realized row.
    v_stage := 'FATIGUE_ADAPTATION';
    select count(*) into v_anchor_session_count_before_adapt
    from public.workout_sessions
    where user_id=p_user_id and generation_local_date=v_anchor;

    v_adapt := public.adapt_started_session_v2(
      v_active_session_id,
      'MORE_FATIGUED',
      jsonb_build_object(
        'session_exercise_ids',jsonb_build_array(v_protected_wse_id::text),
        'validated_blocks','[]'::jsonb,
        'active_session_exercise_id',v_protected_wse_id::text
      )
    );

    if coalesce(v_adapt->>'status','') not in ('ADAPTED','NO_SAFE_CHANGE') then
      raise exception 'QA_FATIGUE_ADAPTATION_FAILED: %',v_adapt;
    end if;
    if nullif(v_adapt->>'session_id','')::uuid is distinct from v_active_session_id
       or coalesce((v_adapt->>'same_session')::boolean,false) is not true
       or coalesce((v_adapt->>'new_session_created')::boolean,true) is not false
       or coalesce((v_adapt->>'debt_created')::boolean,true) is not false then
      raise exception 'QA_FATIGUE_ADAPTATION_IDENTITY_FAILED: %',v_adapt;
    end if;

    select count(*) into v_anchor_session_count_after_adapt
    from public.workout_sessions
    where user_id=p_user_id and generation_local_date=v_anchor;

    if v_anchor_session_count_after_adapt<>v_anchor_session_count_before_adapt then
      raise exception 'QA_FATIGUE_ADAPTATION_CREATED_SESSION';
    end if;

    select jsonb_build_object(
      'id',id,
      'exercise_id',exercise_id,
      'exercise_name',exercise_name,
      'prescription',prescription,
      'prescription_json',prescription_json,
      'status',status,
      'user_execution_status',user_execution_status,
      'reps_completed',reps_completed,
      'weight_kg',weight_kg,
      'duration_seconds',duration_seconds,
      'distance_meters',distance_meters,
      'rpe',rpe,
      'actual_attempts_json',actual_attempts_json
    )
    into v_protected_after
    from public.workout_session_exercises
    where id=v_protected_wse_id;

    if v_protected_after is distinct from v_protected_before then
      raise exception 'QA_FATIGUE_ADAPTATION_CHANGED_PROTECTED_PROGRESS: before=% after=%',
        v_protected_before,v_protected_after;
    end if;

    select planned_environment_code,planned_surface_code,target_region
    into v_after_env,v_after_surface,v_after_target_region
    from public.workout_sessions
    where id=v_active_session_id;

    if upper(coalesce(v_after_env,''))<>v_env then
      raise exception 'QA_ADAPTER_ENVIRONMENT_DRIFT';
    end if;
    if v_env='OUTDOOR' and v_after_surface is distinct from v_active_surface then
      raise exception 'QA_ADAPTER_OUTDOOR_SURFACE_DRIFT';
    end if;
    if v_env='GYM' and v_after_target_region is distinct from v_active_target_region then
      raise exception 'QA_ADAPTER_GYM_TARGET_REGION_DRIFT';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'adapter_fatigue',jsonb_build_object(
        'pass',true,
        'status',v_adapt->>'status',
        'same_session',true,
        'protected_progress_preserved',true,
        'environment_preserved',true,
        'focus_preserved',case when v_env='GYM' then true else null end,
        'terrain_preserved',case when v_env='OUTDOOR' then true else null end
      )
    );

    -- The WOD is still hidden at this stage.
    v_stage := 'WOD_HIDDEN';
    if exists(
      select 1 from public.workout_sessions
      where id=v_active_session_id and wod_revealed_at is not null
    ) then
      raise exception 'QA_WOD_REVEALED_TOO_EARLY';
    end if;

    v_wod_start_before_reveal := public.mark_wod_started(v_active_session_id);
    if coalesce(v_wod_start_before_reveal->>'status','')<>'WOD_NOT_REVEALED' then
      raise exception 'QA_WOD_START_BEFORE_REVEAL_NOT_BLOCKED: %',v_wod_start_before_reveal;
    end if;

    v_checks := v_checks || jsonb_build_object(
      'wod_hidden_before_reveal',jsonb_build_object(
        'pass',true,
        'wod_revealed_at',null,
        'wod_start_blocked',true
      )
    );

    v_stage := 'WOD_REVEAL';
    v_reveal := public.mark_wod_revealed(v_active_session_id);
    if coalesce(v_reveal->>'status','')<>'WOD_REVEALED' then
      raise exception 'QA_WOD_REVEAL_FAILED: %',v_reveal;
    end if;

    -- If no visible pre-WOD row had a safe swap, try a revealed WOD row before
    -- starting the WOD. This mirrors the UI timing contract.
    if not v_swap_done then
      v_stage := 'SWAP_REVEALED_WOD';

      for r in
        select
          wse.id,
          wse.block_key,
          wse.solver_decision_json->>'module_code' as module_code
        from public.workout_session_exercises wse
        where wse.session_id=v_active_session_id
          and lower(coalesce(wse.block_key,''))='wod'
          and coalesce(wse.user_execution_status,'pending')='pending'
        order by position,id
      loop
        v_swap_availability := public.get_workout_swap_availability_for_exercise_v1(r.id);

        v_direction := case
          when coalesce((v_swap_availability#>>'{item,directions,equivalent,available}')::boolean,false) then 'equivalent'
          when coalesce((v_swap_availability#>>'{item,directions,easier,available}')::boolean,false) then 'easier'
          when coalesce((v_swap_availability#>>'{item,directions,harder,available}')::boolean,false) then 'harder'
          else null
        end;

        if v_direction is null then
          continue;
        end if;

        v_module := upper(coalesce(r.module_code,''));

        if v_env='GYM' and v_module='STRENGTH' then
          v_swap := public.gym_swap_session_exercise_v1(
            p_user_id,r.id,v_direction,'{}'::text[],false
          );
        else
          v_swap := public.c4_swap_session_exercise_v3(
            p_user_id,r.id,v_direction,'{}'::text[],false
          );
        end if;

        if coalesce(v_swap->>'status','')='APPLIED'
           and coalesce((v_swap->>'mutated')::boolean,false) then
          v_swap_done := true;
          v_swap_wse_id := r.id;
          v_swap_phase := 'REVEALED_WOD';
          exit;
        end if;
      end loop;
    end if;

    if not v_swap_done then
      raise exception 'QA_NO_SAFE_SWAP_FIXTURE_AVAILABLE';
    end if;

    if nullif(v_swap->>'session_id','')::uuid is distinct from v_active_session_id then
      raise exception 'QA_SWAP_CHANGED_SESSION: %',v_swap;
    end if;

    select planned_environment_code into v_after_env
    from public.workout_sessions where id=v_active_session_id;
    if upper(coalesce(v_after_env,''))<>v_env then
      raise exception 'QA_SWAP_ENVIRONMENT_DRIFT';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'exercise_swap',jsonb_build_object(
        'pass',true,
        'session_exercise_id',v_swap_wse_id,
        'direction',v_direction,
        'phase',v_swap_phase,
        'same_session',true,
        'environment_preserved',true
      )
    );

    v_stage := 'WOD_START';
    v_wod_start := public.mark_wod_started(v_active_session_id);
    if coalesce(v_wod_start->>'status','')<>'WOD_STARTED' then
      raise exception 'QA_WOD_START_FAILED: %',v_wod_start;
    end if;

    -- Realize one WOD exercise after the WOD officially starts.
    select wse.id into v_wod_wse_id
    from public.workout_session_exercises wse
    where wse.session_id=v_active_session_id
      and lower(coalesce(wse.block_key,''))='wod'
    order by wse.position,wse.id
    limit 1;

    update public.workout_session_exercises wse
    set status='completed',
        user_execution_status='completed',
        reps_completed=case
          when 'reps'=any(coalesce(e.tracking_modes,'{}'::text[])) then 1
          else null
        end,
        duration_seconds=case
          when 'time'=any(coalesce(e.tracking_modes,'{}'::text[])) then 30
          else null
        end,
        distance_meters=case
          when 'distance'=any(coalesce(e.tracking_modes,'{}'::text[])) then 50
          else null
        end,
        rpe=6,
        updated_at=now()
    from public.exercises e
    where wse.id=v_wod_wse_id and e.id=wse.exercise_id;

    -- Once the WOD started, the fatigue adapter must protect every WOD row.
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'exercise_id',exercise_id,
        'prescription',prescription,
        'prescription_json',prescription_json,
        'status',status,
        'user_execution_status',user_execution_status,
        'reps_completed',reps_completed,
        'weight_kg',weight_kg,
        'duration_seconds',duration_seconds,
        'distance_meters',distance_meters,
        'rpe',rpe,
        'actual_attempts_json',actual_attempts_json
      )
      order by id
    ),'[]'::jsonb)
    into v_wod_before_second_adapt
    from public.workout_session_exercises
    where session_id=v_active_session_id and lower(coalesce(block_key,''))='wod';

    v_stage := 'POST_WOD_START_ADAPTATION_PROTECTION';
    v_adapt_after_wod := public.adapt_started_session_v2(
      v_active_session_id,
      'MORE_FATIGUED',
      '{}'::jsonb
    );

    if coalesce(v_adapt_after_wod->>'status','') not in ('ADAPTED','NO_SAFE_CHANGE') then
      raise exception 'QA_POST_WOD_ADAPTATION_FAILED: %',v_adapt_after_wod;
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'exercise_id',exercise_id,
        'prescription',prescription,
        'prescription_json',prescription_json,
        'status',status,
        'user_execution_status',user_execution_status,
        'reps_completed',reps_completed,
        'weight_kg',weight_kg,
        'duration_seconds',duration_seconds,
        'distance_meters',distance_meters,
        'rpe',rpe,
        'actual_attempts_json',actual_attempts_json
      )
      order by id
    ),'[]'::jsonb)
    into v_wod_after_second_adapt
    from public.workout_session_exercises
    where session_id=v_active_session_id and lower(coalesce(block_key,''))='wod';

    if v_wod_after_second_adapt is distinct from v_wod_before_second_adapt then
      raise exception 'QA_POST_WOD_ADAPTER_CHANGED_WOD_PROGRESS';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'wod_lifecycle',jsonb_build_object(
        'pass',true,
        'revealed',true,
        'started',true,
        'wod_execution_before_start_blocked',v_guard_wod_before_start,
        'post_start_wod_progress_protected',true
      )
    );

    -- Completion through the real V3 contract.
    v_stage := 'COMPLETION';
    select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'session_exercise_id',wse.id,
        'exercise_id',wse.exercise_id,
        'status',case
          when coalesce(wse.user_execution_status,'pending')='completed' then 'completed'
          else 'skipped'
        end,
        'user_execution_status',case
          when coalesce(wse.user_execution_status,'pending')='completed' then 'completed'
          else 'not_completed'
        end,
        'reps_completed',case
          when coalesce(wse.user_execution_status,'pending')='completed'
               and 'reps'=any(coalesce(e.tracking_modes,'{}'::text[]))
            then coalesce(wse.reps_completed,1)
          else null
        end,
        'weight_kg',case
          when coalesce(wse.user_execution_status,'pending')='completed'
               and 'load'=any(coalesce(e.tracking_modes,'{}'::text[]))
            then wse.weight_kg
          else null
        end,
        'duration_seconds',case
          when coalesce(wse.user_execution_status,'pending')='completed'
               and 'time'=any(coalesce(e.tracking_modes,'{}'::text[]))
            then coalesce(wse.duration_seconds,30)
          else null
        end,
        'distance_meters',case
          when coalesce(wse.user_execution_status,'pending')='completed'
               and 'distance'=any(coalesce(e.tracking_modes,'{}'::text[]))
            then coalesce(wse.distance_meters,50)
          else null
        end,
        'rpe',case
          when coalesce(wse.user_execution_status,'pending')='completed'
            then coalesce(wse.rpe,6)
          else null
        end,
        'actual_attempts',wse.actual_attempts_json
      ))
      order by wse.block_key,wse.position,wse.id
    ),'[]'::jsonb)
    into v_completion_payload
    from public.workout_session_exercises wse
    join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=v_active_session_id;

    v_completion := public.complete_workout_session_v3(
      v_active_session_id,
      6,
      3,
      'QA mutation lifecycle rollback',
      v_completion_payload,
      null,
      v_env,
      v_surface,
      v_equipment,
      null
    );

    select status,planned_environment_code,planned_surface_code,target_region
    into v_active_status,v_after_env,v_after_surface,v_after_target_region
    from public.workout_sessions
    where id=v_active_session_id and user_id=p_user_id;

    if v_active_status<>'completed' then
      raise exception 'QA_COMPLETION_NOT_CLOSED: % / %',v_active_status,v_completion;
    end if;
    if upper(coalesce(v_after_env,''))<>v_env then
      raise exception 'QA_COMPLETION_ENVIRONMENT_DRIFT';
    end if;
    if v_env='OUTDOOR' and v_after_surface is distinct from v_active_surface then
      raise exception 'QA_COMPLETION_OUTDOOR_SURFACE_DRIFT';
    end if;
    if v_env='GYM' and v_after_target_region is distinct from v_active_target_region then
      raise exception 'QA_COMPLETION_GYM_TARGET_REGION_DRIFT';
    end if;
    if public.session_counts_as_training_v1(v_active_session_id) is not true then
      raise exception 'QA_COMPLETED_SESSION_DOES_NOT_COUNT_AS_TRAINING';
    end if;

    v_checks := v_checks || jsonb_build_object(
      'completion',jsonb_build_object(
        'pass',true,
        'status',v_active_status,
        'counts_as_training',true,
        'environment_preserved',true,
        'focus_preserved',case when v_env='GYM' then true else null end,
        'terrain_preserved',case when v_env='OUTDOOR' then true else null end
      )
    );

    v_stage := 'FORCED_ROLLBACK';
    raise exception 'QA_FORCE_ROLLBACK';
  exception when others then
    if sqlerrm='QA_FORCE_ROLLBACK' then
      v_forced_rollback := true;
    else
      v_error := sqlerrm;
    end if;
  end;

  select count(*) into v_sessions_after
  from public.workout_sessions where user_id=p_user_id;

  select count(*) into v_swaps_after
  from public.workout_session_swap_history where user_id=p_user_id;

  select count(*) into v_prefs_after
  from public.user_skill_session_preferences where user_id=p_user_id;

  select count(*) into v_logs_after
  from public.exercise_logs where user_id=p_user_id;

  return jsonb_build_object(
    'version','qa-session-mutation-lifecycle-v1',
    'environment_code',v_env,
    'anchor_date',v_anchor,
    'pass',
      v_error is null
      and v_forced_rollback
      and v_sessions_after=v_sessions_before
      and v_swaps_after=v_swaps_before
      and v_prefs_after=v_prefs_before
      and v_logs_after=v_logs_before,
    'status',case
      when v_error is not null then 'FAIL'
      when not v_forced_rollback then 'ROLLBACK_NOT_CONFIRMED'
      when v_sessions_after<>v_sessions_before
        or v_swaps_after<>v_swaps_before
        or v_prefs_after<>v_prefs_before
        or v_logs_after<>v_logs_before then 'ROLLBACK_DIRTY'
      else 'PASS'
    end,
    'failed_stage',case when v_error is null then null else v_stage end,
    'error',v_error,
    'forced_rollback',v_forced_rollback,
    'rollback_clean',jsonb_build_object(
      'sessions',v_sessions_after=v_sessions_before,
      'swap_history',v_swaps_after=v_swaps_before,
      'skill_preferences',v_prefs_after=v_prefs_before,
      'exercise_logs',v_logs_after=v_logs_before
    ),
    'checks',v_checks
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.qa_session_mutation_matrix_v1(p_user_id uuid, p_anchor_date date DEFAULT (CURRENT_DATE + 45))
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '420s'
AS $function$
declare
  v_home jsonb;
  v_box jsonb;
  v_gym jsonb;
  v_outdoor jsonb;
begin
  v_home := public.qa_session_mutation_lifecycle_v1(p_user_id,'HOME',p_anchor_date);
  v_box := public.qa_session_mutation_lifecycle_v1(p_user_id,'BOX',p_anchor_date);
  v_gym := public.qa_session_mutation_lifecycle_v1(p_user_id,'GYM',p_anchor_date);
  v_outdoor := public.qa_session_mutation_lifecycle_v1(p_user_id,'OUTDOOR',p_anchor_date);

  return jsonb_build_object(
    'version','qa-session-mutation-matrix-v1',
    'pass',
      coalesce((v_home->>'pass')::boolean,false)
      and coalesce((v_box->>'pass')::boolean,false)
      and coalesce((v_gym->>'pass')::boolean,false)
      and coalesce((v_outdoor->>'pass')::boolean,false),
    'environments',jsonb_build_object(
      'HOME',v_home,
      'BOX',v_box,
      'GYM',v_gym,
      'OUTDOOR',v_outdoor
    )
  );
end;
$function$

revoke all on function public.qa_session_mutation_lifecycle_v1(uuid,text,date) from public;
revoke all on function public.qa_session_mutation_lifecycle_v1(uuid,text,date) from anon;
revoke all on function public.qa_session_mutation_lifecycle_v1(uuid,text,date) from authenticated;

revoke all on function public.qa_session_mutation_matrix_v1(uuid,date) from public;
revoke all on function public.qa_session_mutation_matrix_v1(uuid,date) from anon;
revoke all on function public.qa_session_mutation_matrix_v1(uuid,date) from authenticated;
