create or replace function public.program_coach_skill_target_shadow_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_intent jsonb:=coalesce(p_session_context->'session_intent_shadow','{}'::jsonb);
  v_intent_key text:=upper(coalesce(v_intent->>'proposed_session_intent',''));
  v_intent_conf numeric:=coalesce(nullif(v_intent->>'confidence','')::numeric,0);
  v_readiness text:=lower(coalesce(p_session_context->>'readiness','normal'));
  v_target_region text:=nullif(p_session_context->>'target_region','');
  v_pattern text;
  v_pattern_conf numeric:=0;
  v_pattern_score numeric:=0;
  v_path record;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if v_intent_key<>'SKILL_DEVELOPMENT' then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','SESSION_INTENT_NOT_SKILL_DEVELOPMENT','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  if v_intent_conf<0.70 then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','SESSION_INTENT_CONFIDENCE_TOO_LOW','session_intent',v_intent_key,'intent_confidence',round(v_intent_conf,2),'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  if v_readiness in ('low','faible') then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NOT_ELIGIBLE','reason','LOW_READINESS_SKILL_TARGET_SUPPRESSED','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  select x->>'movement_pattern',coalesce(nullif(x->>'confidence','')::numeric,0),coalesce(nullif(x->>'priority_score','')::numeric,0)
  into v_pattern,v_pattern_conf,v_pattern_score
  from jsonb_array_elements(coalesce(v_intent#>'{targets,movement_pattern_priorities}','[]'::jsonb)) x
  where nullif(x->>'movement_pattern','') is not null
    and (upper(coalesce(x->>'role','')) in ('PRIORITY','DEVELOP','RECALIBRATE') or upper(coalesce(x->>'directive','')) in ('PROGRESS','DEVELOPMENT_PRIORITY','RECALIBRATE'))
    and coalesce(nullif(x->>'confidence','')::numeric,0)>=0.50
  order by coalesce(nullif(x->>'priority_score','')::numeric,0) desc,coalesce(nullif(x->>'confidence','')::numeric,0) desc,x->>'movement_pattern'
  limit 1;
  if v_pattern is null then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NO_TARGET','reason','NO_RELIABLE_PATTERN_PRIORITY','session_intent',v_intent_key,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  select sp.path_key,sp.display_name,sp.body_region,sp.selection_priority,
         count(distinct m.exercise_id) filter(where e.movement_pattern=v_pattern)::int exact_pattern_members,
         count(distinct m.exercise_id)::int total_members
  into v_path
  from public.skill_paths sp
  join public.skill_path_members m on m.path_key=sp.path_key and m.active
  join public.exercises e on e.id=m.exercise_id
  where sp.active
    and public.c4_skill_path_region_compatible_v1(sp.body_region,v_target_region)
    and exists(select 1 from public.skill_path_members mm join public.exercises ee on ee.id=mm.exercise_id where mm.path_key=sp.path_key and mm.active and ee.movement_pattern=v_pattern)
  group by sp.path_key,sp.display_name,sp.body_region,sp.selection_priority
  order by count(distinct m.exercise_id) filter(where e.movement_pattern=v_pattern) desc,sp.selection_priority desc,sp.path_key
  limit 1;
  if not found then
    return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','NO_TARGET','reason','NO_CURATED_SKILL_PATH_FOR_PATTERN','session_intent',v_intent_key,'target_movement_pattern',v_pattern,'pattern_confidence',round(v_pattern_conf,2),'pattern_priority_score',round(v_pattern_score,2),'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false));
  end if;
  return jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','PROPOSED','reason','RELIABLE_PATTERN_PRIORITY_MATCHED_TO_CURATED_SKILL_PATH','session_intent',v_intent_key,'intent_confidence',round(v_intent_conf,2),'target_movement_pattern',v_pattern,'pattern_confidence',round(v_pattern_conf,2),'pattern_priority_score',round(v_pattern_score,2),'target_path_key',v_path.path_key,'target_path_name',v_path.display_name,'target_path_region',v_path.body_region,'exact_pattern_member_count',v_path.exact_pattern_members,'path_member_count',v_path.total_members,'requires_today_feasibility_check',true,'authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false,'health_equipment_level_and_manual_continuity_override',true));
end;
$$;
revoke all on function public.program_coach_skill_target_shadow_v1(uuid,date,jsonb) from public,anon;
grant execute on function public.program_coach_skill_target_shadow_v1(uuid,date,jsonb) to authenticated,service_role;

create or replace function public.c4_apply_skill_target_shadow_v1(
  p_user_id uuid,p_plan jsonb,p_skill_target_shadow jsonb,p_zone_terms text[] default '{}'::text[],p_inventory jsonb default '[]'::jsonb,p_target_region text default null,p_max_complexity integer default 3,p_progression_intent text default null,p_readiness text default 'normal'
) returns jsonb
language plpgsql stable set search_path to 'public'
as $$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb); v_status text:=coalesce(p_skill_target_shadow->>'status',''); v_path_key text:=nullif(p_skill_target_shadow->>'target_path_key',''); v_pattern text:=nullif(p_skill_target_shadow->>'target_movement_pattern','');
  v_skill_block jsonb; v_skill_minutes int:=0; v_current_id text; v_current_path text; v_wod_ids text[]:='{}'::text[]; v_choice record; v_pres jsonb; v_contract jsonb; v_ex jsonb; v_blocks jsonb; v_manual_anchor boolean:=false; v_same_day_continuity boolean:=false;
begin
  if coalesce(r->>'status','')<>'READY' then return r; end if;
  if v_status<>'PROPOSED' or v_path_key is null or v_pattern is null then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','NOT_APPLIED','reason','NO_ELIGIBLE_SKILL_TARGET'),true); end if;
  select b into v_skill_block from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='skill' limit 1;
  if v_skill_block is null then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','NOT_APPLIED','reason','NO_SKILL_BLOCK'),true); end if;
  v_skill_minutes:=coalesce(nullif(v_skill_block->>'duration_minutes','')::int,0); v_current_id:=v_skill_block#>>'{exercises,0,exercise_id}'; v_current_path:=coalesce(r#>>'{architecture,skill_path,path_key}',public.c4_skill_path_for_exercise_v1(v_current_id));
  v_manual_anchor:=coalesce((r#>>'{architecture,skill_path,manual_anchor}')::boolean,false) or coalesce((r#>>'{architecture,skill_trajectory_memory,manual_selected}')::boolean,false); v_same_day_continuity:=coalesce((r#>>'{architecture,skill_path,same_day_continuity}')::boolean,false);
  if v_manual_anchor then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','PRESERVED_CURRENT_SKILL','reason','MANUAL_SKILL_TRAJECTORY_ANCHOR_PRESERVED','current_exercise_id',v_current_id,'current_path_key',v_current_path,'target_path_key',v_path_key,'target_movement_pattern',v_pattern,'would_change_skill',false),true); end if;
  if v_same_day_continuity and v_current_path is distinct from v_path_key then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','PRESERVED_CURRENT_SKILL','reason','SAME_DAY_SKILL_CONTINUITY_PRESERVED','current_exercise_id',v_current_id,'current_path_key',v_current_path,'target_path_key',v_path_key,'target_movement_pattern',v_pattern,'would_change_skill',false),true); end if;
  select coalesce(array_agg(ex->>'exercise_id') filter(where nullif(ex->>'exercise_id','') is not null),'{}'::text[]) into v_wod_ids from jsonb_array_elements(coalesce((select b->'exercises' from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),'[]'::jsonb)) ex;
  select q.* into v_choice from (
    select e.*,m.step_order,m.member_role,upper(coalesce(s.recommendation,'')) recommendation,coalesce(s.valid_evidence_count,0) valid_evidence_count,coalesce(s.capability_confidence,s.overall_confidence,0) evidence_confidence,0 source_rank,ws.created_at source_time
    from public.workout_session_exercises wse join public.workout_sessions ws on ws.id=wse.session_id join public.skill_path_members m on m.exercise_id=wse.exercise_id and m.path_key=v_path_key and m.active join public.exercises e on e.id=wse.exercise_id left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where ws.user_id=p_user_id and wse.block_key='skill' and ws.status in ('completed','abandoned','generated','in_progress') and e.movement_pattern=v_pattern and coalesce(e.technical_complexity,99)<=p_max_complexity and coalesce(e.fatigue_score,99)<=5 and coalesce(e.joint_impact,99)<=4 and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))) and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb)) and not(e.id=any(v_wod_ids))
    union all
    select e.*,m.step_order,m.member_role,upper(coalesce(s.recommendation,'')) recommendation,coalesce(s.valid_evidence_count,0) valid_evidence_count,coalesce(s.capability_confidence,s.overall_confidence,0) evidence_confidence,1 source_rank,null::timestamptz source_time
    from public.skill_path_members m join public.exercises e on e.id=m.exercise_id left join public.user_exercise_coach_state s on s.user_id=p_user_id and s.exercise_id=e.id
    where m.path_key=v_path_key and m.active and e.movement_pattern=v_pattern and not coalesce(e.warmup_only,false) and coalesce(e.technical_complexity,99)<=p_max_complexity and coalesce(e.fatigue_score,99)<=5 and coalesce(e.joint_impact,99)<=4 and public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]))) and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb)) and not(e.id=any(v_wod_ids))
  ) q order by q.source_rank asc,q.source_time desc nulls last,case when q.recommendation in ('PROGRESS_RECOMMENDED','PROGRESS_POSSIBLE','RECALIBRATE','LEARN') then 0 else 1 end,case when q.valid_evidence_count>=3 and q.evidence_confidence>=0.60 then 0 else 1 end,q.step_order asc,q.technical_complexity asc,q.id limit 1;
  if not found then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','NOT_APPLIED','reason','TARGET_PATH_NOT_FEASIBLE_TODAY','target_path_key',v_path_key,'target_movement_pattern',v_pattern,'health_equipment_level_and_wod_distinctness_checked',true,'would_change_skill',false),true); end if;
  if v_current_path=v_path_key and v_current_id=v_choice.id then return jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','ALREADY_ALIGNED','current_exercise_id',v_current_id,'current_path_key',v_current_path,'target_path_key',v_path_key,'target_movement_pattern',v_pattern,'would_change_skill',false),true); end if;
  v_pres:=public.c2_solver_prescription(p_user_id,v_choice.id,coalesce(r->'stimulus','{}'::jsonb),'SKILL',p_progression_intent,coalesce(p_inventory,'[]'::jsonb))||jsonb_build_object('block_role','skill','target_duration_minutes',v_skill_minutes,'quality_priority','technique_before_fatigue','skill_reason','program_pattern_priority_shadow','skill_path_key',v_path_key,'skill_path_step',v_choice.step_order,'skill_target_shadow',true,'target_movement_pattern',v_pattern);
  v_contract:=public.c4_skill_contract_v1(p_user_id,v_choice.id,'program_pattern_priority_shadow',v_skill_minutes,p_progression_intent,p_readiness,v_pres);
  v_pres:=v_pres||coalesce(v_contract->'prescription_patch','{}'::jsonb)||jsonb_build_object('skill_path_key',v_path_key,'skill_path_step',v_choice.step_order,'skill_target_shadow',true,'target_movement_pattern',v_pattern);
  v_ex:=jsonb_build_object('exercise_id',v_choice.id,'name',v_choice.name,'family',v_choice.exercise_family,'pattern',v_choice.movement_pattern,'region',v_choice.body_region,'instructions',v_choice.instructions,'tips',v_choice.tips,'image_path',v_choice.image_path,'tracking_modes',coalesce(to_jsonb(v_choice.tracking_modes),'[]'::jsonb),'prescription',v_pres,'expected_outcome',jsonb_build_object('block_key','skill','goal','technical_quality_or_progression','skill_reason','program_pattern_priority_shadow','pain_gate',true,'equipment_gate',true,'skill_path_key',v_path_key,'skill_path_step',v_choice.step_order,'skill_objective_type',v_contract->>'objective_type','score_required',coalesce((v_contract->>'score_required')::boolean,false),'score_metric',v_contract->>'score_metric','skill_target_shadow',true,'target_movement_pattern',v_pattern));
  select coalesce(jsonb_agg(case when b->>'block_key'='skill' then b||jsonb_build_object('block_name','Skill','exercises',jsonb_build_array(v_ex),'structure',v_contract->>'structure','objective',(v_contract->>'objective_title')||' — '||(v_contract->>'objective_description'),'skill_contract',v_contract,'skill_path',jsonb_build_object('key',v_path_key,'step',v_choice.step_order,'source','SESSION_INTENT_SHADOW')) else b end order by ord),'[]'::jsonb) into v_blocks from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);
  r:=jsonb_set(r,'{blocks}',v_blocks,true);
  r:=jsonb_set(r,'{architecture,skill_target_shadow_application}',jsonb_build_object('version','skill-target-shadow-application-v1','mode','SHADOW','status','PROPOSED_REPLACEMENT','current_exercise_id',v_current_id,'current_path_key',v_current_path,'proposed_exercise_id',v_choice.id,'proposed_path_key',v_path_key,'target_movement_pattern',v_pattern,'would_change_skill',true,'wod_unchanged',true,'warmup_must_be_recomputed_after_shadow_skill',true),true);
  return r;
end;
$$;
revoke all on function public.c4_apply_skill_target_shadow_v1(uuid,jsonb,jsonb,text[],jsonb,text,integer,text,text) from public,anon;
grant execute on function public.c4_apply_skill_target_shadow_v1(uuid,jsonb,jsonb,text[],jsonb,text,integer,text,text) to authenticated,service_role;

create or replace function public.c4_plan_full_session_skill_target_shadow_v1(
  p_user_id uuid,p_focus text,p_duration_minutes integer,p_readiness text,p_skill_target_shadow jsonb,p_target_region text default null,p_progression_intent text default null,p_zone_terms text[] default '{}'::text[],p_inventory jsonb default '[]'::jsonb,p_max_complexity integer default 3,p_max_difficulty text default 'Intermédiaire',p_candidate_count integer default 12,p_policy_key text default 'c4-final-default'
) returns jsonb language plpgsql stable set search_path to 'public'
as $$ declare v_plan jsonb; begin
  v_plan:=public.c4_plan_full_session_pre_preparation_v12(p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key);
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
  v_plan:=public.c4_apply_skill_target_shadow_v1(p_user_id,v_plan,p_skill_target_shadow,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent,p_readiness);
  v_plan:=public.c4_apply_preparation_quality_v3(p_user_id,v_plan,p_zone_terms,p_inventory,p_target_region,p_max_complexity,p_progression_intent);
  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
  return public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);
end; $$;
revoke all on function public.c4_plan_full_session_skill_target_shadow_v1(uuid,text,integer,text,jsonb,text,text,text[],jsonb,integer,text,integer,text) from public,anon;
grant execute on function public.c4_plan_full_session_skill_target_shadow_v1(uuid,text,integer,text,jsonb,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;

create or replace function public.d_resolve_session_context_v6(
  p_user_id uuid,p_anchor_date date default current_date,p_duration_minutes integer default 45,p_readiness text default 'normal',p_focus_override text default null,p_target_region_override text default null,p_progression_intent_override text default null,p_available_equipment text[] default '{}'::text[],p_zone_terms text[] default '{}'::text[],p_force_recalculate_started boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_base jsonb; v_program jsonb:='{}'::jsonb; v_directive jsonb:='{}'::jsonb; v_session_intent jsonb:='{}'::jsonb; v_skill_target jsonb:='{}'::jsonb; v_program_error text:=null; v_session_intent_error text:=null; v_skill_target_error text:=null; v_shadow boolean:=true; v_apply boolean:=false; v_new_intent text;
begin
  v_base:=public.d_resolve_session_context_v6_pre_program_coach(p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override,p_available_equipment,p_zone_terms,p_force_recalculate_started);
  begin
    select coalesce((config#>>'{program_coach,shadow_mode}')::boolean,true) into v_shadow from public.session_engine_policy where policy_key='c4-final-default';
    v_program:=public.program_coach_snapshot_v1(p_user_id,coalesce(p_anchor_date,current_date)); v_directive:=public.program_coach_session_directive_v1(p_user_id,coalesce(p_anchor_date,current_date),v_base); v_apply:=not v_shadow and coalesce((v_directive->>'may_apply')::boolean,false);
    if v_apply then v_new_intent:=nullif(v_directive->>'proposed_progression_intent',''); if v_new_intent is not null then v_base:=jsonb_set(v_base,'{progression_intent}',to_jsonb(v_new_intent),true); v_base:=jsonb_set(v_base,'{reason_codes}',coalesce(v_base->'reason_codes','[]'::jsonb)||jsonb_build_array('program_coach:'||lower(coalesce(v_directive->>'reason','applied'))),true); end if; end if;
  exception when others then v_program_error:=sqlerrm; v_program:=jsonb_build_object('version','program-coach-snapshot-v1','mode','SHADOW','status','UNAVAILABLE','authority',jsonb_build_object('may_change_session_decision',false,'shadow_only',true)); v_directive:=jsonb_build_object('status','UNAVAILABLE','would_change',false,'may_apply',false); v_apply:=false; end;
  begin v_session_intent:=public.program_coach_session_intent_shadow_v1(p_user_id,coalesce(p_anchor_date,current_date),v_base,p_duration_minutes,p_readiness); exception when others then v_session_intent_error:=sqlerrm; v_session_intent:=jsonb_build_object('version','session-intent-shadow-v1','mode','SHADOW','status','UNAVAILABLE','proposed_session_intent',null,'reason','SHADOW_EVALUATION_ERROR','authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)); end;
  v_base:=v_base||jsonb_build_object('session_intent_shadow',v_session_intent);
  begin v_skill_target:=public.program_coach_skill_target_shadow_v1(p_user_id,coalesce(p_anchor_date,current_date),v_base); exception when others then v_skill_target_error:=sqlerrm; v_skill_target:=jsonb_build_object('version','skill-target-shadow-v1','mode','SHADOW','status','UNAVAILABLE','reason','SHADOW_EVALUATION_ERROR','authority',jsonb_build_object('shadow_only',true,'may_change_skill',false,'may_change_session_decision',false)); end;
  return v_base||jsonb_build_object('program_coach_shadow',v_program,'program_coach_session_directive',v_directive,'program_coach_shadow_mode',v_shadow,'program_coach_applied',v_apply,'program_coach_shadow_error',v_program_error,'session_intent_shadow',v_session_intent,'session_intent_shadow_error',v_session_intent_error,'skill_target_shadow',v_skill_target,'skill_target_shadow_error',v_skill_target_error);
end; $$;