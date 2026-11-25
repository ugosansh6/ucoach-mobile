-- UGEROD QA / DEV only: a user-authored W11 Composer architecture is authoritative.
-- Run as one SQL statement in DEV; no real users or permanent workout writes.
-- A synthetic user, plan item and workout are created inside a transaction and rolled back.
-- Keep the selected architecture (Warm-up -> Skill -> WOD); never insert automatic
-- Today-session blocks (Tabata/Strength/etc.) in a Composer session.
BEGIN;
SET LOCAL statement_timeout='80s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-manual-blocks-rollback@example.invalid',now(),now());
INSERT INTO public.profiles(id) VALUES('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $test$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000000001';
 plan_id uuid;
 response jsonb;
 session_blocks jsonb;
 session_source text;
 block_keys text[];
BEGIN
 INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
 planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
 VALUES(u,0,CURRENT_DATE,'available',30,'General Fitness','Full Body','MAINTAIN',
 jsonb_build_object('w11',jsonb_build_object('composer_draft',jsonb_build_object(
 'version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',30,
 'environment_code','HOME','target_region','Full Body',
 'progression_intent','MAINTAIN','intent',jsonb_build_object('focus','General Fitness','key','TECHNIQUE'),
 'mechanic',jsonb_build_object('key','AMRAP'),
 'architecture',jsonb_build_object('key','user_authored','blocks',jsonb_build_array(
  jsonb_build_object('type','WARMUP','label','Échauffement','minutes',5,'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
  jsonb_build_object('type','SKILL','label','Skill','minutes',8,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
  jsonb_build_object('type','WOD','label','WOD','minutes',12,'exercises',jsonb_build_array(jsonb_build_object('id','EX006'),jsonb_build_object('id','EX539')))
 ))))))
 RETURNING id INTO plan_id;
 response:=public.week_compile_composer_day_j_v1(u,plan_id,CURRENT_DATE,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
 IF response->>'status'<>'READY' THEN RAISE EXCEPTION 'UNEXPECTED_COMPILE_RESULT: %',response; END IF;
 SELECT generated_workout->'blocks',generated_workout#>>'{meta,source}'
 INTO session_blocks,session_source FROM public.workout_sessions
 WHERE id=(response->>'session_id')::uuid AND user_id=u;
 SELECT array_agg(b->>'block_key' ORDER BY ordinality) INTO block_keys
 FROM jsonb_array_elements(session_blocks) WITH ORDINALITY AS x(b,ordinality);
 IF block_keys IS DISTINCT FROM ARRAY['warm_up','skill','wod']::text[] THEN
   RAISE EXCEPTION 'COMPOSER_MANUAL_STRUCTURE_WAS_CHANGED: %',block_keys;
 END IF;
 IF session_source IS DISTINCT FROM 'w11_composer' THEN
   RAISE EXCEPTION 'LOST_COMPOSER_SESSION_SOURCE: %',session_source;
 END IF;
 PERFORM set_config('ugerod.qa_manual_structure_result',
 jsonb_build_object('status','PASS','session_source',session_source,
 'blocks',block_keys,'block_count',jsonb_array_length(session_blocks))::text,true);
END;
$test$;
SELECT current_setting('ugerod.qa_manual_structure_result')::jsonb as result;
ROLLBACK;
