-- Shared Skill proposal -> preview -> saved draft -> persisted Player contract.
-- No real athlete; all sessions, evidence and fixtures rolled back.
begin;
do $qa$
declare
 athlete uuid; equipment text[]; equipment_json jsonb; target text; env text;
 ctx jsonb; prefs jsonb; proposal jsonb; draft jsonb; blocks jsonb; selected jsonb;
 preview jsonb; compiled jsonb; again jsonb; actual jsonb; planned jsonb; dose jsonb;
 saved_progress jsonb; progress_state jsonb; progress_result jsonb; original_contract jsonb; original_pres jsonb; protected_id uuid; completion jsonb; completed_payload jsonb; item uuid; sid uuid; i int; report jsonb:='[]'; failed boolean;
begin
 select array_agg(name),jsonb_agg(name) into equipment,equipment_json from public.equipment_catalog_v2;
 for i in 1..8 loop
   athlete:=('00000000-0000-0000-0000-00009424310'||i)::uuid;
   perform set_config('request.jwt.claim.sub','',true);
   insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
   values(athlete,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-composer-skill-'||i||'@example.invalid',now(),now());
   insert into public.profiles(id,weight,experience,subscription_tier) values(athlete,80,'advanced','PREMIUM')
     on conflict(id) do update set weight=80,experience='advanced',subscription_tier='PREMIUM';
   perform set_config('request.jwt.claim.sub',athlete::text,true);
   env:=case when i<=4 then 'HOME' else 'BOX' end;
   target:=case (i-1)%4 when 1 then 'HANDSTAND_HSPU' when 2 then 'PULL_UP_MUSCLE_UP' when 3 then 'BAR_MUSCLE_UP' else null end;
   prefs:=jsonb_build_object('version','composer-preferences-v1','preferred_regions',
     case when target is null then '["Upper","Core"]'::jsonb else '[]'::jsonb end,'skill_target_path_key',target);
   ctx:=jsonb_build_object('preferences',prefs,'session_minutes',45,'block_minutes',12,'environment_code',env,
     'focus','Strength','equipment_names',equipment_json,'readiness','normal','propose',true,
     'exercises',jsonb_build_array(jsonb_build_object('id','EX087')));
   proposal:=public.week_composer_skill_authority_v1(athlete,ctx);
   if proposal->>'status' is distinct from 'READY' then raise exception 'PROPOSAL_%: %',i,proposal; end if;
   select jsonb_agg(jsonb_build_object('id',e->'id','name',e->'name') order by ord) into selected
     from jsonb_array_elements(proposal->'exercises') with ordinality e(e,ord);
   blocks:=jsonb_build_array(
     jsonb_build_object('type','WARMUP','minutes',5,'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
     jsonb_build_object('type','TABATA','minutes',4,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
     jsonb_build_object('type','SKILL','minutes',12,'exercises',selected));
   if i=8 then blocks:=blocks||jsonb_build_array(jsonb_build_object('type','WOD','minutes',8,
     'exercises',jsonb_build_array(jsonb_build_object('id','EX033'),jsonb_build_object('id','EX006')))); end if;
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'skill_engine_version','C4_COMPOSER_SKILL_V1',
     'wod_engine_version','C4_COMPOSER_V2','mechanic',jsonb_build_object('key','AMRAP'),
     'duration_minutes',45,'environment_code',env,'progression_intent','MAINTAIN','preferences',prefs,
     'intent',jsonb_build_object('key',case when target is null then 'STRENGTH' else 'TECHNIQUE' end,'focus','Strength'),
     'architecture',jsonb_build_object('key','shared-skill-qa','blocks',blocks));
   preview:=public.week_composer_prescription_preview_v1(athlete,draft,equipment);
   if preview->>'status' is distinct from 'PREVIEW' then raise exception 'PREVIEW_%: %',i,preview; end if;
   insert into public.user_training_plan_items(user_id,sequence_index,recommended_date,status,planned_duration_minutes,
     planned_focus,planned_progression_intent,planning_context_json)
   values(athlete,0,current_date,'available',45,'Strength','MAINTAIN','{"w11":{}}'::jsonb) returning id into item;
   perform public.week_save_composer_draft_v1(athlete,item,draft);
   compiled:=public.week_compile_composer_day_j_v1(athlete,item,current_date,6,array['Aucune'],equipment,env);
   if compiled->>'status' is distinct from 'READY' then raise exception 'COMPILE_%: %',i,compiled; end if;
   sid:=(compiled->>'session_id')::uuid;
   select value into actual from public.workout_sessions s,jsonb_array_elements(s.generated_workout->'blocks') value
     where s.id=sid and value->>'block_key'='skill';
   if actual->'skill_path' is distinct from proposal->'skill_path' or actual->'curriculum' is distinct from proposal->'curriculum' then
     raise exception 'CURRICULUM_LOST_%',i;
   end if;
   if i=8 and exists(select 1 from public.workout_session_exercises where session_id=sid and block_key='wod'
     and prescription_json ? 'composer_skill_version') then raise exception 'SKILL_DOSE_LEAKED_TO_WOD'; end if;
   for planned in select value from jsonb_array_elements(preview#>'{blocks,2,exercises}') loop
     select prescription_json into dose from public.workout_session_exercises where session_id=sid and block_key='skill' and exercise_id=planned->>'id';
     if dose is distinct from planned->'prescription_json' then raise exception 'DOSE_DRIFT_%: % / %',i,dose,planned; end if;
     if (dose->>'sets')::int<1 or dose->>'duration_fit_status'<>'FIT'
       or coalesce((dose->>'test_score_required')::boolean,false) then raise exception 'INVALID_PRACTICE_%',i; end if;
   end loop;
   again:=public.week_compile_composer_day_j_v1(athlete,item,current_date,6,array['Aucune'],equipment,env);
   if again->>'status'<>'ALREADY_READY' or again->>'session_id'<>sid::text then raise exception 'RECOMPILED_%',i; end if;
   update public.workout_sessions set status='in_progress',started_at=now(),started_local_date=current_date where id=sid;
   progress_state:=public.composer_player_progress_read_v1(sid);
   select generated_workout into original_contract from public.workout_sessions where id=sid;
   select jsonb_agg(jsonb_build_object('id',id,'prescription',prescription_json) order by id) into original_pres from public.workout_session_exercises where session_id=sid;
   select jsonb_build_object('version','composer-player-progress-v1','sessionId',sid,'clientUpdatedAt',1000,
     'skillRuntime',jsonb_build_object('index',1,'results','{}'::jsonb),
     'exercises',jsonb_agg(jsonb_build_object('sessionExerciseId',id,'status','pending','userExecutionStatus','pending',
       'repsCompleted',null,'durationSeconds',null,'distanceMeters',null,'rpe',null,'performanceActualJson',null)))
     into saved_progress from public.workout_session_exercises where session_id=sid;
   select id into protected_id from public.workout_session_exercises where session_id=sid and block_key='skill' limit 1;
   saved_progress:=jsonb_set(saved_progress,'{skillRuntime,results}',jsonb_build_object(protected_id::text||':1:both',jsonb_build_object('duration_seconds',1,'load_kg',null)));
   progress_result:=public.composer_player_progress_save_v1(sid,progress_state->>'contract_key',0,saved_progress);
   if progress_result->>'status'<>'SAVED' then raise exception 'SAVE_FAILED_%',progress_result; end if;
   if public.composer_player_progress_read_v1(sid)->'progress' is distinct from saved_progress then raise exception 'PROGRESS_NOT_RESTORED'; end if;
   if public.composer_player_progress_save_v1(sid,progress_state->>'contract_key',0,saved_progress)->>'status'<>'REVISION_CONFLICT' then raise exception 'CONFLICT_NOT_DETECTED'; end if;
   if public.composer_player_progress_save_v1(sid,'stale',1,saved_progress)->>'status'<>'CONTRACT_CHANGED' then raise exception 'CONTRACT_NOT_PROTECTED'; end if;
   if (select generated_workout from public.workout_sessions where id=sid) is distinct from original_contract or
     (select jsonb_agg(jsonb_build_object('id',id,'prescription',prescription_json) order by id) from public.workout_session_exercises where session_id=sid) is distinct from original_pres then raise exception 'PRESCRIPTION_MUTATED'; end if;
   -- Explicit change of an UNPERFORMED Tabata label; retain confirmed Skill set and identity.
   update public.workout_sessions set generated_workout=jsonb_set(generated_workout,'{blocks,1,block_name}','"Tabata ajusté"') where id=sid;
   progress_state:=public.composer_player_progress_read_v1(sid);
   if progress_state->>'status'<>'CONTRACT_CHANGED' then raise exception 'CHANGE_NOT_VISIBLE'; end if;
   if public.composer_player_progress_rebase_v1(sid,progress_state->>'contract_key')->>'status'<>'REBASED' then raise exception 'SAFE_REBASE_REFUSED'; end if;
   progress_state:=public.composer_player_progress_read_v1(sid);
   if progress_state#>'{progress,skillRuntime,results}' is distinct from saved_progress#>'{skillRuntime,results}' then raise exception 'REALIZED_SET_LOST'; end if;
   -- Attempt to change the realized Skill prescription is explicitly refused.
   update public.workout_session_exercises set prescription_json=prescription_json||'{"sets":99}' where id=protected_id;
   update public.workout_sessions set generated_workout=jsonb_set(generated_workout,'{blocks,2,block_name}','"Skill changé"') where id=sid;
   progress_state:=public.composer_player_progress_read_v1(sid);
   if public.composer_player_progress_rebase_v1(sid,progress_state->>'contract_key')->>'status'<>'INCOMPATIBLE_REALIZED_WORK' then raise exception 'REALIZED_WORK_CHANGED'; end if;
   update public.workout_session_exercises w set prescription_json=x->'prescription' from jsonb_array_elements(original_pres) x where w.id::text=x->>'id';
   update public.workout_sessions set generated_workout=original_contract where id=sid;
   progress_state:=public.composer_player_progress_read_v1(sid);
   perform public.composer_player_progress_rebase_v1(sid,progress_state->>'contract_key');
   if i=1 then
     select jsonb_agg(jsonb_build_object('session_exercise_id',id,'exercise_id',exercise_id,
       'status',case when id=protected_id then 'completed' else 'skipped' end,
       'user_execution_status',case when id=protected_id then 'adapted' else 'not_completed' end,
       'duration_seconds',case when id=protected_id then 1 else null end,
       'performance_actual_json',case when id=protected_id then jsonb_build_object('source','composer_skill_player_v1',
         'protocol_completed',false,'skill_sets',jsonb_build_array(jsonb_build_object('set_index',1,'duration_seconds',1,'status','completed','load_kg',null))) else '{}'::jsonb end))
       into completed_payload from public.workout_session_exercises where session_id=sid;
     completion:=public.complete_workout_session_v2(sid,6,3,'QA synthétique, annulée',completed_payload,null);
     if (select status from public.workout_sessions where id=sid)<>'completed' then raise exception 'COMPLETION_NOT_PERSISTED'; end if;
     if not exists(select 1 from public.exercise_logs where session_id=sid and session_exercise_id=protected_id
       and actual_json->>'protocol_completed'='false' and jsonb_array_length(actual_json->'skill_sets')=1) then raise exception 'PARTIAL_HISTORY_LOST'; end if;
     if public.composer_player_progress_read_v1(sid)->>'closed'<>'true' then raise exception 'CLOSED_PROGRESS_STILL_WRITABLE'; end if;
   end if;
   failed:=false;
   begin perform public.composer_player_progress_read_v1(gen_random_uuid()); exception when insufficient_privilege then failed:=true; end;
   if not failed then raise exception 'FOREIGN_SESSION_ALLOWED'; end if;
   report:=report||jsonb_build_array(jsonb_build_object('case',i,'environment',env,'target',target,'status','PASS',
     'exercises',selected,'dose_parity',true,'idempotent',true));
 end loop;
 ctx:=ctx||jsonb_build_object('preferences',prefs||'{"skill_target_path_key":null}'::jsonb,
   'exercises','[{"id":"EX087"},{"id":"EX450"},{"id":"EX411"}]'::jsonb);
 proposal:=public.week_composer_skill_authority_v1(athlete,ctx);
 if proposal->>'status'<>'READY' or jsonb_array_length(proposal->'exercises')<>3 then raise exception 'THREE_SKILL_EXERCISES_%',proposal; end if;
 -- Failure contracts, strict bounds and authorization. Never silently remove a drill.
 ctx:=ctx||jsonb_build_object('exercises','[{"id":"EX087"},{"id":"EX450"},{"id":"EX411"},{"id":"EX033"}]'::jsonb);
 if public.week_composer_skill_authority_v1(athlete,ctx)->>'reason'<>'SKILL_MAX_THREE_EXERCISES' then raise exception 'MAX_THREE_NOT_ENFORCED'; end if;
 ctx:=ctx||jsonb_build_object('exercises',selected,'preferences',prefs||'{"skill_target_path_key":"NON_EXISTENT"}'::jsonb);
 if public.week_composer_skill_authority_v1(athlete,ctx)->>'reason'<>'SKILL_TARGET_UNAVAILABLE' then raise exception 'TARGET_NOT_PRESERVED'; end if;
 failed:=false;
 begin perform public.week_composer_skill_authority_v1(gen_random_uuid(),ctx); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'FOREIGN_ATHLETE_ALLOWED'; end if;
 if public.week_composer_preferences_v1('{"target_region":"Back","preferences":{"version":"composer-preferences-v1","preferred_regions":[]}}')->'preferred_regions'<>'[]'::jsonb then
   raise exception 'OLD_REGION_REVIVED'; end if;
 perform set_config('ugerod.qa_player_progress',report::text,true);
end $qa$;
select current_setting('ugerod.qa_player_progress')::jsonb result;
rollback;
