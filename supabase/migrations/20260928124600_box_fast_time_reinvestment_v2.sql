-- PERF-012: BOX fast time reinvestment.
-- Re-finalize the already selected candidate at a larger WOD budget and re-run
-- the canonical quality gate before considering a full C4 re-search. If the
-- fast path cannot preserve quality, fall back to the legacy implementation.

create or replace function public.c4_reinvest_available_time_v2(
  p_user_id uuid,
  p_plan jsonb,
  p_session_intent text default 'CLASSIC',
  p_focus text default 'General Fitness',
  p_duration_minutes integer default 45,
  p_readiness text default 'normal',
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_env text:=public.normalize_session_environment_v1(
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN')
  );
  v_intent text:=upper(coalesce(p_session_intent,'CLASSIC'));
  v_readiness text:=public.normalize_session_readiness(p_readiness);
  v_unallocated int:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0);
  v_current_wod int:=coalesce(nullif(r#>>'{architecture,wod_minutes}','')::int,0);
  v_base_target int:=coalesce(nullif(r#>>'{architecture,wod_target_minutes}','')::int,v_current_wod);
  v_current_fit numeric:=coalesce(nullif(r#>>'{selected_candidate,c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
  v_transition int:=coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0);
  v_quality_floor numeric:=-2;
  v_max_addition int:=5;
  v_bonus_cap int;
  v_attempt_bonus int;
  v_try int;
  v_candidate jsonb;
  v_gate jsonb;
  v_fit numeric;
  v_actual int;
  v_added int;
  v_blocks jsonb;
  v_active int;
  v_planned int;
  v_stimulus jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(r->>'status','')<>'READY' then return r; end if;

  -- Keep the legacy implementation authoritative outside BOX and for the
  -- Skill-specific reinvestment path.
  if v_env<>'BOX' or v_intent='SKILL_DEVELOPMENT' then
    return public.c4_reinvest_available_time_v1(
      p_user_id,p_plan,p_session_intent,p_focus,p_duration_minutes,p_readiness,
      p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,
      p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  select
    coalesce(nullif(config#>>'{time_reinvestment,quality_delta_floor}','')::numeric,-2),
    coalesce(nullif(config#>>'{time_reinvestment,max_opportunistic_addition_minutes}','')::int,5)
  into v_quality_floor,v_max_addition
  from public.session_engine_policy
  where policy_key=p_policy_key;

  v_max_addition:=case
    when p_duration_minutes>=60 then least(8,greatest(2,v_max_addition))
    else least(5,greatest(2,v_max_addition))
  end;

  if v_unallocated<4
     or v_readiness='low'
     or upper(coalesce(p_progression_intent,''))='DELOAD'
     or v_current_wod<=0
     or r->'selected_candidate' is null then
    return public.c4_reinvest_available_time_v1(
      p_user_id,p_plan,p_session_intent,p_focus,p_duration_minutes,p_readiness,
      p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,
      p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  v_stimulus:=coalesce(
    r->'stimulus',
    r#>'{selected_candidate,stimulus}',
    public.build_session_stimulus_target(
      p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
    )
  );

  v_bonus_cap:=least(v_max_addition,v_unallocated);
  v_attempt_bonus:=v_bonus_cap;

  loop
    v_try:=v_base_target+v_attempt_bonus;

    v_candidate:=public.c4_finalize_candidate(
      r->'selected_candidate',
      v_stimulus,
      p_duration_minutes,
      v_try,
      p_policy_key,
      'c3-sim-default'
    );

    v_gate:=public.c4_candidate_quality_gate_v2(
      v_candidate,
      p_readiness,
      p_focus,
      p_target_region,
      p_zone_terms,
      p_inventory,
      p_max_complexity,
      p_policy_key
    );

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_fit:=coalesce(
        nullif(v_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,
        0
      );

      v_actual:=case
        when upper(coalesce(v_candidate->>'mechanic',''))='SETS_REPS'
         and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
        then least(
          coalesce(
            nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,
            v_try
          ),
          greatest(
            10,
            ceil(
              nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0
            )::int
          )
        )
        else coalesce(
          nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,
          v_try
        )
      end;

      v_added:=v_actual-v_current_wod;

      if v_added between 2 and v_attempt_bonus
         and v_fit>=v_current_fit+v_quality_floor then

        select coalesce(
          jsonb_agg(
            case
              when b->>'block_key'='wod' then
                b||jsonb_build_object(
                  'duration_minutes',v_actual,
                  'mechanic',v_candidate->>'mechanic',
                  'mechanic_json',v_candidate#>'{c4_final,mechanic_json}',
                  'exercises',v_candidate->'exercises',
                  'expected_outcome',jsonb_build_object(
                    'role','primary_training_stimulus',
                    'predicted_volume',v_candidate#>'{c4_final,predicted_volume}',
                    'whole_wod_metrics',v_candidate#>'{c4_final,whole_wod_metrics}'
                  )
                )
              else b
            end
            order by ord
          ),
          '[]'::jsonb
        )
        into v_blocks
        from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb))
             with ordinality x(b,ord);

        r:=jsonb_set(r,'{blocks}',v_blocks,true);
        r:=jsonb_set(r,'{selected_candidate}',v_candidate,true);

        v_active:=coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)+v_added;
        v_planned:=v_active+v_transition;

        r:=jsonb_set(r,'{architecture,wod_minutes}',to_jsonb(v_actual),true);
        r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
        r:=jsonb_set(r,'{architecture,active_block_budget_minutes}',to_jsonb(v_active),true);
        r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
        r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
        r:=jsonb_set(r,'{architecture,wod_duration_guardrail,final_wod_minutes}',to_jsonb(v_actual),true);
        r:=jsonb_set(r,'{architecture,opportunistic_wod_target_minutes}',to_jsonb(v_try),true);
        r:=jsonb_set(r,'{wod_solver,quality_gate}',v_gate,true);

        return jsonb_set(
          r,
          '{architecture,time_reinvestment}',
          jsonb_build_object(
            'version','time-reinvestment-v2-box-selected-candidate-refinalize',
            'mode','ACTIVE',
            'applied',true,
            'destination','WOD',
            'fast_path',true,
            'fast_path_kind','SELECTED_CANDIDATE_REFINALIZE',
            'full_c4_research_skipped',true,
            'canonical_quality_gate_repassed',true,
            'minutes_added',v_added,
            'wod_minutes_before',v_current_wod,
            'wod_minutes_after',v_actual,
            'base_wod_target_minutes',v_base_target,
            'opportunistic_solver_target_minutes',v_try,
            'current_whole_wod_fit',round(v_current_fit,2),
            'new_whole_wod_fit',round(v_fit,2),
            'quality_delta',round(v_fit-v_current_fit,2),
            'quality_delta_floor',v_quality_floor,
            'available_unused_minutes_before',v_unallocated,
            'available_unused_minutes_after',greatest(0,p_duration_minutes-v_planned),
            'duration_is_maximum_not_fill_target',true,
            'not_mandatory_fill',true,
            'max_opportunistic_addition_minutes',v_max_addition
          ),
          true
        );
      end if;
    end if;

    exit when v_attempt_bonus<=2;
    v_attempt_bonus:=greatest(2,v_attempt_bonus-2);
  end loop;

  -- No shortcut is accepted unless the existing quality rules pass. The old
  -- full solver remains the exact fallback for uncommon cases.
  return public.c4_reinvest_available_time_v1(
    p_user_id,p_plan,p_session_intent,p_focus,p_duration_minutes,p_readiness,
    p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,
    p_max_difficulty,p_candidate_count,p_policy_key
  );
end;
$function$;

create or replace function public.c4_plan_full_session_pre_skill_focus_v2_shadow(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_mechanic_apply boolean:=false;
  v_context_apply boolean:=false;
  v_context jsonb;
  v_intent jsonb;
  v_skill_target jsonb;
  v_intent_key text:='CLASSIC';
  v_plan jsonb;
  v_skill_app jsonb;
  v_anchor date:=public.ugerod_effective_session_anchor_date_v1();
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select
    coalesce((config#>>'{mechanic_policy,apply_enabled}')::boolean,false),
    coalesce((config#>>'{context_opportunity,apply_enabled}')::boolean,false)
  into v_mechanic_apply,v_context_apply
  from public.session_engine_policy
  where policy_key=p_policy_key;

  v_context:=jsonb_build_object(
    'status','READY',
    'focus',p_focus,
    'progression_intent',p_progression_intent,
    'target_region',p_target_region,
    'readiness',p_readiness,
    'duration_minutes',p_duration_minutes,
    'reason_codes','[]'::jsonb
  );

  v_intent:=public.program_coach_session_intent_shadow_v3(
    p_user_id,v_anchor,v_context,p_duration_minutes,p_readiness
  );
  v_context:=v_context||jsonb_build_object(
    'session_intent_v2',v_intent,
    'session_intent_shadow',v_intent
  );

  v_skill_target:=public.program_coach_skill_target_shadow_v2(
    p_user_id,v_anchor,v_context
  );
  v_intent_key:=upper(coalesce(v_intent->>'proposed_session_intent','CLASSIC'));

  if v_mechanic_apply then
    v_plan:=public.c4_plan_full_session_pre_preparation_v13_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  elsif v_intent_key='CLASSIC' then
    v_plan:=public.c4_plan_full_session_pre_preparation_v13(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  else
    v_plan:=public.c4_plan_full_session_pre_preparation_v13_mechanic_policy_shadow(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
  end if;

  if coalesce(v_plan->>'status','')<>'READY' then
    return v_plan||jsonb_build_object(
      'coach_v2_shadow',jsonb_build_object(
        'status','BASE_PLAN_NOT_READY',
        'session_intent',v_intent,
        'skill_target',v_skill_target
      )
    );
  end if;

  if coalesce(v_skill_target->>'status','')='PROPOSED' then
    v_plan:=public.c4_apply_skill_target_shadow_v1(
      p_user_id,v_plan,v_skill_target,p_zone_terms,p_inventory,p_target_region,
      p_max_complexity,p_progression_intent,p_readiness
    );
    v_skill_app:=coalesce(v_plan#>'{architecture,skill_target_shadow_application}','{}'::jsonb);
    if v_skill_app<>'{}'::jsonb then
      v_skill_app:=v_skill_app||jsonb_build_object(
        'mode','SHADOW_V2',
        'version','skill-target-v2-shadow-application'
      );
      v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2_application}',v_skill_app,true);
    end if;
  end if;

  v_plan:=public.c4_reinvest_available_time_v2(
    p_user_id,v_plan,v_intent_key,p_focus,p_duration_minutes,p_readiness,p_target_region,
    p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
    p_candidate_count,p_policy_key
  );

  v_plan:=public.c4_apply_pattern_complement_plan_v1(
    p_user_id,v_plan,
    v_context||jsonb_build_object('skill_target_shadow',v_skill_target),
    v_anchor,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if v_context_apply then
    v_plan:=public.c4_apply_equipment_opportunity_v1(
      p_user_id,v_plan,v_context,v_anchor,p_focus,p_duration_minutes,p_readiness,p_target_region,
      p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,
      p_candidate_count,p_policy_key
    );
  end if;

  v_plan:=public.c4_apply_local_fatigue_complement_v1(
    p_user_id,v_plan,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan:=public.c4_apply_preparation_quality_v3(
    p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_plan:=public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_v2}',v_intent,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2}',v_skill_target,true);
  v_plan:=jsonb_set(v_plan,'{architecture,session_intent_v2_authority}','"SHADOW"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,skill_target_v2_authority}','"SHADOW"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,coach_v2_generation_authority}','false'::jsonb,true);
  return v_plan;
end;
$function$;
