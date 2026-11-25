-- #32: Read-only rollback regression checks for W11 Composer
-- with existing public.c4_mechanic_composition_contract authority.
BEGIN;
SET LOCAL statement_timeout='12000ms';
DO $contract_qa$
DECLARE
  ids text[];
  n integer;
  response jsonb;
  n_allowed integer;
  n_blocked integer;
  expect_allowed integer[] := ARRAY[0,4,5,5,4,1,0];
  expect_blocked integer[] := ARRAY[5,1,0,0,1,4,5];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM (
    SELECT id FROM public.exercises
    WHERE home_friendly=true AND usable_for @> ARRAY['WOD']::text[]
      AND technical_complexity<=2
      AND public.exercise_environment_eligible_v1(id,'HOME')
    ORDER BY id LIMIT 7
  ) sample;
  IF cardinality(ids)<>7 THEN RAISE EXCEPTION 'Insufficient QA HOME low-tech exercises'; END IF;
  FOR n IN 1..7 LOOP
    response:=public.week_composer_mechanic_recommendations_v1(
      '00000000-0000-0000-0000-000000007799'::uuid,
      'HOME',40,ids[1:n],'Conditioning');
    n_allowed:=jsonb_array_length(response->'options');
    n_blocked:=jsonb_array_length(response->'unavailable');
    IF n_allowed<>expect_allowed[n] OR n_blocked<>expect_blocked[n] THEN
      RAISE EXCEPTION 'Composer contract mismatch n=% allowed=% blocked=%',n,n_allowed,n_blocked;
    END IF;
  END LOOP;
  response:=public.week_composer_mechanic_recommendations_v1(
    '00000000-0000-0000-0000-000000007799'::uuid,
    'HOME',78,ids[1:1],'Conditioning');
  IF jsonb_array_length(response->'options')<>0 OR
     (SELECT count(*) FROM jsonb_array_elements(response->'unavailable') v
      WHERE v->>'reason' LIKE 'Ajoute des mouvements%')<>5 THEN
    RAISE EXCEPTION '78-minute one-movement WOD was incorrectly recommended';
  END IF;
  PERFORM set_config('ugerod.mec_contract_qa','PASS: 7 composition cases + long WOD',true);
END $contract_qa$;

-- Run through the exposed roles as well as the privileged QA connection.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000007799';
DO $acl_qa$
BEGIN
  PERFORM public.week_composer_mechanic_recommendations_v1(
    '00000000-0000-0000-0000-000000007799'::uuid,'HOME',40,ARRAY['EX001'],'Conditioning');
  BEGIN
    PERFORM public.week_composer_mechanic_recommendations_v1(
      '00000000-0000-0000-0000-000000007798'::uuid,'HOME',40,ARRAY['EX001'],'Conditioning');
    RAISE EXCEPTION 'Cross-user Composer request was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $acl_qa$;
SET LOCAL ROLE anon;
DO $anon_qa$
BEGIN
  BEGIN
    PERFORM public.week_composer_mechanic_recommendations_v1(
      '00000000-0000-0000-0000-000000007799'::uuid,'HOME',40,ARRAY['EX001'],'Conditioning');
    RAISE EXCEPTION 'Anonymous Composer request was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $anon_qa$;
RESET ROLE;

SELECT current_setting('ugerod.mec_contract_qa') result,
  'PASS: authenticated own-user; cross-user and anonymous denied' as acl_result;
ROLLBACK;
