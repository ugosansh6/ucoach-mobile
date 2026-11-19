-- #41 transport only: these explicit synthetic blocks do not demonstrate that
-- #42 consumes multi-zone preferences or #43 composes a target Skill lesson.
-- No DDL, no real athlete, no committed fixtures.
BEGIN;
DO $qa$
DECLARE
  athlete uuid; plan_id uuid; session_id uuid; draft jsonb; prefs jsonb;
  saved jsonb; reread jsonb; preview jsonb; compiled jsonb; again jsonb;
  actual jsonb; results jsonb := '[]'::jsonb; i integer;
BEGIN
  FOR i IN 1..4 LOOP
    athlete := ('00000000-0000-0000-0000-00009414100' || i)::uuid;
    PERFORM set_config('request.jwt.claim.sub','',true);
    INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    VALUES(athlete,'00000000-0000-0000-0000-000000000000','authenticated',
      'authenticated','qa-composer-preferences-' || i || '@example.invalid',now(),now());
    INSERT INTO public.profiles(id,weight,experience) VALUES(athlete,80,'advanced')
      ON CONFLICT(id) DO UPDATE SET weight=80,experience='advanced';
    PERFORM set_config('request.jwt.claim.sub',athlete::text,true);
    prefs := CASE i
      WHEN 1 THEN NULL
      WHEN 2 THEN jsonb_build_object('version','composer-preferences-v1',
        'preferred_regions',jsonb_build_array('Back','Lower'),'skill_target_path_key',NULL)
      WHEN 3 THEN jsonb_build_object('version','composer-preferences-v1',
        'preferred_regions',jsonb_build_array('Upper','Core'),'skill_target_path_key','HANDSTAND_HSPU')
      ELSE jsonb_build_object('version','composer-preferences-v1',
        'preferred_regions','[]'::jsonb,'skill_target_path_key','PULL_UP_MUSCLE_UP') END;
    draft := jsonb_build_object('version','w11-composer-draft-v1','structure_stable',true,
      'duration_minutes',20,'environment_code',CASE WHEN i%2=0 THEN 'BOX' ELSE 'HOME' END,
      'target_region',CASE WHEN i=1 THEN 'Upper' ELSE NULL END,
      'progression_intent','MAINTAIN',
      'intent',jsonb_build_object('key',CASE WHEN i=4 THEN 'TECHNIQUE' ELSE 'STRENGTH' END,
        'focus',CASE WHEN i=4 THEN 'General Fitness' ELSE 'Strength' END),
      'architecture',jsonb_build_object('key','explicit-transport-fixture','blocks',jsonb_build_array(
        jsonb_build_object('type','WARMUP','minutes',5,'exercises',jsonb_build_array(jsonb_build_object('id','EX158'))),
        jsonb_build_object('type','TABATA','minutes',4,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))),
        jsonb_build_object('type','SKILL','minutes',8,'exercises',jsonb_build_array(jsonb_build_object('id','EX087'))))));
    IF prefs IS NOT NULL THEN draft := draft || jsonb_build_object('preferences',prefs); END IF;
    INSERT INTO public.user_training_plan_items(user_id,sequence_index,recommended_date,status,
      planned_duration_minutes,planned_focus,planned_target_region,planned_progression_intent,planning_context_json)
    VALUES(athlete,0,current_date,'available',20,'Strength','Upper','MAINTAIN',jsonb_build_object('w11','{}'::jsonb))
    RETURNING id INTO plan_id;
    saved := public.week_save_composer_draft_v1(athlete,plan_id,draft);
    reread := public.week_read_composer_for_day_v1(athlete,current_date);
    IF reread->>'found' IS DISTINCT FROM 'true'
      OR reread#>'{composer_draft,preferences}' IS DISTINCT FROM prefs
      OR reread#>'{composer_draft,architecture}' IS DISTINCT FROM draft->'architecture' THEN
      RAISE EXCEPTION 'PREFERENCE_READBACK_%',i;
    END IF;
    preview := public.week_composer_prescription_preview_v1(athlete,draft,'{}'::text[]);
    IF preview->>'status' IS DISTINCT FROM 'PREVIEW' THEN RAISE EXCEPTION 'PREVIEW_%:%',i,preview; END IF;
    compiled := public.week_compile_composer_day_j_v1(athlete,plan_id,current_date,6,
      ARRAY['Aucune']::text[],'{}'::text[],draft->>'environment_code');
    IF compiled->>'status' IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'COMPILATION_%:%',i,compiled; END IF;
    session_id := (compiled->>'session_id')::uuid;
    SELECT planning_context_json->'composer_draft' INTO STRICT actual
      FROM public.workout_sessions WHERE id=session_id AND user_id=athlete;
    IF actual->'preferences' IS DISTINCT FROM prefs
      OR actual->'architecture' IS DISTINCT FROM draft->'architecture'
      OR actual->'intent' IS DISTINCT FROM draft->'intent' THEN
      RAISE EXCEPTION 'COMPILED_SNAPSHOT_%',i;
    END IF;
    IF i=1 AND actual ? 'preferences' THEN RAISE EXCEPTION 'LEGACY_SILENTLY_MIGRATED'; END IF;
    again := public.week_compile_composer_day_j_v1(athlete,plan_id,current_date,6,
      ARRAY['Aucune']::text[],'{}'::text[],draft->>'environment_code');
    IF again->>'status' IS DISTINCT FROM 'ALREADY_READY'
      OR again->>'session_id' IS DISTINCT FROM session_id::text THEN RAISE EXCEPTION 'IDENTITY_%',i; END IF;
    results := results || jsonb_build_array(jsonb_build_object('case',i,'transport','PASS',
      'preview','PREVIEW','compile','READY','repeat','ALREADY_READY','legacy_preserved',i=1,
      'scope','preferences preserved, not engine consumption/progression'));
  END LOOP;
  PERFORM set_config('ugerod.qa_preferences_transport',results::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_preferences_transport')::jsonb AS result;
ROLLBACK;
