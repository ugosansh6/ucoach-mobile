create or replace function public.program_coach_session_role_from_inputs_v1(
  p_cycle_priority jsonb,
  p_block_phase jsonb,
  p_recovery jsonb,
  p_cumulative_fatigue jsonb,
  p_block_review jsonb,
  p_retest jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := null;
  v_status text := 'ROLE_READY';
  v_reason text := null;
  v_primary jsonb := p_cycle_priority->'primary_priority';
  v_phase text := upper(coalesce(p_block_phase->>'phase',''));
  v_recovery text := upper(coalesce(p_recovery->>'state','INSUFFICIENT_EVIDENCE'));
  v_review_action text := upper(coalesce(p_block_review->>'recommended_action',''));
  v_retest_available boolean := coalesce(p_retest->>'status','')='RETEST_OPPORTUNITIES_IDENTIFIED'
    and jsonb_array_length(coalesce(p_retest->'eligible_items','[]'::jsonb))>0;
  v_multi_deload boolean := coalesce((p_cumulative_fatigue#>>'{decision,multi_session_deload_required}')::boolean,false);
  v_alternates jsonb := '[]'::jsonb;
begin
  if v_recovery='PROTECT' or coalesce((p_recovery#>>'{decision,is_safety_hard_gate}')::boolean,false) then
    v_status := 'DEFER_TO_SAFETY';
    v_role := null;
    v_reason := 'SAFETY_AUTHORITY_PRECEDES_PROGRAM_ROLE';
  elsif v_multi_deload or v_recovery='RECOVERY_PRIORITY' then
    v_role := 'REDUCED_STIMULUS';
    v_reason := case when v_multi_deload then 'CORROBORATED_CUMULATIVE_FATIGUE' else 'RECOVERY_PRIORITY_TODAY' end;
  elsif v_review_action='RETEST_PROTOCOL_ONLY' and v_retest_available then
    v_role := 'RETEST';
    v_reason := 'BLOCK_REVIEW_REQUESTS_SUPPORTED_RETEST';
  elsif coalesce(v_primary->>'programming_state','')='CALIBRATE'
     or v_review_action='PRIORITIZE_DECISION_BLOCKING_CALIBRATION'
     or v_phase in ('CALIBRATE','RECALIBRATE') then
    v_role := 'CALIBRATION';
    v_reason := case
      when coalesce(v_primary->>'programming_state','')='CALIBRATE' then 'PRIMARY_PRIORITY_NEEDS_CALIBRATION'
      when v_review_action='PRIORITIZE_DECISION_BLOCKING_CALIBRATION' then 'BLOCK_REVIEW_DECISION_BLOCKING_CALIBRATION'
      else 'BLOCK_PHASE_CALIBRATION'
    end;
  elsif v_review_action='CONSOLIDATE_BLOCK' or v_phase='CONSOLIDATE' then
    v_role := 'CONSOLIDATION';
    v_reason := case when v_review_action='CONSOLIDATE_BLOCK' then 'BLOCK_REVIEW_CONSOLIDATION' else 'BLOCK_PHASE_CONSOLIDATION' end;
  elsif v_primary is not null and jsonb_typeof(v_primary)='object' then
    v_role := 'DEVELOPMENT';
    v_reason := 'ACTIVE_CYCLE_PRIORITY';
  else
    v_role := 'MAINTENANCE';
    v_reason := 'NO_DEVELOPMENT_PRIORITY_REQUIRING_A_DIFFERENT_ROLE';
  end if;

  if v_retest_available and coalesce(v_role,'')<>'RETEST' then
    v_alternates := v_alternates || jsonb_build_array(jsonb_build_object(
      'role','RETEST',
      'status','ELIGIBLE_OPPORTUNITY_NOT_AUTOMATIC',
      'reason_code','RETEST_IS_OPPORTUNITY_NOT_OBLIGATION'
    ));
  end if;

  return jsonb_build_object(
    'version','program-coach-session-role-from-inputs-v1',
    'mode','SHADOW_READ_ONLY',
    'status',v_status,
    'recommended_role',v_role,
    'role_reason',v_reason,
    'cycle_primary_priority',v_primary,
    'block_phase',nullif(v_phase,''),
    'recovery_state',v_recovery,
    'block_review_action',nullif(v_review_action,''),
    'alternate_roles',v_alternates,
    'role_catalog',jsonb_build_array(
      'DEVELOPMENT','CONSOLIDATION','MAINTENANCE','CALIBRATION','RETEST','REDUCED_STIMULUS'
    ),
    'authority_order',jsonb_build_array(
      'SAFETY_HARD_GATE',
      'RECOVERY_AND_CORROBORATED_FATIGUE',
      'SUPPORTED_RETEST_OR_CALIBRATION_DECISION',
      'BLOCK_PHASE',
      'ACTIVE_CYCLE_PRIORITY',
      'MAINTENANCE_FALLBACK'
    ),
    'principles',jsonb_build_object(
      'retest_is_opportunity_not_obligation',true,
      'pain_is_not_converted_to_a_programming_score',true,
      'reduced_stimulus_is_not_a_missed_session_debt',true,
      'same_pattern_may_have_different_roles_across_sessions',true,
      'role_does_not_select_exercise_by_itself',true,
      'no_generation_authority',true
    )
  );
end;
$$;

revoke all on function public.program_coach_session_role_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_session_role_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_session_role_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_session_role_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default null,
  p_pain_zones text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_priority jsonb;
  v_week jsonb;
  v_recovery jsonb;
  v_fatigue jsonb;
  v_review jsonb;
  v_retest jsonb;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_priority := public.program_coach_cycle_priority_resolver_v1(p_user_id,v_anchor);
  v_week := public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));
  v_recovery := public.program_coach_recovery_state_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_fatigue := public.program_coach_cumulative_fatigue_state_v1(p_user_id,v_anchor,p_readiness,p_pain_zones,'{}'::jsonb);
  v_review := public.program_coach_block_review_v1(p_user_id,v_anchor);
  v_retest := public.w4_retest_reference_candidates_v1(p_user_id,v_anchor);

  v_result := public.program_coach_session_role_from_inputs_v1(
    v_priority,
    coalesce(v_week->'block_phase','{}'::jsonb),
    v_recovery,
    v_fatigue,
    v_review,
    v_retest
  );

  return v_result || jsonb_build_object(
    'version','program-coach-session-role-v1',
    'anchor_date',v_anchor,
    'cycle_priority_version',v_priority->>'version',
    'cycle_priority_status',v_priority->>'status',
    'week_strategy_version',v_week->>'version',
    'block_review',jsonb_strip_nulls(jsonb_build_object(
      'diagnosis',v_review->>'diagnosis',
      'recommended_action',v_review->>'recommended_action',
      'reason_codes',v_review->'reason_codes'
    )),
    'retest_context',jsonb_build_object(
      'status',v_retest->>'status',
      'eligible_count',jsonb_array_length(coalesce(v_retest->'eligible_items','[]'::jsonb))
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_session_generation',false,
      'existing_session_coach_remains_authoritative',true
    )
  );
end;
$$;

revoke all on function public.program_coach_session_role_v1(uuid,date,text,text[]) from public;
revoke all on function public.program_coach_session_role_v1(uuid,date,text,text[]) from anon;
revoke all on function public.program_coach_session_role_v1(uuid,date,text,text[]) from authenticated;
