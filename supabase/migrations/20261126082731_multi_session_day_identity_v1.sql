-- Explicit multi-session creation with retry identity; never choose a draft arbitrarily.
CREATE OR REPLACE FUNCTION public.week_compile_composer_day_j_v1(p_user_id uuid, p_plan_item_id uuid, p_local_date date, p_readiness integer, p_pain_zones text[], p_available_equipment text[], p_environment_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb; v_program_preview jsonb;
  v_blocks jsonb;
  v_b jsonb;
  v_e jsonb;
  v_ex public.exercises%rowtype;
  v_inventory jsonb;
  v_mechanic text;
  v_env text;
  v_focus text;
  v_region text;
  v_intent text;
  v_duration integer;
  v_minutes integer;
  v_wod_minutes integer;
  v_total_minutes integer := 0;
  v_count integer;
  v_cycles integer;
  v_sets integer;
  v_rounds integer;
  v_rest integer;
  v_reps integer;
  v_reps_max integer;
  v_work integer;
  v_work_seconds integer;
  v_estimated_round_seconds integer;
  v_block_key text;
  v_type text;
  v_pres jsonb;
  v_solver jsonb;
  v_strength_plan jsonb;
  v_wod_plan jsonb;
  v_deck_plan jsonb;
  v_deck_caps numeric[];
  v_shared_wod boolean;
  v_skill_plan jsonb;
  v_cardio_plan jsonb;
  v_params jsonb;
  v_ejson jsonb;
  v_out_blocks jsonb := '[]'::jsonb;
  v_out_exercises jsonb;
  v_ids text[] := '{}';
  v_block_ids text[] := '{}';
  v_keys text[] := '{}';
  v_id text;
  v_session_id uuid;
  v_exercise_instance_id uuid;
  v_active uuid;
  v_existing_status text;
  v_existing_source text;
  v_block_idx integer := 0;
  v_item_idx integer;
  v_wod_mechanic text;
  v_wod_params jsonb;
  v_pres_text text;
  v_rep_time integer;
  v_max_station integer;
  v_ctx jsonb;
  v_result jsonb;
  v_expected_stimulus jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_user_id is null or p_plan_item_id is null or p_local_date is null then
    raise exception 'Missing Composer identity/date';
  end if;
  if p_readiness is null or p_readiness not between 1 and 10 then
    raise exception 'READINESS_REQUIRED';
  end if;
  if p_pain_zones is null or cardinality(p_pain_zones)=0 then
    raise exception 'PAIN_CHECK_REQUIRED';
  end if;
  if p_available_equipment is null then
    raise exception 'EQUIPMENT_CONFIRMATION_REQUIRED';
  end if;
  if p_local_date < current_date-1 or p_local_date > current_date+1 then
    raise exception 'DAY_J_ONLY';
  end if;

  -- Serialize same-day Composer and standard generation.
  perform pg_advisory_xact_lock(hashtextextended('ugerod:environment-generation:'||p_user_id::text||':'||p_local_date::text,0));
  perform pg_advisory_xact_lock(hashtextextended('ugerod:adaptive-generation:'||p_user_id::text||':'||p_local_date::text,0));
  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;
  if not found or v_item.recommended_date is distinct from p_local_date then
    raise exception 'COMPOSER_DAY_MISMATCH';
  end if;
  if v_item.session_id is not null then
    select status,planning_context_json->>'session_source'
      into v_existing_status,v_existing_source
    from public.workout_sessions
    where id=v_item.session_id and user_id=p_user_id;
    if v_existing_source='W11_COMPOSER_DAY_J' then
      return jsonb_build_object('status','ALREADY_READY','session_id',v_item.session_id,
        'session_status',v_existing_status,'plan_item_id',v_item.id,'idempotent',true);
    end if;
    raise exception 'PLAN_ITEM_ALREADY_BOUND_TO_ANOTHER_SESSION';
  end if;
  if v_item.status not in ('available','claimed') then
    raise exception 'PLAN_ITEM_NOT_EDITABLE';
  end if;
  select id into v_active from public.workout_sessions
  where user_id=p_user_id and generation_local_date=p_local_date and status in ('generated','in_progress')
  order by generated_at desc limit 1;
  if v_active is not null then
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',v_active,
      'plan_item_id',v_item.id,'idempotent',false);
  end if;

  v_draft:=v_item.planning_context_json #> '{w11,composer_draft}';
  if jsonb_typeof(v_draft)<>'object' or coalesce(v_draft->>'version','')<>'w11-composer-draft-v1' then
    raise exception 'COMPOSER_DRAFT_NOT_FOUND';
  end if;
  if coalesce((v_draft->>'structure_stable')::boolean,false)<>true then
    raise exception 'UNSTABLE_COMPOSITION';
  end if;
  v_shared_wod:=coalesce(v_draft->>'wod_engine_version','')='C4_COMPOSER_V2';
  v_blocks:=v_draft #> '{architecture,blocks}';
  if jsonb_typeof(v_blocks)<>'array' or jsonb_array_length(v_blocks) not between 1 and 6 then
    raise exception 'COMPOSER_BLOCKS_INVALID';
  end if;
  v_duration:=nullif(v_draft->>'duration_minutes','')::integer;
  if v_duration is null or v_duration not between 15 and 180 then
    raise exception 'COMPOSER_DURATION_INVALID';
  end if;
  v_env:=upper(coalesce(v_draft->>'environment_code',''));
  if v_env not in ('HOME','BOX','GYM','OUTDOOR')
     or v_env<>upper(coalesce(p_environment_code,'')) then
    raise exception 'ENVIRONMENT_CHANGED_REQUIRES_RECOMPOSITION';
  end if;
  -- Outdoor needs the same explicit terrain gate as the standard generator.
  if v_env='OUTDOOR' and nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','') is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED';
  end if;
  v_region:=nullif(v_draft->>'target_region','');
  v_focus:=coalesce(nullif(v_draft#>>'{intent,focus}',''),'General Fitness');
  v_intent:=coalesce(nullif(v_item.planned_progression_intent,''),'MAINTAIN');
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,p_available_equipment,'c4-final-default');
  v_mechanic:=upper(coalesce(v_draft#>>'{mechanic,key}',''));
  IF v_draft->>'personal_program_version'='PERSONAL_PROGRAM_V1' THEN v_program_preview:=public.week_personal_program_preview_v1(p_user_id,v_draft,p_available_equipment); END IF;
  if exists(select 1 from jsonb_array_elements(v_blocks) b where upper(b->>'type')='WOD') then
    if not v_shared_wod and (v_mechanic not in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
       or not exists(select 1 from public.workout_mechanics m where m.mechanic_key=v_mechanic
          and m.active and m.mechanic_kind='core' and m.manual_free_eligible)) then
      raise exception 'COMPOSER_MECHANIC_NOT_EXECUTABLE_%',v_mechanic;
    end if;
  end if;

  -- Preflight the entire user-selected structure before creating anything.
  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_ids:='{}'; -- separate uniqueness per authored block
    v_type:=upper(coalesce(v_b->>'type',''));
    IF v_type<>'WOD' AND coalesce(v_b->'manual_parameters','{}')<>'{}' THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;
    IF (v_type NOT IN ('SKILL','STRENGTH','WOD') OR (v_type='SKILL' AND public.week_composer_preferences_v1(v_draft)->>'skill_target_path_key' IS NOT NULL) OR (v_type='WOD' AND NOT v_shared_wod))
      AND (coalesce(v_b->'manual_parameters','{}')<>'{}' OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_b->'exercises') q WHERE coalesce(q->'manual_dose','{}')<>'{}'))
    THEN RAISE EXCEPTION 'COMPOSER_MANUAL_UNSUPPORTED_BLOCK'; END IF;
    if v_type not in ('WARMUP','TABATA','STRENGTH','SKILL','WOD','CARDIO') then
      raise exception 'COMPOSER_UNSUPPORTED_BLOCK_%',v_type;
    end if;
    if v_type=any(v_keys) then raise exception 'COMPOSER_DUPLICATE_BLOCK_%',v_type; end if;
    v_keys:=array_append(v_keys,v_type);
    v_minutes:=nullif(v_b->>'minutes','')::integer;
    if v_minutes is null or v_minutes<2 or v_minutes>90 then
      raise exception 'COMPOSER_INVALID_BLOCK_DURATION_%',v_type;
    end if;
    if v_type='TABATA' and v_minutes<>4 then
      raise exception 'TABATA_MUST_BE_4_MINUTES';
    end if;
    v_total_minutes:=v_total_minutes+v_minutes;
    if jsonb_typeof(v_b->'exercises')<>'array' or jsonb_array_length(v_b->'exercises')=0
       or jsonb_array_length(v_b->'exercises')>8 then
      raise exception 'COMPOSER_BLOCK_EXERCISES_INVALID_%',v_type;
    end if;
    if v_type='WOD' and v_mechanic='EMOM'
       and v_minutes<jsonb_array_length(v_b->'exercises') then
      raise exception 'EMOM_TOO_SHORT_FOR_STATIONS';
    end if;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_id:=v_e->>'id';
      if v_id is null or v_id=any(v_block_ids) then
        raise exception 'COMPOSER_DUPLICATE_OR_MISSING_EXERCISE_%',coalesce(v_id,'null');
      end if;
      v_block_ids:=array_append(v_block_ids,v_id);
      v_ids:=array_append(v_ids,v_id);
      select * into v_ex from public.exercises where id=v_id;
      if not found then raise exception 'COMPOSER_UNKNOWN_EXERCISE_%',v_id; end if;
      if not public.exercise_environment_eligible_v1(v_id,v_env)
        or not public.exercise_safe_for_zones(v_id,public.normalize_body_zone_ids(p_pain_zones))
        or not public.exercise_equipment_compatible(v_id,v_inventory) then
        raise exception 'COMPOSER_EXERCISE_INCOMPATIBLE_%',v_id;
      end if;
      if v_type='WARMUP' and not coalesce(v_ex.warmup_eligible,false) then
        raise exception 'COMPOSER_NOT_WARMUP_ELIGIBLE_%',v_id;
      end if;
      if v_type='TABATA' and not coalesce(v_ex.tabata_eligible,false) then
        raise exception 'COMPOSER_NOT_TABATA_ELIGIBLE_%',v_id;
      end if;
    end loop;
  end loop;
  if v_total_minutes>v_duration then
    raise exception 'COMPOSER_TIME_BUDGET_EXCEEDED';
  end if;

  -- Store the selected workload as an explicit user-authored expected-stimulus
  -- contract; the generic C4 target policy may not support every Composer focus.
  begin
    v_expected_stimulus:=public.build_session_stimulus_target(v_focus,v_duration,
      p_readiness::text,v_region,v_intent,'c4-final-default');
  exception when others then
    v_expected_stimulus:=jsonb_build_object(
      'stimulus_model_status','USER_AUTHORED_NOT_AUTO_DERIVED');
  end;
  v_expected_stimulus:=coalesce(v_expected_stimulus,'{}'::jsonb)||
    jsonb_build_object('source','W11_COMPOSER_DAY_J','user_authored',true,
      'focus',v_focus,'duration_minutes',v_duration,'readiness',p_readiness,
      'target_region',v_region,'progression_intent',v_intent,
      'auto_generation_used',false);

  -- A single transaction owns both the session and every exercise; any failed
  -- dose, compatibility or density check rolls everything back.
  v_session_id:=gen_random_uuid();
  insert into public.workout_sessions (
    id,user_id,status,duration_minutes,target_region,readiness,focus,
    available_equipment,injured_zones,generated_at,progression_intent,
    generated_workout,planning_context_json,expected_stimulus_json,quality_gate_json,generation_local_date,
    planned_environment_code,planned_environment_source,planned_environment_selected_at,planned_surface_code
  ) values (
    v_session_id,p_user_id,'generated',v_duration,v_region,p_readiness::text,v_focus,
    p_available_equipment,p_pain_zones,now(),v_intent,
    jsonb_build_object('version','w11-composer-player-v1','blocks','[]'::jsonb),
    jsonb_build_object('session_source','W11_COMPOSER_DAY_J','plan_item_id',v_item.id,
      'composer_draft',v_draft,'user_block_order_preserved',true,'day_j_readiness',p_readiness),
    v_expected_stimulus,
    jsonb_build_object('source','w11-composer-finalizer-v1','pass',true,
      'user_exercise_choices_preserved',true,'time_budget_minutes',v_duration),
    p_local_date,v_env,'USER_COMPOSER',now(),
    nullif(v_item.planning_context_json #>> '{w11,future_context,surface_code}','')
  );

  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_idx:=v_block_idx+1;
    v_type:=upper(v_b->>'type');
    v_minutes:=(v_b->>'minutes')::integer;
    v_count:=jsonb_array_length(v_b->'exercises');
    v_block_key:=case v_type when 'WARMUP' then 'warm_up'
      when 'TABATA' then 'tabata' when 'STRENGTH' then 'strength'
      when 'SKILL' then 'skill' else 'wod' end;
    v_params:='{}'::jsonb;
    v_rounds:=null;
    v_rest:=null;
    v_wod_minutes:=v_minutes;
    v_wod_plan:=null;
    v_skill_plan:=null;
    if v_type='CARDIO' then
      v_cardio_plan:=public.week_composer_cardio_authority_v1(p_user_id,public.week_composer_outdoor_context_v1(v_draft)||jsonb_build_object('focus',v_focus,'session_minutes',v_duration,
        'block_minutes',v_minutes,'environment_code',v_env,'equipment_names',to_jsonb(p_available_equipment),
        'pain_zones',to_jsonb(p_pain_zones),'readiness',p_readiness::text,'target_region',v_region,
        'progression_intent',v_intent,'exercises',v_b->'exercises'));
      if v_cardio_plan->>'status'<>'READY' then raise exception 'COMPOSER_CARDIO_RECOMPOSITION_REQUIRED_%',v_cardio_plan->>'reason'; end if;
      v_out_exercises:='[]'; v_item_idx:=0;
      for v_e in select value from jsonb_array_elements(v_cardio_plan#>'{block,exercises}') loop
        v_item_idx:=v_item_idx+1; v_exercise_instance_id:=gen_random_uuid();
        insert into public.workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status,expected_outcome_json,selection_provenance)
          values(v_exercise_instance_id,v_session_id,v_e->>'exercise_id',v_e->>'name','cardio',v_item_idx,
            v_e#>>'{prescription,text}',v_e->'prescription','pending','pending',v_e->'prescription','USER_SELECTED');
        v_out_exercises:=v_out_exercises||jsonb_build_array(v_e||jsonb_build_object('session_exercise_id',v_exercise_instance_id));
      end loop;
      v_out_blocks:=v_out_blocks||jsonb_build_array((v_cardio_plan->'block')||jsonb_build_object('exercises',v_out_exercises,'block_order',v_block_idx,'module_code','CARDIO','manual_selection',true));
      continue;
    end if;
    if v_type='WOD' and v_shared_wod then
      v_wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',v_draft#>>'{mechanic,variant_key}',
        'session_minutes',v_duration,'block_minutes',v_minutes,'exercises',v_b->'exercises',
        'equipment_names',to_jsonb(p_available_equipment),'environment_code',v_env,'focus',v_focus,
        'target_region',v_region,'progression_intent',v_intent,'readiness',p_readiness::text,
        'pain_zones',to_jsonb(p_pain_zones)));
      if v_wod_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_WOD_RECOMPOSITION_REQUIRED_%',v_wod_plan->>'reason';
      end if;
      v_wod_plan:=public.week_composer_manual_wod_v1(v_wod_plan,v_b);
      v_params:=v_wod_plan->'parameters';
      if v_mechanic='DECK' then
        select array_agg(public.c4_deck_exercise_rep_cap_v1(p_user_id,value->>'exercise_id',p_readiness::text,v_intent) order by ordinality)
        into v_deck_caps from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}') with ordinality;
        v_deck_plan:=public.c4_build_deck_plan_v2(v_session_id,(v_params->>'cards')::int,v_deck_caps);
        if not coalesce((v_deck_plan->>'safe')::boolean,false) then raise exception 'COMPOSER_NO_SAFE_DECK_DRAW'; end if;
        v_params:=v_params||jsonb_build_object('deck_order',v_deck_plan->'deck_order',
          'deck_order_version','deck-adaptive-order-v1','deck_suit_reps',v_deck_plan->'suit_reps',
          'deck_suit_card_counts',v_deck_plan->'suit_card_counts','deck_shuffle_attempt',v_deck_plan->'shuffle_attempt',
          'source_deck_cards',52,'without_replacement',true,'safe_random_draw',true);
      end if;
      v_sets:=null;
    elsif v_program_preview IS NOT NULL AND v_type IN ('WARMUP','STRENGTH') THEN
      SELECT value INTO v_ctx FROM jsonb_array_elements(v_program_preview->'blocks') WHERE value->>'type'=v_type;
      v_sets:=CASE WHEN v_type='WARMUP' THEN (v_ctx#>>'{exercises,0,sets}')::int ELSE NULL END;
      v_params:=jsonb_build_object('duration_minutes',v_minutes,'time',v_ctx->'time','manual_per_exercise',true,'dose_authority','PERSONAL_PROGRAM_V1')||CASE WHEN v_type='WARMUP' THEN jsonb_build_object('rounds',v_sets) ELSE '{}'::jsonb END;
    elsif v_type='WARMUP' then
      v_sets:=case when v_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then 3 when v_minutes>=6 then 2 else 1 end;
      v_params:=jsonb_build_object('rounds',v_sets);
    elsif v_type='TABATA' then
      v_sets:=1;
      v_params:=jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,
        'duration_minutes',4,'exercise_count',v_count);
    elsif v_type='STRENGTH' then
      v_strength_plan:=public.week_composer_strength_authority_v2(
        p_user_id,v_b->'exercises',v_duration,v_minutes,v_intent,
        p_available_equipment,v_focus,v_region,
        public.normalize_session_readiness(p_readiness::text),v_env
      );
      if v_strength_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_STRENGTH_RECOMPOSITION_REQUIRED_%',v_strength_plan->>'status';
      end if;
      v_sets:=(v_strength_plan->>'sets')::int;
      v_rest:=(v_strength_plan->>'rest_seconds')::int;
      v_params:=jsonb_build_object(
        'sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes,
        'dose_authority',v_strength_plan->>'source','time',v_strength_plan->'time'
      );
    elsif v_type='SKILL' then
      if v_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then
        v_skill_plan:=public.week_composer_skill_authority_v1(p_user_id,
          public.week_composer_skill_context_v1(v_draft,v_b,p_available_equipment,p_pain_zones,p_readiness::text));
        if v_skill_plan->>'status'<>'READY' then
          raise exception 'COMPOSER_SKILL_RECOMPOSITION_REQUIRED_%',v_skill_plan->>'reason';
        end if;
        v_sets:=null;
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'dose_authority',v_skill_plan->>'source','time',v_skill_plan->'time');
      else
        v_sets:=case when v_minutes>=15 then 3 else 2 end;
        v_rest:=60;
        v_params:=jsonb_build_object('sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes);
      end if;
    else
      v_sets:=null;
      if v_mechanic='EMOM' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('duration_minutes',v_wod_minutes,
          'cycles',v_cycles,'station_seconds',60,'exercise_count',v_count,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      elsif v_mechanic='AMRAP' then
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'exercise_count',v_count);
      elsif v_mechanic='FOR_TIME' then
        v_rounds:=greatest(1,least(5,floor(v_minutes::numeric/4)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'time_cap_minutes',v_minutes,
          'cap_seconds',v_minutes*60);
      elsif v_mechanic='CIRCUIT' then
        v_rounds:=greatest(2,least(4,floor(v_minutes::numeric/5)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'rest_seconds',45,'rest_between_rounds_seconds',45,
          'duration_minutes',v_minutes);
      elsif v_mechanic='HIIT' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        if v_cycles<2 then raise exception 'HIIT_TOO_SHORT_FOR_STATIONS'; end if;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('rounds',v_cycles,'exercise_count',v_count,
          'work_seconds',40,'rest_seconds',20,'duration_minutes',v_wod_minutes,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      end if;
    end if;
    v_estimated_round_seconds:=0;
    v_out_exercises:='[]'::jsonb;
    v_item_idx:=0;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_item_idx:=v_item_idx+1;
      v_id:=v_e->>'id';
      select * into v_ex from public.exercises where id=v_id;
      if v_program_preview IS NOT NULL then
        SELECT ex->'prescription_json' INTO v_pres FROM jsonb_array_elements(v_program_preview->'blocks') z CROSS JOIN LATERAL jsonb_array_elements(z->'exercises') ex WHERE z->>'type'=v_type AND ex->>'id'=v_id;
        IF v_pres IS NULL THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_DOSE_MISSING'; END IF;
        v_solver:=v_pres;
      elsif v_skill_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_skill_plan->'exercises')
          where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_SKILL_DOSE_MISSING'; end if;
        v_solver:=v_pres;
      elsif v_wod_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}')
        where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_WOD_DOSE_MISSING'; end if;
        v_pres:=v_pres||jsonb_build_object('block_parameters',v_params);
        v_solver:=v_pres;
      else
      if v_type='STRENGTH' then
        select value->'solver_reference' into v_solver
        from jsonb_array_elements(v_strength_plan->'exercises') value
        where value->>'id'=v_id limit 1;
      else
        v_solver:=public.c2_solver_prescription(p_user_id,v_id,'{}'::jsonb,
          case when v_type='WARMUP' then 'WARMUP'
            when v_type='TABATA' then 'TABATA'
            when v_type='SKILL' then 'STRENGTH'
            else v_mechanic end,v_intent,v_inventory);
      end if;
      if jsonb_typeof(v_solver)<>'object' then raise exception 'COMPOSER_DOSE_UNAVAILABLE_%',v_id; end if;
      v_reps:=case when jsonb_typeof(v_solver->'reps_min')='number'
        then (v_solver->>'reps_min')::integer else null end;
      v_reps_max:=case when jsonb_typeof(v_solver->'reps_max')='number'
        then (v_solver->>'reps_max')::integer else null end;
      v_reps:=coalesce(v_reps,v_reps_max);
      v_pres:=jsonb_build_object('source','w11_composer_day_j_v1','finalized',true,
        'tracking_modes',coalesce(to_jsonb(v_ex.tracking_modes),'[]'::jsonb),
        'target_rpe_min',v_solver->'target_rpe_min','target_rpe_max',v_solver->'target_rpe_max',
        'solver_reference',v_solver,'duration_budget_minutes',v_minutes);
      if v_type='TABATA' then
        v_pres:=v_pres||jsonb_build_object('mechanic','TABATA','protocol',
          jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
          'duration_seconds',20,'text','20 s effort / 10 s récupération · 4 cycles par mouvement');
      elsif v_reps is not null and v_reps>0 then
        -- Strength doses are owned by C2/C4; do not apply a second cap.
        if v_type='STRENGTH' then
          v_reps:=greatest(1,v_reps);
        else
          v_reps:=greatest(1,least(v_reps,30));
        end if;
        -- Keep a real rest window inside each EMOM minute. Cap prescribed reps
        -- from the solver, never increase them to fill the available minute.
        if v_type='WOD' and v_mechanic='EMOM' then
          v_reps:=least(v_reps,10);
        end if;
        v_rep_time:=case when v_type='WOD' then 4 else 5 end;
        v_work_seconds:=v_reps*v_rep_time;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        if v_type='WOD' and v_mechanic='EMOM' and v_work_seconds>42 then
          v_reps:=greatest(1,floor(42.0/v_rep_time)::integer);
          v_work_seconds:=v_reps*v_rep_time;
        end if;
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,
          'reps_semantics',coalesce(v_solver->>'reps_semantics','total'));
        if v_sets is not null then
          v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0));
        end if;
        v_pres:=v_pres||jsonb_build_object('text',
          case when v_sets is not null then v_sets||' × ' else '' end||v_reps||' reps');
      elsif jsonb_typeof(v_solver->'duration_seconds_min')='number' then
        v_work_seconds:=case when v_type='STRENGTH' then
          (v_solver->>'duration_seconds_min')::integer
          else least(40,greatest(10,(v_solver->>'duration_seconds_min')::integer)) end;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        v_pres:=v_pres||jsonb_build_object('duration_seconds',v_work_seconds,
          'text',v_work_seconds||' s');
      elsif jsonb_typeof(v_solver->'distance_meters_min')='number' then
        v_pres:=v_pres||jsonb_build_object('distance_meters',
          (v_solver->>'distance_meters_min')::integer,
          'text',(v_solver->>'distance_meters_min')||' m');
        v_estimated_round_seconds:=v_estimated_round_seconds+45;
      else
        raise exception 'COMPOSER_EXERCISE_DOSE_NOT_ACTIONABLE_%',v_id;
      end if;
      -- Numeric loads only from confirmed engine prescriptions (never inferred).
      if jsonb_typeof(v_solver->'load_kg')='number' then
        v_pres:=v_pres||jsonb_build_object('load_kg',v_solver->'load_kg',
          'load_scope',v_solver->'load_scope');
      end if;
      end if; -- canonical WOD prescriptions bypass the legacy scalar formatter
      if v_type in ('WARMUP','STRENGTH','SKILL') and v_sets is not null then
        v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0),
          'reps_semantics',coalesce(v_pres->>'reps_semantics',v_solver->>'reps_semantics','total'));
      end if;
      IF v_program_preview IS NULL AND v_type IN ('STRENGTH','SKILL') THEN
        v_pres:=public.week_composer_manual_exercise_v1(v_id,v_pres,v_e->'manual_dose',v_type,null);
      END IF;
      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises (
        id,session_id,exercise_id,exercise_name,block_key,position,status,
        prescription,prescription_json,expected_outcome_json,
        expected_rpe_min,expected_rpe_max,solver_decision_json,selection_provenance,user_execution_status
      ) values (
        v_exercise_instance_id,v_session_id,v_id,coalesce(v_ex.display_name,v_ex.name),
        v_block_key,v_item_idx,'pending',v_pres->>'text',v_pres,v_pres,
        nullif(v_pres->>'target_rpe_min','')::numeric,
        nullif(v_pres->>'target_rpe_max','')::numeric,
        jsonb_build_object('source','w11_composer_day_j_v1','selection_provenance','USER_COMPOSER',
          'solver_source',v_solver->>'solver_version','original_block_type',v_type),
        'USER_SELECTED','pending'
      );
      v_ejson:=jsonb_build_object('id',v_id,'exercise_id',v_id,
        'session_exercise_id',v_exercise_instance_id,
        'name',coalesce(v_ex.display_name,v_ex.name),
        'family',v_ex.exercise_family,'region',v_ex.body_region,
        'pattern',v_ex.movement_pattern,'tracking_modes',to_jsonb(v_ex.tracking_modes),
        'prescription',v_pres,'prescription_json',v_pres);
      v_out_exercises:=v_out_exercises||jsonb_build_array(v_ejson);
    end loop;
    if v_type='WOD' and v_wod_plan is null and (
       (v_mechanic='AMRAP' and v_estimated_round_seconds>v_minutes*60*0.85)
       or (v_mechanic in ('FOR_TIME','CIRCUIT')
         and (v_estimated_round_seconds*v_rounds
            + greatest(0,v_rounds-1)*coalesce(v_params->>'rest_seconds','0')::integer)>v_minutes*60*0.85)
       ) then
      raise exception 'COMPOSER_DENSITY_EXCEEDS_BUDGET';
    end if;
    IF v_program_preview IS NULL AND v_type IN ('SKILL','STRENGTH') THEN
      v_ctx:=public.week_composer_manual_series_preview_v1(jsonb_build_object('type',v_type,'minutes',v_minutes,'time',v_params->'time','exercises',v_out_exercises),jsonb_build_object('exercises','[]'::jsonb));
      IF v_ctx#>>'{time,manual_estimate}'='true' THEN
        v_params:=v_params||jsonb_build_object('time',v_ctx->'time','manual_per_exercise',true);
        IF v_skill_plan IS NOT NULL THEN v_skill_plan:=v_skill_plan||jsonb_build_object('time',v_ctx->'time'); END IF;
      END IF;
    END IF;
    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;
      v_wod_params:=v_params;
    end if;
    v_out_blocks:=v_out_blocks||jsonb_build_array(jsonb_build_object(
      'block_key',v_block_key,'block_name',coalesce(v_b->>'label',initcap(v_type)),
      'module_code',v_type,'duration_minutes',v_wod_minutes,
      'mechanic',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
        'variant_key',case when v_type='WOD' and v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
        'parameters',v_params,'source','W11_COMPOSER_DAY_J'),
      'exercises',v_out_exercises,'user_editable',true,'manual_selection',true,
      'block_order',v_block_idx,'warmup_rounds',case when v_type='WARMUP' then v_sets else null end
    )||case when v_skill_plan is not null then jsonb_build_object(
      'skill_contract',v_skill_plan->'skill_contract','curriculum',v_skill_plan->'curriculum',
      'skill_path',v_skill_plan->'skill_path','time',v_skill_plan->'time') else '{}'::jsonb end);
  end loop;

  update public.workout_sessions
    set generated_workout=jsonb_build_object('version','w11-composer-player-v1',
      'meta',jsonb_build_object('source','w11_composer','plan_item_id',v_item.id,'environment_code',v_env,
        'focus',v_focus,'target_region',v_region,'total_duration_minutes',v_duration,
        'day_j_dose_finalized',true,'original_selection_preserved',true),
      'blocks',v_out_blocks),
      mechanic_json=case when v_wod_mechanic is null then '{}'::jsonb else
        jsonb_build_object('mechanic_key',v_wod_mechanic,
          'variant_key',case when v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
          'parameters',v_wod_params,'source','W11_COMPOSER_DAY_J') end,
      updated_at=now()
    where id=v_session_id;
  update public.user_training_plan_items
    set session_id=v_session_id,status='claimed',claimed_at=coalesce(claimed_at,now()),
      updated_at=now()
    where id=v_item.id;
  return jsonb_build_object('status','READY','session_id',v_session_id,
    'plan_item_id',v_item.id,'idempotent',false,
    'block_count',jsonb_array_length(v_out_blocks),
    'exercise_count',cardinality(v_ids),
    'mechanic',v_wod_mechanic,
    'duration_minutes',v_duration,'planned_block_minutes',v_total_minutes,
    'source','W11_COMPOSER_DAY_J_V1');
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_compile_composer_outdoor_day_j_v1(p_user_id uuid, p_plan_item_id uuid, p_local_date date, p_readiness integer, p_pain_zones text[], p_available_equipment text[], p_environment_code text, p_outdoor_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb;
  v_blocks jsonb;
  v_b jsonb;
  v_e jsonb;
  v_ex public.exercises%rowtype;
  v_inventory jsonb;
  v_mechanic text;
  v_env text;
  v_focus text;
  v_region text;
  v_intent text;
  v_duration integer;
  v_minutes integer;
  v_wod_minutes integer;
  v_total_minutes integer := 0;
  v_count integer;
  v_cycles integer;
  v_sets integer;
  v_rounds integer;
  v_rest integer;
  v_reps integer;
  v_reps_max integer;
  v_work integer;
  v_work_seconds integer;
  v_estimated_round_seconds integer;
  v_block_key text;
  v_type text;
  v_pres jsonb;
  v_solver jsonb;
  v_strength_plan jsonb;
  v_wod_plan jsonb;
  v_deck_plan jsonb;
  v_deck_caps numeric[];
  v_shared_wod boolean;
  v_skill_plan jsonb;
  v_cardio_plan jsonb;
  v_params jsonb;
  v_ejson jsonb;
  v_out_blocks jsonb := '[]'::jsonb;
  v_out_exercises jsonb;
  v_ids text[] := '{}';
  v_block_ids text[] := '{}';
  v_keys text[] := '{}';
  v_id text;
  v_session_id uuid;
  v_exercise_instance_id uuid;
  v_active uuid;
  v_existing_status text;
  v_existing_source text;
  v_block_idx integer := 0;
  v_item_idx integer;
  v_wod_mechanic text;
  v_wod_params jsonb;
  v_pres_text text;
  v_rep_time integer;
  v_max_station integer;
  v_ctx jsonb;
  v_result jsonb;
  v_expected_stimulus jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_user_id is null or p_plan_item_id is null or p_local_date is null then
    raise exception 'Missing Composer identity/date';
  end if;
  if p_readiness is null or p_readiness not between 1 and 10 then
    raise exception 'READINESS_REQUIRED';
  end if;
  if p_pain_zones is null or cardinality(p_pain_zones)=0 then
    raise exception 'PAIN_CHECK_REQUIRED';
  end if;
  if p_available_equipment is null then
    raise exception 'EQUIPMENT_CONFIRMATION_REQUIRED';
  end if;
  if p_local_date < current_date-1 or p_local_date > current_date+1 then
    raise exception 'DAY_J_ONLY';
  end if;

  -- Serialize same-day Composer and standard generation.
  perform pg_advisory_xact_lock(hashtextextended('ugerod:environment-generation:'||p_user_id::text||':'||p_local_date::text,0));
  perform pg_advisory_xact_lock(hashtextextended('ugerod:adaptive-generation:'||p_user_id::text||':'||p_local_date::text,0));
  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;
  if not found or v_item.recommended_date is distinct from p_local_date then
    raise exception 'COMPOSER_DAY_MISMATCH';
  end if;
  if v_item.session_id is not null then
    select status,planning_context_json->>'session_source'
      into v_existing_status,v_existing_source
    from public.workout_sessions
    where id=v_item.session_id and user_id=p_user_id;
    if v_existing_source='W11_COMPOSER_DAY_J' then
      return jsonb_build_object('status','ALREADY_READY','session_id',v_item.session_id,
        'session_status',v_existing_status,'plan_item_id',v_item.id,'idempotent',true);
    end if;
    raise exception 'PLAN_ITEM_ALREADY_BOUND_TO_ANOTHER_SESSION';
  end if;
  if v_item.status not in ('available','claimed') then
    raise exception 'PLAN_ITEM_NOT_EDITABLE';
  end if;
  select id into v_active from public.workout_sessions
  where user_id=p_user_id and generation_local_date=p_local_date and status in ('generated','in_progress')
  order by generated_at desc limit 1;
  if v_active is not null then
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',v_active,
      'plan_item_id',v_item.id,'idempotent',false);
  end if;

  v_draft:=v_item.planning_context_json #> '{w11,composer_draft}';
  if jsonb_typeof(v_draft)<>'object' or coalesce(v_draft->>'version','')<>'w11-composer-draft-v1' then
    raise exception 'COMPOSER_DRAFT_NOT_FOUND';
  end if;
  if coalesce((v_draft->>'structure_stable')::boolean,false)<>true then
    raise exception 'UNSTABLE_COMPOSITION';
  end if;
  v_shared_wod:=coalesce(v_draft->>'wod_engine_version','')='C4_COMPOSER_V2';

  if v_draft->>'environment_code'<>'OUTDOOR' or v_draft->>'outdoor_engine_version' is distinct from 'COMPOSER_OUTDOOR_V1'
    or jsonb_typeof(p_outdoor_context) is distinct from 'object' then raise exception 'OUTDOOR_CONTEXT_REQUIRED'; end if;
  if public.outdoor_place_context_v1(p_outdoor_context->>'place_code',p_outdoor_context->>'surface_code')->>'effective_surface_code' is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED'; end if;
  v_draft:=jsonb_set(v_draft,'{outdoor_context}',p_outdoor_context);
  v_blocks:=v_draft #> '{architecture,blocks}';
  if jsonb_typeof(v_blocks)<>'array' or jsonb_array_length(v_blocks) not between 1 and 6 then
    raise exception 'COMPOSER_BLOCKS_INVALID';
  end if;
  v_duration:=nullif(v_draft->>'duration_minutes','')::integer;
  if v_duration is null or v_duration not between 15 and 180 then
    raise exception 'COMPOSER_DURATION_INVALID';
  end if;
  v_env:=upper(coalesce(v_draft->>'environment_code',''));
  if v_env not in ('HOME','BOX','GYM','OUTDOOR')
     or v_env<>upper(coalesce(p_environment_code,'')) then
    raise exception 'ENVIRONMENT_CHANGED_REQUIRES_RECOMPOSITION';
  end if;
  -- Outdoor needs the same explicit terrain gate as the standard generator.
  if v_env='OUTDOOR' and nullif(v_draft #>> '{outdoor_context,surface_code}','') is null then
    raise exception 'OUTDOOR_SURFACE_REQUIRED';
  end if;
  v_region:=nullif(v_draft->>'target_region','');
  v_focus:=coalesce(nullif(v_draft#>>'{intent,focus}',''),'General Fitness');
  v_intent:=coalesce(nullif(v_item.planned_progression_intent,''),'MAINTAIN');
  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,p_available_equipment,'c4-final-default');
  v_mechanic:=upper(coalesce(v_draft#>>'{mechanic,key}',''));
  if exists(select 1 from jsonb_array_elements(v_blocks) b where upper(b->>'type')='WOD') then
    if not v_shared_wod and (v_mechanic not in ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT')
       or not exists(select 1 from public.workout_mechanics m where m.mechanic_key=v_mechanic
          and m.active and m.mechanic_kind='core' and m.manual_free_eligible)) then
      raise exception 'COMPOSER_MECHANIC_NOT_EXECUTABLE_%',v_mechanic;
    end if;
  end if;

  -- Preflight the entire user-selected structure before creating anything.
  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_ids:='{}'; -- separate uniqueness per authored block
    v_type:=upper(coalesce(v_b->>'type',''));
    if v_type not in ('WARMUP','TABATA','STRENGTH','SKILL','WOD','CARDIO') then
      raise exception 'COMPOSER_UNSUPPORTED_BLOCK_%',v_type;
    end if;
    if v_type=any(v_keys) then raise exception 'COMPOSER_DUPLICATE_BLOCK_%',v_type; end if;
    v_keys:=array_append(v_keys,v_type);
    v_minutes:=nullif(v_b->>'minutes','')::integer;
    if v_minutes is null or v_minutes<2 or v_minutes>90 then
      raise exception 'COMPOSER_INVALID_BLOCK_DURATION_%',v_type;
    end if;
    if v_type='TABATA' and v_minutes<>4 then
      raise exception 'TABATA_MUST_BE_4_MINUTES';
    end if;
    v_total_minutes:=v_total_minutes+v_minutes;
    if jsonb_typeof(v_b->'exercises')<>'array' or jsonb_array_length(v_b->'exercises')=0
       or jsonb_array_length(v_b->'exercises')>8 then
      raise exception 'COMPOSER_BLOCK_EXERCISES_INVALID_%',v_type;
    end if;
    if v_type='WOD' and v_mechanic='EMOM'
       and v_minutes<jsonb_array_length(v_b->'exercises') then
      raise exception 'EMOM_TOO_SHORT_FOR_STATIONS';
    end if;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_id:=v_e->>'id';
      if v_id is null or v_id=any(v_block_ids) then
        raise exception 'COMPOSER_DUPLICATE_OR_MISSING_EXERCISE_%',coalesce(v_id,'null');
      end if;
      v_block_ids:=array_append(v_block_ids,v_id);
      v_ids:=array_append(v_ids,v_id);
      select * into v_ex from public.exercises where id=v_id;
      if not found then raise exception 'COMPOSER_UNKNOWN_EXERCISE_%',v_id; end if;
      if not public.exercise_environment_eligible_v1(v_id,v_env)
        or not public.exercise_safe_for_zones(v_id,public.normalize_body_zone_ids(p_pain_zones))
        or not public.exercise_equipment_compatible(v_id,v_inventory) then
        raise exception 'COMPOSER_EXERCISE_INCOMPATIBLE_%',v_id;
      end if;
      if v_type='WARMUP' and not coalesce(v_ex.warmup_eligible,false) then
        raise exception 'COMPOSER_NOT_WARMUP_ELIGIBLE_%',v_id;
      end if;
      if v_type='TABATA' and not coalesce(v_ex.tabata_eligible,false) then
        raise exception 'COMPOSER_NOT_TABATA_ELIGIBLE_%',v_id;
      end if;
    end loop;
  end loop;
  if v_total_minutes>v_duration then
    raise exception 'COMPOSER_TIME_BUDGET_EXCEEDED';
  end if;

  -- Store the selected workload as an explicit user-authored expected-stimulus
  -- contract; the generic C4 target policy may not support every Composer focus.
  begin
    v_expected_stimulus:=public.build_session_stimulus_target(v_focus,v_duration,
      p_readiness::text,v_region,v_intent,'c4-final-default');
  exception when others then
    v_expected_stimulus:=jsonb_build_object(
      'stimulus_model_status','USER_AUTHORED_NOT_AUTO_DERIVED');
  end;
  v_expected_stimulus:=coalesce(v_expected_stimulus,'{}'::jsonb)||
    jsonb_build_object('source','W11_COMPOSER_DAY_J','user_authored',true,
      'focus',v_focus,'duration_minutes',v_duration,'readiness',p_readiness,
      'target_region',v_region,'progression_intent',v_intent,
      'auto_generation_used',false);

  -- A single transaction owns both the session and every exercise; any failed
  -- dose, compatibility or density check rolls everything back.
  v_session_id:=gen_random_uuid();
  insert into public.workout_sessions (
    id,user_id,status,duration_minutes,target_region,readiness,focus,
    available_equipment,injured_zones,generated_at,progression_intent,
    generated_workout,planning_context_json,expected_stimulus_json,quality_gate_json,generation_local_date,
    planned_environment_code,planned_environment_source,planned_environment_selected_at,planned_surface_code
  ) values (
    v_session_id,p_user_id,'generated',v_duration,v_region,p_readiness::text,v_focus,
    p_available_equipment,p_pain_zones,now(),v_intent,
    jsonb_build_object('version','w11-composer-player-v1','blocks','[]'::jsonb),
    jsonb_build_object('session_source','W11_COMPOSER_DAY_J','plan_item_id',v_item.id,
      'composer_draft',v_draft,'user_block_order_preserved',true,'day_j_readiness',p_readiness),
    v_expected_stimulus,
    jsonb_build_object('source','w11-composer-finalizer-v1','pass',true,
      'user_exercise_choices_preserved',true,'time_budget_minutes',v_duration),
    p_local_date,v_env,'USER_COMPOSER',now(),
    nullif(v_draft #>> '{outdoor_context,surface_code}','')
  );

  for v_b in select value from jsonb_array_elements(v_blocks) loop
    v_block_idx:=v_block_idx+1;
    v_type:=upper(v_b->>'type');
    v_minutes:=(v_b->>'minutes')::integer;
    v_count:=jsonb_array_length(v_b->'exercises');
    v_block_key:=case v_type when 'WARMUP' then 'warm_up'
      when 'TABATA' then 'tabata' when 'STRENGTH' then 'strength'
      when 'SKILL' then 'skill' else 'wod' end;
    v_params:='{}'::jsonb;
    v_rounds:=null;
    v_rest:=null;
    v_wod_minutes:=v_minutes;
    v_wod_plan:=null;
    v_skill_plan:=null;
    if v_type='CARDIO' then
      v_cardio_plan:=public.week_composer_cardio_authority_v1(p_user_id,public.week_composer_outdoor_context_v1(v_draft)||jsonb_build_object('focus',v_focus,'session_minutes',v_duration,
        'block_minutes',v_minutes,'environment_code',v_env,'equipment_names',to_jsonb(p_available_equipment),
        'pain_zones',to_jsonb(p_pain_zones),'readiness',p_readiness::text,'target_region',v_region,
        'progression_intent',v_intent,'exercises',v_b->'exercises'));
      if v_cardio_plan->>'status'<>'READY' then raise exception 'COMPOSER_CARDIO_RECOMPOSITION_REQUIRED_%',v_cardio_plan->>'reason'; end if;
      v_out_exercises:='[]'; v_item_idx:=0;
      for v_e in select value from jsonb_array_elements(v_cardio_plan#>'{block,exercises}') loop
        v_item_idx:=v_item_idx+1; v_exercise_instance_id:=gen_random_uuid();
        insert into public.workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,prescription,prescription_json,status,user_execution_status,expected_outcome_json,selection_provenance)
          values(v_exercise_instance_id,v_session_id,v_e->>'exercise_id',v_e->>'name','cardio',v_item_idx,
            v_e#>>'{prescription,text}',v_e->'prescription','pending','pending',v_e->'prescription','USER_SELECTED');
        v_out_exercises:=v_out_exercises||jsonb_build_array(v_e||jsonb_build_object('session_exercise_id',v_exercise_instance_id));
      end loop;
      v_out_blocks:=v_out_blocks||jsonb_build_array((v_cardio_plan->'block')||jsonb_build_object('exercises',v_out_exercises,'block_order',v_block_idx,'module_code','CARDIO','manual_selection',true));
      continue;
    end if;
    if v_type='WOD' and v_shared_wod then
      v_wod_plan:=public.week_composer_wod_authority_v2(p_user_id,jsonb_build_object(
        'mechanic_key',v_mechanic,'variant_key',v_draft#>>'{mechanic,variant_key}',
        'session_minutes',v_duration,'block_minutes',v_minutes,'exercises',v_b->'exercises',
        'equipment_names',to_jsonb(p_available_equipment),'environment_code',v_env,'focus',v_focus,
        'target_region',v_region,'progression_intent',v_intent,'readiness',p_readiness::text,
        'pain_zones',to_jsonb(p_pain_zones)));
      if v_wod_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_WOD_RECOMPOSITION_REQUIRED_%',v_wod_plan->>'reason';
      end if;
      v_params:=v_wod_plan->'parameters';
      if v_mechanic='DECK' then
        select array_agg(public.c4_deck_exercise_rep_cap_v1(p_user_id,value->>'exercise_id',p_readiness::text,v_intent) order by ordinality)
        into v_deck_caps from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}') with ordinality;
        v_deck_plan:=public.c4_build_deck_plan_v2(v_session_id,(v_params->>'cards')::int,v_deck_caps);
        if not coalesce((v_deck_plan->>'safe')::boolean,false) then raise exception 'COMPOSER_NO_SAFE_DECK_DRAW'; end if;
        v_params:=v_params||jsonb_build_object('deck_order',v_deck_plan->'deck_order',
          'deck_order_version','deck-adaptive-order-v1','deck_suit_reps',v_deck_plan->'suit_reps',
          'deck_suit_card_counts',v_deck_plan->'suit_card_counts','deck_shuffle_attempt',v_deck_plan->'shuffle_attempt',
          'source_deck_cards',52,'without_replacement',true,'safe_random_draw',true);
      end if;
      v_sets:=null;
    elsif v_type='WARMUP' then
      v_sets:=case when v_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then 3 when v_minutes>=6 then 2 else 1 end;
      v_params:=jsonb_build_object('rounds',v_sets);
    elsif v_type='TABATA' then
      v_sets:=1;
      v_params:=jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,
        'duration_minutes',4,'exercise_count',v_count);
    elsif v_type='STRENGTH' then
      v_strength_plan:=public.week_composer_strength_authority_v2(
        p_user_id,v_b->'exercises',v_duration,v_minutes,v_intent,
        p_available_equipment,v_focus,v_region,
        public.normalize_session_readiness(p_readiness::text),v_env
      );
      if v_strength_plan->>'status'<>'READY' then
        raise exception 'COMPOSER_STRENGTH_RECOMPOSITION_REQUIRED_%',v_strength_plan->>'status';
      end if;
      v_sets:=(v_strength_plan->>'sets')::int;
      v_rest:=(v_strength_plan->>'rest_seconds')::int;
      v_params:=jsonb_build_object(
        'sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes,
        'dose_authority',v_strength_plan->>'source','time',v_strength_plan->'time'
      );
    elsif v_type='SKILL' then
      if v_draft->>'skill_engine_version'='C4_COMPOSER_SKILL_V1' then
        v_skill_plan:=public.week_composer_skill_authority_v1(p_user_id,
          public.week_composer_skill_context_v1(v_draft,v_b,p_available_equipment,p_pain_zones,p_readiness::text));
        if v_skill_plan->>'status'<>'READY' then
          raise exception 'COMPOSER_SKILL_RECOMPOSITION_REQUIRED_%',v_skill_plan->>'reason';
        end if;
        v_sets:=null;
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'dose_authority',v_skill_plan->>'source','time',v_skill_plan->'time');
      else
        v_sets:=case when v_minutes>=15 then 3 else 2 end;
        v_rest:=60;
        v_params:=jsonb_build_object('sets',v_sets,'rest_seconds',v_rest,'duration_minutes',v_minutes);
      end if;
    else
      v_sets:=null;
      if v_mechanic='EMOM' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('duration_minutes',v_wod_minutes,
          'cycles',v_cycles,'station_seconds',60,'exercise_count',v_count,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      elsif v_mechanic='AMRAP' then
        v_params:=jsonb_build_object('duration_minutes',v_minutes,'exercise_count',v_count);
      elsif v_mechanic='FOR_TIME' then
        v_rounds:=greatest(1,least(5,floor(v_minutes::numeric/4)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'time_cap_minutes',v_minutes,
          'cap_seconds',v_minutes*60);
      elsif v_mechanic='CIRCUIT' then
        v_rounds:=greatest(2,least(4,floor(v_minutes::numeric/5)::integer));
        v_params:=jsonb_build_object('rounds',v_rounds,'rest_seconds',45,'rest_between_rounds_seconds',45,
          'duration_minutes',v_minutes);
      elsif v_mechanic='HIIT' then
        v_cycles:=floor(v_minutes::numeric/v_count)::integer;
        if v_cycles<2 then raise exception 'HIIT_TOO_SHORT_FOR_STATIONS'; end if;
        v_wod_minutes:=v_cycles*v_count;
        v_params:=jsonb_build_object('rounds',v_cycles,'exercise_count',v_count,
          'work_seconds',40,'rest_seconds',20,'duration_minutes',v_wod_minutes,
          'transition_budget_minutes',v_minutes-v_wod_minutes);
      end if;
    end if;
    v_estimated_round_seconds:=0;
    v_out_exercises:='[]'::jsonb;
    v_item_idx:=0;
    for v_e in select value from jsonb_array_elements(v_b->'exercises') loop
      v_item_idx:=v_item_idx+1;
      v_id:=v_e->>'id';
      select * into v_ex from public.exercises where id=v_id;
      if v_skill_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_skill_plan->'exercises')
          where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_SKILL_DOSE_MISSING'; end if;
        v_solver:=v_pres;
      elsif v_wod_plan is not null then
        select value->'prescription' into v_pres from jsonb_array_elements(v_wod_plan#>'{candidate,exercises}')
        where value->>'exercise_id'=v_id;
        if v_pres is null then raise exception 'COMPOSER_WOD_DOSE_MISSING'; end if;
        v_pres:=v_pres||jsonb_build_object('block_parameters',v_params);
        v_solver:=v_pres;
      else
      if v_type='STRENGTH' then
        select value->'solver_reference' into v_solver
        from jsonb_array_elements(v_strength_plan->'exercises') value
        where value->>'id'=v_id limit 1;
      else
        v_solver:=public.c2_solver_prescription(p_user_id,v_id,'{}'::jsonb,
          case when v_type='WARMUP' then 'WARMUP'
            when v_type='TABATA' then 'TABATA'
            when v_type='SKILL' then 'STRENGTH'
            else v_mechanic end,v_intent,v_inventory);
      end if;
      if jsonb_typeof(v_solver)<>'object' then raise exception 'COMPOSER_DOSE_UNAVAILABLE_%',v_id; end if;
      v_reps:=case when jsonb_typeof(v_solver->'reps_min')='number'
        then (v_solver->>'reps_min')::integer else null end;
      v_reps_max:=case when jsonb_typeof(v_solver->'reps_max')='number'
        then (v_solver->>'reps_max')::integer else null end;
      v_reps:=coalesce(v_reps,v_reps_max);
      v_pres:=jsonb_build_object('source','w11_composer_day_j_v1','finalized',true,
        'tracking_modes',coalesce(to_jsonb(v_ex.tracking_modes),'[]'::jsonb),
        'target_rpe_min',v_solver->'target_rpe_min','target_rpe_max',v_solver->'target_rpe_max',
        'solver_reference',v_solver,'duration_budget_minutes',v_minutes);
      if v_type='TABATA' then
        v_pres:=v_pres||jsonb_build_object('mechanic','TABATA','protocol',
          jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10),
          'duration_seconds',20,'text','20 s effort / 10 s récupération · 4 cycles par mouvement');
      elsif v_reps is not null and v_reps>0 then
        -- Strength doses are owned by C2/C4; do not apply a second cap.
        if v_type='STRENGTH' then
          v_reps:=greatest(1,v_reps);
        else
          v_reps:=greatest(1,least(v_reps,30));
        end if;
        -- Keep a real rest window inside each EMOM minute. Cap prescribed reps
        -- from the solver, never increase them to fill the available minute.
        if v_type='WOD' and v_mechanic='EMOM' then
          v_reps:=least(v_reps,10);
        end if;
        v_rep_time:=case when v_type='WOD' then 4 else 5 end;
        v_work_seconds:=v_reps*v_rep_time;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        if v_type='WOD' and v_mechanic='EMOM' and v_work_seconds>42 then
          v_reps:=greatest(1,floor(42.0/v_rep_time)::integer);
          v_work_seconds:=v_reps*v_rep_time;
        end if;
        v_pres:=v_pres||jsonb_build_object('reps_min',v_reps,'reps_max',v_reps,
          'reps_semantics',coalesce(v_solver->>'reps_semantics','total'));
        if v_sets is not null then
          v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0));
        end if;
        v_pres:=v_pres||jsonb_build_object('text',
          case when v_sets is not null then v_sets||' × ' else '' end||v_reps||' reps');
      elsif jsonb_typeof(v_solver->'duration_seconds_min')='number' then
        v_work_seconds:=case when v_type='STRENGTH' then
          (v_solver->>'duration_seconds_min')::integer
          else least(40,greatest(10,(v_solver->>'duration_seconds_min')::integer)) end;
        v_estimated_round_seconds:=v_estimated_round_seconds+v_work_seconds+10;
        v_pres:=v_pres||jsonb_build_object('duration_seconds',v_work_seconds,
          'text',v_work_seconds||' s');
      elsif jsonb_typeof(v_solver->'distance_meters_min')='number' then
        v_pres:=v_pres||jsonb_build_object('distance_meters',
          (v_solver->>'distance_meters_min')::integer,
          'text',(v_solver->>'distance_meters_min')||' m');
        v_estimated_round_seconds:=v_estimated_round_seconds+45;
      else
        raise exception 'COMPOSER_EXERCISE_DOSE_NOT_ACTIONABLE_%',v_id;
      end if;
      -- Numeric loads only from confirmed engine prescriptions (never inferred).
      if jsonb_typeof(v_solver->'load_kg')='number' then
        v_pres:=v_pres||jsonb_build_object('load_kg',v_solver->'load_kg',
          'load_scope',v_solver->'load_scope');
      end if;
      end if; -- canonical WOD prescriptions bypass the legacy scalar formatter
      if v_type in ('WARMUP','STRENGTH','SKILL') and v_sets is not null then
        v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0),
          'reps_semantics',coalesce(v_pres->>'reps_semantics',v_solver->>'reps_semantics','total'));
      end if;
      v_exercise_instance_id:=gen_random_uuid();
      insert into public.workout_session_exercises (
        id,session_id,exercise_id,exercise_name,block_key,position,status,
        prescription,prescription_json,expected_outcome_json,
        expected_rpe_min,expected_rpe_max,solver_decision_json,selection_provenance,user_execution_status
      ) values (
        v_exercise_instance_id,v_session_id,v_id,coalesce(v_ex.display_name,v_ex.name),
        v_block_key,v_item_idx,'pending',v_pres->>'text',v_pres,v_pres,
        nullif(v_pres->>'target_rpe_min','')::numeric,
        nullif(v_pres->>'target_rpe_max','')::numeric,
        jsonb_build_object('source','w11_composer_day_j_v1','selection_provenance','USER_COMPOSER',
          'solver_source',v_solver->>'solver_version','original_block_type',v_type),
        'USER_SELECTED','pending'
      );
      v_ejson:=jsonb_build_object('id',v_id,'exercise_id',v_id,
        'session_exercise_id',v_exercise_instance_id,
        'name',coalesce(v_ex.display_name,v_ex.name),
        'family',v_ex.exercise_family,'region',v_ex.body_region,
        'pattern',v_ex.movement_pattern,'tracking_modes',to_jsonb(v_ex.tracking_modes),
        'prescription',v_pres,'prescription_json',v_pres);
      v_out_exercises:=v_out_exercises||jsonb_build_array(v_ejson);
    end loop;
    if v_type='WOD' and v_wod_plan is null and (
       (v_mechanic='AMRAP' and v_estimated_round_seconds>v_minutes*60*0.85)
       or (v_mechanic in ('FOR_TIME','CIRCUIT')
         and (v_estimated_round_seconds*v_rounds
            + greatest(0,v_rounds-1)*coalesce(v_params->>'rest_seconds','0')::integer)>v_minutes*60*0.85)
       ) then
      raise exception 'COMPOSER_DENSITY_EXCEEDS_BUDGET';
    end if;
    if v_type='WOD' then
      v_wod_mechanic:=v_mechanic;
      v_wod_params:=v_params;
    end if;
    v_out_blocks:=v_out_blocks||jsonb_build_array(jsonb_build_object(
      'block_key',v_block_key,'block_name',coalesce(v_b->>'label',initcap(v_type)),
      'module_code',v_type,'duration_minutes',v_wod_minutes,
      'mechanic',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
      'mechanic_json',jsonb_build_object(
        'mechanic_key',case when v_type='WOD' then v_mechanic when v_type='STRENGTH' then 'SETS_REPS'
        when v_type='TABATA' then 'TABATA' when v_type='WARMUP' then 'WARMUP' else 'SKILL' end,
        'variant_key',case when v_type='WOD' and v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
        'parameters',v_params,'source','W11_COMPOSER_DAY_J'),
      'exercises',v_out_exercises,'user_editable',true,'manual_selection',true,
      'block_order',v_block_idx,'warmup_rounds',case when v_type='WARMUP' then v_sets else null end
    )||case when v_skill_plan is not null then jsonb_build_object(
      'skill_contract',v_skill_plan->'skill_contract','curriculum',v_skill_plan->'curriculum',
      'skill_path',v_skill_plan->'skill_path','time',v_skill_plan->'time') else '{}'::jsonb end);
  end loop;

  update public.workout_sessions
    set generated_workout=jsonb_build_object('version','w11-composer-player-v1',
      'meta',jsonb_build_object('source','w11_composer','plan_item_id',v_item.id,'environment_code',v_env,
        'focus',v_focus,'target_region',v_region,'total_duration_minutes',v_duration,
        'day_j_dose_finalized',true,'original_selection_preserved',true),
      'blocks',v_out_blocks),
      mechanic_json=case when v_wod_mechanic is null then '{}'::jsonb else
        jsonb_build_object('mechanic_key',v_wod_mechanic,
          'variant_key',case when v_shared_wod then v_draft#>>'{mechanic,variant_key}' else null end,
          'parameters',v_wod_params,'source','W11_COMPOSER_DAY_J') end,
      updated_at=now()
    where id=v_session_id;
  update public.user_training_plan_items
    set session_id=v_session_id,status='claimed',claimed_at=coalesce(claimed_at,now()),
      updated_at=now()
    where id=v_item.id;
  return jsonb_build_object('status','READY','session_id',v_session_id,
    'plan_item_id',v_item.id,'idempotent',false,
    'block_count',jsonb_array_length(v_out_blocks),
    'exercise_count',cardinality(v_ids),
    'mechanic',v_wod_mechanic,
    'duration_minutes',v_duration,'planned_block_minutes',v_total_minutes,
    'source','W11_COMPOSER_DAY_J_V1');
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_create_assisted_plan_item_v1(p_user_id uuid, p_recommended_date date, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_week_start date;
  v_sequence integer;
  v_item_id uuid;
  v_result jsonb;
  v_existing_count integer;
  v_request text:=nullif(p_context->>'creation_request_id','');
  v_allow_same_day boolean:=coalesce(p_context->>'allow_same_day','false')='true';
  v_existing public.user_training_plan_items%rowtype;
begin
  if p_user_id is null or p_recommended_date is null then
    raise exception 'week_create_assisted_plan_item_v1 requires user and date';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_recommended_date < current_date then
    raise exception 'Cannot add a session in the past';
  end if;

  v_week_start := public.d_week_start(p_recommended_date);
  perform pg_advisory_xact_lock(
    hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_week_start::text,0)
  );
  if v_request is not null then
    if length(v_request)>100 or v_request !~ '^[a-zA-Z0-9_-]+$' then raise exception 'INVALID_CREATION_REQUEST';end if;
    select * into v_existing from public.user_training_plan_items
      where user_id=p_user_id and week_start=v_week_start and planning_context_json#>>'{w11,creation_request_id}'=v_request limit 1;
    if found then
      if v_existing.recommended_date is distinct from p_recommended_date or v_existing.status not in ('available','claimed','completed') then raise exception 'CREATION_REQUEST_CONFLICT';end if;
      return jsonb_build_object('created',false,'plan_item_id',v_existing.id,'recommended_date',v_existing.recommended_date,'week_start',v_week_start,'sequence_index',v_existing.sequence_index,'idempotent',true);
    end if;
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_recommended_date,false);

  select count(*)::integer
  into v_existing_count
  from public.user_training_plan_items
  where user_id=p_user_id
    and week_start=v_week_start
    and status in ('available','claimed','completed');

  if v_existing_count >= 5 then
    raise exception 'This week already contains five planned sessions';
  end if;

  if not v_allow_same_day and exists(
    select 1
    from public.user_training_plan_items
    where user_id=p_user_id
      and week_start=v_week_start
      and recommended_date=p_recommended_date
      and status in ('available','claimed','completed')
  ) then
    raise exception 'A session is already planned on this day';
  end if;

  select coalesce(max(sequence_index),0)+1
  into v_sequence
  from public.user_training_plan_items
  where user_id=p_user_id and week_start=v_week_start;

  insert into public.user_training_plan_items(
    user_id,
    sequence_index,
    recommended_date,
    status,
    week_start,
    planning_context_json
  ) values (
    p_user_id,
    v_sequence,
    p_recommended_date,
    'available',
    v_week_start,
    jsonb_build_object(
      'plan_version','w11-user-assisted-v1',
      'recommended_date_is_soft',true,
      'user_debt_created',false,
      'wod_pre_generated',false,
      'w11',jsonb_strip_nulls(jsonb_build_object(
        'creation_request_id',v_request,
        'provenance','USER_ASSISTED_SESSION',
        'creation_mode','ASSISTED',
        'replan_protected',true
      ))
    )
  )
  returning id into v_item_id;

  v_result := public.week_update_plan_item_context_v1(
    p_user_id,
    v_item_id,
    coalesce(p_context,'{}'::jsonb)-array['creation_request_id','allow_same_day']
  );

  return v_result || jsonb_build_object(
    'created',true,
    'sequence_index',v_sequence,
    'week_start',v_week_start,
    'week_end',v_week_start+6,
    'provenance','USER_ASSISTED_SESSION',
    'replan_protected',true,
    'max_week_sessions',5
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_plan_personal_program_v1(p_model_id uuid, p_date date, p_draft jsonb, p_surface text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE u uuid:=auth.uid(); m public.personal_workout_models%rowtype; preview jsonb; draft jsonb; gear text[]; gear_names text[]; ctx jsonb; item jsonb; saved jsonb; i int; row jsonb; original jsonb; duration int;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.personal_workout_models WHERE id=p_model_id AND user_id=u AND origin='PROGRAM';
 IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_NOT_FOUND'; END IF;
 IF p_draft->>'environment_code' IS DISTINCT FROM m.source_payload->>'environment_code' OR jsonb_array_length(p_draft#>'{architecture,blocks,1,exercises}') IS DISTINCT FROM jsonb_array_length(m.source_payload->'exercises') THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SOURCE_MISMATCH'; END IF;
 i:=0;
 FOR row IN SELECT value FROM jsonb_array_elements(p_draft#>'{architecture,blocks,1,exercises}') LOOP
  original:=m.source_payload->'exercises'->i;
  IF NOT coalesce(original->'candidate_ids' ? (row->>'id'),false) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_VARIANT_REQUIRED'; END IF;
  i:=i+1;
 END LOOP;
 SELECT array_agg(value) INTO gear FROM jsonb_array_elements_text(coalesce(p_draft->'equipment_ids','[]'));
 SELECT array_agg(name ORDER BY id) INTO gear_names FROM public.equipment_catalog_v2 WHERE id=ANY(coalesce(gear,'{}'));
 IF cardinality(coalesce(gear,'{}'))<>cardinality(coalesce(gear_names,'{}')) THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_UNKNOWN_EQUIPMENT'; END IF;
 preview:=public.week_composer_prescription_preview_v1(u,p_draft,gear);
 duration:=(preview->>'duration_minutes')::int;
 draft:=(p_draft-'creation_request_id')||jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',duration,'estimated_minutes',ceil((preview->>'estimated_seconds')::numeric/60),'target_date',p_date,'source_model_id',p_model_id,'prescription_preview',preview);
 draft:=jsonb_set(draft,'{architecture,blocks,0,minutes}','5');
 draft:=jsonb_set(draft,'{architecture,blocks,1,minutes}',to_jsonb(duration-5));
 ctx:=jsonb_build_object('duration_minutes',duration,'environment_code',draft->>'environment_code','equipment',to_jsonb(coalesce(gear_names,'{}'::text[])),'target_region','Upper');
 IF draft->>'environment_code'='OUTDOOR' THEN
  IF p_surface IS NULL OR public.normalize_session_surface_v1(p_surface)='UNKNOWN' THEN RAISE EXCEPTION 'OUTDOOR_SURFACE_REQUIRED'; END IF;
  ctx:=ctx||jsonb_build_object('surface_code',public.normalize_session_surface_v1(p_surface));
 END IF;
 item:=public.week_create_assisted_plan_item_v1(u,p_date,ctx||jsonb_build_object('allow_same_day',coalesce(p_draft->>'creation_request_id','')<>'','creation_request_id',p_draft->>'creation_request_id'));
 IF item->>'created'='false' THEN
   RETURN jsonb_build_object('status','SAVED','plan_item_id',item->>'plan_item_id','idempotent',true);
 END IF;
 saved:=public.week_save_composer_revision_v1(u,(item->>'plan_item_id')::uuid,draft,ctx,false);
 IF saved->>'status' IS DISTINCT FROM 'SAVED' THEN RAISE EXCEPTION 'PERSONAL_PROGRAM_SAVE_FAILED'; END IF;
 RETURN saved||jsonb_build_object('estimated_seconds',preview->'estimated_seconds');
END $function$;

CREATE OR REPLACE FUNCTION public.week_read_composer_for_day_v1(p_user_id uuid, p_local_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb;
begin
  if p_user_id is null or p_local_date is null then
    raise exception 'User and local date required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode = '42501';
  end if;
  if (select count(*) from public.user_training_plan_items where user_id=p_user_id and recommended_date=p_local_date and status in ('available','claimed') and jsonb_typeof(planning_context_json#>'{w11,composer_draft}')='object')>1 then
    raise exception 'COMPOSER_SELECTION_REQUIRED';
  end if;
  select * into v_item
  from public.user_training_plan_items
  where user_id = p_user_id
    and recommended_date = p_local_date
    and jsonb_typeof(planning_context_json #> '{w11,composer_draft}') = 'object'
    and status in ('available','claimed')
  order by updated_at desc, id
  limit 1;
  if not found then
    return jsonb_build_object('found',false,'local_date',p_local_date);
  end if;
  v_draft := v_item.planning_context_json #> '{w11,composer_draft}';
  return jsonb_build_object(
    'found',true,
    'contract_version','W11_COMPOSER_DAY_J_READ_V1',
    'local_date',p_local_date,
    'plan_item_id',v_item.id,
    'session_id',v_item.session_id,
    'status',v_item.status,
    'composer_draft',v_draft,
    'future_context',coalesce(v_item.planning_context_json #> '{w11,future_context}','{}'::jsonb),
    'semantics',jsonb_build_object(
      'user_block_selection_is_stable',true,
      'day_j_readiness_and_pain_only',true,
      'dose_finalization_deferred',true,
      'read_does_not_materialize_workout',true
    )
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.week_create_composer_plan_v1(p_user_id uuid,p_date date,p_draft jsonb,p_context jsonb,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE item jsonb; saved jsonb; pid uuid;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';END IF;
 IF nullif(p_request_id,'') IS NULL THEN RAISE EXCEPTION 'CREATION_REQUEST_REQUIRED';END IF;
 item:=public.week_create_assisted_plan_item_v1(p_user_id,p_date,coalesce(p_context,'{}')||jsonb_build_object('allow_same_day',true,'creation_request_id',p_request_id));
 pid:=(item->>'plan_item_id')::uuid;
 IF item->>'created'='false' THEN
   IF NOT EXISTS(select 1 from public.user_training_plan_items where id=pid and user_id=p_user_id and jsonb_typeof(planning_context_json#>'{w11,composer_draft}')='object') THEN RAISE EXCEPTION 'CREATION_REQUEST_CONFLICT';END IF;
   RETURN jsonb_build_object('status','SAVED','plan_item_id',pid,'idempotent',true);
 END IF;
 saved:=public.week_save_composer_with_model_v1(p_user_id,pid,p_draft,coalesce(p_context,'{}'),false);
 IF saved->>'status' IS DISTINCT FROM 'SAVED' THEN RAISE EXCEPTION 'COMPOSER_CREATE_FAILED';END IF;
 RETURN saved||jsonb_build_object('plan_item_id',pid);
END;
$function$;
REVOKE ALL ON FUNCTION public.week_create_composer_plan_v1(uuid,date,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_create_composer_plan_v1(uuid,date,jsonb,jsonb,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.week_list_composer_for_day_v1(p_local_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE u uuid:=auth.uid();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'plan_item_id',i.id,'session_id',i.session_id,'local_date',i.recommended_date,'status',i.status,
   'composer_draft',i.planning_context_json#>'{w11,composer_draft}',
   'future_context',coalesce(i.planning_context_json#>'{w11,future_context}','{}'::jsonb)
 ) ORDER BY i.sequence_index,i.id)
 FROM public.user_training_plan_items i WHERE i.user_id=u AND i.recommended_date=p_local_date
 AND i.status IN ('available','claimed') AND jsonb_typeof(i.planning_context_json#>'{w11,composer_draft}')='object'),'[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.week_list_composer_for_day_v1(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_list_composer_for_day_v1(date) TO authenticated,service_role;
