-- #29 / DEV ONLY. Three executable Composer scenarios in one ROLLBACK:
-- HOME 20 min Technical solo, HOME 60 & 90 min long Conditioning WOD.
-- No permanent users, sessions, completed actuals or workout history.
BEGIN;
SET LOCAL statement_timeout = '50000ms';
DO $qa$
DECLARE
 i integer; athlete uuid; item_id uuid; duration int; warm int;
 main_minutes int; kind text; blocks jsonb; draft jsonb; p jsonb; c jsonb;
 observed text[]; results jsonb:='[]'::jsonb;
BEGIN
 FOR i IN 1..3 LOOP
  athlete:=CASE i WHEN 1 THEN '00000000-0000-0000-0000-000000009461'::uuid
   WHEN 2 THEN '00000000-0000-0000-0000-000000009462'::uuid
   ELSE '00000000-0000-0000-0000-000000009463'::uuid END;
  PERFORM set_config('request.jwt.claim.sub',athlete::text,true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES(athlete,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'qa-intent-test-'||i||'@example.invalid',now(),now());
  INSERT INTO public.profiles(id) VALUES(athlete) ON CONFLICT DO NOTHING;
  duration:=CASE i WHEN 1 THEN 20 WHEN 2 THEN 60 ELSE 90 END;
  warm:=CASE i WHEN 1 THEN 5 WHEN 2 THEN 6 ELSE 7 END;
  main_minutes:=duration-warm-CASE WHEN duration<=30 THEN 3 ELSE 5 END;
  kind:=CASE WHEN i=1 THEN 'SKILL' ELSE 'WOD' END;
  blocks:=jsonb_build_array(
    jsonb_build_object('type','WARMUP','minutes',warm,
       'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
    jsonb_build_object('type',kind,'minutes',main_minutes,
       'exercises',jsonb_build_array(jsonb_build_object(
          'id',CASE WHEN i=1 THEN 'EX087' ELSE 'EX539' END)))
  );
  draft:=jsonb_build_object(
    'version','w11-composer-draft-v1','structure_stable',true,'duration_minutes',duration,
    'environment_code','HOME','target_region','Full Body','progression_intent','MAINTAIN',
    'intent',jsonb_build_object('key',CASE WHEN i=1 THEN 'TECHNIQUE' ELSE 'CONDITIONING' END,
      'focus',CASE WHEN i=1 THEN 'General Fitness' ELSE 'Conditioning' END),
    'mechanic',CASE WHEN i=1 THEN 'null'::jsonb ELSE jsonb_build_object('key','AMRAP') END,
    'architecture',jsonb_build_object('key',CASE WHEN i=1 THEN 'technique' ELSE 'conditioning' END,
      'blocks',blocks)
  );
  INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
    planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
  VALUES (athlete,0,current_date,'available',duration,
    CASE WHEN i=1 THEN 'General Fitness' ELSE 'Conditioning' END,
    'Full Body','MAINTAIN',jsonb_build_object('w11','{}'::jsonb))
  RETURNING id INTO item_id;
  PERFORM public.week_save_composer_draft_v1(athlete,item_id,draft);
  p:=public.week_composer_prescription_preview_v1(athlete,draft,'{}'::text[]);
  IF p->>'status'<>'PREVIEW' THEN RAISE EXCEPTION 'CASE_%_PREVIEW: %',i,p; END IF;
  c:=public.week_compile_composer_day_j_v1(athlete,item_id,current_date,6,
       ARRAY['Aucune']::text[],'{}'::text[],'HOME');
  IF c->>'status'<>'READY' THEN RAISE EXCEPTION 'CASE_%_COMPILER: %',i,c; END IF;
  SELECT array_agg(b.block->>'block_key' ORDER BY b.ordinal) INTO observed
  FROM public.workout_sessions s,
       jsonb_array_elements(s.generated_workout->'blocks') WITH ORDINALITY b(block,ordinal)
  WHERE s.id=(c->>'session_id')::uuid;
  IF (i=1 AND array_to_string(observed,',')<>'warm_up,skill')
    OR (i>1 AND array_to_string(observed,',')<>'warm_up,wod') THEN
     RAISE EXCEPTION 'CASE_%_UNEXPECTED_BLOCKS:%',i,observed;
  END IF;
  results:=results||jsonb_build_array(jsonb_build_object('duration',duration,
   'main',kind,'main_minutes',main_minutes,'preview','PASS','compile','READY',
   'blocks',observed,'no_injected_tabata',true));
 END LOOP;
 PERFORM set_config('ugerod.qa_intent_matrix_dayj',jsonb_build_object(
  'status','PASS','cases',results)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_intent_matrix_dayj')::jsonb result;
ROLLBACK;
