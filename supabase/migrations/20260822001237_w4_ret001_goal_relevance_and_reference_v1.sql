create or replace function public.w4_retest_reference_candidates_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_w3 jsonb;
  v_skill jsonb;
  v_strategy jsonb;
  v_items jsonb:='[]'::jsonb;
  v_unlinked jsonb:='[]'::jsonb;
  v_item jsonb;
  v_target_exercise_id text;
  v_reference_log_id bigint;
  v_skill_targets text[]:='{}'::text[];
  v_causal_prereqs text[]:='{}'::text[];
  v_program_priorities text[]:='{}'::text[];
  v_pattern_priorities text[]:='{}'::text[];
  rec record;
  v_exercises jsonb;
  v_candidate jsonb;
  v_ctx jsonb;
  v_focuses text[]:='{}'::text[];
  v_patterns text[]:='{}'::text[];
  v_relevance jsonb;
  v_reference_session_id uuid;
  v_reference_context jsonb;
  v_reference_actual jsonb;
  v_reference_desc jsonb;
  v_reference_metric jsonb;
  v_eligible boolean;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_w3:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);
  v_skill:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_strategy:=public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));

  if nullif(v_skill#>>'{current_target,exercise_id}','') is not null then
    v_skill_targets:=array_append(v_skill_targets,v_skill#>>'{current_target,exercise_id}');
  end if;
  if nullif(v_skill#>>'{next_target,exercise_id}','') is not null and not (v_skill#>>'{next_target,exercise_id}'=any(v_skill_targets)) then
    v_skill_targets:=array_append(v_skill_targets,v_skill#>>'{next_target,exercise_id}');
  end if;

  select coalesce(array_agg(distinct e.prerequisite_exercise_id::text),'{}'::text[])
  into v_causal_prereqs
  from public.skill_prerequisite_edges e
  where e.active
    and e.path_key=v_skill#>>'{path,path_key}'
    and e.target_exercise_id::text=any(v_skill_targets)
    and coalesce((e.requirement_json->>'causal_for_limiting_factor')::boolean,false)=true
    and e.prerequisite_exercise_id is not null;

  select coalesce(array_agg(distinct lower(x.value->>'key')),'{}'::text[])
  into v_program_priorities
  from jsonb_array_elements(coalesce(v_strategy->'quality_priorities','[]'::jsonb)) x(value)
  where upper(coalesce(x.value->>'role',''))='PRIORITY' and nullif(x.value->>'key','') is not null;

  select coalesce(array_agg(distinct x.value->>'key'),'{}'::text[])
  into v_pattern_priorities
  from jsonb_array_elements(coalesce(v_strategy->'movement_pattern_priorities','[]'::jsonb)) x(value)
  where nullif(x.value->>'key','') is not null;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_w3->'all_candidates','[]'::jsonb)) x(value)
    where value->>'type'='RETEST'
  loop
    v_target_exercise_id:=nullif(v_item->>'target_exercise_id','');
    v_reference_log_id:=null;
    if v_target_exercise_id is not null then
      select el.id into v_reference_log_id
      from public.exercise_logs el
      join public.performance_observation_contract poc on poc.exercise_log_id=el.id
      where el.user_id=p_user_id
        and el.exercise_id=v_target_exercise_id
        and poc.observation_role='CAPABILITY_CANDIDATE'
        and el.created_at<(v_anchor+1)::timestamptz
        and (el.reps_completed is not null or el.weight_kg is not null or el.duration_seconds is not null or el.distance_meters is not null)
      order by el.created_at desc,el.id desc
      limit 1;
    end if;

    v_item:=v_item||jsonb_build_object(
      'retest_kind','EXERCISE_CAPABILITY',
      'goal_relevance_status','W3_EVIDENCE_BACKED',
      'goal_relevance_evidence',coalesce(v_item->'evidence_ref','{}'::jsonb),
      'reference_exercise_log_id',v_reference_log_id,
      'comparison_contract','w4_performance_comparability_v1',
      'frequency_guard','REUSES_EXISTING_W3_RETEST_AUTHORITY',
      'eligible_for_coach',v_reference_log_id is not null
    );

    if v_reference_log_id is not null then v_items:=v_items||jsonb_build_array(v_item);
    else v_unlinked:=v_unlinked||jsonb_build_array(v_item||jsonb_build_object('ineligible_reason','REFERENCE_MEASUREMENT_MISSING')); end if;
  end loop;

  for rec in
    select *
    from public.user_protocol_family_capabilities
    where user_id=p_user_id and valid_evidence_count>0
    order by coalesce(last_valid_observed_at,last_observed_at) asc nulls last,family_signature
  loop
    select coalesce(jsonb_agg(jsonb_build_object('exercise_id',u.exercise_id) order by u.ord),'[]'::jsonb)
    into v_exercises
    from unnest(rec.exercise_ids) with ordinality as u(exercise_id,ord);

    v_candidate:=jsonb_strip_nulls(jsonb_build_object('mechanic',rec.mechanic_key,'variant_key',rec.variant_key,'exercises',v_exercises));
    v_ctx:=public.c4_protocol_programming_context_v1(p_user_id,v_candidate,(v_anchor+1)::timestamptz-interval '1 microsecond');

    if v_ctx#>>'{family,state}' not in ('RECALIBRATION_PENDING','STALE') then continue; end if;

    select coalesce(array_agg(distinct lower(e.training_focus)) filter(where e.training_focus is not null),'{}'::text[]),
           coalesce(array_agg(distinct e.movement_pattern) filter(where e.movement_pattern is not null),'{}'::text[])
    into v_focuses,v_patterns
    from public.exercises e
    where e.id::text=any(rec.exercise_ids);

    v_relevance:='[]'::jsonb;
    if rec.exercise_ids && v_skill_targets then
      v_relevance:=v_relevance||jsonb_build_array(jsonb_build_object('type','ACTIVE_SKILL_EXERCISE_OVERLAP','exercise_ids',to_jsonb(array(select unnest(rec.exercise_ids) intersect select unnest(v_skill_targets)))));
    end if;
    if rec.exercise_ids && v_causal_prereqs then
      v_relevance:=v_relevance||jsonb_build_array(jsonb_build_object('type','ACTIVE_SKILL_CAUSAL_PREREQUISITE_OVERLAP','exercise_ids',to_jsonb(array(select unnest(rec.exercise_ids) intersect select unnest(v_causal_prereqs)))));
    end if;
    if v_focuses && v_program_priorities then
      v_relevance:=v_relevance||jsonb_build_array(jsonb_build_object('type','CURRENT_PROGRAM_PRIORITY_FOCUS_OVERLAP','focuses',to_jsonb(array(select unnest(v_focuses) intersect select unnest(v_program_priorities)))));
    end if;
    if v_patterns && v_pattern_priorities then
      v_relevance:=v_relevance||jsonb_build_array(jsonb_build_object('type','CURRENT_PROGRAM_PATTERN_PRIORITY_OVERLAP','patterns',to_jsonb(array(select unnest(v_patterns) intersect select unnest(v_pattern_priorities)))));
    end if;

    select pe.session_id
    into v_reference_session_id
    from public.protocol_family_capability_events pe
    where pe.user_id=p_user_id
      and pe.family_signature=rec.family_signature
      and pe.applied=true
    order by pe.created_at desc,pe.id desc
    limit 1;

    v_reference_context:=null;
    v_reference_metric:=null;
    if v_reference_session_id is not null then
      v_reference_context:=public.w4_protocol_context_summary_v1(v_reference_session_id);
      select coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb) into v_reference_actual
      from public.workout_sessions ws where ws.id=v_reference_session_id;
      if found then
        v_reference_desc:=public.build_session_protocol_descriptor(v_reference_session_id);
        v_reference_metric:=public.protocol_outcome_metric_v1(v_reference_desc->>'mechanic_key',v_reference_desc->>'variant_key',v_reference_actual);
      end if;
    end if;

    v_eligible:=jsonb_array_length(v_relevance)>0
      and v_reference_session_id is not null
      and v_reference_context->>'status'='CONTEXT_AVAILABLE'
      and coalesce((v_reference_metric->>'valid')::boolean,false)=true;

    v_item:=jsonb_build_object(
      'type','PROTOCOL_RETEST',
      'retest_kind','PROTOCOL_FAMILY',
      'source','existing_protocol_capability_state',
      'family_signature',rec.family_signature,
      'mechanic_key',rec.mechanic_key,
      'variant_key',rec.variant_key,
      'exercise_ids',to_jsonb(rec.exercise_ids),
      'metric_key',rec.metric_key,
      'state',v_ctx#>>'{family,state}',
      'freshness',v_ctx#>'{family,freshness}',
      'confidence',v_ctx#>'{family,confidence}',
      'valid_evidence_count',v_ctx#>'{family,valid_evidence_count}',
      'goal_relevance_status',case when jsonb_array_length(v_relevance)>0 then 'DIRECT_CURRENT_OBJECTIVE_OR_PROGRAM_LINK' else 'NO_DIRECT_CURRENT_LINK' end,
      'goal_relevance_evidence',v_relevance,
      'reference_session_id',v_reference_session_id,
      'reference_context_status',v_reference_context->>'status',
      'reference_metric',v_reference_metric,
      'comparison_contract','w4_protocol_session_comparability_v1',
      'frequency_guard','REUSES_C4_STALE_OR_RECALIBRATION_PENDING_STATE',
      'reason_code',case when v_ctx#>>'{family,state}'='RECALIBRATION_PENDING' then 'EXISTING_PROTOCOL_RECALIBRATION_PENDING' else 'EXISTING_PROTOCOL_STATE_STALE' end,
      'eligible_for_coach',v_eligible
    );

    if v_eligible then v_items:=v_items||jsonb_build_array(v_item);
    else v_unlinked:=v_unlinked||jsonb_build_array(v_item||jsonb_build_object('ineligible_reason',case when jsonb_array_length(v_relevance)=0 then 'NO_DIRECT_CURRENT_OBJECTIVE_OR_PROGRAM_LINK' when v_reference_session_id is null then 'REFERENCE_SESSION_MISSING' when v_reference_context->>'status'<>'CONTEXT_AVAILABLE' then 'REFERENCE_CONTEXT_INCOMPLETE' else 'REFERENCE_OUTCOME_METRIC_INVALID' end)); end if;
  end loop;

  return jsonb_build_object(
    'version','w4-retest-reference-candidates-v1.1',
    'status',case when jsonb_array_length(v_items)>0 then 'RETEST_OPPORTUNITIES_IDENTIFIED' else 'NO_RETEST_OPPORTUNITY' end,
    'anchor_date',v_anchor,
    'eligible_items',v_items,
    'not_promoted_items',v_unlinked,
    'context',jsonb_build_object(
      'active_skill_path',v_skill#>>'{path,path_key}',
      'active_skill_targets',to_jsonb(v_skill_targets),
      'active_skill_causal_prerequisites',to_jsonb(v_causal_prereqs),
      'current_program_priority_focuses',to_jsonb(v_program_priorities),
      'current_program_pattern_priorities',to_jsonb(v_pattern_priorities)
    ),
    'semantics',jsonb_build_object(
      'retest_is_opportunity_not_obligation',true,
      'no_new_freshness_threshold',true,
      'protocol_staleness_reuses_existing_c4_protocol_programming_context',true,
      'w3_retest_signals_are_reused',true,
      'goal_relevance_requires_direct_current_evidence',true,
      'protocol_reference_requires_context_and_valid_outcome_metric',true,
      'frequency_guard_reuses_existing_authorities',true,
      'missing_retest_opportunity_is_not_weakness',true,
      'no_new_retest_cooldown_threshold',true
    )
  );
end;
$$;

revoke all on function public.w4_retest_reference_candidates_v1(uuid,date) from public,anon;
grant execute on function public.w4_retest_reference_candidates_v1(uuid,date) to authenticated,service_role,postgres;

comment on function public.w4_retest_reference_candidates_v1(uuid,date) is 'W4 RET-001: identifies retest opportunities only when existing staleness/retest authorities, a usable reference, and direct active Skill/program relevance are all present. No new freshness or cooldown thresholds.';
