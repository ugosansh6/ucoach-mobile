-- The set/rest contract also applies to distance and holds, not just reps.
-- Values come from the existing block producer; the Player adds no volume.
do $migration$
declare d text;
begin
 select pg_get_functiondef(oid) into d from pg_proc where proname='week_compile_composer_day_j_v1';
 if position('end if; -- canonical WOD prescriptions bypass the legacy scalar formatter' in d)=0 then raise exception 'Concurrent dose compiler change'; end if;
 d:=replace(d,'end if; -- canonical WOD prescriptions bypass the legacy scalar formatter',
 $patch$end if; -- canonical WOD prescriptions bypass the legacy scalar formatter
      if v_type in ('WARMUP','STRENGTH','SKILL') and v_sets is not null then
        v_pres:=v_pres||jsonb_build_object('sets',v_sets,'rest_seconds',coalesce(v_rest,0),
          'reps_semantics',coalesce(v_pres->>'reps_semantics',v_solver->>'reps_semantics','total'));
      end if;$patch$);
 execute d;
 select pg_get_functiondef(oid) into d from pg_proc where proname='composer_player_progress_rebase_v1';
 d:=replace(d,$needle$union select split_part(k,':',1) from jsonb_object_keys(coalesce(p#>'{strengthRuntime,results}','{}')) k$needle$,
   $patch$union select split_part(k,':',1) from jsonb_object_keys(coalesce(p#>'{strengthRuntime,results}','{}')) k
   union select split_part(k,':',1) from jsonb_object_keys(coalesce(p#>'{warmupRuntime,results}','{}')) k$patch$);
 execute d;
 select pg_get_functiondef(oid) into d from pg_proc where proname='composer_player_progress_save_v1';
 if position('select e.prescription_json into expected' in d)=0 then raise exception 'Concurrent progress validator change'; end if;
 d:=replace(d,'select e.prescription_json into expected',
 $patch$select e.prescription_json||jsonb_build_object('sets',coalesce(nullif(e.prescription_json->>'sets','')::int,
   (select coalesce(nullif(b#>>'{mechanic_json,parameters,sets}','')::int,nullif(b->>'warmup_rounds','')::int)
      from jsonb_array_elements(s.generated_workout->'blocks') b where b->>'block_key'=e.block_key limit 1))) into expected$patch$);
 d:=replace(d,$needle$ex#>'{performanceActualJson,gym_sets}');$needle$,
   $patch$ex#>'{performanceActualJson,gym_sets}',ex#>'{performanceActualJson,warmup_sets}');$patch$);
 execute d;
end $migration$;
