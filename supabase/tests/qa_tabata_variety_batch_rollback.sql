-- Compare new batch scores to unchanged scalar reference for populated DEV context. Read only.
BEGIN READ ONLY;
SET LOCAL statement_timeout='55s';
DO $qa$
DECLARE u uuid; m jsonb; n int;
BEGIN
 SELECT user_id INTO u FROM public.workout_sessions WHERE planned_environment_code='GYM' ORDER BY created_at DESC LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'No reference context'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 m:=ugerod_private.tabata_variety_penalties_v1(u);
 SELECT count(*) INTO n FROM public.exercises e WHERE ('Core'=any(coalesce(e.usable_for,'{}'::text[])) OR e.id='EX418') AND (m->>e.id)::numeric IS DISTINCT FROM public.c4_tabata_variety_penalty_v2(u,e.id);
 IF n<>0 THEN RAISE EXCEPTION 'Scalar differences: %',n; END IF;
END $qa$;
SELECT 'PASS all Tabata candidate scores match scalar reference' AS result;
ROLLBACK;
