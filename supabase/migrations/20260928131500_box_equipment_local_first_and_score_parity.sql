-- PERF-013: BOX preserves exact selection score on fast WOD reinvestment
-- and tries the already quality-gated local equipment substitution before an
-- expensive full-session C4 re-search.

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
  v_red jsonb;
  v_weights jsonb;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_selection_score numeric;
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

  v_weights:=coalesce(
    r#>'{selected_candidate,c4_selection_weights_effective}',
    jsonb_build_object(
      'coach_score',0.55,
      'whole_wod_fit',0.30,
      'anti_redundancy',0.15
    )
  );
  v_weight_coach:=coalesce(nullif(v_weights->>'coach_score','')::numeric,0.55);
  v_weight_whole:=coalesce(nullif(v_weights->>'whole_wod_fit','')::numeric,0.30);
  v_weight_red:=coalesce(nullif(v_weights->>'anti_redundancy','')::numeric,0.15);

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

        -- Same candidate composition/mechanic: anti-redundancy is unchanged in
        -- meaning, but recompute from the canonical snapshot so the selection
        -- score remains exactly comparable to a full C4 solve.
        v_red:=public.c4_redundancy_score_from_snapshot_v1(
          v_candidate,
          public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key)
        );

        v_selection_score:=round(
          coalesce(nullif(v_candidate->>'coach_score','')::numeric,0)*v_weight_coach
          +v_fit*v_weight_whole
          +coalesce(nullif(v_red->>'score','')::numeric,0)*v_weight_red,
          2
        );

        v_candidate:=v_candidate||jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_selection_score,
          'c4_selection_weights_effective',v_weights
        );

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
        r:=jsonb_set(r,'{wod_solver,anti_redundancy}',v_red,true);
        r:=jsonb_set(r,'{wod_solver,selection_score}',to_jsonb(v_selection_score),true);

        return jsonb_set(
          r,
          '{architecture,time_reinvestment}',
          jsonb_build_object(
            'version','time-reinvestment-v2.1-box-selected-candidate-refinalize',
            'mode','ACTIVE',
            'applied',true,
            'destination','WOD',
            'fast_path',true,
            'fast_path_kind','SELECTED_CANDIDATE_REFINALIZE',
            'full_c4_research_skipped',true,
            'canonical_quality_gate_repassed',true,
            'canonical_selection_score_recomputed',true,
            'minutes_added',v_added,
            'wod_minutes_before',v_current_wod,
            'wod_minutes_after',v_actual,
            'base_wod_target_minutes',v_base_target,
            'opportunistic_solver_target_minutes',v_try,
            'current_whole_wod_fit',round(v_current_fit,2),
            'new_whole_wod_fit',round(v_fit,2),
            'selection_score',v_selection_score,
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

  return public.c4_reinvest_available_time_v1(
    p_user_id,p_plan,p_session_intent,p_focus,p_duration_minutes,p_readiness,
    p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,
    p_max_difficulty,p_candidate_count,p_policy_key
  );
end;
$function$;

create or replace function public.c4_apply_equipment_opportunity_v1(
  p_user_id uuid,
  p_plan jsonb,
  p_session_context jsonb default '{}'::jsonb,
  p_anchor_date date default current_date,
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
set search_path to 'public'
as $function$
declare
  v_session jsonb;
  v_session_diag jsonb;
  v_legacy jsonb;
  v_legacy_diag jsonb;
  v_readiness text:=public.normalize_session_readiness(coalesce(p_readiness,'normal'));
  v_progress text:=upper(coalesce(p_progression_intent,''));
  v_env text:=public.normalize_session_environment_v1(
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN')
  );
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  if coalesce(p_plan->>'status','')<>'READY' then return p_plan; end if;

  if v_readiness='low' or v_progress='DELOAD' then
    return jsonb_set(coalesce(p_plan,'{}'::jsonb),'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v2-recovery-guardrail',
      'mode','ACTIVE',
      'applied',false,
      'session_level_applied',false,
      'reason',case when v_readiness='low' then 'LOW_READINESS_SUPPRESSES_EQUIPMENT_OPPORTUNITY' else 'DELOAD_SUPPRESSES_EQUIPMENT_OPPORTUNITY' end,
      'recovery_and_load_override_equipment_preference',true,
      'no_equipment_solver_invoked',true,
      'contract',jsonb_build_object(
        'hard_gates_override',true,
        'recovery_overrides_soft_equipment_opportunity',true,
        'never_force_equipment_use',true,
        'creates_training_debt',false
      )
    ),true);
  end if;

  -- BOX first attempts the existing single-exercise quality-gated substitution.
  -- This is the same fallback the legacy path used after a full 20-candidate
  -- session re-search. If it succeeds, the expensive search was unnecessary.
  if v_env='BOX' then
    v_legacy:=public.c4_apply_equipment_opportunity_v1_legacy(
      p_user_id,p_plan,p_session_context,p_anchor_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
    );
    v_legacy_diag:=coalesce(v_legacy#>'{architecture,equipment_opportunity}','{}'::jsonb);

    if coalesce((v_legacy_diag->>'applied')::boolean,false) then
      v_legacy_diag:=v_legacy_diag||jsonb_build_object(
        'version','equipment-opportunity-v3-box-local-first',
        'fast_path',true,
        'fast_path_kind','QUALITY_GATED_LOCAL_SUBSTITUTION',
        'session_level_attempt',jsonb_build_object(
          'mode','SKIPPED',
          'reason','LOCAL_EQUIVALENT_ALREADY_PASSED_HARD_GATES_AND_QUALITY_FLOOR',
          'full_c4_research_skipped',true
        ),
        'fallback_scope','SINGLE_EXERCISE_QUALITY_GATED_FIRST_FOR_BOX'
      );
      return jsonb_set(v_legacy,'{architecture,equipment_opportunity}',v_legacy_diag,true);
    end if;
  end if;

  -- Existing session-level search remains the fallback when the local fast path
  -- cannot find a safe coherent equipment opportunity.
  v_session:=public.c4_apply_equipment_opportunity_session_v2(
    p_user_id,p_plan,p_session_context,p_anchor_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  v_session_diag:=coalesce(v_session#>'{architecture,equipment_opportunity}','{}'::jsonb);

  if coalesce((v_session_diag->>'session_level_applied')::boolean,false)
     or v_session_diag->>'reason'='OPPORTUNITY_ALREADY_SATISFIED_IN_TRAINING_BLOCK' then
    return v_session;
  end if;

  v_legacy:=public.c4_apply_equipment_opportunity_v1_legacy(
    p_user_id,p_plan,p_session_context,p_anchor_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  v_legacy_diag:=coalesce(v_legacy#>'{architecture,equipment_opportunity}','{}'::jsonb);
  v_legacy_diag:=v_legacy_diag||jsonb_build_object(
    'version','equipment-opportunity-v3-box-local-first',
    'session_level_attempt',v_session_diag,
    'fallback_scope','SINGLE_EXERCISE_ONLY_WHEN_SESSION_LEVEL_EQUIVALENT_PLAN_NOT_AVAILABLE'
  );
  return jsonb_set(v_legacy,'{architecture,equipment_opportunity}',v_legacy_diag,true);
end;
$function$;
