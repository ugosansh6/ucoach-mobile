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
  if p_user_id is null then
    raise exception 'User required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_goal := public.d_primary_goal(p_user_id);
  v_start := public.program_coach_start_state_v1(p_user_id,v_anchor);
  v_maturity := coalesce(v_start->>'maturity_stage','COLD_START');
  v_legacy := public.program_coach_priority_snapshot_v1(p_user_id,v_anchor);
  v_skill := public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_gap := public.w4_goal_gap_v1(p_user_id,v_anchor);
  v_adherence := public.program_coach_adherence_v1(p_user_id,v_anchor);

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_legacy->'quality_priorities','[]'::jsonb)) x(value)
  loop
    v_role := coalesce(v_item->>'role','SUPPORT');
    v_state := case v_role
      when 'PRIORITY' then 'TO_DEVELOP'
      when 'DEVELOP' then 'TO_DEVELOP'
      when 'MAINTAIN' then 'MAINTAIN'
      else 'MAINTAIN'
    end;

    v_quality := v_quality || jsonb_build_array(jsonb_build_object(
      'quality_key',v_item->>'key',
      'programming_state',v_state,
      'goal_role',v_role,
      'observed_level',case when v_maturity='COLD_START' then 'UNKNOWN' else 'NOT_INFERRED_HERE' end,
      'evidence_origin','EXPLICIT_GOAL_MAPPING',
      'reason_codes',jsonb_build_array('PRIMARY_GOAL_'||upper(replace(coalesce(v_goal,'GENERAL_FITNESS'),' ','_'))),
      'legacy_numeric_weight_ignored',true
    ));
  end loop;

  with pi as (
    select p.movement_pattern,p.directive,p.priority_score,p.confidence,p.reason_codes
    from public.pi_pattern_directives(p_user_id,v_anchor,90) p
  ),
  skill_target as (
    select e.movement_pattern,true as active_skill_target
    from public.exercises e
    where e.id = coalesce(
      nullif(v_skill#>>'{current_target,exercise_id}',''),
      nullif(v_skill#>>'{next_target,exercise_id}','')
    )
      and nullif(e.movement_pattern,'') is not null
  ),
  gap as (
    select
      e.movement_pattern,
      bool_or(req->>'status'='LIMITING') as has_limiting,
      bool_or(req->>'status'='TO_CALIBRATE') as has_calibration,
      count(*) filter(where req->>'status'='LIMITING')::int as limiting_requirements,
      count(*) filter(where req->>'status'='TO_CALIBRATE')::int as calibration_requirements,
      jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'exercise_id',req->>'exercise_id',
        'exercise_name',req->>'exercise_name',
        'status',req->>'status',
        'evaluation_reason',req->>'evaluation_reason',
        'capability_role',req->>'capability_role'
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
      pi.directive as legacy_pi_directive,
      pi.priority_score as legacy_pi_priority_score,
      pi.confidence as legacy_pi_confidence,
      pi.reason_codes as legacy_pi_reason_codes,
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
    'movement_pattern',movement_pattern,
    'programming_state',programming_state,
    'evidence_strength',evidence_strength,
    'reason_codes',to_jsonb(array_remove(array[
      case when limiting_requirements>0 then 'ACTIVE_SKILL_CAUSAL_LIMITING_FACTOR' end,
      case when active_skill_target then 'ACTIVE_SKILL_TARGET' end,
      case when legacy_pi_directive='PROGRESS' then 'OBSERVED_PROGRESS_CAPACITY' end,
      case when legacy_pi_directive='DEVELOPMENT_PRIORITY' then 'OBSERVED_DEVELOPMENT_SIGNAL' end,
      case when legacy_pi_directive='MAINTAIN' then 'OBSERVED_MAINTENANCE_SIGNAL' end,
      case when legacy_pi_directive='RECALIBRATE' then 'OBSERVATION_RECALIBRATION_NEEDED' end,
      case when calibration_requirements>0 then 'ACTIVE_SKILL_PREREQUISITE_CALIBRATION_NEEDED' end
    ],null)),
    'causal_requirements',causal_requirements,
    'legacy_pi_evidence',jsonb_strip_nulls(jsonb_build_object(
      'directive',legacy_pi_directive,
      'priority_score',legacy_pi_priority_score,
      'confidence',legacy_pi_confidence,
      'reason_codes',legacy_pi_reason_codes,
      'authority','EVIDENCE_ONLY'
    ))
  ) order by
    case programming_state when 'LIMITING' then 1 when 'TO_DEVELOP' then 2 when 'MAINTAIN' then 3 else 4 end,
    movement_pattern),'[]'::jsonb)
  into v_patterns
  from resolved;

  v_pattern_count := jsonb_array_length(v_patterns);
  select
    count(*) filter(where x->>'programming_state'='LIMITING')::int,
    count(*) filter(where x->>'programming_state'='TO_DEVELOP')::int,
    count(*) filter(where x->>'programming_state'='MAINTAIN')::int,
    count(*) filter(where x->>'programming_state'='UNKNOWN')::int
  into v_limiting_count,v_develop_count,v_maintain_count,v_unknown_count
  from jsonb_array_elements(v_patterns) x;

  return jsonb_build_object(
    'version','program-coach-programming-diagnostic-v1',
    'mode','SHADOW_READ_ONLY',
    'anchor_date',v_anchor,
    'status',case
      when v_maturity='COLD_START' and v_pattern_count=0 then 'COLD_START_INSUFFICIENT_EVIDENCE'
      when v_pattern_count=0 then 'INSUFFICIENT_EVIDENCE'
      else 'READY_SHADOW'
    end,
    'primary_goal',v_goal,
    'athlete_maturity',v_maturity,
    'quality_direction',v_quality,
    'movement_pattern_diagnosis',v_patterns,
    'active_skill_objective',jsonb_strip_nulls(jsonb_build_object(
      'status',v_skill->>'status',
      'path_key',v_skill#>>'{path,path_key}',
      'current_target',v_skill->'current_target',
      'next_target',v_skill->'next_target'
    )),
    'goal_gap_status',v_gap->>'status',
    'adherence_context',jsonb_strip_nulls(jsonb_build_object(
      'signal',v_adherence->>'signal',
      'weeks_observed',v_adherence->'weeks_observed',
      'completion_ratio',v_adherence->'completion_ratio'
    )),
    'summary',jsonb_build_object(
      'pattern_count',v_pattern_count,
      'limiting_count',v_limiting_count,
      'to_develop_count',v_develop_count,
      'maintain_count',v_maintain_count,
      'unknown_count',v_unknown_count
    ),
    'principles',jsonb_build_object(
      'missing_evidence_is_unknown_not_weakness',true,
      'explicit_goal_sets_direction_not_level',true,
      'causal_skill_prerequisites_outrank_generic_pattern_balance',true,
      'legacy_pi_numeric_scores_are_evidence_only',true,
      'no_new_numeric_threshold_added',true,
      'no_generation_authority',true,
      'planned_sessions_are_not_evidence',true,
      'completed_actuals_remain_authoritative',true
    )
  );
end;
$$;

revoke all on function public.program_coach_programming_diagnostic_v1(uuid,date) from public;
revoke all on function public.program_coach_programming_diagnostic_v1(uuid,date) from anon;
grant execute on function public.program_coach_programming_diagnostic_v1(uuid,date) to authenticated;
