-- #29: Ensure Composer's recommendation respects longer WOD pacing.
-- Read-only checks, no user tables changed.
BEGIN;
SET LOCAL statement_timeout='10000ms';
DO $qa$
DECLARE
  ids text[];
  minutes integer;
  result jsonb;
  top_key text;
  has_alternative boolean;
BEGIN
  SELECT array_agg(e.id order by e.id) INTO ids
  FROM (SELECT e.id FROM public.exercises e
    WHERE e.home_friendly=true AND e.usable_for @> ARRAY['WOD']::text[]
      AND e.technical_complexity<=2
      AND public.exercise_environment_eligible_v1(e.id,'HOME')
    ORDER BY e.id LIMIT 3) e;
  IF cardinality(ids)<>3 THEN RAISE EXCEPTION 'QA needs 3 Home WOD exercises'; END IF;
  FOREACH minutes IN ARRAY ARRAY[12,25,39,40,49,78] LOOP
    result:=public.week_composer_mechanic_recommendations_v1(
      '00000000-0000-0000-0000-000000007799'::uuid,
      'HOME',minutes,ids,'Conditioning');
    top_key:=result#>>'{options,0,key}';
    IF (minutes<40 AND top_key<>'AMRAP') OR (minutes>=40 AND top_key<>'CIRCUIT') THEN
      RAISE EXCEPTION 'Unexpected recommended WOD mechanic % for % minutes',top_key,minutes;
    END IF;
    IF result#>>'{options,0,recommended}'<>'true' THEN
      RAISE EXCEPTION 'Recommended flag missing %', minutes;
    END IF;
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'options') o
      WHERE o->>'key'='AMRAP') INTO has_alternative;
    IF NOT has_alternative THEN RAISE EXCEPTION 'Manual AMRAP choice lost %',minutes; END IF;
  END LOOP;
  PERFORM set_config('ugerod.qa_long_wod',jsonb_build_object('status','PASS','short_cases',3,
    'long_cases',3,'alternatives_preserved',true)::text,true);
END $qa$;
SELECT current_setting('ugerod.qa_long_wod')::jsonb result;
ROLLBACK;
