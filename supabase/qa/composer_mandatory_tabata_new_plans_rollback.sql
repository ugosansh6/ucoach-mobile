-- #31, DEV only. New Composer proposals with mandatory Tabata:
-- 20-min Technique and 30-min Technique+WOD, with all writes rolled back.
BEGIN;
SET LOCAL statement_timeout='90000ms';
DO $qa$
DECLARE
 i int; athlete uuid; duration int; plan_id uuid; blocks jsonb; draft jsonb;
 preview jsonb; compiled jsonb; keys text[]; results jsonb:='[]';
BEGIN
 FOR i IN 1..2 LOOP
  athlete:=CASE WHEN i=1 THEN '00000000-0000-0000-0000-000000009771'::uuid
                 ELSE '00000000-0000-0000-0000-000000009772'::uuid END;
  duration:=CASE WHEN i=1 THEN 20 ELSE 30 END;
  PERFORM set_config('request.jwt.claim.sub',athlete::text,true);
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES(athlete,'00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','qa-composer-tabata-new-'||i||'@example.invalid',now(),now());
  INSERT INTO public.profiles(id) VALUES(athlete) ON CONFLICT DO NOTHING;
  blocks:=jsonb_build_array(
   jsonb_build_object('type','WARMUP','minutes',5,
      'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
   jsonb_build_object('type','TABATA','minutes',4,
      'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
   jsonb_build_object('type','SKILL','minutes',CASE WHEN i=1 THEN 8 ELSE 9 END,
      'exercises',jsonb_build_array(jsonb_build_object('id','EX087')))
  );
  IF i=2 THEN
   blocks:=blocks||jsonb_build_array(jsonb_build_object('type','WOD','minutes',9,
    'exercises',jsonb_build_array(
      jsonb_build_object('id','EX006'),
      jsonb_build_object('id','EX539'))));
  END IF;
  draft:=jsonb_build_object(
    'version','w11-composer-draft-v1','structure_stable',true,
    'duration_minutes',duration,'environment_code','HOME',
    'target_region','Full Body','progression_intent','MAINTAIN',
    'intent',jsonb_build_object('key','TECHNIQUE','focus','General Fitness'),
    'mechanic',CASE WHEN i=2 THEN jsonb_build_object('key','AMRAP') ELSE 'null'::jsonb END,
    'architecture',jsonb_build_object('key','technique','blocks',blocks));
  INSERT INTO public.user_training_plan_items(
    user_id,sequence_index,recommended_date,status,planned_duration_minutes,
    planned_focus,planned_target_region,planned_progression_intent,planning_context_json
  ) VALUES(athlete,0,current_date,'available',duration,'General Fitness','Full Body',
    'MAINTAIN',jsonb_build_object('w11','{}'::jsonb))
  RETURNING id INTO plan_id;
  PERFORM public.week_save_composer_draft_v1(athlete,plan_id,draft);
  preview:=public.week_composer_prescription_preview_v1(athlete,draft,'{}'::text[]);
  IF preview->>'status'<>'PREVIEW' THEN
    RAISE EXCEPTION 'PREVIEW_%: %',i,preview;
  END IF;
  compiled:=public.week_compile_composer_day_j_v1(
     athlete,plan_id,current_date,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
  IF compiled->>'status'<>'READY' THEN
    RAISE EXCEPTION 'DAYJ_%: %',i,compiled;
  END IF;
  SELECT array_agg(b.block->>'block_key' ORDER BY b.ordinal) INTO keys
  FROM public.workout_sessions s,
     jsonb_array_elements(s.generated_workout->'blocks') WITH ORDINALITY AS b(block,ordinal)
  WHERE s.id=(compiled->>'session_id')::uuid;
  IF (i=1 AND keys IS DISTINCT FROM ARRAY['warm_up','tabata','skill']::text[])
    OR (i=2 AND keys IS DISTINCT FROM ARRAY['warm_up','tabata','skill','wod']::text[]) THEN
    RAISE EXCEPTION 'DAYJ_BLOCK_ORDER_%:%',i,keys;
  END IF;
  results:=results||jsonb_build_array(jsonb_build_object(
    'duration',duration,'blocks',keys,'preview','PASS','compile','READY'));
 END LOOP;
 PERFORM set_config('ugerod.qa_mec_tabata_new',
   jsonb_build_object('status','PASS','cases',results)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_mec_tabata_new')::jsonb result;
ROLLBACK;
