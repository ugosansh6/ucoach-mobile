create or replace function public.c4_apply_movement_calibration_tiebreak_v1(
  p_user_id uuid,
  p_result jsonb,
  p_progression_intent text,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb:=p_result;
  selected jsonb:=p_result->'selected_candidate';
  candidate jsonb;
  target jsonb;
  cfg jsonb;
  top_score numeric;
  eq_delta numeric;
  intent text:=upper(coalesce(p_progression_intent,''));
  v_anchor date:=coalesce((select anchor_date from public.user_coaching_directive_runtime where user_id=p_user_id),current_date);
  selected_has_exact_learning_anchor boolean:=false;
begin
  if coalesce(p_result->>'status','')<>'READY' or selected is null then
    return r;
  end if;

  -- Calibration is a secondary coaching opportunity, never an authority over
  -- recovery or an explicit progression-oriented session.
  if intent in ('DELOAD','PROGRESS') then
    return r;
  end if;

  select config into cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  -- Reuse the existing near-equivalent quality band. No new sports threshold.
  eq_delta:=coalesce((cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);
  top_score:=coalesce((selected->>'c4_selection_score')::numeric,0);

  select exists(
    select 1
    from jsonb_array_elements(coalesce(selected->'exercises','[]'::jsonb)) e
    join public.pi_exercise_directives(p_user_id,v_anchor,90) d
      on d.exercise_id=e->>'exercise_id'
    join public.user_exercise_capabilities c
      on c.user_id=p_user_id and c.exercise_id=d.exercise_id
    where d.source='b2.7-live-capability'
      and d.directive in ('RECALIBRATE','LEARN')
      and c.last_valid_observed_at is not null
      and c.last_valid_observed_at::date < v_anchor
  ) into selected_has_exact_learning_anchor;

  -- If the organically selected WOD already gives us a useful exact reference,
  -- do not interfere with normal selection/variety.
  if selected_has_exact_learning_anchor then
    return jsonb_set(
      r,
      '{w1_movement_calibration_policy}',
      jsonb_build_object(
        'version','w1-movement-calibration-tiebreak-v1',
        'used',false,
        'reason','SELECTED_CANDIDATE_ALREADY_CONTAINS_EXACT_LEARNING_ANCHOR',
        'soft_tiebreak_only',true,
        'quality_equivalence_delta',eq_delta,
        'exact_exercise_reference_only',true
      ),
      true
    );
  end if;

  with dirs as (
    select
      d.exercise_id,
      d.exercise_name,
      d.directive,
      d.priority_score,
      d.confidence,
      d.evidence_count,
      c.last_valid_observed_at
    from public.pi_exercise_directives(p_user_id,v_anchor,90) d
    join public.user_exercise_capabilities c
      on c.user_id=p_user_id and c.exercise_id=d.exercise_id
    where d.source='b2.7-live-capability'
      and d.directive in ('RECALIBRATE','LEARN')
      and c.last_valid_observed_at is not null
      and c.last_valid_observed_at::date < v_anchor
  ), eligible as (
    select
      x,
      coalesce((x->>'c4_selection_score')::numeric,0) score,
      (
        select count(*)::int
        from dirs d
        where exists(
          select 1
          from jsonb_array_elements(coalesce(x->'exercises','[]'::jsonb)) e
          where e->>'exercise_id'=d.exercise_id
        )
      ) target_count
    from jsonb_array_elements(coalesce(p_result->'accepted_candidates','[]'::jsonb)) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=top_score-eq_delta
  )
  select
    e.x,
    jsonb_build_object(
      'exercise_id',d.exercise_id,
      'exercise_name',d.exercise_name,
      'directive',d.directive,
      'priority_score',d.priority_score,
      'confidence',d.confidence,
      'evidence_count',d.evidence_count,
      'last_valid_observed_at',d.last_valid_observed_at
    )
  into candidate,target
  from eligible e
  join dirs d on exists(
    select 1
    from jsonb_array_elements(coalesce(e.x->'exercises','[]'::jsonb)) ex
    where ex->>'exercise_id'=d.exercise_id
  )
  where e.target_count>0
    -- Outside an explicit RECALIBRATE session, keep this deliberately subtle:
    -- choose a WOD containing exactly one exact learning/retest anchor.
    and (intent='RECALIBRATE' or e.target_count=1)
  order by
    case d.directive when 'RECALIBRATE' then 0 else 1 end,
    d.last_valid_observed_at asc,
    d.evidence_count desc,
    d.priority_score desc,
    e.score desc
  limit 1;

  if candidate is null then
    return jsonb_set(
      r,
      '{w1_movement_calibration_policy}',
      jsonb_build_object(
        'version','w1-movement-calibration-tiebreak-v1',
        'used',false,
        'reason','NO_EXACT_LEARNING_ANCHOR_INSIDE_EQUIVALENT_QUALITY_BAND',
        'soft_tiebreak_only',true,
        'quality_equivalence_delta',eq_delta,
        'exact_exercise_reference_only',true
      ),
      true
    );
  end if;

  candidate:=candidate||jsonb_build_object(
    'w1_movement_calibration_tiebreak',jsonb_build_object(
      'used',true,
      'intent',intent,
      'target',target,
      'quality_equivalence_delta',eq_delta,
      'original_selected_score',top_score,
      'selected_score',(candidate->>'c4_selection_score')::numeric,
      'reason','prefer_one_exact_existing_reference_inside_existing_equivalent_quality_band_after_all_hard_gates',
      'does_not_change_prescription',true,
      'does_not_create_extra_exercise',true,
      'does_not_force_retest_if_no_equivalent_candidate',true
    )
  );

  r:=jsonb_set(r,'{selected_candidate}',candidate,true);
  r:=jsonb_set(
    r,
    '{w1_movement_calibration_policy}',
    jsonb_build_object(
      'version','w1-movement-calibration-tiebreak-v1',
      'used',true,
      'target',target,
      'soft_tiebreak_only',true,
      'hard_gates_already_passed',true,
      'quality_equivalence_delta',eq_delta,
      'exact_exercise_reference_only',true,
      'normal_session_prefers_single_anchor',true,
      'pain_equipment_readiness_and_workload_remain_higher_authority',true
    ),
    true
  );

  return r;
end;
$function$;

revoke all on function public.c4_apply_movement_calibration_tiebreak_v1(uuid,jsonb,text,text) from public, anon;
grant execute on function public.c4_apply_movement_calibration_tiebreak_v1(uuid,jsonb,text,text) to authenticated, service_role;

create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c4-final-default'::text
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare r jsonb;
begin
  r:=public.solve_session_engine_c4_pre_p1d(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_exact_wod_minutes,p_policy_key
  );
  r:=public.c4_apply_protocol_retest_tiebreak_v1(p_user_id,r,p_progression_intent,p_policy_key);
  r:=public.c4_apply_quality_band_variety_v1(r,p_focus,p_policy_key);
  r:=public.c4_apply_movement_calibration_tiebreak_v1(p_user_id,r,p_progression_intent,p_policy_key);
  return jsonb_set(r,'{version}','"c4-final-v1.10-w1-calibration"'::jsonb,true);
end;
$function$;