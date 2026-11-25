-- #34 safety characterization; all fixtures and compiled sessions roll back.
BEGIN;
SET LOCAL statement_timeout='30s';
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000934002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','qa-wod-safety@example.invalid',now(),now());
INSERT INTO public.profiles(id,weight) VALUES('00000000-0000-0000-0000-000000934002',80) ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000934002';
DO $qa$
DECLARE
 u uuid:='00000000-0000-0000-0000-000000934002';
 case_name text; readiness int; pain text[]; equipment text[]; ids text[]; bad_equipment text;
 pain_alias text; high_tech text; chosen jsonb; draft jsonb; item uuid; compiled jsonb;
 result jsonb; results jsonb:='[]'; dose jsonb; formats jsonb;
BEGIN
 SELECT array_agg(id ORDER BY id) INTO ids FROM (
  SELECT e.id FROM public.exercises e WHERE e.usable_for @> ARRAY['WOD']::text[]
   AND e.technical_complexity<=2 AND NOT coalesce(e.warmup_only,false)
   AND public.exercise_environment_eligible_v1(e.id,'HOME')
   AND public.exercise_equipment_compatible(e.id,'[]') ORDER BY e.id LIMIT 3
 ) sample;
 SELECT e.id INTO bad_equipment FROM public.exercises e
  WHERE e.usable_for @> ARRAY['WOD']::text[] AND public.exercise_environment_eligible_v1(e.id,'HOME')
   AND NOT public.exercise_equipment_compatible(e.id,'[]') ORDER BY e.id LIMIT 1;
 SELECT a.alias INTO pain_alias FROM public.exercise_body_zones z
  JOIN public.body_zone_aliases a ON a.body_zone_id=z.body_zone_id AND a.active
  WHERE z.exercise_id=ids[1] ORDER BY a.alias LIMIT 1;
 SELECT e.id INTO high_tech FROM public.exercises e WHERE e.technical_complexity>=4
  AND public.exercise_environment_eligible_v1(e.id,'HOME') ORDER BY e.id LIMIT 1;
 IF cardinality(ids)<>3 OR bad_equipment IS NULL OR pain_alias IS NULL OR high_tech IS NULL
  THEN RAISE EXCEPTION 'Missing safety fixtures'; END IF;
 FOREACH case_name IN ARRAY ARRAY['readiness_1','readiness_6','readiness_10','readiness_missing',
  'pain_missing','equipment_missing','equipment_incompatible','pain_conflict'] LOOP
  readiness:=CASE case_name WHEN 'readiness_1' THEN 1 WHEN 'readiness_10' THEN 10
   WHEN 'readiness_missing' THEN NULL ELSE 6 END;
  pain:=CASE case_name WHEN 'pain_missing' THEN NULL WHEN 'pain_conflict' THEN ARRAY[pain_alias] ELSE ARRAY['Aucune'] END;
  equipment:=CASE WHEN case_name='equipment_missing' THEN NULL ELSE '{}'::text[] END;
  SELECT jsonb_agg(jsonb_build_object('id',id,'name',e.name) ORDER BY id) INTO chosen
   FROM public.exercises e WHERE id=ANY(CASE WHEN case_name='equipment_incompatible'
    THEN ARRAY[ids[1],ids[2],bad_equipment] ELSE ids END);
  result:=jsonb_build_object('case',case_name);
  BEGIN
   draft:=jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
    'duration_minutes',60,'environment_code','HOME','target_region','Full Body',
    'progression_intent','MAINTAIN','intent',jsonb_build_object('focus','General Fitness'),
    'mechanic',jsonb_build_object('key','CIRCUIT'),'architecture',jsonb_build_object('blocks',
     jsonb_build_array(jsonb_build_object('type','WOD','minutes',20,'exercises',chosen))));
   INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
    planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
   VALUES(u,0,CURRENT_DATE,'available',60,'General Fitness','Full Body','MAINTAIN',
    jsonb_build_object('w11',jsonb_build_object('composer_draft',draft))) RETURNING id INTO item;
   compiled:=public.week_compile_composer_day_j_v1(u,item,CURRENT_DATE,readiness,pain,equipment,'HOME');
   SELECT generated_workout#>'{blocks,0}' INTO dose FROM public.workout_sessions WHERE id=(compiled->>'session_id')::uuid;
   result:=result||jsonb_build_object('status',compiled->>'status','parameters',dose#>'{mechanic_json,parameters}',
    'prescriptions',(SELECT jsonb_agg(value->'prescription_json' ORDER BY value->>'exercise_id') FROM jsonb_array_elements(dose->'exercises')));
   RAISE SQLSTATE 'Z0001' USING MESSAGE='QA_CASE_ROLLBACK';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
   WHEN OTHERS THEN result:=result||jsonb_build_object('status','REJECTED','error',SQLERRM); END;
  IF case_name LIKE 'readiness\_%' AND case_name<>'readiness_missing' THEN
   IF result->>'status'<>'READY' THEN RAISE EXCEPTION 'Baseline failed %',result; END IF;
  ELSIF result->>'status'<>'REJECTED' THEN RAISE EXCEPTION 'Missing safety rejection %',result; END IF;
  results:=results||jsonb_build_array(result);
 END LOOP;
 formats:=public.week_composer_mechanic_recommendations_v1(u,'HOME',20,ARRAY[ids[1],high_tech],'General Fitness');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(formats->'unavailable') x
  WHERE x->>'key'='HIIT' AND x->>'reason' LIKE 'Mouvements trop techniques%') THEN
  RAISE EXCEPTION 'High-tech HIIT was not blocked'; END IF;
 PERFORM set_config('ugerod.qa_wod_safety',jsonb_build_object('cases',results,'high_tech_hiit','BLOCKED')::text,true);
END;
$qa$;
SELECT current_setting('ugerod.qa_wod_safety')::jsonb AS audit;
ROLLBACK;
