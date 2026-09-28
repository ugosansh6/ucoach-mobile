-- PERF-015: BOX exact prepared-candidate replay between provisional and canonical WOD budgets.
-- No candidate is removed, no quality gate is skipped, and the old full solver remains fallback.
-- Only C2/expand/prepare work already completed earlier in the same generation is reused.

CREATE OR REPLACE FUNCTION public.solve_session_engine_c4_mechanic_policy_shadow_v1_legacy_p15(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 10, p_exact_wod_minutes integer DEFAULT NULL::integer, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb; v_red_snapshot jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
  v_tiebreak jsonb;
  v_effective_weights jsonb;
  v_top_score numeric;
  v_equivalent_delta numeric;
  v_long_min int;
  v_selected_wod int;
  v_tiebreak_wod int;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  if p_focus='Conditioning' then
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );

  v_c2 := public.simulate_session_engine_c2_mechanic_policy_shadow_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.7',
      'status','NO_SAFE_COHERENT_WOD',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'selected_candidate',null,
      'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,
      'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_red_snapshot:=public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key); for v_candidate in
    select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(
      v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default'
    );
    v_gate := public.c4_candidate_quality_gate_v2(
      v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
    );
    v_red := public.c4_redundancy_score_from_snapshot_v1(v_final,v_red_snapshot);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,
        2
      );

      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(
          select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb)
          from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x
        ),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      x
      order by
        (x->>'c4_selection_score')::numeric desc,
        (x->>'coach_score')::numeric desc
    ),
    '[]'::jsonb
  )
  into v_sorted
  from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.7',
      'status','NO_FINAL_CANDIDATE',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'selected_candidate',null,
      'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,
      'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_selected := v_sorted->0;
  v_long_min:=coalesce((v_cfg#>>'{long_session_selection,min_duration_minutes}')::int,75);
  v_equivalent_delta:=coalesce((v_cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);

  if p_duration_minutes>=v_long_min and p_exact_wod_minutes is not null then
    v_top_score:=coalesce((v_selected->>'c4_selection_score')::numeric,0);

    select x
    into v_tiebreak
    from jsonb_array_elements(v_sorted) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=v_top_score-v_equivalent_delta
    order by
      coalesce(nullif(x#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0) desc,
      coalesce((x->>'c4_selection_score')::numeric,0) desc,
      coalesce((x->>'coach_score')::numeric,0) desc
    limit 1;

    if v_tiebreak is not null then
      v_selected_wod:=coalesce(nullif(v_selected#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      v_tiebreak_wod:=coalesce(nullif(v_tiebreak#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);

      if v_tiebreak_wod>v_selected_wod then
        v_selected:=v_tiebreak||jsonb_build_object(
          'c4_long_session_utilization_tiebreak',jsonb_build_object(
            'used',true,
            'quality_equivalence_delta',v_equivalent_delta,
            'original_top_score',v_top_score,
            'selected_score',(v_tiebreak->>'c4_selection_score')::numeric,
            'original_wod_minutes',v_selected_wod,
            'selected_wod_minutes',v_tiebreak_wod,
            'reason','prefer_more_usable_time_only_inside_equivalent_quality_band'
          )
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'version','c4-final-v1.7',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.c4_apply_session_architecture_v2_legacy_p15(p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_targets jsonb;
  v_readiness text:=public.normalize_session_readiness(p_readiness);
  v_unlock_min int;
  v_unlock_count int;
  v_tabata_min int;
  v_warmup_min int;
  v_warmup_count int;
  v_skill_target int:=0;
  v_skill_current int:=0;
  v_wod_target int;
  v_wod_limit int;
  v_wod_try int;
  v_wod_actual int;
  v_transition int;
  v_min_wod int;
  v_tabata_exception_max int;
  v_include_tabata boolean:=false;
  v_skill_block jsonb:=null;
  v_skill_exercises jsonb:='[]'::jsonb;
  v_skill_reason text;
  v_skill_resolution jsonb:='{}'::jsonb;
  v_skill_id text;
  v_skill_pres jsonb;
  v_skill_contract jsonb;
  v_wod jsonb:=null;
  v_candidate jsonb:=null;
  v_wod_block jsonb;
  v_mechanic text;
  v_unlock jsonb:='[]'::jsonb;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_target_ids text[]:='{}'::text[];
  v_target_patterns text[]:='{}'::text[];
  v_selected_ids text[]:='{}'::text[];
  v_pres jsonb;
  v_active int;
  v_planned int;
  v_unallocated int;
  v_original_skill int:=0;
  rec record;
begin
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  v_targets:=public.c4_session_architecture_targets_v2(p_duration_minutes,p_policy_key);
  v_unlock_min:=coalesce((v_targets->>'unlock_minutes')::int,2);
  v_unlock_count:=coalesce((v_targets->>'unlock_exercise_count')::int,2);
  v_tabata_min:=coalesce((v_targets->>'tabata_minutes')::int,4);
  v_warmup_min:=coalesce((v_targets->>'warmup_minutes')::int,4);
  v_warmup_count:=coalesce((v_targets->>'warmup_exercise_count')::int,3);
  v_wod_target:=coalesce((v_targets->>'wod_target_minutes')::int,15);
  if v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' then
    v_wod_target:=least(v_wod_target,20);
  end if;
  v_min_wod:=coalesce((v_targets->>'minimum_wod_minutes')::int,8);
  v_tabata_exception_max:=coalesce((v_targets->>'tabata_exception_max_duration')::int,30);

  select b into v_skill_block
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='skill'
  limit 1;

  if v_skill_block is not null then
    v_skill_current:=coalesce(nullif(v_skill_block->>'duration_minutes','')::int,nullif(r#>>'{architecture,skill_minutes}','')::int,0);
    v_original_skill:=v_skill_current;
    if v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' then
      v_skill_target:=v_skill_current;
    elsif p_duration_minutes<=30 then
      v_skill_target:=least(
        v_skill_current,
        coalesce(nullif(v_targets->>'skill_target_minutes','')::int,v_skill_current)
      );
    else
      v_skill_target:=greatest(v_skill_current,coalesce((v_targets->>'skill_target_minutes')::int,0));
    end if;
    v_skill_reason:=coalesce(r#>>'{architecture,skill_reason}',v_skill_block#>>'{expected_outcome,skill_reason}');
    v_skill_exercises:=coalesce(v_skill_block->'exercises','[]'::jsonb);
  end if;

  -- Core Tabata: daily default whenever a safe Core movement exists.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*
    from public.exercises e
    where 'Core'=any(e.usable_for)
      and coalesce(e.tabata_eligible,false)
      and not coalesce(e.warmup_only,false)
      and e.exercise_family='Core'
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=4
      and coalesce(e.joint_impact,99)<=3
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      public.c4_tabata_variety_penalty_v1(p_user_id,e.id) asc,
      coalesce(e.selection_weight,0) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_tabata)>=2;
    if not (rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))
       and not exists(select 1 from jsonb_array_elements(v_tabata) x where x->>'pattern'=rec.movement_pattern) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'TABATA',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','tabata','protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'),'core_daily_training',true,'tabata_side_switch',lower(coalesce(rec.movement_side,''))='unilateral','text',case when lower(coalesce(rec.movement_side,''))='unilateral' then '20s travail · change de côté à chaque passage' else null end);
      v_tabata:=v_tabata||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','tabata','protocol','20_on_10_off_x8','core_only',true,'core_daily_training',true,'pain_gate',true,'equipment_gate',true)
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;
  v_include_tabata:=jsonb_array_length(v_tabata)>0;
  if not v_include_tabata then v_tabata_min:=0; end if;

  v_transition:=2
    +case when v_include_tabata then 1 else 0 end
    +case when v_skill_target>0 then 1 else 0 end
    +case when p_duration_minutes>=75 then 1 else 0 end
    +case when v_readiness='low' then 1 else 0 end;

  v_wod_limit:=p_duration_minutes-v_unlock_min-v_tabata_min-v_warmup_min-v_skill_target-v_transition;

  -- Only 20/30 min sessions may sacrifice Tabata for time; safety can always remove it.
  if v_wod_limit<v_min_wod and v_include_tabata and p_duration_minutes<=v_tabata_exception_max then
    v_include_tabata:=false;
    v_tabata_min:=0;
    v_tabata:='[]'::jsonb;
    v_transition:=2
      +case when v_skill_target>0 then 1 else 0 end
      +case when p_duration_minutes>=75 then 1 else 0 end
      +case when v_readiness='low' then 1 else 0 end;
    v_wod_limit:=p_duration_minutes-v_unlock_min-v_warmup_min-v_skill_target-v_transition;
  end if;

  if v_wod_limit<v_min_wod then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_TIME_BUDGET_AFTER_V2_PREPARATION',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_wod_limit:=least(v_wod_target,v_wod_limit);

  for v_wod_try in
    select distinct x
    from unnest(array[v_wod_limit,v_wod_target,35,30,25,20,15,12,10,9,8]) x
    where x between v_min_wod and v_wod_limit
    order by x desc
  loop
    if coalesce((
      select (config#>>'{mechanic_policy,apply_enabled}')::boolean
      from public.session_engine_policy
      where policy_key=p_policy_key
    ),false) then
      v_wod:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
      );
    else
      v_wod:=public.solve_session_engine_c4(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
      );
    end if;
    if coalesce(v_wod->>'status','')='READY' and v_wod->'selected_candidate' is not null then
      v_candidate:=v_wod->'selected_candidate';
      exit;
    end if;
  end loop;

  if v_candidate is null then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_COHERENT_V2_WOD',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_mechanic:=upper(coalesce(v_candidate->>'mechanic',''));
  v_wod_actual:=case
    when v_mechanic='SETS_REPS'
      and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
    then least(
      coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_wod_try),
      greatest(10,ceil(nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0)::int)
    )
    else coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_wod_try)
  end;

  -- Re-resolve Skill against the final V2 WOD and rebuild its contract with the new duration.
  if v_skill_target>0 and jsonb_array_length(v_skill_exercises)>0 then
    v_skill_resolution:=public.c57_resolve_skill_wod_distinctness(
      p_user_id,v_skill_exercises,coalesce(v_candidate->'exercises','[]'::jsonb),coalesce(r->'stimulus','{}'::jsonb),
      v_skill_reason,v_skill_target,p_progression_intent,p_inventory,p_zone_terms,p_target_region,p_max_complexity
    );
    if v_skill_resolution->>'status'='DUPLICATE_REPLACED_SAFE_ALTERNATIVE' then
      v_skill_exercises:=coalesce(v_skill_resolution->'exercises','[]'::jsonb);
    end if;

    v_skill_id:=v_skill_exercises#>>'{0,exercise_id}';
    v_skill_pres:=coalesce(v_skill_exercises#>'{0,prescription}','{}'::jsonb);
    if v_skill_id is not null then
      v_skill_contract:=public.c4_skill_contract_v1(p_user_id,v_skill_id,v_skill_reason,v_skill_target,p_progression_intent,p_readiness,v_skill_pres);
      v_skill_pres:=v_skill_pres||coalesce(v_skill_contract->'prescription_patch','{}'::jsonb);
      select coalesce(jsonb_agg(
        case when ord=1 then e||jsonb_build_object(
          'prescription',v_skill_pres,
          'expected_outcome',coalesce(e->'expected_outcome','{}'::jsonb)||jsonb_build_object(
            'skill_objective_type',v_skill_contract->>'objective_type',
            'score_required',coalesce((v_skill_contract->>'score_required')::boolean,false),
            'score_metric',v_skill_contract->>'score_metric'
          )
        ) else jsonb_set(e,'{prescription,target_duration_minutes}',to_jsonb(v_skill_target),true) end
        order by ord
      ),'[]'::jsonb)
      into v_skill_exercises
      from jsonb_array_elements(v_skill_exercises) with ordinality z(e,ord);

      v_skill_block:=v_skill_block||jsonb_build_object(
        'block_key','skill','block_name','Skill / Development','duration_minutes',v_skill_target,'exercises',v_skill_exercises,
        'structure',v_skill_contract->>'structure',
        'objective',(v_skill_contract->>'objective_title')||' — '||(v_skill_contract->>'objective_description'),
        'skill_contract',v_skill_contract,
        'expected_outcome',coalesce(v_skill_block->'expected_outcome','{}'::jsonb)||jsonb_build_object(
          'role','skill_development','skill_reason',v_skill_reason,'contract_version','skill-contract-v2'
        )
      );
    end if;
  end if;

  select coalesce(array_agg(distinct id),'{}'::text[])
  into v_target_ids
  from (
    select e->>'exercise_id' id from jsonb_array_elements(coalesce(v_skill_exercises,'[]'::jsonb)) e
    union all
    select e->>'exercise_id' id from jsonb_array_elements(coalesce(v_candidate->'exercises','[]'::jsonb)) e
  ) q
  where id is not null;

  select coalesce(array_agg(distinct movement_pattern) filter(where movement_pattern is not null),'{}'::text[])
  into v_target_patterns
  from public.exercises
  where id=any(v_target_ids);

  -- UNLOCK: short mobility-only block, intentionally not the session-specific warm-up.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*
    from public.exercises e
    where 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and e.warmup_role='mobility'
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case when p_target_region is not null and p_target_region<>'Full Body' and e.body_region=p_target_region then 0 else 1 end,
      3*(select count(*) from public.workout_session_exercises wse where wse.exercise_id=e.id
         and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6)) asc,
      coalesce(e.selection_weight,0) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_unlock)>=v_unlock_count;
    if not(rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids))) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','unlock','unlock_role','mobility','target_duration_minutes',v_unlock_min,'fatigue_target','minimal');
      v_unlock:=v_unlock||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','unlock','goal','unlock_mobility_without_fatigue','pain_gate',true,'equipment_gate',true)
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;
  if jsonb_array_length(v_unlock)=0 then v_unlock_min:=0; end if;

  -- SPECIFIC WARM-UP: direct preparation links first; mobility is deliberately excluded.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*,max(l.priority) link_priority,count(distinct l.target_exercise_id) target_coverage
    from public.exercise_preparation_links l
    join public.exercises e on e.id=l.warmup_exercise_id
    where l.active and l.target_exercise_id=any(v_target_ids)
      and 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and e.warmup_role in ('activation','movement_prep','pulse_raiser')
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    group by e.id
    order by target_coverage desc,(max(l.priority)+coalesce(e.selection_weight,0)
      -3*(select count(*) from public.workout_session_exercises wse where wse.exercise_id=e.id and wse.block_key='warm_up'
          and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6))) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_warmup)>=v_warmup_count;
    if not(rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids))) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',rec.warmup_role,'target_duration_minutes',v_warmup_min,'specific_preparation_link',true,'prepares_exercise_ids',to_jsonb(v_target_ids));
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','specific_preparation_for_skill_and_wod','pain_gate',true,'equipment_gate',true,'specific_preparation_link',true,'prepares_exercise_ids',to_jsonb(v_target_ids))
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;

  if jsonb_array_length(v_warmup)<v_warmup_count then
    for rec in
      select e.*
      from public.exercises e
      where 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and e.warmup_role in ('activation','movement_prep','pulse_raiser')
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and not(e.id=any(v_selected_ids))
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
      order by
        case when e.movement_pattern=any(v_target_patterns) then 0 else 1 end,
        case when e.warmup_role='movement_prep' then 0 when e.warmup_role='activation' then 1 else 2 end,
        coalesce(e.selection_weight,0) desc,e.id
    loop
      exit when jsonb_array_length(v_warmup)>=v_warmup_count;
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',rec.warmup_role,'target_duration_minutes',v_warmup_min,'specific_preparation_link',false,'prepares_patterns',to_jsonb(v_target_patterns));
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','specific_preparation_for_skill_and_wod','pain_gate',true,'equipment_gate',true,'specific_preparation_link',false,'prepares_patterns',to_jsonb(v_target_patterns))
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end loop;
  end if;

  if jsonb_array_length(v_warmup)=0 then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_SPECIFIC_WARMUP',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_wod_block:=jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_actual,'required',true,
    'mechanic',v_candidate->>'mechanic','mechanic_json',v_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus','predicted_volume',v_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_candidate#>'{c4_final,whole_wod_metrics}'
    )
  );

  if v_unlock_min>0 then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','unlock','block_name','Unlock','duration_minutes',v_unlock_min,'required',true,'exercises',v_unlock,
      'structure','Mobilité / déverrouillage · faible fatigue',
      'expected_outcome',jsonb_build_object('role','unlock','goal','mobility_and_joint_access','fatigue_ceiling','minimal')
    ));
  end if;

  if v_include_tabata then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',true,
      'structure','8 rounds — 20s travail / 10s repos','exercises',v_tabata,
      'expected_outcome',jsonb_build_object('role','core_training','protocol','tabata_4min','daily_default',true)
    ));
  end if;

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','warmup','block_name','Warm-up spécifique','duration_minutes',v_warmup_min,'required',true,'exercises',v_warmup,
    'structure','Préparation directe du Skill et du WOD',
    'expected_outcome',jsonb_build_object('role','specific_preparation','fatigue_ceiling','low','prepares_exercise_ids',to_jsonb(v_target_ids))
  ));

  if v_skill_target>0 and v_skill_block is not null then
    v_blocks:=v_blocks||jsonb_build_array(v_skill_block);
  end if;
  v_blocks:=v_blocks||jsonb_build_array(v_wod_block);

  v_active:=v_unlock_min+v_tabata_min+v_warmup_min+v_skill_target+v_wod_actual;
  v_planned:=v_active+v_transition;
  v_unallocated:=greatest(0,p_duration_minutes-v_planned);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{selected_candidate}',v_candidate,true);
  r:=jsonb_set(r,'{wod_solver}',jsonb_build_object(
    'version',v_wod->'version','candidate_count',v_wod->'candidate_count',
    'quality_gate',v_candidate->'c4_quality_gate','anti_redundancy',v_candidate->'c4_anti_redundancy',
    'selection_score',v_candidate->'c4_selection_score','architecture_v2_recompiled',true
  ),true);

  r:=jsonb_set(r,'{architecture}',coalesce(r->'architecture','{}'::jsonb)||jsonb_build_object(
    'version','session-architecture-v2',
    'block_order',jsonb_build_array('unlock','tabata','warmup','skill','wod'),
    'total_minutes',p_duration_minutes,
    'unlock_minutes',v_unlock_min,
    'tabata_minutes',v_tabata_min,
    'warmup_minutes',v_warmup_min,
    'skill_minutes',v_skill_target,
    'wod_minutes',v_wod_actual,
    'wod_target_minutes',v_wod_target,
    'preparation_minutes',v_unlock_min+v_tabata_min+v_warmup_min,
    'transition_recovery_minutes',v_transition,
    'active_training_minutes',v_active,
    'active_block_budget_minutes',v_active,
    'planned_minutes',v_planned,
    'unallocated_available_minutes',v_unallocated,
    'duration_is_maximum_not_fill_target',true,
    'unlock_required',v_unlock_min>0,
    'unlock_exercise_count',jsonb_array_length(v_unlock),
    'tabata_core_daily_default',true,
    'tabata_included',v_include_tabata,
    'tabata_exception_window',p_duration_minutes<=v_tabata_exception_max,
    'tabata_safety_override',not v_include_tabata and p_duration_minutes>v_tabata_exception_max,
    'specific_warmup_required',true,
    'specific_warmup_exercise_count',jsonb_array_length(v_warmup),
    'specific_warmup_target_exercise_ids',to_jsonb(v_target_ids),
    'skill_reason',v_skill_reason,
    'skill_target_minutes',coalesce((v_targets->>'skill_target_minutes')::int,0),
    'wod_duration_profile',case when p_duration_minutes<=60 then 'compact_standard' else 'long_session_allowed' end,
    'block_budget_version','session-architecture-v2',
    'long_session_development_contract',jsonb_build_object(
      'applied',v_skill_target>v_original_skill,
      'base_skill_minutes',v_original_skill,
      'final_skill_minutes',v_skill_target,
      'quality_time_not_forced_volume',true,
      'wod_not_stretched_to_fill_session',true
    ),
    'session_architecture_v2_contract',jsonb_build_object(
      'version','session-architecture-v2','applied',true,
      'unlock_separate_from_specific_warmup',true,
      'tabata_core_daily_default',true,
      'specific_warmup_derived_from_final_skill_and_wod',true,
      'short_session_warmup_condensed',p_duration_minutes<=30,
      'skill_development_time_expanded',p_duration_minutes>=45,
      'wod_compact_through_60',p_duration_minutes<=60,
      'long_wod_allowed_75_90',p_duration_minutes>=75,
      'duration_is_maximum_not_fill_target',true
    )
  ),true);

  r:=jsonb_set(r,'{skill_wod_distinctness}',coalesce(v_skill_resolution,'{}'::jsonb),true);
  return r;
end;
$function$;


CREATE OR REPLACE FUNCTION public.solve_session_engine_c4_mechanic_policy_shadow_v1(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 10, p_exact_wod_minutes integer DEFAULT NULL::integer, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb; v_red_snapshot jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
  v_tiebreak jsonb;
  v_effective_weights jsonb;
  v_top_score numeric;
  v_equivalent_delta numeric;
  v_long_min int;
  v_selected_wod int;
  v_tiebreak_wod int;
  v_prepared_cache jsonb := '[]'::jsonb;
  v_cache_signature text;
  v_effective_candidate_count int:=greatest(5,least(coalesce(p_candidate_count,10),20));
  v_env text:=public.normalize_session_environment_v1(coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN'));
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  if p_focus='Conditioning' then
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );

  v_c2 := public.simulate_session_engine_c2_mechanic_policy_shadow_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if v_env='BOX' then
    v_cache_signature:=md5(jsonb_build_object(
      'user_id',p_user_id,
      'focus',p_focus,
      'duration_minutes',p_duration_minutes,
      'readiness',p_readiness,
      'target_region',p_target_region,
      'progression_intent',p_progression_intent,
      'zone_terms',to_jsonb(coalesce(p_zone_terms,'{}'::text[])),
      'inventory',coalesce(p_inventory,'[]'::jsonb),
      'max_complexity',p_max_complexity,
      'max_difficulty',p_max_difficulty,
      'candidate_count',v_effective_candidate_count,
      'policy_key',p_policy_key,
      'environment_code',v_env
    )::text);
  end if;

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.7',
      'status','NO_SAFE_COHERENT_WOD',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'selected_candidate',null,
      'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,
      'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_red_snapshot:=public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key); for v_candidate in
    select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    if v_env='BOX' then
      v_prepared_cache:=v_prepared_cache||jsonb_build_array(v_prepared);
    end if;
    v_final := public.c4_finalize_candidate(
      v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default'
    );
    v_gate := public.c4_candidate_quality_gate_v2(
      v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
    );
    v_red := public.c4_redundancy_score_from_snapshot_v1(v_final,v_red_snapshot);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,
        2
      );

      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(
          select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb)
          from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x
        ),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      x
      order by
        (x->>'c4_selection_score')::numeric desc,
        (x->>'coach_score')::numeric desc
    ),
    '[]'::jsonb
  )
  into v_sorted
  from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.7',
      'status','NO_FINAL_CANDIDATE',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'selected_candidate',null,
      'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,
      'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_selected := v_sorted->0;
  v_long_min:=coalesce((v_cfg#>>'{long_session_selection,min_duration_minutes}')::int,75);
  v_equivalent_delta:=coalesce((v_cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);

  if p_duration_minutes>=v_long_min and p_exact_wod_minutes is not null then
    v_top_score:=coalesce((v_selected->>'c4_selection_score')::numeric,0);

    select x
    into v_tiebreak
    from jsonb_array_elements(v_sorted) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=v_top_score-v_equivalent_delta
    order by
      coalesce(nullif(x#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0) desc,
      coalesce((x->>'c4_selection_score')::numeric,0) desc,
      coalesce((x->>'coach_score')::numeric,0) desc
    limit 1;

    if v_tiebreak is not null then
      v_selected_wod:=coalesce(nullif(v_selected#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      v_tiebreak_wod:=coalesce(nullif(v_tiebreak#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);

      if v_tiebreak_wod>v_selected_wod then
        v_selected:=v_tiebreak||jsonb_build_object(
          'c4_long_session_utilization_tiebreak',jsonb_build_object(
            'used',true,
            'quality_equivalence_delta',v_equivalent_delta,
            'original_top_score',v_top_score,
            'selected_score',(v_tiebreak->>'c4_selection_score')::numeric,
            'original_wod_minutes',v_selected_wod,
            'selected_wod_minutes',v_tiebreak_wod,
            'reason','prefer_more_usable_time_only_inside_equivalent_quality_band'
          )
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'version','c4-final-v1.7',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  )
  || case when v_env='BOX' then jsonb_build_object(
    '_c4_prepared_cache',jsonb_build_object(
      'version','box-prepared-candidate-cache-v1',
      'signature',v_cache_signature,
      'candidate_count',v_effective_candidate_count,
      'prepared_candidates',v_prepared_cache,
      'stimulus',v_stimulus,
      'c2_coherence_gate',coalesce(v_c2->'coherence_gate','{}'::jsonb)
    )
  ) else '{}'::jsonb end;
end;
$function$;



create or replace function public.solve_session_engine_c4_mechanic_policy_shadow_full_from_cache_v1(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default',
  p_cache jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v_cfg jsonb;
  v_stimulus jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_red_snapshot jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb:='[]'::jsonb;
  v_rejected jsonb:='[]'::jsonb;
  v_sorted jsonb:='[]'::jsonb;
  v_selected jsonb;
  v_tiebreak jsonb;
  v_effective_weights jsonb;
  v_top_score numeric;
  v_equivalent_delta numeric;
  v_long_min int;
  v_selected_wod int;
  v_tiebreak_wod int;
  v_expected_signature text;
  v_effective_candidate_count int:=greatest(5,least(coalesce(p_candidate_count,10),20));
  v_env text:=public.normalize_session_environment_v1(coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN'));
  r jsonb;
begin
  if v_env<>'BOX'
     or coalesce(p_cache->>'version','')<>'box-prepared-candidate-cache-v1'
     or not coalesce((p_cache->>'source_full_wrapper_ready')::boolean,false)
     or coalesce((p_cache->>'candidate_count')::int,0)<>v_effective_candidate_count
     or jsonb_array_length(coalesce(p_cache->'prepared_candidates','[]'::jsonb))<>v_effective_candidate_count
  then
    return jsonb_build_object('status','CACHE_MISS','reason','CACHE_NOT_EXACTLY_REUSABLE');
  end if;

  v_expected_signature:=md5(jsonb_build_object(
    'user_id',p_user_id,
    'focus',p_focus,
    'duration_minutes',p_duration_minutes,
    'readiness',p_readiness,
    'target_region',p_target_region,
    'progression_intent',p_progression_intent,
    'zone_terms',to_jsonb(coalesce(p_zone_terms,'{}'::text[])),
    'inventory',coalesce(p_inventory,'[]'::jsonb),
    'max_complexity',p_max_complexity,
    'max_difficulty',p_max_difficulty,
    'candidate_count',v_effective_candidate_count,
    'policy_key',p_policy_key,
    'environment_code',v_env
  )::text);

  if coalesce(p_cache->>'signature','')<>v_expected_signature then
    return jsonb_build_object('status','CACHE_MISS','reason','CACHE_SIGNATURE_MISMATCH');
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if p_focus='Conditioning' then
    v_weight_coach:=coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole:=coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red:=coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach:=coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole:=coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red:=coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );
  v_stimulus:=p_cache->'stimulus';
  v_red_snapshot:=public.c4_redundancy_snapshot_v1(p_user_id,p_policy_key);

  for v_prepared in
    select value
    from jsonb_array_elements(coalesce(p_cache->'prepared_candidates','[]'::jsonb))
  loop
    v_final:=public.c4_finalize_candidate(
      v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default'
    );
    v_gate:=public.c4_candidate_quality_gate_v2(
      v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
    );
    v_red:=public.c4_redundancy_score_from_snapshot_v1(v_final,v_red_snapshot);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score:=round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach
        +coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole
        +coalesce((v_red->>'score')::numeric,0)*v_weight_red,
        2
      );
      v_accepted:=v_accepted||jsonb_build_array(
        v_final||jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected:=v_rejected||jsonb_build_array(jsonb_build_object(
        'mechanic',v_prepared->>'mechanic',
        'exercise_ids',(
          select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb)
          from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x
        ),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(
    jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),
    '[]'::jsonb
  )
  into v_sorted
  from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'status','CACHE_REPLAY_NO_FINAL_CANDIDATE',
      'reason','FULL_SOLVER_FALLBACK_REQUIRED'
    );
  end if;

  v_selected:=v_sorted->0;
  v_long_min:=coalesce((v_cfg#>>'{long_session_selection,min_duration_minutes}')::int,75);
  v_equivalent_delta:=coalesce((v_cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);

  if p_duration_minutes>=v_long_min and p_exact_wod_minutes is not null then
    v_top_score:=coalesce((v_selected->>'c4_selection_score')::numeric,0);
    select x into v_tiebreak
    from jsonb_array_elements(v_sorted) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=v_top_score-v_equivalent_delta
    order by
      coalesce(nullif(x#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0) desc,
      coalesce((x->>'c4_selection_score')::numeric,0) desc,
      coalesce((x->>'coach_score')::numeric,0) desc
    limit 1;

    if v_tiebreak is not null then
      v_selected_wod:=coalesce(nullif(v_selected#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      v_tiebreak_wod:=coalesce(nullif(v_tiebreak#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      if v_tiebreak_wod>v_selected_wod then
        v_selected:=v_tiebreak||jsonb_build_object(
          'c4_long_session_utilization_tiebreak',jsonb_build_object(
            'used',true,
            'quality_equivalence_delta',v_equivalent_delta,
            'original_top_score',v_top_score,
            'selected_score',(v_tiebreak->>'c4_selection_score')::numeric,
            'original_wod_minutes',v_selected_wod,
            'selected_wod_minutes',v_tiebreak_wod,
            'reason','prefer_more_usable_time_only_inside_equivalent_quality_band'
          )
        );
      end if;
    end if;
  end if;

  r:=jsonb_build_object(
    'version','c4-final-v1.7',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}',
    'search_fallback_used',false,
    'initial_candidate_count',v_effective_candidate_count,
    'final_candidate_count',v_effective_candidate_count,
    '_c4_prepared_cache',p_cache-'source_full_wrapper_ready'-'source_search_fallback_used'
  );

  r:=jsonb_set(r,'{version}','"c4-final-v1.7"'::jsonb,true);
  r:=public.c4_apply_protocol_retest_tiebreak_v1(p_user_id,r,p_progression_intent,p_policy_key);
  r:=public.c4_apply_quality_band_variety_v1(r,p_focus,p_policy_key);
  r:=jsonb_set(r,'{version}','"c4-final-v1.9-p2ab"'::jsonb,true);
  r:=public.c4_apply_mechanic_freshness_tiebreak_v1(p_user_id,r,p_policy_key);
  r:=public.c4_apply_movement_calibration_tiebreak_v1(p_user_id,r,p_progression_intent,p_policy_key);
  return jsonb_set(r,'{version}','"c4-final-v1.11-w1-calibration-mechanic-policy"'::jsonb,true);
end;
$function$;


CREATE OR REPLACE FUNCTION public.c4_plan_full_session_pre_skill_contract_mechanic_policy_shadow_(p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb;
  v_stimulus jsonb;
  v_warmup_min int;
  v_tabata_min int:=0;
  v_skill_min int:=0;
  v_wod_min int;
  v_transition_min int:=0;
  v_include_tabata boolean:=false;
  v_include_skill boolean:=false;
  v_skill_reason text:=null;
  v_warmup_count int;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_skill jsonb:='[]'::jsonb;
  v_wod jsonb;
  v_wod_candidate jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_pres jsonb;
  r record;
  v_target_patterns text[]:='{}'::text[];
  v_readiness_band text;
  v_min_wod int;
  v_base_transition int;
  v_optional_transition int;
  v_long_extra int;
  v_low_extra int;
  v_long_threshold int;
begin
  if p_duration_minutes<20 or p_duration_minutes>90 then
    raise exception 'Unsupported V1 session duration %',p_duration_minutes;
  end if;

  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;
  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  v_stimulus:=public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  );
  v_readiness_band:=public.normalize_session_readiness(p_readiness);

  v_warmup_min:=case when p_duration_minutes<=35 then 5 when p_duration_minutes<=60 then 6 else 7 end;
  v_warmup_count:=case when p_duration_minutes<=35 then 2 when p_duration_minutes<=60 then 3 else 4 end;

  v_include_tabata:=p_duration_minutes>=45;
  if v_include_tabata then v_tabata_min:=4; end if;

  if p_duration_minutes>=coalesce((v_cfg#>>'{skill_policy,min_session_minutes}')::int,45) then
    if p_focus in ('Strength','Muscle Gain') then
      v_include_skill:=true;
      v_skill_reason:='focus_development';
    elsif upper(coalesce(p_progression_intent,'')) in ('PROGRESS','CONSOLIDATE','EXPLORE') then
      v_include_skill:=true;
      v_skill_reason:='progression_intent';
    elsif upper(coalesce(p_progression_intent,''))='RECALIBRATE' then
      v_include_skill:=true;
      v_skill_reason:='recalibration_window';
    elsif exists(
      select 1
      from public.exercises e
      join public.user_exercise_coach_state s
        on s.user_id=p_user_id and s.exercise_id=e.id
      where 'Skill'=any(e.usable_for)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=3
        and coalesce(e.joint_impact,99)<=3
        and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
        and (
          upper(coalesce(s.recommendation,'')) in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE','LEARN','RECALIBRATE')
          or (s.capability_confidence is not null and s.capability_confidence<0.60)
          or (s.capability_freshness is not null and s.capability_freshness<0.60)
          or coalesce(s.valid_evidence_count,0)=1
        )
    ) then
      v_include_skill:=true;
      v_skill_reason:='capability_signal';
    elsif p_duration_minutes>=coalesce((v_cfg#>>'{skill_policy,targeted_long_session_min_minutes}')::int,75)
      and p_target_region is not null
      and p_target_region<>'Full Body'
    then
      v_include_skill:=true;
      v_skill_reason:='targeted_long_session';
    end if;
  end if;

  if v_include_skill then
    v_skill_min:=case
      when p_duration_minutes>=coalesce((v_cfg#>>'{block_budget,skill_very_long_threshold_minutes}')::int,90)
        then coalesce((v_cfg#>>'{block_budget,skill_minutes_very_long}')::int,12)
      when p_duration_minutes>=coalesce((v_cfg#>>'{block_budget,skill_long_threshold_minutes}')::int,75)
        then coalesce((v_cfg#>>'{block_budget,skill_minutes_long}')::int,10)
      else coalesce((v_cfg#>>'{block_budget,skill_minutes_standard}')::int,8)
    end;
  end if;

  select coalesce(array_agg(distinct movement_pattern),'{}'::text[])
  into v_target_patterns
  from public.exercises e
  where (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
    and 'WOD'=any(e.usable_for)
    and not coalesce(e.warmup_only,false)
    and e.technical_complexity<=p_max_complexity;

  for r in
    select e.*,
      case e.warmup_role when 'mobility' then 1 when 'activation' then 2 when 'movement_prep' then 3 when 'pulse_raiser' then 4 else 5 end role_rank,
      case when e.warmup_role='movement_prep' and e.movement_pattern=any(v_target_patterns) then 0 else 1 end prep_rank
    from public.exercises e
    where 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by prep_rank,role_rank,coalesce(e.selection_weight,0) desc,e.id
  loop
    exit when jsonb_array_length(v_warmup)>=v_warmup_count;
    if not exists(select 1 from jsonb_array_elements(v_warmup) x where x->>'warmup_role'=r.warmup_role)
       or jsonb_array_length(v_warmup)>=3 then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',r.warmup_role,'target_duration_minutes',v_warmup_min);
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'warmup_role',r.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','prepare_without_fatigue','warmup_role',r.warmup_role,'pain_gate',true,'equipment_gate',true)
      ));
    end if;
  end loop;

  if jsonb_array_length(v_warmup)<2 then
    return jsonb_build_object('version','c4-full-session-v1.1-budget','status','NO_SAFE_WARMUP','production_mutation',false,'stimulus',v_stimulus);
  end if;

  if v_include_tabata then
    for r in
      select e.*
      from public.exercises e
      where 'Core'=any(e.usable_for)
        and coalesce(e.tabata_eligible,false)
        and not coalesce(e.warmup_only,false)
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and coalesce(e.fatigue_score,99)<=4
        and coalesce(e.joint_impact,99)<=3
        and e.exercise_family='Core'
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
      order by case when e.body_region='Core' then 0 else 1 end,coalesce(e.selection_weight,0) desc,e.id
    loop
      exit when jsonb_array_length(v_tabata)>=2;
      if not exists(select 1 from jsonb_array_elements(v_tabata) x where x->>'pattern'=r.movement_pattern) then
        v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'TABATA',p_progression_intent,p_inventory)
          ||jsonb_build_object('block_role','tabata','protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'));
        v_tabata:=v_tabata||jsonb_build_array(jsonb_build_object(
          'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'prescription',v_pres,
          'expected_outcome',jsonb_build_object('block_key','tabata','protocol','20_on_10_off_x8','core_only',true,'pain_gate',true,'equipment_gate',true)
        ));
      end if;
    end loop;
    if jsonb_array_length(v_tabata)=0 then
      v_include_tabata:=false;
      v_tabata_min:=0;
    end if;
  end if;

  if v_include_skill then
    select e.* into r
    from public.exercises e
    left join public.user_exercise_coach_state s
      on s.user_id=p_user_id and s.exercise_id=e.id
    where 'Skill'=any(e.usable_for)
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=3
      and coalesce(e.joint_impact,99)<=3
      and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case
        when v_skill_reason='recalibration_window'
          and (
            upper(coalesce(s.recommendation,'')) in ('LEARN','RECALIBRATE')
            or (s.capability_confidence is not null and s.capability_confidence<0.60)
            or (s.capability_freshness is not null and s.capability_freshness<0.60)
            or coalesce(s.valid_evidence_count,0)<=1
          )
        then 0 else 1
      end,
      case when upper(coalesce(s.recommendation,'')) in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      case when s.user_id is not null then 0 else 1 end,
      coalesce(s.mastery_score,50) asc,
      coalesce(e.selection_weight,0) desc,
      e.id
    limit 1;

    if found then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'SKILL',p_progression_intent,p_inventory)
        ||jsonb_build_object(
          'block_role','skill',
          'target_duration_minutes',v_skill_min,
          'quality_priority','technique_before_fatigue',
          'skill_reason',v_skill_reason
        );
      v_skill:=jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,
        'name',r.name,
        'pattern',r.movement_pattern,
        'family',r.exercise_family,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object(
          'block_key','skill',
          'goal','technical_quality_or_progression',
          'skill_reason',v_skill_reason,
          'pain_gate',true,
          'equipment_gate',true
        )
      ));
    else
      v_include_skill:=false;
      v_skill_min:=0;
      v_skill_reason:=null;
    end if;
  end if;

  v_base_transition:=coalesce((v_cfg#>>'{block_budget,base_transition_recovery_minutes}')::int,2);
  v_optional_transition:=coalesce((v_cfg#>>'{block_budget,optional_block_transition_minutes}')::int,1);
  v_long_extra:=coalesce((v_cfg#>>'{block_budget,long_session_extra_recovery_minutes}')::int,1);
  v_low_extra:=coalesce((v_cfg#>>'{block_budget,low_readiness_extra_recovery_minutes}')::int,1);
  v_long_threshold:=coalesce((v_cfg#>>'{block_budget,long_session_threshold_minutes}')::int,75);
  v_min_wod:=coalesce((v_cfg#>>'{block_budget,minimum_wod_minutes}')::int,10);

  v_transition_min:=v_base_transition
    + case when v_include_tabata then v_optional_transition else 0 end
    + case when v_include_skill then v_optional_transition else 0 end
    + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
    + case when v_readiness_band='low' then v_low_extra else 0 end;

  v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_skill_min-v_transition_min;

  if v_wod_min<v_min_wod and v_include_skill then
    v_include_skill:=false;
    v_skill_min:=0;
    v_skill_reason:=null;
    v_skill:='[]'::jsonb;
    v_transition_min:=v_base_transition
      + case when v_include_tabata then v_optional_transition else 0 end
      + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
      + case when v_readiness_band='low' then v_low_extra else 0 end;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_transition_min;
  end if;

  if v_wod_min<v_min_wod and v_include_tabata then
    v_include_tabata:=false;
    v_tabata_min:=0;
    v_tabata:='[]'::jsonb;
    v_transition_min:=v_base_transition
      + case when p_duration_minutes>=v_long_threshold then v_long_extra else 0 end
      + case when v_readiness_band='low' then v_low_extra else 0 end;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_transition_min;
  end if;

  if v_wod_min<8 then
    return jsonb_build_object(
      'version','c4-full-session-v1.1-budget',
      'status','NO_SAFE_TIME_BUDGET',
      'production_mutation',false,
      'stimulus',v_stimulus,
      'architecture',jsonb_build_object(
        'total_minutes',p_duration_minutes,
        'warmup_minutes',v_warmup_min,
        'tabata_minutes',v_tabata_min,
        'skill_minutes',v_skill_min,
        'transition_recovery_minutes',v_transition_min,
        'wod_minutes',v_wod_min
      )
    );
  end if;

  v_wod:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_min,p_policy_key
  );
  if coalesce(v_wod->>'status','')<>'READY' or v_wod->'selected_candidate' is null then
    return jsonb_build_object(
      'version','c4-full-session-v1.1-budget','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,
      'architecture',jsonb_build_object(
        'total_minutes',p_duration_minutes,
        'warmup_minutes',v_warmup_min,
        'tabata_minutes',v_tabata_min,
        'skill_minutes',v_skill_min,
        'transition_recovery_minutes',v_transition_min,
        'wod_minutes',v_wod_min,
        'skill_reason',v_skill_reason,
        'duration_is_maximum_not_fill_target',true
      ),
      'wod_solver',v_wod
    );
  end if;
  v_wod_candidate:=v_wod->'selected_candidate';

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','warmup','block_name','Échauffement','duration_minutes',v_warmup_min,
    'required',true,'exercises',v_warmup,'expected_outcome',jsonb_build_object('role','prepare','fatigue_ceiling','low')
  ));

  if v_include_tabata then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',true,
      'structure','8 rounds — 20s travail / 10s repos','exercises',v_tabata,
      'expected_outcome',jsonb_build_object('role','core_conditioning','protocol','tabata_4min')
    ));
  end if;

  if v_include_skill then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','skill','block_name','Skill','duration_minutes',v_skill_min,'required',false,'exercises',v_skill,
      'expected_outcome',jsonb_build_object('role','skill','quality_priority',true,'skill_reason',v_skill_reason)
    ));
  end if;

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_min,'required',true,
    'mechanic',v_wod_candidate->>'mechanic','mechanic_json',v_wod_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_wod_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus',
      'predicted_volume',v_wod_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_wod_candidate#>'{c4_final,whole_wod_metrics}'
    )
  ));

  return jsonb_build_object(
    'version','c4-full-session-v1.1-budget',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'architecture',jsonb_build_object(
      'total_minutes',p_duration_minutes,
      'warmup_minutes',v_warmup_min,
      'tabata_minutes',v_tabata_min,
      'skill_minutes',v_skill_min,
      'transition_recovery_minutes',v_transition_min,
      'wod_minutes',v_wod_min,
      'active_block_budget_minutes',v_warmup_min+v_tabata_min+v_skill_min+v_wod_min,
      'planned_pre_cap_minutes',v_warmup_min+v_tabata_min+v_skill_min+v_wod_min+v_transition_min,
      'tabata_optional',p_duration_minutes<45,
      'tabata_safety_override',(p_duration_minutes>=45 and not v_include_tabata),
      'skill_optional',true,
      'skill_reason',v_skill_reason,
      'warmup_required',true,
      'wod_required',true,
      'duration_is_maximum_not_fill_target',true
    ),
    'blocks',v_blocks,
    'wod_solver',jsonb_build_object(
      'version',v_wod->'version',
      'candidate_count',v_wod->'candidate_count',
      'quality_gate',v_wod_candidate->'c4_quality_gate',
      'anti_redundancy',v_wod_candidate->'c4_anti_redundancy',
      'selection_score',v_wod_candidate->'c4_selection_score'
    ),
    'selected_candidate',v_wod_candidate,
    '_c4_prepared_wod_cache',
      case
        when coalesce((v_wod->>'search_fallback_used')::boolean,false)=false
         and coalesce(v_wod->'_c4_prepared_cache','{}'::jsonb)<>'{}'::jsonb
        then (v_wod->'_c4_prepared_cache')||jsonb_build_object(
          'source_full_wrapper_ready',true,
          'source_search_fallback_used',false
        )
        else '{}'::jsonb
      end
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.c4_apply_session_architecture_v2(p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_targets jsonb;
  v_readiness text:=public.normalize_session_readiness(p_readiness);
  v_unlock_min int;
  v_unlock_count int;
  v_tabata_min int;
  v_warmup_min int;
  v_warmup_count int;
  v_skill_target int:=0;
  v_skill_current int:=0;
  v_wod_target int;
  v_wod_limit int;
  v_wod_try int;
  v_wod_actual int;
  v_transition int;
  v_min_wod int;
  v_tabata_exception_max int;
  v_include_tabata boolean:=false;
  v_skill_block jsonb:=null;
  v_skill_exercises jsonb:='[]'::jsonb;
  v_skill_reason text;
  v_skill_resolution jsonb:='{}'::jsonb;
  v_skill_id text;
  v_skill_pres jsonb;
  v_skill_contract jsonb;
  v_wod jsonb:=null;
  v_candidate jsonb:=null;
  v_wod_block jsonb;
  v_mechanic text;
  v_unlock jsonb:='[]'::jsonb;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_target_ids text[]:='{}'::text[];
  v_target_patterns text[]:='{}'::text[];
  v_selected_ids text[]:='{}'::text[];
  v_pres jsonb;
  v_active int;
  v_planned int;
  v_unallocated int;
  v_original_skill int:=0;
  rec record;
begin
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  v_targets:=public.c4_session_architecture_targets_v2(p_duration_minutes,p_policy_key);
  v_unlock_min:=coalesce((v_targets->>'unlock_minutes')::int,2);
  v_unlock_count:=coalesce((v_targets->>'unlock_exercise_count')::int,2);
  v_tabata_min:=coalesce((v_targets->>'tabata_minutes')::int,4);
  v_warmup_min:=coalesce((v_targets->>'warmup_minutes')::int,4);
  v_warmup_count:=coalesce((v_targets->>'warmup_exercise_count')::int,3);
  v_wod_target:=coalesce((v_targets->>'wod_target_minutes')::int,15);
  if v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' then
    v_wod_target:=least(v_wod_target,20);
  end if;
  v_min_wod:=coalesce((v_targets->>'minimum_wod_minutes')::int,8);
  v_tabata_exception_max:=coalesce((v_targets->>'tabata_exception_max_duration')::int,30);

  select b into v_skill_block
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='skill'
  limit 1;

  if v_skill_block is not null then
    v_skill_current:=coalesce(nullif(v_skill_block->>'duration_minutes','')::int,nullif(r#>>'{architecture,skill_minutes}','')::int,0);
    v_original_skill:=v_skill_current;
    if v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' then
      v_skill_target:=v_skill_current;
    elsif p_duration_minutes<=30 then
      v_skill_target:=least(
        v_skill_current,
        coalesce(nullif(v_targets->>'skill_target_minutes','')::int,v_skill_current)
      );
    else
      v_skill_target:=greatest(v_skill_current,coalesce((v_targets->>'skill_target_minutes')::int,0));
    end if;
    v_skill_reason:=coalesce(r#>>'{architecture,skill_reason}',v_skill_block#>>'{expected_outcome,skill_reason}');
    v_skill_exercises:=coalesce(v_skill_block->'exercises','[]'::jsonb);
  end if;

  -- Core Tabata: daily default whenever a safe Core movement exists.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*
    from public.exercises e
    where 'Core'=any(e.usable_for)
      and coalesce(e.tabata_eligible,false)
      and not coalesce(e.warmup_only,false)
      and e.exercise_family='Core'
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=4
      and coalesce(e.joint_impact,99)<=3
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      public.c4_tabata_variety_penalty_v1(p_user_id,e.id) asc,
      coalesce(e.selection_weight,0) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_tabata)>=2;
    if not (rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids)))
       and not exists(select 1 from jsonb_array_elements(v_tabata) x where x->>'pattern'=rec.movement_pattern) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'TABATA',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','tabata','protocol',jsonb_build_object('rounds',8,'work_seconds',20,'rest_seconds',10,'rotation','alternate_exercises'),'core_daily_training',true,'tabata_side_switch',lower(coalesce(rec.movement_side,''))='unilateral','text',case when lower(coalesce(rec.movement_side,''))='unilateral' then '20s travail · change de côté à chaque passage' else null end);
      v_tabata:=v_tabata||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','tabata','protocol','20_on_10_off_x8','core_only',true,'core_daily_training',true,'pain_gate',true,'equipment_gate',true)
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;
  v_include_tabata:=jsonb_array_length(v_tabata)>0;
  if not v_include_tabata then v_tabata_min:=0; end if;

  v_transition:=2
    +case when v_include_tabata then 1 else 0 end
    +case when v_skill_target>0 then 1 else 0 end
    +case when p_duration_minutes>=75 then 1 else 0 end
    +case when v_readiness='low' then 1 else 0 end;

  v_wod_limit:=p_duration_minutes-v_unlock_min-v_tabata_min-v_warmup_min-v_skill_target-v_transition;

  -- Only 20/30 min sessions may sacrifice Tabata for time; safety can always remove it.
  if v_wod_limit<v_min_wod and v_include_tabata and p_duration_minutes<=v_tabata_exception_max then
    v_include_tabata:=false;
    v_tabata_min:=0;
    v_tabata:='[]'::jsonb;
    v_transition:=2
      +case when v_skill_target>0 then 1 else 0 end
      +case when p_duration_minutes>=75 then 1 else 0 end
      +case when v_readiness='low' then 1 else 0 end;
    v_wod_limit:=p_duration_minutes-v_unlock_min-v_warmup_min-v_skill_target-v_transition;
  end if;

  if v_wod_limit<v_min_wod then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_TIME_BUDGET_AFTER_V2_PREPARATION',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_wod_limit:=least(v_wod_target,v_wod_limit);

  for v_wod_try in
    select distinct x
    from unnest(array[v_wod_limit,v_wod_target,35,30,25,20,15,12,10,9,8]) x
    where x between v_min_wod and v_wod_limit
    order by x desc
  loop
    if coalesce((
      select (config#>>'{mechanic_policy,apply_enabled}')::boolean
      from public.session_engine_policy
      where policy_key=p_policy_key
    ),false) then
      if coalesce(r->'_c4_prepared_wod_cache','{}'::jsonb)<>'{}'::jsonb then
        v_wod:=public.solve_session_engine_c4_mechanic_policy_shadow_full_from_cache_v1(
          p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
          p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key,
          r->'_c4_prepared_wod_cache'
        );
      else
        v_wod:=jsonb_build_object('status','CACHE_MISS','reason','NO_PREPARED_CACHE');
      end if;

      if coalesce(v_wod->>'status','')<>'READY' then
        v_wod:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
          p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
          p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
        );
      end if;
    else
      v_wod:=public.solve_session_engine_c4(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
      );
    end if;
    if coalesce(v_wod->>'status','')='READY' and v_wod->'selected_candidate' is not null then
      v_candidate:=v_wod->'selected_candidate';
      exit;
    end if;
  end loop;

  if v_candidate is null then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_COHERENT_V2_WOD',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_mechanic:=upper(coalesce(v_candidate->>'mechanic',''));
  v_wod_actual:=case
    when v_mechanic='SETS_REPS'
      and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
    then least(
      coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_wod_try),
      greatest(10,ceil(nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0)::int)
    )
    else coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_wod_try)
  end;

  -- Re-resolve Skill against the final V2 WOD and rebuild its contract with the new duration.
  if v_skill_target>0 and jsonb_array_length(v_skill_exercises)>0 then
    v_skill_resolution:=public.c57_resolve_skill_wod_distinctness(
      p_user_id,v_skill_exercises,coalesce(v_candidate->'exercises','[]'::jsonb),coalesce(r->'stimulus','{}'::jsonb),
      v_skill_reason,v_skill_target,p_progression_intent,p_inventory,p_zone_terms,p_target_region,p_max_complexity
    );
    if v_skill_resolution->>'status'='DUPLICATE_REPLACED_SAFE_ALTERNATIVE' then
      v_skill_exercises:=coalesce(v_skill_resolution->'exercises','[]'::jsonb);
    end if;

    v_skill_id:=v_skill_exercises#>>'{0,exercise_id}';
    v_skill_pres:=coalesce(v_skill_exercises#>'{0,prescription}','{}'::jsonb);
    if v_skill_id is not null then
      v_skill_contract:=public.c4_skill_contract_v1(p_user_id,v_skill_id,v_skill_reason,v_skill_target,p_progression_intent,p_readiness,v_skill_pres);
      v_skill_pres:=v_skill_pres||coalesce(v_skill_contract->'prescription_patch','{}'::jsonb);
      select coalesce(jsonb_agg(
        case when ord=1 then e||jsonb_build_object(
          'prescription',v_skill_pres,
          'expected_outcome',coalesce(e->'expected_outcome','{}'::jsonb)||jsonb_build_object(
            'skill_objective_type',v_skill_contract->>'objective_type',
            'score_required',coalesce((v_skill_contract->>'score_required')::boolean,false),
            'score_metric',v_skill_contract->>'score_metric'
          )
        ) else jsonb_set(e,'{prescription,target_duration_minutes}',to_jsonb(v_skill_target),true) end
        order by ord
      ),'[]'::jsonb)
      into v_skill_exercises
      from jsonb_array_elements(v_skill_exercises) with ordinality z(e,ord);

      v_skill_block:=v_skill_block||jsonb_build_object(
        'block_key','skill','block_name','Skill / Development','duration_minutes',v_skill_target,'exercises',v_skill_exercises,
        'structure',v_skill_contract->>'structure',
        'objective',(v_skill_contract->>'objective_title')||' — '||(v_skill_contract->>'objective_description'),
        'skill_contract',v_skill_contract,
        'expected_outcome',coalesce(v_skill_block->'expected_outcome','{}'::jsonb)||jsonb_build_object(
          'role','skill_development','skill_reason',v_skill_reason,'contract_version','skill-contract-v2'
        )
      );
    end if;
  end if;

  select coalesce(array_agg(distinct id),'{}'::text[])
  into v_target_ids
  from (
    select e->>'exercise_id' id from jsonb_array_elements(coalesce(v_skill_exercises,'[]'::jsonb)) e
    union all
    select e->>'exercise_id' id from jsonb_array_elements(coalesce(v_candidate->'exercises','[]'::jsonb)) e
  ) q
  where id is not null;

  select coalesce(array_agg(distinct movement_pattern) filter(where movement_pattern is not null),'{}'::text[])
  into v_target_patterns
  from public.exercises
  where id=any(v_target_ids);

  -- UNLOCK: short mobility-only block, intentionally not the session-specific warm-up.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*
    from public.exercises e
    where 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and e.warmup_role='mobility'
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case when p_target_region is not null and p_target_region<>'Full Body' and e.body_region=p_target_region then 0 else 1 end,
      3*(select count(*) from public.workout_session_exercises wse where wse.exercise_id=e.id
         and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6)) asc,
      coalesce(e.selection_weight,0) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_unlock)>=v_unlock_count;
    if not(rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids))) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','unlock','unlock_role','mobility','target_duration_minutes',v_unlock_min,'fatigue_target','minimal');
      v_unlock:=v_unlock||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','unlock','goal','unlock_mobility_without_fatigue','pain_gate',true,'equipment_gate',true)
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;
  if jsonb_array_length(v_unlock)=0 then v_unlock_min:=0; end if;

  -- SPECIFIC WARM-UP: direct preparation links first; mobility is deliberately excluded.
  v_selected_ids:='{}'::text[];
  for rec in
    select e.*,max(l.priority) link_priority,count(distinct l.target_exercise_id) target_coverage
    from public.exercise_preparation_links l
    join public.exercises e on e.id=l.warmup_exercise_id
    where l.active and l.target_exercise_id=any(v_target_ids)
      and 'Warm-up'=any(e.usable_for)
      and coalesce(e.warmup_eligible,false)
      and e.warmup_role in ('activation','movement_prep','pulse_raiser')
      and coalesce(e.warmup_intensity,99)<=2
      and coalesce(e.fatigue_score,99)<=2
      and coalesce(e.joint_impact,99)<=2
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    group by e.id
    order by target_coverage desc,(max(l.priority)+coalesce(e.selection_weight,0)
      -3*(select count(*) from public.workout_session_exercises wse where wse.exercise_id=e.id and wse.block_key='warm_up'
          and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6))) desc,
      md5(p_user_id::text||public.ugerod_effective_session_anchor_date_v1()::text||e.id)
  loop
    exit when jsonb_array_length(v_warmup)>=v_warmup_count;
    if not(rec.id=any(public.exercise_expand_functional_exclusions_v1(v_selected_ids))) then
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',rec.warmup_role,'target_duration_minutes',v_warmup_min,'specific_preparation_link',true,'prepares_exercise_ids',to_jsonb(v_target_ids));
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','specific_preparation_for_skill_and_wod','pain_gate',true,'equipment_gate',true,'specific_preparation_link',true,'prepares_exercise_ids',to_jsonb(v_target_ids))
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end if;
  end loop;

  if jsonb_array_length(v_warmup)<v_warmup_count then
    for rec in
      select e.*
      from public.exercises e
      where 'Warm-up'=any(e.usable_for)
        and coalesce(e.warmup_eligible,false)
        and e.warmup_role in ('activation','movement_prep','pulse_raiser')
        and coalesce(e.warmup_intensity,99)<=2
        and coalesce(e.fatigue_score,99)<=2
        and coalesce(e.joint_impact,99)<=2
        and coalesce(e.technical_complexity,99)<=p_max_complexity
        and not(e.id=any(v_selected_ids))
        and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
        and public.exercise_equipment_compatible(e.id,p_inventory)
      order by
        case when e.movement_pattern=any(v_target_patterns) then 0 else 1 end,
        case when e.warmup_role='movement_prep' then 0 when e.warmup_role='activation' then 1 else 2 end,
        coalesce(e.selection_weight,0) desc,e.id
    loop
      exit when jsonb_array_length(v_warmup)>=v_warmup_count;
      v_pres:=public.c2_solver_prescription(p_user_id,rec.id,coalesce(r->'stimulus','{}'::jsonb),'WARMUP',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','warmup','warmup_role',rec.warmup_role,'target_duration_minutes',v_warmup_min,'specific_preparation_link',false,'prepares_patterns',to_jsonb(v_target_patterns));
      v_warmup:=v_warmup||jsonb_build_array(jsonb_build_object(
        'exercise_id',rec.id,'name',rec.name,'pattern',rec.movement_pattern,'family',rec.exercise_family,'warmup_role',rec.warmup_role,
        'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','warmup','goal','specific_preparation_for_skill_and_wod','pain_gate',true,'equipment_gate',true,'specific_preparation_link',false,'prepares_patterns',to_jsonb(v_target_patterns))
      ));
      v_selected_ids:=array_append(v_selected_ids,rec.id);
    end loop;
  end if;

  if jsonb_array_length(v_warmup)=0 then
    return jsonb_set(r,'{architecture,session_architecture_v2_contract}',jsonb_build_object(
      'version','session-architecture-v2','applied',false,'reason','NO_SAFE_SPECIFIC_WARMUP',
      'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  v_wod_block:=jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_actual,'required',true,
    'mechanic',v_candidate->>'mechanic','mechanic_json',v_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus','predicted_volume',v_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_candidate#>'{c4_final,whole_wod_metrics}'
    )
  );

  if v_unlock_min>0 then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','unlock','block_name','Unlock','duration_minutes',v_unlock_min,'required',true,'exercises',v_unlock,
      'structure','Mobilité / déverrouillage · faible fatigue',
      'expected_outcome',jsonb_build_object('role','unlock','goal','mobility_and_joint_access','fatigue_ceiling','minimal')
    ));
  end if;

  if v_include_tabata then
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',true,
      'structure','8 rounds — 20s travail / 10s repos','exercises',v_tabata,
      'expected_outcome',jsonb_build_object('role','core_training','protocol','tabata_4min','daily_default',true)
    ));
  end if;

  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','warmup','block_name','Warm-up spécifique','duration_minutes',v_warmup_min,'required',true,'exercises',v_warmup,
    'structure','Préparation directe du Skill et du WOD',
    'expected_outcome',jsonb_build_object('role','specific_preparation','fatigue_ceiling','low','prepares_exercise_ids',to_jsonb(v_target_ids))
  ));

  if v_skill_target>0 and v_skill_block is not null then
    v_blocks:=v_blocks||jsonb_build_array(v_skill_block);
  end if;
  v_blocks:=v_blocks||jsonb_build_array(v_wod_block);

  v_active:=v_unlock_min+v_tabata_min+v_warmup_min+v_skill_target+v_wod_actual;
  v_planned:=v_active+v_transition;
  v_unallocated:=greatest(0,p_duration_minutes-v_planned);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{selected_candidate}',v_candidate,true);
  r:=jsonb_set(r,'{wod_solver}',jsonb_build_object(
    'version',v_wod->'version','candidate_count',v_wod->'candidate_count',
    'quality_gate',v_candidate->'c4_quality_gate','anti_redundancy',v_candidate->'c4_anti_redundancy',
    'selection_score',v_candidate->'c4_selection_score','architecture_v2_recompiled',true
  ),true);

  r:=jsonb_set(r,'{architecture}',coalesce(r->'architecture','{}'::jsonb)||jsonb_build_object(
    'version','session-architecture-v2',
    'block_order',jsonb_build_array('unlock','tabata','warmup','skill','wod'),
    'total_minutes',p_duration_minutes,
    'unlock_minutes',v_unlock_min,
    'tabata_minutes',v_tabata_min,
    'warmup_minutes',v_warmup_min,
    'skill_minutes',v_skill_target,
    'wod_minutes',v_wod_actual,
    'wod_target_minutes',v_wod_target,
    'preparation_minutes',v_unlock_min+v_tabata_min+v_warmup_min,
    'transition_recovery_minutes',v_transition,
    'active_training_minutes',v_active,
    'active_block_budget_minutes',v_active,
    'planned_minutes',v_planned,
    'unallocated_available_minutes',v_unallocated,
    'duration_is_maximum_not_fill_target',true,
    'unlock_required',v_unlock_min>0,
    'unlock_exercise_count',jsonb_array_length(v_unlock),
    'tabata_core_daily_default',true,
    'tabata_included',v_include_tabata,
    'tabata_exception_window',p_duration_minutes<=v_tabata_exception_max,
    'tabata_safety_override',not v_include_tabata and p_duration_minutes>v_tabata_exception_max,
    'specific_warmup_required',true,
    'specific_warmup_exercise_count',jsonb_array_length(v_warmup),
    'specific_warmup_target_exercise_ids',to_jsonb(v_target_ids),
    'skill_reason',v_skill_reason,
    'skill_target_minutes',coalesce((v_targets->>'skill_target_minutes')::int,0),
    'wod_duration_profile',case when p_duration_minutes<=60 then 'compact_standard' else 'long_session_allowed' end,
    'block_budget_version','session-architecture-v2',
    'long_session_development_contract',jsonb_build_object(
      'applied',v_skill_target>v_original_skill,
      'base_skill_minutes',v_original_skill,
      'final_skill_minutes',v_skill_target,
      'quality_time_not_forced_volume',true,
      'wod_not_stretched_to_fill_session',true
    ),
    'session_architecture_v2_contract',jsonb_build_object(
      'version','session-architecture-v2','applied',true,
      'unlock_separate_from_specific_warmup',true,
      'tabata_core_daily_default',true,
      'specific_warmup_derived_from_final_skill_and_wod',true,
      'short_session_warmup_condensed',p_duration_minutes<=30,
      'skill_development_time_expanded',p_duration_minutes>=45,
      'wod_compact_through_60',p_duration_minutes<=60,
      'long_wod_allowed_75_90',p_duration_minutes>=75,
      'duration_is_maximum_not_fill_target',true
    )
  ),true);

  r:=jsonb_set(r,'{skill_wod_distinctness}',coalesce(v_skill_resolution,'{}'::jsonb),true);
  return r-'_c4_prepared_wod_cache';
end;
$function$;
