begin;
do $qa$
declare u uuid; equipment text[]; names jsonb; proposal jsonb; cardio jsonb; selected jsonb; draft jsonb;
 item uuid; sid uuid; result jsonb; preview jsonb; b jsonb; env text; minutes int; chosen_minutes int; i int; keys text[];
 report jsonb:='[]'; pool jsonb; strength jsonb; strength_block jsonb; cardio_block jsonb; dose jsonb;
begin
 select array_agg(name),jsonb_agg(name) into equipment,names from public.equipment_catalog_v2;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000094244001',true);
 foreach env in array array['HOME','BOX','GYM'] loop
  foreach minutes in array array[20,30,45,60,75,90] loop
   proposal:=public.week_composer_architectures_v1(minutes,env);
   if env in ('HOME','BOX') and minutes=20 then
     if proposal->>'status'<>'DEFAULT_UNAVAILABLE' then raise exception 'SHORT_DEFAULT_SILENTLY_CHANGED'; end if;
   else
     b:=proposal#>'{options,0}';
     if env in ('HOME','BOX') and b->>'key'<>'skill' then raise exception 'SKILL_WOD_NOT_DEFAULT'; end if;
     if env='GYM' and b->>'key'<>'strength' then raise exception 'GYM_NOT_SERIES'; end if;
   end if;
   for b in select value from jsonb_array_elements(proposal->'options') loop
     if (select sum((x->>'minutes')::int) from jsonb_array_elements(b->'blocks') x)+(b->>'transitionReserveMinutes')::int<>minutes then raise exception 'ARCHITECTURE_BUDGET_DRIFT'; end if;
   end loop;
  end loop;
 end loop;
 for i in 1..2 loop
  u:=('00000000-0000-0000-0000-00009424400'||i)::uuid;
  perform set_config('request.jwt.claim.sub','',true);
  insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-guided-routing-'||i||'@example.invalid',now(),now());
  insert into public.profiles(id,weight,experience,subscription_tier) values(u,80,'advanced','PREMIUM') on conflict(id) do update set weight=80,experience='advanced',subscription_tier='PREMIUM';
  perform set_config('request.jwt.claim.sub',u::text,true);
  cardio:=public.week_composer_cardio_authority_v1(u,jsonb_build_object('propose',true,'environment_code','GYM','session_minutes',60,'block_minutes',8,'equipment_names',names));
  if cardio->>'status'<>'READY' then raise exception 'CARDIO_NOT_READY_%',cardio; end if;
  select jsonb_agg(jsonb_build_object('id',e->>'exercise_id','name',e->>'name') order by ord) into selected from jsonb_array_elements(cardio#>'{block,exercises}') with ordinality e(e,ord);
  cardio_block:=jsonb_build_object('type','CARDIO','label','Cardio','minutes',8,'exercises',selected);
  select jsonb_agg(jsonb_build_object('id',id,'name',name)) into pool from (select distinct on (movement_pattern) id,name from public.exercises where exercise_environment_eligible_v1(id,'GYM') and not coalesce(warmup_only,false) and movement_pattern is not null order by movement_pattern,id limit 8) e;
  for minutes in 8..35 loop
    strength:=public.week_composer_strength_autopick_v2(u,pool,60,minutes,'MAINTAIN',equipment,'Strength','Full Body','GYM');
    if strength->>'status'='READY' then chosen_minutes:=minutes; exit; end if;
  end loop;
  if strength->>'status'<>'READY' then raise exception 'GYM_STRENGTH_NOT_READY_%',strength; end if;
  strength_block:=jsonb_build_object('type','STRENGTH','label','Musculation','minutes',chosen_minutes,'exercises',strength->'selected_exercises');
  draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'skill_engine_version','C4_COMPOSER_SKILL_V1',
   'duration_minutes',60,'environment_code','GYM','progression_intent','MAINTAIN','intent',jsonb_build_object('focus','Strength','key','STRENGTH'),
   'architecture',jsonb_build_object('blocks',case when i=1 then jsonb_build_array(cardio_block,strength_block) else jsonb_build_array(strength_block,cardio_block) end));
  preview:=public.week_composer_prescription_preview_v1(u,draft,equipment);
  if preview->>'status'<>'PREVIEW' then raise exception 'GYM_PREVIEW_FAILED_%',preview; end if;
  insert into public.user_training_plan_items(user_id,sequence_index,recommended_date,status,planned_duration_minutes,planned_focus,planned_progression_intent,planning_context_json)
   values(u,0,current_date,'available',60,'Strength','MAINTAIN',jsonb_build_object('w11',jsonb_build_object('composer_draft',draft))) returning id into item;
  result:=public.week_compile_composer_day_j_v1(u,item,current_date,6,array['Aucune'],equipment,'GYM');
  if result->>'status'<>'READY' then raise exception 'GYM_COMPILE_FAILED_%',result; end if;
  sid:=(result->>'session_id')::uuid;
  select array_agg(e->>'block_key' order by ord) into keys from public.workout_sessions s cross join lateral jsonb_array_elements(s.generated_workout->'blocks') with ordinality e(e,ord) where s.id=sid;
  if keys is distinct from (case when i=1 then array['cardio','strength'] else array['strength','cardio'] end) then raise exception 'GYM_ORDER_LOST_%',keys; end if;
  for b in select value from jsonb_array_elements(preview->'blocks') where value->>'type'='CARDIO' loop
   for dose in select value from jsonb_array_elements(b->'exercises') loop
    if (select prescription_json from public.workout_session_exercises where session_id=sid and block_key='cardio' and exercise_id=dose->>'id') is distinct from dose->'prescription_json' then raise exception 'CARDIO_DOSE_DRIFT'; end if;
   end loop;
  end loop;
  if exists(select 1 from public.workout_session_exercises where session_id=sid and block_key='wod') then raise exception 'CARDIO_RENAMED_WOD'; end if;
  report:=report||jsonb_build_array(jsonb_build_object('case',i,'strength_minutes',chosen_minutes,'order',keys,'status','PASS'));
 end loop;
 perform set_config('ugerod.qa_guided_routing',report::text,true);
end $qa$;
select current_setting('ugerod.qa_guided_routing')::jsonb result;
rollback;
