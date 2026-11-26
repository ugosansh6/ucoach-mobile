-- Synthetic user; all writes rollback.
BEGIN;
SET LOCAL statement_timeout='55s';
DO $qa$
DECLARE u uuid:=gen_random_uuid(); s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); r jsonb; full_load jsonb; prior_load jsonb; prior_context jsonb;
BEGIN
 INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 VALUES(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-daily-'||u::text||'@example.invalid',now(),now());
 INSERT INTO public.profiles(id,weight) VALUES(u,80) ON CONFLICT DO NOTHING;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,generated_at,generation_local_date,planned_environment_code,progression_intent,generated_workout)
 VALUES(s1,u,'generated',45,'6','Strength','Core',now(),current_date,'HOME','MAINTAIN','{}'::jsonb),
       (s2,u,'generated',90,'6','Strength','Core',now(),current_date,'HOME','MAINTAIN','{}'::jsonb);
 INSERT INTO public.workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,status,prescription_json,expected_outcome_json,user_execution_status)
 VALUES(x,s1,'EX087','Hollow Hold','skill',1,'pending','{"duration_seconds":30}'::jsonb,'{"duration_seconds":30}'::jsonb,'pending');
 r:=public.e_mark_session_started(s1,current_date);
 IF r->>'status'<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Start failed %',r; END IF;
 r:=public.e_mark_session_started(s2,current_date);
 IF r->>'status'<>'OTHER_SESSION_ACTIVE' OR r->>'active_session_id'<>s1::text THEN RAISE EXCEPTION 'Concurrent guard failed %',r; END IF;
 IF public.e_mark_session_started(s1,current_date)->>'status'<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Resume failed'; END IF;
 r:=public.complete_workout_session_v2(s1,10,3,'Synthetic daily QA',jsonb_build_array(jsonb_build_object('session_exercise_id',x,'exercise_id','EX087','user_execution_status','completed','duration_seconds',30)),null);
 IF r->>'status'<>'COMPLETED' THEN RAISE EXCEPTION 'Completion failed %',r; END IF;
 IF public.e_mark_session_started(s2,current_date)->>'status'<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Second session start failed'; END IF;
 PERFORM set_config('ugerod.daily_generation_anchor','',true);
 full_load:=public.program_coach_recent_load_v1(u,current_date);
 PERFORM set_config('ugerod.daily_generation_anchor',current_date::text,true);
 prior_load:=public.program_coach_recent_load_v1(u,current_date);
 IF (full_load#>>'{sessions,7d}')::int<>1 OR (prior_load#>>'{sessions,7d}')::int<>0 THEN RAISE EXCEPTION 'Load isolation failed full %, scoped %',full_load#>'{sessions}',prior_load#>'{sessions}'; END IF;
 IF public.program_coach_recovery_state_from_load_v1(prior_load,'low','{}'::text[])->>'state'<>'RECOVERY_PRIORITY' THEN RAISE EXCEPTION 'Readiness safety lost'; END IF;
 IF public.program_coach_recovery_state_from_load_v1(prior_load,'high',array['knee'])->>'state'<>'PROTECT' THEN RAISE EXCEPTION 'Pain safety lost'; END IF;
 IF (public.program_coach_recent_load_v1(u,current_date+1)#>>'{sessions,7d}')::int<>1 THEN RAISE EXCEPTION 'Next day history lost'; END IF;
 PERFORM set_config('ugerod.daily_generation_anchor','',true);
 IF (public.program_coach_recent_load_v1(u,current_date)#>>'{sessions,7d}')::int<>1 THEN RAISE EXCEPTION 'Full history lost'; END IF;
 PERFORM set_config('ugerod.qa_daily_stabilization','PASS start lock, exact resume, second start, scoped load, next day/full history, readiness and pain',true);
END $qa$;
SELECT current_setting('ugerod.qa_daily_stabilization') AS result;
ROLLBACK;
