-- C52 — Block Budget + Skill opportuniste
-- DEV appliqué le 13/08/2026.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    config,
    '{block_budget}',
    jsonb_build_object(
      'base_transition_recovery_minutes',2,
      'optional_block_transition_minutes',1,
      'long_session_extra_recovery_minutes',1,
      'long_session_threshold_minutes',75,
      'low_readiness_extra_recovery_minutes',1,
      'skill_minutes_standard',8,
      'skill_minutes_long',10,
      'skill_minutes_very_long',12,
      'skill_long_threshold_minutes',75,
      'skill_very_long_threshold_minutes',90,
      'minimum_wod_minutes',10,
      'duration_is_maximum_not_fill_target',true
    ),
    true
  ),
  '{skill_policy}',
  jsonb_build_object(
    'min_session_minutes',45,
    'targeted_long_session_min_minutes',75,
    'max_exercises',1,
    'recalibration_is_single_movement',true,
    'include_focuses',jsonb_build_array('Strength','Muscle Gain'),
    'include_progression_intents',jsonb_build_array('PROGRESS','CONSOLIDATE','EXPLORE'),
    'recalibration_intent','RECALIBRATE',
    'capability_signal_confidence_threshold',0.60,
    'capability_signal_freshness_threshold',0.60
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.c4_plan_full_session_pre_wod_caps(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
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

  v_include_tabata:=p_duration_minutes>=45 and (
    p_focus in ('General Fitness','Fat Loss','Conditioning') or p_target_region='Core'
  );
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

  v_wod:=public.solve_session_engine_c4(
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
      'block_key','tabata','block_name','Core Tabata','duration_minutes',4,'required',false,
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
      'tabata_optional',true,
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
    'selected_candidate',v_wod_candidate
  );
end;
$function$;

create or replace function public.c4_plan_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_plan jsonb;
  v_actual_wod int;
  v_original_wod int;
  v_warmup int;
  v_tabata int;
  v_skill int;
  v_transition int;
  v_planned int;
  v_active int;
  v_blocks jsonb;
  v_mechanic text;
begin
  v_plan:=public.c4_plan_full_session_pre_wod_caps(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=upper(coalesce(v_plan#>>'{selected_candidate,mechanic}',''));
  v_actual_wod:=coalesce(
    nullif(v_plan#>>'{selected_candidate,c4_final,mechanic_json,wod_budget_minutes}','')::int,
    nullif(v_plan#>>'{architecture,wod_minutes}','')::int,
    0
  );
  v_original_wod:=coalesce(nullif(v_plan#>>'{architecture,wod_minutes}','')::int,v_actual_wod);
  v_warmup:=coalesce(nullif(v_plan#>>'{architecture,warmup_minutes}','')::int,0);
  v_tabata:=coalesce(nullif(v_plan#>>'{architecture,tabata_minutes}','')::int,0);
  v_skill:=coalesce(nullif(v_plan#>>'{architecture,skill_minutes}','')::int,0);
  v_transition:=coalesce(nullif(v_plan#>>'{architecture,transition_recovery_minutes}','')::int,0);
  v_active:=v_warmup+v_tabata+v_skill+v_actual_wod;
  v_planned:=v_active+v_transition;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod'
      then b||jsonb_build_object('duration_minutes',v_actual_wod)
      else b end
    order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  v_plan:=jsonb_set(v_plan,'{blocks}',v_blocks,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_minutes}',to_jsonb(v_actual_wod),true);
  v_plan:=jsonb_set(v_plan,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
  v_plan:=jsonb_set(v_plan,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
  v_plan:=jsonb_set(v_plan,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
  v_plan:=jsonb_set(v_plan,'{architecture,block_budget_version}','"block-budget-v1"'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_duration_guardrail}',jsonb_build_object(
    'mechanic',v_mechanic,
    'cap_minutes',public.c4_mechanic_wod_cap_minutes(v_mechanic,p_policy_key),
    'pre_guardrail_wod_minutes',v_original_wod,
    'final_wod_minutes',v_actual_wod,
    'released_by_wod_cap_minutes',greatest(0,v_original_wod-v_actual_wod),
    'available_time_is_maximum_not_fill_target',true,
    'version','v1-mechanic-wod-cap-2-block-budget'
  ),true);

  return v_plan;
end;
$function$;
