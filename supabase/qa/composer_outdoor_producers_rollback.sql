-- #29: real DEV producer -> preview -> saved plan -> Day-J Player snapshot.
-- Synthetic athletes only. All fixtures and sessions rolled back.
begin;
do $qa$
declare
 u uuid; i int; n int; ord int; mins int; t text; target text; equipment text[]; eq jsonb;
 ctx jsonb; proposal jsonb; draft jsonb; blocks jsonb; selected jsonb; preview jsonb; compiled jsonb;
 actual jsonb; planned jsonb; dose jsonb; results jsonb; completion jsonb; item uuid; sid uuid; again jsonb; old_draft jsonb;
 report jsonb:='[]'; has_cardio boolean; has_gym boolean; has_wod boolean; wanted text[]; got text[];
 failed boolean; context jsonb:='{"place_code":"PARK","surface_code":"ROAD","running_allowed":true,"reliable_distance":false}';
begin
 select array_agg(name),jsonb_agg(name) into equipment,eq from public.equipment_catalog_v2;
 for i in 1..8 loop
   u:=('00000000-0000-0000-0000-00009429010'||i)::uuid;
   perform set_config('request.jwt.claim.sub','',true);
   insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
   values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-outdoor-'||i||'@example.invalid',now(),now());
   insert into public.profiles(id,weight,experience,subscription_tier) values(u,80,'advanced','PREMIUM')
     on conflict(id) do update set weight=80,experience='advanced',subscription_tier='PREMIUM';
   perform set_config('request.jwt.claim.sub',u::text,true);
   has_cardio:=i in (1,4,5,7,8); has_gym:=i in (2,4,6,7,8); has_wod:=i in (3,5,6,7);
   n:=has_cardio::int+has_gym::int+has_wod::int;
   blocks:='[{"type":"WARMUP","minutes":6,"exercises":[{"id":"EX158"}]},{"type":"TABATA","minutes":4,"exercises":[{"id":"EX087"}]}]';
   wanted:=array['warm_up','tabata']; ord:=0;
   target:=case when i=8 then 'HANDSTAND_HSPU' else null end;
   -- Reverse order for selected compositions, not only the default arrangement.
   for t in select typ from unnest(case when i in (4,7) then array['WOD','SKILL','CARDIO'] else array['CARDIO','SKILL','WOD'] end) typ loop
     if t='CARDIO' and not has_cardio or t='SKILL' and not has_gym or t='WOD' and not has_wod then continue; end if;
     ord:=ord+1; mins:=45/n + case when ord=1 then 45%n else 0 end;
     ctx:=jsonb_build_object('outdoor_engine_version','COMPOSER_OUTDOOR_V1','outdoor_context',context,
       'environment_code','OUTDOOR','session_minutes',60,'block_minutes',mins,'equipment_names',eq,
       'readiness','normal','progression_intent','MAINTAIN','focus','Conditioning','propose',true,
       'automatic_selection',true,'exercises','[]'::jsonb,
       'preferences',jsonb_build_object('version','composer-preferences-v1','preferred_regions','[]'::jsonb,'skill_target_path_key',target));
     if t='CARDIO' then
       proposal:=public.week_composer_cardio_authority_v1(u,ctx);
       if proposal->>'status' is distinct from 'READY' or proposal#>>'{block,block_key}' is distinct from 'cardio' then raise exception 'CARDIO_%: %',i,proposal; end if;
       if (proposal#>>'{block,mechanic_json,parameters,duration_seconds}')::int is distinct from (proposal#>>'{block,running_protocol,predicted_elapsed_seconds}')::int then raise exception 'CARDIO_DURATION_%: %',i,proposal; end if;
       select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name')) into selected from jsonb_array_elements(proposal#>'{block,exercises}') e;
     elsif t='SKILL' then
       proposal:=public.week_composer_skill_authority_v1(u,ctx);
       if proposal->>'status' is distinct from 'READY' then raise exception 'GYM_%: %',i,proposal; end if;
       select jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name')) into selected from jsonb_array_elements(proposal->'exercises') e;
     else selected:='[{"id":"EX033"},{"id":"EX006"}]';
     end if;
     wanted:=array_append(wanted,case t when 'SKILL' then 'skill' when 'CARDIO' then 'cardio' else 'wod' end);
     blocks:=blocks||jsonb_build_array(jsonb_build_object('type',t,'minutes',mins,'exercises',selected));
   end loop;
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'outdoor_engine_version','COMPOSER_OUTDOOR_V1',
     'outdoor_context',context,'skill_engine_version','C4_COMPOSER_SKILL_V1','wod_engine_version','C4_COMPOSER_V2',
     'mechanic',jsonb_build_object('key','AMRAP'),'duration_minutes',60,'environment_code','OUTDOOR','progression_intent','MAINTAIN',
     'preferences',jsonb_build_object('version','composer-preferences-v1','preferred_regions','[]'::jsonb,'skill_target_path_key',target),
     'intent','{"key":"CONDITIONING","focus":"Conditioning"}'::jsonb,
     'architecture',jsonb_build_object('key','outdoor-qa','blocks',blocks));
   preview:=public.week_composer_prescription_preview_v1(u,draft,equipment);
   if preview->>'status' is distinct from 'PREVIEW' then raise exception 'PREVIEW_%: %',i,preview; end if;
   insert into public.user_training_plan_items(user_id,sequence_index,recommended_date,status,planned_duration_minutes,
     planned_focus,planned_progression_intent,planning_context_json)
   values(u,0,current_date,'available',60,'Conditioning','MAINTAIN','{"w11":{}}'::jsonb) returning id into item;
   proposal:=public.week_save_composer_revision_v1(u,item,draft,jsonb_build_object('duration_minutes',60,'environment_code','OUTDOOR',
     'surface_code','ROAD','outdoor_place_code','PARK','equipment',eq),false);
   if proposal->>'status'<>'SAVED' then raise exception 'SAVE_%: %',i,proposal; end if;
   old_draft:=draft;
   compiled:=public.week_compile_composer_outdoor_day_j_v1(u,item,current_date,6,array['Aucune'],equipment,'OUTDOOR',case when i=8 then context||'{"surface_code":"TRAIL"}'::jsonb else context end);
   if compiled->>'status' is distinct from 'READY' then raise exception 'COMPILE_%: %',i,compiled; end if;
   sid:=(compiled->>'session_id')::uuid;
   select array_agg(e.e->>'block_key' order by e.ord) into got from public.workout_sessions s,
     jsonb_array_elements(s.generated_workout->'blocks') with ordinality e(e,ord) where s.id=sid;
   if got is distinct from wanted then raise exception 'ORDER_%: % / %',i,got,wanted; end if;
   for planned in select value from jsonb_array_elements(preview->'blocks') where value->>'type' in ('SKILL','CARDIO') loop
     for dose in select value from jsonb_array_elements(planned->'exercises') loop
       select prescription_json into actual from public.workout_session_exercises where session_id=sid and exercise_id=dose->>'id'
         and block_key=lower(planned->>'type');
       if actual is distinct from dose->'prescription_json' then raise exception 'DOSE_DRIFT_%_%: % / %',i,planned->>'type',actual,dose; end if;
     end loop;
   end loop;
   again:=public.week_compile_composer_outdoor_day_j_v1(u,item,current_date,6,array['Aucune'],equipment,'OUTDOOR',context);
   if again->>'status'<>'ALREADY_READY' or again->>'session_id'<>sid::text then raise exception 'RECOMPILED_%',i; end if;
   if (select planning_context_json#>'{w11,composer_draft,architecture}' from public.user_training_plan_items where id=item)
     is distinct from old_draft->'architecture' or
      (select planning_context_json#>'{w11,composer_draft,outdoor_context}' from public.user_training_plan_items where id=item)
     is distinct from context then raise exception 'SAVED_DRAFT_CHANGED_%',i; end if;
   if i=8 and (select planned_surface_code from public.workout_sessions where id=sid)<>'TRAIL' then raise exception 'ACTUAL_TERRAIN_LOST'; end if;
   perform public.e_mark_session_started(sid,current_date);
   if has_wod then perform public.mark_wod_revealed(sid); perform public.mark_wod_started(sid); end if;
   -- Simulate a complete course plus one performed Gym set, other blocks skipped.
   -- This verifies the existing completion/history API without real athlete data.
   select jsonb_agg(jsonb_build_object('session_exercise_id',id,'exercise_id',exercise_id,
     'status',case when block_key in ('cardio','skill') then 'completed' else 'skipped' end,
     'user_execution_status',case when block_key='cardio' then 'completed' when block_key='skill' then 'adapted' else 'not_completed' end,
     'duration_seconds',case when block_key='cardio' then (prescription_json->>'duration_seconds')::int else null end,
     'reps_completed',case when block_key='skill' then 1 else null end,
     'performance_actual_json',case when block_key='cardio' then jsonb_build_object('source','ugerod_environment_player','controlled_timing',true,
       'elapsed_seconds',prescription_json->'duration_seconds','planned_duration_seconds',prescription_json->'duration_seconds',
       'running_mechanic',prescription_json->'mechanic','running_family_code',prescription_json->'running_family_code','protocol_completed',true)
       when block_key='skill' then '{"source":"composer_skill_player_v1","protocol_completed":false,"skill_sets":[{"set_index":1,"reps":1,"status":"completed","load_kg":null}]}'::jsonb
       else '{}'::jsonb end)) into results from public.workout_session_exercises where session_id=sid;
   completion:=public.complete_workout_session_v2(sid,6,3,'QA synthétique, rollback',results,null);
   if (select status from public.workout_sessions where id=sid)<>'completed' then raise exception 'COMPLETION_%',i; end if;
   if has_cardio and not exists(select 1 from public.exercise_logs l join public.workout_session_exercises e on e.id=l.session_exercise_id
     where l.session_id=sid and e.block_key='cardio' and l.actual_json->>'protocol_completed'='true') then raise exception 'COURSE_HISTORY_LOST_%',i; end if;
   if has_gym and not exists(select 1 from public.exercise_logs l join public.workout_session_exercises e on e.id=l.session_exercise_id
     where l.session_id=sid and e.block_key='skill' and jsonb_array_length(l.actual_json->'skill_sets')=1) then raise exception 'GYM_HISTORY_LOST_%',i; end if;
   report:=report||jsonb_build_array(jsonb_build_object('case',i,'blocks',got,'dose_parity',true,'idempotent',true,'completion_history',true,'target',target));
 end loop;
 -- Gates are explicit, never silently substituting a machine/WOD for course.
 ctx:=ctx||jsonb_build_object('exercises','[{"id":"EX313"}]'::jsonb,'block_minutes',17);
 proposal:=public.week_composer_cardio_authority_v1(u,ctx);
 if proposal->>'status'<>'READY' or (proposal#>>'{block,reserved_duration_minutes}')::int<>17 or (proposal#>>'{block,mechanic_json,parameters,duration_seconds}')::int>1020 then raise exception 'FREE_DURATION_%',proposal; end if;
 proposal:=public.week_composer_cardio_authority_v1(u,ctx||jsonb_build_object('outdoor_context',context||'{"running_allowed":false}'::jsonb));
 if proposal->>'reason'<>'OUTDOOR_RUNNING_UNAVAILABLE' then raise exception 'NO_RUNNING_BYPASS'; end if;
 proposal:=public.week_composer_cardio_authority_v1(u,ctx||jsonb_build_object('outdoor_context','{}'::jsonb));
 if proposal->>'reason'<>'OUTDOOR_SURFACE_REQUIRED' then raise exception 'NO_TERRAIN_BYPASS'; end if;
 proposal:=public.week_composer_cardio_authority_v1(u,ctx-'outdoor_engine_version');
 if proposal->>'reason'<>'OUTDOOR_CONTEXT_REQUIRED' then raise exception 'OLD_DRAFT_MIGRATED'; end if;
 failed:=false; begin perform public.week_composer_cardio_authority_v1(gen_random_uuid(),ctx); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'FOREIGN_ATHLETE_ALLOWED'; end if;
 proposal:=public.week_composer_architectures_v1(60,'OUTDOOR');
 if proposal#>>'{options,0,blocks,2,type}'<>'CARDIO' or jsonb_array_length(proposal->'options')<>1 then raise exception 'DEFAULT_NOT_OUTDOOR_%',proposal; end if;
 proposal:=public.week_composer_outdoor_architectures_v1(60,context||'{"running_allowed":false}'::jsonb,null);
 if proposal#>>'{options,0,blocks,2,type}'<>'WOD' then raise exception 'NO_RUNNING_LAYOUT_%',proposal; end if;
 proposal:=public.week_composer_outdoor_architectures_v1(60,context,'HANDSTAND_HSPU');
 if proposal#>>'{options,0,blocks,2,type}'<>'SKILL' then raise exception 'TARGET_LAYOUT_%',proposal; end if;
 -- Existing machine Cardio remains a separate producer in Salle.
 proposal:=public.week_composer_cardio_authority_v1(u,jsonb_build_object('environment_code','GYM','session_minutes',60,
   'block_minutes',12,'equipment_names',eq,'propose',true,'readiness','normal'));
 if proposal->>'status' is distinct from 'READY' or proposal->>'source'<>'gym-cardio-protocol-v2'
   or proposal#>>'{block,block_key}' is distinct from 'cardio' then raise exception 'GYM_CARDIO_REGRESSION_%',proposal; end if;
 perform set_config('ugerod.qa_outdoor',report::text,true);
end $qa$;
select current_setting('ugerod.qa_outdoor')::jsonb result;
rollback;
