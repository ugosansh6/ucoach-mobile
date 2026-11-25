DO $migration$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_wod_authority_v2(uuid,jsonb)'::regprocedure) INTO d;
 IF position('composer_adaptation_source' in d)>0 OR position('candidate:=public.c4_prepare_candidate(candidate,' in d)=0 THEN RAISE EXCEPTION 'Unexpected authority version'; END IF;
 d:=replace(d,' budget numeric; estimate numeric; result jsonb; count_ex int;', ' budget numeric; estimate numeric; result jsonb; count_ex int; composer_adaptation_source jsonb; trial jsonb; trial_gate jsonb; trial_ex jsonb; factor numeric; dominant_id text;');
 d:=replace(d,' candidate:=public.c4_prepare_candidate(candidate,''c4-final-default'');',' composer_adaptation_source:=candidate; candidate:=public.c4_prepare_candidate(candidate,''c4-final-default'');');
 d:=replace(d,' -- Composer: preferred muscle region is not an execution constraint.',$patch$
 -- A bounded re-solve, not a waiver. Keep exact movements and order, lower only
 -- repetition targets, and accept a trial only if the unmodified C4 validates it.
 IF (m='PYRAMID' AND candidate#>'{c4_final,reasons}'='["PYRAMID_NO_COMPLETE_CYCLE"]'::jsonb)
 OR (m='AMRAP' AND candidate#>'{c4_final,reasons}'='["ATHLETE_WORKLOAD_ENVELOPE_EXCEEDED"]'::jsonb) THEN
   SELECT value->>'exercise_id' INTO dominant_id
   FROM jsonb_array_elements(coalesce(candidate#>'{athlete_workload_contract,projection,exercise_details}','[]'::jsonb))
   ORDER BY (value->>'weighted_work_seconds')::numeric DESC LIMIT 1;
   FOREACH factor IN ARRAY ARRAY[0.75,0.5,0.25]::numeric[] LOOP
     SELECT jsonb_agg(CASE WHEN jsonb_typeof(value#>'{prescription,reps_min}')='number'
       AND jsonb_typeof(value#>'{prescription,reps_max}')='number'
       AND (m='PYRAMID' OR value->>'exercise_id'=dominant_id)
       THEN jsonb_set(value,'{prescription}',((value->'prescription')-'execution_target_reps'::text-'mechanic_overlay'::text)||
         jsonb_build_object('reps_min',greatest(1,floor((value#>>'{prescription,reps_min}')::numeric*factor)),
          'reps_max',greatest(1,floor((value#>>'{prescription,reps_max}')::numeric*factor))),true)
       ELSE value END ORDER BY ordinality) INTO trial_ex
     FROM jsonb_array_elements(composer_adaptation_source->'exercises') WITH ORDINALITY;
     trial:=public.c4_finalize_candidate(public.c4_prepare_candidate(jsonb_set(composer_adaptation_source,'{exercises}',trial_ex),'c4-final-default'),
       stimulus,duration,minutes,'c4-final-default','c3-sim-default');
     trial_gate:=public.c4_candidate_quality_gate_v2(trial,readiness,focus,region,public.normalize_body_zone_ids(pain),inventory,
       case when readiness='low' then 3 else 5 end,'c4-final-default');
     IF trial#>>'{c4_final,feasible}'='true' AND trial#>>'{athlete_workload_contract,pass}'='true'
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(trial_gate->'hard_gate_reasons','[]'::jsonb)) g WHERE g NOT IN ('EXPLICIT_TARGET_REGION_COHERENCE','EXPLICIT_TARGET_REGION_COHERENCE_60','BACK_PRIMARY_MUSCLE_REQUIRED')) THEN
        candidate:=trial;gate:=trial_gate||jsonb_build_object('composer_adaptation_advisories','["DOSE_ADAPTED_TO_CONTEXT"]'::jsonb);EXIT;
     END IF;
   END LOOP;
 END IF;
 -- Composer: preferred muscle region is not an execution constraint.$patch$);
 d:=replace(d,'(m=''LADDER'' AND candidate#>''{c4_final,reasons}''=','(m=''DECK'' AND candidate#>''{c4_final,reasons}''=''["DECK_TOO_SHORT_FOR_WOD_BUDGET"]''::jsonb AND coalesce((params->>''cards'')::int,0) BETWEEN 4 AND 52 AND (params->>''cards'')::int % 4=0 AND count_ex=4) OR (m=''LADDER'' AND candidate#>''{c4_final,reasons}''=');
 d:=replace(d,'coalesce(gate->''composer_duration_advisories'',''[]''::jsonb))','coalesce(gate->''composer_duration_advisories'',''[]''::jsonb)||coalesce(gate->''composer_adaptation_advisories'',''[]''::jsonb))');
 EXECUTE d;
END $migration$;;
