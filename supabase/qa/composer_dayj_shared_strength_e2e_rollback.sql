-- DEV-only Composer -> Day-J -> Player materialization -> idempotency regression.
-- All writes are done inside one transaction, which is always rolled back.
-- Never run on production without first checking the fixture ID is unused.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES('00000000-0000-0000-0000-000000000001',
'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
'qa-composer-rollback@example.invalid',now(),now());
INSERT INTO public.profiles(id)
VALUES ('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';

DO $qa$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000000001';
 v_item_id uuid;
 draft jsonb;
 first_result jsonb;
 second_result jsonb;
 v_count int;
BEGIN
 draft:=jsonb_build_object(
  'version','w11-composer-draft-v1','structure_stable',true,
  'duration_minutes',60,'environment_code','HOME',
  'target_region','Full Body','progression_intent','MAINTAIN',
  'intent',jsonb_build_object('focus','Strength','key','STRENGTH'),
  'architecture',jsonb_build_object('key','strength','blocks',
    jsonb_build_array(jsonb_build_object('type','STRENGTH',
      'label','Renforcement','minutes',21,
      'exercises','[{"id":"EX006"},{"id":"EX033"}]'::jsonb)))
 );
 INSERT INTO public.user_training_plan_items(
  user_id,sequence_index,recommended_date,status,
  planned_duration_minutes,planned_focus,planned_target_region,
  planned_progression_intent,planning_context_json
 ) VALUES (u,0,CURRENT_DATE,'available',60,'Strength',
           'Full Body','MAINTAIN',
           jsonb_build_object('w11',jsonb_build_object('composer_draft',draft)))
 RETURNING id INTO v_item_id;

 first_result:=public.week_compile_composer_day_j_v1(
  u,v_item_id,CURRENT_DATE,6,ARRAY['Aucune']::text[],
  '{}'::text[],'HOME');
 IF first_result->>'status'<>'READY'
   OR (first_result->>'exercise_count')::int<>2 THEN
   RAISE EXCEPTION 'DAY_J_EXPECTED_READY: %',first_result;
 END IF;
 SELECT count(*) INTO v_count
 FROM public.workout_session_exercises
 WHERE session_id=(first_result->>'session_id')::uuid
   AND (prescription_json->>'sets')::int>0
   AND (prescription_json->>'rest_seconds')::int>0;
 IF v_count<>2 THEN
   RAISE EXCEPTION 'DAY_J_DID_NOT_PERSIST_C2_C4_SETS_AND_REST: %',v_count;
 END IF;

 second_result:=public.week_compile_composer_day_j_v1(
  u,v_item_id,CURRENT_DATE,6,ARRAY['Aucune']::text[],
  '{}'::text[],'HOME');
 IF second_result->>'status'<>'ALREADY_READY'
   OR second_result->>'session_id'<>first_result->>'session_id' THEN
   RAISE EXCEPTION 'DAY_J_IDEMPOTENCY_FAILURE: %',second_result;
 END IF;
 RAISE NOTICE 'DAY_J_C2_C4_AND_IDEMPOTENCY_OK';
END;
$qa$;
ROLLBACK;
