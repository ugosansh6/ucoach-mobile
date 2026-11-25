BEGIN;
SET LOCAL statement_timeout='120s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000938002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-wod-context-v2@example.invalid',now(),now());
INSERT INTO profiles(id,weight,subscription_tier) VALUES('00000000-0000-0000-0000-000000938002',80,'FREE') ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000938002';
DO $qa$
DECLARE u uuid:=auth.uid(); env text; ready text; minutes int; n int; m text; ctx jsonb; r jsonb; ex jsonb;
 ids text[]:=ARRAY['EX033','EX006','EX406','EX084','EX104','EX048']; total int:=0; accepted int:=0; reasons jsonb:='{}';
 cat jsonb; chosen jsonb; rec jsonb; times jsonb:='[]'; t timestamptz;
BEGIN
 FOREACH env IN ARRAY ARRAY['HOME','BOX','GYM','OUTDOOR'] LOOP
  FOREACH ready IN ARRAY ARRAY['low','normal','high'] LOOP
   FOREACH minutes IN ARRAY ARRAY[20,40,60,78] LOOP
    FOREACH n IN ARRAY ARRAY[2,3,4,6] LOOP
     SELECT jsonb_agg(jsonb_build_object('id',id) ORDER BY ord) INTO chosen FROM unnest(ids[1:n]) WITH ORDINALITY q(id,ord);
     ctx:=jsonb_build_object('session_minutes',90,'block_minutes',minutes,'exercises',chosen,'environment_code',env,
      'equipment_names','[]'::jsonb,'focus','General Fitness','target_region','Full Body','readiness',ready);
     FOREACH m IN ARRAY ARRAY['AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT'] LOOP
      r:=public.week_composer_wod_authority_v2(u,ctx||jsonb_build_object('mechanic_key',m));
      total:=total+1;
      IF r->>'status'='READY' THEN
       accepted:=accepted+1;
       IF r#>>'{time,compiled_budget_minutes}'<>minutes::text THEN RAISE EXCEPTION 'Budget truncated'; END IF;
       IF r#>>'{candidate,c4_runtime_context,user_id}'<>u::text OR r#>>'{quality_gate,pass}'<>'true' THEN RAISE EXCEPTION 'Safety context missing'; END IF;
      ELSIF r->>'status'<>'NEEDS_RECOMPOSITION' THEN RAISE EXCEPTION 'Unhandled context'; END IF;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 IF total<>960 THEN RAISE EXCEPTION 'Incomplete context matrix'; END IF;
 cat:=public.week_composer_mechanic_catalog_v2(u);
 IF (SELECT count(*) FROM jsonb_array_elements(cat->'options') WHERE (value->>'entitled')::boolean)<>6 THEN RAISE EXCEPTION 'Free rights changed'; END IF;
 ctx:=jsonb_build_object('session_minutes',60,'block_minutes',12,'exercises',jsonb_build_array(jsonb_build_object('id','EX033'),jsonb_build_object('id','EX006')),
  'environment_code','HOME','focus','General Fitness','target_region','Full Body');
 IF public.week_composer_wod_authority_v2(u,ctx||'{"mechanic_key":"COUPLET"}')->>'reason'<>'PREMIUM_REQUIRED' THEN RAISE EXCEPTION 'Premium bypass'; END IF;
 IF public.week_composer_wod_authority_v2(u,ctx||'{"mechanic_key":"AMRAP","exercises":[{"id":"EX015"},{"id":"EX033"}],"equipment_names":[]}')->>'reason'<>'EXERCISE_INCOMPATIBLE' THEN RAISE EXCEPTION 'Equipment not guarded'; END IF;
 -- Normalized pain and authentication use existing backend gates.
 SELECT jsonb_build_array(jsonb_build_object('id',e.id),jsonb_build_object('id','EX033')) INTO ex FROM exercises e
 WHERE NOT public.exercise_safe_for_zones(e.id,public.normalize_body_zone_ids(ARRAY['Genou'])) AND public.exercise_environment_eligible_v1(e.id,'HOME') LIMIT 1;
 IF ex IS NULL THEN RAISE EXCEPTION 'Missing pain fixture'; END IF;
 IF public.week_composer_wod_authority_v2(u,ctx||jsonb_build_object('mechanic_key','AMRAP','exercises',ex,'pain_zones',jsonb_build_array('Genou')))->>'reason'<>'EXERCISE_INCOMPATIBLE' THEN RAISE EXCEPTION 'Pain not guarded'; END IF;
 BEGIN
  PERFORM public.week_composer_mechanic_catalog_v2('00000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'Identity bypass';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOREACH minutes IN ARRAY ARRAY[8,12,17,22,40,60,78] LOOP
  t:=clock_timestamp();
  rec:=public.week_composer_mechanic_recommendations_v2(u,ctx||jsonb_build_object('block_minutes',minutes,'session_minutes',90));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'options') o WHERE (o->>'premium')::boolean) THEN RAISE EXCEPTION 'Free gets Premium choice'; END IF;
  IF jsonb_array_length(rec->'options')>0 AND (SELECT count(*) FROM jsonb_array_elements(rec->'options') WHERE (value->>'recommended')::boolean)<>1 THEN RAISE EXCEPTION 'Invalid primary recommendation'; END IF;
  times:=times||jsonb_build_array(jsonb_build_object('minutes',minutes,'seconds',extract(epoch FROM clock_timestamp()-t),
    'options',jsonb_array_length(rec->'options'),'unavailable',jsonb_array_length(rec->'unavailable')));
 END LOOP;
 PERFORM set_config('ugerod.qa_wod_context',jsonb_build_object('cases',total,'accepted',accepted,'rejected',total-accepted,
  'free_catalogue',6,'guards','PASS','timings',times)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_wod_context')::jsonb AS audit;
ROLLBACK;
