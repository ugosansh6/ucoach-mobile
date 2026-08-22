create or replace function public.w4_performance_context_class_v1(p_context jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_context is null then 'CONTEXT_UNAVAILABLE'
    when p_context#>>'{prescription_structure,block_key}'='skill'
      and coalesce((p_context#>>'{sequence_context,block_exercise_count}')::int,0)=1
      and coalesce(p_context#>'{sequence_context,previous}','null'::jsonb)='null'::jsonb
      and coalesce((p_context#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)=false
      then 'ISOLATED_SKILL_OBSERVATION'
    when p_context#>>'{prescription_structure,block_key}'='wod'
      and (
        coalesce((p_context#>>'{sequence_context,previous,has_primary_local_muscle_overlap}')::boolean,false)
        or coalesce((p_context#>>'{sequence_context,cycle_predecessor,has_primary_local_muscle_overlap}')::boolean,false)
        or coalesce((p_context#>>'{sequence_context,protocol_repeat_evidence}')::boolean,false)
        or p_context#>'{fatigue_context,whole_wod_local_fatigue_fit}' is not null
        or p_context#>'{fatigue_context,whole_wod_local_fatigue_concentration_index}' is not null
      ) then 'FATIGUE_CONTEXT_PRESENT'
    else 'CONTEXTUAL_OBSERVATION'
  end
$$;

create or replace function public.w4_capability_comparison_reference_v1(
  p_user_id uuid,
  p_exercise_id text,
  p_anchor_date date default current_date,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_limit integer:=greatest(2,least(coalesce(p_limit,20),100));
  v_latest_id bigint;
  v_latest_at timestamptz;
  v_pairs jsonb:='[]'::jsonb;
  v_strict jsonb;
  v_related jsonb;
  v_strict_count integer:=0;
  v_related_count integer:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select el.id,el.created_at into v_latest_id,v_latest_at
  from public.exercise_logs el
  join public.performance_observation_contract poc on poc.exercise_log_id=el.id
  where el.user_id=p_user_id
    and el.exercise_id=p_exercise_id
    and poc.observation_role='CAPABILITY_CANDIDATE'
    and el.created_at < (v_anchor+1)::timestamptz
    and (el.reps_completed is not null or el.weight_kg is not null or el.duration_seconds is not null or el.distance_meters is not null)
  order by el.created_at desc,el.id desc
  limit 1;

  if v_latest_id is null then
    return jsonb_build_object(
      'version','w4-capability-comparison-reference-v1',
      'status','NO_MEASURED_CAPABILITY_OBSERVATION',
      'exercise_id',p_exercise_id,
      'anchor_date',v_anchor,
      'semantics',jsonb_build_object('missing_reference_is_not_weakness',true,'raw_performance_immutable',true,'no_numeric_similarity_score',true)
    );
  end if;

  with prior as (
    select el.id,el.created_at
    from public.exercise_logs el
    join public.performance_observation_contract poc on poc.exercise_log_id=el.id
    where el.user_id=p_user_id
      and el.exercise_id=p_exercise_id
      and poc.observation_role='CAPABILITY_CANDIDATE'
      and (el.created_at,el.id)<(v_latest_at,v_latest_id)
      and (el.reps_completed is not null or el.weight_kg is not null or el.duration_seconds is not null or el.distance_meters is not null)
    order by el.created_at desc,el.id desc
    limit v_limit-1
  ), evaluated as (
    select p.id,p.created_at,public.w4_performance_comparability_v1(v_latest_id,p.id) cmp from prior p
  )
  select coalesce(jsonb_agg(jsonb_build_object('reference_exercise_log_id',id,'observed_at',created_at,'comparison',cmp) order by created_at desc,id desc),'[]'::jsonb)
  into v_pairs from evaluated;

  select value into v_strict from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}'='STRICTLY_COMPARABLE' limit 1;
  select value into v_related from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}'='RELATED_CONTEXT' limit 1;
  select count(*)::int into v_strict_count from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}'='STRICTLY_COMPARABLE';
  select count(*)::int into v_related_count from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}'='RELATED_CONTEXT';

  return jsonb_build_object(
    'version','w4-capability-comparison-reference-v1',
    'status',case when v_strict is not null then 'STRICT_REFERENCE_AVAILABLE' when v_related is not null then 'RELATED_REFERENCE_ONLY' else 'NO_COMPARABLE_REFERENCE' end,
    'exercise_id',p_exercise_id,'anchor_date',v_anchor,'latest_exercise_log_id',v_latest_id,'latest_observed_at',v_latest_at,
    'strict_reference',v_strict,'related_reference',v_related,
    'summary',jsonb_build_object('evaluated_prior_observations',jsonb_array_length(v_pairs),'strictly_comparable',v_strict_count,'related_context',v_related_count),
    'comparisons',v_pairs,
    'semantics',jsonb_build_object('capability_envelope_is_not_rewritten',true,'strict_reference_requires_w4_comparability',true,'related_context_is_not_used_as_equal_reference',true,'no_numeric_similarity_score',true,'missing_reference_is_not_weakness',true)
  );
end;
$$;

create or replace function public.w4_protocol_context_summary_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_user uuid;
  v_items jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_partial integer:=0;
  v_classes text[]:='{}'::text[];
  v_class text;
begin
  select user_id into v_session_user from public.workout_sessions where id=p_session_id;
  if not found then return jsonb_build_object('version','w4-protocol-context-summary-v1','status','NO_SESSION','session_id',p_session_id); end if;
  if auth.uid() is not null and auth.uid()<>v_session_user then return jsonb_build_object('version','w4-protocol-context-summary-v1','status','NOT_FOUND_OR_FORBIDDEN','session_id',p_session_id); end if;

  with contexts as (
    select el.id,el.created_at,public.w4_performance_context_v1(el.id) ctx
    from public.exercise_logs el
    join public.performance_observation_contract poc on poc.exercise_log_id=el.id
    where el.session_id=p_session_id and coalesce(poc.block_key,el.observation_context_json->>'block_key')='wod'
    order by el.created_at,el.id
  ), built as (
    select id,created_at,ctx,public.w4_performance_context_class_v1(ctx) context_class from contexts
  )
  select coalesce(jsonb_agg(jsonb_build_object('exercise_log_id',id,'context_class',context_class,'context_status',ctx->>'status','exercise_id',ctx#>>'{exercise,exercise_id}','position',ctx#>'{prescription_structure,position}') order by created_at,id),'[]'::jsonb),
    count(*)::int,count(*) filter(where ctx->>'status'='PARTIAL_CONTEXT')::int,coalesce(array_agg(distinct context_class order by context_class),'{}'::text[])
  into v_items,v_count,v_partial,v_classes from built;

  v_class:=case when v_count=0 then 'NO_WOD_OBSERVATIONS' when v_partial>0 then 'PARTIAL_CONTEXT' when cardinality(v_classes)=1 then v_classes[1] else 'MIXED_CONTEXT' end;

  return jsonb_build_object(
    'version','w4-protocol-context-summary-v1',
    'status',case when v_count=0 then 'NO_WOD_OBSERVATIONS' when v_partial>0 then 'PARTIAL_CONTEXT' else 'CONTEXT_AVAILABLE' end,
    'session_id',p_session_id,'context_class',v_class,'wod_observation_count',v_count,'context_classes',to_jsonb(v_classes),'observations',v_items,
    'semantics',jsonb_build_object('context_class_is_qualitative',true,'no_context_score',true,'no_fatigue_multiplier',true,'missing_context_is_not_weakness',true)
  );
end;
$$;

create or replace function public.w4_protocol_session_comparability_v1(p_left_session_id uuid,p_right_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l_user uuid; r_user uuid;
  l_desc jsonb; r_desc jsonb;
  l_family jsonb; r_family jsonb;
  l_actual jsonb; r_actual jsonb;
  l_metric jsonb; r_metric jsonb;
  l_ctx jsonb; r_ctx jsonb;
  v_status text;
  v_reasons jsonb:='[]'::jsonb;
begin
  if p_left_session_id=p_right_session_id then return jsonb_build_object('version','w4-protocol-session-comparability-v1','status','SAME_SESSION','comparable',false); end if;
  select user_id,coalesce(actual_protocol_outcome_json,'{}'::jsonb) into l_user,l_actual from public.workout_sessions where id=p_left_session_id;
  if not found then return jsonb_build_object('version','w4-protocol-session-comparability-v1','status','LEFT_SESSION_NOT_FOUND','comparable',false); end if;
  select user_id,coalesce(actual_protocol_outcome_json,'{}'::jsonb) into r_user,r_actual from public.workout_sessions where id=p_right_session_id;
  if not found then return jsonb_build_object('version','w4-protocol-session-comparability-v1','status','RIGHT_SESSION_NOT_FOUND','comparable',false); end if;
  if auth.uid() is not null and (auth.uid()<>l_user or auth.uid()<>r_user) then return jsonb_build_object('version','w4-protocol-session-comparability-v1','status','NOT_FOUND_OR_FORBIDDEN','comparable',false); end if;
  if l_user<>r_user then return jsonb_build_object('version','w4-protocol-session-comparability-v1','status','DIFFERENT_USER','comparable',false); end if;

  l_desc:=public.build_session_protocol_descriptor(p_left_session_id);
  r_desc:=public.build_session_protocol_descriptor(p_right_session_id);
  l_family:=public.build_session_protocol_family_descriptor(p_left_session_id);
  r_family:=public.build_session_protocol_family_descriptor(p_right_session_id);
  l_metric:=public.protocol_outcome_metric_v1(l_desc->>'mechanic_key',l_desc->>'variant_key',l_actual);
  r_metric:=public.protocol_outcome_metric_v1(r_desc->>'mechanic_key',r_desc->>'variant_key',r_actual);
  l_ctx:=public.w4_protocol_context_summary_v1(p_left_session_id);
  r_ctx:=public.w4_protocol_context_summary_v1(p_right_session_id);

  if coalesce((l_metric->>'valid')::boolean,false)=false or coalesce((r_metric->>'valid')::boolean,false)=false or l_metric->>'metric_key' is distinct from r_metric->>'metric_key' then
    v_status:='DIFFERENT_METRIC'; v_reasons:=jsonb_build_array('no_shared_protocol_outcome_metric');
  elsif l_desc->>'protocol_signature'=r_desc->>'protocol_signature' and l_ctx->>'context_class'=r_ctx->>'context_class' and l_ctx->>'status'='CONTEXT_AVAILABLE' and r_ctx->>'status'='CONTEXT_AVAILABLE' then
    v_status:='STRICTLY_COMPARABLE'; v_reasons:=jsonb_build_array('same_exact_protocol_signature','same_outcome_metric','same_qualitative_context_class');
  elsif l_desc->>'protocol_signature'=r_desc->>'protocol_signature' then
    v_status:='RELATED_CONTEXT'; v_reasons:=jsonb_build_array('same_exact_protocol_signature','same_outcome_metric','context_differs_or_incomplete');
  elsif l_family->>'family_signature'=r_family->>'family_signature' then
    v_status:='RELATED_PROTOCOL_FAMILY'; v_reasons:=jsonb_build_array('same_protocol_family','same_outcome_metric','exact_protocol_differs');
    if l_ctx->>'context_class' is distinct from r_ctx->>'context_class' then v_reasons:=v_reasons||jsonb_build_array('context_class_differs'); end if;
  else
    v_status:='DIFFERENT_PROTOCOL'; v_reasons:=jsonb_build_array('protocol_family_differs');
  end if;

  return jsonb_build_object(
    'version','w4-protocol-session-comparability-v1','status',v_status,'comparable',v_status='STRICTLY_COMPARABLE','related_context',v_status in ('RELATED_CONTEXT','RELATED_PROTOCOL_FAMILY'),
    'left_session_id',p_left_session_id,'right_session_id',p_right_session_id,'metric_key',case when l_metric->>'metric_key' is not distinct from r_metric->>'metric_key' then l_metric->>'metric_key' else null end,
    'left_metric',l_metric,'right_metric',r_metric,
    'left_protocol',jsonb_build_object('protocol_signature',l_desc->>'protocol_signature','family_signature',l_family->>'family_signature','mechanic_key',l_desc->>'mechanic_key','variant_key',l_desc->>'variant_key'),
    'right_protocol',jsonb_build_object('protocol_signature',r_desc->>'protocol_signature','family_signature',r_family->>'family_signature','mechanic_key',r_desc->>'mechanic_key','variant_key',r_desc->>'variant_key'),
    'left_context',l_ctx,'right_context',r_ctx,'reasons',v_reasons,
    'semantics',jsonb_build_object('exact_protocol_signature_is_structural_comparison_authority',true,'context_class_must_match_for_strict_comparability',true,'protocol_family_match_is_related_not_strict',true,'no_numeric_similarity_score',true,'no_better_or_worse_claim_in_this_function',true,'raw_outcomes_immutable',true)
  );
end;
$$;

create or replace function public.w4_protocol_comparison_reference_v1(p_user_id uuid,p_session_id uuid,p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer:=greatest(2,least(coalesce(p_limit,20),100));
  v_current_at timestamptz;
  v_pairs jsonb:='[]'::jsonb;
  v_strict jsonb;
  v_related jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select coalesce(completed_at,created_at) into v_current_at from public.workout_sessions where id=p_session_id and user_id=p_user_id;
  if not found then return jsonb_build_object('version','w4-protocol-comparison-reference-v1','status','SESSION_NOT_FOUND','session_id',p_session_id); end if;

  with prior as (
    select ws.id,coalesce(ws.completed_at,ws.created_at) observed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.id<>p_session_id and coalesce(ws.completed_at,ws.created_at)<v_current_at and coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb)<>'{}'::jsonb
    order by coalesce(ws.completed_at,ws.created_at) desc,ws.id limit v_limit-1
  ), evaluated as (
    select p.id,p.observed_at,public.w4_protocol_session_comparability_v1(p_session_id,p.id) cmp from prior p
  )
  select coalesce(jsonb_agg(jsonb_build_object('reference_session_id',id,'observed_at',observed_at,'comparison',cmp) order by observed_at desc,id),'[]'::jsonb)
  into v_pairs from evaluated;

  select value into v_strict from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}'='STRICTLY_COMPARABLE' limit 1;
  select value into v_related from jsonb_array_elements(v_pairs) where value#>>'{comparison,status}' in ('RELATED_CONTEXT','RELATED_PROTOCOL_FAMILY') limit 1;

  return jsonb_build_object(
    'version','w4-protocol-comparison-reference-v1','status',case when v_strict is not null then 'STRICT_REFERENCE_AVAILABLE' when v_related is not null then 'RELATED_REFERENCE_ONLY' else 'NO_COMPARABLE_REFERENCE' end,
    'session_id',p_session_id,'strict_reference',v_strict,'related_reference',v_related,'comparisons',v_pairs,
    'semantics',jsonb_build_object('strict_reference_requires_w4_protocol_comparability',true,'related_protocol_family_is_not_used_as_equal_reference',true,'no_numeric_similarity_score',true,'missing_reference_is_not_weakness',true)
  );
end;
$$;

create or replace function public.w4_retest_reference_candidates_v1(p_user_id uuid,p_anchor_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_w3 jsonb;
  v_items jsonb:='[]'::jsonb;
  rec record;
  v_exercises jsonb;
  v_candidate jsonb;
  v_ctx jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_w3:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(v_w3->'all_candidates','[]'::jsonb)) x(value)
  where value->>'type'='RETEST';

  for rec in select * from public.user_protocol_family_capabilities where user_id=p_user_id and valid_evidence_count>0 order by coalesce(last_valid_observed_at,last_observed_at) asc nulls last,family_signature
  loop
    select coalesce(jsonb_agg(jsonb_build_object('exercise_id',u.exercise_id) order by u.ord),'[]'::jsonb)
    into v_exercises from unnest(rec.exercise_ids) with ordinality as u(exercise_id,ord);
    v_candidate:=jsonb_strip_nulls(jsonb_build_object('mechanic',rec.mechanic_key,'variant_key',rec.variant_key,'exercises',v_exercises));
    v_ctx:=public.c4_protocol_programming_context_v1(p_user_id,v_candidate,(v_anchor+1)::timestamptz-interval '1 microsecond');
    if v_ctx#>>'{family,state}' in ('RECALIBRATION_PENDING','STALE') then
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'type','PROTOCOL_RETEST','source','existing_protocol_capability_state','family_signature',rec.family_signature,'mechanic_key',rec.mechanic_key,'variant_key',rec.variant_key,'exercise_ids',to_jsonb(rec.exercise_ids),'metric_key',rec.metric_key,
        'state',v_ctx#>>'{family,state}','freshness',v_ctx#>'{family,freshness}','confidence',v_ctx#>'{family,confidence}','valid_evidence_count',v_ctx#>'{family,valid_evidence_count}',
        'goal_relevance_status','NOT_YET_LINKED','reason_code',case when v_ctx#>>'{family,state}'='RECALIBRATION_PENDING' then 'EXISTING_PROTOCOL_RECALIBRATION_PENDING' else 'EXISTING_PROTOCOL_STATE_STALE' end
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'version','w4-retest-reference-candidates-v1','status',case when jsonb_array_length(v_items)>0 then 'RETEST_SIGNALS_IDENTIFIED' else 'NO_RETEST_SIGNAL' end,'anchor_date',v_anchor,'items',v_items,
    'semantics',jsonb_build_object('retest_is_opportunity_not_obligation',true,'no_new_freshness_threshold',true,'protocol_staleness_reuses_existing_c4_protocol_programming_context',true,'w3_retest_signals_are_reused',true,'goal_relevance_link_is_required_before_ret001_completion',true,'missing_retest_signal_is_not_weakness',true)
  );
end;
$$;

revoke all on function public.w4_performance_context_class_v1(jsonb) from public,anon;
revoke all on function public.w4_capability_comparison_reference_v1(uuid,text,date,integer) from public,anon;
revoke all on function public.w4_protocol_context_summary_v1(uuid) from public,anon;
revoke all on function public.w4_protocol_session_comparability_v1(uuid,uuid) from public,anon;
revoke all on function public.w4_protocol_comparison_reference_v1(uuid,uuid,integer) from public,anon;
revoke all on function public.w4_retest_reference_candidates_v1(uuid,date) from public,anon;

grant execute on function public.w4_performance_context_class_v1(jsonb) to authenticated,service_role,postgres;
grant execute on function public.w4_capability_comparison_reference_v1(uuid,text,date,integer) to authenticated,service_role,postgres;
grant execute on function public.w4_protocol_context_summary_v1(uuid) to authenticated,service_role,postgres;
grant execute on function public.w4_protocol_session_comparability_v1(uuid,uuid) to authenticated,service_role,postgres;
grant execute on function public.w4_protocol_comparison_reference_v1(uuid,uuid,integer) to authenticated,service_role,postgres;
grant execute on function public.w4_retest_reference_candidates_v1(uuid,date) to authenticated,service_role,postgres;

comment on function public.w4_capability_comparison_reference_v1(uuid,text,date,integer) is 'W4 CTX-002 capability comparison reader. Chooses only W4 strictly comparable observations as equal references; related context remains visible but non-equivalent.';
comment on function public.w4_protocol_session_comparability_v1(uuid,uuid) is 'W4 CTX-002 protocol comparator. Exact protocol signature + shared outcome metric + same qualitative W4 context class are required for strict comparability.';
comment on function public.w4_protocol_comparison_reference_v1(uuid,uuid,integer) is 'W4 CTX-002 protocol reference reader for a completed session; strict and related references are separated.';
comment on function public.w4_retest_reference_candidates_v1(uuid,date) is 'W4 RET-001 foundation. Reuses existing W3 RETEST signals and existing C4 protocol stale/recalibration states; objective relevance is intentionally not yet claimed.';
