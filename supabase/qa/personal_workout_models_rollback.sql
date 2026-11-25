BEGIN;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
('00000000-0000-0000-0000-000000949001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-model-949001@example.invalid',now(),now()),
('00000000-0000-0000-0000-000000949002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-model-949002@example.invalid',now(),now());
insert into profiles(id,weight,subscription_tier,experience) values('00000000-0000-0000-0000-000000949001',80,'PREMIUM','advanced'),('00000000-0000-0000-0000-000000949002',80,'PREMIUM','advanced') on conflict(id) do update set weight=80,subscription_tier='PREMIUM',experience='advanced';
insert into user_training_plan_items(id,user_id,sequence_index,recommended_date,status,planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json) values
('00000000-0000-0000-0000-000000949011','00000000-0000-0000-0000-000000949001',1,current_date,'available',60,'Strength','Upper','MAINTAIN','{"w11":{}}'),
('00000000-0000-0000-0000-000000949012','00000000-0000-0000-0000-000000949001',2,current_date+1,'available',60,'Strength','Upper','MAINTAIN','{"w11":{}}');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000949001';
set local role authenticated;
DO $qa$
DECLARE d jsonb; a jsonb; b jsonb; m uuid; u uuid:=auth.uid(); n int; p jsonb; first_run jsonb; second_run jsonb; second_draft jsonb;
BEGIN
 d:='{"version":"w11-composer-draft-v1","structure_stable":true,"wod_engine_version":"C4_COMPOSER_V2","duration_minutes":60,"environment_code":"HOME","target_region":"Upper","progression_intent":"MAINTAIN","intent":{"focus":"Strength"},"architecture":{"title":"Test modèles","blocks":[{"type":"STRENGTH","minutes":45,"exercises":[{"id":"EX009","name":"Push-ups","manual_dose":{"sets":7,"reps":12,"rest_seconds":90}},{"id":"EX020","name":"Pike Push-up"},{"id":"EX087","name":"Hollow Hold","manual_dose":{"sets":4,"duration_seconds":35}},{"id":"EX098","name":"Side Plank","manual_dose":{"sets":3,"duration_seconds":25}}]}]}}';
 p:=public.week_composer_prescription_preview_v1(u,d,'{}');
 IF p->>'status'<>'PREVIEW' THEN RAISE EXCEPTION 'Preview failed %',p;END IF;
 d:=d||jsonb_build_object('prescription_preview',p);
 a:=public.week_save_composer_with_model_v1(u,'00000000-0000-0000-0000-000000949011',d,null,false);
 SELECT draft INTO second_draft FROM personal_workout_models WHERE id=(a->>'model_id')::uuid;
 b:=public.week_save_composer_with_model_v1(u,'00000000-0000-0000-0000-000000949012',second_draft||jsonb_build_object('target_date',current_date+1),null,false);
 IF a->>'status'<>'SAVED' OR b->>'status'<>'SAVED' OR a->>'model_id' IS DISTINCT FROM b->>'model_id' THEN RAISE EXCEPTION 'Reuse / dedup failed';END IF;
 m:=(a->>'model_id')::uuid;
 IF (SELECT count(*) FROM personal_workout_models)<>1 THEN RAISE EXCEPTION 'Unexpected model count';END IF;
 IF (SELECT draft#>>'{architecture,blocks,0,exercises,0,manual_dose,sets}' FROM personal_workout_models WHERE id=m)<>'7' THEN RAISE EXCEPTION 'Dose not stored';END IF;
 UPDATE personal_workout_models SET name='Renamed' WHERE id=m;
 IF (SELECT name FROM personal_workout_models WHERE id=m)<>'Renamed' THEN RAISE EXCEPTION 'Rename failed';END IF;
 first_run:=public.week_compile_composer_day_j_v1(u,'00000000-0000-0000-0000-000000949011',current_date,6,array['Aucune'],'{}','HOME');
 second_run:=public.week_compile_composer_day_j_v1(u,'00000000-0000-0000-0000-000000949012',current_date+1,6,array['Aucune'],'{}','HOME');
 IF first_run->>'status'<>'READY' OR second_run->>'status'<>'READY' OR first_run->>'session_id' IS NOT DISTINCT FROM second_run->>'session_id' THEN RAISE EXCEPTION 'Independent compile failed % %',first_run->>'status',second_run->>'status';END IF;
 IF (SELECT count(*) FROM workout_session_exercises WHERE session_id IN ((first_run->>'session_id')::uuid,(second_run->>'session_id')::uuid) AND exercise_id='EX009' AND prescription_json->>'sets'='7' AND prescription_json->>'execution_target_reps'='12')<>2 THEN RAISE EXCEPTION 'Independent manual doses missing'; END IF;
 PERFORM set_config('ugerod.qa_model_id',m::text,true);
END $qa$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000949002';
DO $qa$ DECLARE n int; BEGIN
 IF EXISTS(SELECT 1 FROM personal_workout_models) THEN RAISE EXCEPTION 'Cross account read';END IF;
 UPDATE personal_workout_models SET name='Wrong' WHERE id=current_setting('ugerod.qa_model_id')::uuid; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Cross account update';END IF;
 DELETE FROM personal_workout_models WHERE id=current_setting('ugerod.qa_model_id')::uuid; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Cross account delete';END IF;
 BEGIN INSERT INTO personal_workout_models(user_id,name,origin,draft) VALUES('00000000-0000-0000-0000-000000949001','Wrong','COMPOSER','{}'); RAISE EXCEPTION 'Cross account insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $qa$;
select 'PASS: save, reuse stored model, two distinct compiled sessions, exact manual dose, rename, cross-account CRUD isolation' result;
rollback;