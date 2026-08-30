create or replace function public.program_coach_goal_quality_roles_v2(p_goal text)
returns jsonb
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select case coalesce(p_goal,'General Fitness')
    when 'Strength' then jsonb_build_array(
      jsonb_build_object('key','strength','goal_role','PRIORITY'),
      jsonb_build_object('key','conditioning','goal_role','MAINTAIN'),
      jsonb_build_object('key','stability','goal_role','SUPPORT'),
      jsonb_build_object('key','mobility','goal_role','SUPPORT'))
    when 'Conditioning' then jsonb_build_array(
      jsonb_build_object('key','conditioning','goal_role','PRIORITY'),
      jsonb_build_object('key','muscular_endurance','goal_role','DEVELOP'),
      jsonb_build_object('key','strength','goal_role','MAINTAIN'),
      jsonb_build_object('key','mobility','goal_role','SUPPORT'))
    when 'Fat Loss' then jsonb_build_array(
      jsonb_build_object('key','conditioning','goal_role','PRIORITY'),
      jsonb_build_object('key','muscular_endurance','goal_role','DEVELOP'),
      jsonb_build_object('key','strength','goal_role','MAINTAIN'),
      jsonb_build_object('key','mobility','goal_role','SUPPORT'))
    when 'Muscle Gain' then jsonb_build_array(
      jsonb_build_object('key','strength','goal_role','PRIORITY'),
      jsonb_build_object('key','muscular_endurance','goal_role','DEVELOP'),
      jsonb_build_object('key','conditioning','goal_role','MAINTAIN'),
      jsonb_build_object('key','mobility','goal_role','SUPPORT'))
    else jsonb_build_array(
      jsonb_build_object('key','strength','goal_role','DEVELOP'),
      jsonb_build_object('key','conditioning','goal_role','DEVELOP'),
      jsonb_build_object('key','muscular_endurance','goal_role','MAINTAIN'),
      jsonb_build_object('key','stability','goal_role','MAINTAIN'),
      jsonb_build_object('key','mobility','goal_role','SUPPORT'))
  end;
$$;

comment on function public.program_coach_goal_quality_roles_v2(text) is
'Qualitative translation of the existing goal doctrine. It intentionally preserves legacy goal semantics while removing numeric weights as programming authority.';

create or replace function public.program_coach_quality_diagnostic_v2(p_user_id uuid,p_anchor_date date default current_date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_goal text;
  v_roles jsonb;
  v_rows jsonb:='[]'::jsonb;
  v_item jsonb;
  v_profile record;
  v_level text;
  v_trend text;
  v_state text;
  v_evidence text;
  v_reason jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_goal:=public.d_primary_goal(p_user_id);
  v_roles:=public.program_coach_goal_quality_roles_v2(v_goal);

  for v_item in select value from jsonb_array_elements(v_roles)
  loop
    select p.explanation_json->>'level' as level,
           p.explanation_json->>'trend_label' as trend_label,
           p.sample_count,
           p.calculated_at
    into v_profile
    from public.user_athletic_profile p
    where p.user_id=p_user_id and p.dimension=v_item->>'key';

    if found then
      v_level:=coalesce(nullif(v_profile.level,''),'En calibration');
      v_trend:=coalesce(nullif(v_profile.trend_label,''),'Progression en calibration');
      v_evidence:=case when v_level='En calibration' then 'CALIBRATION_NEEDED' else 'OBSERVED' end;
    elsif v_item->>'key'='muscular_endurance' then
      v_level:=null;
      v_trend:=null;
      v_evidence:='NO_GLOBAL_DIMENSION_CONTRACT';
    else
      v_level:='En calibration';
      v_trend:='Progression en calibration';
      v_evidence:='CALIBRATION_NEEDED';
    end if;

    v_state:=case
      when v_item->>'goal_role'='SUPPORT' then 'SUPPORT'
      when v_item->>'goal_role'='MAINTAIN' then 'MAINTAIN'
      when v_evidence='CALIBRATION_NEEDED' then 'CALIBRATE'
      when v_item->>'goal_role' in ('PRIORITY','DEVELOP') then 'DEVELOP'
      else 'MAINTAIN'
    end;

    v_reason:=jsonb_build_array(
      'GOAL_ROLE_'||coalesce(v_item->>'goal_role','UNKNOWN'),
      case v_evidence
        when 'CALIBRATION_NEEDED' then 'RELEVANT_QUALITY_NEEDS_CALIBRATION'
        when 'NO_GLOBAL_DIMENSION_CONTRACT' then 'QUALITY_NOT_GLOBALLY_MEASURED_YET'
        else 'PERSONAL_QUALITY_EVIDENCE_AVAILABLE'
      end,
      case
        when v_trend='Recalibration' then 'PERSONAL_TREND_RECALIBRATION'
        when v_trend='Progression' then 'PERSONAL_TREND_PROGRESSING'
        when v_trend='Forte progression' then 'PERSONAL_TREND_STRONGLY_PROGRESSING'
        when v_trend='Stable' then 'PERSONAL_TREND_STABLE'
        else 'PERSONAL_TREND_UNKNOWN'
      end
    );

    v_rows:=v_rows||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'quality_key',v_item->>'key',
      'goal_role',v_item->>'goal_role',
      'programming_state',v_state,
      'evidence_status',v_evidence,
      'observed_level',v_level,
      'trend_label',v_trend,
      'sample_count',v_profile.sample_count,
      'last_calculated_at',v_profile.calculated_at,
      'reason_codes',v_reason,
      'numeric_priority_weight_used',false,
      'population_norm_used',false
    )));
  end loop;

  return jsonb_build_object(
    'version','program-coach-quality-diagnostic-v2',
    'mode','SHADOW_READ_ONLY',
    'anchor_date',v_anchor,
    'primary_goal',v_goal,
    'qualities',v_rows,
    'principles',jsonb_build_object(
      'goal_semantics_preserved_from_v1',true,
      'legacy_numeric_weights_removed_from_authority',true,
      'missing_evidence_is_calibration_not_weakness',true,
      'personal_observation_preferred',true,
      'no_generation_authority',true
    )
  );
end;
$function$;

create or replace function public.program_coach_cycle_priority_resolver_v2(p_user_id uuid,p_anchor_date date default current_date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_diag jsonb;
  v_quality jsonb;
  v_env jsonb;
  v_block jsonb:=null;
  v_primary jsonb:=null;
  v_secondary jsonb:=null;
  v_maintenance jsonb:='[]'::jsonb;
  v_unknown jsonb:='[]'::jsonb;
  v_goal text;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_diag:=public.program_coach_programming_diagnostic_v1(p_user_id,v_anchor);
  v_quality:=public.program_coach_quality_diagnostic_v2(p_user_id,v_anchor);
  v_env:=public.program_coach_environment_access_v1(p_user_id);
  v_goal:=v_quality->>'primary_goal';

  select jsonb_build_object('id',b.id,'primary_goal',b.primary_goal,'phase',b.phase,'started_on',b.started_on,'target_end_on',b.target_end_on,'current_week_index',b.current_week_index)
  into v_block
  from public.program_coach_blocks b
  where b.user_id=p_user_id and b.layer_type='BASE' and b.status='active'
  order by b.started_on desc,b.created_at desc limit 1;

  select jsonb_build_object(
    'kind','MOVEMENT_PATTERN','key',x->>'movement_pattern','programming_state','DEVELOP',
    'priority_reason','CAUSAL_LIMITING_FACTOR_FOR_ACTIVE_SKILL','evidence_strength','CAUSAL',
    'reason_codes',coalesce(x->'reason_codes','[]'::jsonb),'causal_requirements',coalesce(x->'causal_requirements','[]'::jsonb))
  into v_primary
  from jsonb_array_elements(coalesce(v_diag->'movement_pattern_diagnosis','[]'::jsonb)) x
  where x->>'programming_state'='LIMITING' and x->>'evidence_strength'='CAUSAL'
  limit 1;

  if v_primary is null then
    select jsonb_build_object(
      'kind','MOVEMENT_PATTERN','key',x->>'movement_pattern',
      'programming_state',case when x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED' then 'CALIBRATE' else 'DEVELOP' end,
      'priority_reason',case when x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_NEEDS_CALIBRATION' then 'ACTIVE_SKILL_TARGET' end,
      'evidence_strength','DIRECT_GOAL','reason_codes',coalesce(x->'reason_codes','[]'::jsonb))
    into v_primary
    from jsonb_array_elements(coalesce(v_diag->'movement_pattern_diagnosis','[]'::jsonb)) x
    where x->>'evidence_strength'='DIRECT_GOAL'
      and (x->>'programming_state'='TO_DEVELOP' or x->'reason_codes' ? 'ACTIVE_SKILL_TARGET_CALIBRATION_NEEDED')
    limit 1;
  end if;

  if v_primary is null then
    select jsonb_build_object(
      'kind','QUALITY','key',q->>'quality_key','programming_state',q->>'programming_state',
      'priority_reason',case
        when q->>'programming_state'='CALIBRATE' then 'GOAL_RELEVANT_QUALITY_NEEDS_CALIBRATION'
        when q->>'goal_role'='PRIORITY' then 'EXPLICIT_GOAL_PRIMARY_QUALITY'
        else 'GENERAL_FITNESS_PERSONAL_GAP_CANDIDATE' end,
      'goal_role',q->>'goal_role','observed_level',q->>'observed_level','trend_label',q->>'trend_label',
      'evidence_status',q->>'evidence_status','reason_codes',coalesce(q->'reason_codes','[]'::jsonb))
    into v_primary
    from jsonb_array_elements(coalesce(v_quality->'qualities','[]'::jsonb)) q
    where q->>'goal_role' in ('PRIORITY','DEVELOP')
    order by
      case when q->>'goal_role'='PRIORITY' then 1 else 2 end,
      case when q->>'programming_state'='CALIBRATE' then 1 else 2 end,
      case
        when coalesce(q->>'observed_level','En calibration')='En calibration' then 1
        when q->>'observed_level'='Débutant' then 2
        when q->>'observed_level'='Intermédiaire' then 3
        when q->>'observed_level'='Bon niveau' then 4
        when q->>'observed_level'='Athlète' then 5
        else 6 end,
      case
        when coalesce(q->>'trend_label','')='Recalibration' then 1
        when q->>'trend_label'='Stable' then 2
        when q->>'trend_label'='Progression en calibration' then 3
        when q->>'trend_label'='Progression' then 4
        when q->>'trend_label'='Forte progression' then 5
        else 6 end,
      q->>'quality_key'
    limit 1;
  end if;

  select jsonb_build_object(
    'kind','QUALITY','key',q->>'quality_key','programming_state',q->>'programming_state',
    'priority_reason','SECONDARY_GOAL_RELEVANT_QUALITY','goal_role',q->>'goal_role',
    'observed_level',q->>'observed_level','trend_label',q->>'trend_label','reason_codes',coalesce(q->'reason_codes','[]'::jsonb))
  into v_secondary
  from jsonb_array_elements(coalesce(v_quality->'qualities','[]'::jsonb)) q
  where q->>'goal_role' in ('PRIORITY','DEVELOP')
    and (v_primary is null or q->>'quality_key'<>coalesce(v_primary->>'key',''))
  order by
    case when q->>'programming_state'='CALIBRATE' then 1 else 2 end,
    case
      when coalesce(q->>'observed_level','En calibration')='En calibration' then 1
      when q->>'observed_level'='Débutant' then 2
      when q->>'observed_level'='Intermédiaire' then 3
      when q->>'observed_level'='Bon niveau' then 4
      when q->>'observed_level'='Athlète' then 5
      else 6 end,
    q->>'quality_key'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind','QUALITY','key',q->>'quality_key','programming_state','MAINTAIN','goal_role',q->>'goal_role',
    'observed_level',q->>'observed_level','trend_label',q->>'trend_label','reason_codes',coalesce(q->'reason_codes','[]'::jsonb)) order by q->>'quality_key'),'[]'::jsonb)
  into v_maintenance
  from jsonb_array_elements(coalesce(v_quality->'qualities','[]'::jsonb)) q
  where q->>'goal_role'='MAINTAIN';

  select coalesce(jsonb_agg(jsonb_build_object('movement_pattern',x->>'movement_pattern','reason_codes',coalesce(x->'reason_codes','[]'::jsonb)) order by x->>'movement_pattern'),'[]'::jsonb)
  into v_unknown
  from jsonb_array_elements(coalesce(v_diag->'movement_pattern_diagnosis','[]'::jsonb)) x
  where x->>'programming_state'='UNKNOWN';

  return jsonb_build_object(
    'version','program-coach-cycle-priority-resolver-v2',
    'mode','SHADOW_READ_ONLY',
    'status',case when v_primary is null then 'INSUFFICIENT_EVIDENCE' else 'PRIORITY_CANDIDATE_READY' end,
    'anchor_date',v_anchor,'primary_goal',v_goal,
    'primary_priority',v_primary,'secondary_priority',v_secondary,'maintenance',v_maintenance,
    'unknown_patterns',v_unknown,'quality_diagnostic',v_quality,
    'environment_context',jsonb_build_object(
      'status',coalesce(v_env->>'status','UNDECLARED'),
      'primary_environment',v_env->'primary_environment',
      'accessible_environment_codes',coalesce(v_env->'accessible_environment_codes','[]'::jsonb),
      'never_environment_codes',coalesce(v_env->'never_environment_codes','[]'::jsonb)),
    'active_block',v_block,
    'decision_order',jsonb_build_array('ACTIVE_SKILL_CAUSAL_LIMITER','ACTIVE_SKILL_TARGET_OR_CALIBRATION','EXPLICIT_GOAL_PRIMARY_QUALITY','GENERAL_FITNESS_QUALITATIVE_PERSONAL_EVIDENCE'),
    'principles',jsonb_build_object(
      'no_generation_authority',true,
      'legacy_numeric_priority_score_can_never_win',true,
      'goal_semantics_preserved',true,
      'missing_evidence_is_calibration_not_weakness',true,
      'personal_level_and_trend_used_qualitatively',true,
      'one_primary_priority',true,
      'at_most_one_secondary_priority',true,
      'safety_readiness_feasibility_remain_higher_authority',true)
  );
end;
$function$;

revoke execute on function public.program_coach_goal_quality_roles_v2(text) from anon;
revoke execute on function public.program_coach_quality_diagnostic_v2(uuid,date) from anon;
revoke execute on function public.program_coach_cycle_priority_resolver_v2(uuid,date) from anon;
grant execute on function public.program_coach_goal_quality_roles_v2(text) to authenticated;
grant execute on function public.program_coach_quality_diagnostic_v2(uuid,date) to authenticated;
grant execute on function public.program_coach_cycle_priority_resolver_v2(uuid,date) to authenticated;
