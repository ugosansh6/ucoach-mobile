-- C4.3 — one backend Session Engine orchestrates the whole session.

create or replace function public.c4_plan_full_session(
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
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_stimulus jsonb;
  v_warmup_min int;
  v_tabata_min int:=0;
  v_skill_min int:=0;
  v_wod_min int;
  v_include_tabata boolean:=false;
  v_include_skill boolean:=false;
  v_warmup_count int;
  v_warmup jsonb:='[]'::jsonb;
  v_tabata jsonb:='[]'::jsonb;
  v_skill jsonb:='[]'::jsonb;
  v_wod jsonb;
  v_wod_candidate jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  r record;
  v_role text;
  v_order int:=0;
  v_target_patterns text[]:='{}'::text[];
begin
  if p_duration_minutes<20 or p_duration_minutes>180 then
    raise exception 'Unsupported session duration %',p_duration_minutes;
  end if;

  v_stimulus:=public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  );

  -- Dynamic architecture. Warm-up is mandatory; Tabata and Skill are optional.
  v_warmup_min:=case when p_duration_minutes<=35 then 5 when p_duration_minutes<=60 then 6 else 7 end;
  v_warmup_count:=case when p_duration_minutes<=35 then 2 when p_duration_minutes<=60 then 3 else 4 end;

  v_include_tabata:=p_duration_minutes>=45 and (
    p_focus in ('General Fitness','Fat Loss','Conditioning') or p_target_region='Core'
  );
  if v_include_tabata then v_tabata_min:=4; end if;

  v_include_skill:=p_duration_minutes>=45 and (
    p_focus in ('Strength','Muscle Gain') or upper(coalesce(p_progression_intent,'')) in ('PROGRESS','CONSOLIDATE','EXPLORE')
  );
  if v_include_skill then v_skill_min:=case when p_duration_minutes>=75 then 10 else 8 end; end if;

  v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min-v_skill_min;
  if v_wod_min<10 then
    -- WOD is the primary block; optional blocks yield first.
    v_skill_min:=0;v_include_skill:=false;
    v_wod_min:=p_duration_minutes-v_warmup_min-v_tabata_min;
  end if;
  if v_wod_min<10 then
    v_tabata_min:=0;v_include_tabata:=false;
    v_wod_min:=p_duration_minutes-v_warmup_min;
  end if;

  -- Target patterns are known from target region/focus before WOD selection and used for movement prep priority.
  select coalesce(array_agg(distinct movement_pattern),'{}'::text[])
  into v_target_patterns
  from public.exercises e
  where (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
    and 'WOD'=any(e.usable_for)
    and not coalesce(e.warmup_only,false)
    and e.technical_complexity<=p_max_complexity;

  -- Warm-up: hard gates + strict warm-up metadata, then role diversity.
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
    return jsonb_build_object('version','c4-full-session-v1','status','NO_SAFE_WARMUP','production_mutation',false,'stimulus',v_stimulus);
  end if;

  -- Optional core-only Tabata, strict 20/10 x 8 protocol.
  if v_include_tabata then
    for r in
      select e.*
      from public.exercises e
      where 'Core'=any(e.usable_for)
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
    if jsonb_array_length(v_tabata)=0 then v_include_tabata:=false;v_tabata_min:=0;v_wod_min:=v_wod_min+4; end if;
  end if;

  -- Optional Skill: technique/progression without turning into a second WOD.
  if v_include_skill then
    select e.* into r
    from public.exercises e
    left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where 'Skill'=any(e.usable_for)
      and not coalesce(e.warmup_only,false)
      and coalesce(e.technical_complexity,99)<=p_max_complexity
      and coalesce(e.fatigue_score,99)<=3
      and coalesce(e.joint_impact,99)<=3
      and (p_target_region is null or p_target_region='Full Body' or e.body_region=p_target_region)
      and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
      and public.exercise_equipment_compatible(e.id,p_inventory)
    order by
      case when coalesce(s.recommendation,'') in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE') then 0 else 1 end,
      coalesce(s.mastery_score,0) asc,coalesce(e.selection_weight,0) desc,e.id
    limit 1;

    if found then
      v_pres:=public.c2_solver_prescription(p_user_id,r.id,v_stimulus,'SKILL',p_progression_intent,p_inventory)
        ||jsonb_build_object('block_role','skill','target_duration_minutes',v_skill_min,'quality_priority','technique_before_fatigue');
      v_skill:=jsonb_build_array(jsonb_build_object(
        'exercise_id',r.id,'name',r.name,'pattern',r.movement_pattern,'family',r.exercise_family,'prescription',v_pres,
        'expected_outcome',jsonb_build_object('block_key','skill','goal','technical_quality_or_progression','pain_gate',true,'equipment_gate',true)
      ));
    else
      v_include_skill:=false;v_skill_min:=0;v_wod_min:=v_wod_min+case when p_duration_minutes>=75 then 10 else 8 end;
    end if;
  end if;

  -- C4 remains authoritative for the WOD.
  v_wod:=public.solve_session_engine_c4(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_min,p_policy_key
  );
  if coalesce(v_wod->>'status','')<>'READY' or v_wod->'selected_candidate' is null then
    return jsonb_build_object(
      'version','c4-full-session-v1','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'architecture',jsonb_build_object('warmup_minutes',v_warmup_min,'tabata_minutes',v_tabata_min,'skill_minutes',v_skill_min,'wod_minutes',v_wod_min),
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
      'expected_outcome',jsonb_build_object('role','skill','quality_priority',true)
    ));
  end if;
  v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object(
    'block_key','wod','block_name','WOD principal','duration_minutes',v_wod_min,'required',true,
    'mechanic',v_wod_candidate->>'mechanic','mechanic_json',v_wod_candidate#>'{c4_final,mechanic_json}',
    'exercises',v_wod_candidate->'exercises','expected_outcome',jsonb_build_object(
      'role','primary_training_stimulus','predicted_volume',v_wod_candidate#>'{c4_final,predicted_volume}',
      'whole_wod_metrics',v_wod_candidate#>'{c4_final,whole_wod_metrics}')
  ));

  return jsonb_build_object(
    'version','c4-full-session-v1','status','READY','production_mutation',false,
    'stimulus',v_stimulus,
    'architecture',jsonb_build_object(
      'total_minutes',p_duration_minutes,'warmup_minutes',v_warmup_min,'tabata_minutes',v_tabata_min,
      'skill_minutes',v_skill_min,'wod_minutes',v_wod_min,'tabata_optional',true,'skill_optional',true,'warmup_required',true,'wod_required',true),
    'blocks',v_blocks,
    'wod_solver',jsonb_build_object(
      'version',v_wod->'version','candidate_count',v_wod->'candidate_count','quality_gate',v_wod_candidate->'c4_quality_gate',
      'anti_redundancy',v_wod_candidate->'c4_anti_redundancy','selection_score',v_wod_candidate->'c4_selection_score'),
    'selected_candidate',v_wod_candidate
  );
end;
$$;

-- Mutating authenticated entrypoint: persists the entire plan and exact exercise instances.
create or replace function public.c4_generate_full_session(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan jsonb;
  v_session_id uuid;
  v_blocks jsonb:='[]'::jsonb;
  v_block jsonb;
  v_block_out jsonb;
  v_ex jsonb;
  v_ex_out jsonb;
  v_pres jsonb;
  v_instance uuid;
  v_db_block text;
  v_position int;
  v_cap jsonb;
  v_generated jsonb;
  v_mechanic jsonb;
  v_quality jsonb;
  v_rpe_min numeric;
  v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_plan:=public.c4_plan_full_session(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=coalesce(v_plan#>'{selected_candidate,c4_final,mechanic_json}','{}'::jsonb);
  v_quality:=coalesce(v_plan#>'{selected_candidate,c4_quality_gate}','{}'::jsonb)||jsonb_build_object(
    'anti_redundancy',coalesce(v_plan#>'{selected_candidate,c4_anti_redundancy}','{}'::jsonb),
    'selection_score',v_plan#>'{selected_candidate,c4_selection_score}');
  v_rpe_min:=nullif(v_plan#>>'{stimulus,rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(v_plan#>>'{stimulus,rpe_target,max}','')::numeric;

  insert into public.workout_sessions(
    user_id,status,duration_minutes,target_region,readiness,focus,available_equipment,injured_zones,progression_intent,
    planning_context_json,expected_stimulus_json,mechanic_json,quality_gate_json,generated_workout
  ) values (
    p_user_id,'generated',p_duration_minutes,p_target_region,p_readiness,p_focus,coalesce(p_available_equipment,'{}'::text[]),coalesce(p_zone_terms,'{}'::text[]),
    case when upper(coalesce(p_progression_intent,'')) in ('MAINTAIN','PROGRESS','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then upper(p_progression_intent) else null end,
    jsonb_build_object('engine','c4-full-session-v1','architecture',v_plan->'architecture','full_session_authority',true),
    coalesce(v_plan->'stimulus','{}'::jsonb),v_mechanic,v_quality,'{}'::jsonb
  ) returning id into v_session_id;

  for v_block in select value from jsonb_array_elements(v_plan->'blocks')
  loop
    v_db_block:=case v_block->>'block_key' when 'warmup' then 'warm_up' else v_block->>'block_key' end;
    v_block_out:=v_block;
    v_ex_out:='[]'::jsonb;v_position:=0;

    for v_ex in select value from jsonb_array_elements(coalesce(v_block->'exercises','[]'::jsonb))
    loop
      v_position:=v_position+1;
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      select coalesce(jsonb_build_object(
        'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
        'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,
        'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
        'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,
        'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
      into v_cap
      from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        v_session_id,v_ex->>'exercise_id',coalesce(v_ex->>'name',(select name from public.exercises where id=v_ex->>'exercise_id')),
        v_db_block,v_position,'pending',coalesce(v_pres->>'text','Prescription adaptée'),v_pres,
        coalesce(v_ex->'expected_outcome',v_block->'expected_outcome','{}'::jsonb),v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine','c4-full-session-v1','block_key',v_block->>'block_key','full_session_authority',true,
          'mechanic',case when v_block->>'block_key'='wod' then v_block->>'mechanic' else null end)
      ) returning id into v_instance;

      v_ex_out:=v_ex_out||jsonb_build_array(v_ex||jsonb_build_object('id',v_ex->>'exercise_id','session_exercise_id',v_instance));
    end loop;

    v_block_out:=jsonb_set(v_block_out,'{exercises}',v_ex_out,true);
    v_blocks:=v_blocks||jsonb_build_array(v_block_out);
  end loop;

  v_generated:=jsonb_build_object(
    'version','c4-full-session-v1','session_id',v_session_id,
    'meta',jsonb_build_object('session_engine','c4-full-session-v1','full_session_authority',true,'architecture',v_plan->'architecture',
      'target_region',p_target_region,'focus',p_focus,'progression_intent',p_progression_intent),
    'blocks',v_blocks
  );

  update public.workout_sessions set generated_workout=v_generated,updated_at=now() where id=v_session_id;

  return jsonb_build_object('session_id',v_session_id,'status','generated','version','c4-full-session-v1',
    'meta',v_generated->'meta','blocks',v_blocks,'stimulus',v_plan->'stimulus','wod_solver',v_plan->'wod_solver');
end;
$$;

revoke all on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) from public;
grant execute on function public.c4_generate_full_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text) to authenticated;
;
