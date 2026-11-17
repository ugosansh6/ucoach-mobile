-- W11 Composer: a user-owned custom structure is preserved end to end.
-- DEV-only QA with two synthetic users; one transaction, no persistent writes.
BEGIN;
SET LOCAL statement_timeout='100000ms';
DO $qa$
DECLARE
 i int; athlete uuid; plan_id uuid; blocks jsonb; draft jsonb;
 preview jsonb; compile_result jsonb; stored jsonb; actual text[];
BEGIN
 FOR i IN 1..2 LOOP
   athlete:=CASE WHEN i=1 THEN '00000000-0000-0000-0000-000000009444'::uuid
                 ELSE '00000000-0000-0000-0000-000000009445'::uuid END;
   PERFORM set_config('request.jwt.claim.sub',athlete::text,true);
   INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
   VALUES(athlete,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          'qa-composer-custom-'||i||'@example.invalid',now(),now());
   INSERT INTO public.profiles(id) VALUES(athlete) ON CONFLICT DO NOTHING;
   blocks:=jsonb_build_array(
     jsonb_build_object('type','WARMUP','minutes',7,'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
     jsonb_build_object('type','TABATA','minutes',4,'exercises',jsonb_build_array(jsonb_build_object('id','EX087')))
   );
   IF i=1 THEN
     blocks:=blocks || jsonb_build_array(
       jsonb_build_object('type','WOD','minutes',11,'exercises',jsonb_build_array(jsonb_build_object('id','EX539'))),
       jsonb_build_object('type','SKILL','minutes',12,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
       jsonb_build_object('type','STRENGTH','minutes',21,'exercises',
         jsonb_build_array(jsonb_build_object('id','EX006'),jsonb_build_object('id','EX033')))
     );
   ELSE
     blocks:=blocks || jsonb_build_array(
       jsonb_build_object('type','SKILL','minutes',44,'exercises',jsonb_build_array(jsonb_build_object('id','EX087')))
     );
   END IF;
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
     'duration_minutes',60,'environment_code','HOME','target_region','Full Body',
     'progression_intent','MAINTAIN','intent',jsonb_build_object('key','TECHNIQUE','focus','General Fitness'),
     'mechanic',CASE WHEN i=1 THEN jsonb_build_object('key','AMRAP') ELSE 'null'::jsonb END,
     'architecture',jsonb_build_object('key','custom','title','Structure personnalisée','blocks',blocks));
   INSERT INTO public.user_training_plan_items(
     user_id,sequence_index,recommended_date,status,planned_duration_minutes,
     planned_focus,planned_target_region,planned_progression_intent,planning_context_json
   ) VALUES(
     athlete,0,current_date,'available',60,'General Fitness','Full Body','MAINTAIN',
     jsonb_build_object('w11','{}'::jsonb)
   ) RETURNING user_training_plan_items.id INTO plan_id;

   PERFORM public.week_save_composer_draft_v1(athlete,plan_id,draft);
   SELECT planning_context_json#>'{w11,composer_draft,architecture,blocks}'
   INTO stored FROM public.user_training_plan_items WHERE id=plan_id;
   IF stored IS DISTINCT FROM blocks THEN RAISE EXCEPTION 'CUSTOM_DRAFT_ORDER_CHANGED_%',i; END IF;

   preview:=public.week_composer_prescription_preview_v1(athlete,draft,'{}'::text[]);
   IF preview->>'status'<>'PREVIEW' THEN RAISE EXCEPTION 'PREVIEW_FAILED_%: %',i,preview; END IF;
   compile_result:=public.week_compile_composer_day_j_v1(
     athlete,plan_id,current_date,6,ARRAY['Aucune']::text[],'{}'::text[],'HOME');
   IF compile_result->>'status'<>'READY' THEN
     RAISE EXCEPTION 'COMPILE_FAILED_%: %',i,compile_result;
   END IF;
   SELECT array_agg(b.block->>'block_key' ORDER BY b.ordinal) INTO actual
   FROM public.workout_sessions s,
       jsonb_array_elements(s.generated_workout->'blocks') WITH ORDINALITY AS b(block,ordinal)
   WHERE s.id=(compile_result->>'session_id')::uuid;
   IF i=1 AND actual IS DISTINCT FROM ARRAY['warm_up','tabata','wod','skill','strength']::text[] THEN
     RAISE EXCEPTION 'CUSTOM_REORDER_NOT_PRESERVED: %',actual;
   END IF;
   IF i=2 AND actual IS DISTINCT FROM ARRAY['warm_up','tabata','skill']::text[] THEN
     RAISE EXCEPTION 'CUSTOM_SKILL_ONLY_NOT_PRESERVED: %',actual;
   END IF;
   IF NOT EXISTS (
     SELECT 1 FROM public.workout_sessions
     WHERE id=(compile_result->>'session_id')::uuid
       AND generated_workout#>>'{meta,source}'='w11_composer'
   ) THEN RAISE EXCEPTION 'CUSTOM_SOURCE_LOST'; END IF;
 END LOOP;
 PERFORM set_config('ugerod.qa_custom_architecture',jsonb_build_object(
   'status','PASS','cases',2,'draft_roundtrip',true,
   'C2_preview',true,'dayj_READY',true,'author_order_preserved',true,
   'tabata_preserved',true)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_custom_architecture')::jsonb AS result;
ROLLBACK;
