create or replace function public.c4_reinvest_available_time_v1(
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
language plpgsql stable security definer set search_path='public'
as $$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_enabled boolean:=true;
  v_intent text:=upper(coalesce(p_session_intent,'CLASSIC'));
  v_readiness text:=public.normalize_session_readiness(p_readiness);
  v_unallocated int:=coalesce(nullif(r#>>'{architecture,unallocated_available_minutes}','')::int,0);
  v_current_wod int:=coalesce(nullif(r#>>'{architecture,wod_minutes}','')::int,0);
  v_base_target int:=coalesce(nullif(r#>>'{architecture,wod_target_minutes}','')::int,v_current_wod);
  v_current_fit numeric:=coalesce(nullif(r#>>'{selected_candidate,c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
  v_current_skill int:=coalesce(nullif(r#>>'{architecture,skill_minutes}','')::int,0);
  v_bonus_cap int;
  v_try int;
  v_solver jsonb;
  v_candidate jsonb;
  v_fit numeric;
  v_actual int;
  v_added int;
  v_best jsonb:=null;
  v_best_fit numeric:=null;
  v_best_actual int:=null;
  v_best_target int:=null;
  v_best_added int:=null;
  v_blocks jsonb;
  v_wod_block jsonb;
  v_skill_block jsonb;
  v_skill_ex jsonb;
  v_skill_id text;
  v_skill_reason text;
  v_skill_pres jsonb;
  v_contract jsonb;
  v_new_skill int;
  v_active int;
  v_planned int;
  v_transition int:=coalesce(nullif(r#>>'{architecture,transition_recovery_minutes}','')::int,0);
  v_quality_floor numeric:=-2;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;

  select coalesce((config#>>'{time_reinvestment,enabled}')::boolean,true),
         coalesce(nullif(config#>>'{time_reinvestment,quality_delta_floor}','')::numeric,-2)
  into v_enabled,v_quality_floor
  from public.session_engine_policy where policy_key=p_policy_key;

  if not v_enabled or v_unallocated<4 or v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' or v_intent='CONSOLIDATE' then
    return jsonb_set(r,'{architecture,time_reinvestment}',jsonb_build_object(
      'version','time-reinvestment-v1','mode','ACTIVE','applied',false,
      'reason',case when not v_enabled then 'DISABLED' when v_unallocated<4 then 'TOO_LITTLE_USEFUL_TIME' else 'RECOVERY_OR_DELOAD_PRESERVES_SHORTER_SESSION' end,
      'available_unused_minutes',v_unallocated,'duration_is_maximum_not_fill_target',true
    ),true);
  end if;

  -- Skill-development sessions may use a small part of the spare time to deepen the Skill.
  if v_intent='SKILL_DEVELOPMENT' and v_current_skill>0 then
    v_new_skill:=v_current_skill+least(3,v_unallocated);
    select b into v_skill_block from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='skill' limit 1;
    v_skill_ex:=coalesce(v_skill_block#>'{exercises,0}','{}'::jsonb);
    v_skill_id:=nullif(v_skill_ex->>'exercise_id','');
    v_skill_reason:=coalesce(r#>>'{architecture,skill_reason}',v_skill_block#>>'{expected_outcome,skill_reason}','focus_development');
    if v_skill_id is not null then
      v_skill_pres:=coalesce(v_skill_ex->'prescription','{}'::jsonb);
      v_contract:=public.c4_skill_contract_v1(p_user_id,v_skill_id,v_skill_reason,v_new_skill,p_progression_intent,p_readiness,v_skill_pres);
      v_skill_pres:=v_skill_pres||coalesce(v_contract->'prescription_patch','{}'::jsonb);
      select coalesce(jsonb_agg(
        case when b->>'block_key'='skill' then b||jsonb_build_object(
          'duration_minutes',v_new_skill,'structure',v_contract->>'structure',
          'objective',(v_contract->>'objective_title')||' — '||(v_contract->>'objective_description'),
          'skill_contract',v_contract,
          'exercises',(select coalesce(jsonb_agg(case when ord2=1 then e2||jsonb_build_object('prescription',v_skill_pres) else e2 end order by ord2),'[]'::jsonb) from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality y(e2,ord2))
        ) else b end order by ord
      ),'[]'::jsonb) into v_blocks
      from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);
      r:=jsonb_set(r,'{blocks}',v_blocks,true);
      v_active:=coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)+(v_new_skill-v_current_skill);
      v_planned:=v_active+v_transition;
      r:=jsonb_set(r,'{architecture,skill_minutes}',to_jsonb(v_new_skill),true);
      r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
      r:=jsonb_set(r,'{architecture,active_block_budget_minutes}',to_jsonb(v_active),true);
      r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
      r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
      return jsonb_set(r,'{architecture,time_reinvestment}',jsonb_build_object(
        'version','time-reinvestment-v1','mode','ACTIVE','applied',true,'destination','SKILL',
        'minutes_added',v_new_skill-v_current_skill,'skill_minutes_before',v_current_skill,'skill_minutes_after',v_new_skill,
        'available_unused_minutes_before',v_unallocated,'available_unused_minutes_after',greatest(0,p_duration_minutes-v_planned),
        'duration_is_maximum_not_fill_target',true,'not_mandatory_fill',true
      ),true);
    end if;
  end if;

  if v_current_wod<=0 then
    return jsonb_set(r,'{architecture,time_reinvestment}',jsonb_build_object('version','time-reinvestment-v1','mode','ACTIVE','applied',false,'reason','NO_WOD'),true);
  end if;

  v_bonus_cap:=least(5,v_unallocated);
  for v_try in (v_base_target+1)..(v_base_target+v_bonus_cap) loop
    if v_intent='CLASSIC' then
      v_solver:=public.solve_session_engine_c4(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
      );
    else
      v_solver:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_try,p_policy_key
      );
    end if;
    if coalesce(v_solver->>'status','')<>'READY' or v_solver->'selected_candidate' is null then continue; end if;
    v_candidate:=v_solver->'selected_candidate';
    v_fit:=coalesce(nullif(v_candidate#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
    v_actual:=case
      when upper(coalesce(v_candidate->>'mechanic',''))='SETS_REPS' and nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','') is not null
      then least(coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try),greatest(10,ceil(nullif(v_candidate#>>'{c4_final,mechanic_json,predicted_elapsed_seconds}','')::numeric/60.0)::int))
      else coalesce(nullif(v_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,v_try)
    end;
    v_added:=v_actual-v_current_wod;
    if v_added<2 or v_added>v_bonus_cap then continue; end if;
    if v_fit<v_current_fit+v_quality_floor then continue; end if;
    if v_best_fit is null or v_fit>v_best_fit or (v_fit=v_best_fit and v_added<v_best_added) then
      v_best:=v_candidate; v_best_fit:=v_fit; v_best_actual:=v_actual; v_best_target:=v_try; v_best_added:=v_added;
    end if;
  end loop;

  if v_best is null then
    return jsonb_set(r,'{architecture,time_reinvestment}',jsonb_build_object(
      'version','time-reinvestment-v1','mode','ACTIVE','applied',false,'reason','NO_QUALITY_PRESERVING_USE_OF_SPARE_TIME',
      'available_unused_minutes',v_unallocated,'attempted_bonus_minutes',v_bonus_cap,'duration_is_maximum_not_fill_target',true,'not_mandatory_fill',true
    ),true);
  end if;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod' then b||jsonb_build_object(
      'duration_minutes',v_best_actual,'mechanic',v_best->>'mechanic','mechanic_json',v_best#>'{c4_final,mechanic_json}',
      'exercises',v_best->'exercises',
      'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',v_best#>'{c4_final,predicted_volume}','whole_wod_metrics',v_best#>'{c4_final,whole_wod_metrics}')
    ) else b end order by ord
  ),'[]'::jsonb) into v_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{selected_candidate}',v_best,true);
  v_active:=coalesce(nullif(r#>>'{architecture,active_training_minutes}','')::int,0)+v_best_added;
  v_planned:=v_active+v_transition;
  r:=jsonb_set(r,'{architecture,wod_minutes}',to_jsonb(v_best_actual),true);
  r:=jsonb_set(r,'{architecture,active_training_minutes}',to_jsonb(v_active),true);
  r:=jsonb_set(r,'{architecture,active_block_budget_minutes}',to_jsonb(v_active),true);
  r:=jsonb_set(r,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
  r:=jsonb_set(r,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
  r:=jsonb_set(r,'{architecture,wod_duration_guardrail,final_wod_minutes}',to_jsonb(v_best_actual),true);
  r:=jsonb_set(r,'{architecture,opportunistic_wod_target_minutes}',to_jsonb(v_best_target),true);
  r:=jsonb_set(r,'{wod_solver,quality_gate}',coalesce(v_best->'c4_quality_gate','{}'::jsonb),true);
  r:=jsonb_set(r,'{wod_solver,selection_score}',coalesce(v_best->'c4_selection_score','0'::jsonb),true);
  return jsonb_set(r,'{architecture,time_reinvestment}',jsonb_build_object(
    'version','time-reinvestment-v1','mode','ACTIVE','applied',true,'destination','WOD',
    'minutes_added',v_best_added,'wod_minutes_before',v_current_wod,'wod_minutes_after',v_best_actual,
    'base_wod_target_minutes',v_base_target,'opportunistic_solver_target_minutes',v_best_target,
    'current_whole_wod_fit',round(v_current_fit,2),'new_whole_wod_fit',round(v_best_fit,2),
    'quality_delta',round(v_best_fit-v_current_fit,2),'quality_delta_floor',v_quality_floor,
    'available_unused_minutes_before',v_unallocated,'available_unused_minutes_after',greatest(0,p_duration_minutes-v_planned),
    'duration_is_maximum_not_fill_target',true,'not_mandatory_fill',true,'max_opportunistic_addition_minutes',5
  ),true);
end;
$$;

revoke all on function public.c4_reinvest_available_time_v1(uuid,jsonb,text,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon;
grant execute on function public.c4_reinvest_available_time_v1(uuid,jsonb,text,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;

update public.session_engine_policy
set config=jsonb_set(config,'{time_reinvestment}',jsonb_build_object(
  'enabled',true,'version','time-reinvestment-v1','max_opportunistic_addition_minutes',5,
  'minimum_spare_minutes_to_evaluate',4,'quality_delta_floor',-2,
  'duration_is_maximum_not_fill_target',true,'mandatory_fill',false,
  'skill_development_prefers_skill',true,'consolidate_preserves_shorter_session',true
),true), updated_at=now()
where policy_key='c4-final-default';

do $$
declare v_def text; v_anchor text; v_insert text;
begin
  select pg_get_functiondef('public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)'::regprocedure) into v_def;
  if position('c4_reinvest_available_time_v1' in v_def)=0 then
    v_anchor:='  v_plan:=public.c4_apply_pattern_complement_plan_v1(';
    v_insert:='  v_plan:=public.c4_reinvest_available_time_v1('||chr(10)||
      '    p_user_id,v_plan,v_intent_key,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,'||chr(10)||
      '    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key'||chr(10)||
      '  );'||chr(10)||chr(10)||
      '  v_plan:=public.c4_apply_pattern_complement_plan_v1(';
    if position(v_anchor in v_def)=0 then raise exception 'Time reinvestment insertion anchor not found'; end if;
    v_def:=replace(v_def,v_anchor,v_insert);
    execute v_def;
  end if;
end $$;
