create or replace function public.w4_goal_gap_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_skill jsonb;
  v_path_key text;
  v_target jsonb;
  v_target_id text;
  v_target_kind text;
  v_factor jsonb;
  v_requirements jsonb:='[]'::jsonb;
  v_item jsonb;
  v_status text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_skill:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_path_key:=v_skill#>>'{path,path_key}';

  if nullif(v_path_key,'') is null then
    return jsonb_build_object(
      'version','w4-goal-gap-v1',
      'status','NO_ACTIVE_SKILL_OBJECTIVE',
      'anchor_date',v_anchor,
      'semantics',jsonb_build_object(
        'missing_goal_is_not_weakness',true,
        'no_population_norm_used',true,
        'no_unvalidated_requirement_added',true
      )
    );
  end if;

  if v_skill->'next_target' is not null and v_skill->'next_target'<>'null'::jsonb then
    v_target:=v_skill->'next_target';
    v_target_kind:='NEXT_TARGET';
  else
    v_target:=v_skill->'current_target';
    v_target_kind:='CURRENT_TARGET';
  end if;

  v_target_id:=nullif(v_target->>'exercise_id','');
  if v_target_id is null then
    return jsonb_build_object(
      'version','w4-goal-gap-v1',
      'status','NO_TARGET_AVAILABLE',
      'anchor_date',v_anchor,
      'path',v_skill->'path',
      'active_skill_status',v_skill->>'status',
      'semantics',jsonb_build_object(
        'missing_target_is_not_weakness',true,
        'no_population_norm_used',true,
        'no_unvalidated_requirement_added',true
      )
    );
  end if;

  v_factor:=public.w3_limiting_factor_snapshot_v1(p_user_id,v_path_key,v_target_id,v_anchor);

  for v_item in
    select value from jsonb_array_elements(coalesce(v_factor->'prerequisites','[]'::jsonb)) x(value)
  loop
    v_requirements:=v_requirements||jsonb_build_array(jsonb_build_object(
      'exercise_id',v_item->>'prerequisite_exercise_id',
      'exercise_name',v_item->>'prerequisite_exercise_name',
      'prerequisite_kind',v_item->>'prerequisite_kind',
      'status',case v_item->>'evaluation_status'
        when 'CALIBRATION_NEEDED' then 'TO_CALIBRATE'
        when 'PROBABLE_LIMITING_FACTOR' then 'LIMITING'
        else 'SUPPORTED_OR_OBSERVED'
      end,
      'evaluation_status',v_item->>'evaluation_status',
      'evaluation_reason',v_item->>'evaluation_reason',
      'capability_role',v_item#>>'{requirement,capability_role}',
      'source',jsonb_strip_nulls(jsonb_build_object(
        'source_key',v_item->>'graph_source',
        'source_title',v_item#>>'{requirement,source_title}',
        'source_url',v_item#>>'{requirement,source_url}',
        'rationale',v_item->>'rationale'
      )),
      'qualitative_only',coalesce((v_item#>>'{requirement,qualitative_only}')::boolean,true)
    ));
  end loop;

  v_status:=case
    when coalesce((v_factor#>>'{summary,probable_limiting_factor_count}')::int,0)>0 then 'LIMITING_FACTORS_IDENTIFIED'
    when coalesce((v_factor#>>'{summary,calibration_need_count}')::int,0)>0 then 'CALIBRATION_NEEDED'
    when v_target_kind='CURRENT_TARGET' and v_skill->>'status'='CALIBRATION_NEEDED' then 'TARGET_CALIBRATION_NEEDED'
    when jsonb_array_length(v_requirements)>0 then 'REQUIREMENTS_SUPPORTED'
    else 'TARGET_IN_PROGRESS_WITHOUT_CAUSAL_GAP'
  end;

  return jsonb_build_object(
    'version','w4-goal-gap-v1',
    'status',v_status,
    'anchor_date',v_anchor,
    'path',v_skill->'path',
    'active_skill_status',v_skill->>'status',
    'target_kind',v_target_kind,
    'target',v_target,
    'requirements',v_requirements,
    'summary',jsonb_build_object(
      'requirement_count',jsonb_array_length(v_requirements),
      'limiting_count',coalesce((v_factor#>>'{summary,probable_limiting_factor_count}')::int,0),
      'to_calibrate_count',coalesce((v_factor#>>'{summary,calibration_need_count}')::int,0),
      'structural_relation_count',coalesce((v_factor#>>'{summary,structural_or_supporting_edges}')::int,0)
    ),
    'evidence',jsonb_build_object(
      'active_skill_objective',v_skill,
      'limiting_factor_snapshot',v_factor
    ),
    'semantics',jsonb_build_object(
      'goal_comparison_uses_only_curated_skill_prerequisites',true,
      'only_source_backed_causal_edges_describe_required_capabilities',true,
      'structural_path_order_is_not_a_limiting_factor',true,
      'missing_evidence_means_calibration_not_weakness',true,
      'no_population_norm_used',true,
      'no_fixed_rep_time_or_load_threshold_added',true,
      'no_percentage_to_goal_claim',true
    )
  );
end;
$$;

create or replace function public.w4_normative_policy_v1()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'version','w4-normative-policy-v1',
    'status','POLICY_ACTIVE_EXTERNAL_SOURCE_PENDING_ARBITRATION',
    'priority_order',jsonb_build_array(
      jsonb_build_object('axis','SELF_OVER_TIME','status','ACTIVE','authority','W4 strict personal references + Capability evidence'),
      jsonb_build_object('axis','OBJECTIVE_REQUIREMENT','status','ACTIVE','authority','Curated source-backed Skill prerequisites'),
      jsonb_build_object('axis','COMPARABLE_POPULATION','status','DISABLED_PENDING_APPROVED_SOURCE','authority',null)
    ),
    'external_reference_contract',jsonb_build_object(
      'source_must_be_approved',true,
      'methodology_must_be_documented',true,
      'license_or_usage_terms_must_be_documented',true,
      'population_and_date_must_be_documented',true,
      'movement_coverage_must_be_explicit',true,
      'normalization_only_if_supported_by_source',true,
      'percentile_requires_validated_dataset',true,
      'no_extrapolation_to_uncovered_skills',true,
      'source_version_and_confidence_visible_to_user',true
    ),
    'semantics',jsonb_build_object(
      'self_vs_self_is_primary',true,
      'goal_gap_is_more_actionable_than_population_percentile',true,
      'external_norm_is_optional_context_not_programming_authority',true,
      'no_external_percentile_until_source_arbitration',true
    )
  );
$$;

create or replace function public.w4_progression_intelligence_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_latest_session uuid;
  v_goal jsonb;
  v_retest jsonb;
  v_reference jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select ws.id into v_latest_session
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and ws.status='completed'
    and coalesce(ws.completed_at,ws.updated_at,ws.created_at)<(v_anchor+1)::timestamptz
  order by coalesce(ws.completed_at,ws.updated_at,ws.created_at) desc,ws.id desc
  limit 1;

  v_goal:=public.w4_goal_gap_v1(p_user_id,v_anchor);
  v_retest:=public.w4_retest_reference_candidates_v1(p_user_id,v_anchor);
  if v_latest_session is not null then
    v_reference:=public.w4_reference_progress_v1(p_user_id,v_latest_session,50);
  else
    v_reference:=jsonb_build_object('version','w4-reference-progress-v1','status','NO_COMPLETED_SESSION');
  end if;

  return jsonb_build_object(
    'version','w4-progression-intelligence-v1',
    'status','READY',
    'anchor_date',v_anchor,
    'latest_completed_session_id',v_latest_session,
    'personal_reference_progress',v_reference,
    'goal_gap',v_goal,
    'retest',v_retest,
    'normative_policy',public.w4_normative_policy_v1(),
    'semantics',jsonb_build_object(
      'self_vs_self_requires_strict_comparability',true,
      'goal_gap_requires_curated_prerequisites',true,
      'population_comparison_disabled_until_source_arbitration',true,
      'missing_evidence_is_not_weakness',true
    )
  );
end;
$$;

revoke all on function public.w4_goal_gap_v1(uuid,date) from public,anon;
grant execute on function public.w4_goal_gap_v1(uuid,date) to authenticated,service_role,postgres;
revoke all on function public.w4_normative_policy_v1() from public,anon;
grant execute on function public.w4_normative_policy_v1() to authenticated,service_role,postgres;
revoke all on function public.w4_progression_intelligence_v1(uuid,date) from public,anon;
grant execute on function public.w4_progression_intelligence_v1(uuid,date) to authenticated,service_role,postgres;

comment on function public.w4_goal_gap_v1(uuid,date) is 'W4 NOR-003: compares the active Skill objective to source-backed causal prerequisites only; missing evidence is calibration, never weakness; no population norm or new sport threshold.';
comment on function public.w4_normative_policy_v1() is 'W4 NOR-001 strategy contract: self vs self first, objective requirements second, comparable population optional and disabled until explicit source/method arbitration.';
comment on function public.w4_progression_intelligence_v1(uuid,date) is 'Read-only W4 front snapshot combining strict personal-reference progress, objective gap, retest opportunity and normative policy.';
