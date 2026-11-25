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
  v_old_root jsonb;
  v_old_sub jsonb;
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
  v_load_actual numeric;
  v_load_reps numeric;
  v_load_candidate numeric;
  v_load_confirmed numeric;
  v_load_expected_reps_min numeric;
  v_load_performance_valid boolean:=true;
  v_same_load_candidate boolean:=false;
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

  v_old_root:=coalesce(p_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_old_sub:=coalesce(v_old_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_old_sub:=coalesce(v_old_root->v_mode,'{}'::jsonb);
  end if;

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  -- Loaded performance points have a stricter contract than generic positive
  -- evidence: a numeric coaching load is only trusted after the same load has
  -- been observed on two separate eligible exposures.
  if p_family='load_reps'
     and coalesce(p_capability_eligible,false)
     and not coalesce(p_pain_affected,false)
     and coalesce(p_quality,0)>0 then

    v_load_actual:=public.jsonb_num(p_actual,'load_kg');
    v_load_reps:=public.jsonb_num(p_actual,'reps');
    v_load_expected_reps_min:=public.jsonb_num(p_expected,'reps_min');
    v_load_performance_valid:=v_load_expected_reps_min is null
      or (v_load_reps is not null and v_load_reps>=v_load_expected_reps_min);
    v_load_candidate:=nullif(v_old_sub#>>'{load_confirmation_candidate,load_kg}','')::numeric;
    v_load_confirmed:=nullif(v_old_sub->>'numeric_load_confirmed_max_kg','')::numeric;
    v_same_load_candidate:=v_load_actual is not null
      and v_load_candidate is not null
      and abs(v_load_actual-v_load_candidate)<=0.001;

    if v_load_actual is not null and v_load_actual>0 and v_load_performance_valid then
      if v_same_load_candidate then
        -- Second exposure at the same load: now safe for numeric coaching.
        v_sub:=v_sub-'load_confirmation_candidate';
        v_sub:=jsonb_set(v_sub,'{numeric_load_confirmed_max_kg}',to_jsonb(greatest(coalesce(v_load_confirmed,0),v_load_actual)),true);
        v_sub:=jsonb_set(v_sub,'{numeric_load_last_confirmed_at}',to_jsonb(p_observed_at),true);
        v_sub:=jsonb_set(v_sub,'{numeric_load_confirmation_rule}',to_jsonb('repeat_same_load_on_distinct_exposure'::text),true);
        v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
        v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
        v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
        v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
      elsif v_load_confirmed is null or v_load_actual>v_load_confirmed then
        -- First sighting of an unconfirmed/new higher load. Keep the historical
        -- observation, but do not let it become a numeric coaching reference.
        v_candidate:=jsonb_build_object(
          'load_kg',v_load_actual,
          'reps',v_load_reps,
          'rpe',public.jsonb_num(p_actual,'rpe'),
          'observed_at',p_observed_at,
          'quality',public.num_clamp(coalesce(p_quality,0),0,1),
          'status','AWAITING_REPEAT_CONFIRMATION'
        );

        if coalesce(v_result->>'decision','')='ADD_FRONTIER_POINT' then
          -- Restore the previously trusted frontier until this exact load is
          -- observed again on another exposure.
          v_sub:=v_old_sub||jsonb_build_object('load_confirmation_candidate',v_candidate);
          v_root:=v_old_root;
          v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
          v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
          v_result:=jsonb_set(v_result,array['decision'],to_jsonb('HOLD'::text),true);
          v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
          v_result:=jsonb_set(v_result,array['proposal','decision'],to_jsonb('HOLD'::text),true);
          v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
          v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('LOAD_FRONTIER_POINT_REQUIRES_REPEAT_CONFIRMATION'),true);
          v_root:=coalesce(v_state->'load_envelope','{}'::jsonb);
          v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
        else
          -- FIRST_VALID_LOAD_REP_POINT may remain in the descriptive frontier,
          -- but it is explicitly non-prescribable until repeated.
          v_sub:=jsonb_set(v_sub,'{load_confirmation_candidate}',v_candidate,true);
          v_sub:=v_sub-'numeric_load_confirmed_max_kg';
          v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
          v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
          v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
          v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
          v_result:=jsonb_set(v_result,array['proposal','reason_codes'],jsonb_build_array('LOAD_POINT_OBSERVED_AWAITING_REPEAT_CONFIRMATION'),true);
        end if;
      elsif v_load_candidate is not null and not v_same_load_candidate and v_load_actual<=coalesce(v_load_confirmed,0) then
        -- Returning to an already confirmed load invalidates a pending spike.
        v_sub:=v_sub-'load_confirmation_candidate';
        v_root:=jsonb_set(v_root,array[v_mode],v_sub,true);
        v_state:=jsonb_set(v_state,array['load_envelope'],v_root,true);
        v_result:=jsonb_set(v_result,array['after_state'],v_state,true);
        v_result:=jsonb_set(v_result,array['proposal','after'],v_sub,true);
      end if;
    end if;
  end if;

  -- Existing confirmed negative behavior: historical best is never erased in one step.
  if coalesce(v_result->>'decision','')='REGRESS_CONFIRMED' then
    v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
    if p_family in ('density','progressive') then
      v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
    else
      v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
    end if;

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

  -- Prescription failure is distinct from losing the historical best.
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

  v_root:=coalesce(v_state->v_env_key,'{}'::jsonb);
  if p_family in ('density','progressive') then
    v_sub:=coalesce(v_root#>array['protocols',coalesce(v_signature,'missing')],'{}'::jsonb);
  else
    v_sub:=coalesce(v_root->v_mode,'{}'::jsonb);
  end if;

  if v_cap_key is not null then
    v_evidence_root:=coalesce(v_state->'evidence_json','{}'::jsonb);
    v_ev:=coalesce(v_evidence_root->v_cap_key,'{}'::jsonb);
  else
    v_evidence_root:='{}'::jsonb;
    v_ev:='{}'::jsonb;
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
$function$;

create or replace function public.c4_resolve_numeric_load(
  p_exercise_id text,
  p_inventory jsonb,
  p_load_envelope jsonb
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r record;
  inv jsonb;
  v_cap_max numeric;
  v_inv_load numeric;
  v_min numeric;
  v_max numeric;
  v_inc numeric;
  v_candidate numeric;
  v_best numeric:=null;
  v_equipment text:=null;
  v_scope text:=null;
  v_count int:=1;
  v_total numeric:=null;
begin
  -- Only the repeatable load explicitly confirmed on two distinct exposures
  -- is allowed to become a numeric coaching prescription.
  v_cap_max:=nullif(p_load_envelope#>>'{repeatable,numeric_load_confirmed_max_kg}','')::numeric;

  -- Backward compatibility only for the old pre-B2.7 root shape.
  if v_cap_max is null
     and p_load_envelope ? 'frontier'
     and jsonb_typeof(coalesce(p_load_envelope->'frontier','null'::jsonb))='array' then
    select max(nullif(x->>'load_kg','')::numeric)
    into v_cap_max
    from jsonb_array_elements(coalesce(p_load_envelope->'frontier','[]'::jsonb)) x;
  end if;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_repeat_confirmed_numeric_load_capability');
  end if;

  for r in
    select els.equipment_id,els.load_scope,greatest(1,coalesce(els.expected_implement_count,1)) expected_count,coalesce(els.symmetric_load,false) symmetric_load
    from public.exercise_load_semantics els
    where els.exercise_id=p_exercise_id
  loop
    for inv in
      select value
      from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end)
    loop
      if inv->>'equipment_id'=r.equipment_id
         and coalesce(nullif(inv->>'quantity','')::int,0)>=r.expected_count
         and coalesce(inv->>'load_confidence','unknown')='confirmed' then

        v_candidate:=null;
        if coalesce(inv->>'inventory_mode','')='adjustable_load' then
          v_min:=nullif(inv->>'min_load_kg','')::numeric;
          v_max:=nullif(inv->>'max_load_kg','')::numeric;
          v_inc:=nullif(inv->>'increment_kg','')::numeric;
          if v_min is not null and v_max is not null and v_min>0 and v_max>=v_min then
            if v_inc is not null and v_inc>0 then
              if least(v_cap_max,v_max)>=v_min then
                v_candidate:=v_min + floor((least(v_cap_max,v_max)-v_min)/v_inc)*v_inc;
              end if;
            else
              v_candidate:=least(v_cap_max,v_max);
            end if;
          end if;
        else
          v_candidate:=nullif(inv->>'load_kg','')::numeric;
        end if;

        if v_candidate is not null
           and v_candidate>0
           and v_candidate<=v_cap_max
           and (v_best is null or v_candidate>v_best) then
          v_best:=v_candidate;
          v_equipment:=r.equipment_id;
          v_scope:=r.load_scope;
          v_count:=r.expected_count;
        end if;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_build_object(
      'confirmed',false,
      'reason','no_inventory_load_within_repeat_confirmed_capability',
      'capability_max_load_kg',v_cap_max,
      'capability_mode','repeatable_confirmed'
    );
  end if;

  v_total:=case when v_scope='per_implement' then v_best*v_count else v_best end;
  return jsonb_build_object(
    'confirmed',true,
    'load_kg',v_best,
    'load_scope',v_scope,
    'implement_count',v_count,
    'total_external_load_kg',v_total,
    'equipment_id',v_equipment,
    'capability_max_load_kg',v_cap_max,
    'capability_mode','repeatable_confirmed',
    'source','repeat_confirmed_capability_intersect_real_inventory'
  );
end;
$function$;;
