create or replace function public.program_coach_dose_trajectory_from_inputs_v1(
  p_cycle_priority jsonb,
  p_session_role jsonb,
  p_week_strategy jsonb,
  p_block_review jsonb,
  p_anchor_mastery jsonb default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := upper(coalesce(p_session_role->>'recommended_role',''));
  v_role_status text := upper(coalesce(p_session_role->>'status',''));
  v_week_bias text := upper(coalesce(p_week_strategy->>'session_intent_bias','MAINTAIN'));
  v_review_action text := upper(coalesce(p_block_review->>'recommended_action',''));
  v_mastery text := upper(coalesce(p_anchor_mastery->>'mastery_state','UNKNOWN'));
  v_action text;
  v_existing_intent text;
  v_levers jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_variant_progression_allowed boolean := false;
begin
  if v_role_status='DEFER_TO_SAFETY' or v_role='' then
    v_action := 'DEFER_TO_SAFETY';
    v_existing_intent := null;
    v_reasons := jsonb_build_array('SAFETY_AUTHORITY_PRECEDES_DOSE_TRAJECTORY');
  elsif v_role='REDUCED_STIMULUS' then
    v_action := 'REDUCE';
    v_existing_intent := 'DELOAD';
    v_levers := jsonb_build_array('REPS_OR_TIME_DOWN','DENSITY_DOWN','PRESERVE_SAFE_TECHNIQUE');
    v_reasons := jsonb_build_array('SESSION_ROLE_REDUCED_STIMULUS');
  elsif v_role='CALIBRATION' then
    v_action := 'CONTROLLED_REFERENCE';
    v_existing_intent := 'RECALIBRATE';
    v_levers := jsonb_build_array('OBSERVABLE_REFERENCE','CONTROLLED_DOSE','COMPARABILITY_OVER_MAXIMALITY');
    v_reasons := jsonb_build_array('SESSION_ROLE_CALIBRATION');
  elsif v_role='RETEST' then
    v_action := 'COMPARABLE_RETEST';
    v_existing_intent := 'RECALIBRATE';
    v_levers := jsonb_build_array('PRESERVE_PROTOCOL_SIGNATURE','PRESERVE_COMPARABLE_CONTEXT','OBSERVE_OUTCOME');
    v_reasons := jsonb_build_array('SESSION_ROLE_RETEST');
  elsif v_role='CONSOLIDATION' then
    v_action := 'CONSOLIDATE';
    v_existing_intent := 'CONSOLIDATE';
    v_levers := jsonb_build_array('VOLUME_SLIGHTLY_DOWN','DENSITY_NOT_INCREASED','PRESERVE_TECHNIQUE');
    v_reasons := jsonb_build_array('SESSION_ROLE_CONSOLIDATION');
  elsif v_role='MAINTENANCE' then
    v_action := 'MAINTAIN';
    v_existing_intent := 'MAINTAIN';
    v_levers := jsonb_build_array('PRESERVE_COMPARABLE_DOSE','PRESERVE_EXPOSURE_WITHOUT_FORCED_INCREASE');
    v_reasons := jsonb_build_array('SESSION_ROLE_MAINTENANCE');
  else
    case v_week_bias
      when 'PROGRESS' then
        v_action := 'PROGRESS';
        v_existing_intent := 'PROGRESS';
        v_levers := jsonb_build_array(
          'REPS_OR_TIME_UP_WITHIN_EXISTING_ENVELOPE',
          'DENSITY_UP_WITHIN_EXISTING_ENVELOPE',
          'LOAD_UP_ONLY_FROM_CONFIRMED_CAPABILITY',
          'VARIANT_PROGRESS_ONLY_IF_MASTERY_ALLOWS'
        );
        v_reasons := jsonb_build_array('DEVELOPMENT_ROLE','WEEK_STRATEGY_PROGRESS');
      when 'CONSOLIDATE' then
        v_action := 'CONSOLIDATE';
        v_existing_intent := 'CONSOLIDATE';
        v_levers := jsonb_build_array('VOLUME_SLIGHTLY_DOWN','DENSITY_NOT_INCREASED','PRESERVE_TECHNIQUE');
        v_reasons := jsonb_build_array('DEVELOPMENT_ROLE','WEEK_STRATEGY_CONSOLIDATE');
      when 'RECALIBRATE' then
        v_action := 'CONTROLLED_REFERENCE';
        v_existing_intent := 'RECALIBRATE';
        v_levers := jsonb_build_array('OBSERVABLE_REFERENCE','CONTROLLED_DOSE','COMPARABILITY_OVER_MAXIMALITY');
        v_reasons := jsonb_build_array('DEVELOPMENT_ROLE','WEEK_STRATEGY_RECALIBRATE');
      else
        v_action := 'REPEAT_COMPARABLE_DOSE';
        v_existing_intent := 'MAINTAIN';
        v_levers := jsonb_build_array('PRESERVE_COMPARABLE_DOSE','REPEAT_BEFORE_FORCING_INCREASE');
        v_reasons := jsonb_build_array('DEVELOPMENT_ROLE','NO_EVIDENCE_BACKED_INCREASE_THIS_WEEK');
    end case;
  end if;

  v_variant_progression_allowed := v_action='PROGRESS' and v_mastery in ('READY_TO_PROGRESS','MASTERED');

  if v_review_action in ('CONSOLIDATE_BLOCK','PRIORITIZE_DECISION_BLOCKING_CALIBRATION','RETEST_PROTOCOL_ONLY') then
    v_reasons := v_reasons || jsonb_build_array('BLOCK_REVIEW_'||v_review_action);
  end if;

  return jsonb_build_object(
    'version','program-coach-dose-trajectory-from-inputs-v1',
    'mode','SHADOW_READ_ONLY',
    'status',case when v_action='DEFER_TO_SAFETY' then 'DEFER_TO_SAFETY' else 'TRAJECTORY_READY' end,
    'trajectory_action',v_action,
    'existing_dose_policy_intent',v_existing_intent,
    'allowed_levers',v_levers,
    'reason_codes',v_reasons,
    'cycle_primary_priority',p_cycle_priority->'primary_priority',
    'cycle_secondary_priority',p_cycle_priority->'secondary_priority',
    'session_role',nullif(v_role,''),
    'week_strategy_bias',v_week_bias,
    'anchor_mastery_state',case when p_anchor_mastery is null then null else v_mastery end,
    'variant_progression_allowed',v_variant_progression_allowed,
    'principles',jsonb_build_object(
      'development_does_not_mean_increase_every_session',true,
      'progression_is_multidimensional',true,
      'exact_load_is_never_invented',true,
      'variant_progression_requires_existing_mastery_authority',true,
      'planned_dose_is_not_realized_stimulus',true,
      'actuals_drive_next_recalculation',true,
      'existing_c4_and_load_envelopes_remain_numeric_authority',true,
      'no_new_numeric_threshold_added',true,
      'no_generation_authority',true
    )
  );
end;
$$;

revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb) from anon;
revoke all on function public.program_coach_dose_trajectory_from_inputs_v1(jsonb,jsonb,jsonb,jsonb,jsonb) from authenticated;

create or replace function public.program_coach_dose_trajectory_v1(
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
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_diag jsonb;
  v_priority jsonb;
  v_role jsonb;
  v_week jsonb;
  v_review jsonb;
  v_anchor_exercise_id text := null;
  v_anchor_exercise_name text := null;
  v_anchor_pattern text := null;
  v_anchor_mastery jsonb := null;
  v_trajectory jsonb;
  v_dose_policy jsonb := null;
  v_existing_intent text;
  v_focus text;
  v_active_block_id uuid := null;
  v_week_history jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_diag := public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_priority := public.program_coach_cycle_priority_resolver_v1(p_user_id,v_anchor);
  v_role := public.program_coach_session_role_v1(p_user_id,v_anchor,p_readiness,p_pain_zones);
  v_week := public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(v_anchor));
  v_review := public.program_coach_block_review_v1(p_user_id,v_anchor);

  if coalesce(v_priority#>>'{primary_priority,kind}','')='MOVEMENT_PATTERN' then
    v_anchor_exercise_id := nullif(v_diag#>>'{active_skill_objective,current_target,exercise_id}','');
    if v_anchor_exercise_id is not null then
      select coalesce(nullif(e.display_name,''),e.name),e.movement_pattern
      into v_anchor_exercise_name,v_anchor_pattern
      from public.exercises e
      where e.id=v_anchor_exercise_id;

      if v_anchor_pattern is distinct from v_priority#>>'{primary_priority,key}' then
        v_anchor_exercise_id := null;
        v_anchor_exercise_name := null;
        v_anchor_pattern := null;
      end if;
    end if;
  end if;

  if v_anchor_exercise_id is not null then
    v_anchor_mastery := public.w5_exercise_mastery_v1(p_user_id,v_anchor_exercise_id,v_anchor);
  end if;

  v_trajectory := public.program_coach_dose_trajectory_from_inputs_v1(
    v_priority,v_role,v_week,v_review,v_anchor_mastery
  );
  v_existing_intent := nullif(v_trajectory->>'existing_dose_policy_intent','');
  v_focus := coalesce(nullif(p_focus,''),nullif(v_priority->>'primary_goal',''),'General Fitness');

  if v_existing_intent is not null and v_trajectory->>'status'<>'DEFER_TO_SAFETY' then
    v_dose_policy := public.program_coach_dose_policy_v1(
      p_user_id,
      v_anchor,
      v_focus,
      greatest(1,coalesce(p_wod_minutes,20)),
      coalesce(nullif(p_readiness,''),'normal'),
      v_existing_intent,
      greatest(1,coalesce(p_exercise_count,3))
    );
  end if;

  begin
    v_active_block_id := nullif(v_priority#>>'{continuity,active_block_id}','')::uuid;
  exception when others then
    v_active_block_id := null;
  end;

  if v_active_block_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'week_start',s.week_start,
      'block_week_index',s.block_week_index,
      'phase',s.phase,
      'strategy_version',s.version,
      'session_intent_bias',coalesce(s.strategy_json->>'session_intent_bias',s.strategy_json->>'base_session_intent_bias'),
      'generated_at',s.generated_at
    ) order by s.week_start),'[]'::jsonb)
    into v_week_history
    from public.program_coach_week_states s
    where s.user_id=p_user_id and s.base_block_id=v_active_block_id and s.week_start<=public.d_week_start(v_anchor);
  end if;

  return v_trajectory || jsonb_build_object(
    'version','program-coach-dose-trajectory-v1',
    'anchor_date',v_anchor,
    'anchor_candidate',case when v_anchor_exercise_id is null then null else jsonb_build_object(
      'exercise_id',v_anchor_exercise_id,
      'exercise_name',v_anchor_exercise_name,
      'movement_pattern',v_anchor_pattern,
      'source','ACTIVE_SKILL_CURRENT_TARGET',
      'mastery',v_anchor_mastery
    ) end,
    'anchor_resolution',case
      when v_anchor_exercise_id is not null then 'EXACT_ACTIVE_SKILL_ANCHOR'
      when coalesce(v_priority#>>'{primary_priority,kind}','')='MOVEMENT_PATTERN' then 'NO_EXACT_ANCHOR_WITHOUT_STRONG_EVIDENCE'
      else 'QUALITY_PRIORITY_NO_EXACT_EXERCISE_ANCHOR_REQUIRED'
    end,
    'existing_numeric_dose_authority',v_dose_policy,
    'observed_block_week_history',v_week_history,
    'source_versions',jsonb_build_object(
      'diagnostic',v_diag->>'version',
      'cycle_priority',v_priority->>'version',
      'session_role',v_role->>'version',
      'week_strategy',v_week->>'version',
      'block_review',v_review->>'version',
      'dose_policy',case when v_dose_policy is null then null else v_dose_policy->>'version' end
    ),
    'authority',jsonb_build_object(
      'shadow_only',true,
      'may_change_session_generation',false,
      'existing_dose_policy_remains_numeric_authority',true,
      'existing_session_coach_remains_authoritative',true
    )
  );
end;
$$;

revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,integer,text,integer,text[]) from public;
revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,integer,text,integer,text[]) from anon;
revoke all on function public.program_coach_dose_trajectory_v1(uuid,date,text,integer,text,integer,text[]) from authenticated;