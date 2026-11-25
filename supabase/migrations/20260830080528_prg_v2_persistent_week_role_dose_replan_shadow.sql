create or replace function public.program_coach_week_strategy_v2(
  p_user_id uuid,
  p_week_start date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_week date:=coalesce(p_week_start,public.d_week_start(current_date));
  v_block public.program_coach_blocks%rowtype;
  v_priority_snapshot jsonb;
  v_contract jsonb;
  v_phase jsonb:='{}'::jsonb;
  v_load jsonb;
  v_recovery jsonb;
  v_rolling jsonb;
  v_fatigue jsonb;
  v_adherence jsonb;
  v_lifecycle jsonb;
  v_base_intent text;
  v_intent text;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select * into v_block from public.program_coach_blocks
  where user_id=p_user_id and layer_type='BASE' and status='active'
  order by started_on desc,created_at desc limit 1;

  v_priority_snapshot:=public.program_coach_block_priority_snapshot_v2(p_user_id,v_week);
  v_contract:=coalesce(v_priority_snapshot->'priority_contract','{}'::jsonb);
  v_load:=public.program_coach_recent_load_v1(p_user_id,v_week);
  v_recovery:=public.program_coach_recovery_state_from_load_v1(v_load,null,null);
  v_rolling:=public.program_coach_rolling_stimulus_state_v1(p_user_id,v_week,'{}'::jsonb);
  v_adherence:=public.program_coach_adherence_v1(p_user_id,v_week);

  if v_block.id is not null then
    v_phase:=public.program_coach_phase_for_block_v1(v_block.id,v_week);
  else
    v_phase:=jsonb_build_object('phase','CALIBRATE','week_index',1,'reason','NO_ACTIVE_BLOCK');
  end if;

  v_base_intent:=case coalesce(v_phase->>'phase','BUILD')
    when 'CALIBRATE' then 'RECALIBRATE'
    when 'BUILD' then 'MAINTAIN'
    when 'PROGRESS' then 'PROGRESS'
    when 'CONSOLIDATE' then 'CONSOLIDATE'
    when 'RECALIBRATE' then 'RECALIBRATE'
    else 'MAINTAIN' end;

  v_fatigue:=public.program_coach_cumulative_fatigue_from_inputs_v1(v_load,v_recovery,v_rolling,v_phase->>'phase');
  v_intent:=case
    when coalesce((v_fatigue#>>'{decision,multi_session_deload_required}')::boolean,false) then 'CONSOLIDATE'
    else v_base_intent end;

  v_lifecycle:=public.program_coach_block_lifecycle_shadow_v2(p_user_id,v_week);

  return jsonb_build_object(
    'version','program-coach-week-strategy-v2-persistent-priority',
    'mode','SHADOW_READ_ONLY',
    'week_start',v_week,
    'active_block_id',v_block.id,
    'program_kind',coalesce(v_block.program_kind,'adaptive_standard'),
    'block_phase',v_phase,
    'base_session_intent_bias',v_base_intent,
    'session_intent_bias',v_intent,
    'priority_persistence_status',v_priority_snapshot->>'status',
    'priority_contract',v_contract,
    'primary_priority',v_contract->'primary_priority',
    'secondary_priority',v_contract->'secondary_priority',
    'maintenance',coalesce(v_contract->'maintenance','[]'::jsonb),
    'recent_load',v_load,
    'recovery_state',v_recovery,
    'cumulative_fatigue_state',v_fatigue,
    'adherence',v_adherence,
    'lifecycle',jsonb_build_object(
      'transition',v_lifecycle->>'transition',
      'reason_code',v_lifecycle->>'reason_code',
      'horizon_state',v_lifecycle->>'horizon_state'),
    'legacy_weekly_budget_used_as_priority_authority',false,
    'legacy_priority_snapshot_used',false,
    'authority',jsonb_build_object(
      'shadow_only',true,
      'persistent_block_priority_is_source_of_cycle_direction',true,
      'recovery_may_change_session_dose_not_cycle_priority',true,
      'legacy_week_plan_is_not_programming_doctrine',true,
      'may_change_generation',false)
  );
end;
$function$;

create or replace function public.program_coach_session_role_v2(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default null,
  p_pain_zones text[] default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_snapshot jsonb;
  v_contract jsonb;
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

  v_snapshot:=public.program_coach_block_priority_snapshot_v2(p_user_id,v_anchor);
  v_contract:=coalesce(v_snapshot->'priority_contract','{}'::jsonb);
  v_priority:=jsonb_build_object(
    'status',v_snapshot->>'status',
    'primary_goal',v_contract->>'primary_goal',
    'primary_priority',v_contract->'primary_priority',
    'secondary_priority',v_contract->'secondary_priority',
    'maintenance',coalesce(v_contract->'maintenance','[]'::jsonb));
  v_week:=public.program_coach_week_strategy_v2(p_user_id,public.d_week_start(v_anchor));
  v_recovery:=public.program_coach_recovery_state_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_fatigue:=public.program_coach_cumulative_fatigue_state_v1(p_user_id,v_anchor,p_readiness,p_pain_zones,'{}'::jsonb);
  v_review:=public.program_coach_block_review_v1(p_user_id,v_anchor);
  v_retest:=public.w4_retest_reference_candidates_v1(p_user_id,v_anchor);

  v_result:=public.program_coach_session_role_from_inputs_v1(
    v_priority,coalesce(v_week->'block_phase','{}'::jsonb),v_recovery,v_fatigue,v_review,v_retest);

  return v_result||jsonb_build_object(
    'version','program-coach-session-role-v2-persistent-priority',
    'anchor_date',v_anchor,
    'priority_persistence_status',v_snapshot->>'status',
    'week_strategy_version',v_week->>'version',
    'legacy_priority_snapshot_used',false,
    'authority',jsonb_build_object('shadow_only',true,'may_change_generation',false)
  );
end;
$function$;

create or replace function public.program_coach_dose_trajectory_v2(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_focus text default null,
  p_wod_minutes integer default 20,
  p_readiness text default null,
  p_exercise_count integer default 3,
  p_pain_zones text[] default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_snapshot jsonb;
  v_contract jsonb;
  v_priority jsonb;
  v_role jsonb;
  v_week jsonb;
  v_review jsonb;
  v_diag jsonb;
  v_anchor_exercise_id text:=null;
  v_anchor_exercise_name text:=null;
  v_anchor_pattern text:=null;
  v_mastery jsonb:=null;
  v_result jsonb;
  v_dose_policy jsonb:=null;
  v_existing_intent text;
  v_focus text;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_snapshot:=public.program_coach_block_priority_snapshot_v2(p_user_id,v_anchor);
  v_contract:=coalesce(v_snapshot->'priority_contract','{}'::jsonb);
  v_priority:=jsonb_build_object(
    'status',v_snapshot->>'status','primary_goal',v_contract->>'primary_goal',
    'primary_priority',v_contract->'primary_priority','secondary_priority',v_contract->'secondary_priority',
    'maintenance',coalesce(v_contract->'maintenance','[]'::jsonb));
  v_role:=public.program_coach_session_role_v2(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_week:=public.program_coach_week_strategy_v2(p_user_id,public.d_week_start(v_anchor));
  v_review:=public.program_coach_block_review_v1(p_user_id,v_anchor);
  v_diag:=public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);

  if coalesce(v_contract#>>'{primary_priority,kind}','')='MOVEMENT_PATTERN' then
    v_anchor_exercise_id:=nullif(v_diag#>>'{active_skill_objective,current_target,exercise_id}','');
    if v_anchor_exercise_id is not null then
      select coalesce(nullif(e.display_name,''),e.name),e.movement_pattern
      into v_anchor_exercise_name,v_anchor_pattern
      from public.exercises e where e.id=v_anchor_exercise_id;
      if v_anchor_pattern is distinct from v_contract#>>'{primary_priority,key}' then
        v_anchor_exercise_id:=null; v_anchor_exercise_name:=null; v_anchor_pattern:=null;
      end if;
    end if;
  end if;
  if v_anchor_exercise_id is not null then
    v_mastery:=public.w5_exercise_mastery_v1(p_user_id,v_anchor_exercise_id,v_anchor);
  end if;

  v_result:=public.program_coach_dose_trajectory_from_inputs_v1(v_priority,v_role,v_week,v_review,v_mastery);
  v_existing_intent:=nullif(v_result->>'existing_dose_policy_intent','');
  v_focus:=coalesce(nullif(p_focus,''),nullif(v_contract->>'primary_goal',''),'General Fitness');

  if v_existing_intent is not null and v_result->>'status'<>'DEFER_TO_SAFETY' then
    v_dose_policy:=public.program_coach_dose_policy_v1(
      p_user_id,v_anchor,v_focus,greatest(1,coalesce(p_wod_minutes,20)),
      coalesce(nullif(p_readiness,''),'normal'),v_existing_intent,greatest(1,coalesce(p_exercise_count,3)));
  end if;

  return v_result||jsonb_build_object(
    'version','program-coach-dose-trajectory-v2-persistent-priority',
    'anchor_date',v_anchor,
    'priority_persistence_status',v_snapshot->>'status',
    'anchor_candidate',case when v_anchor_exercise_id is null then null else jsonb_build_object(
      'exercise_id',v_anchor_exercise_id,'exercise_name',v_anchor_exercise_name,
      'movement_pattern',v_anchor_pattern,'source','PERSISTED_CYCLE_SKILL_PRIORITY','mastery',v_mastery) end,
    'existing_numeric_dose_authority',v_dose_policy,
    'legacy_priority_snapshot_used',false,
    'legacy_weekly_budget_used_as_priority_authority',false,
    'authority',jsonb_build_object(
      'shadow_only',true,'may_change_generation',false,
      'existing_c4_and_load_envelopes_remain_numeric_authority',true)
  );
end;
$function$;

create or replace function public.program_coach_ideal_week_projection_v2(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_readiness text default null,
  p_pain_zones text[] default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_skeleton jsonb;
  v_snapshot jsonb;
  v_contract jsonb;
  v_role jsonb;
  v_dose jsonb;
  v_env jsonb;
  v_caps jsonb:='{}'::jsonb;
  v_diag jsonb;
  v_anchor_exercise_id text:=null;
  v_slot jsonb;
  v_slots jsonb:='[]'::jsonb;
  v_seq int;
  v_priority jsonb;
  v_slot_role text;
  v_env_rec jsonb;
  v_maintenance jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_skeleton:=public.program_coach_ideal_week_projection_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_snapshot:=public.program_coach_block_priority_snapshot_v2(p_user_id,v_anchor);
  v_contract:=coalesce(v_snapshot->'priority_contract','{}'::jsonb);
  v_role:=public.program_coach_session_role_v2(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_dose:=public.program_coach_dose_trajectory_v2(p_user_id,v_anchor,null,20,p_readiness,3,p_pain_zones);
  v_env:=public.program_coach_environment_access_v1(p_user_id);
  v_diag:=public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_anchor_exercise_id:=nullif(v_diag#>>'{active_skill_objective,current_target,exercise_id}','');
  v_maintenance:=coalesce(v_contract->'maintenance','[]'::jsonb);

  select coalesce(jsonb_object_agg(environment_code,formats),'{}'::jsonb)
  into v_caps
  from (
    select environment_code,
           jsonb_object_agg(format_code,coalesce((constraints_json->>'generation_enabled')::boolean,false)) formats
    from public.environment_session_format_policy group by environment_code
  ) q;

  for v_slot in select value from jsonb_array_elements(coalesce(v_skeleton->'projected_slots','[]'::jsonb))
  loop
    v_seq:=coalesce((v_slot->>'sequence_index')::int,1);
    if v_seq=1 then
      v_priority:=v_contract->'primary_priority';
      v_slot_role:=v_role->>'recommended_role';
    elsif v_seq=2 and jsonb_typeof(v_contract->'secondary_priority')='object' then
      v_priority:=v_contract->'secondary_priority';
      v_slot_role:='DEVELOPMENT';
    elsif v_seq=3 and jsonb_array_length(v_maintenance)>0 then
      v_priority:=jsonb_build_object(
        'kind','MAINTENANCE_POOL','key','week_balance','programming_state','MAINTAIN',
        'candidates',v_maintenance,'priority_reason','PRESERVE_NON_PRIORITY_CAPACITIES_WITHOUT_FORCED_EQUAL_DISTRIBUTION');
      v_slot_role:='MAINTENANCE';
    else
      v_priority:=null;
      v_slot_role:=null;
    end if;

    v_env_rec:=public.program_coach_environment_recommendation_from_inputs_v1(
      v_priority,v_slot_role,v_env,v_caps,case when v_seq=1 then v_anchor_exercise_id else null end);

    v_slots:=v_slots||jsonb_build_array(
      (v_slot - 'priority' - 'programming_role' - 'dose_direction' - 'environment_recommendation' - 'slot_kind')
      || jsonb_build_object(
        'slot_kind',case when v_seq=1 then 'PERSISTED_PRIMARY_PRIORITY'
                         when v_seq=2 and v_priority is not null then 'PERSISTED_SECONDARY_PRIORITY'
                         when v_seq=3 and v_priority is not null then 'MAINTENANCE_POOL'
                         else 'FLEXIBLE_COMPLEMENT' end,
        'programming_role',v_slot_role,
        'priority',v_priority,
        'dose_direction',case when (v_slot->>'recommended_date')::date=v_anchor and v_seq=1
                              then v_dose->>'trajectory_action' else 'TO_RECALCULATE_AT_SESSION_TIME' end,
        'environment_recommendation',v_env_rec,
        'priority_source','PERSISTED_BLOCK_PRIORITY_V2'));
  end loop;

  return (v_skeleton
    - 'cycle_primary_priority' - 'cycle_secondary_priority' - 'maintenance_pool'
    - 'current_session_role' - 'current_dose_trajectory' - 'projected_slots' - 'authority' - 'version')
    || jsonb_build_object(
      'version','program-coach-ideal-week-projection-v2-persistent-priority',
      'mode','SHADOW_READ_ONLY',
      'priority_persistence_status',v_snapshot->>'status',
      'cycle_primary_priority',v_contract->'primary_priority',
      'cycle_secondary_priority',v_contract->'secondary_priority',
      'maintenance_pool',v_maintenance,
      'current_session_role',v_role->>'recommended_role',
      'current_dose_trajectory',v_dose,
      'projected_slots',v_slots,
      'legacy_week_plan_usage','DATES_AND_RESERVATIONS_ONLY',
      'legacy_planned_focus_target_region_progression_are_authority',false,
      'authority',jsonb_build_object(
        'shadow_only',true,'may_change_existing_week_plan',false,'may_generate_sessions',false,
        'persistent_block_priority_is_programming_direction',true,
        'legacy_week_plan_is_calendar_scaffold_only',true,
        'completed_actuals_remain_longitudinal_authority',true));
end;
$function$;

create or replace function public.program_coach_replan_after_completed_session_v2(
  p_session_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_has_realized boolean:=false;
  v_execution_factor numeric:=null;
  v_patterns jsonb:='[]'::jsonb;
  v_qualities jsonb:='[]'::jsonb;
  v_projection jsonb;
  v_priority jsonb;
  v_source text:='internal';
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  if v_session.status<>'completed' then
    return jsonb_build_object('version','program-coach-replan-v2','mode','SHADOW_READ_ONLY',
      'status','NOT_APPLICABLE_SESSION_NOT_COMPLETED','session_id',p_session_id,'replan_triggered',false);
  end if;

  if not public.session_counts_as_training_v1(p_session_id) then
    return jsonb_build_object('version','program-coach-replan-v2','mode','SHADOW_READ_ONLY',
      'status','NOT_APPLICABLE_ZERO_REALIZED_TRAINING','session_id',p_session_id,'replan_triggered',false,
      'reason_code','ADMINISTRATIVELY_CLOSED_WITHOUT_REALIZED_TRAINING');
  end if;

  select exists(select 1 from public.session_stimulus_ledger l
                where l.session_id=p_session_id and l.metadata_json->>'ledger_role'='realized')
  into v_has_realized;
  if not v_has_realized then
    return jsonb_build_object('version','program-coach-replan-v2','mode','SHADOW_READ_ONLY',
      'status','WAITING_FOR_FINALIZED_ACTUALS','session_id',p_session_id,'replan_triggered',false,
      'reason_code','REALIZED_STIMULUS_LEDGER_REQUIRED');
  end if;

  v_execution_factor:=public.d_session_execution_factor_v2(p_session_id);
  select coalesce(max(nullif(l.source_kind,'')),'internal') into v_source
  from public.session_stimulus_ledger l where l.session_id=p_session_id;

  select coalesce(jsonb_agg(jsonb_build_object('pattern',x.stimulus_key,'unit',x.unit,'realized_value',round(x.realized_value,3))
         order by x.realized_value desc,x.stimulus_key),'[]'::jsonb)
  into v_patterns
  from (select stimulus_key,unit,sum(coalesce(realized_value,0)) realized_value
        from public.session_stimulus_ledger where session_id=p_session_id and stimulus_type='pattern'
          and metadata_json->>'ledger_role'='realized' and coalesce(realized_value,0)>0 group by stimulus_key,unit) x;

  select coalesce(jsonb_agg(jsonb_build_object('quality',x.stimulus_key,'unit',x.unit,'realized_value',round(x.realized_value,3))
         order by x.realized_value desc,x.stimulus_key),'[]'::jsonb)
  into v_qualities
  from (select stimulus_key,unit,sum(coalesce(realized_value,0)) realized_value
        from public.session_stimulus_ledger where session_id=p_session_id and stimulus_type='focus'
          and metadata_json->>'ledger_role'='realized' and coalesce(realized_value,0)>0 group by stimulus_key,unit) x;

  v_priority:=public.program_coach_block_priority_snapshot_v2(v_session.user_id,v_anchor);
  v_projection:=public.program_coach_ideal_week_projection_v2(v_session.user_id,v_anchor,null,null);

  return jsonb_build_object(
    'version','program-coach-replan-after-completed-session-v2-persistent-priority','mode','SHADOW_READ_ONLY',
    'status','REPLAN_PROJECTION_READY','session_id',p_session_id,'user_id',v_session.user_id,
    'anchor_date',v_anchor,'session_source',v_source,'execution_factor',round(v_execution_factor,4),
    'realized_patterns',v_patterns,'realized_qualities',v_qualities,
    'persistent_cycle_priority',v_priority,'projection_after_actuals',v_projection,'replan_triggered',true,
    'cycle_priority_recomputed_from_actuals',false,
    'reason_code','ACTUALS_REPLAN_WEEK_WITHOUT_REWRITING_CYCLE_PRIORITY',
    'authority',jsonb_build_object('shadow_only',true,'may_mutate_week_plan',false,'may_generate_sessions',false));
end;
$function$;

revoke execute on function public.program_coach_week_strategy_v2(uuid,date) from anon;
revoke execute on function public.program_coach_session_role_v2(uuid,date,text,text[]) from anon;
revoke execute on function public.program_coach_dose_trajectory_v2(uuid,date,text,integer,text,integer,text[]) from anon;
revoke execute on function public.program_coach_ideal_week_projection_v2(uuid,date,text,text[]) from anon;
revoke execute on function public.program_coach_replan_after_completed_session_v2(uuid,date) from anon;
grant execute on function public.program_coach_week_strategy_v2(uuid,date) to authenticated;
grant execute on function public.program_coach_session_role_v2(uuid,date,text,text[]) to authenticated;
grant execute on function public.program_coach_dose_trajectory_v2(uuid,date,text,integer,text,integer,text[]) to authenticated;
grant execute on function public.program_coach_ideal_week_projection_v2(uuid,date,text,text[]) to authenticated;
grant execute on function public.program_coach_replan_after_completed_session_v2(uuid,date) to authenticated;
