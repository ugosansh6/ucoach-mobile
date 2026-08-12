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
  v_cap_key text;
  v_mode text:=coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable');
  v_signature text:=nullif(p_comparison->>'protocol_signature','');
  v_env_key text;
  v_root jsonb;
  v_sub jsonb;
  v_candidate jsonb;
  v_evidence_root jsonb;
  v_ev jsonb;
  v_context text:=coalesce(nullif(p_comparison->>'protocol_signature',''),p_family||'|'||coalesce(nullif(p_comparison->>'capability_mode',''),'repeatable'));
  v_prev_failure_context text;
  v_failure_count int:=0;
  v_negative_required int:=3;
  v_expected_min numeric;
  v_actual_value numeric;
  v_prescription_failure boolean:=false;
begin
  v_result:=public.propose_capability_state_update_core(
    p_state,p_family,p_expected,p_actual,p_quality,p_capability_eligible,p_pain_affected,
    p_comparison,p_policy_key,p_observed_at
  );

  v_state:=coalesce(v_result->'after_state','{}'::jsonb);
  v_cap_key:=v_result->>'capability_key';
  v_env_key:=case p_family
    when 'reps' then 'reps_envelope'
    when 'load_reps' then 'load_envelope'
    when 'time' then 'time_envelope'
    when 'pace' then 'pace_envelope'
    when 'loaded_distance' then 'distance_envelope'
    when 'density' then 'density_envelope'
    when 'progressive' then 'progressive_envelope'
  end;

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  -- Existing confirmed negative behavior: historical best is never erased in one step.
  if coalesce(v_result->>'decision','')='REGRESS_CONFIRMED' then
    v_candidate:=jsonb_build_object(
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb),
      'quality',public.num_clamp(coalesce(p_quality,0),0,1),
      'comparison',coalesce(p_comparison,'{}'::jsonb),
      'observed_at',p_observed_at,
      'status','CONFIRMED_NEGATIVE_RECALIBRATION'
    );
    v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    if v_cap_key is not null then
      v_state:=jsonb_set(v_state,array['evidence_json',v_cap_key,'last_decision'],to_jsonb('RECALIBRATE'::text),true);
    end if;
    v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('CONFIRMED_NEGATIVE_REQUIRES_RECALIBRATION'),true);
    return v_result;
  end if;

  if coalesce(p_capability_eligible,false) and not coalesce(p_pain_affected,false) and coalesce(p_quality,0)>0 then
    if p_family in ('reps','load_reps') then
      v_expected_min:=public.jsonb_num(p_expected,'reps_min');
      v_actual_value:=public.jsonb_num(p_actual,'reps');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    elsif p_family='time' then
      v_expected_min:=public.jsonb_num(p_expected,'duration_seconds_min');
      v_actual_value:=public.jsonb_num(p_actual,'duration_seconds');
      v_prescription_failure:=v_expected_min is not null and v_actual_value is not null and v_actual_value < v_expected_min;
    end if;
  end if;

  if v_prescription_failure and v_cap_key is not null then
    select coalesce(negative_confirmations_required,3)
      into v_negative_required
    from public.performance_engine_policy
    where policy_key=p_policy_key;
    v_negative_required:=coalesce(v_negative_required,3);

    v_prev_failure_context:=v_sub#>>'{prescription_failure_streak,context}';
    if v_prev_failure_context is distinct from v_context then
      v_failure_count:=1;
    else
      v_failure_count:=coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)+1;
    end if;

    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',v_failure_count,
      'context',v_context,
      'last_failed_at',p_observed_at,
      'actual',coalesce(p_actual,'{}'::jsonb),
      'expected',coalesce(p_expected,'{}'::jsonb)
    ),true);

    v_evidence_root:=coalesce(v_state->'evidence_json','{}'::jsonb);
    v_ev:=coalesce(v_evidence_root->v_cap_key,'{}'::jsonb);

    if v_failure_count>=v_negative_required then
      v_candidate:=jsonb_build_object(
        'actual',coalesce(p_actual,'{}'::jsonb),
        'expected',coalesce(p_expected,'{}'::jsonb),
        'quality',public.num_clamp(coalesce(p_quality,0),0,1),
        'comparison',coalesce(p_comparison,'{}'::jsonb),
        'observed_at',p_observed_at,
        'status','REPEATED_PRESCRIPTION_FAILURE_RECALIBRATION',
        'failure_count',v_failure_count
      );
      v_sub:=jsonb_set(v_sub,array['recalibration_candidate'],v_candidate,true);
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('RECALIBRATE'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('REPEATED_BELOW_PRESCRIPTION_MIN','RECALIBRATION_REQUIRED'),true);
    else
      v_ev:=jsonb_set(v_ev,array['last_decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
      v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('BELOW_PRESCRIPTION_MIN_UNCONFIRMED'),true);
    end if;

    v_evidence_root:=jsonb_set(v_evidence_root,array[v_cap_key],v_ev,true);
    v_state:=jsonb_set(v_state,array['evidence_json'],v_evidence_root,true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
    v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
    return v_result;
  end if;

  -- Successful comparable exposure clears a pending consecutive failure streak.
  if coalesce((v_sub#>>'{prescription_failure_streak,count}')::int,0)>0 then
    v_sub:=jsonb_set(v_sub,array['prescription_failure_streak'],jsonb_build_object(
      'count',0,'context',v_context,'cleared_at',p_observed_at
    ),true);
    if p_family in ('density','progressive') then
      v_root:=jsonb_set(v_root,array['protocols',coalesce(v_signature,'missing')],v_sub,true);
    else
      v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
    end if;
    v_state:=jsonb_set(v_state,array[v_env_key],v_root,true);
    v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
  end if;

  return v_result;
end;
$function$;;
