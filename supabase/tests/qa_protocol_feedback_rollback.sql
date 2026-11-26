BEGIN;
SET LOCAL statement_timeout='55s';
-- Real completion and coaching reads, synthetic user, transaction rollback.
DO $qa$
DECLARE u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); x uuid; r jsonb; results jsonb:='[]'; t jsonb; c jsonb; n int;
BEGIN
 INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 VALUES(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-wod-provenance-'||u::text||'@example.invalid',now(),now());
 INSERT INTO public.profiles(id,weight) VALUES(u,80) ON CONFLICT DO NOTHING;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,generated_at,generation_local_date,planned_environment_code,progression_intent,mechanic_json,generated_workout)
 VALUES(s,u,'generated',45,'6','Strength','Core',now(),current_date,'HOME','MAINTAIN','{"mechanic_key":"CIRCUIT","parameters":{"rounds":6}}'::jsonb,'{}'::jsonb);
 FOR n IN 1..4 LOOP
  x:=gen_random_uuid();
  INSERT INTO public.workout_session_exercises(id,session_id,exercise_id,exercise_name,block_key,position,status,prescription_json,expected_outcome_json,user_execution_status)
  VALUES(x,s,'EX087','Hollow Hold','wod',n,'pending','{"duration_seconds":30}'::jsonb,'{"duration_seconds":30}'::jsonb,'pending');
  results:=results||jsonb_build_array(jsonb_build_object('session_exercise_id',x,'exercise_id','EX087','user_execution_status',case when n=3 then 'not_completed' else 'adapted' end,
    'duration_seconds',case when n=3 then null else 30 end,
    'performance_actual_json',case when n=4 then '{"execution_status_origin":"USER_EXPLICIT"}'::jsonb else jsonb_build_object('execution_status_origin','PROTOCOL_RESULT','execution_detail',case when n=3 then 'NOT_REACHED' else 'PARTIAL' end,'protocol_finish_reason','manual_stop') end));
 END LOOP;
 PERFORM public.e_mark_session_started(s,current_date);
 PERFORM public.mark_wod_revealed(s);
 PERFORM public.mark_wod_started(s);
 r:=public.complete_workout_session_v2(s,6,7,'Synthetic QA',results,'{"mechanic_key":"CIRCUIT","finish_reason":"manual_stop","protocol_completed":false,"completion_ratio":0.1667,"elapsed_seconds":120,"controlled_timing":true}'::jsonb);
 IF r->>'status'<>'COMPLETED' THEN RAISE EXCEPTION 'Completion failed %',r; END IF;
 IF (SELECT count(*) FROM public.exercise_logs WHERE session_id=s AND actual_json->>'execution_status_origin'='PROTOCOL_RESULT')<>3 THEN RAISE EXCEPTION 'Provenance missing in actuals'; END IF;
 IF (SELECT count(*) FROM public.workout_session_exercises WHERE session_id=s AND user_execution_status='adapted')<>3 THEN RAISE EXCEPTION 'Legacy status changed'; END IF;
 PERFORM set_config('ugerod.daily_generation_anchor','',true);
 t:=public.program_coach_recent_load_v1(u,current_date)#>'{windows,7,tolerance}';
 IF (t->>'adapted_exercises')::int<>1 OR (t->>'not_completed_exercises')::int<>0 OR (t->>'protocol_partial_exercises')::int<>2 OR (t->>'protocol_not_reached_exercises')::int<>1 THEN RAISE EXCEPTION 'Incorrect tolerance %',t; END IF;
 c:=public.d_resolve_session_context(u,current_date+1,45,'normal','Strength','Core',null);
 IF (c#>>'{previous_session,exception_ratio}')::numeric IS DISTINCT FROM 0.250::numeric THEN RAISE EXCEPTION 'Wrong last exception ratio %',c#>'{previous_session}'; END IF;
 IF coalesce(c->'reason_codes','[]'::jsonb)?'intent:previous_session_many_exceptions' THEN RAISE EXCEPTION 'False exception recalibration'; END IF;
 IF public.program_coach_recovery_state_from_load_v1(public.program_coach_recent_load_v1(u,current_date),'low','{}'::text[])->>'state'<>'RECOVERY_PRIORITY' THEN RAISE EXCEPTION 'Low readiness guard lost'; END IF;
 IF public.program_coach_recovery_state_from_load_v1(public.program_coach_recent_load_v1(u,current_date),'high',array['knee'])->>'state'<>'PROTECT' THEN RAISE EXCEPTION 'Pain guard lost'; END IF;
 IF (public.program_coach_recent_load_v1(u,current_date)#>>'{windows,7,density_context,average_protocol_completion_ratio}')::numeric IS DISTINCT FROM 0.1667::numeric THEN RAISE EXCEPTION 'Actual ratio lost'; END IF;
 PERFORM set_config('ugerod.qa_protocol_feedback',jsonb_build_object('status','PASS','tolerance',t,'previous_exception_ratio',c#>>'{previous_session,exception_ratio}','history_preserved',true,'safety_preserved',true)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_protocol_feedback')::jsonb result;
ROLLBACK;
