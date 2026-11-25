-- #36: observe existing Today wrappers and history preference, without changing policy.
BEGIN;
SET LOCAL statement_timeout='120s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000938036','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-variety-history@example.invalid',now(),now());
INSERT INTO profiles(id,weight,experience) VALUES('00000000-0000-0000-0000-000000938036',80,'advanced') ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000938036';
SET LOCAL ugerod.session_environment='BOX';
DO $qa$
DECLARE u uuid:=auth.uid(); sid uuid; i int; a jsonb; b jsonb; r jsonb; full_result jsonb; cache jsonb; replay jsonb;
 results jsonb:='[]'; started timestamptz; elapsed numeric;
BEGIN
 a:=jsonb_build_object('mechanic','CIRCUIT','coach_score',90,'c4_selection_score',90,'p2_base_quality_score',90,
  'c4_anti_redundancy',jsonb_build_object('score',70));
 b:=jsonb_build_object('mechanic','EMOM','coach_score',90,'c4_selection_score',89.5,'p2_base_quality_score',89.5,
  'c4_anti_redundancy',jsonb_build_object('score',90));
 FOR i IN 1..20 LOOP
  sid:=gen_random_uuid();
  INSERT INTO workout_sessions(id,user_id,status,duration_minutes,readiness,focus,target_region,generated_at,completed_at,mechanic_json,generated_workout)
   VALUES(sid,u,'completed',30,'normal','General Fitness','Full Body',now()-make_interval(days=>20-i),now()-make_interval(days=>20-i),
    '{"mechanic_key":"CIRCUIT"}', '{"blocks":[{"block_key":"wod","duration_minutes":20}]}');
  INSERT INTO workout_session_exercises(session_id,exercise_id,exercise_name,block_key,position,status,user_execution_status,reps_completed)
   VALUES(sid,'EX033','Air Squat','wod',1,'completed','completed',10);
  IF NOT public.session_counts_as_training_v1(sid) THEN RAISE EXCEPTION 'History fixture does not count'; END IF;
  IF i=ANY(ARRAY[1,3,5,10,20]) THEN
   r:=public.c4_apply_mechanic_freshness_tiebreak_v1(u,jsonb_build_object('status','READY','selected_candidate',a,
    'accepted_candidates',jsonb_build_array(a,b)),'c4-final-default');
   IF r#>>'{selected_candidate,mechanic}'<>(CASE WHEN i<3 THEN 'CIRCUIT' ELSE 'EMOM' END) THEN RAISE EXCEPTION 'Freshness trigger mismatch at %: %',i,r; END IF;
   IF (r#>>'{p2_mechanic_freshness_policy,recent_completed_sessions}')::int<>least(i,5) THEN RAISE EXCEPTION 'History window changed'; END IF;
   -- A worse candidate must not be selected just for variety.
   IF public.c4_apply_mechanic_freshness_tiebreak_v1(u,jsonb_build_object('status','READY','selected_candidate',a,
     'accepted_candidates',jsonb_build_array(a,b||'{"c4_selection_score":50,"p2_base_quality_score":50}')),'c4-final-default')#>>'{selected_candidate,mechanic}'<>'CIRCUIT'
     THEN RAISE EXCEPTION 'Quality degraded for variety'; END IF;
   started:=clock_timestamp();
   full_result:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(u,'General Fitness',60,'normal','Full Body','MAINTAIN','{}','[]',3,'Intermédiaire',8,17,'c4-final-default');
   elapsed:=extract(epoch FROM clock_timestamp()-started);
   IF full_result->>'status'<>'READY' THEN RAISE EXCEPTION 'Today no result: %',full_result->>'status'; END IF;
   cache:=full_result->'_c4_prepared_cache';
   IF cache IS NOT NULL THEN
    cache:=cache||jsonb_build_object('source_full_wrapper_ready',true);
    replay:=public.solve_session_engine_c4_mechanic_policy_shadow_full_from_cache_(u,'General Fitness',60,'normal','Full Body','MAINTAIN','{}','[]',3,'Intermédiaire',8,17,'c4-final-default',cache);
   ELSE replay:=jsonb_build_object('status','CACHE_ABSENT'); END IF;
   results:=results||jsonb_build_array(jsonb_build_object('history_sessions',i,'controlled_freshness',r->'p2_mechanic_freshness_policy',
    'selected',full_result#>>'{selected_candidate,mechanic}','accepted',jsonb_array_length(coalesce(full_result->'accepted_candidates','[]')),
    'rejected',jsonb_array_length(coalesce(full_result->'rejected_candidates','[]')),'refusals',
      (SELECT jsonb_agg(jsonb_build_object('mechanic',value->>'mechanic','reasons',value#>'{quality_gate,hard_gate_reasons}')) FROM jsonb_array_elements(coalesce(full_result->'rejected_candidates','[]'))),
    'today_freshness',full_result->'p2_mechanic_freshness_policy','generation_seconds',elapsed,'cache_status',replay->>'status',
    'cache_freshness',replay->'p2_mechanic_freshness_policy'));
  END IF;
 END LOOP;
 PERFORM set_config('ugerod.qa_variety_history',results::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_variety_history')::jsonb AS audit;
ROLLBACK;
