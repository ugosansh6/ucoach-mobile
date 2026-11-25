-- All fixtures are rolled back, including user and generated sessions.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000938041','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-manual-938041@example.invalid',now(),now());
INSERT INTO profiles(id,weight,subscription_tier,experience) VALUES('00000000-0000-0000-0000-000000938041',80,'PREMIUM','advanced') ON CONFLICT(id) DO UPDATE SET weight=80,subscription_tier='PREMIUM',experience='advanced';SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000938041';
DO $qa$ DECLARE u uuid:=auth.uid(); d jsonb; prev jsonb; c jsonb; item uuid; sid uuid; b jsonb; res jsonb:='[]'; typ text; ex jsonb; m text; BEGIN
 FOR typ,m,ex IN SELECT * FROM (VALUES ('WOD','CIRCUIT','[{"id":"EX033","manual_dose":{"reps":12}},{"id":"EX006"},{"id":"EX406"}]'::jsonb),('STRENGTH',null,'[{"id":"EX009","manual_dose":{"sets":7,"reps":12,"rest_seconds":90}},{"id":"EX020"},{"id":"EX087","manual_dose":{"sets":4,"duration_seconds":35}},{"id":"EX098","manual_dose":{"sets":3,"duration_seconds":25}}]'::jsonb)) s(t,m,e) LOOP
 d:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'wod_engine_version','C4_COMPOSER_V2','duration_minutes',60,'environment_code','HOME','target_region','Upper','progression_intent','MAINTAIN','intent',jsonb_build_object('focus','Strength'),'mechanic',jsonb_build_object('key',m),'architecture',jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type',typ,'minutes',CASE WHEN typ='STRENGTH' THEN 45 ELSE 28 END,'exercises',ex)||CASE WHEN typ='WOD' THEN '{"manual_parameters":{"rounds":20}}'::jsonb ELSE '{}'::jsonb END)));
 prev:=public.week_composer_prescription_preview_v1(u,d,'{}');IF prev->>'status'<>'PREVIEW' THEN RAISE EXCEPTION 'Preview % % %',typ,prev->>'status',prev->>'reason';END IF;
 BEGIN
 INSERT INTO user_training_plan_items(user_id,sequence_index,recommended_date,status,planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json) VALUES(u,0,current_date,'available',60,'Strength','Upper','MAINTAIN','{"w11":{}}') RETURNING id INTO item;
 IF public.week_save_composer_revision_v1(u,item,d,null,false)->>'status'<>'SAVED' THEN RAISE EXCEPTION 'Save failed';END IF;
 c:=public.week_compile_composer_day_j_v1(u,item,current_date,6,array['Aucune'],'{}','HOME');IF c->>'status'<>'READY' THEN RAISE EXCEPTION 'Compile %',c;END IF;sid:=(c->>'session_id')::uuid;
 SELECT value INTO b FROM workout_sessions ws CROSS JOIN LATERAL jsonb_array_elements(ws.generated_workout->'blocks') WHERE ws.id=sid AND value->>'module_code'=typ;
 IF typ='WOD' THEN
 IF b#>>'{mechanic_json,parameters,rounds}'<>'20' OR b#>>'{exercises,0,prescription_json,execution_target_reps}'<>'12' THEN RAISE EXCEPTION 'WOD manual mismatch';END IF;
 IF prev#>>'{blocks,0,parameters,rounds}'<>'20' OR prev#>>'{blocks,0,exercises,0,reps}'<>'12' THEN RAISE EXCEPTION 'WOD preview mismatch';END IF;
 ELSE
 IF b#>>'{exercises,0,prescription_json,sets}'<>'7' OR b#>>'{exercises,0,prescription_json,execution_target_reps}'<>'12' OR b#>>'{exercises,2,prescription_json,duration_seconds}'<>'35' OR b#>>'{exercises,3,prescription_json,duration_semantics}'<>'per_side' THEN RAISE EXCEPTION 'Strength manual mismatch';END IF;
 IF prev#>>'{blocks,0,exercises,0,sets}'<>'7' OR prev#>>'{blocks,0,exercises,2,duration_seconds}'<>'35' THEN RAISE EXCEPTION 'Strength preview mismatch';END IF;
 END IF;
 res:=res||jsonb_build_array(jsonb_build_object('type',typ,'preview',prev#>'{blocks,0,time}','runtime',b#>'{mechanic_json,parameters}','exercises',(SELECT jsonb_agg(jsonb_build_object('id',x->>'exercise_id','sets',x#>'{prescription_json,sets}','reps',x#>'{prescription_json,execution_target_reps}','seconds',x#>'{prescription_json,duration_seconds}','side',x#>'{prescription_json,duration_semantics}')) FROM jsonb_array_elements(b->'exercises') x)));
 RAISE SQLSTATE 'Z0001' USING MESSAGE='Rollback fixture';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;END;
 END LOOP;
 PERFORM set_config('ugerod.qa_manual',res::text,true);
END $qa$;SELECT current_setting('ugerod.qa_manual')::jsonb audit;
ROLLBACK;