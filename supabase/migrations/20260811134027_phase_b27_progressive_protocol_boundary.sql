-- B2.7 progressive protocol refinement.
-- Death By / Death By Couplet performance is a protocol boundary, potentially censored by a time cap.

alter table public.protocol_capability_events
add column if not exists boundary_type text;

create or replace function public.protocol_partial_progress_ratio(
  p_protocol jsonb,
  p_actual jsonb
)
returns numeric
language plpgsql
immutable
set search_path=public
as $$
declare
  v_explicit numeric;
  v_failed_stage numeric;
  v_ex jsonb;
  v_id text;
  v_pres jsonb;
  v_start numeric;
  v_increment numeric;
  v_target numeric;
  v_actual_reps numeric;
  v_target_total numeric:=0;
  v_actual_total numeric:=0;
  v_count int:=0;
begin
  v_explicit:=nullif(p_actual->>'partial_progress_ratio','')::numeric;
  if v_explicit is not null then
    return greatest(0,least(1,v_explicit));
  end if;

  v_failed_stage:=coalesce(
    nullif(p_actual->>'failed_stage','')::numeric,
    nullif(p_actual->>'last_completed_stage','')::numeric + 1
  );

  if v_failed_stage is null then return 0; end if;

  if jsonb_typeof(p_actual->'partial_reps_by_exercise')='object' then
    for v_ex in select value from jsonb_array_elements(coalesce(p_protocol->'exercises','[]'::jsonb))
    loop
      v_count:=v_count+1;
      v_id:=v_ex->>'exercise_id';
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      v_start:=coalesce(nullif(v_pres->>'start_reps','')::numeric,nullif(v_pres->>'reps_min','')::numeric,0);
      v_increment:=coalesce(nullif(v_pres->>'increment_reps','')::numeric,0);
      v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
      v_actual_reps:=greatest(0,coalesce(nullif(p_actual->'partial_reps_by_exercise'->>v_id,'')::numeric,0));
      v_target_total:=v_target_total+v_target;
      v_actual_total:=v_actual_total+least(v_target,v_actual_reps);
    end loop;

    if v_count>0 and v_target_total>0 then
      return greatest(0,least(1,v_actual_total/v_target_total));
    end if;
  end if;

  if jsonb_array_length(coalesce(p_protocol->'exercises','[]'::jsonb))=1
     and nullif(p_actual->>'partial_next_stage_reps','') is not null then
    v_ex:=p_protocol->'exercises'->0;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_start:=coalesce(nullif(v_pres->>'start_reps','')::numeric,nullif(v_pres->>'reps_min','')::numeric,0);
    v_increment:=coalesce(nullif(v_pres->>'increment_reps','')::numeric,0);
    v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
    if v_target>0 then
      return greatest(0,least(1,(p_actual->>'partial_next_stage_reps')::numeric/v_target));
    end if;
  end if;

  return 0;
end;
$$;

create or replace function public.apply_session_protocol_observation(
  p_session_id uuid,
  p_quality numeric default null,
  p_policy_key text default 'b2.7-live-default'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_expected jsonb;
  v_actual jsonb;
  v_observed_at timestamptz;
  v_desc jsonb;
  v_protocol jsonb;
  v_signature text;
  v_mechanic text;
  v_variant text;
  v_kind text;
  v_boundary_type text:='generic';
  v_quality numeric;
  v_policy record;
  v_old public.user_protocol_capabilities%rowtype;
  v_before jsonb:='{}'::jsonb;
  v_best jsonb:='{}'::jsonb;
  v_stage numeric;
  v_partial_ratio numeric:=0;
  v_old_stage numeric;
  v_old_partial_ratio numeric:=0;
  v_effective numeric:=0;
  v_conf numeric:=0;
  v_decision text;
  v_reason text[]:='{}'::text[];
  v_right_censored boolean:=false;
begin
  select ws.user_id,
         coalesce(nullif(ws.mechanic_json,'{}'::jsonb),ws.generated_workout->'meta','{}'::jsonb),
         coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb),
         coalesce(ws.completed_at,ws.updated_at,now())
  into v_user_id,v_expected,v_actual,v_observed_at
  from public.workout_sessions ws where ws.id=p_session_id;

  if not found then raise exception 'Unknown session %',p_session_id; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot update another user protocol capability';
  end if;

  if v_actual='{}'::jsonb then
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','NO_PROTOCOL_ACTUAL','session_id',p_session_id);
  end if;

  if coalesce((v_actual->>'pain_affected')::boolean,false) then
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','PAIN_STATE_ONLY','session_id',p_session_id);
  end if;

  select * into v_policy from public.performance_engine_policy where policy_key=p_policy_key and active;
  if not found then raise exception 'Active performance policy % not found',p_policy_key; end if;

  v_desc:=public.build_session_protocol_descriptor(p_session_id);
  v_protocol:=coalesce(v_desc->'protocol_json','{}'::jsonb);
  v_signature:=v_desc->>'protocol_signature';
  v_mechanic:=v_desc->>'mechanic_key';
  v_variant:=nullif(v_desc->>'variant_key','');

  v_kind:=case
    when coalesce(v_variant,'') in ('DEATH_BY','DEATH_BY_COUPLET') or v_mechanic='PROGRESSIVE_INTERVAL' then 'progressive_limit'
    when v_actual ? 'rounds_completed' or v_actual ? 'work_seconds' then 'density'
    else 'generic_protocol'
  end;

  if v_kind='progressive_limit' then
    v_stage:=nullif(v_actual->>'last_completed_stage','')::numeric;
    if v_stage is null then
      return jsonb_build_object('version','b2.7-protocol-runtime-2','status','SKIPPED','reason','PROGRESSIVE_STAGE_MISSING','protocol_signature',v_signature);
    end if;

    v_right_censored:=coalesce((v_actual->>'completed_time_limit')::boolean,false)
      or coalesce((v_actual->>'hit_time_cap')::boolean,false);

    if v_right_censored and not (v_actual ? 'failed_stage') then
      v_boundary_type:='right_censored_time_cap';
    elsif v_actual ? 'failed_stage' then
      v_boundary_type:='observed_failure_boundary';
    else
      v_boundary_type:='observed_stage_boundary';
    end if;

    v_partial_ratio:=public.protocol_partial_progress_ratio(v_protocol,v_actual);
    v_actual:=v_actual || jsonb_build_object(
      'normalized_partial_progress_ratio',round(v_partial_ratio,4),
      'boundary_type',v_boundary_type
    );
  end if;

  v_quality:=greatest(0,least(1,coalesce(
    p_quality,
    nullif(v_actual->>'observation_quality','')::numeric,
    case
      when v_boundary_type='observed_failure_boundary' then 0.95
      when v_boundary_type='right_censored_time_cap' then 0.85
      when v_kind='progressive_limit' then 0.80
      else 0.70
    end
  )));

  if exists(select 1 from public.protocol_capability_events where session_id=p_session_id and protocol_signature=v_signature and applied) then
    return jsonb_build_object('version','b2.7-protocol-runtime-2','status','IDEMPOTENT_SKIP','protocol_signature',v_signature,'session_id',p_session_id);
  end if;

  select * into v_old
  from public.user_protocol_capabilities
  where user_id=v_user_id and protocol_signature=v_signature
  for update;

  if found then
    v_before:=jsonb_build_object(
      'best_outcome_json',v_old.best_outcome_json,
      'latest_outcome_json',v_old.latest_outcome_json,
      'confidence',v_old.confidence,
      'freshness',v_old.freshness,
      'effective_evidence',v_old.effective_evidence,
      'evidence_count',v_old.evidence_count,
      'valid_evidence_count',v_old.valid_evidence_count
    );
    v_best:=coalesce(v_old.best_outcome_json,'{}'::jsonb);
    v_effective:=coalesce(v_old.effective_evidence,0)+v_quality;
  else
    v_effective:=v_quality;
  end if;

  if v_kind='progressive_limit' then
    v_old_stage:=nullif(v_best->>'last_completed_stage','')::numeric;
    v_old_partial_ratio:=coalesce(nullif(v_best->>'normalized_partial_progress_ratio','')::numeric,0);

    if v_old_stage is null then
      v_best:=v_actual;
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'INITIALIZE_PROTOCOL_LOWER_BOUND' else 'INITIALIZE_PROTOCOL' end;
    elsif v_stage>v_old_stage or (v_stage=v_old_stage and v_partial_ratio>v_old_partial_ratio) then
      v_best:=v_actual;
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'EXPAND_PROTOCOL_LOWER_BOUND' else 'EXPAND_PROTOCOL_FRONTIER' end;
    elsif v_stage=v_old_stage and v_partial_ratio=v_old_partial_ratio then
      v_decision:=case when v_boundary_type='right_censored_time_cap' then 'CONFIRM_PROTOCOL_LOWER_BOUND' else 'CONFIRM_PROTOCOL' end;
    else
      v_decision:='HOLD_BEST_RECALIBRATION_PENDING';
      v_reason:=array['LOWER_SINGLE_PROTOCOL_RESULT_DOES_NOT_REGRESS_BEST'];
    end if;
  else
    if v_best='{}'::jsonb then v_best:=v_actual; end if;
    v_decision:=case when found then 'CONFIRM_PROTOCOL_CONTEXT' else 'INITIALIZE_PROTOCOL_CONTEXT' end;
  end if;

  v_conf:=public.capability_confidence_from_evidence(v_effective,v_policy.confidence_half_evidence);

  insert into public.user_protocol_capabilities(
    user_id,protocol_signature,mechanic_key,variant_key,protocol_json,best_outcome_json,latest_outcome_json,
    confidence,freshness,effective_evidence,evidence_count,valid_evidence_count,last_observed_at,last_valid_observed_at,
    engine_version,updated_at
  ) values (
    v_user_id,v_signature,v_mechanic,v_variant,v_protocol,v_best,v_actual,
    v_conf,1,v_effective,coalesce(v_old.evidence_count,0)+1,coalesce(v_old.valid_evidence_count,0)+1,
    v_observed_at,v_observed_at,'b2.7-protocol-2',now()
  )
  on conflict(user_id,protocol_signature) do update set
    mechanic_key=excluded.mechanic_key,variant_key=excluded.variant_key,protocol_json=excluded.protocol_json,
    best_outcome_json=excluded.best_outcome_json,latest_outcome_json=excluded.latest_outcome_json,
    confidence=excluded.confidence,freshness=excluded.freshness,effective_evidence=excluded.effective_evidence,
    evidence_count=excluded.evidence_count,valid_evidence_count=excluded.valid_evidence_count,
    last_observed_at=excluded.last_observed_at,last_valid_observed_at=excluded.last_valid_observed_at,
    engine_version=excluded.engine_version,updated_at=now();

  insert into public.protocol_capability_events(
    user_id,session_id,protocol_signature,mechanic_key,variant_key,protocol_kind,boundary_type,decision,quality,
    expected_json,actual_json,before_json,after_json,reason_codes,applied
  ) values (
    v_user_id,p_session_id,v_signature,v_mechanic,v_variant,v_kind,v_boundary_type,v_decision,v_quality,
    v_expected,v_actual,v_before,jsonb_build_object(
      'best_outcome_json',v_best,'latest_outcome_json',v_actual,'confidence',v_conf,'freshness',1,
      'effective_evidence',v_effective,'boundary_type',v_boundary_type
    ),v_reason,true
  );

  return jsonb_build_object(
    'version','b2.7-protocol-runtime-2','status','APPLIED','session_id',p_session_id,
    'protocol_signature',v_signature,'protocol_kind',v_kind,'boundary_type',v_boundary_type,
    'decision',v_decision,'quality',v_quality,'confidence',v_conf,'best_outcome',v_best
  );
end;
$$;

revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from public;
revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from anon;
revoke all on function public.protocol_partial_progress_ratio(jsonb,jsonb) from authenticated;
