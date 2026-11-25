-- #33: observational DEV audit. No DDL, policy update or real user fixture.
-- Default PURE: isolate C2 -> C3/C4 across seven requested WOD budgets.
-- Optional transaction-local settings: ugerod.qa_mec33_mode (AUTO|COMPOSER|CONSTRAINT),
-- ugerod.qa_mec33_readiness (low|high), ugerod.qa_mec33_equipment (none|bands),
-- ugerod.qa_mec33_duration (AUTO total session minutes, default 60).
-- ugerod.qa_mec33_candidates (AUTO search width, default 20 stress/control;
-- deployed coach-handler v20 uses 8 for HOME/BOX, with SQL fallback expansion).
-- AUTO exercises the public C4 planner; it does not execute the mobile app RPC.
-- Timings are observations with tracking enabled, not a production p95 benchmark.
BEGIN;
SET LOCAL statement_timeout='45000ms';
SET LOCAL track_functions='all';
SET LOCAL ugerod.session_environment='HOME';
DO $audit$
DECLARE
 mode text:=coalesce(nullif(current_setting('ugerod.qa_mec33_mode',true),''),'PURE');
 ready text:=coalesce(nullif(current_setting('ugerod.qa_mec33_readiness',true),''),'high');
 eq text:=coalesce(nullif(current_setting('ugerod.qa_mec33_equipment',true),''),'none');
 total int:=coalesce(nullif(current_setting('ugerod.qa_mec33_duration',true),'')::int,60);
 candidate_count int:=coalesce(nullif(current_setting('ugerod.qa_mec33_candidates',true),'')::int,20);
 inv jsonb; names text[]; uid uuid; idx int:=0; w int; m text; ex text;
 stimulus jsonb; candidate jsonb; finalized jsonb; p jsonb; draft jsonb;
 preview jsonb; compiled jsonb; stored jsonb; item uuid; selected jsonb;
 rows jsonb:='[]'; start_at timestamptz; all_at timestamptz:=clock_timestamp();
 cap int; status text; state text; message text; equipment_ok boolean; keys text[];
 budgets int[]:=ARRAY[8,12,17,22,35,40,60];
BEGIN
 IF mode NOT IN ('PURE','AUTO','COMPOSER','CONSTRAINT') OR ready NOT IN ('low','high')
    OR eq NOT IN ('none','bands') THEN RAISE EXCEPTION 'Invalid audit parameters'; END IF;
 names:=CASE WHEN eq='bands' THEN ARRAY['Élastiques'] ELSE '{}'::text[] END;
 inv:=CASE WHEN eq='bands' THEN '[{"equipment_id":"E05","inventory_mode":"non_load","quantity":1}]'::jsonb ELSE '[]'::jsonb END;
 uid:=md5('mec33:'||mode||':seed')::uuid;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
 VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'qa-mec33-'||lower(mode)||'-seed@example.invalid',now(),now());
 INSERT INTO public.profiles(id) VALUES(uid) ON CONFLICT DO NOTHING;

 IF mode='PURE' THEN
  stimulus:=public.build_session_stimulus_target('Conditioning',90,ready,'Full Body','MAINTAIN','c1-default');
  FOREACH m IN ARRAY ARRAY['AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT'] LOOP
   candidate:=jsonb_build_object('mechanic',m,'exercises','[]'::jsonb);
   FOREACH ex IN ARRAY ARRAY['EX006','EX033','EX539'] LOOP
    candidate:=jsonb_set(candidate,'{exercises}',(candidate->'exercises')||jsonb_build_array(
      jsonb_build_object('exercise_id',ex,'prescription',public.c2_solver_prescription(
        uid,ex,stimulus,m,'MAINTAIN',inv))));
   END LOOP;
   FOREACH w IN ARRAY budgets LOOP
    start_at:=clock_timestamp();
    finalized:=public.c4_finalize_candidate(candidate,stimulus,90,w,'c4-final-default','c3-sim-default');
    cap:=public.c4_mechanic_wod_cap_minutes(m);
    IF (finalized#>>'{c4_final,mechanic_json,wod_budget_minutes}')::int IS DISTINCT FROM least(w,cap)
      OR (finalized#>>'{c4_final,wod_duration_guardrail,cap_applied}')::boolean IS DISTINCT FROM (w>cap) THEN
      RAISE EXCEPTION 'Cap path changed unexpectedly: mechanic %, requested %',m,w;
    END IF;
    rows:=rows||jsonb_build_array(jsonb_build_object(
      'mechanic',m,'requested_wod',w,'cap',cap,'effective_wod',finalized#>'{c4_final,mechanic_json,wod_budget_minutes}',
      'c4_status',finalized#>'{c4_final,status}','c4_reasons',finalized#>'{c4_final,reasons}',
      'predicted_seconds',finalized#>'{c4_final,mechanic_json,predicted_elapsed_seconds}',
      'duration_semantic',public.c4_mechanic_duration_contract(m,null,ready,w)->>'duration_semantic',
      'parameters',finalized#>'{c4_final,mechanic_json,parameters}',
      'ms',round(extract(epoch from clock_timestamp()-start_at)*1000,2)));
   END LOOP;
  END LOOP;
  -- NULL exact duration follows the C3 fallback, not the mechanic cap.
  candidate:=jsonb_build_object('mechanic','HIIT','exercises','[]'::jsonb);
  FOREACH ex IN ARRAY ARRAY['EX006','EX033','EX539'] LOOP
    candidate:=jsonb_set(candidate,'{exercises}',(candidate->'exercises')||jsonb_build_array(
      jsonb_build_object('exercise_id',ex,'prescription',public.c2_solver_prescription(
        uid,ex,stimulus,'HIIT','MAINTAIN',inv))));
  END LOOP;
  finalized:=public.c4_finalize_candidate(candidate,stimulus,90,null);
  IF (finalized#>>'{c4_final,mechanic_json,wod_budget_minutes}')::int IS DISTINCT FROM
      public.c3_wod_budget_minutes(90,null)
    OR (finalized#>>'{c4_final,wod_duration_guardrail,cap_applied}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'NULL exact-duration behavior changed';
  END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('mechanic','HIIT','requested_wod',null,
    'effective_wod',finalized#>'{c4_final,mechanic_json,wod_budget_minutes}',
    'cap',public.c4_mechanic_wod_cap_minutes('HIIT'),'case','NULL_EXACT_USES_C3_DEFAULT'));
 ELSIF mode='AUTO' THEN
  start_at:=clock_timestamp();
  p:=public.c4_plan_full_session_v2(uid,'General Fitness',total,ready,'Full Body','MAINTAIN',
     '{}'::text[],inv,3,'Intermédiaire',candidate_count,'c4-final-default');
  SELECT coalesce(bool_and(public.exercise_equipment_compatible(e->>'exercise_id',inv)),true)
   INTO equipment_ok FROM jsonb_array_elements(coalesce(p->'blocks','[]')) b,
    jsonb_array_elements(coalesce(b->'exercises','[]')) e;
  IF p->>'status'='READY' AND ((p#>>'{architecture,planned_minutes}')::numeric>total OR NOT equipment_ok) THEN
    RAISE EXCEPTION 'AUTO budget/equipment invariant failed';
  END IF;
  rows:=jsonb_build_array(jsonb_build_object(
   'session_minutes',total,'candidate_count',candidate_count,'status',p->>'status','reason',p->>'reason',
   'session_intent',p#>>'{architecture,session_intent_v2,proposed_session_intent}',
   'home_guard',p#>'{architecture,home_classic_skill_wod_guard}',
   'mechanic',p#>>'{selected_candidate,mechanic}',
   'wod_minutes',p#>'{architecture,wod_minutes}','planned_minutes',p#>'{architecture,planned_minutes}',
   'wod_target_minutes',p#>'{architecture,wod_target_minutes}',
   'predicted_seconds',p#>'{selected_candidate,c4_final,mechanic_json,predicted_elapsed_seconds}',
   'finalizer_guardrail',p#>'{selected_candidate,c4_final,wod_duration_guardrail}',
   'architecture_guardrail',p#>'{architecture,wod_duration_guardrail}',
   'equipment_ok',equipment_ok,
   'blocks',(select jsonb_agg(jsonb_build_object('key',b->>'block_key','minutes',b->'duration_minutes',
     'count',jsonb_array_length(coalesce(b->'exercises','[]')))) from jsonb_array_elements(coalesce(p->'blocks','[]')) b),
   'ms',round(extract(epoch from clock_timestamp()-start_at)*1000,2)));
 ELSE
  IF mode='CONSTRAINT' THEN budgets:=ARRAY[40]; END IF;
  FOREACH m IN ARRAY (CASE WHEN mode='CONSTRAINT' THEN ARRAY['AMRAP'] ELSE ARRAY['AMRAP','FOR_TIME','CIRCUIT'] END) LOOP
   FOREACH w IN ARRAY budgets LOOP
    idx:=idx+1;uid:=md5('mec33:composer:'||idx)::uuid;
    PERFORM set_config('request.jwt.claim.sub',uid::text,true);
    INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'qa-mec33-composer-'||idx||'@example.invalid',now(),now());
    INSERT INTO public.profiles(id) VALUES(uid) ON CONFLICT DO NOTHING;
    draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
      'duration_minutes',w+16,'environment_code','HOME','target_region','Full Body','progression_intent','MAINTAIN',
      'intent',jsonb_build_object('key','CONDITIONING','focus','Conditioning'),
      'mechanic',jsonb_build_object('key',m),'architecture',jsonb_build_object(
        'key','custom','estimatedMinutes',w+16,'transitionReserveMinutes',5,
        'blocks',jsonb_build_array(
          jsonb_build_object('type','WARMUP','minutes',7,'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
          jsonb_build_object('type','TABATA','minutes',4,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
          jsonb_build_object('type','WOD','minutes',w,'exercises',jsonb_build_array(
            jsonb_build_object('id','EX006'),jsonb_build_object('id','EX033'),
            jsonb_build_object('id',CASE WHEN mode='CONSTRAINT' THEN 'EX321' ELSE 'EX539' END))))));
    INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
      planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
    VALUES(uid,0,current_date,'available',w+16,'Conditioning','Full Body','MAINTAIN',jsonb_build_object('w11','{}'::jsonb))
    RETURNING id INTO item;
    PERFORM public.week_save_composer_draft_v1(uid,item,draft);
    SELECT planning_context_json#>'{w11,composer_draft}' INTO stored FROM public.user_training_plan_items WHERE id=item;
    IF stored->'architecture' IS DISTINCT FROM draft->'architecture' THEN RAISE EXCEPTION 'Saved structure changed'; END IF;
    start_at:=clock_timestamp();
    preview:=public.week_composer_prescription_preview_v1(uid,draft,names);
    BEGIN
      compiled:=public.week_compile_composer_day_j_v1(uid,item,current_date,
         CASE ready WHEN 'low' THEN 3 ELSE 9 END,ARRAY['Aucune'],names,'HOME');
    EXCEPTION WHEN OTHERS THEN
      IF mode<>'CONSTRAINT' OR eq<>'none' OR SQLERRM NOT LIKE 'COMPOSER_EXERCISE_INCOMPATIBLE_EX321%' THEN RAISE; END IF;
      compiled:=jsonb_build_object('status','EXPECTED_EQUIPMENT_REJECTION','reason',SQLERRM);
    END;
    IF mode='CONSTRAINT' AND eq='none' AND compiled->>'status'<>'EXPECTED_EQUIPMENT_REJECTION' THEN
      RAISE EXCEPTION 'Missing bands were accepted';
    END IF;
    IF compiled->>'status'='READY' THEN
     SELECT b INTO STRICT selected FROM public.workout_sessions s,
       jsonb_array_elements(s.generated_workout->'blocks') b
       WHERE s.id=(compiled->>'session_id')::uuid AND b->>'block_key'='wod';
     IF (selected->>'duration_minutes')::int IS DISTINCT FROM w THEN RAISE EXCEPTION 'Composer budget changed'; END IF;
     SELECT array_agg(b->>'block_key' ORDER BY ord) INTO keys FROM public.workout_sessions s,
       jsonb_array_elements(s.generated_workout->'blocks') WITH ORDINALITY z(b,ord)
       WHERE s.id=(compiled->>'session_id')::uuid;
     IF keys IS DISTINCT FROM ARRAY['warm_up','tabata','wod'] THEN RAISE EXCEPTION 'Composer order changed'; END IF;
    ELSE selected:=null; END IF;
    rows:=rows||jsonb_build_array(jsonb_build_object('mechanic',m,'requested_wod',w,'session_minutes',w+16,
       'preview_status',preview->>'status','compile_status',compiled->>'status',
       'compile_reason',compiled->>'reason',
       'effective_wod',selected->'duration_minutes','parameters',selected#>'{mechanic_json,parameters}',
       'ms',round(extract(epoch from clock_timestamp()-start_at)*1000,2)));
   END LOOP;
  END LOOP;
 END IF;
 PERFORM set_config('ugerod.qa_mec33_result',jsonb_build_object('mode',mode,'readiness',ready,'equipment',eq,
   'rows',rows,'elapsed_ms',round(extract(epoch from clock_timestamp()-all_at)*1000,2),
   'scope',CASE mode WHEN 'PURE' THEN 'ISOLATED_FINALIZER_WITHOUT_ATHLETE_RUNTIME_CONTEXT'
     WHEN 'AUTO' THEN 'PUBLIC_C4_PLANNER_NOT_APP_RPC' ELSE 'PREVIEW_SAVE_DAYJ_NOT_DEVICE_PLAYER' END)::text,true);
EXCEPTION WHEN query_canceled OR OTHERS THEN
 GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
 PERFORM set_config('ugerod.qa_mec33_result',jsonb_build_object('mode',mode,'readiness',ready,
   'equipment',eq,'session_minutes',total,'status','AUDIT_ERROR','sqlstate',state,'message',message,
   'elapsed_ms',round(extract(epoch from clock_timestamp()-all_at)*1000,2))::text,true);
END $audit$;
SELECT current_setting('ugerod.qa_mec33_result')::jsonb result,
 (select jsonb_agg(jsonb_build_object('name',funcname,'calls',calls,'self_ms',round(self_time::numeric,2)))
  from pg_stat_xact_user_functions where funcname in ('c4_mechanic_wod_cap_minutes','c4_finalize_candidate_pre_m72',
   'c2_mechanic_fit','c4_finalize_candidate','c4_plan_full_session_pre_skill_contract_final_v2',
   'c4_plan_full_session_pre_skill_contract_final_mechanic_policy_s')) trace;
ROLLBACK;
