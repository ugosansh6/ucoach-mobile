create or replace function public.program_coach_plateau_evidence_from_inputs_v1(
  p_protocol_progress jsonb,
  p_block_review jsonb,
  p_explicit_stagnation_evidence jsonb default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_protocol_state text := upper(coalesce(p_protocol_progress->>'state',''));
  v_explicit_status text := upper(coalesce(p_explicit_stagnation_evidence->>'status',''));
begin
  if v_explicit_status='CONFIRMED_STAGNATION' then
    return jsonb_build_object(
      'status','CONFIRMED_STAGNATION','source','EXPLICIT_STRICT_STAGNATION_CONTRACT',
      'evidence',p_explicit_stagnation_evidence,'may_support_intervention_switch',true,
      'reason_codes',jsonb_build_array('STRICT_STAGNATION_EVIDENCE_PROVIDED'));
  end if;

  if v_protocol_state='CONFIRMED_PROGRESS' then
    return jsonb_build_object(
      'status','PROGRESS_NOT_PLATEAU','source','PROTOCOL_PROGRESS',
      'may_support_intervention_switch',false,
      'reason_codes',jsonb_build_array('CONFIRMED_COMPARABLE_PROGRESS_EXISTS'));
  elsif v_protocol_state='RECALIBRATION_PENDING' then
    return jsonb_build_object(
      'status','RETEST_REQUIRED_NOT_PLATEAU','source','PROTOCOL_PROGRESS',
      'may_support_intervention_switch',false,
      'reason_codes',jsonb_build_array('LOWER_REPEATABLE_PROTOCOL_RESULT_REQUIRES_CONFIRMATION_BEFORE_STRATEGY_JUDGMENT'));
  end if;

  return jsonb_build_object(
    'status','NOT_PROVEN','source','CURRENT_EVIDENCE_CONTRACTS',
    'may_support_intervention_switch',false,
    'reason_codes',jsonb_build_array('NO_STRICT_MULTI_OBSERVATION_STAGNATION_CONTRACT_AVAILABLE'),
    'semantics',jsonb_build_object(
      'no_fixed_weeks_without_progress_threshold',true,
      'legacy_performance_trend_not_used_as_plateau_authority',true,
      'one_bad_session_never_proves_plateau',true,
      'absence_of_progress_proof_is_not_plateau_proof',true));
end;
$$;

revoke all on function public.program_coach_plateau_evidence_from_inputs_v1(jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_plateau_evidence_from_inputs_v1(jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_plateau_evidence_from_inputs_v1(jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_strategy_review_from_inputs_v1(
  p_block_review jsonb,
  p_adherence jsonb,
  p_fatigue jsonb,
  p_protocol_progress jsonb,
  p_goal_gap jsonb,
  p_plateau_evidence jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_diag text := upper(coalesce(p_block_review->>'diagnosis',''));
  v_review_point text := upper(coalesce(p_block_review->>'review_point','NONE'));
  v_adherence text := upper(coalesce(p_adherence->>'signal','INSUFFICIENT_DATA'));
  v_fatigue text := upper(coalesce(p_fatigue->>'fatigue_type','NONE'));
  v_protocol text := upper(coalesce(p_protocol_progress->>'state',''));
  v_goal_gap text := upper(coalesce(p_goal_gap->>'status',''));
  v_plateau text := upper(coalesce(p_plateau_evidence->>'status','NOT_PROVEN'));
  v_action text;
  v_reason text;
  v_strategy_judgment text := 'NO_FAILURE_JUDGMENT';
begin
  if v_diag='NO_ACTIVE_BLOCK' then
    v_action := 'CREATE_OR_CONFIRM_BLOCK';
    v_reason := 'NO_ACTIVE_BASE_BLOCK';
  elsif v_diag='INSUFFICIENT_EVIDENCE' then
    v_action := 'CONTINUE_OBSERVATION';
    v_reason := 'INSUFFICIENT_EVIDENCE_FOR_STRATEGY_CHANGE';
  elsif v_fatigue='GLOBAL_ACCUMULATION' or v_diag='RECOVERY_LIMITING' then
    v_action := 'CONSOLIDATE';
    v_reason := 'RECOVERY_LIMITS_CURRENT_DOSE_NOT_NECESSARILY_STRATEGY';
  elsif v_protocol='RECALIBRATION_PENDING' or v_diag='PROTOCOL_RECALIBRATION_NEEDED' then
    v_action := 'RETEST';
    v_reason := 'RETEST_BEFORE_JUDGING_STRATEGY';
  elsif v_goal_gap in ('CALIBRATION_NEEDED','TARGET_CALIBRATION_NEEDED') or v_diag='CALIBRATION_NEEDED' then
    v_action := 'CALIBRATE_DECISION_BLOCKING_UNKNOWN';
    v_reason := 'MISSING_EVIDENCE_BLOCKS_STRATEGY_JUDGMENT';
  elsif v_adherence in ('LOW_ADHERENCE_REVIEW_FREQUENCY','VERY_LOW_ADHERENCE_REVIEW_FREQUENCY') or v_diag='ADHERENCE_LIMITING' then
    v_action := 'EXTEND_AND_REVIEW_FUTURE_FREQUENCY';
    v_reason := 'LOW_REALIZED_FREQUENCY_DOES_NOT_PROVE_PROGRAM_FAILURE';
  elsif v_plateau='CONFIRMED_STAGNATION' and v_adherence in ('GOOD_ADHERENCE','STRONG_ADHERENCE') then
    v_action := 'SWITCH_INTERVENTION';
    v_reason := 'STRICT_STAGNATION_WITH_SUFFICIENT_ADHERENCE';
    v_strategy_judgment := 'CURRENT_INTERVENTION_NOT_PRODUCING_EXPECTED_ADAPTATION';
  elsif v_protocol='CONFIRMED_PROGRESS' or v_diag='PROGRESS_CONFIRMED' then
    if v_review_point='END' then
      v_action := 'REVIEW_NEXT_PRIORITY';
      v_reason := 'PROGRESS_CONFIRMED_AND_BLOCK_REVIEW_AT_END';
    else
      v_action := 'CONTINUE';
      v_reason := 'PROGRESS_CONFIRMED_KEEP_WORKING_STRATEGY';
    end if;
  elsif v_review_point='END' then
    v_action := 'EXTEND_OR_REVIEW_WITHOUT_FORCED_SWITCH';
    v_reason := 'BLOCK_END_WITHOUT_CONFIRMED_PROGRESS_OR_CONFIRMED_PLATEAU';
  else
    v_action := 'CONTINUE';
    v_reason := 'NO_CORROBORATED_REASON_TO_CHANGE_STRATEGY';
  end if;

  return jsonb_build_object(
    'version','program-coach-strategy-review-from-inputs-v1','status','STRATEGY_REVIEW_READY',
    'recommended_action',v_action,'reason_code',v_reason,'strategy_judgment',v_strategy_judgment,
    'review_point',v_review_point,'plateau_assessment',p_plateau_evidence,
    'evidence_summary',jsonb_build_object(
      'block_diagnosis',v_diag,'adherence_signal',v_adherence,'fatigue_type',v_fatigue,
      'protocol_state',v_protocol,'goal_gap_status',v_goal_gap),
    'principles',jsonb_build_object(
      'one_bad_session_never_switches_strategy',true,
      'low_adherence_does_not_prove_strategy_failure',true,
      'fatigue_can_change_dose_without_invalidating_strategy',true,
      'calibration_precedes_strategy_judgment_when_evidence_is_missing',true,
      'switch_intervention_requires_explicit_plateau_evidence',true,
      'no_fixed_plateau_duration_threshold_added',true,
      'no_legacy_score_used_as_strategy_authority',true));
end;
$$;

revoke all on function public.program_coach_strategy_review_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_strategy_review_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_strategy_review_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_strategy_review_v1(
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
  v_block_review jsonb;
  v_adherence jsonb;
  v_fatigue jsonb;
  v_protocol jsonb;
  v_goal_gap jsonb;
  v_plateau jsonb;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_block_review := public.program_coach_block_review_v1(p_user_id,v_anchor);
  v_adherence := public.program_coach_adherence_v1(p_user_id,v_anchor);
  v_fatigue := public.program_coach_cumulative_fatigue_state_v1(p_user_id,v_anchor,null,null,'{}'::jsonb);
  v_protocol := public.program_coach_protocol_progress_state_v1(p_user_id,v_anchor,56);
  v_goal_gap := public.w4_goal_gap_v1(p_user_id,v_anchor);
  v_plateau := public.program_coach_plateau_evidence_from_inputs_v1(v_protocol,v_block_review,null);
  v_result := public.program_coach_strategy_review_from_inputs_v1(
    v_block_review,v_adherence,v_fatigue,v_protocol,v_goal_gap,v_plateau);

  return v_result || jsonb_build_object(
    'version','program-coach-strategy-review-v1','mode','SHADOW_READ_ONLY','anchor_date',v_anchor,
    'block_review',v_block_review,'goal_gap',v_goal_gap,
    'authority',jsonb_build_object(
      'shadow_only',true,'may_change_active_block',false,'may_switch_priority',false,'review_evidence_only',true));
end;
$$;

revoke all on function public.program_coach_strategy_review_v1(uuid,date) from public;
revoke all on function public.program_coach_strategy_review_v1(uuid,date) from anon;
revoke all on function public.program_coach_strategy_review_v1(uuid,date) from authenticated;
