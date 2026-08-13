-- C54 — Utilisation des longues séances sans remplissage artificiel
-- Uniquement comme tiebreak dans une bande de qualité équivalente.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    jsonb_set(config,'{block_budget,skill_minutes_long}','12'::jsonb,true),
    '{block_budget,skill_minutes_very_long}','15'::jsonb,true
  ),
  '{long_session_selection}',
  jsonb_build_object(
    'min_duration_minutes',75,
    'equivalent_score_delta',1.5,
    'prefer_more_usable_wod_time_only_inside_equivalent_quality_band',true
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.solve_session_engine_c4_raw_v15(
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
as $function$
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
  v_tiebreak jsonb;
  v_effective_weights jsonb;
  v_top_score numeric;
  v_equivalent_delta numeric;
  v_long_min int;
  v_selected_wod int;
  v_tiebreak_wod int;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %',p_policy_key;
  end if;

  if p_focus='Conditioning' then
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights_conditioning,coach_score}')::numeric,0.52);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights_conditioning,whole_wod_fit}')::numeric,0.28);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights_conditioning,anti_redundancy}')::numeric,0.20);
  else
    v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
    v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
    v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);
  end if;

  v_effective_weights:=jsonb_build_object(
    'coach_score',v_weight_coach,
    'whole_wod_fit',v_weight_whole,
    'anti_redundancy',v_weight_red,
    'focus_specific',p_focus='Conditioning',
    'hard_quality_gates_run_before_ranking',true
  );

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  for v_candidate in
    select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(
      v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default'
    );
    v_gate := public.c4_candidate_quality_gate_v2(
      v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
    );
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,
        2
      );

      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score,
          'c4_selection_weights_effective',v_effective_weights
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(
          select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb)
          from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x
        ),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      x
      order by
        (x->>'c4_selection_score')::numeric desc,
        (x->>'coach_score')::numeric desc
    ),
    '[]'::jsonb
  )
  into v_sorted
  from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.7','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate',
      'selection_weights_effective',v_effective_weights
    );
  end if;

  v_selected := v_sorted->0;
  v_long_min:=coalesce((v_cfg#>>'{long_session_selection,min_duration_minutes}')::int,75);
  v_equivalent_delta:=coalesce((v_cfg#>>'{long_session_selection,equivalent_score_delta}')::numeric,1.5);

  if p_duration_minutes>=v_long_min and p_exact_wod_minutes is not null then
    v_top_score:=coalesce((v_selected->>'c4_selection_score')::numeric,0);

    select x
    into v_tiebreak
    from jsonb_array_elements(v_sorted) x
    where coalesce((x->>'c4_selection_score')::numeric,0)>=v_top_score-v_equivalent_delta
    order by
      coalesce(nullif(x#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0) desc,
      coalesce((x->>'c4_selection_score')::numeric,0) desc,
      coalesce((x->>'coach_score')::numeric,0) desc
    limit 1;

    if v_tiebreak is not null then
      v_selected_wod:=coalesce(nullif(v_selected#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);
      v_tiebreak_wod:=coalesce(nullif(v_tiebreak#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int,0);

      if v_tiebreak_wod>v_selected_wod then
        v_selected:=v_tiebreak||jsonb_build_object(
          'c4_long_session_utilization_tiebreak',jsonb_build_object(
            'used',true,
            'quality_equivalence_delta',v_equivalent_delta,
            'original_top_score',v_top_score,
            'selected_score',(v_tiebreak->>'c4_selection_score')::numeric,
            'original_wod_minutes',v_selected_wod,
            'selected_wod_minutes',v_tiebreak_wod,
            'reason','prefer_more_usable_time_only_inside_equivalent_quality_band'
          )
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'version','c4-final-v1.7','status','READY','production_mutation',false,
    'stimulus',v_stimulus,'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'selection_weights_effective',v_effective_weights,
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$function$;
