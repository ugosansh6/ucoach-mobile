-- DEV-only QA for #3: Composer Strength+WOD may intentionally share EX033.
-- Same-block duplicate EX033 must still be rejected; all data rolled back.
BEGIN;
SET LOCAL statement_timeout='95000ms';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000009333';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES('00000000-0000-0000-0000-000000009333','00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','qa-composer-cross-block-rollback@example.invalid',now(),now());
INSERT INTO public.profiles(id) VALUES('00000000-0000-0000-0000-000000009333') ON CONFLICT DO NOTHING;
DO $qa$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000009333';
 pid uuid; negative_id uuid; result jsonb; player_blocks jsonb; cnt integer;
 draft jsonb;
BEGIN
 draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',60,
 'environment_code','HOME','target_region','Full Body',
 'intent',jsonb_build_object('key','STRENGTH','focus','Strength'),
 'architecture',jsonb_build_object('key','strength','blocks',jsonb_build_array(
 jsonb_build_object('type','STRENGTH','label','Renforcement','minutes',21,
 'exercises',jsonb_build_array(jsonb_build_object('id','EX033'),jsonb_build_object('id','EX033'))))));
 INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
 planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
 VALUES(u,0,current_date,'available',60,'Strength','Full Body','MAINTAIN',
 jsonb_build_object('w11',jsonb_build_object('composer_draft',draft)))
 RETURNING id INTO negative_id;
 BEGIN
 result:=public.week_compile_composer_day_j_v1(u,negative_id,current_date,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
 RAISE EXCEPTION 'UNEXPECTED_ACCEPTANCE_SAME_BLOCK';
 EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE 'COMPOSER_DUPLICATE_OR_MISSING_EXERCISE_EX033%' THEN RAISE; END IF;
 END;
 draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',60,
 'environment_code','HOME','target_region','Full Body',
 'intent',jsonb_build_object('key','STRENGTH','focus','Strength'),
 'mechanic',jsonb_build_object('key','AMRAP'),
 'architecture',jsonb_build_object('key','strength_wod','blocks',jsonb_build_array(
 jsonb_build_object('type','STRENGTH','label','Renforcement','minutes',21,
  'exercises',jsonb_build_array(jsonb_build_object('id','EX006'),jsonb_build_object('id','EX033'))),
 jsonb_build_object('type','WOD','label','WOD court','minutes',12,
  'exercises',jsonb_build_array(jsonb_build_object('id','EX033'))))));
 INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
 planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
 VALUES(u,1,current_date,'available',60,'Strength','Full Body','MAINTAIN',
 jsonb_build_object('w11',jsonb_build_object('composer_draft',draft)))
 RETURNING id INTO pid;
 result:=public.week_compile_composer_day_j_v1(u,pid,current_date,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
 IF result->>'status'<>'READY' THEN RAISE EXCEPTION 'CROSS_BLOCK_NOT_READY: %',result; END IF;
 SELECT generated_workout->'blocks' INTO player_blocks FROM public.workout_sessions
 WHERE id=(result->>'session_id')::uuid AND user_id=u;
 IF jsonb_array_length(player_blocks)<>2 OR player_blocks#>>'{0,block_key}'<>'strength'
   OR player_blocks#>>'{1,block_key}'<>'wod'
   OR player_blocks#>>'{0,exercises,1,exercise_id}'<>'EX033'
   OR player_blocks#>>'{1,exercises,0,exercise_id}'<>'EX033'
 THEN RAISE EXCEPTION 'PLAYER_BLOCK_PRESERVATION_FAILED: %',player_blocks; END IF;
 SELECT count(*) INTO cnt FROM public.workout_session_exercises
 WHERE session_id=(result->>'session_id')::uuid AND exercise_id='EX033';
 IF cnt<>2 THEN RAISE EXCEPTION 'EX033_NOT_TWO_INSTANCES: %',cnt; END IF;
 IF result->>'exercise_count'<>'3' THEN RAISE EXCEPTION 'WRONG_EXERCISE_COUNT: %',result; END IF;
 -- Previewing the Composer WOD must not mark it started or revealed.
 IF EXISTS (SELECT 1 FROM public.workout_sessions
   WHERE id=(result->>'session_id')::uuid AND wod_revealed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'WOD_REVEALED_BEFORE_START'; END IF;
 PERFORM set_config('ugerod.qa_wod_session_id',result->>'session_id',true);
 result:=public.e_mark_session_started(current_setting('ugerod.qa_wod_session_id')::uuid,current_date);
 IF result->>'status'<>'IN_PROGRESS' THEN RAISE EXCEPTION 'SESSION_START_FAILED: %',result; END IF;
 result:=public.mark_wod_revealed(current_setting('ugerod.qa_wod_session_id')::uuid);
 IF result->>'status'<>'WOD_REVEALED' THEN RAISE EXCEPTION 'WOD_REVEAL_FAILED: %',result; END IF;
 result:=public.mark_wod_started(current_setting('ugerod.qa_wod_session_id')::uuid);
 IF result->>'status'<>'WOD_STARTED' THEN RAISE EXCEPTION 'WOD_START_FAILED: %',result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workout_sessions
   WHERE id=current_setting('ugerod.qa_wod_session_id')::uuid
     AND wod_revealed_at IS NOT NULL AND wod_started_at IS NOT NULL)
 THEN RAISE EXCEPTION 'WOD_LIFECYCLE_NOT_PERSISTED'; END IF;

 PERFORM set_config('ugerod.qa_cross_block_result',
 jsonb_build_object('status','PASS','same_block_duplicates_rejected',true,
 'cross_block_preserved',true,'EX033_instances',cnt,'blocks',jsonb_array_length(player_blocks))::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_cross_block_result')::jsonb result;
ROLLBACK;
