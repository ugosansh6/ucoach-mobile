create or replace function public.w4_reference_session_eligibility_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_status text;
  v_completed_at timestamptz;
  v_actual jsonb:='{}'::jsonb;
  v_desc jsonb;
  v_family jsonb;
  v_metric jsonb;
  v_context jsonb;
  v_event_applied boolean:=false;
  v_eligible boolean:=false;
  v_reasons jsonb:='[]'::jsonb;
begin
  select user_id,status,completed_at,coalesce(actual_protocol_outcome_json,'{}'::jsonb)
  into v_user_id,v_status,v_completed_at,v_actual
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    return jsonb_build_object('version','w4-reference-session-eligibility-v1','status','NO_SESSION','session_id',p_session_id,'eligible',false);
  end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    return jsonb_build_object('version','w4-reference-session-eligibility-v1','status','NOT_FOUND_OR_FORBIDDEN','session_id',p_session_id,'eligible',false);
  end if;

  v_desc:=public.build_session_protocol_descriptor(p_session_id);
  v_family:=public.build_session_protocol_family_descriptor(p_session_id);
  v_metric:=public.protocol_outcome_metric_v1(v_desc->>'mechanic_key',v_desc->>'variant_key',v_actual);
  v_context:=public.w4_protocol_context_summary_v1(p_session_id);

  select exists(
    select 1 from public.protocol_capability_events pe
    where pe.session_id=p_session_id and pe.user_id=v_user_id and pe.applied=true
  ) into v_event_applied;

  if v_status<>'completed' then v_reasons:=v_reasons||jsonb_build_array('session_not_completed'); end if;
  if v_actual='{}'::jsonb then v_reasons:=v_reasons||jsonb_build_array('protocol_outcome_missing'); end if;
  if coalesce((v_metric->>'valid')::boolean,false)=false then v_reasons:=v_reasons||jsonb_build_array('protocol_metric_invalid'); end if;
  if v_context->>'status'<>'CONTEXT_AVAILABLE' then v_reasons:=v_reasons||jsonb_build_array('performance_context_incomplete'); end if;
  if nullif(v_desc->>'protocol_signature','') is null then v_reasons:=v_reasons||jsonb_build_array('protocol_signature_missing'); end if;
  if not v_event_applied then v_reasons:=v_reasons||jsonb_build_array('protocol_capability_observation_not_applied'); end if;

  v_eligible:=jsonb_array_length(v_reasons)=0;

  return jsonb_build_object(
    'version','w4-reference-session-eligibility-v1',
    'status',case when v_eligible then 'ELIGIBLE_PERSONAL_REFERENCE' else 'NOT_REFERENCE_ELIGIBLE' end,
    'eligible',v_eligible,
    'session_id',p_session_id,
    'observed_at',v_completed_at,
    'protocol',jsonb_build_object(
      'protocol_signature',v_desc->>'protocol_signature',
      'family_signature',v_family->>'family_signature',
      'mechanic_key',v_desc->>'mechanic_key',
      'variant_key',v_desc->>'variant_key'
    ),
    'outcome_metric',v_metric,
    'context',jsonb_build_object('status',v_context->>'status','context_class',v_context->>'context_class'),
    'protocol_capability_observation_applied',v_event_applied,
    'reasons',v_reasons,
    'comparison_contract','w4_protocol_session_comparability_v1',
    'semantics',jsonb_build_object(
      'personal_reference_not_population_benchmark',true,
      'protocol_capability_event_is_authority',true,
      'raw_outcome_immutable',true,
      'partial_protocol_outcome_can_be_reference_when_metric_valid',true,
      'no_reference_score',true,
      'no_new_sports_threshold',true
    )
  );
end;
$$;

create or replace function public.w4_personal_reference_catalog_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),500));
  v_refs jsonb:='[]'::jsonb;
  v_history_count integer:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  with candidate_sessions as (
    select ws.id,coalesce(ws.completed_at,ws.created_at) observed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb)<>'{}'::jsonb
      and coalesce(ws.completed_at,ws.created_at)<(v_anchor+1)::timestamptz
    order by coalesce(ws.completed_at,ws.created_at) desc,ws.id
    limit v_limit
  ), evaluated as (
    select cs.id,cs.observed_at,public.w4_reference_session_eligibility_v1(cs.id) eligibility
    from candidate_sessions cs
  ), eligible as (
    select *,eligibility#>>'{protocol,protocol_signature}' protocol_signature
    from evaluated
    where coalesce((eligibility->>'eligible')::boolean,false)=true
  ), ranked as (
    select *,row_number() over(partition by protocol_signature order by observed_at desc,id) rn,
      count(*) over(partition by protocol_signature) eligible_history_count
    from eligible
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'reference_status','CURRENT_PERSONAL_REFERENCE',
      'reference_session_id',id,
      'observed_at',observed_at,
      'protocol',eligibility->'protocol',
      'outcome_metric',eligibility->'outcome_metric',
      'context',eligibility->'context',
      'eligible_history_count',eligible_history_count,
      'comparison_contract','w4_protocol_session_comparability_v1'
    ) order by observed_at desc,id),'[]'::jsonb),
    coalesce(sum(eligible_history_count) filter(where rn=1),0)::int
  into v_refs,v_history_count
  from ranked
  where rn=1;

  return jsonb_build_object(
    'version','w4-personal-reference-catalog-v1',
    'status',case when jsonb_array_length(v_refs)>0 then 'PERSONAL_REFERENCES_AVAILABLE' else 'NO_PERSONAL_REFERENCE' end,
    'anchor_date',v_anchor,
    'reference_count',jsonb_array_length(v_refs),
    'eligible_history_count',v_history_count,
    'references',v_refs,
    'semantics',jsonb_build_object(
      'one_current_reference_per_exact_protocol_signature',true,
      'latest_eligible_observation_is_current_reference',true,
      'older_eligible_observations_remain_in_event_history',true,
      'no_parallel_benchmark_truth_table',true,
      'protocol_capability_and_event_history_are_reused',true,
      'reference_does_not_mean_good_or_bad',true,
      'missing_reference_is_not_weakness',true
    )
  );
end;
$$;

create or replace function public.w4_personal_reference_pair_v1(
  p_user_id uuid,
  p_current_session_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_user uuid;
  v_current_eligibility jsonb;
  v_prior jsonb;
  v_comparison jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select user_id into v_current_user from public.workout_sessions where id=p_current_session_id;
  if not found or v_current_user<>p_user_id then
    return jsonb_build_object('version','w4-personal-reference-pair-v1','status','SESSION_NOT_FOUND','session_id',p_current_session_id);
  end if;

  v_current_eligibility:=public.w4_reference_session_eligibility_v1(p_current_session_id);
  if coalesce((v_current_eligibility->>'eligible')::boolean,false)=false then
    return jsonb_build_object(
      'version','w4-personal-reference-pair-v1','status','CURRENT_SESSION_NOT_REFERENCE_ELIGIBLE','session_id',p_current_session_id,
      'current',v_current_eligibility,'reference',null,
      'semantics',jsonb_build_object('no_progress_claim_without_strict_reference',true)
    );
  end if;

  v_prior:=public.w4_protocol_comparison_reference_v1(p_user_id,p_current_session_id,p_limit);
  if v_prior->>'status'<>'STRICT_REFERENCE_AVAILABLE' then
    return jsonb_build_object(
      'version','w4-personal-reference-pair-v1','status','NO_STRICT_PRIOR_REFERENCE','session_id',p_current_session_id,
      'current',v_current_eligibility,'reference',null,'reference_search',v_prior,
      'semantics',jsonb_build_object('related_context_is_not_promoted_to_before_after_pair',true,'no_progress_claim_without_strict_reference',true)
    );
  end if;

  v_comparison:=v_prior#>'{strict_reference,comparison}';
  return jsonb_build_object(
    'version','w4-personal-reference-pair-v1',
    'status','BEFORE_AFTER_REFERENCE_READY',
    'session_id',p_current_session_id,
    'current',jsonb_build_object('session_id',p_current_session_id,'observed_at',v_current_eligibility->'observed_at','outcome_metric',v_current_eligibility->'outcome_metric','context',v_current_eligibility->'context'),
    'reference',jsonb_build_object('session_id',v_prior#>'{strict_reference,reference_session_id}','observed_at',v_prior#>'{strict_reference,observed_at}','outcome_metric',v_comparison->'right_metric','context',v_comparison->'right_context'),
    'comparison',v_comparison,
    'semantics',jsonb_build_object('before_after_pair_requires_strict_w4_comparability',true,'this_function_does_not_label_progress_or_regression',true,'metric_direction_is_preserved_for_ret003',true,'raw_outcomes_immutable',true)
  );
end;
$$;

revoke all on function public.w4_reference_session_eligibility_v1(uuid) from public,anon;
revoke all on function public.w4_personal_reference_catalog_v1(uuid,date,integer) from public,anon;
revoke all on function public.w4_personal_reference_pair_v1(uuid,uuid,integer) from public,anon;
grant execute on function public.w4_reference_session_eligibility_v1(uuid) to authenticated,service_role,postgres;
grant execute on function public.w4_personal_reference_catalog_v1(uuid,date,integer) to authenticated,service_role,postgres;
grant execute on function public.w4_personal_reference_pair_v1(uuid,uuid,integer) to authenticated,service_role,postgres;

comment on function public.w4_reference_session_eligibility_v1(uuid) is 'W4 RET-002 personal reference eligibility. A completed protocol with applied capability observation, valid outcome metric, exact signature and complete W4 context can serve as a personal reference; partial protocol outcomes remain valid when their metric is valid.';
comment on function public.w4_personal_reference_catalog_v1(uuid,date,integer) is 'W4 RET-002 personal reference catalog. Reuses protocol capability/event history and marks the latest eligible observation for each exact protocol signature as the current personal reference; no benchmark table or score.';
comment on function public.w4_personal_reference_pair_v1(uuid,uuid,integer) is 'W4 RET-002 before/after pair builder. Promotes only a strictly comparable prior protocol reference; progress interpretation is deferred to RET-003.';
