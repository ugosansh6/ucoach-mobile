DO $migration$
DECLARE d text; needle text:=' result:=jsonb_build_object(''source'',''C2+C3+C4_COMPOSER_V2'''; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.week_composer_wod_authority_v2(uuid,jsonb)'::regprocedure) INTO d;
 IF position(needle in d)=0 OR position('composer_duration_advisories' in d)>0 THEN RAISE EXCEPTION 'Concurrent Composer duration contract change'; END IF;
 replacement:=$patch$ -- The user may retain a shorter, valid protocol instead of filling time with extra volume.
 -- Only two known underfill reasons are eligible. Every other failure remains blocking.
 IF NOT coalesce((candidate#>>'{c4_final,feasible}')::boolean,false)
   AND candidate#>>'{athlete_workload_contract,pass}'='true'
   AND gate->'hard_gate_reasons'='["FINAL_SOLVER_INFEASIBLE"]'::jsonb
   AND estimate>0 AND estimate<=minutes*60
   AND (
      (m='LADDER' AND candidate#>'{c4_final,reasons}'='["LADDER_ATHLETE_VOLUME_TOO_SHORT_FOR_BUDGET"]'::jsonb
       AND coalesce((params->>'rungs')::int,0)>0 AND coalesce((params->>'planned_execution_minutes')::int,0)>0)
      OR
      (m='PROGRESSIVE_INTERVAL' AND candidate#>'{c4_final,reasons}'='["PROGRESSIVE_EXPECTED_FAILURE_TOO_EARLY_FOR_BUDGET"]'::jsonb
       AND coalesce((params->>'expected_stage')::int,0)>0 AND coalesce((params->>'interval_seconds')::int,0)>0
       AND coalesce((params->>'time_limit_seconds')::int,0)>=coalesce((params->>'interval_seconds')::int,0)
       AND params->>'stop_rule'='stop_when_full_prescribed_stage_cannot_finish_inside_interval')
   )
 THEN
   gate:=gate||jsonb_build_object('pass',true,'hard_gate_reasons','[]'::jsonb,
     'composer_duration_advisories',candidate#>'{c4_final,reasons}');
 END IF;
 result:=jsonb_build_object('source','C2+C3+C4_COMPOSER_V2'$patch$;
 d:=replace(d,needle,replacement);
 IF position('''advisories'',gate->''composer_region_advisories''' in d)=0 OR position('IF NOT coalesce((candidate#>>''{c4_final,feasible}'')::boolean,false) OR NOT coalesce((gate->>''pass'')::boolean,false)' in d)=0 THEN RAISE EXCEPTION 'Concurrent Composer gate change'; END IF;
 d:=replace(d,'''advisories'',gate->''composer_region_advisories''','''advisories'',coalesce(gate->''composer_region_advisories'',''[]''::jsonb)||coalesce(gate->''composer_duration_advisories'',''[]''::jsonb)');
 d:=replace(d,'IF NOT coalesce((candidate#>>''{c4_final,feasible}'')::boolean,false) OR NOT coalesce((gate->>''pass'')::boolean,false)',
 'IF (NOT coalesce((candidate#>>''{c4_final,feasible}'')::boolean,false) AND NOT (gate ? ''composer_duration_advisories'')) OR NOT coalesce((gate->>''pass'')::boolean,false)');
 EXECUTE d;
END $migration$;