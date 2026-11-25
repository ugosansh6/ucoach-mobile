-- PERF-007 / runtime parity: accept numeric JSON values such as "8.0"
-- for integer EMOM cycle/duration fields. This keeps the same quality gate;
-- it only removes a type-cast crash seen on GYM format recompilation.

create or replace function public.c4_candidate_quality_gate_v2_pre_deck_adaptive_v1(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'::text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb;
  reasons jsonb;
  filtered jsonb;
  checks jsonb;
  contract jsonb:=coalesce(p_candidate->'athlete_workload_contract','{}'::jsonb);
  m text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  guard jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json,parameters,emom_cycle_guard}','{}'::jsonb);
  cycles int:=coalesce(
    nullif(p_candidate#>>'{c4_final,mechanic_json,parameters,cycles}','')::numeric::int,
    0
  );
  duration_min int:=coalesce(
    nullif(p_candidate#>>'{c4_final,mechanic_json,parameters,duration_minutes}','')::numeric::int,
    0
  );
  n int:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
begin
  r:=public.c4_candidate_quality_gate_v2_pre_m84(
    p_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,
    p_max_complexity,p_policy_key
  );
  reasons:=coalesce(r->'hard_gate_reasons','[]'::jsonb);
  checks:=coalesce(r->'checks','{}'::jsonb);

  if m='EMOM' and coalesce((guard->>'adapted')::boolean,false) then
    select coalesce(jsonb_agg(value),'[]'::jsonb)
    into filtered
    from jsonb_array_elements(reasons) x(value)
    where value<>to_jsonb('FINAL_DURATION_UNDERFILLED'::text);
    reasons:=filtered;
  end if;

  if m='EMOM' and (cycles<1 or n<1 or duration_min<>cycles*n) then
    reasons:=reasons||jsonb_build_array('EMOM_PARTIAL_CYCLE_NOT_ALLOWED');
  end if;

  if contract<>'{}'::jsonb
     and coalesce((contract->>'pass')::boolean,false)=false then
    reasons:=reasons||jsonb_build_array('ATHLETE_WORKLOAD_CONTRACT_FAILED');
  end if;

  checks:=checks||jsonb_build_object(
    'athlete_workload_contract',contract,
    'emom_complete_cycle_contract',
      case when m='EMOM' then jsonb_build_object(
        'cycles',cycles,
        'exercise_count',n,
        'execution_minutes',duration_min,
        'complete_cycles_only',duration_min=cycles*n,
        'guard',guard
      ) else null end
  );

  return jsonb_build_object(
    'pass',jsonb_array_length(reasons)=0,
    'hard_gate_reasons',reasons,
    'mechanic',coalesce(r->>'mechanic',m),
    'checks',checks,
    'version','c4-quality-gate-v2.3-m91-emom'
  );
end;
$function$;
