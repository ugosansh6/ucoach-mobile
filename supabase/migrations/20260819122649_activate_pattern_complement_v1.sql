create or replace function public.c4_apply_pattern_complement_plan_v1(
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
language plpgsql stable security definer set search_path='public'
as $$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_apply boolean:=false;
  v_delta_floor numeric:=-2;
  v_intent text:=upper(coalesce(r#>>'{architecture,session_intent,proposed_session_intent}',p_session_context#>>'{session_intent,proposed_session_intent}',p_session_context#>>'{session_intent_shadow,proposed_session_intent}','CLASSIC'));
  v_budget jsonb;
  v_policy jsonb;
  v_current jsonb:=coalesce(r->'selected_candidate','{}'::jsonb);
  v_current_fit numeric:=coalesce(nullif(v_current#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
  v_wod_block jsonb;
  v_wod_minutes int:=10;
  v_mechanic text;
  v_current_ids text[]:='{}'::text[];
  v_soft_avoid text[]:='{}'::text[];
  v_target_pattern text;
  v_replace_pos int;
  v_replace_id text;
  v_trigger text;
  v_candidate record;
  v_profile jsonb;
  v_alt_exercises jsonb;
  v_alt_base jsonb;
  v_alt_final jsonb;
  v_alt_fit numeric;
  v_alt_blocks jsonb;
  v_alt_budget jsonb;
  v_best jsonb:=null;
  v_best_fit numeric:=null;
  v_best_budget jsonb:=null;
  v_best_profile jsonb:=null;
  v_best_candidate_score numeric:=null;
  v_examined int:=0;
  v_feasible int:=0;
  v_quality_delta numeric:=null;
  v_blocks jsonb;
  v_new_wod jsonb;
  v_current_conc numeric:=coalesce(nullif(v_budget#>>'{metrics,max_pattern_concentration}','')::numeric,0);
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select coalesce((config#>>'{pattern_complement,apply_enabled}')::boolean,false),
         coalesce(nullif(config#>>'{pattern_complement,quality_delta_floor}','')::numeric,-2)
  into v_apply,v_delta_floor
  from public.session_engine_policy where policy_key=p_policy_key;

  if not v_apply then
    return jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object('version','pattern-complement-v1','mode','OFF','applied',false),true);
  end if;

  select b into v_wod_block from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1;
  if v_wod_block is null or jsonb_array_length(coalesce(v_wod_block->'exercises','[]'::jsonb))=0 then
    return jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object('version','pattern-complement-v1','mode','ACTIVE','applied',false,'reason','NO_WOD'),true);
  end if;
  v_wod_minutes:=coalesce(nullif(v_wod_block->>'duration_minutes','')::int,10);
  v_mechanic:=upper(coalesce(v_wod_block->>'mechanic',v_current->>'mechanic','CIRCUIT'));
  select coalesce(array_agg(e->>'exercise_id' order by ord),'{}'::text[]) into v_current_ids
  from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);

  v_budget:=public.c4_session_pattern_budget_v1(v_intent,coalesce(r->'blocks','[]'::jsonb),'{}'::jsonb);
  v_policy:=public.program_coach_pattern_complement_policy_shadow_v1(p_user_id,coalesce(p_anchor_date,current_date),p_session_context);
  select coalesce(array_agg(value),'{}'::text[]) into v_soft_avoid
  from jsonb_array_elements_text(coalesce(v_policy->'soft_avoid_patterns','[]'::jsonb));

  if coalesce(v_budget->>'status','')='SOFT_OVERCONCENTRATION' then
    v_target_pattern:=v_budget#>>'{metrics,dominant_pattern}';
    v_trigger:='SESSION_PATTERN_OVERCONCENTRATION';
    select e->>'exercise_id',ord::int into v_replace_id,v_replace_pos
    from jsonb_array_elements(coalesce(v_wod_block->'exercises','[]'::jsonb)) with ordinality x(e,ord)
    where e->>'pattern'=v_target_pattern
    order by ord desc limit 1;
  else
    with w as (
      select e->>'exercise_id' exercise_id,e->>'pattern' pattern,ord::int position,
             count(*) over(partition by e->>'pattern') cnt,
             row_number() over(partition by e->>'pattern' order by ord) rn
      from jsonb_array_elements(coalesce(v_wod_block->'exercises','[]'::jsonb)) with ordinality x(e,ord)
      where e->>'pattern'=any(v_soft_avoid)
    )
    select exercise_id,position,pattern into v_replace_id,v_replace_pos,v_target_pattern
    from w where cnt>=2 and rn>1 order by cnt desc,position desc limit 1;
    if v_replace_id is not null then v_trigger:='ROLLING_PATTERN_OVERLAP'; end if;
  end if;

  if v_replace_id is null or v_target_pattern is null then
    return jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object(
      'version','pattern-complement-v1','mode','ACTIVE','applied',false,'reason','NO_COMPLEMENT_NEEDED',
      'session_pattern_budget',v_budget,'rolling_policy',v_policy
    ),true);
  end if;

  for v_candidate in
    select cp.*
    from public.c2_candidate_pool_pattern_complement_shadow_v1(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,greatest(30,p_candidate_count),
      coalesce(p_anchor_date,current_date),p_session_context
    ) cp
    where not(cp.exercise_id=any(v_current_ids))
      and cp.movement_pattern is distinct from v_target_pattern
      and not(cp.movement_pattern=any(v_soft_avoid))
    order by case when cp.movement_pattern=any((select coalesce(array_agg(e->>'pattern'),'{}'::text[]) from jsonb_array_elements(coalesce(v_wod_block->'exercises','[]'::jsonb)) e)) then 1 else 0 end,
             cp.candidate_score desc,cp.exercise_id
    limit 15
  loop
    v_examined:=v_examined+1;
    v_profile:=public.c4_exercise_mechanic_profile(p_user_id,v_candidate.exercise_id,v_mechanic,null,p_readiness,p_progression_intent);
    if not coalesce((v_profile->>'compatible')::boolean,false)
       or coalesce(v_profile->>'classification','') not in ('NATURAL','ADAPTABLE') then continue; end if;

    select coalesce(jsonb_agg(
      case when ord::int=v_replace_pos then jsonb_build_object(
        'exercise_id',v_candidate.exercise_id,'name',v_candidate.exercise_name,'pattern',v_candidate.movement_pattern,
        'family',v_candidate.exercise_family,'candidate_score',v_candidate.candidate_score,
        'components',coalesce(v_candidate.score_components,'{}'::jsonb),
        'prescription',public.c2_solver_prescription(p_user_id,v_candidate.exercise_id,coalesce(r->'stimulus','{}'::jsonb),v_mechanic,p_progression_intent,p_inventory),
        'mechanic_suitability',v_profile
      ) else e end order by ord
    ),'[]'::jsonb) into v_alt_exercises
    from jsonb_array_elements(coalesce(v_current->'exercises','[]'::jsonb)) with ordinality x(e,ord);

    v_alt_base:=(v_current-'c4_final')||jsonb_build_object('exercises',v_alt_exercises,'mechanic',v_mechanic);
    v_alt_final:=public.c4_finalize_candidate(v_alt_base,coalesce(r->'stimulus','{}'::jsonb),p_duration_minutes,v_wod_minutes,p_policy_key,'c3-sim-default');
    if coalesce(v_alt_final#>>'{c4_quality_gate,passed}','true')='false' then continue; end if;
    v_alt_fit:=coalesce(nullif(v_alt_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);

    select coalesce(jsonb_agg(
      case when b->>'block_key'='wod' then b||jsonb_build_object('exercises',v_alt_exercises) else b end order by ord
    ),'[]'::jsonb) into v_alt_blocks
    from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality z(b,ord);
    v_alt_budget:=public.c4_session_pattern_budget_v1(v_intent,v_alt_blocks,'{}'::jsonb);

    if coalesce(v_alt_budget->>'status','')='SOFT_OVERCONCENTRATION'
       and coalesce(nullif(v_alt_budget#>>'{metrics,max_pattern_concentration}','')::numeric,1)>=coalesce(nullif(v_budget#>>'{metrics,max_pattern_concentration}','')::numeric,1) then
      continue;
    end if;

    v_feasible:=v_feasible+1;
    if v_best_fit is null or v_alt_fit>v_best_fit or (v_alt_fit=v_best_fit and v_candidate.candidate_score>coalesce(v_best_candidate_score,-999)) then
      v_best:=v_alt_final;
      v_best_fit:=v_alt_fit;
      v_best_budget:=v_alt_budget;
      v_best_profile:=v_profile;
      v_best_candidate_score:=v_candidate.candidate_score;
    end if;
  end loop;

  if v_best is null then
    return jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object(
      'version','pattern-complement-v1','mode','ACTIVE','applied',false,'reason','NO_SAFE_COHERENT_ALTERNATIVE',
      'trigger',v_trigger,'target_pattern',v_target_pattern,'examined_candidates',v_examined,'feasible_candidates',v_feasible,
      'session_pattern_budget',v_budget,'rolling_policy',v_policy
    ),true);
  end if;

  v_quality_delta:=round(v_best_fit-v_current_fit,2);
  if v_quality_delta<v_delta_floor then
    return jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object(
      'version','pattern-complement-v1','mode','ACTIVE','applied',false,'reason','QUALITY_TRADEOFF_TOO_LARGE',
      'trigger',v_trigger,'target_pattern',v_target_pattern,'quality_delta',v_quality_delta,'quality_delta_floor',v_delta_floor,
      'session_pattern_budget',v_budget,'projected_pattern_budget',v_best_budget
    ),true);
  end if;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod' then
      b||jsonb_build_object(
        'mechanic',v_best->>'mechanic',
        'mechanic_json',v_best#>'{c4_final,mechanic_json}',
        'exercises',v_best->'exercises',
        'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',v_best#>'{c4_final,predicted_volume}','whole_wod_metrics',v_best#>'{c4_final,whole_wod_metrics}')
      )
    else b end order by ord
  ),'[]'::jsonb) into v_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality z(b,ord);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{selected_candidate}',v_best,true);
  r:=jsonb_set(r,'{architecture,pattern_complement}',jsonb_build_object(
    'version','pattern-complement-v1','mode','ACTIVE','applied',true,'trigger',v_trigger,
    'replace',jsonb_build_object('position',v_replace_pos,'exercise_id',v_replace_id,'movement_pattern',v_target_pattern),
    'with',jsonb_build_object('exercise_id',v_best#>>('{exercises,'||(v_replace_pos-1)||',exercise_id}')::text[],'movement_pattern',v_best#>>('{exercises,'||(v_replace_pos-1)||',pattern}')::text[]),
    'quality_delta',v_quality_delta,'quality_delta_floor',v_delta_floor,
    'current_whole_wod_fit',round(v_current_fit,2),'new_whole_wod_fit',round(v_best_fit,2),
    'session_pattern_budget_before',v_budget,'session_pattern_budget_after',v_best_budget,
    'health_equipment_level_and_mechanic_gates_preserved',true
  ),true);
  r:=jsonb_set(r,'{architecture,pattern_complement_authority}','"ACTIVE"'::jsonb,true);
  return r;
end;
$$;

revoke all on function public.c4_apply_pattern_complement_plan_v1(uuid,jsonb,jsonb,date,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon;
grant execute on function public.c4_apply_pattern_complement_plan_v1(uuid,jsonb,jsonb,date,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;

update public.session_engine_policy
set config=jsonb_set(config,'{pattern_complement}',jsonb_build_object(
  'enabled',true,
  'version','pattern-complement-v1',
  'shadow_mode',false,
  'apply_enabled',true,
  'quality_delta_floor',-2,
  'session_pattern_budget_trigger',true,
  'rolling_pattern_exposure_trigger',true,
  'single_high_pressure_station_can_remain',true,
  'hard_gates_override',true
),true), updated_at=now()
where policy_key='c4-final-default';

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure) into v_def;
  if position('c4_apply_pattern_complement_plan_v1' in v_def)=0 then
    v_old:='  v_plan:=public.c4_apply_preparation_quality_v3(';
    v_new:='  v_plan:=public.c4_apply_pattern_complement_plan_v1('||chr(10)||
      '    p_user_id,v_plan,v_context||jsonb_build_object(''session_intent_shadow'',v_intent,''skill_target_shadow'',v_skill_target),'||chr(10)||
      '    current_date,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,'||chr(10)||
      '    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key'||chr(10)||
      '  );'||chr(10)||chr(10)||
      '  v_plan:=public.c4_apply_preparation_quality_v3(';
    if position(v_old in v_def)=0 then raise exception 'Pattern complement insertion anchor not found'; end if;
    v_def:=replace(v_def,v_old,v_new);
    execute v_def;
  end if;
end $$;
