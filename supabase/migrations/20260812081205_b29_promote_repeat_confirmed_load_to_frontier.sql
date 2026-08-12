alter function public.propose_capability_state_update(jsonb,text,jsonb,jsonb,numeric,boolean,boolean,jsonb,text,timestamptz)
rename to propose_capability_state_update_b29;

create or replace function public.propose_capability_state_update(
  p_state jsonb,
  p_family text,
  p_expected jsonb,
  p_actual jsonb,
  p_quality numeric,
  p_capability_eligible boolean,
  p_pain_affected boolean,
  p_comparison jsonb default '{}'::jsonb,
  p_policy_key text default 'b2.5-draft-default'::text,
  p_observed_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_result jsonb;
  v_state jsonb;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_old_sub jsonb;
  v_sub jsonb;
  v_candidate_load numeric;
  v_confirmed_before numeric;
  v_actual_load numeric;
  v_actual_reps numeric;
  v_expected_reps_min numeric;
  v_frontier jsonb;
  v_point jsonb;
begin
  v_result:=public.propose_capability_state_update_b29(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  if p_family<>'load_reps'
     or not coalesce(p_capability_eligible,false)
     or coalesce(p_pain_affected,false)
     or coalesce(p_quality,0)<=0 then
    return v_result;
  end if;

  v_old_sub:=coalesce(p_state#>array['load_envelope',v_mode],'{}'::jsonb);
  v_candidate_load:=nullif(v_old_sub#>>'{load_confirmation_candidate,load_kg}','')::numeric;
  v_confirmed_before:=nullif(v_old_sub->>'numeric_load_confirmed_max_kg','')::numeric;
  v_actual_load:=public.jsonb_num(p_actual,'load_kg');
  v_actual_reps:=public.jsonb_num(p_actual,'reps');
  v_expected_reps_min:=public.jsonb_num(p_expected,'reps_min');

  -- Only the second distinct exposure at the same load can promote it into
  -- the trusted frontier. The B2.9 base wrapper has already recorded the
  -- numeric confirmation; here we make the descriptive frontier consistent.
  if v_candidate_load is not null
     and v_actual_load is not null
     and abs(v_actual_load-v_candidate_load)<=0.001
     and (v_expected_reps_min is null or (v_actual_reps is not null and v_actual_reps>=v_expected_reps_min))
     and v_actual_load>coalesce(v_confirmed_before,0) then

    v_state:=coalesce(v_result->'after_state','{}'::jsonb);
    v_sub:=coalesce(v_state#>array['load_envelope',v_mode],'{}'::jsonb);

    select coalesce(jsonb_agg(value order by value->>'load_kg',value->>'reps'),'[]'::jsonb)
    into v_frontier
    from jsonb_array_elements(coalesce(v_sub->'frontier','[]'::jsonb)) x(value)
    where not (
      public.jsonb_num(value,'load_kg') is not null
      and public.jsonb_num(value,'reps') is not null
      and public.jsonb_num(value,'load_kg')<=v_actual_load
      and public.jsonb_num(value,'reps')<=coalesce(v_actual_reps,0)
    );

    v_point:=jsonb_strip_nulls(jsonb_build_object(
      'load_kg',v_actual_load,
      'reps',v_actual_reps,
      'rpe',public.jsonb_num(p_actual,'rpe'),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'observed_at',p_observed_at,
      'confirmation','repeat_same_load_on_distinct_exposure'
    ));

    v_frontier:=v_frontier||jsonb_build_array(v_point);
    v_sub:=jsonb_set(v_sub,'{frontier}',v_frontier,true);
    v_sub:=jsonb_set(v_sub,'{last_observed_at}',to_jsonb(p_observed_at),true);
    v_sub:=v_sub-'load_confirmation_candidate';

    v_state:=jsonb_set(v_state,array['load_envelope',v_mode],v_sub,true);
    v_result:=jsonb_set(v_result,'{decision}',to_jsonb('ADD_FRONTIER_POINT'::text),true);
    v_result:=jsonb_set(v_result,'{after_state}',v_state,true);
    v_result:=jsonb_set(v_result,'{proposal,decision}',to_jsonb('ADD_FRONTIER_POINT'::text),true);
    v_result:=jsonb_set(v_result,'{proposal,after}',v_sub,true);
    v_result:=jsonb_set(v_result,'{proposal,reason_codes}',jsonb_build_array('REPEAT_CONFIRMED_LOAD_FRONTIER_POINT'),true);
  end if;

  return v_result;
end;
$function$;;
