-- DEV-only: real Composer conflict response returns the OTHER session identity.
-- A synthetic user's Composer draft remains unclaimed; transaction rolled back.
BEGIN;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000003003';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000003003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-composer-conflict-rollback@example.invalid',now(),now());
INSERT INTO public.profiles(id) VALUES ('00000000-0000-0000-0000-000000003003') ON CONFLICT DO NOTHING;
INSERT INTO public.workout_sessions (id,user_id,status,duration_minutes,generation_local_date,planned_environment_code,generated_workout,planning_context_json)
VALUES (
 '00000000-0000-0000-0000-000000003004','00000000-0000-0000-0000-000000003003','generated',45,CURRENT_DATE,'HOME',
 '{"version":"qa-conflict-v1","meta":{"source":"auto","environment_code":"HOME"},"blocks":[{"block_key":"skill","exercises":[{"exercise_id":"EX006"}]}]}'::jsonb,
 '{"session_source":"AUTO"}'::jsonb
);
DO $qa$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000003003';
 other_id uuid:='00000000-0000-0000-0000-000000003004';
 item_id uuid;
 result jsonb;
 draft jsonb;
BEGIN
 draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
 'duration_minutes',45,'environment_code','HOME',
 'architecture',jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object(
 'type','STRENGTH','minutes',21,'exercises',jsonb_build_array(jsonb_build_object('id','EX006'))))));
 INSERT INTO public.user_training_plan_items(
  user_id,sequence_index,recommended_date,status,planned_duration_minutes,planned_focus,
  planned_target_region,planned_progression_intent,planning_context_json
 ) VALUES (u,0,CURRENT_DATE,'available',45,'Strength','Full Body','MAINTAIN',
 jsonb_build_object('w11',jsonb_build_object('composer_draft',draft)))
 RETURNING id INTO item_id;
 result:=public.week_compile_composer_day_j_v1(u,item_id,CURRENT_DATE,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
 IF result->>'status'<>'OTHER_SESSION_ACTIVE'
 OR (result->>'session_id')::uuid<>other_id THEN
  RAISE EXCEPTION 'EXPECTED_OTHER_SESSION_ID: %',result;
 END IF;
 IF EXISTS (SELECT 1 FROM public.user_training_plan_items WHERE id=item_id AND session_id IS NOT NULL) THEN
  RAISE EXCEPTION 'COMPOSER_DRAFT_WAS_BOUND_UNEXPECTEDLY';
 END IF;
 PERFORM set_config('ugerod.qa_conflict_status',
 jsonb_build_object('status','PASS','control',result->>'status',
   'has_conflict_session_id',result->>'session_id' IS NOT NULL,
   'composer_draft_untouched',true)::text,true);
END;
$qa$;
SELECT current_setting('ugerod.qa_conflict_status')::jsonb AS result;
ROLLBACK;