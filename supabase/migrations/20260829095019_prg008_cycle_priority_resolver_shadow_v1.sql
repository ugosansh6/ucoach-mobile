create or replace function public.program_coach_cycle_priority_from_inputs_v1(
  p_diagnostic jsonb,
  p_environment_access jsonb,
  p_active_block jsonb default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_patterns jsonb := coalesce(p_diagnostic->'movement_pattern_diagnosis','[]'::jsonb);
  v_qualities jsonb := coalesce(p_diagnostic->'quality_direction','[]'::jsonb);
  v_primary jsonb := null;
  v_secondary jsonb := null;
  v_quality_primary jsonb := null;
  v_maintenance jsonb := '[]'::jsonb;
  v_unknown jsonb := '[]'::jsonb;
  v_supporting jsonb := '[]'::jsonb;
  v_goal text := p_diagnostic->>'primary_goal';
  v_block_goal text := nullif(p_active_block->>'primary_goal','');
  v_block_id text := nullif(p_active_block->>'id','');
  v_continuity text;
begin
  select jsonb_build_object(
    'kind','MOVEMENT_PATTERN','key',x->>'movement_pattern','programming_state','DEVELOP',
    'priority_reason','CAUSAL_LIMITING_FACTOR_FOR_ACTIVE_SKILL','evidence_strength',x->>'evidence_strength',
    'reason_codes',coalesce(x->'reason_codes','[]'::jsonb),'causal_requirements',coalesce(x->'causal_requirements','[]'::jsonb)
  ) into v_primary
  from jsonb_array_elements(v_patterns) x
  where x->>'programming_state'='LIMITING' and x->>'evidence_strength'='CAUSAL'
  limit 1;

  if v_primary is null then
    select jsonb_build_object(
      'kind','MOVEMENT_PATTERN','key',x->>'movement_pattern','programming_state','DEVELOP',
      'priority_reason','ACTIVE_SKILL_TARGET','evidence_strength',x->>'evidence_strength',
      'reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
    ) into v_primary
    from jsonb_array_elements(v_patterns) x
    where x->>'programming_state'='TO_DEVELOP' and x->>'evidence_strength'='DIRECT_GOAL'
    limit 1;
  end if;

  select jsonb_build_object(
    'kind','QUALITY','key',x->>'quality_key','programming_state','DEVELOP',
    'priority_reason','PRIMARY_GOAL_DIRECTION','goal_role',x->>'goal_role',
    'reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
  ) into v_quality_primary
  from jsonb_array_elements(v_qualities) x
  where x->>'programming_state'='TO_DEVELOP'
  order by case x->>'goal_role' when 'PRIORITY' then 1 when 'DEVELOP' then 2 else 3 end
  limit 1;

  if v_primary is null then v_primary := v_quality_primary; else v_secondary := v_quality_primary; end if;

  if v_primary is not null and v_primary->>'kind'='QUALITY' then
    select jsonb_build_object(
      'kind','QUALITY','key',x->>'quality_key','programming_state','DEVELOP',
      'priority_reason','SECONDARY_GOAL_DIRECTION','goal_role',x->>'goal_role',
      'reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
    ) into v_secondary
    from jsonb_array_elements(v_qualities) x
    where x->>'programming_state'='TO_DEVELOP' and x->>'quality_key' <> v_primary->>'key'
    order by case x->>'goal_role' when 'PRIORITY' then 1 when 'DEVELOP' then 2 else 3 end
    limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind','QUALITY','key',x->>'quality_key','programming_state','MAINTAIN','goal_role',x->>'goal_role',
    'reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
  ) order by x->>'quality_key'),'[]'::jsonb)
  into v_maintenance
  from jsonb_array_elements(v_qualities) x
  where x->>'programming_state'='MAINTAIN'
    and (v_primary is null or x->>'quality_key' <> coalesce(v_primary->>'key',''))
    and (v_secondary is null or x->>'quality_key' <> coalesce(v_secondary->>'key',''));

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_pattern',x->>'movement_pattern','reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
  ) order by x->>'movement_pattern'),'[]'::jsonb)
  into v_unknown from jsonb_array_elements(v_patterns) x
  where x->>'programming_state'='UNKNOWN';

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_pattern',x->>'movement_pattern','programming_state',x->>'programming_state',
    'evidence_strength',x->>'evidence_strength','reason_codes',coalesce(x->'reason_codes','[]'::jsonb),
    'legacy_pi_evidence',coalesce(x->'legacy_pi_evidence','{}'::jsonb)
  ) order by x->>'movement_pattern'),'[]'::jsonb)
  into v_supporting from jsonb_array_elements(v_patterns) x
  where x->>'evidence_strength'='SUPPORTING_OBSERVATION';

  v_continuity := case
    when v_block_id is null then 'PROPOSE_BASE_BLOCK'
    when v_block_goal is distinct from v_goal then 'REVIEW_ACTIVE_BLOCK_GOAL_CHANGED'
    else 'KEEP_ACTIVE_BLOCK_UNTIL_REVIEW'
  end;

  return jsonb_build_object(
    'version','program-coach-cycle-priority-from-inputs-v1','mode','SHADOW_READ_ONLY',
    'status',case when v_primary is null then 'INSUFFICIENT_EVIDENCE' else 'PRIORITY_CANDIDATE_READY' end,
    'primary_goal',v_goal,'primary_priority',v_primary,'secondary_priority',v_secondary,
    'maintenance',v_maintenance,'unknown_patterns',v_unknown,'supporting_observation_signals',v_supporting,
    'environment_context',jsonb_build_object(
      'status',coalesce(p_environment_access->>'status','UNDECLARED'),
      'primary_environment',p_environment_access->'primary_environment',
      'accessible_environment_codes',coalesce(p_environment_access->'accessible_environment_codes','[]'::jsonb),
      'never_environment_codes',coalesce(p_environment_access->'never_environment_codes','[]'::jsonb),
      'used_as_hard_priority_score',false
    ),
    'continuity',jsonb_build_object(
      'action',v_continuity,'active_block_id',v_block_id,'active_block_goal',v_block_goal,
      'candidate_replaces_active_block_now',false,'review_required_before_priority_switch',true
    ),
    'decision_order',jsonb_build_array(
      'ACTIVE_SKILL_CAUSAL_LIMITER','ACTIVE_SKILL_EXPLICIT_TARGET','PRIMARY_GOAL_DIRECTION','SUPPORTING_OBSERVATIONS_ONLY'
    ),
    'principles',jsonb_build_object(
      'one_primary_priority',true,'at_most_one_secondary_priority',true,
      'priority_persists_until_review_reason',true,'missing_evidence_is_unknown_not_weakness',true,
      'legacy_pi_score_cannot_win_cycle_priority_alone',true,
      'environment_never_cannot_be_required_later',true,
      'safety_readiness_and_feasibility_remain_higher_authority',true,'no_generation_authority',true
    )
  );
end;
$$;

revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_cycle_priority_resolver_v1(
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
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_diag jsonb;
  v_env jsonb;
  v_block jsonb := null;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_diag := public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_env := public.program_coach_environment_access_v1(p_user_id);

  select jsonb_build_object(
    'id',b.id,'layer_type',b.layer_type,'program_kind',b.program_kind,'status',b.status,
    'primary_goal',b.primary_goal,'phase',b.phase,'started_on',b.started_on,'target_end_on',b.target_end_on,
    'current_week_index',b.current_week_index,'legacy_priorities',b.priorities_json
  ) into v_block
  from public.program_coach_blocks b
  where b.user_id=p_user_id and b.layer_type='BASE' and b.status='active'
  order by b.started_on desc,b.created_at desc limit 1;

  return public.program_coach_cycle_priority_from_inputs_v1(v_diag,v_env,v_block)
    || jsonb_build_object(
      'version','program-coach-cycle-priority-resolver-v1','anchor_date',v_anchor,
      'diagnostic_status',v_diag->>'status','athlete_maturity',v_diag->>'athlete_maturity',
      'active_skill_objective',v_diag->'active_skill_objective',
      'legacy_active_block_priorities',coalesce(v_block->'legacy_priorities','null'::jsonb),
      'legacy_active_block_weights_are_not_reused_as_new_priority_evidence',true
    );
end;
$$;

revoke all on function public.program_coach_cycle_priority_resolver_v1(uuid,date) from public;
revoke all on function public.program_coach_cycle_priority_resolver_v1(uuid,date) from anon;
revoke all on function public.program_coach_cycle_priority_resolver_v1(uuid,date) from authenticated;
