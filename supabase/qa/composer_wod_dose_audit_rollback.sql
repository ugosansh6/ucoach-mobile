-- #34: characterize existing preview / Day-J / C3 / C4 without changing them.
-- Synthetic athlete and cases only. Execute whole file; all writes roll back.
-- WOD-only legacy structures isolate this block from Strength / warm-up.
BEGIN;
SET LOCAL statement_timeout='90s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000934001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','qa-wod-dose@example.invalid',now(),now());
INSERT INTO public.profiles(id,weight)
VALUES('00000000-0000-0000-0000-000000934001',80) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000934001';
DO $audit$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000934001';
 env text; m text; minutes int; n int; ids text[]; chosen jsonb; draft jsonb;
 item uuid; preview jsonb; compiled jsonb; block jsonb; x jsonb; pres jsonb;
 unit jsonb; round_seconds numeric; elapsed numeric; rounds int; candidate jsonb;
 c4 jsonb; r jsonb; results jsonb:='[]'; started timestamptz:=clock_timestamp();
BEGIN
 FOREACH env IN ARRAY ARRAY['HOME','BOX','GYM','OUTDOOR'] LOOP
  SELECT array_agg(id ORDER BY movement_pattern,id) INTO ids FROM (
   SELECT DISTINCT ON (e.movement_pattern) e.id,e.movement_pattern
   FROM public.exercises e
   WHERE e.usable_for @> ARRAY['WOD']::text[] AND e.technical_complexity<=2
    AND NOT coalesce(e.warmup_only,false)
    AND public.exercise_environment_eligible_v1(e.id,env)
    AND public.exercise_equipment_compatible(e.id,'[]'::jsonb)
   ORDER BY e.movement_pattern,e.id LIMIT 6
  ) sample;
  IF cardinality(ids)<>6 THEN RAISE EXCEPTION 'QA needs six distinct low-tech patterns in %',env; END IF;
  FOREACH minutes IN ARRAY ARRAY[20,40,60,78] LOOP
   FOREACH n IN ARRAY ARRAY[2,3,4,6] LOOP
    SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY array_position(ids,id))
     INTO chosen FROM public.exercises WHERE id=ANY(ids[1:n]);
    FOREACH m IN ARRAY ARRAY['AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT'] LOOP
     r:=jsonb_build_object('environment',env,'minutes',minutes,'count',n,'mechanic',m,'ids',ids[1:n]);
     -- Per-case subtransaction keeps no active session between cases, including
     -- successful compiles. Variables survive the deliberate rollback.
     BEGIN
      draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
       'duration_minutes',90,'environment_code',env,'target_region','Full Body',
       'progression_intent','MAINTAIN','intent',jsonb_build_object('focus','General Fitness','key','GENERAL_FITNESS'),
       'mechanic',jsonb_build_object('key',m),'architecture',jsonb_build_object('key','legacy_qa',
       'blocks',jsonb_build_array(jsonb_build_object('type','WOD','label','WOD','minutes',minutes,'exercises',chosen))));
      preview:=public.week_composer_prescription_preview_v1(u,draft,'{}');
      r:=r||jsonb_build_object('preview_status',preview->>'status','preview_rounds',preview#>'{blocks,0,rounds}');
      INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
       planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
      VALUES(u,0,CURRENT_DATE,'available',90,'General Fitness','Full Body','MAINTAIN',
       jsonb_build_object('w11',jsonb_build_object('composer_draft',draft,
        'future_context',jsonb_build_object('surface_code',CASE WHEN env='OUTDOOR' THEN 'TRACK' ELSE 'INDOOR_FLOOR' END)))) RETURNING id INTO item;
      compiled:=public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,6,ARRAY['Aucune'],'{}',env);
      IF compiled->>'status'<>'READY' THEN RAISE EXCEPTION 'NOT_READY_%',compiled->>'status'; END IF;
      SELECT generated_workout#>'{blocks,0}' INTO STRICT block
       FROM public.workout_sessions WHERE id=(compiled->>'session_id')::uuid;
      candidate:=jsonb_build_object('mechanic',m,'exercises','[]'::jsonb);
      round_seconds:=0;
      FOR x IN SELECT value FROM jsonb_array_elements(block->'exercises') LOOP
       pres:=x->'prescription_json';
       -- C3 consumes ranges. Preserve the exact executed dose, including
       -- unilateral semantics, and map only scalar time/distance field names.
       pres:=pres||jsonb_strip_nulls(jsonb_build_object(
        'duration_seconds_min',pres->'duration_seconds','duration_seconds_max',pres->'duration_seconds',
        'distance_meters_min',pres->'distance_meters','distance_meters_max',pres->'distance_meters'));
       unit:=public.c3_unit_estimate(x->>'exercise_id',pres,'c3-sim-default');
       round_seconds:=round_seconds+(unit->>'estimated_active_work_seconds')::numeric
        +(unit->>'estimated_transition_seconds')::numeric;
       candidate:=jsonb_set(candidate,'{exercises}',candidate->'exercises'||jsonb_build_array(
        jsonb_build_object('exercise_id',x->>'exercise_id','name',x->>'name','prescription',pres)));
      END LOOP;
      rounds:=coalesce((block#>>'{mechanic_json,parameters,rounds}')::int,
       (block#>>'{mechanic_json,parameters,cycles}')::int);
      elapsed:=CASE WHEN m='FOR_TIME' THEN round_seconds*rounds
       WHEN m='CIRCUIT' THEN round_seconds*rounds+greatest(0,rounds-1)*45
       ELSE (block->>'duration_minutes')::numeric*60 END;
      r:=r||jsonb_build_object('compile_status',compiled->>'status','compiled_rounds',rounds,
       'compiled_minutes',block->'duration_minutes','compiled_parameters',block#>'{mechanic_json,parameters}',
       'round_seconds_c3',round_seconds,'elapsed_seconds_c3',elapsed,
       'elapsed_percent_of_budget',round(elapsed/(minutes*60)*100,2),
       'composition_contract',public.c4_mechanic_composition_contract(m));
      IF n=3 AND minutes IN (20,78) AND m IN ('FOR_TIME','CIRCUIT') THEN
       candidate:=candidate||jsonb_build_object('c4_runtime_context',jsonb_build_object(
        'user_id',u,'readiness','normal','progression_intent','MAINTAIN','focus','General Fitness'));
       c4:=public.c4_finalize_candidate(candidate,'{}',90,minutes);
       r:=r||jsonb_build_object('shared_c4_final',c4->'c4_final',
        'shared_workload',c4->'athlete_workload_contract');
      END IF;
      RAISE SQLSTATE 'Z0001' USING MESSAGE='QA_CASE_ROLLBACK';
     EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
      WHEN OTHERS THEN r:=r||jsonb_build_object('compile_status','REJECTED','error',SQLERRM);
     END;
     results:=results||jsonb_build_array(r);
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(results)<>320 THEN RAISE EXCEPTION 'INCOMPLETE_MATRIX'; END IF;
 PERFORM set_config('ugerod.qa_wod_dose',jsonb_build_object('cases',results,
  'elapsed_ms',extract(epoch from clock_timestamp()-started)*1000)::text,true);
END;
$audit$;
SELECT current_setting('ugerod.qa_wod_dose')::jsonb AS audit;
ROLLBACK;
