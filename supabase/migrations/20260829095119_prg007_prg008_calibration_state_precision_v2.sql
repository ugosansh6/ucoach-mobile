create or replace function public.program_coach_programming_diagnostic_v1(
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
  v_goal text;
  v_start jsonb;
  v_legacy jsonb;
  v_skill jsonb;
  v_gap jsonb;
  v_adherence jsonb;
  v_quality jsonb := '[]'::jsonb;
  v_patterns jsonb := '[]'::jsonb;
  v_item jsonb;
  v_role text;
  v_state text;
  v_maturity text;
  v_pattern_count int := 0;
  v_limiting_count int := 0;
  v_unknown_count int := 0;
  v_develop_count int := 0;
  v_maintain_count int := 0;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_goal := public.d_primary_goal(p_user_id);
  v_start := public.program_coach_start_state_v1(p_user_id,v_anchor);
  v_maturity := coalesce(v_start->>'maturity_stage','COLD_START');
  v_legacy := public.program_coach_priority_snapshot_v1(p_user_id,v_anchor);
  v_skill := public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_gap := public.w4_goal_gap_v1(p_user_id,v_anchor);
  v_adherence := public.program_coach_adherence_v1(p_user_id,v_anchor);

  for v_item in
    select value from jsonb_array_elements(coalesce(v_legacy->'quality_priorities','[]'::jsonb)) x(value)
  loop
    v_role := coalesce(v_item->>'role','SUPPORT');
    v_state := case v_role when 'PRIORITY' then 'TO_DEVELOP' when 'DEVELOP' then 'TO_DEVELOP' else 'MAINTAIN' end;
    v_quality := v_quality || jsonb_build_array(jsonb_build_object(
      'quality_key',v_item->>'key',
      'programming_state',v_state,
      'goal_role',v_role,
      'observed_level',case when v_maturity='COLD_START' then 'UNKNOWN' else 'NOT_INFERRED_HERE' end,
      'evidence_origin','GOAL_DIRECTION_MAPPING',
      'reason_codes',jsonb_build_array('PRIMARY_GOAL_'||upper(replace(coalesce(v_goal,'GENERAL_FITNESS'),' ','_'))),
      'legacy_numeric_weight_ignored',true
    ));
  end loop;

  with pi as (
    select p.movement_pattern,p.directive,p.priority_score,p.confidence,p.reason_codes
    from public.pi_pattern_directives(p_user_id,v_anchor,90) p
  ),
  skill_target as (
    select e.movement_pattern,true as active_skill_target,coalesce(v_skill->>'status','UNKNOWN') as skill_status
    from public.exercises e
    where e.id = coalesce(
      nullif(v_skill#>>'{current_target,exercise_id}',''),
      nullif(v_skill#>>'{next_target,exercise_id}','')
    ) and nullif(e.movement_pattern,'') is not null
  ),
  gap as (
    select
      e.movement_pattern,
      bool_or(req->>'status'='LIMITING') as has_limiting,
      bool_or(req->>'status'='TO_CALIBRATE') as has_calibration,
      count(*) filter(where req->>'status'='LIMITING')::int as limiting_requirements,
      count(*) filter(where req->>'status'='TO_CALIBRATE')::int as calibration_requirements,
      jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'exercise_id',req->>'exercise_id','exercise_name',req->>'exercise_name','status',req->>'status',
        'evaluation_reason',req->>'evaluation_reason','capability_role',req->>'capability_role'
      ))) as requirements
    from jsonb_array_elements(coalesce(v_gap->'requirements','[]'::jsonb)) req
    join public.exercises e on e.id=req->>'exercise_id'
    where nullif(e.movement_pattern,'') is not null
    group by e.movement_pattern
  ),
  all_patterns as (
    select movement_pattern from pi
    union select movement_pattern from skill_target
    union select movement_pattern from gap
  ),
  resolved as (
    select
      ap.movement_pattern,
      case
        when coalesce(g.has_limiting,false) then 'LIMITING'
        when coalesce(st.active_skill_target,false)
             and st.skill_status in ('CALIBRATION_NEEDED','TARGET_CALIBRATION_NEEDED','INSUFFICIENT_DATA') then 'UNKNOWN'
        when coalesce(st.active_skill_target,false) then 'TO_DEVELOP'
        when pi.directive in ('PROGRESS','DEVELOPMENT_PRIORITY') then 'TO_DEVELOP'
        when pi.directive='MAINTAIN' then 'MAINTAIN'
        when coalesce(g.has_calibration,false) or pi.directive='RECALIBRATE' then 'UNKNOWN'
        else 'UNKNOWN'
      end as programming_state,
      case
        when coalesce(g.has_limiting,false) then 'CAUSAL'
        when coalesce(st.active_skill_target,false) then 'DIRECT_GOAL'
        when pi.directive in ('PROGRESS','DEVELOPMENT_PRIORITY','MAINTAIN','RECALIBRATE') then 'SUPPORTING_OBSERVATION'
        else 'INSUFFICIENT'
      end as evidence_strength,
      coalesce(st.skill_status,'') as skill_status,
      pi.directive as legacy_pi_directive,pi.priority_score as legacy_pi_priority_score,
      pi.confidence as legacy_pi_confidence,pi.reason_codes as legacy_pi_reason_codes,
      coalesce(g.limiting_requirements,0) as limiting_requirements,
      coalesce(g.calibration_requirements,0) as calibration_requirements,
      coalesce(g.requirements,'[]'::jsonb) as causal_requirements,
      coalesce(st.active_skill_target,false) as active_skill_target
    from all_patterns ap
    left join pi on pi.movement_pattern=ap.movement_pattern
    left join skill_target st on st.movement_pattern=ap.movement_pattern
    left join gap g on g.movement_pattern=ap.movement_pattern
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_pattern',movement_pattern,'programming_state',programming_state,'evidence_strength',evidence_strength,
    'reason_codes',to_jsonb(array_remove(array[
      case when limiting_requirements>0 then 'ACTIVE_SKILL_CAUSAL_LIMITING_FACTOR' end,
      case when active_skill_target and skill_status in ('CALIBRATION_NEEDED','TARGET_CALIBRATION_NEEDED','INSUFFICIENT_DATA') then 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' end,
      case when active_skill_target and skill_status not in ('CALIBRATION_NEEDED','TARGET_CALIBRATION_NEEDED','INSUFFICIENT_DATA') then 'ACTIVE_SKILL_TARGET' end,
      case when legacy_pi_directive='PROGRESS' then 'OBSERVED_PROGRESS_CAPACITY' end,
      case when legacy_pi_directive='DEVELOPMENT_PRIORITY' then 'OBSERVED_DEVELOPMENT_SIGNAL' end,
      case when legacy_pi_directive='MAINTAIN' then 'OBSERVED_MAINTENANCE_SIGNAL' end,
      case when legacy_pi_directive='RECALIBRATE' then 'OBSERVATION_RECALIBRATION_NEEDED' end,
      case when calibration_requirements>0 then 'ACTIVE_SKILL_PREREQUISITE_CALIBRATION_NEEDED' end
    ],null)),
    'causal_requirements',causal_requirements,
    'legacy_pi_evidence',jsonb_strip_nulls(jsonb_build_object(
      'directive',legacy_pi_directive,'priority_score',legacy_pi_priority_score,'confidence',legacy_pi_confidence,
      'reason_codes',legacy_pi_reason_codes,'authority','EVIDENCE_ONLY'))
  ) order by case programming_state when 'LIMITING' then 1 when 'TO_DEVELOP' then 2 when 'MAINTAIN' then 3 else 4 end,movement_pattern),'[]'::jsonb)
  into v_patterns
  from resolved;

  v_pattern_count := jsonb_array_length(v_patterns);
  select count(*) filter(where x->>'programming_state'='LIMITING')::int,
         count(*) filter(where x->>'programming_state'='TO_DEVELOP')::int,
         count(*) filter(where x->>'programming_state'='MAINTAIN')::int,
         count(*) filter(where x->>'programming_state'='UNKNOWN')::int
  into v_limiting_count,v_develop_count,v_maintain_count,v_unknown_count
  from jsonb_array_elements(v_patterns) x;

  return jsonb_build_object(
    'version','program-coach-programming-diagnostic-v1.1','mode','SHADOW_READ_ONLY','anchor_date',v_anchor,
    'status',case when v_maturity='COLD_START' and v_pattern_count=0 then 'COLD_START_INSUFFICIENT_EVIDENCE' when v_pattern_count=0 then 'INSUFFICIENT_EVIDENCE' else 'READY_SHADOW' end,
    'primary_goal',v_goal,'athlete_maturity',v_maturity,'quality_direction',v_quality,'movement_pattern_diagnosis',v_patterns,
    'active_skill_objective',jsonb_strip_nulls(jsonb_build_object(
      'status',v_skill->>'status','path_key',v_skill#>>'{path,path_key}','current_target',v_skill->'current_target','next_target',v_skill->'next_target')),
    'goal_gap_status',v_gap->>'status',
    'adherence_context',jsonb_strip_nulls(jsonb_build_object(
      'signal',v_adherence->>'signal','weeks_observed',v_adherence->'weeks_observed','completion_ratio',v_adherence->'completion_ratio')),
    'summary',jsonb_build_object(
      'pattern_count',v_pattern_count,'limiting_count',v_limiting_count,'to_develop_count',v_develop_count,
      'maintain_count',v_maintain_count,'unknown_count',v_unknown_count),
    'principles',jsonb_build_object(
      'missing_evidence_is_unknown_not_weakness',true,'explicit_goal_sets_direction_not_level',true,
      'skill_calibration_need_is_not_labeled_development',true,'causal_skill_prerequisites_outrank_generic_pattern_balance',true,
      'legacy_pi_numeric_scores_are_evidence_only',true,'no_new_numeric_threshold_added',true,'no_generation_authority',true,
      'planned_sessions_are_not_evidence',true,'completed_actuals_remain_authoritative',true)
  );
end;
$$;

revoke all on function public.program_coach_programming_diagnostic_v1(uuid,date) from public;
revoke all on function public.program_coach_programming_diagnostic_v1(uuid,date) from anon;
revoke all on function public.program_coach_programming_diagnostic_v1(uuid,date) from authenticated;

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
      'kind','MOVEMENT_PATTERN','key',x->>'movement_pattern',
      'programming_state',case when x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' then 'CALIBRATE' else 'DEVELOP' end,
      'priority_reason',case when x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' then 'ACTIVE_SKILL_TARGET_NEEDS_CALIBRATION' else 'ACTIVE_SKILL_TARGET' end,
      'evidence_strength',x->>'evidence_strength','reason_codes',coalesce(x->'reason_codes','[]'::jsonb)
    ) into v_primary
    from jsonb_array_elements(v_patterns) x
    where x->>'evidence_strength'='DIRECT_GOAL'
      and (x->>'programming_state'='TO_DEVELOP' or x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED')
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
  into v_unknown from jsonb_array_elements(v_patterns) x where x->>'programming_state'='UNKNOWN';

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
    'version','program-coach-cycle-priority-from-inputs-v1.1','mode','SHADOW_READ_ONLY',
    'status',case when v_primary is null then 'INSUFFICIENT_EVIDENCE' else 'PRIORITY_CANDIDATE_READY' end,
    'primary_goal',v_goal,'primary_priority',v_primary,'secondary_priority',v_secondary,
    'maintenance',v_maintenance,'unknown_patterns',v_unknown,'supporting_observation_signals',v_supporting,
    'environment_context',jsonb_build_object(
      'status',coalesce(p_environment_access->>'status','UNDECLARED'),
      'primary_environment',p_environment_access->'primary_environment',
      'accessible_environment_codes',coalesce(p_environment_access->'accessible_environment_codes','[]'::jsonb),
      'never_environment_codes',coalesce(p_environment_access->'never_environment_codes','[]'::jsonb),
      'used_as_hard_priority_score',false),
    'continuity',jsonb_build_object(
      'action',v_continuity,'active_block_id',v_block_id,'active_block_goal',v_block_goal,
      'candidate_replaces_active_block_now',false,'review_required_before_priority_switch',true),
    'decision_order',jsonb_build_array(
      'ACTIVE_SKILL_CAUSAL_LIMITER','ACTIVE_SKILL_EXPLICIT_TARGET_OR_CALIBRATION','PRIMARY_GOAL_DIRECTION','SUPPORTING_OBSERVATIONS_ONLY'),
    'principles',jsonb_build_object(
      'one_primary_priority',true,'no_generation_authority',true,'at_most_one_secondary_priority',true,
      'priority_persists_until_review_reason',true,'missing_evidence_is_unknown_not_weakness',true,
      'calibration_is_a_priority_action_not_a_weakness_label',true,'environment_never_cannot_be_required_later',true,
      'legacy_pi_score_cannot_win_cycle_priority_alone',true,'safety_readiness_and_feasibility_remain_higher_authority',true)
  );
end;
$$;

revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_cycle_priority_from_inputs_v1(jsonb,jsonb,jsonb) from authenticated;
