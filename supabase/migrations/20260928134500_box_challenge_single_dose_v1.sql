-- PERF-014: BOX challenge target exact duplicate-dose removal.
-- V4 historically calls V3 (which computes program_coach_dose_trajectory_v3)
-- and then immediately recomputes the same trajectory with richer "today"
-- context, overwriting all trajectory/role/evolution outputs from the first
-- call. BOX now starts from V2 and executes only the authoritative full-context
-- trajectory. Non-BOX environments retain the exact legacy V4 path.

create or replace function public.program_coach_challenge_target_v4_legacy_path_v1(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_focus text default 'General Fitness',
  p_readiness text default 'normal',
  p_progression_intent text default 'MAINTAIN',
  p_session_intent text default 'CLASSIC',
  p_wod_minutes integer default 20,
  p_exercise_count integer default 3,
  p_pain_zones text[] default '{}'::text[],
  p_policy_key text default 'c4-final-default',
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  r jsonb;
  v_role jsonb;
  v_dose jsonb;
  v_evo jsonb;
  v_action text;
  v_role_name text;
  v_mode text;
  v_relevance text;
  v_before text;
  v_after text;
  v_cap_reason text:=null;
  v_numeric jsonb;
  v_context jsonb:=coalesce(p_session_context,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'focus',p_focus,
      'session_intent',p_session_intent,
      'progression_intent',p_progression_intent
    ));
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  r:=public.program_coach_challenge_target_v3(
    p_user_id,p_anchor_date,p_focus,p_readiness,p_progression_intent,p_session_intent,
    p_wod_minutes,p_exercise_count,p_pain_zones,p_policy_key
  );

  v_before:=upper(coalesce(
    r->>'pre_evolution_effective_level',
    r->>'effective_level',
    'NORMAL'
  ));

  v_dose:=public.program_coach_dose_trajectory_v3(
    p_user_id,p_anchor_date,p_focus,p_wod_minutes,p_readiness,p_exercise_count,
    p_pain_zones,v_context
  );
  v_role:=coalesce(v_dose->'session_role_v3','{}'::jsonb);
  v_evo:=coalesce(v_dose->'evolution_policy','{}'::jsonb);
  v_action:=upper(coalesce(v_dose->>'trajectory_action','MAINTAIN'));
  v_role_name:=upper(coalesce(v_role->>'recommended_role',''));
  v_mode:=upper(coalesce(v_evo->>'evolution_mode',''));
  v_relevance:=upper(coalesce(v_role#>>'{evolution_relevance,status}','UNKNOWN'));
  v_after:=v_before;

  if v_dose->>'status'='DEFER_TO_SAFETY'
     or v_role_name='REDUCED_STIMULUS' then
    v_after:='NORMAL';
    v_cap_reason:='GLOBAL_SAFETY_OR_RECOVERY_CAP';

  elsif v_role_name='RETEST' then
    v_after:='NORMAL';
    v_cap_reason:='RETEST_REQUIRES_COMPARABLE_SESSION_CONTEXT';

  elsif v_relevance='ALIGNED'
     and v_action in (
       'REDUCE','CONTROLLED_REFERENCE','COMPARABLE_RETEST','CONSOLIDATE',
       'MAINTAIN','QUALITY_FIRST_DEVELOPMENT','CONTROLLED_TRANSFER_PROBE',
       'TRANSFER_WITHIN_EXISTING_SESSION_ENVELOPE','REPEAT_COMPARABLE_DOSE'
     ) then
    v_after:='NORMAL';
    v_cap_reason:='ALIGNED_EVOLUTION_DOSE_DOES_NOT_AUTHORIZE_GLOBAL_CHALLENGE_INCREASE';

  elsif v_relevance='NOT_ALIGNED' then
    v_cap_reason:='LONGITUDINAL_TARGET_NOT_TRAINED_TODAY_NO_GLOBAL_CAP';

  else
    v_cap_reason:='EVOLUTION_RELEVANCE_UNKNOWN_PRESERVE_EXISTING_CHALLENGE_DECISION';
  end if;

  v_numeric:=v_dose->'existing_numeric_dose_authority';
  if v_numeric is not null then
    r:=jsonb_set(r,'{dose_policy}',v_numeric,true);
  end if;

  r:=jsonb_set(r,'{pre_evolution_effective_level}',to_jsonb(v_before),true);
  r:=jsonb_set(r,'{effective_level}',to_jsonb(v_after),true);
  r:=jsonb_set(r,'{session_role_v3}',v_role,true);
  r:=jsonb_set(r,'{dose_trajectory_v3}',v_dose,true);
  r:=jsonb_set(r,'{evolution_policy}',v_evo,true);
  r:=jsonb_set(r,'{session_context_relevance}',coalesce(v_role->'evolution_relevance','{}'::jsonb),true);
  r:=jsonb_set(r,'{version}',to_jsonb('challenge-target-v4-today-vs-longitudinal'::text),true);

  r:=jsonb_set(
    r,'{evolution_dose_gate}',
    jsonb_build_object(
      'applied',v_after<>v_before,
      'before_level',v_before,
      'after_level',v_after,
      'reason',v_cap_reason,
      'session_role',nullif(v_role_name,''),
      'trajectory_action',v_action,
      'evolution_mode',nullif(v_mode,''),
      'evolution_relevance',v_relevance
    ),true
  );

  r:=jsonb_set(
    r,'{authority}',
    coalesce(r->'authority','{}'::jsonb)||jsonb_build_object(
      'today_context_required_for_longitudinal_evolution_cap',true,
      'unrelated_longitudinal_target_never_globally_caps_today_session',true,
      'safety_and_recovery_remain_global',true,
      'numeric_dose_authority_remains_existing_c4_prg004',true
    ),true
  );

  return r;
end;
$function$;

create or replace function public.program_coach_challenge_target_v4(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_focus text default 'General Fitness',
  p_readiness text default 'normal',
  p_progression_intent text default 'MAINTAIN',
  p_session_intent text default 'CLASSIC',
  p_wod_minutes integer default 20,
  p_exercise_count integer default 3,
  p_pain_zones text[] default '{}'::text[],
  p_policy_key text default 'c4-final-default',
  p_session_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  r jsonb;
  v_role jsonb;
  v_dose jsonb;
  v_evo jsonb;
  v_action text;
  v_role_name text;
  v_mode text;
  v_relevance text;
  v_before text;
  v_after text;
  v_cap_reason text:=null;
  v_numeric jsonb;
  v_env text:=public.normalize_session_environment_v1(
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN')
  );
  v_context jsonb:=coalesce(p_session_context,'{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'focus',p_focus,
      'session_intent',p_session_intent,
      'progression_intent',p_progression_intent
    ));
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  if v_env<>'BOX' then
    return public.program_coach_challenge_target_v4_legacy_path_v1(
      p_user_id,p_anchor_date,p_focus,p_readiness,p_progression_intent,p_session_intent,
      p_wod_minutes,p_exercise_count,p_pain_zones,p_policy_key,p_session_context
    );
  end if;

  -- BOX exact fast path: V3's first dose trajectory is not authoritative in V4.
  -- Start from V2, then run the single full-context trajectory that V4 retains.
  r:=public.program_coach_challenge_target_v2(
    p_user_id,p_anchor_date,p_focus,p_readiness,p_progression_intent,p_session_intent,
    p_wod_minutes,p_exercise_count,p_pain_zones,p_policy_key
  );

  v_before:=upper(coalesce(r->>'effective_level','NORMAL'));

  v_dose:=public.program_coach_dose_trajectory_v3(
    p_user_id,p_anchor_date,p_focus,p_wod_minutes,p_readiness,p_exercise_count,
    p_pain_zones,v_context
  );
  v_role:=coalesce(v_dose->'session_role_v3','{}'::jsonb);
  v_evo:=coalesce(v_dose->'evolution_policy','{}'::jsonb);
  v_action:=upper(coalesce(v_dose->>'trajectory_action','MAINTAIN'));
  v_role_name:=upper(coalesce(v_role->>'recommended_role',''));
  v_mode:=upper(coalesce(v_evo->>'evolution_mode',''));
  v_relevance:=upper(coalesce(v_role#>>'{evolution_relevance,status}','UNKNOWN'));
  v_after:=v_before;

  if v_dose->>'status'='DEFER_TO_SAFETY'
     or v_role_name='REDUCED_STIMULUS' then
    v_after:='NORMAL';
    v_cap_reason:='GLOBAL_SAFETY_OR_RECOVERY_CAP';

  elsif v_role_name='RETEST' then
    v_after:='NORMAL';
    v_cap_reason:='RETEST_REQUIRES_COMPARABLE_SESSION_CONTEXT';

  elsif v_relevance='ALIGNED'
     and v_action in (
       'REDUCE','CONTROLLED_REFERENCE','COMPARABLE_RETEST','CONSOLIDATE',
       'MAINTAIN','QUALITY_FIRST_DEVELOPMENT','CONTROLLED_TRANSFER_PROBE',
       'TRANSFER_WITHIN_EXISTING_SESSION_ENVELOPE','REPEAT_COMPARABLE_DOSE'
     ) then
    v_after:='NORMAL';
    v_cap_reason:='ALIGNED_EVOLUTION_DOSE_DOES_NOT_AUTHORIZE_GLOBAL_CHALLENGE_INCREASE';

  elsif v_relevance='NOT_ALIGNED' then
    v_cap_reason:='LONGITUDINAL_TARGET_NOT_TRAINED_TODAY_NO_GLOBAL_CAP';

  else
    v_cap_reason:='EVOLUTION_RELEVANCE_UNKNOWN_PRESERVE_EXISTING_CHALLENGE_DECISION';
  end if;

  v_numeric:=v_dose->'existing_numeric_dose_authority';
  if v_numeric is not null then
    r:=jsonb_set(r,'{dose_policy}',v_numeric,true);
  end if;

  r:=jsonb_set(r,'{pre_evolution_effective_level}',to_jsonb(v_before),true);
  r:=jsonb_set(r,'{effective_level}',to_jsonb(v_after),true);
  r:=jsonb_set(r,'{session_role_v3}',v_role,true);
  r:=jsonb_set(r,'{dose_trajectory_v3}',v_dose,true);
  r:=jsonb_set(r,'{evolution_policy}',v_evo,true);
  r:=jsonb_set(r,'{session_context_relevance}',coalesce(v_role->'evolution_relevance','{}'::jsonb),true);
  r:=jsonb_set(r,'{version}',to_jsonb('challenge-target-v4-today-vs-longitudinal'::text),true);

  r:=jsonb_set(
    r,'{evolution_dose_gate}',
    jsonb_build_object(
      'applied',v_after<>v_before,
      'before_level',v_before,
      'after_level',v_after,
      'reason',v_cap_reason,
      'session_role',nullif(v_role_name,''),
      'trajectory_action',v_action,
      'evolution_mode',nullif(v_mode,''),
      'evolution_relevance',v_relevance
    ),true
  );

  -- Preserve the V3 authority flags that remained in legacy V4 after its
  -- second trajectory overwrote the first trajectory outputs.
  r:=jsonb_set(
    r,'{authority}',
    coalesce(r->'authority','{}'::jsonb)||jsonb_build_object(
      'evolution_policy_may_cap_global_challenge',true,
      'evolution_policy_never_bypasses_c4_quality_gate',true,
      'numeric_dose_authority_remains_existing_c4_prg004',true,
      'calendar_may_not_raise_or_lower_challenge',true,
      'today_context_required_for_longitudinal_evolution_cap',true,
      'unrelated_longitudinal_target_never_globally_caps_today_session',true,
      'safety_and_recovery_remain_global',true
    ),true
  );

  return r;
end;
$function$;
