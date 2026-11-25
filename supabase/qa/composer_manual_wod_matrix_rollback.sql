-- End-to-end database contract; synthetic user only, every session rolled back.
BEGIN;
SET LOCAL statement_timeout='120s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000938001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-shared-wod-v2@example.invalid',now(),now());
INSERT INTO profiles(id,weight,subscription_tier,experience) VALUES('00000000-0000-0000-0000-000000938001',80,'PREMIUM','advanced') ON CONFLICT(id) DO UPDATE SET subscription_tier='PREMIUM',experience='advanced';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000938001';
DO $qa$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000938001'; s jsonb; ids text[]:=ARRAY['EX033','EX006','EX406','EX084','EX104','EX048','EX148'];
 chosen jsonb; draft jsonb; preview jsonb; compiled jsonb; b jsonb; x jsonb; stored jsonb; item uuid; sid uuid;
 minutes int; n int; accepted int:=0; rejected int:=0; results jsonb:='[]'; rec jsonb; started timestamptz; elapsed numeric; examples jsonb:='{}';
BEGIN
 FOREACH minutes IN ARRAY ARRAY[17] LOOP
  FOR s IN SELECT value FROM jsonb_array_elements(public.week_composer_mechanic_catalog_v2(u)->'options') LOOP
   n:=(s#>>'{contract,target_exercises}')::int;
   SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) ORDER BY ord) INTO chosen
    FROM unnest(ids[1:n]) WITH ORDINALITY q(id,ord) JOIN exercises e ON e.id=q.id;
   if s->>'key'='PROGRESSIVE_INTERVAL' and coalesce(s->>'variant_key','')<>'DEATH_BY' then
    SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) ORDER BY ord) INTO chosen
    FROM unnest((ARRAY['EX148','EX150','EX149'])[1:n]) WITH ORDINALITY q(id,ord) JOIN exercises e ON e.id=q.id;
   end if;
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
    'wod_engine_version','C4_COMPOSER_V2','duration_minutes',90,'environment_code','HOME','target_region','Full Body',
    'progression_intent','MAINTAIN','intent',jsonb_build_object('focus','General Fitness'),
    'mechanic',jsonb_build_object('key',s->>'key','variant_key',s->>'variant_key'),
    'architecture',jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object('type','WOD','minutes',minutes,'exercises',chosen))));
   preview:=public.week_composer_prescription_preview_v1(u,draft,'{}');
   IF preview->>'status'='PREVIEW' AND s->>'key'<>'DECK' THEN
    draft:=jsonb_set(draft,'{architecture,blocks,0,manual_parameters}',CASE s->>'key'
      WHEN 'AMRAP' THEN '{"duration_minutes":21}'::jsonb
      WHEN 'FOR_TIME' THEN jsonb_build_object('rounds',(preview#>>'{blocks,0,parameters,rounds}')::numeric::int+1,'cap_seconds',1320)
      WHEN 'CIRCUIT' THEN jsonb_build_object('rounds',(preview#>>'{blocks,0,parameters,rounds}')::numeric::int+1)
      WHEN 'HIIT' THEN jsonb_build_object('rounds',(preview#>>'{blocks,0,parameters,rounds}')::numeric::int+1)
      WHEN 'SETS_REPS' THEN jsonb_build_object('sets',(preview#>>'{blocks,0,parameters,sets}')::numeric::int+1)
      WHEN 'LADDER' THEN jsonb_build_object('rungs',(preview#>>'{blocks,0,parameters,rungs}')::numeric::int+1)
      WHEN 'COUPLET' THEN jsonb_build_object('rungs',(preview#>>'{blocks,0,parameters,rungs}')::numeric::int+1)
      WHEN 'PROGRESSIVE_INTERVAL' THEN '{"time_limit_seconds":1200}'::jsonb
      WHEN 'EMOM' THEN jsonb_build_object('cycles',(preview#>>'{blocks,0,parameters,cycles}')::numeric::int+1)
      WHEN 'PYRAMID' THEN jsonb_build_object('cycles',(preview#>>'{blocks,0,parameters,cycles}')::numeric::int+1)
      WHEN 'ODD_EVEN' THEN jsonb_build_object('cycles',(preview#>>'{blocks,0,parameters,cycles}')::numeric::int+1)
      WHEN 'EVERY_X_MINUTES' THEN jsonb_build_object('cycles',(preview#>>'{blocks,0,parameters,cycles}')::numeric::int+1)
      ELSE '{}'::jsonb END,true);
    IF s->>'key'<>'HIIT' THEN
      draft:=jsonb_set(draft,'{architecture,blocks,0,exercises,0,manual_dose}',jsonb_build_object('reps',greatest(1,coalesce((preview#>>'{blocks,0,exercises,0,prescription_json,mechanic_overlay,base_reps}')::numeric::int,(preview#>>'{blocks,0,exercises,0,prescription_json,mechanic_overlay,start_reps}')::numeric::int,(preview#>>'{blocks,0,exercises,0,reps}')::numeric::int)-1)),true);
    END IF;
    BEGIN
     preview:=public.week_composer_prescription_preview_v1(u,draft,'{}');
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Manual preview failed %:% %',s->>'key',s->>'variant_key',SQLERRM; END;
    IF preview->>'status'<>'PREVIEW' THEN RAISE EXCEPTION 'Manual preview rejected %',s->>'key'; END IF;
   END IF;
   BEGIN
    INSERT INTO user_training_plan_items(user_id,sequence_index,recommended_date,status,planned_duration_minutes,planned_focus,
     planned_target_region,planned_progression_intent,planning_context_json) VALUES(u,0,CURRENT_DATE,'available',90,'General Fitness','Full Body','MAINTAIN',
      jsonb_build_object('w11',jsonb_build_object('composer_draft',draft))) RETURNING id INTO item;
    IF preview->>'status'='PREVIEW' THEN
     compiled:=public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,6,ARRAY['Aucune'],'{}','HOME');
     IF compiled->>'status'<>'READY' THEN RAISE EXCEPTION 'Expected READY: %',compiled; END IF;
     sid:=(compiled->>'session_id')::uuid;
     SELECT value INTO b FROM workout_sessions ws CROSS JOIN LATERAL jsonb_array_elements(ws.generated_workout->'blocks')
      WHERE ws.id=sid AND value->>'block_key'='wod';
     IF EXISTS(SELECT 1 FROM jsonb_each(preview#>'{blocks,0,parameters}') q WHERE q.value IS DISTINCT FROM b#>'{mechanic_json,parameters}'->q.key) THEN RAISE EXCEPTION 'Parameters differ for %: % / %',s,preview#>'{blocks,0,parameters}',b#>'{mechanic_json,parameters}'; END IF;
     IF b->>'duration_minutes'<>minutes::text THEN RAISE EXCEPTION 'User budget changed'; END IF;
     IF coalesce(b#>>'{mechanic_json,variant_key}','')<>coalesce(s->>'variant_key','') THEN RAISE EXCEPTION 'Variant lost'; END IF;
     FOR x IN SELECT value FROM jsonb_array_elements(preview#>'{blocks,0,exercises}') LOOP
      SELECT prescription_json INTO stored FROM workout_session_exercises WHERE session_id=sid AND exercise_id=x->>'id';
      IF stored-'block_parameters' IS DISTINCT FROM ((x->'prescription_json')-'block_parameters') THEN RAISE EXCEPTION 'Dose differs for %',x->>'id'; END IF;
     END LOOP;
     IF s->>'key'='DECK' AND (jsonb_array_length(b#>'{mechanic_json,parameters,deck_order}')<>(b#>>'{mechanic_json,parameters,cards}')::int
       OR b#>>'{mechanic_json,parameters,safe_random_draw}'<>'true') THEN RAISE EXCEPTION 'Deck not executable'; END IF;
     -- Repeat compilation is idempotent and never regenerates a draw/dose.
     IF public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,6,ARRAY['Aucune'],'{}','HOME')->>'status'<>'ALREADY_READY' THEN RAISE EXCEPTION 'Not idempotent'; END IF;
     if not examples ? (s->>'key'||':'||coalesce(s->>'variant_key','')) then
      examples:=examples||jsonb_build_object(s->>'key'||':'||coalesce(s->>'variant_key',''),b);
     end if;
     accepted:=accepted+1;
     results:=results||jsonb_build_array(jsonb_build_object('mechanic',s->>'key','variant',s->>'variant_key','minutes',minutes,'status','READY',
       'parameters',preview#>'{blocks,0,parameters}','time',preview#>'{blocks,0,time}'));
    ELSE
     BEGIN
      compiled:=public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,6,ARRAY['Aucune'],'{}','HOME');
      RAISE EXCEPTION 'Rejected preview was compiled: %',s;
     EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE 'COMPOSER_WOD_RECOMPOSITION_REQUIRED_%' THEN RAISE; END IF;
     END;
     rejected:=rejected+1;
     results:=results||jsonb_build_array(jsonb_build_object('mechanic',s->>'key','variant',s->>'variant_key','minutes',minutes,
       'status','REJECTED','reasons',preview->'reasons'));
    END IF;
    RAISE SQLSTATE 'Z0001' USING MESSAGE='ROLLBACK_SYNTHETIC_SESSION';
   EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL; END;
  END LOOP;
 END LOOP;
 -- All real recommendations must be previewable; one recommendation, no fabricated score table.
 started:=clock_timestamp();
 rec:=public.week_composer_mechanic_recommendations_v2(u,jsonb_build_object('session_minutes',60,'block_minutes',17,'environment_code','HOME',
  'focus','General Fitness','target_region','Full Body','equipment_names','[]'::jsonb,'exercises',
  jsonb_build_array(jsonb_build_object('id','EX033'),jsonb_build_object('id','EX006'),jsonb_build_object('id','EX406'))));
 elapsed:=extract(epoch FROM clock_timestamp()-started);
 IF (SELECT count(*) FROM jsonb_array_elements(rec->'options') WHERE (value->>'recommended')::boolean)<>1 THEN RAISE EXCEPTION 'Missing/duplicate recommendation: %',rec; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'options') WHERE value#>>'{protocol,status}'<>'READY') THEN RAISE EXCEPTION 'False recommendation'; END IF;
 IF accepted+rejected<>20 THEN RAISE EXCEPTION 'Incomplete matrix'; END IF;
 PERFORM set_config('ugerod.qa_shared_wod',jsonb_build_object('accepted',accepted,'rejected',rejected,'cases',results,
  'examples',examples,'recommendation_seconds',elapsed,'recommendations',rec)::text,true);
END $qa$;
WITH a AS (SELECT current_setting('ugerod.qa_shared_wod')::jsonb x) SELECT x->'accepted' accepted,x->'rejected' rejected, (SELECT jsonb_agg(jsonb_build_object('mechanic',c->>'mechanic','variant',c->>'variant','advisories',c#>'{time,advisories}','seconds',c#>'{time,prescribed_seconds}')) FROM jsonb_array_elements(x->'cases') c) cases FROM a;
ROLLBACK;
