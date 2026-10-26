
-- Read-only preview for the Week Composer; uses existing C2 solver.
-- Does not materialize a session or claim a planned date.
CREATE OR REPLACE FUNCTION public.week_composer_prescription_preview_v1(
 p_user_id uuid,p_draft jsonb,p_equipment_names text[] DEFAULT '{}'::text[]
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp
AS $f$
DECLARE
 b jsonb; x jsonb; sol jsonb; blocks jsonb:='[]'; exercises jsonb; inventory jsonb;
 k text; mechanic text; n int; count_ex int; sets_count int; rest_s int; rounds_count int;
 reps int; total int:=0; duration int; intent text; seen text[]:='{}';
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id THEN
   RAISE EXCEPTION 'FORBIDDEN_PREVIEW' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_draft #> '{architecture,blocks}')<>'array'
    OR jsonb_array_length(p_draft #> '{architecture,blocks}') NOT BETWEEN 1 AND 6 THEN
   RAISE EXCEPTION 'INVALID_PREVIEW_BLOCKS';
 END IF;
 duration:=NULLIF(p_draft->>'duration_minutes','')::int;
 IF duration NOT BETWEEN 15 AND 180 THEN RAISE EXCEPTION 'INVALID_PREVIEW_DURATION'; END IF;
 mechanic:=upper(coalesce(p_draft #>> '{mechanic,key}',''));
 intent:=coalesce(nullif(p_draft->>'progression_intent',''),'MAINTAIN');
 inventory:=public.resolve_user_equipment_inventory(p_user_id,coalesce(p_equipment_names,'{}'::text[]),'c4-final-default');
 FOR b IN SELECT value FROM jsonb_array_elements(p_draft #> '{architecture,blocks}') LOOP
   k:=upper(coalesce(b->>'type','')); n:=nullif(b->>'minutes','')::int;
   IF k NOT IN ('WARMUP','TABATA','STRENGTH','SKILL','WOD') OR n NOT BETWEEN 2 AND 90
     OR k=ANY(seen) OR jsonb_typeof(b->'exercises')<>'array'
     OR jsonb_array_length(b->'exercises') NOT BETWEEN 1 AND 8 THEN
     RAISE EXCEPTION 'INVALID_PREVIEW_BLOCK';
   END IF;
   seen:=array_append(seen,k); total:=total+n; count_ex:=jsonb_array_length(b->'exercises');
   sets_count:=CASE WHEN k='WARMUP' THEN CASE WHEN n>=6 THEN 2 ELSE 1 END
     WHEN k IN ('STRENGTH','SKILL') THEN CASE WHEN n>=15 THEN 3 ELSE 2 END ELSE NULL END;
   rest_s:=CASE WHEN k='STRENGTH' THEN 90 WHEN k='SKILL' THEN 60 ELSE NULL END;
   rounds_count:=CASE WHEN k='TABATA' THEN 8
     WHEN k='WOD' AND mechanic='EMOM' THEN floor(n::numeric/count_ex)::int
     WHEN k='WOD' AND mechanic='FOR_TIME' THEN greatest(1,least(5,floor(n::numeric/4)::int))
     WHEN k='WOD' AND mechanic='CIRCUIT' THEN greatest(2,least(4,floor(n::numeric/5)::int))
     WHEN k='WOD' AND mechanic='HIIT' THEN floor(n::numeric/count_ex)::int
     ELSE NULL END;
   exercises:='[]';
   FOR x IN SELECT value FROM jsonb_array_elements(b->'exercises') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.exercises WHERE id=x->>'id') THEN
       RAISE EXCEPTION 'UNKNOWN_PREVIEW_EXERCISE';
     END IF;
     sol:=public.c2_solver_prescription(p_user_id,x->>'id','{}'::jsonb,
       CASE WHEN k='SKILL' THEN 'STRENGTH' WHEN k='WOD' THEN mechanic ELSE k END,
       intent,inventory);
     IF jsonb_typeof(sol)<>'object' THEN RAISE EXCEPTION 'MISSING_C2_PREVIEW'; END IF;
     reps:=coalesce(nullif(sol->>'reps_min','')::int,nullif(sol->>'reps_max','')::int);
     IF reps IS NOT NULL THEN
       reps:=greatest(1,least(30,reps));
       IF k='WOD' AND mechanic='EMOM' THEN reps:=least(10,reps); END IF;
     END IF;
     exercises:=exercises||jsonb_build_array(jsonb_build_object(
       'id',x->>'id','name',x->>'name','sets',sets_count,'rest_seconds',rest_s,
       'reps',CASE WHEN k='TABATA' THEN NULL ELSE reps END,
       'reps_semantics',sol->>'reps_semantics',
       'duration_seconds',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'duration_seconds_min')='number'
         THEN least(40,greatest(10,(sol->>'duration_seconds_min')::int)) ELSE NULL END,
       'distance_meters',CASE WHEN k<>'TABATA' AND reps IS NULL AND jsonb_typeof(sol->'distance_meters_min')='number'
         THEN (sol->>'distance_meters_min')::int ELSE NULL END,
       'load_kg',CASE WHEN jsonb_typeof(sol->'load_kg')='number' THEN sol->'load_kg' ELSE NULL END,
       'load_scope',sol->'load_scope','band_resistance_label',sol->'band_resistance_label',
       'target_rpe_min',sol->'target_rpe_min','target_rpe_max',sol->'target_rpe_max',
       'evidence_count',sol->'valid_evidence_count',
       'intervals_per_exercise',CASE WHEN k='TABATA' AND 8%count_ex=0 THEN 8/count_ex ELSE NULL END,
       'work_seconds',CASE WHEN k='TABATA' THEN 20 ELSE NULL END,
       'solver_version',sol->'solver_version'));
   END LOOP;
   blocks:=blocks||jsonb_build_array(jsonb_build_object(
     'type',k,'minutes',n,'mechanic',CASE WHEN k='WOD' THEN mechanic ELSE NULL END,
     'rounds',rounds_count,'work_seconds',CASE WHEN k='TABATA' THEN 20 WHEN k='WOD' AND mechanic='HIIT' THEN 40 ELSE NULL END,
     'rest_seconds',CASE WHEN k='TABATA' THEN 10 WHEN k='WOD' AND mechanic='HIIT' THEN 20 ELSE NULL END,
     'exercises',exercises));
 END LOOP;
 IF total>duration THEN RAISE EXCEPTION 'PREVIEW_TIME_BUDGET_EXCEEDED'; END IF;
 RETURN jsonb_build_object('status','PREVIEW','version','composer-c2-preview-v1',
   'provisional',true,'duration_minutes',duration,'planned_block_minutes',total,'blocks',blocks);
END;
$f$;
REVOKE EXECUTE ON FUNCTION public.week_composer_prescription_preview_v1(uuid,jsonb,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_composer_prescription_preview_v1(uuid,jsonb,text[]) TO authenticated,service_role;
