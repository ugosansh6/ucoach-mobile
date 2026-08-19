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
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_context jsonb:=coalesce(p_session_context,'{}'::jsonb);
  v_opp jsonb:='{}'::jsonb;
  v_equipment_id text:=null;
  v_equipment_name text:=null;
  v_level text:=null;
  v_soft_bias numeric:=0;
  v_current jsonb:=coalesce(r->'selected_candidate','{}'::jsonb);
  v_current_fit numeric:=coalesce(nullif(v_current#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
  v_wod_block jsonb:=null;
  v_wod_minutes int:=10;
  v_mechanic text:=null;
  v_current_ids text[]:='{}'::text[];
  v_already_uses boolean:=false;
  v_candidate record;
  v_profile jsonb;
  v_alt_exercises jsonb;
  v_alt_base jsonb;
  v_alt_final jsonb;
  v_alt_gate jsonb;
  v_alt_fit numeric;
  v_alt_blocks jsonb;
  v_intent text:=upper(coalesce(r#>>'{architecture,session_intent,proposed_session_intent}',v_context#>>'{session_intent,proposed_session_intent}',v_context#>>'{session_intent_shadow,proposed_session_intent}','CLASSIC'));
  v_budget_before jsonb:='{}'::jsonb;
  v_budget_after jsonb:='{}'::jsonb;
  v_best jsonb:=null;
  v_best_fit numeric:=null;
  v_best_blocks jsonb:=null;
  v_best_budget jsonb:=null;
  v_best_candidate_score numeric:=null;
  v_best_replace_pos int:=null;
  v_best_replace_id text:=null;
  v_best_new_id text:=null;
  v_pos int;
  v_exercise_count int:=0;
  v_quality_delta numeric:=null;
  v_quality_delta_floor numeric:=-1.0;
  v_examined int:=0;
  v_feasible int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if coalesce(r->>'status','')<>'READY' then
    return r;
  end if;

  v_context:=v_context||jsonb_build_object(
    'status','READY',
    'focus',coalesce(nullif(v_context->>'focus',''),p_focus),
    'target_region',coalesce(nullif(v_context->>'target_region',''),p_target_region,'Full Body')
  );

  v_opp:=public.program_coach_equipment_opportunity_shadow_v1(
    p_user_id,coalesce(p_anchor_date,current_date),v_context,coalesce(p_inventory,'[]'::jsonb)
  );

  select x->>'equipment_id',x->>'name',x->>'level',coalesce(nullif(x->>'recommended_soft_bias','')::numeric,0)
  into v_equipment_id,v_equipment_name,v_level,v_soft_bias
  from jsonb_array_elements(coalesce(v_opp->'opportunities','[]'::jsonb)) x
  where x->>'level' in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE','MEDIUM_UNDERUSED')
  order by case x->>'level' when 'HIGH_VALUE_NEW' then 0 when 'HIGH_VALUE_RARE' then 1 when 'MEDIUM_UNDERUSED' then 2 else 3 end,
           coalesce(nullif(x->>'focus_relevant_exercise_count','')::int,0) desc,
           coalesce(nullif(x->>'relevant_exercise_count','')::int,0) desc,
           x->>'name'
  limit 1;

  if v_equipment_id is null then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,
      'reason','NO_RELEVANT_RARE_OR_UNDERUSED_EQUIPMENT',
      'source_signal',v_opp,
      'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
    ),true);
  end if;

  select exists(
    select 1
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    cross join lateral jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) ex
    join public.exercise_equipment_requirements_v2 req
      on req.exercise_id=ex->>'exercise_id'
     and req.equipment_id=v_equipment_id
     and not req.is_optional
    where b->>'block_key' in ('skill','wod')
  ) into v_already_uses;

  if v_already_uses then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,
      'reason','OPPORTUNITY_ALREADY_SATISFIED',
      'equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,
      'recommended_soft_bias',v_soft_bias,'source_signal',v_opp,
      'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
    ),true);
  end if;

  select b into v_wod_block
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  where b->>'block_key'='wod'
  limit 1;

  if v_wod_block is null or jsonb_array_length(coalesce(v_wod_block->'exercises','[]'::jsonb))=0 then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,
      'reason','NO_WOD_TO_SOFT_ADAPT','equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,
      'source_signal',v_opp,
      'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
    ),true);
  end if;

  v_wod_minutes:=coalesce(nullif(v_wod_block->>'duration_minutes','')::int,10);
  v_mechanic:=upper(coalesce(v_wod_block->>'mechanic',v_current->>'mechanic','CIRCUIT'));
  select coalesce(array_agg(e->>'exercise_id' order by ord),'{}'::text[]),count(*)::int
  into v_current_ids,v_exercise_count
  from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);

  if v_exercise_count=0 then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,'reason','NO_SELECTED_WOD_EXERCISES',
      'equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,'source_signal',v_opp
    ),true);
  end if;

  v_budget_before:=public.c4_session_pattern_budget_v1(v_intent,coalesce(r->'blocks','[]'::jsonb),'{}'::jsonb);

  for v_candidate in
    select cp.*
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,greatest(30,p_candidate_count)
    ) cp
    where not(cp.exercise_id=any(v_current_ids))
      and exists(
        select 1 from public.exercise_equipment_requirements_v2 req
        where req.exercise_id=cp.exercise_id
          and req.equipment_id=v_equipment_id
          and not req.is_optional
      )
    order by cp.candidate_score desc,cp.exercise_id
    limit 6
  loop
    v_examined:=v_examined+1;
    v_profile:=public.c4_exercise_mechanic_profile(p_user_id,v_candidate.exercise_id,v_mechanic,null,p_readiness,p_progression_intent);
    if not coalesce((v_profile->>'compatible')::boolean,false)
       or coalesce(v_profile->>'classification','') not in ('NATURAL','ADAPTABLE') then
      continue;
    end if;

    for v_pos in 1..v_exercise_count loop
      select coalesce(jsonb_agg(
        case when ord::int=v_pos then jsonb_build_object(
          'exercise_id',v_candidate.exercise_id,
          'name',v_candidate.exercise_name,
          'pattern',v_candidate.movement_pattern,
          'family',v_candidate.exercise_family,
          'candidate_score',v_candidate.candidate_score,
          'components',coalesce(v_candidate.score_components,'{}'::jsonb)||jsonb_build_object(
            'equipment_opportunity_soft_bias',v_soft_bias,
            'equipment_opportunity_equipment_id',v_equipment_id,
            'equipment_opportunity_level',v_level
          ),
          'prescription',public.c2_solver_prescription(p_user_id,v_candidate.exercise_id,coalesce(r->'stimulus','{}'::jsonb),v_mechanic,p_progression_intent,p_inventory),
          'mechanic_suitability',v_profile
        ) else e end order by ord
      ),'[]'::jsonb)
      into v_alt_exercises
      from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);

      v_alt_base:=(v_current-'c4_final'-'c4_quality_gate'-'c4_anti_redundancy'-'c4_selection_score')
        ||jsonb_build_object('exercises',v_alt_exercises,'mechanic',v_mechanic);
      v_alt_final:=public.c4_finalize_candidate(v_alt_base,coalesce(r->'stimulus','{}'::jsonb),p_duration_minutes,v_wod_minutes,p_policy_key,'c3-sim-default');
      v_alt_gate:=public.c4_candidate_quality_gate_v2(
        v_alt_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
      );
      if not coalesce((v_alt_gate->>'pass')::boolean,false) then
        continue;
      end if;

      v_alt_final:=v_alt_final||jsonb_build_object('c4_quality_gate',v_alt_gate);
      v_alt_fit:=coalesce(nullif(v_alt_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);

      select coalesce(jsonb_agg(
        case when b->>'block_key'='wod' then b||jsonb_build_object('exercises',v_alt_exercises) else b end order by ord
      ),'[]'::jsonb)
      into v_alt_blocks
      from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality z(b,ord);

      v_budget_after:=public.c4_session_pattern_budget_v1(v_intent,v_alt_blocks,'{}'::jsonb);
      if coalesce(v_budget_before->>'status','')<>'SOFT_OVERCONCENTRATION'
         and coalesce(v_budget_after->>'status','')='SOFT_OVERCONCENTRATION' then
        continue;
      end if;
      if coalesce(v_budget_before->>'status','')='SOFT_OVERCONCENTRATION'
         and coalesce(v_budget_after->>'status','')='SOFT_OVERCONCENTRATION'
         and coalesce(nullif(v_budget_after#>>'{metrics,max_pattern_concentration}','')::numeric,1)
             >coalesce(nullif(v_budget_before#>>'{metrics,max_pattern_concentration}','')::numeric,1) then
        continue;
      end if;

      v_feasible:=v_feasible+1;
      if v_best_fit is null
         or v_alt_fit>v_best_fit
         or (v_alt_fit=v_best_fit and v_candidate.candidate_score>coalesce(v_best_candidate_score,-999)) then
        v_best:=v_alt_final;
        v_best_fit:=v_alt_fit;
        v_best_blocks:=v_alt_blocks;
        v_best_budget:=v_budget_after;
        v_best_candidate_score:=v_candidate.candidate_score;
        v_best_replace_pos:=v_pos;
        v_best_replace_id:=v_current#>>('{exercises,'||(v_pos-1)||',exercise_id}')::text[];
        v_best_new_id:=v_candidate.exercise_id;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,
      'reason','NO_SAFE_COHERENT_EQUIPMENT_ALTERNATIVE',
      'equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,
      'examined_candidates',v_examined,'feasible_candidates',v_feasible,'source_signal',v_opp,
      'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
    ),true);
  end if;

  v_quality_delta:=round(v_best_fit-v_current_fit,2);
  if v_quality_delta<v_quality_delta_floor then
    return jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
      'version','equipment-opportunity-v1','mode','ACTIVE','applied',false,
      'reason','QUALITY_TRADEOFF_TOO_LARGE',
      'equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,
      'quality_delta',v_quality_delta,'quality_delta_floor',v_quality_delta_floor,
      'current_whole_wod_fit',round(v_current_fit,2),'best_equipment_whole_wod_fit',round(v_best_fit,2),
      'source_signal',v_opp,
      'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
    ),true);
  end if;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod' then
      b||jsonb_build_object(
        'mechanic',v_best->>'mechanic',
        'mechanic_json',v_best#>'{c4_final,mechanic_json}',
        'exercises',v_best->'exercises',
        'expected_outcome',jsonb_build_object(
          'role','primary_training_stimulus',
          'predicted_volume',v_best#>'{c4_final,predicted_volume}',
          'whole_wod_metrics',v_best#>'{c4_final,whole_wod_metrics}'
        )
      )
    else b end order by ord
  ),'[]'::jsonb)
  into v_best_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality z(b,ord);

  r:=jsonb_set(r,'{blocks}',v_best_blocks,true);
  r:=jsonb_set(r,'{selected_candidate}',v_best,true);
  r:=jsonb_set(r,'{architecture,equipment_opportunity}',jsonb_build_object(
    'version','equipment-opportunity-v1','mode','ACTIVE','applied',true,
    'equipment_id',v_equipment_id,'equipment_name',v_equipment_name,'opportunity_level',v_level,
    'replace',jsonb_build_object('position',v_best_replace_pos,'exercise_id',v_best_replace_id),
    'with',jsonb_build_object('exercise_id',v_best_new_id),
    'quality_delta',v_quality_delta,'quality_delta_floor',v_quality_delta_floor,
    'current_whole_wod_fit',round(v_current_fit,2),'new_whole_wod_fit',round(v_best_fit,2),
    'pattern_budget_before',v_budget_before,'pattern_budget_after',v_best_budget,
    'examined_candidates',v_examined,'feasible_candidates',v_feasible,
    'source_signal',v_opp,
    'contract',jsonb_build_object(
      'never_force_equipment_use',true,
      'max_equipment_driven_training_exercises',1,
      'hard_gates_override',true,
      'quality_tradeoff_bounded',true,
      'specific_warmup_must_be_rebuilt_after_application',true
    ),
    'authority',jsonb_build_object('shadow_only',false,'soft_bias_only',true,'may_change_exercise_selection',true,'hard_gates_override',true)
  ),true);
  return r;
end;
$function$;
