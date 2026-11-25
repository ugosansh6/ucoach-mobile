alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
rename to c4_finalize_candidate_pre_progressive_timecap;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_wod_minutes int;
begin
  v_result:=public.c4_finalize_candidate_pre_progressive_timecap(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_wod_minutes:=coalesce(
      nullif(v_result#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,
      p_exact_wod_minutes,
      greatest(1,p_total_duration_minutes)
    );

    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,time_limit_seconds}',to_jsonb(v_wod_minutes*60),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,duration_contract}',to_jsonb('variable_until_failure_with_wod_time_cap'::text),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,time_cap_role}',to_jsonb('session_budget_hard_cap'::text),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,predicted_duration_is_estimate}',to_jsonb(true),true);
  end if;

  return v_result;
end;
$function$;

alter function public.c4_candidate_quality_gate_v2(jsonb,text,text,text,text[],jsonb,integer,text)
rename to c4_candidate_quality_gate_v2_pre_progressive_duration;

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_reasons jsonb;
  v_filtered jsonb;
  v_checks jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_duration_status text:=coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','');
  v_time_limit int:=nullif(p_candidate#>>'{c4_final,mechanic_json,parameters,time_limit_seconds}','')::int;
  v_wod_minutes int:=nullif(p_candidate#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int;
begin
  v_result:=public.c4_candidate_quality_gate_v2_pre_progressive_duration(
    p_candidate,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons:=coalesce(v_result->'hard_gate_reasons','[]'::jsonb);
  v_checks:=coalesce(v_result->'checks','{}'::jsonb);

  if v_mechanic='PROGRESSIVE_INTERVAL' and v_duration_status='UNDERFILLED' then
    -- Variable-duration progressive protocols may finish early by design.
    -- They are valid only when a hard cap protects the overall session budget.
    select coalesce(jsonb_agg(value),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(v_reasons) x(value)
    where value<>to_jsonb('FINAL_DURATION_UNDERFILLED'::text);
    v_reasons:=v_filtered;

    if v_time_limit is null or v_time_limit<=0 or v_wod_minutes is null or v_time_limit>v_wod_minutes*60 then
      v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_INTERVAL_REQUIRES_WOD_TIME_CAP');
    end if;

    v_checks:=v_checks||jsonb_build_object(
      'variable_duration_allowed',true,
      'time_limit_seconds',v_time_limit,
      'wod_budget_seconds',coalesce(v_wod_minutes,0)*60,
      'underfilled_prediction_is_hard_failure',false
    );
  else
    v_checks:=v_checks||jsonb_build_object('variable_duration_allowed',false);
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',v_checks,
    'version','c4-quality-gate-v1.5-progressive-duration'
  );
end;
$function$;;
