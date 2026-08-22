-- Skill Curriculum V1 — runtime lesson composition + W4 exposure.

create or replace function public.c4_apply_skill_curriculum_v1(
 p_user_id uuid,
 p_plan jsonb,
 p_zone_terms text[] default '{}'::text[],
 p_inventory jsonb default '[]'::jsonb,
 p_max_complexity integer default 3,
 p_progression_intent text default null,
 p_readiness text default 'normal'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
 r jsonb:=coalesce(p_plan,'{}'::jsonb);
 v_skill jsonb;
 v_target jsonb;
 v_target_id text;
 v_path text;
 v_minutes int;
 v_target_step public.skill_curriculum_steps_v1%rowtype;
 v_target_json jsonb;
 v_target_complexity int:=1;
 v_ids text[];
 v_safe text[]:='{}'::text[];
 v_wod text[]:='{}'::text[];
 v_limit int;
 v_count int;
 v_alloc int;
 v_id text;
 v_ord int;
 v_e public.exercises%rowtype;
 v_s public.skill_curriculum_steps_v1%rowtype;
 v_sj jsonb;
 v_role text;
 v_base jsonb;
 v_contract jsonb;
 v_pres jsonb;
 v_sets int;
 v_exercises jsonb:='[]'::jsonb;
 v_blocks jsonb;
 v_original_contract jsonb;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
 if coalesce(r->>'status','')<>'READY' then return r; end if;

 select b into v_skill
 from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
 where b->>'block_key'='skill'
 limit 1;
 if v_skill is null or jsonb_array_length(coalesce(v_skill->'exercises','[]'::jsonb))=0 then return r; end if;

 v_minutes:=coalesce(nullif(v_skill->>'duration_minutes','')::int,0);
 v_target:=v_skill#>'{exercises,0}';
 v_target_id:=v_target->>'exercise_id';
 v_path:=coalesce(
  v_target#>>'{prescription,skill_path_key}',
  v_skill#>>'{skill_path,key}',
  r#>>'{architecture,skill_path,path_key}'
 );
 v_original_contract:=coalesce(v_skill->'skill_contract','{}'::jsonb);

 -- A real controlled test remains a single test. Curriculum never creates extra calibration work.
 if coalesce((v_original_contract->>'score_required')::boolean,false) then
  return jsonb_set(
   r,'{architecture,skill_curriculum}',
   jsonb_build_object(
    'version','skill-curriculum-v1','applied',false,'reason','TARGET_CONTROLLED_TEST',
    'no_extra_calibration_added',true
   ),true
  );
 end if;

 select * into v_target_step
 from public.skill_curriculum_steps_v1
 where path_key=v_path and exercise_id=v_target_id and active;
 if not found then
  return jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object(
   'version','skill-curriculum-v1','applied',false,'reason','NO_CURATED_STEP'
  ),true);
 end if;

 v_target_json:=public.skill_curriculum_step_v1(v_path,v_target_id);
 select coalesce(technical_complexity,1) into v_target_complexity from public.exercises where id=v_target_id;
 v_ids:=public.skill_curriculum_lesson_ids_v1(v_path,v_target_id);
 v_limit:=case when v_minutes>=9 then 4 when v_minutes>=6 then 3 else 2 end;

 select coalesce(array_agg(eid order by ord),'{}'::text[]) into v_wod
 from (
  select e->>'exercise_id' eid,ord
  from jsonb_array_elements(coalesce(
   (select b->'exercises' from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1),
   '[]'::jsonb
  )) with ordinality z(e,ord)
 ) q;

 select coalesce(array_agg(exercise_id order by ord),'{}'::text[]) into v_safe
 from (
  select d.exercise_id,d.ord
  from unnest(v_ids) with ordinality d(exercise_id,ord)
  join public.exercises e on e.id=d.exercise_id
  join public.skill_path_members m on m.path_key=v_path and m.exercise_id=d.exercise_id and m.active
  where public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])))
    and public.exercise_equipment_compatible(e.id,coalesce(p_inventory,'[]'::jsonb))
    and coalesce(e.fatigue_score,99)<=5
    and coalesce(e.joint_impact,99)<=4
    and (d.exercise_id=v_target_id or coalesce(e.technical_complexity,99)<=least(5,greatest(coalesce(p_max_complexity,3),v_target_complexity+1)))
    and (d.exercise_id=v_target_id or not (d.exercise_id=any(v_wod)))
  order by d.ord
  limit v_limit
 ) q;

 if not (v_target_id=any(v_safe)) then v_safe:=array_prepend(v_target_id,v_safe); end if;
 v_count:=coalesce(cardinality(v_safe),0);
 if v_count<2 then
  return jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object(
   'version','skill-curriculum-v1','applied',false,'reason','NO_SAFE_COMPANION'
  ),true);
 end if;

 v_alloc:=greatest(2,floor(v_minutes::numeric/v_count)::int);

 for v_id,v_ord in
  select exercise_id,ord::int from unnest(v_safe) with ordinality q(exercise_id,ord) order by ord
 loop
  select * into v_e from public.exercises where id=v_id;
  select * into v_s from public.skill_curriculum_steps_v1 where path_key=v_path and exercise_id=v_id and active;
  v_sj:=public.skill_curriculum_step_v1(v_path,v_id);
  v_role:=case
   when v_id=v_target_id then 'TARGET'
   when v_s.step_order<v_target_step.step_order then 'FOUNDATION'
   when v_s.step_order=v_target_step.step_order then 'COMPANION'
   else 'TRANSFER'
  end;

  v_base:=public.c2_solver_prescription(
   p_user_id,v_id,coalesce(r->'stimulus','{}'::jsonb),'SKILL',p_progression_intent,coalesce(p_inventory,'[]'::jsonb)
  );
  v_contract:=public.c4_skill_contract_v1(
   p_user_id,v_id,coalesce(r#>>'{architecture,skill_reason}','curriculum_learning'),
   v_alloc,p_progression_intent,p_readiness,v_base
  );
  v_pres:=case when v_id=v_target_id then coalesce(v_target->'prescription','{}'::jsonb) else v_base end
          ||coalesce(v_contract->'prescription_patch','{}'::jsonb);
  v_sets:=coalesce(nullif(v_pres->>'sets','')::int,1);
  v_sets:=case when v_count>=4 then least(v_sets,2) else least(v_sets,3) end;
  v_pres:=v_pres||jsonb_build_object(
   'sets',greatest(1,v_sets),
   'target_duration_minutes',v_alloc,
   'allocated_duration_seconds',greatest(60,floor((v_minutes*60)::numeric/v_count)::int),
   'curriculum_version','skill-curriculum-v1',
   'curriculum_path_key',v_path,
   'curriculum_target_exercise_id',v_target_id,
   'curriculum_role',v_role,
   'curriculum_lesson_order',v_ord,
   'curriculum_lesson_count',v_count,
   'curriculum_stage',v_s.pedagogical_stage,
   'curriculum_learning_objective',v_sj->>'learning_objective',
   'curriculum_coach_focus',v_sj->>'coach_focus',
   'curriculum_success_signal',v_sj->>'success_signal',
   'curriculum_next_step_hint',v_sj->>'next_step_hint',
   'curriculum_skill_only',true,
   'quality_priority','technique_before_fatigue'
  );

  v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
   'exercise_id',v_e.id,
   'name',v_e.name,
   'family',v_e.exercise_family,
   'pattern',v_e.movement_pattern,
   'region',v_e.body_region,
   'instructions',v_e.instructions,
   'tips',concat_ws(E'\n\n',nullif(v_sj->>'coach_focus',''),nullif(v_e.tips,'')),
   'image_path',v_e.image_path,
   'tracking_modes',coalesce(to_jsonb(v_e.tracking_modes),'[]'::jsonb),
   'prescription',v_pres,
   'expected_outcome',jsonb_build_object(
    'block_key','skill','goal','skill_curriculum_learning','pain_gate',true,'equipment_gate',true,
    'skill_path_key',v_path,'skill_path_step',v_s.step_order,
    'curriculum_version','skill-curriculum-v1','curriculum_target_exercise_id',v_target_id,
    'curriculum_role',v_role,'curriculum_stage',v_s.pedagogical_stage,
    'learning_objective',v_sj->>'learning_objective','coach_focus',v_sj->>'coach_focus',
    'success_signal',v_sj->>'success_signal','next_step_hint',v_sj->>'next_step_hint',
    'capability_promoted',false
   ),
   'curriculum',jsonb_build_object(
    'role',v_role,'stage',v_s.pedagogical_stage,
    'learning_objective',v_sj->>'learning_objective','coach_focus',v_sj->>'coach_focus',
    'success_signal',v_sj->>'success_signal','next_step_hint',v_sj->>'next_step_hint',
    'lesson_order',v_ord,'lesson_count',v_count
   )
  ));
 end loop;

 select coalesce(jsonb_agg(
  case when b->>'block_key'='skill' then
   b||jsonb_build_object(
    'block_name','Skill · Coach',
    'exercises',v_exercises,
    'structure',format('Parcours coach · %s étapes · %s min',v_count,v_minutes),
    'objective',v_target_json->>'learning_objective',
    'skill_contract',v_original_contract||jsonb_build_object(
     'curriculum_version','skill-curriculum-v1','multi_drill',true,'lesson_count',v_count,
     'target_exercise_id',v_target_id,'pedagogical_stage',v_target_step.pedagogical_stage,
     'learning_objective',v_target_json->>'learning_objective','coach_focus',v_target_json->>'coach_focus',
     'success_signal',v_target_json->>'success_signal','next_step_hint',v_target_json->>'next_step_hint'
    ),
    'curriculum',jsonb_build_object(
     'version','skill-curriculum-v1','path_key',v_path,
     'terminal_goal',(select terminal_goal from public.skill_curriculum_paths_v1 where path_key=v_path),
     'target_exercise_id',v_target_id,'lesson_drill_ids',to_jsonb(v_safe),
     'wod_unchanged',true,'no_calibration_forced',true
    )
   )
  else b end
  order by ord
 ),'[]'::jsonb)
 into v_blocks
 from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality x(b,ord);

 r:=jsonb_set(r,'{blocks}',v_blocks,true);
 r:=jsonb_set(r,'{architecture,skill_curriculum}',jsonb_build_object(
  'version','skill-curriculum-v1','applied',true,'skill_only',true,'wod_unchanged',true,
  'path_key',v_path,'target_exercise_id',v_target_id,'lesson_drill_ids',to_jsonb(v_safe),
  'lesson_count',v_count,'no_calibration_forced',true,'performance_tracking_per_drill',true,
  'w3_causal_authority_preserved',true
 ),true);
 return r;
end;
$$;

create or replace function public.w4_skill_curriculum_snapshot_v1(
 p_user_id uuid,
 p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
 v_anchor date:=coalesce(p_anchor_date,current_date);
 v_active jsonb;
 v_path text;
 v_target text;
 v_step jsonb;
 v_lesson jsonb;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
 v_active:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);
 v_path:=v_active#>>'{path,path_key}';
 v_target:=coalesce(v_active#>>'{next_target,exercise_id}',v_active#>>'{current_target,exercise_id}');
 if v_path is null or v_target is null then
  return jsonb_build_object('version','w4-skill-curriculum-snapshot-v1','status','NO_ACTIVE_SKILL_CURRICULUM','anchor_date',v_anchor);
 end if;

 v_step:=public.skill_curriculum_step_v1(v_path,v_target);
 select coalesce(jsonb_agg(jsonb_build_object(
  'lesson_order',d.ord,
  'exercise_id',d.exercise_id,
  'exercise_name',e.name,
  'curriculum',public.skill_curriculum_step_v1(v_path,d.exercise_id),
  'coach_state',coalesce((
   select jsonb_build_object(
    'state',s.state,'recommendation',s.recommendation,'mastery_score',s.mastery_score,
    'valid_evidence_count',s.valid_evidence_count,'capability_confidence',s.capability_confidence
   )
   from public.user_exercise_coach_state s
   where s.user_id=p_user_id and s.exercise_id=d.exercise_id
  ),'{}'::jsonb),
  'w4_level',case
   when exists(select 1 from public.exercise_level_standards_v1 x where x.exercise_id=d.exercise_id)
     or exists(select 1 from public.exercise_level_adaptation_rules_v1 a where a.exercise_id=d.exercise_id and a.active)
   then public.w4_exercise_level_v1(p_user_id,d.exercise_id,v_anchor)
   else jsonb_build_object('status','NO_LEVEL_STANDARD')
  end
 ) order by d.ord),'[]'::jsonb)
 into v_lesson
 from unnest(public.skill_curriculum_lesson_ids_v1(v_path,v_target)) with ordinality d(exercise_id,ord)
 join public.exercises e on e.id=d.exercise_id;

 return jsonb_build_object(
  'version','w4-skill-curriculum-snapshot-v1','status','READY','anchor_date',v_anchor,
  'path_key',v_path,'path_name',v_active#>>'{path,path_name}',
  'terminal_goal',(select terminal_goal from public.skill_curriculum_paths_v1 where path_key=v_path),
  'target_exercise_id',v_target,'current_step',v_step,'lesson',v_lesson,
  'semantics',jsonb_build_object(
   'skill_teaches_wod_applies',true,'no_calibration_forced',true,
   'each_drill_keeps_its_own_performance_history',true,
   'w3_remains_causal_progression_authority',true,'wod_unchanged',true
  )
 );
end;
$$;

alter function public.c4_plan_full_session(
 uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text
) rename to c4_plan_full_session_pre_skill_curriculum_v1;

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
declare v_plan jsonb;
begin
 v_plan:=public.c4_plan_full_session_pre_skill_curriculum_v1(
  p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
  p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
 );
 if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
 v_plan:=public.c4_apply_skill_curriculum_v1(
  p_user_id,v_plan,p_zone_terms,p_inventory,p_max_complexity,p_progression_intent,p_readiness
 );
 if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;
 return public.c4_finalize_skill_path_preparation_metadata_v1(v_plan);
end;
$$;

alter function public.w4_progression_intelligence_v1(uuid,date)
rename to w4_progression_intelligence_pre_skill_curriculum_v1;

create or replace function public.w4_progression_intelligence_v1(
 p_user_id uuid,
 p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
 v_anchor date:=coalesce(p_anchor_date,current_date);
 v_base jsonb;
begin
 if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
 v_base:=public.w4_progression_intelligence_pre_skill_curriculum_v1(p_user_id,v_anchor);
 return v_base||jsonb_build_object(
  'version','w4-progression-intelligence-v1.2-skill-curriculum',
  'skill_curriculum',public.w4_skill_curriculum_snapshot_v1(p_user_id,v_anchor)
 );
end;
$$;

revoke all on function public.c4_apply_skill_curriculum_v1(uuid,jsonb,text[],jsonb,integer,text,text) from public,anon;
revoke all on function public.w4_skill_curriculum_snapshot_v1(uuid,date) from public,anon;
revoke all on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon;
revoke all on function public.w4_progression_intelligence_v1(uuid,date) from public,anon;

grant execute on function public.c4_apply_skill_curriculum_v1(uuid,jsonb,text[],jsonb,integer,text,text) to authenticated,service_role;
grant execute on function public.w4_skill_curriculum_snapshot_v1(uuid,date) to authenticated,service_role;
grant execute on function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;
grant execute on function public.w4_progression_intelligence_v1(uuid,date) to authenticated,service_role;
