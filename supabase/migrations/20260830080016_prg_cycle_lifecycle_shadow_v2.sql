create or replace function public.program_coach_block_lifecycle_from_inputs_v2(
  p_block jsonb,
  p_strategy_review jsonb,
  p_priority_candidate jsonb,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
immutable
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_has_block boolean:=coalesce(nullif(p_block->>'id',''),'')<>'';
  v_status text:=lower(coalesce(p_block->>'status',''));
  v_block_goal text:=nullif(p_block->>'primary_goal','');
  v_candidate_goal text:=nullif(p_priority_candidate->>'primary_goal','');
  v_target_end date:=nullif(p_block->>'target_end_on','')::date;
  v_review_action text:=upper(coalesce(p_strategy_review->>'recommended_action',''));
  v_transition text;
  v_mutation_allowed boolean:=false;
  v_priority_change_allowed boolean:=false;
  v_reason text;
  v_requires_review boolean:=false;
  v_horizon_state text;
begin
  if not v_has_block or v_status<>'active' then
    return jsonb_build_object(
      'version','program-coach-block-lifecycle-from-inputs-v2',
      'mode','SHADOW_READ_ONLY',
      'transition','CREATE_BLOCK_FROM_PRIORITY_CANDIDATE',
      'reason_code','NO_ACTIVE_BASE_BLOCK',
      'priority_candidate',p_priority_candidate->'primary_priority',
      'primary_goal',v_candidate_goal,
      'may_mutate_active_block',false,
      'requires_strategy_review',false
    );
  end if;

  v_horizon_state:=case
    when v_target_end is null then 'NO_TARGET_END'
    when v_anchor>v_target_end then 'HORIZON_PASSED'
    when v_anchor=v_target_end then 'HORIZON_END_TODAY'
    else 'WITHIN_HORIZON'
  end;

  if v_candidate_goal is not null and v_block_goal is distinct from v_candidate_goal then
    v_transition:='CLOSE_REPLACE_CANDIDATE';
    v_reason:='PRIMARY_GOAL_CHANGED';
    v_requires_review:=true;
    v_priority_change_allowed:=true;
  else
    case v_review_action
      when 'CONTINUE' then
        v_transition:='KEEP_ACTIVE';
        v_reason:='WORKING_STRATEGY_PRESERVED';
      when 'CONTINUE_OBSERVATION' then
        v_transition:='KEEP_ACTIVE_OBSERVE';
        v_reason:='INSUFFICIENT_EVIDENCE_FOR_CHANGE';
      when 'CONSOLIDATE' then
        v_transition:='KEEP_ACTIVE_CONSOLIDATE';
        v_reason:='RECOVERY_CHANGES_DOSE_NOT_PRIORITY';
      when 'RETEST' then
        v_transition:='KEEP_ACTIVE_RETEST';
        v_reason:='RETEST_BEFORE_STRATEGY_JUDGMENT';
      when 'CALIBRATE_DECISION_BLOCKING_UNKNOWN' then
        v_transition:='KEEP_ACTIVE_CALIBRATE';
        v_reason:='CALIBRATION_BEFORE_STRATEGY_JUDGMENT';
      when 'EXTEND_AND_REVIEW_FUTURE_FREQUENCY' then
        v_transition:='EXTENSION_REQUIRED';
        v_reason:='LOW_ADHERENCE_DOES_NOT_PROVE_PROGRAM_FAILURE';
        v_requires_review:=true;
      when 'SWITCH_INTERVENTION' then
        v_transition:='KEEP_PRIORITY_SWITCH_INTERVENTION';
        v_reason:='STRICT_STAGNATION_WITH_SUFFICIENT_ADHERENCE';
        v_requires_review:=true;
      when 'REVIEW_NEXT_PRIORITY' then
        v_transition:='CLOSE_REPLACE_CANDIDATE';
        v_reason:='END_REVIEW_WITH_CONFIRMED_PROGRESS';
        v_requires_review:=true;
        v_priority_change_allowed:=true;
      when 'EXTEND_OR_REVIEW_WITHOUT_FORCED_SWITCH' then
        v_transition:='LIFECYCLE_DECISION_REQUIRED';
        v_reason:='BLOCK_END_WITHOUT_EVIDENCE_FOR_AUTOMATIC_SWITCH';
        v_requires_review:=true;
      when 'CREATE_OR_CONFIRM_BLOCK' then
        v_transition:='LIFECYCLE_INCONSISTENCY_REVIEW';
        v_reason:='REVIEW_REPORTS_NO_BLOCK_WHILE_BLOCK_INPUT_EXISTS';
        v_requires_review:=true;
      else
        v_transition:='KEEP_ACTIVE_REVIEW';
        v_reason:='NO_EXPLICIT_LIFECYCLE_ACTION';
        v_requires_review:=true;
    end case;
  end if;

  if v_horizon_state='HORIZON_PASSED'
     and v_transition in ('KEEP_ACTIVE','KEEP_ACTIVE_OBSERVE','KEEP_ACTIVE_REVIEW') then
    v_transition:='LIFECYCLE_DECISION_REQUIRED';
    v_reason:='ACTIVE_BLOCK_HORIZON_PASSED_NO_SILENT_EXTENSION';
    v_requires_review:=true;
  end if;

  return jsonb_build_object(
    'version','program-coach-block-lifecycle-from-inputs-v2',
    'mode','SHADOW_READ_ONLY',
    'anchor_date',v_anchor,
    'block_id',p_block->>'id',
    'block_status',v_status,
    'block_goal',v_block_goal,
    'candidate_goal',v_candidate_goal,
    'target_end_on',v_target_end,
    'horizon_state',v_horizon_state,
    'strategy_review_action',nullif(v_review_action,''),
    'transition',v_transition,
    'reason_code',v_reason,
    'requires_strategy_review',v_requires_review,
    'priority_change_allowed_by_this_transition',v_priority_change_allowed,
    'extension_duration_decided',false,
    'may_mutate_active_block',v_mutation_allowed,
    'persistent_priority_contract',jsonb_build_object(
      'active_block_priority_is_stable_between_reviews',true,
      'session_actuals_may_change_week_or_dose_not_cycle_priority',true,
      'priority_switch_requires_strategy_review',true,
      'goal_change_requires_block_review',true
    ),
    'proposed_primary_priority',p_priority_candidate->'primary_priority',
    'proposed_secondary_priority',p_priority_candidate->'secondary_priority'
  );
end;
$function$;

create or replace function public.program_coach_block_lifecycle_shadow_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_block jsonb:='{}'::jsonb;
  v_review jsonb;
  v_priority jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select jsonb_build_object(
    'id',b.id,'status',b.status,'layer_type',b.layer_type,'program_kind',b.program_kind,
    'primary_goal',b.primary_goal,'phase',b.phase,'started_on',b.started_on,'target_end_on',b.target_end_on,
    'nominal_weeks',b.nominal_weeks,'current_week_index',b.current_week_index,
    'priorities_json',b.priorities_json,'rationale_json',b.rationale_json,'policy_version',b.policy_version
  ) into v_block
  from public.program_coach_blocks b
  where b.user_id=p_user_id and b.layer_type='BASE' and b.status='active'
  order by b.started_on desc,b.created_at desc limit 1;

  v_priority:=public.program_coach_cycle_priority_resolver_v2(p_user_id,v_anchor);
  v_review:=public.program_coach_strategy_review_v1(p_user_id,v_anchor);

  return public.program_coach_block_lifecycle_from_inputs_v2(
    coalesce(v_block,'{}'::jsonb),v_review,v_priority,v_anchor
  ) || jsonb_build_object(
    'strategy_review',v_review,
    'priority_candidate',v_priority,
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_active_block',false,
      'may_extend_block',false,
      'may_close_block',false,
      'may_create_replacement_block',false
    )
  );
end;
$function$;

revoke execute on function public.program_coach_block_lifecycle_from_inputs_v2(jsonb,jsonb,jsonb,date) from anon;
revoke execute on function public.program_coach_block_lifecycle_shadow_v2(uuid,date) from anon;
grant execute on function public.program_coach_block_lifecycle_from_inputs_v2(jsonb,jsonb,jsonb,date) to authenticated;
grant execute on function public.program_coach_block_lifecycle_shadow_v2(uuid,date) to authenticated;
