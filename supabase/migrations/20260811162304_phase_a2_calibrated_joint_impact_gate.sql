update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        config #- '{quality_gate,max_joint_impact_5_count}',
        '{quality_gate,high_joint_impact_threshold}',
        '4'::jsonb,
        true
      ),
      '{quality_gate,low_readiness_max_high_joint_impact_count}',
      '1'::jsonb,
      true
    ),
    '{quality_gate,normal_readiness_max_high_joint_impact_count}',
    '2'::jsonb,
    true
  ),
  '{quality_gate,high_readiness_max_high_joint_impact_count}',
  '2'::jsonb,
  true
)
where policy_key = 'c4-final-default';

create or replace function public.c4_candidate_quality_gate(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_zone_ids text[] := public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]));
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_ex jsonb;
  e record;
  v_reasons jsonb := '[]'::jsonb;
  v_jump int := 0;
  v_high_impact int := 0;
  v_high_impact_threshold int := 4;
  v_high_impact_max int := 2;
  v_emom_tech int := 0;
  v_emom_fatigue int := 0;
  v_hinge5 boolean := false;
  v_jump5 boolean := false;
  v_anchor boolean := false;
  v_count int := 0;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key = p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %', p_policy_key;
  end if;

  v_high_impact_threshold := coalesce(
    (v_cfg#>>'{quality_gate,high_joint_impact_threshold}')::int,
    4
  );

  v_high_impact_max := case v_readiness
    when 'low' then coalesce(
      (v_cfg#>>'{quality_gate,low_readiness_max_high_joint_impact_count}')::int,
      1
    )
    when 'high' then coalesce(
      (v_cfg#>>'{quality_gate,high_readiness_max_high_joint_impact_count}')::int,
      2
    )
    else coalesce(
      (v_cfg#>>'{quality_gate,normal_readiness_max_high_joint_impact_count}')::int,
      2
    )
  end;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    v_reasons := v_reasons || coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb);
  end if;

  for v_ex in
    select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_count := v_count + 1;

    select id,movement_pattern,exercise_family,technical_complexity,fatigue_score,joint_impact,transition_cost,warmup_only
    into e
    from public.exercises
    where id = v_ex->>'exercise_id';

    if not found then
      v_reasons := v_reasons || jsonb_build_array('UNKNOWN_EXERCISE:'||(v_ex->>'exercise_id'));
      continue;
    end if;

    if not public.exercise_safe_for_zones(e.id,v_zone_ids) then
      v_reasons := v_reasons || jsonb_build_array('PAIN_GATE:'||e.id);
    end if;

    if not public.exercise_equipment_compatible(e.id,p_inventory) then
      v_reasons := v_reasons || jsonb_build_array('EQUIPMENT_GATE:'||e.id);
    end if;

    if coalesce(e.warmup_only,false) then
      v_reasons := v_reasons || jsonb_build_array('WARMUP_ONLY_IN_WOD:'||e.id);
    end if;

    if e.technical_complexity is null or e.fatigue_score is null or e.joint_impact is null then
      v_reasons := v_reasons || jsonb_build_array('MISSING_CRITICAL_METADATA:'||e.id);
    end if;

    if coalesce(e.technical_complexity,99)>p_max_complexity then
      v_reasons := v_reasons || jsonb_build_array('TECHNICAL_LEVEL_GATE:'||e.id);
    end if;

    if v_readiness='low'
       and coalesce(e.technical_complexity,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_complexity}')::int,3) then
      v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_COMPLEXITY:'||e.id);
    end if;

    if v_readiness='low'
       and coalesce(e.fatigue_score,99) > coalesce((v_cfg#>>'{quality_gate,low_readiness_max_fatigue}')::int,4) then
      v_reasons := v_reasons || jsonb_build_array('LOW_READINESS_FATIGUE:'||e.id);
    end if;

    if e.movement_pattern='Jump' then v_jump := v_jump + 1; end if;
    if coalesce(e.joint_impact,0) >= v_high_impact_threshold then v_high_impact := v_high_impact + 1; end if;

    if v_mechanic='AMRAP'
       and coalesce(e.transition_cost,99) > coalesce((v_cfg#>>'{quality_gate,amrap_max_transition_cost}')::int,3) then
      v_reasons := v_reasons || jsonb_build_array('AMRAP_TRANSITION_COST:'||e.id);
    end if;

    if v_mechanic='EMOM' and coalesce(e.technical_complexity,0)>=4 then v_emom_tech := v_emom_tech + 1; end if;
    if v_mechanic='EMOM' and coalesce(e.fatigue_score,0)>=5 then v_emom_fatigue := v_emom_fatigue + 1; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Hinge' and coalesce(e.fatigue_score,0)>=5 then v_hinge5 := true; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Jump' and coalesce(e.fatigue_score,0)>=5 then v_jump5 := true; end if;
    if e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion') then v_anchor := true; end if;
  end loop;

  if v_count=0 then v_reasons := v_reasons || jsonb_build_array('EMPTY_WOD'); end if;

  if v_jump > coalesce((v_cfg#>>'{quality_gate,max_jump_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('MAX_JUMP_COUNT');
  end if;

  if v_high_impact > v_high_impact_max then
    v_reasons := v_reasons || jsonb_build_array('HIGH_JOINT_IMPACT_COUNT');
  end if;

  if v_mechanic='EMOM'
     and v_emom_tech > coalesce((v_cfg#>>'{quality_gate,emom_max_high_complexity_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('EMOM_HIGH_COMPLEXITY_COUNT');
  end if;

  if v_mechanic='EMOM'
     and v_emom_fatigue > coalesce((v_cfg#>>'{quality_gate,emom_max_fatigue_5_count}')::int,1) then
    v_reasons := v_reasons || jsonb_build_array('EMOM_FATIGUE_5_COUNT');
  end if;

  if v_mechanic='FOR_TIME' and v_hinge5 and v_jump5 then
    v_reasons := v_reasons || jsonb_build_array('FOR_TIME_HINGE5_PLUS_JUMP5');
  end if;

  if p_focus in ('Conditioning','Fat Loss') and not v_anchor then
    v_reasons := v_reasons || jsonb_build_array('CONDITIONING_ANCHOR_REQUIRED');
  end if;

  if coalesce((p_candidate#>>'{c4_final,feasible}')::boolean,false)=false then
    v_reasons := v_reasons || jsonb_build_array('FINAL_SOLVER_INFEASIBLE');
  end if;

  if coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','')='OVERFILLED' then
    v_reasons := v_reasons || jsonb_build_array('FINAL_DURATION_OVERFILLED');
  end if;

  return jsonb_build_object(
    'pass', jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons', v_reasons,
    'mechanic', v_mechanic,
    'checks', jsonb_build_object(
      'pain', true,
      'equipment', true,
      'technical_level', true,
      'readiness_caps', true,
      'jump_count', v_jump,
      'high_joint_impact_threshold', v_high_impact_threshold,
      'high_joint_impact_count', v_high_impact,
      'high_joint_impact_max', v_high_impact_max,
      'conditioning_anchor', v_anchor
    ),
    'version', 'c4-quality-gate-v1.1-a2'
  );
end;
$function$;;
