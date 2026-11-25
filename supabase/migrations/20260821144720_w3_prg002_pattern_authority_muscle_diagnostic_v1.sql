update public.session_engine_policy
set config = jsonb_set(
  config,
  '{pattern_complement,w3_prg002_policy}',
  jsonb_build_object(
    'decision','PATTERN_AUTHORITY_MUSCLE_DIAGNOSTIC',
    'pattern_signal','REALIZED_MOVEMENT_PATTERN',
    'pattern_authority_reuses_existing_active_policy',true,
    'muscle_signal','DIAGNOSTIC_CORROBORATIVE_ONLY',
    'muscle_may_trigger_rebalance',false,
    'muscle_may_block_session',false,
    'no_new_thresholds_added',true,
    'approved_at','2026-08-21'
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.w3_longitudinal_programming_policy_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 28
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_policy jsonb;
  v_exposure jsonb;
  v_config jsonb:='{}'::jsonb;
  v_active boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_policy:=public.program_coach_pattern_complement_policy_shadow_v1(p_user_id,v_anchor,'{}'::jsonb);
  v_exposure:=public.w3_longitudinal_exposure_shadow_v1(p_user_id,v_anchor,p_period_days);
  select coalesce(config#>'{pattern_complement}','{}'::jsonb)
  into v_config
  from public.session_engine_policy
  where policy_key='c4-final-default';

  v_active:=coalesce((v_config->>'apply_enabled')::boolean,false)
            and coalesce((v_config->>'rolling_pattern_exposure_trigger')::boolean,false);

  return jsonb_build_object(
    'version','w3-longitudinal-programming-policy-v1',
    'anchor_date',v_anchor,
    'status',case when v_active then 'ACTIVE_PATTERN_AUTHORITY' else 'PATTERN_POLICY_DISABLED' end,
    'pattern_authority',jsonb_build_object(
      'signal','REALIZED_MOVEMENT_PATTERN',
      'active',v_active,
      'existing_policy_reused',true,
      'soft_avoid_patterns',coalesce(v_policy->'soft_avoid_patterns','[]'::jsonb),
      'soft_reduce_patterns',coalesce(v_policy->'soft_reduce_patterns','[]'::jsonb),
      'protected_priority_patterns',coalesce(v_policy->'protected_priority_patterns','[]'::jsonb),
      'hard_gates_override',coalesce((v_config->>'hard_gates_override')::boolean,true),
      'policy_config',v_config
    ),
    'muscle_corroboration',jsonb_build_object(
      'signal','REALIZED_MUSCLE_EXPOSURE_RAW_COUNTS',
      'role','DIAGNOSTIC_CORROBORATIVE_ONLY',
      'diagnostic',coalesce(v_exposure->'realized_muscle_exposure_raw_counts','[]'::jsonb),
      'recent_session_diagnostics',coalesce(v_exposure->'recent_session_muscle_diagnostics','[]'::jsonb),
      'may_trigger_rebalance',false,
      'may_block_session',false,
      'may_change_exercise_selection',false
    ),
    'semantics',jsonb_build_object(
      'patterns_are_programming_authority_for_longitudinal_rebalance',true,
      'muscles_can_only_confirm_or_explain_pattern_signal',true,
      'muscle_counts_are_not_training_load',true,
      'no_new_cross_session_muscle_threshold',true,
      'existing_pattern_thresholds_are_reused_without_change',true,
      'health_equipment_readiness_and_program_priorities_override',true
    )
  );
end;
$$;

revoke all on function public.w3_longitudinal_programming_policy_v1(uuid,date,integer) from public,anon;
grant execute on function public.w3_longitudinal_programming_policy_v1(uuid,date,integer) to authenticated,service_role;

create or replace function public.w3_trajectory_snapshot_v1(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_cap jsonb;
  v_opp jsonb;
  v_interventions jsonb;
  v_progression jsonb;
  v_strategy jsonb;
  v_skill jsonb;
  v_longitudinal jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_cap:=public.w3_capability_model_v1(p_user_id,v_anchor);
  v_opp:=public.w3_opportunity_engine_v1(p_user_id,v_anchor);
  v_interventions:=public.w3_intervention_options_v1(p_user_id,v_anchor);
  v_progression:=public.progression_data_contract_v1(p_user_id,28,v_anchor);
  v_strategy:=public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));
  v_skill:=public.w3_active_skill_objective_v1(p_user_id,v_anchor);
  v_longitudinal:=public.w3_longitudinal_programming_policy_v1(p_user_id,v_anchor,28);

  return jsonb_build_object(
    'version','w3-trajectory-snapshot-v1',
    'anchor_date',v_anchor,
    'window',jsonb_build_object('type','SLIDING','days',28,'fixed_session_calendar',false,'recomputed_when_new_evidence_arrives',true),
    'current_program_state',jsonb_build_object(
      'program_kind',v_strategy->>'program_kind','block_phase',v_strategy->'block_phase','recent_load',v_strategy->'recent_load',
      'quality_priorities',coalesce(v_strategy->'quality_priorities','[]'::jsonb),
      'movement_pattern_priorities',coalesce(v_strategy->'movement_pattern_priorities','[]'::jsonb)
    ),
    'capability_state',jsonb_build_object(
      'summary',v_cap->'summary','athletic_profile',v_cap->'athletic_profile',
      'performance_context_status',v_cap#>>'{semantics,performance_context_status}'
    ),
    'skill_state',v_skill,
    'current_opportunities',v_opp->'top_opportunities',
    'current_interventions',v_interventions->'items',
    'activity_context',jsonb_build_object(
      'summary',v_progression#>'{activity,summary}','current_week',v_progression#>'{activity,current_week}',
      'active_plan_consistency',v_progression#>'{activity,active_plan_consistency}','weekly_load',v_progression#>'{activity,weekly_load}'
    ),
    'longitudinal_programming_policy',v_longitudinal,
    'trajectory_contract',jsonb_build_object(
      'priorities_not_fixed_sessions',true,
      'capabilities_and_skill_evidence_can_change_the_next_decision',true,
      'calibration_is_a_first_class_priority_when_it_blocks_a_decision',true,
      'program_load_and_recovery_authorities_are_reused',true,
      'no_new_longitudinal_muscle_threshold_is_activated',true,
      'prg_002_longitudinal_rebalance_status','ACTIVE_PATTERN_AUTHORITY_MUSCLE_DIAGNOSTIC'
    )
  );
end;
$$;

revoke all on function public.w3_trajectory_snapshot_v1(uuid,date) from public,anon;
grant execute on function public.w3_trajectory_snapshot_v1(uuid,date) to authenticated,service_role;

comment on function public.w3_longitudinal_programming_policy_v1(uuid,date,integer) is 'W3 PRG-002 approved policy: existing realized movement-pattern complement is the longitudinal programming authority; muscle exposure remains diagnostic/corroborative only and cannot trigger or block programming.';
comment on function public.w3_trajectory_snapshot_v1(uuid,date) is 'W3 PRG-001 trajectory snapshot with PRG-002 resolved: realized movement patterns are active longitudinal authority and muscle exposure remains diagnostic only.';
