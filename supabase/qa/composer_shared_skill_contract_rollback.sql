-- Shared Skill proposal -> preview -> saved draft -> persisted Player contract.
-- No real athlete; all sessions, evidence and fixtures rolled back.
begin;
do $qa$
declare
 athlete uuid; equipment text[]; equipment_json jsonb; target text; env text;
 ctx jsonb; prefs jsonb; proposal jsonb; draft jsonb; blocks jsonb; selected jsonb;
 preview jsonb; compiled jsonb; again jsonb; actual jsonb; planned jsonb; dose jsonb;
 item uuid; sid uuid; i int; report jsonb:='[]'; failed boolean;
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
 perform set_config('ugerod.qa_skill_contract',report::text,true);
end $qa$;
select current_setting('ugerod.qa_skill_contract')::jsonb result;
rollback;
