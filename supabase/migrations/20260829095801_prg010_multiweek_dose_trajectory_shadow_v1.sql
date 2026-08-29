create or replace function public.program_coach_dose_trajectory_from_inputs_v1(
  p_session_role jsonb,
  p_cycle_priority jsonb,
  p_dose_policy jsonb,
  p_block_review jsonb,
  p_rolling_stimulus jsonb,
  p_protocol_progress jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := upper(coalesce(p_session_role->>'recommended_role',''));
  v_intent text;
  v_stage text;
  v_reason text;
  v_transition text;
  v_primary jsonb := p_cycle_priority->'primary_priority';
  v_review_action text := upper(coalesce(p_block_review->>'recommended_action',''));
  v_rolling_decision text := upper(coalesce(p_rolling_stimulus->>'decision','PRESERVE'));
  v_protocol_action text := upper(coalesce(p_protocol_progress->>'program_action',''));
begin
  v_intent := case v_role
    when 'DEVELOPMENT' then 'PROGRESS'
    when 'CONSOLIDATION' then 'CONSOLIDATE'
    when 'MAINTENANCE' then 'MAINTAIN'
    when 'CALIBRATION' then 'RECALIBRATE'
    when 'RETEST' then 'RECALIBRATE'
    when 'REDUCED_STIMULUS' then 'CONSOLIDATE'
    else null
  end;

  v_stage := case v_role
    when 'CALIBRATION' then 'LEARN_BASELINE'
    when 'RETEST' then 'CHECK_ADAPTATION'
    when 'DEVELOPMENT' then 'BUILD_ADAPTATION'
    when 'CONSOLIDATION' then 'STABILIZE_ADAPTATION'
    when 'REDUCED_STIMULUS' then 'ABSORB_LOAD'
    when 'MAINTENANCE' then 'PRESERVE_CAPACITY'
    else 'UNRESOLVED'
  end;

  v_reason := case v_role
    when 'CALIBRATION' then 'OBSERVABLE_REFERENCE_BEFORE_PROGRESSION'
    when 'RETEST' then 'MEASURE_CHANGE_BEFORE_NEXT_PROGRAM_DECISION'
    when 'DEVELOPMENT' then 'ACTIVE_PRIORITY_REQUIRES_PROGRESSIVE_EXPOSURE'
    when 'CONSOLIDATION' then 'PRESERVE_GAIN_WITHOUT_FORCING_MORE_DOSE'
    when 'REDUCED_STIMULUS' then 'RECOVERY_OR_FATIGUE_REQUIRES_LOWER_STIMULUS'
    when 'MAINTENANCE' then 'CAPACITY_IS_NOT_CURRENT_DEVELOPMENT_PRIORITY'
    else 'NO_ROLE_AVAILABLE'
  end;

  v_transition := case v_role
    when 'CALIBRATION' then 'WHEN_DECISION_BLOCKING_EVIDENCE_IS_RESOLVED_REVIEW_FOR_DEVELOPMENT_OR_MAINTENANCE'
    when 'RETEST' then 'AFTER_COMPARABLE_RESULT_REVIEW_PROTOCOL_OR_BLOCK_STATE'
    when 'DEVELOPMENT' then 'CONTINUE_WHILE_PRIORITY_REMAINS_ACTIVE_AND_ACTUALS_SUPPORT_PROGRESS; OTHERWISE_CONSOLIDATE_OR_REVIEW'
    when 'CONSOLIDATION' then 'RESUME_DEVELOPMENT_ONLY_AFTER_RECOVERY_OR_BLOCK_REVIEW_SUPPORTS_IT'
    when 'REDUCED_STIMULUS' then 'RETURN_TO_CYCLE_ROLE_WHEN_RECOVERY_AUTHORITY_CLEARS_REDUCTION'
    when 'MAINTENANCE' then 'CHANGE_ONLY_IF_CYCLE_PRIORITY_REVIEW_PROMOTES_THIS_CAPACITY'
    else 'WAIT_FOR_PROGRAMMING_ROLE'
  end;

  return jsonb_build_object(
    'version','program-coach-dose-trajectory-from-inputs-v1',
    'mode','SHADOW_READ_ONLY',
    'status',case when v_intent is null then 'INSUFFICIENT_ROLE' else 'TRAJECTORY_READY' end,
    'cycle_primary_priority',v_primary,
    'session_role',nullif(v_role,''),
    'trajectory_stage',v_stage,
    'progression_intent',v_intent,
    'trajectory_reason',v_reason,
    'next_transition_condition',v_transition,
    'current_dose_direction',p_dose_policy->>'dose_direction',
    'allowed_levers',coalesce(p_dose_policy->'allowed_levers','[]'::jsonb),
    'existing_numeric_authority',jsonb_strip_nulls(jsonb_build_object(
      'volume_factor',p_dose_policy->'existing_volume_factor',
      'intent_factor',p_dose_policy->'existing_intent_factor',
      'workload_envelope',p_dose_policy->'workload_envelope'
    )),
    'actual_context',jsonb_build_object(
      'rolling_stimulus_decision',v_rolling_decision,
      'protocol_program_action',nullif(v_protocol_action,''),
      'block_review_action',nullif(v_review_action,'')
    ),
    'guardrails',jsonb_build_object(
      'no_new_numeric_progression_multiplier',true,
      'no_fixed_weekly_increase',true,
      'progress_does_not_require_more_dose_every_session',true,
      'planned_sessions_do_not_advance_trajectory',true,
      'completed_actuals_drive_next_decision',true,
      'confirmed_load_semantics_remain_downstream_authority',true,
      'workload_envelope_remains_authoritative',true,
      'safety_readiness_equipment_and_mechanics_override',true,
      'local_pattern_pressure_can_change_exercise_or_pattern_dose_without_rewriting_cycle_priority',true
    )
  );
end;
$$;

revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_dose_trajectory_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default 'normal',
  p_pain_zones text[] default null,
  p_focus text default 'General Fitness',
  p_wod_minutes integer default 20,
  p_exercise_count integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_role jsonb;
  v_priority jsonb;
  v_intent text;
  v_dose jsonb;
  v_review jsonb;
  v_rolling jsonb;
  v_protocol jsonb;
  v_result jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_role := public.program_coach_session_role_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_priority := public.program_coach_cycle_priority_resolver_v1(p_user_id,v_anchor);

  v_intent := case upper(coalesce(v_role->>'recommended_role',''))
    when 'DEVELOPMENT' then 'PROGRESS'
    when 'CONSOLIDATION' then 'CONSOLIDATE'
    when 'MAINTENANCE' then 'MAINTAIN'
    when 'CALIBRATION' then 'RECALIBRATE'
    when 'RETEST' then 'RECALIBRATE'
    when 'REDUCED_STIMULUS' then 'CONSOLIDATE'
    else 'MAINTAIN'
  end;

  v_dose := public.program_coach_dose_policy_v1(
    p_user_id,v_anchor,p_focus,p_wod_minutes,p_readiness,v_intent,p_exercise_count
  );
  v_review := public.program_coach_block_review_v1(p_user_id,v_anchor);
  v_rolling := public.program_coach_rolling_stimulus_state_v1(
    p_user_id,v_anchor,jsonb_strip_nulls(jsonb_build_object('readiness',p_readiness,'pain_zones',to_jsonb(p_pain_zones)))
  );
  v_protocol := public.program_coach_protocol_progress_state_v1(p_user_id,v_anchor,56);

  v_result := public.program_coach_dose_trajectory_from_inputs_v1(
    v_role,v_priority,v_dose,v_review,v_rolling,v_protocol
  );

  return v_result || jsonb_build_object(
    'version','program-coach-dose-trajectory-v1',
    'anchor_date',v_anchor,
    'source_versions',jsonb_build_object(
      'session_role',v_role->>'version',
      'cycle_priority',v_priority->>'version',
      'dose_policy',v_dose->>'version',
      'block_review',v_review->>'version',
      'rolling_stimulus',v_rolling->>'version',
      'protocol_progress',v_protocol->>'version'
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_generated_dose',false,
      'existing_c4_dose_policy_is_numeric_authority',true
    )
  );
end;
$$;

revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,text[],text,integer,integer) from public;
revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,text[],text,integer,integer) from anon;
revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,text[],text,integer,integer) from authenticated;
