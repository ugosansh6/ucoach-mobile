do $$ begin if md5(pg_get_functiondef('public.week_composer_skill_authority_v1(uuid,jsonb)'::regprocedure))<>'b35ad1a6942370db160a17664db46f3b' then raise exception 'Concurrent Skill change'; end if; end $$;
create or replace function public.week_composer_skill_authority_v1(p_user_id uuid,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 prefs jsonb:=public.week_composer_preferences_v1(p_context);
 target text:=prefs->>'skill_target_path_key';
 minutes int:=(p_context->>'block_minutes')::int;
 duration int:=(p_context->>'session_minutes')::int;
 env text:=upper(coalesce(p_context->>'environment_code','HOME'));
 readiness text:=public.normalize_session_readiness(coalesce(p_context->>'readiness','normal'));
 intent text:=coalesce(p_context->>'progression_intent','MAINTAIN');
 chosen jsonb:=coalesce(p_context->'exercises','[]'::jsonb);
 propose boolean:=coalesce((p_context->>'propose')::boolean,false);
 equipment text[]; pain text[]; inventory jsonb; complexity int; region text;
 plan jsonb; b jsonb; ex jsonb; sol jsonb; contract jsonb; pres jsonb;
 output jsonb:='[]'::jsonb; ids text[]:='{}'; target_ids text[]; chosen_ids text[];
 elapsed numeric:=0; x record; alloc int; stimulus jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'FORBIDDEN_COMPOSER_SKILL' using errcode='42501'; end if;
 if minutes is null or minutes not between 2 and 90 or duration is null or duration not between 20 and 90
   or minutes>duration or env not in ('HOME','BOX','GYM','OUTDOOR') or jsonb_typeof(chosen)<>'array' then
   raise exception 'INVALID_COMPOSER_SKILL_CONTEXT';
 end if;
 if jsonb_array_length(chosen)>3 then
   return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_MAX_THREE_EXERCISES','block_type','SKILL');
 end if;
 select coalesce(array_agg(value),'{}') into equipment from jsonb_array_elements_text(coalesce(p_context->'equipment_names','[]'));
 select coalesce(array_agg(value),'{}') into pain from jsonb_array_elements_text(coalesce(p_context->'pain_zones','[]'));
 inventory:=public.resolve_user_equipment_inventory(p_user_id,equipment,'c4-final-default');
 complexity:=public.c4_user_max_swap_complexity(p_user_id,readiness);
 region:=case when jsonb_array_length(prefs->'preferred_regions')=1 then prefs#>>'{preferred_regions,0}' else null end;
 stimulus:=public.build_session_stimulus_target(coalesce(p_context->>'focus','General Fitness'),duration,readiness,region,intent,'c1-default');
 if target is not null then
   if not exists(select 1 from public.skill_paths where path_key=target and active) then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TARGET_UNAVAILABLE','block_type','SKILL');
   end if;
   -- The existing path engine owns entry step, trajectory and progression.
   -- The explicit request narrows its catalogue, not the athlete's mastery.
   plan:=jsonb_build_object('status','READY','stimulus',stimulus,
     'architecture',jsonb_build_object('requested_skill_path_key',target,'preferred_regions',prefs->'preferred_regions',
       'skill_practice_only',true,'skill_reason','composer_learning'),
     'blocks',jsonb_build_array(jsonb_build_object('block_key','skill','duration_minutes',minutes,'exercises','[]'::jsonb),
       jsonb_build_object('block_key','wod','exercises',coalesce(p_context->'wod_exercises','[]'::jsonb))));
   plan:=public.c4_apply_skill_path_v2(p_user_id,plan,pain,inventory,region,complexity,intent,readiness);
   if plan#>>'{architecture,skill_path,path_key}' is distinct from target then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TARGET_NOT_FEASIBLE','block_type','SKILL',
       'details',plan#>'{architecture,skill_path}');
   end if;
   plan:=public.c4_apply_skill_curriculum_v3(p_user_id,plan,pain,inventory,complexity,intent,readiness);
   select value into b from jsonb_array_elements(plan->'blocks') where value->>'block_key'='skill';
   if b is null or jsonb_array_length(b->'exercises') not between 1 and 3 then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_LESSON_EXCEEDS_THREE','block_type','SKILL',
       'required_exercises',b->'exercises'); -- Never truncate a required lesson.
   end if;
   select array_agg(value->>'exercise_id' order by ord) into target_ids
     from jsonb_array_elements(b->'exercises') with ordinality e(value,ord);
   select array_agg(value->>'id' order by ord) into chosen_ids
     from jsonb_array_elements(chosen) with ordinality e(value,ord);
   if not propose and chosen_ids is distinct from target_ids then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_LESSON_CHANGED','block_type','SKILL',
       'required_exercises',b->'exercises');
   end if;
   chosen:=b->'exercises';
 else
   if jsonb_array_length(chosen)<1 then raise exception 'SKILL_EXERCISES_REQUIRED'; end if;
   b:=jsonb_build_object('block_key','skill','block_name','Skill','duration_minutes',minutes);
 end if;
 alloc:=floor(minutes*60.0/greatest(1,jsonb_array_length(chosen)))::int;
 for ex in select value from jsonb_array_elements(chosen) loop
   select e.* into x from public.exercises e where id=coalesce(ex->>'exercise_id',ex->>'id');
   if x.id is null or x.id=any(ids) then raise exception 'INVALID_SKILL_EXERCISE'; end if;
   ids:=array_append(ids,x.id);
   if not public.exercise_environment_eligible_v1(x.id,env)
     or not public.exercise_equipment_compatible(x.id,inventory)
     or not public.exercise_safe_for_zones(x.id,public.normalize_body_zone_ids(pain))
     or coalesce(x.technical_complexity,99)>complexity then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_CONTEXT_INCOMPATIBLE','block_type','SKILL','exercise_id',x.id);
   end if;
   if target is not null then
     pres:=ex->'prescription';
   else
     sol:=public.c2_solver_prescription(p_user_id,x.id,stimulus,'SKILL',intent,inventory)
       ||jsonb_build_object('practice_only',true);
     contract:=public.c4_skill_contract_v1(p_user_id,x.id,'composer_mastery',greatest(1,ceil(alloc/60.0)::int),intent,readiness,sol);
     pres:=sol||coalesce(contract->'prescription_patch','{}'::jsonb);
   end if;
   pres:=public.skill_curriculum_duration_fit_v1(x.id,pres->>'curriculum_role',pres,alloc,jsonb_array_length(chosen));
   -- Publish aliases consumed by the existing runtime; numeric dose is untouched.
   pres:=pres||jsonb_strip_nulls(jsonb_build_object('source','COMPOSER_SHARED_SKILL_V1',
     'rest_seconds',coalesce(pres->'rest_between_sets_seconds',pres->'rest_seconds'),
     'reps_min',coalesce(pres->'execution_target_reps',pres->'reps_min'),
     'duration_seconds',coalesce(pres->'execution_target_duration_seconds',pres->'duration_seconds'),
     'distance_meters',coalesce(pres->'execution_target_distance_meters',pres->'distance_meters'),
     'composer_skill_version','C4_COMPOSER_SKILL_V1'));
   if pres->>'duration_fit_status' is distinct from 'FIT' then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TIME_MISMATCH','block_type','SKILL','exercise_id',x.id,'prescription',pres);
   end if;
   if coalesce((pres->>'test_score_required')::boolean,false) then
     return jsonb_build_object('status','NEEDS_RECOMPOSITION','reason','SKILL_TEST_CONFIRMATION_REQUIRED','block_type','SKILL');
   end if;
   elapsed:=elapsed+coalesce((pres->>'predicted_elapsed_seconds')::numeric,0);
   output:=output||jsonb_build_array(coalesce(ex,'{}'::jsonb)||jsonb_build_object('id',x.id,'exercise_id',x.id,
     'name',coalesce(x.display_name,x.name),'prescription',pres));
 end loop;
 return jsonb_build_object('status','READY','source','C2+SKILL_PATH+CURRICULUM+DURATION_FIT',
   'version','C4_COMPOSER_SKILL_V1','block_type','SKILL','minutes',minutes,'exercises',output,
   'skill_contract',b->'skill_contract','curriculum',b->'curriculum','skill_path',b->'skill_path',
   'time',jsonb_build_object('budget_seconds',minutes*60,'prescribed_seconds',elapsed,'duration_is_maximum_not_fill_target',true));
end $$;

