update public.session_engine_policy
set version='c4-final-v1.2',
    config=jsonb_set(config,'{quality_gate,conditioning_explicit_region_min_share}','0.34'::jsonb,true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_base jsonb;
  v_reasons jsonb;
  v_count int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_min int;
  v_max int;
  v_match int := 0;
  v_required int := 0;
  v_share numeric;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_ex jsonb;
  v_region text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_base := public.c4_candidate_quality_gate(
    p_candidate,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons := coalesce(v_base->'hard_gate_reasons','[]'::jsonb);

  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;
  if found and not (v_count between v_min and v_max) then
    v_reasons:=v_reasons||jsonb_build_array('BLOCK_RULE_EXERCISE_COUNT');
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    v_share := case when p_focus in ('Conditioning','Fat Loss')
      then coalesce((v_cfg#>>'{quality_gate,conditioning_explicit_region_min_share}')::numeric,0.34)
      else coalesce((v_cfg#>>'{quality_gate,explicit_region_min_share}')::numeric,0.60)
    end;
    v_required := ceil(v_count*v_share)::int;
    for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
    loop
      select body_region into v_region from public.exercises where id=v_ex->>'exercise_id';
      if v_region=p_target_region then v_match:=v_match+1; end if;
    end loop;
    if v_match<v_required then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE');
    end if;
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',(v_base->'checks') || jsonb_build_object(
      'block_rule_min',v_min,
      'block_rule_max',v_max,
      'exercise_count',v_count,
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required,
      'region_min_share',v_share
    ),
    'version','c4-quality-gate-v1.2'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.2','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.2','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.2',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;;
