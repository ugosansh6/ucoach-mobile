-- #34: validate the same read path as the frontend, as authenticated.
BEGIN;
SET LOCAL statement_timeout='12s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000934003';
DO $qa$
DECLARE
 response jsonb; c jsonb; key text; maximum int:=0; ids text[]; names text[];
BEGIN
 response:=public.week_composer_mechanic_recommendations_v1(
  '00000000-0000-0000-0000-000000934003','HOME',40,ARRAY['EX001'],'General Fitness');
 FOR key IN SELECT x->>'key' FROM jsonb_array_elements((response->'options')||(response->'unavailable'))x LOOP
  c:=public.c4_mechanic_composition_contract(key);
  IF NOT coalesce((c->>'found')::boolean,false) THEN RAISE EXCEPTION 'Missing C4 contract %',key; END IF;
  maximum:=greatest(maximum,(c->>'max_exercises')::int);
  IF key NOT IN ('AMRAP','EMOM','FOR_TIME','CIRCUIT','HIIT') THEN RAISE EXCEPTION 'Unexpected activation %',key; END IF;
 END LOOP;
 IF maximum<>6 THEN RAISE EXCEPTION 'Unexpected current manual ceiling %',maximum; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM (
  SELECT id FROM public.exercises WHERE usable_for @> ARRAY['WOD']::text[] AND technical_complexity<=2
   AND public.exercise_environment_eligible_v1(id,'HOME')
   AND public.exercise_equipment_compatible(id,'[]') ORDER BY id LIMIT 6
 ) sample;
 response:=public.week_composer_mechanic_recommendations_v1(
  '00000000-0000-0000-0000-000000934003','HOME',40,ids,'General Fitness');
 SELECT array_agg(x->>'key' ORDER BY x->>'key') INTO names FROM jsonb_array_elements(response->'options')x;
 IF names IS DISTINCT FROM ARRAY['CIRCUIT'] THEN RAISE EXCEPTION 'Six-movement formats mismatch %',response; END IF;
 PERFORM set_config('ugerod.qa_wod_selection','PASS: authenticated direct C4 reads; manual ceiling 6; six movements expose only Circuit',true);
END;
$qa$;
SELECT current_setting('ugerod.qa_wod_selection') AS result;
ROLLBACK;
