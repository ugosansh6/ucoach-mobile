create or replace function public.program_coach_environment_recommendation_from_inputs_v1(
  p_priority jsonb,
  p_role text,
  p_environment_access jsonb,
  p_environment_capabilities jsonb,
  p_anchor_exercise_id text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kind text := upper(coalesce(p_priority->>'kind',''));
  v_key text := lower(coalesce(p_priority->>'key',''));
  v_primary_env text := nullif(p_environment_access->>'primary_environment','');
  v_accessible jsonb := coalesce(p_environment_access->'accessible_environment_codes','[]'::jsonb);
  v_never jsonb := coalesce(p_environment_access->'never_environment_codes','[]'::jsonb);
  v_candidates jsonb := '[]'::jsonb;
  v_anchor_eligible jsonb := '[]'::jsonb;
  v_recommended text := null;
  v_access_level text := null;
  v_strength text := 'NONE';
  v_reason text := 'NO_FIRM_ENVIRONMENT_RECOMMENDATION';
  v_requires jsonb := '[]'::jsonb;
  v_gym_strength boolean := false;
  v_outdoor_conditioning boolean := false;
begin
  if coalesce(p_environment_access->>'status','UNDECLARED')='UNDECLARED' then
    return jsonb_build_object(
      'version','program-coach-environment-recommendation-v1.2-canonical',
      'status','ENVIRONMENT_ACCESS_UNDECLARED',
      'recommended_environment',null,
      'recommendation_strength','NONE',
      'reason_code','DECLARE_ENVIRONMENT_ACCESS_BEFORE_COACH_RECOMMENDATION',
      'requires_confirmation','[]'::jsonb,
      'accessible_options','[]'::jsonb,
      'anchor_eligible_environments','[]'::jsonb,
      'semantics',jsonb_build_object(
        'never_environment_cannot_be_recommended',true,
        'occasional_is_opportunity_not_requirement',true,
        'equipment_is_not_inferred',true,
        'recommendation_is_soft',true,
        'no_numeric_environment_score',true
      )
    );
  end if;

  select coalesce(jsonb_agg(value order by value),'[]'::jsonb)
  into v_candidates
  from jsonb_array_elements_text(v_accessible) x(value)
  where not (v_never ? value);

  v_gym_strength := (v_candidates ? 'GYM')
    and coalesce((p_environment_capabilities#>>'{GYM,GYM_STRENGTH}')::boolean,false);
  v_outdoor_conditioning := (v_candidates ? 'OUTDOOR')
    and coalesce((p_environment_capabilities#>>'{OUTDOOR,OUTDOOR_CONDITIONING}')::boolean,false);

  if nullif(p_anchor_exercise_id,'') is not null then
    select coalesce(jsonb_agg(value order by value),'[]'::jsonb)
    into v_anchor_eligible
    from jsonb_array_elements_text(v_candidates) x(value)
    where public.exercise_environment_eligible_v1(p_anchor_exercise_id,value);

    if v_primary_env is not null and v_anchor_eligible ? v_primary_env then
      v_recommended := v_primary_env;
      v_reason := 'PRIMARY_ENVIRONMENT_SUPPORTS_EXACT_ANCHOR';
    elsif jsonb_array_length(v_anchor_eligible)=1 then
      v_recommended := v_anchor_eligible->>0;
      v_reason := 'ONLY_DECLARED_ACCESS_ENVIRONMENT_SUPPORTS_EXACT_ANCHOR';
    end if;
  end if;

  if v_recommended is null and v_kind='QUALITY' and v_key='conditioning' and v_outdoor_conditioning then
    v_recommended := 'OUTDOOR';
    v_reason := 'OUTDOOR_HAS_ACTIVE_CONDITIONING_POLICY';
  elsif v_recommended is null and v_kind='MOVEMENT_PATTERN' and v_key='locomotion' and v_outdoor_conditioning then
    v_recommended := 'OUTDOOR';
    v_reason := 'LOCOMOTION_MATCHES_ACTIVE_OUTDOOR_CONDITIONING_POLICY';
  elsif v_recommended is null and v_kind='QUALITY' and v_key='strength' and v_gym_strength then
    v_recommended := 'GYM';
    v_reason := 'GYM_HAS_ACTIVE_STRENGTH_POLICY_BUT_EQUIPMENT_MUST_BE_CONFIRMED';
  elsif v_recommended is null and v_primary_env is not null and v_candidates ? v_primary_env then
    v_recommended := v_primary_env;
    v_reason := 'NO_SPECIALIZED_ENVIRONMENT_ADVANTAGE_PROVEN_USE_USER_PRIMARY';
  elsif v_recommended is null and jsonb_array_length(v_candidates)=1 then
    v_recommended := v_candidates->>0;
    v_reason := 'ONLY_ONE_ACCESSIBLE_ENVIRONMENT';
  end if;

  if v_recommended is not null and (v_never ? v_recommended) then
    raise exception 'ENVIRONMENT_RECOMMENDATION_CONTRACT_VIOLATION_NEVER';
  end if;

  if v_recommended is not null then
    select x->>'access_level'
    into v_access_level
    from jsonb_array_elements(coalesce(p_environment_access->'environments','[]'::jsonb)) x
    where x->>'environment_code'=v_recommended
    limit 1;

    v_strength := case
      when v_access_level='OCCASIONAL' then 'OPPORTUNITY'
      when v_access_level in ('PRIMARY','REGULAR') then 'PREFERRED'
      else 'SOFT'
    end;

    if v_recommended='GYM' then
      v_requires := jsonb_build_array('EXPLICIT_GYM_EQUIPMENT_AT_SESSION_TIME');
    elsif v_recommended='OUTDOOR' then
      v_requires := jsonb_build_array('SURFACE_CONTEXT_AT_SESSION_TIME');
    end if;
  end if;

  return jsonb_build_object(
    'version','program-coach-environment-recommendation-v1.2-canonical',
    'status',case when v_recommended is null then 'USER_CHOICE_WITHIN_DECLARED_ACCESS' else 'RECOMMENDATION_READY' end,
    'recommended_environment',v_recommended,
    'recommendation_strength',v_strength,
    'recommended_access_level',v_access_level,
    'reason_code',v_reason,
    'requires_confirmation',v_requires,
    'accessible_options',v_candidates,
    'anchor_eligible_environments',v_anchor_eligible,
    'semantics',jsonb_build_object(
      'never_environment_cannot_be_recommended',true,
      'occasional_is_opportunity_not_requirement',true,
      'equipment_is_not_inferred',true,
      'gym_strength_requires_explicit_equipment_at_session_time',true,
      'outdoor_requires_surface_context_at_session_time',true,
      'primary_environment_is_fallback_not_sporting_priority',true,
      'environment_does_not_define_programming_priority',true,
      'recommendation_is_soft',true,
      'no_numeric_environment_score',true
    )
  );
end;
$$;

revoke all on function public.program_coach_environment_recommendation_from_inputs_v1(jsonb,text,jsonb,jsonb,text) from public;
revoke all on function public.program_coach_environment_recommendation_from_inputs_v1(jsonb,text,jsonb,jsonb,text) from anon;
revoke all on function public.program_coach_environment_recommendation_from_inputs_v1(jsonb,text,jsonb,jsonb,text) from authenticated;

create or replace function public.program_coach_ideal_week_projection_v1(
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
  v_week date := public.d_week_start(v_anchor);
  v_week_end date := public.d_week_start(v_anchor)+6;
  v_target int := 3;
  v_priority jsonb;
  v_diag jsonb;
  v_role jsonb;
  v_trajectory jsonb;
  v_env jsonb;
  v_caps jsonb := '{}'::jsonb;
  v_primary jsonb;
  v_secondary jsonb;
  v_maintenance jsonb;
  v_completed int := 0;
  v_claimed int := 0;
  v_unmet_target int := 0;
  v_open_target int := 0;
  v_projected_count int := 0;
  v_plan_seq int;
  v_slot_seq int := 0;
  v_date date;
  v_existing_date date;
  v_existing_status text;
  v_existing_session_id uuid;
  v_existing_plan_item_id uuid;
  v_slot_priority jsonb;
  v_slot_role text;
  v_certainty text;
  v_slot_kind text;
  v_env_rec jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_claimed_items jsonb := '[]'::jsonb;
  v_completed_items jsonb := '[]'::jsonb;
  v_existing_plan jsonb := '[]'::jsonb;
  v_anchor_exercise_id text := null;
  v_is_today boolean;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;

  v_priority := public.program_coach_cycle_priority_resolver_v1(p_user_id,v_anchor);
  v_diag := public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_role := public.program_coach_session_role_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_trajectory := public.program_coach_dose_trajectory_v1(p_user_id,v_anchor,null,20,p_readiness,3,p_pain_zones);
  v_env := public.program_coach_environment_access_v1(p_user_id);
  v_primary := v_priority->'primary_priority';
  v_secondary := v_priority->'secondary_priority';
  v_maintenance := coalesce(v_priority->'maintenance','[]'::jsonb);
  v_anchor_exercise_id := nullif(v_diag#>>'{active_skill_objective,current_target,exercise_id}','');

  select coalesce(jsonb_object_agg(environment_code,formats),'{}'::jsonb)
  into v_caps
  from (
    select environment_code,
           jsonb_object_agg(format_code,coalesce((constraints_json->>'generation_enabled')::boolean,false)) formats
    from public.environment_session_format_policy group by environment_code
  ) q;

  select count(*)::int into v_completed
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)
        between v_week and v_week_end;
  v_completed := least(v_target,v_completed);
  v_unmet_target := greatest(0,v_target-v_completed);

  select coalesce(jsonb_agg(jsonb_build_object(
    'session_id',ws.id,'completed_at',ws.completed_at,
    'environment_code',coalesce(ws.actual_environment_code,ws.planned_environment_code),
    'environment_source',coalesce(ws.actual_environment_source,ws.planned_environment_source)
  ) order by coalesce(ws.completed_at,ws.created_at),ws.id),'[]'::jsonb)
  into v_completed_items
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)
        between v_week and v_week_end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'plan_item_id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,
    'session_id',i.session_id,'plan_status',i.status,'session_status',ws.status,
    'focus',ws.focus,'target_region',ws.target_region,'progression_intent',ws.progression_intent,
    'duration_minutes',ws.duration_minutes,'planned_environment_code',ws.planned_environment_code,
    'planned_environment_source',ws.planned_environment_source,
    'counts_as_realized_stimulus',false
  ) order by i.sequence_index),'[]'::jsonb),count(*)::int
  into v_claimed_items,v_claimed
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id
  where i.user_id=p_user_id and i.week_start=v_week and i.status='claimed'
    and ws.status in ('generated','in_progress');

  v_claimed := least(v_unmet_target,v_claimed);
  v_open_target := greatest(0,v_unmet_target-v_claimed);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,
    'status',i.status,'session_id',i.session_id,'planned_focus',i.planned_focus,
    'planned_target_region',i.planned_target_region,'planned_progression_intent',i.planned_progression_intent,
    'recommended_date_is_soft',true
  ) order by i.sequence_index),'[]'::jsonb)
  into v_existing_plan
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week;

  if v_open_target>0 then
    for v_plan_seq in 1..v_target loop
      exit when v_slot_seq>=v_open_target;

      v_existing_date := null; v_existing_status := null; v_existing_session_id := null; v_existing_plan_item_id := null;
      select i.id,i.recommended_date,i.status,i.session_id
      into v_existing_plan_item_id,v_existing_date,v_existing_status,v_existing_session_id
      from public.user_training_plan_items i
      where i.user_id=p_user_id and i.week_start=v_week and i.sequence_index=v_plan_seq
      limit 1;

      if v_existing_status in ('completed','claimed') then continue; end if;
      v_date := coalesce(v_existing_date,v_week+public.d_plan_recommended_offset(v_plan_seq,v_target));
      continue when v_date < v_anchor;

      v_slot_seq := v_slot_seq+1;
      v_is_today := v_date=v_anchor;

      if v_slot_seq=1 then
        v_slot_priority := v_primary;
        v_slot_role := v_role->>'recommended_role';
        v_certainty := case when v_is_today then 'CURRENT_RECOMMENDATION' else 'CONDITIONAL_FUTURE_REVALIDATE_READINESS' end;
        v_slot_kind := case when v_is_today then 'NEXT_BEST_SESSION' else 'PROJECTED_PRIMARY_PRIORITY' end;
      elsif v_slot_seq=2 and v_secondary is not null and jsonb_typeof(v_secondary)='object' then
        v_slot_priority := v_secondary; v_slot_role := 'DEVELOPMENT';
        v_certainty := 'CONDITIONAL_FUTURE'; v_slot_kind := 'PROJECTED_SECONDARY_PRIORITY';
      elsif v_slot_seq=3 and jsonb_array_length(v_maintenance)>0 then
        v_slot_priority := jsonb_build_object(
          'kind','MAINTENANCE_POOL','key','week_balance','programming_state','MAINTAIN',
          'candidates',v_maintenance,'priority_reason','PRESERVE_NON_PRIORITY_CAPACITIES_WITHOUT_FORCED_EQUAL_DISTRIBUTION');
        v_slot_role := 'MAINTENANCE'; v_certainty := 'CONDITIONAL_FUTURE'; v_slot_kind := 'PROJECTED_MAINTENANCE_POOL';
      else
        v_slot_priority := null; v_slot_role := null;
        v_certainty := 'REPLAN_AFTER_PRIOR_ACTUALS'; v_slot_kind := 'FLEXIBLE_COMPLEMENT';
      end if;

      v_env_rec := public.program_coach_environment_recommendation_from_inputs_v1(
        v_slot_priority,v_slot_role,v_env,v_caps,case when v_slot_seq=1 then v_anchor_exercise_id else null end);

      v_slots := v_slots || jsonb_build_array(jsonb_build_object(
        'sequence_index',v_slot_seq,'source_plan_sequence_index',v_plan_seq,
        'source_plan_item_id',v_existing_plan_item_id,'recommended_date',v_date,'recommended_date_is_soft',true,
        'slot_kind',v_slot_kind,'projection_certainty',v_certainty,'programming_role',v_slot_role,
        'priority',v_slot_priority,
        'dose_direction',case when v_slot_seq=1 and v_is_today then v_trajectory->>'trajectory_action' else 'TO_RECALCULATE_AT_SESSION_TIME' end,
        'environment_recommendation',v_env_rec,'existing_legacy_plan_status',v_existing_status,
        'future_readiness_unknown',not v_is_today or p_readiness is null,
        'role_requires_revalidation',not v_is_today,'replan_after_previous_actual',v_slot_seq>1
      ));
    end loop;
  end if;

  v_projected_count := jsonb_array_length(v_slots);

  return jsonb_build_object(
    'version','program-coach-ideal-week-projection-v1.4-claimed-aware',
    'mode','SHADOW_READ_ONLY',
    'status',case
      when v_unmet_target=0 then 'WEEK_TARGET_ALREADY_COMPLETED'
      when v_claimed+v_projected_count=0 then 'NO_REMAINING_SCHEDULED_OPPORTUNITY_THIS_WEEK'
      when v_claimed+v_projected_count<v_unmet_target then 'PARTIAL_WEEK_REMAINDER_NO_CATCHUP_DEBT'
      when v_env->>'status'='UNDECLARED' then 'WEEK_PROJECTED_ENVIRONMENT_ACCESS_UNDECLARED'
      else 'IDEAL_WEEK_PROJECTED' end,
    'anchor_date',v_anchor,'week_start',v_week,'week_end',v_week_end,
    'weekly_session_target',v_target,'completed_session_count',v_completed,
    'unmet_session_target',v_unmet_target,'existing_claimed_session_count',v_claimed,
    'new_projection_opportunities',v_projected_count,
    'remaining_session_opportunities',v_claimed+v_projected_count,
    'expired_soft_opportunities',greatest(0,v_unmet_target-v_claimed-v_projected_count),
    'completed_sessions',v_completed_items,'existing_claimed_sessions',v_claimed_items,
    'cycle_primary_priority',v_primary,'cycle_secondary_priority',v_secondary,'maintenance_pool',v_maintenance,
    'current_session_role',v_role->>'recommended_role','current_dose_trajectory',v_trajectory,
    'environment_access',v_env,'projected_slots',v_slots,'existing_legacy_plan_snapshot',v_existing_plan,
    'planning_contract',jsonb_build_object(
      'completed_is_actual_authority',true,'claimed_reserves_planning_capacity_but_is_not_stimulus',true,
      'available_is_soft_opportunity',true,'recommended_dates_are_soft',true,
      'past_soft_dates_are_not_shifted_forward',true,'expired_opportunities_create_no_debt',true,
      'no_session_is_generated',true,'no_plan_row_is_created_or_mutated',true,
      'future_slots_are_conditional_on_prior_actuals',true,'future_readiness_is_not_assumed',true,
      'future_dose_is_recalculated_at_session_time',true,'no_fixed_priority_exposure_frequency_is_invented',true,
      'planned_projection_is_not_stimulus',true,'completed_actuals_remain_longitudinal_authority',true),
    'authority',jsonb_build_object(
      'shadow_only',true,'may_change_existing_week_plan',false,'may_generate_sessions',false,
      'existing_week_plan_remains_runtime_authority',true)
  );
end;
$$;

revoke all on function public.program_coach_ideal_week_projection_v1(uuid,date,text,text[]) from public;
revoke all on function public.program_coach_ideal_week_projection_v1(uuid,date,text,text[]) from anon;
revoke all on function public.program_coach_ideal_week_projection_v1(uuid,date,text,text[]) from authenticated;

drop function if exists public.program_coach_ideal_week_v1(uuid,date);
drop function if exists public.program_coach_environment_recommendation_from_inputs_v1(jsonb,jsonb,text);
drop function if exists public.program_coach_environment_recommendation_from_inputs_v1(jsonb,text,jsonb,jsonb);
