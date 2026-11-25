-- #37: catalogue + existing C4 preparation/finalization and W11 compile gates.
-- This is not device E2E, not Today generation coverage, not an activation.
BEGIN;
SET LOCAL statement_timeout='90s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000937001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','qa-advanced-mechanics@example.invalid',now(),now());
INSERT INTO public.profiles(id,weight) VALUES('00000000-0000-0000-0000-000000937001',80)
 ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000937001';
DO $audit$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000937001';
 tier text; spec record; contract jsonb; ids text[]; n int; chosen jsonb; ex jsonb;
 candidate jsonb; solver jsonb; prepared jsonb; finalized jsonb; draft jsonb;
 item uuid; compiled jsonb; preview jsonb; r jsonb; results jsonb:='[]';
BEGIN
 SELECT array_agg(id ORDER BY id) INTO ids FROM (
  SELECT e.id FROM public.exercises e
  WHERE e.usable_for @> ARRAY['WOD']::text[] AND e.technical_complexity<=2
   AND e.tracking_modes @> ARRAY['reps']::text[] AND NOT coalesce(e.warmup_only,false)
   AND public.exercise_environment_eligible_v1(e.id,'HOME')
   AND public.exercise_equipment_compatible(e.id,'[]'::jsonb)
  ORDER BY e.id LIMIT 8
 ) sample;
 IF cardinality(ids)<>8 THEN RAISE EXCEPTION 'Missing synthetic catalogue sample'; END IF;
 FOREACH tier IN ARRAY ARRAY['FREE','PREMIUM'] LOOP
  -- Administrative fixture setup only, before impersonating the athlete.
  -- The normal client is forbidden from changing this server-managed field.
  PERFORM set_config('request.jwt.claim.sub','',true);
  UPDATE public.profiles SET subscription_tier=tier WHERE id=u;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  FOR spec IN
   SELECT m.mechanic_key,NULL::text variant_key FROM public.workout_mechanics m
    WHERE m.active AND m.mechanic_kind='core'
   UNION ALL SELECT v.mechanic_key,v.variant_key FROM public.workout_mechanic_variants v WHERE v.active
  LOOP
   contract:=public.c4_mechanic_composition_contract(spec.mechanic_key,spec.variant_key);
   n:=coalesce((contract->>'target_exercises')::int,3);
   SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) INTO chosen
    FROM public.exercises WHERE id=ANY(ids[1:n]);
   candidate:=jsonb_build_object('mechanic',spec.mechanic_key,'variant_key',spec.variant_key,
    'exercises','[]'::jsonb,'c4_runtime_context',jsonb_build_object('user_id',u,
      'readiness','normal','progression_intent','MAINTAIN','focus','General Fitness'));
   r:=jsonb_build_object('tier',tier,'mechanic',spec.mechanic_key,'variant',spec.variant_key,
    'contract',contract,'count',n);
   BEGIN
    FOR ex IN SELECT value FROM jsonb_array_elements(chosen) LOOP
     solver:=public.c2_solver_prescription(u,ex->>'id','{}',spec.mechanic_key,'MAINTAIN','[]');
     candidate:=jsonb_set(candidate,'{exercises}',candidate->'exercises'||jsonb_build_array(
      jsonb_build_object('exercise_id',ex->>'id','name',ex->>'name','prescription',solver)));
    END LOOP;
    prepared:=public.c4_prepare_candidate(candidate,'c4-final-default');
    finalized:=public.c4_finalize_candidate(prepared,'{}',60,20);
    r:=r||jsonb_build_object('c4_status',finalized#>>'{c4_final,status}',
     'c4_feasible',finalized#>'{c4_final,feasible}',
     'parameters',finalized#>'{c4_final,mechanic_json,parameters}',
     'workload_pass',finalized#>'{athlete_workload_contract,pass}');
   EXCEPTION WHEN OTHERS THEN r:=r||jsonb_build_object('c4_error',SQLERRM); END;
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',60,
    'environment_code','HOME','target_region','Full Body','progression_intent','MAINTAIN',
    'intent',jsonb_build_object('focus','General Fitness','key','GENERAL_FITNESS'),
    'mechanic',jsonb_build_object('key',spec.mechanic_key,'variant_key',spec.variant_key),
    'architecture',jsonb_build_object('key','legacy_qa','blocks',jsonb_build_array(
     jsonb_build_object('type','WOD','minutes',20,'exercises',chosen))));
   BEGIN
    preview:=public.week_composer_prescription_preview_v1(u,draft,'{}');
    r:=r||jsonb_build_object('preview_status',preview->>'status');
   EXCEPTION WHEN OTHERS THEN r:=r||jsonb_build_object('preview_error',SQLERRM); END;
   BEGIN
    INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
     planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
    VALUES(u,0,CURRENT_DATE,'available',60,'General Fitness','Full Body','MAINTAIN',
     jsonb_build_object('w11',jsonb_build_object('composer_draft',draft))) RETURNING id INTO item;
    compiled:=public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,6,ARRAY['Aucune'],'{}','HOME');
    r:=r||jsonb_build_object('w11_status',compiled->>'status');
    RAISE SQLSTATE 'Z0001' USING MESSAGE='QA_CASE_ROLLBACK';
   EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    WHEN OTHERS THEN r:=r||jsonb_build_object('w11_error',SQLERRM); END;
   results:=results||jsonb_build_array(r);
  END LOOP;
 END LOOP;
 IF jsonb_array_length(results)<>40 THEN RAISE EXCEPTION 'INCOMPLETE_ADVANCED_MATRIX'; END IF;
 PERFORM set_config('ugerod.qa_advanced_mechanics',results::text,true);
END;
$audit$;
SELECT jsonb_build_object('cases',current_setting('ugerod.qa_advanced_mechanics')::jsonb,
 'catalog',(SELECT jsonb_agg(to_jsonb(m)-'notes') FROM public.workout_mechanics m),
 'variants',(SELECT jsonb_agg(to_jsonb(v)-'notes') FROM public.workout_mechanic_variants v)) AS audit;
ROLLBACK;
