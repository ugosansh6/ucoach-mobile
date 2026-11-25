-- #3: week removal must commit before the heavyweight coach replan.
-- All test users/sessions are synthetic. BEGIN ... ROLLBACK retains no data.
BEGIN;
SET LOCAL statement_timeout='12000ms';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000007711';

INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000007711','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','qa-week-remove-deferral@example.invalid',now(),now());
INSERT INTO public.profiles(id) VALUES ('00000000-0000-0000-0000-000000007711') ON CONFLICT DO NOTHING;
INSERT INTO public.workout_sessions(id,user_id,status,generated_workout)
VALUES
 ('00000000-0000-0000-0000-000000007712','00000000-0000-0000-0000-000000007711','generated','{}'::jsonb),
 ('00000000-0000-0000-0000-000000007713','00000000-0000-0000-0000-000000007711','in_progress','{}'::jsonb);
INSERT INTO public.user_training_plan_items(id,user_id,session_id,sequence_index,recommended_date,status,planned_duration_minutes)
VALUES
 ('00000000-0000-0000-0000-000000007714','00000000-0000-0000-0000-000000007711',
  '00000000-0000-0000-0000-000000007712',0,current_date,'claimed',30),
 ('00000000-0000-0000-0000-000000007715','00000000-0000-0000-0000-000000007711',
  '00000000-0000-0000-0000-000000007713',1,current_date,'claimed',30);

DO $qa$
DECLARE
  u uuid:='00000000-0000-0000-0000-000000007711';
  result jsonb; failure text;
BEGIN
  result:=public.week_remove_plan_item_v1(u,'00000000-0000-0000-0000-000000007714',current_date);
  IF result->>'removed' <> 'true' OR result->>'session_abandoned' <> 'true'
    OR result#>>'{coach_replan,status}' <> 'DEFERRED_POST_COMMIT'
    OR result->>'history_deleted' <> 'false'
    OR result->>'user_debt_created' <> 'false'
  THEN RAISE EXCEPTION 'GENERATED_REMOVE_CONTRACT_FAILED:%', result; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workout_sessions
    WHERE id='00000000-0000-0000-0000-000000007712' AND status='abandoned')
  THEN RAISE EXCEPTION 'GENERATED_SESSION_NOT_ABANDONED'; END IF;

  BEGIN
    result:=public.week_remove_plan_item_v1(u,'00000000-0000-0000-0000-000000007715',current_date);
    RAISE EXCEPTION 'STARTED_SESSION_WAS_REMOVED';
  EXCEPTION WHEN OTHERS THEN
    failure:=SQLERRM;
    IF failure NOT LIKE 'This session can no longer be removed%'
    THEN RAISE EXCEPTION 'UNEXPECTED_STARTED_ERROR:%',failure; END IF;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.workout_sessions
    WHERE id='00000000-0000-0000-0000-000000007713' AND status='in_progress')
    OR NOT EXISTS(SELECT 1 FROM public.user_training_plan_items
    WHERE id='00000000-0000-0000-0000-000000007715' AND status='claimed')
  THEN RAISE EXCEPTION 'STARTED_SESSION_OR_PLAN_ALTERED'; END IF;

  PERFORM set_config('ugerod.qa_remove_contract',jsonb_build_object(
    'status','PASS','generated_abandoned',true,
    'started_session_protected',true,'history_preserved',true,
    'replan_deferred',true)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_remove_contract')::jsonb AS result;
ROLLBACK;
