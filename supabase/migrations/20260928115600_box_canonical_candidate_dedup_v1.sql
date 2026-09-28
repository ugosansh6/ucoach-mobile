-- PERF-009: BOX canonical candidate dedup before C4 expansion.
-- Only candidates that would enter the same mechanic composition with the same
-- leading contract slots are eligible for dedup. Within such a group, dedup is
-- applied only when one candidate dominates the others on the C2 coherence
-- metrics used before C4. All C4 hard gates remain unchanged.

create or replace function public.c4_candidate_contract_signature_v1(
  p_candidate jsonb,
  p_duration_minutes integer
) returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate->>'variant',''));
  v_contract jsonb;
  v_min int;
  v_target int;
  v_max int;
  v_desired int;
  v_strategy text;
  v_ids text;
begin
  v_contract:=public.c4_mechanic_composition_contract(v_mechanic,nullif(v_variant,''));

  if not coalesce((v_contract->>'found')::boolean,false) then
    select string_agg(coalesce(e->>'exercise_id','?'),',' order by ord)
    into v_ids
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
         with ordinality x(e,ord);

    return concat_ws('|',v_mechanic,nullif(v_variant,''),'FULL',coalesce(v_ids,''));
  end if;

  v_min:=coalesce((v_contract->>'min_exercises')::int,1);
  v_target:=coalesce((v_contract->>'target_exercises')::int,v_min);
  v_max:=coalesce((v_contract->>'max_exercises')::int,v_target);
  v_strategy:=coalesce(v_contract->>'composition_strategy','preserve_then_adapt');

  if v_min=v_max or v_strategy='preserve_anchor_exact_count' then
    v_desired:=v_target;
  elsif p_duration_minutes<=35 then
    v_desired:=v_min;
  elsif p_duration_minutes<=55 then
    v_desired:=v_target;
  else
    v_desired:=least(v_max,v_target+1);
  end if;

  select string_agg(coalesce(e->>'exercise_id','?'),',' order by ord)
  into v_ids
  from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
       with ordinality x(e,ord)
  where ord<=v_desired;

  return concat_ws(
    '|',
    v_mechanic,
    nullif(v_variant,''),
    v_desired::text,
    coalesce(v_ids,'')
  );
end;
$function$;

create or replace function public.simulate_session_engine_c2_pre_box_canonical_dedup_v1(
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
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw jsonb;
  v_filtered jsonb;
  v_requires_anchor boolean := p_focus in ('Conditioning','Fat Loss');
  v_status text := 'OK';
begin
  v_raw := public.simulate_session_engine_c2_raw(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  if v_requires_anchor then
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(coalesce(v_raw->'candidate_sessions','[]'::jsonb))
         with ordinality t(s,ord)
    where coalesce((s#>>'{session_components,conditioning_anchor}')::boolean,false);

    if jsonb_array_length(v_filtered)=0 then
      v_status := 'NO_SAFE_COHERENT_WOD';
    end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
    if jsonb_array_length(v_filtered)=0 then
      v_status := 'NO_SAFE_COHERENT_WOD';
    end if;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}',to_jsonb('c2-sim-v1.5-p1b-weekly'::text),true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion OR training_focus=Conditioning',
      'explicit_target_region_enforced',p_target_region in ('Upper','Lower','Core'),
      'weekly_stimulus_consumed_by_candidate_solver',true,
      'weekly_stimulus_policy','realized_week_75pct_plus_rolling_10d_25pct_soft_bias_no_debt',
      'planned_sessions_not_used_for_weekly_bias',true,
      'safety_gates_precede_weekly_bias',true,
      'never_force_when_no_safe_coherent_candidate',true
    ),
    true
  );
end;
$function$;

create or replace function public.simulate_session_engine_c2(
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
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_candidates jsonb;
  v_before int:=0;
  v_after int:=0;
  v_env text:=public.normalize_session_environment_v1(
    coalesce(nullif(current_setting('ugerod.session_environment',true),''),'UNKNOWN')
  );
begin
  v_result:=public.simulate_session_engine_c2_pre_box_canonical_dedup_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  v_candidates:=coalesce(v_result->'candidate_sessions','[]'::jsonb);
  v_before:=jsonb_array_length(v_candidates);

  if v_env='BOX'
     and p_focus in ('Strength','Muscle Gain','General Fitness')
     and v_before>1 then

    with base as (
      select
        s,
        ord,
        public.c4_candidate_contract_signature_v1(s,p_duration_minutes) sig,
        coalesce(nullif(s->>'coach_score','')::numeric,0) coach_score,
        coalesce((s#>>'{session_components,conditioning_anchor}')::boolean,false) conditioning_anchor,
        coalesce(nullif(s#>>'{session_components,pattern_diversity}','')::numeric,0) pattern_diversity,
        coalesce(nullif(s#>>'{session_components,muscle_diversity}','')::numeric,0) muscle_diversity,
        coalesce(nullif(s#>>'{session_components,avg_transition_cost}','')::numeric,999) transition_cost,
        coalesce(nullif(s#>>'{session_components,avg_exercise_coach_score}','')::numeric,0) avg_exercise_score
      from jsonb_array_elements(v_candidates) with ordinality t(s,ord)
    ),
    winners as (
      select distinct on (sig)
        sig,s,ord,coach_score,conditioning_anchor,pattern_diversity,muscle_diversity,
        transition_cost,avg_exercise_score
      from base
      order by sig,coach_score desc,ord
    ),
    dominance as (
      select
        w.sig,
        bool_and(
          w.coach_score>=b.coach_score
          and (w.conditioning_anchor or not b.conditioning_anchor)
          and w.pattern_diversity>=b.pattern_diversity
          and w.muscle_diversity>=b.muscle_diversity
          and w.transition_cost<=b.transition_cost
          and w.avg_exercise_score>=b.avg_exercise_score
        ) as winner_dominates
      from winners w
      join base b on b.sig=w.sig
      group by w.sig
    ),
    kept as (
      select b.s,b.ord
      from base b
      join dominance d on d.sig=b.sig
      left join winners w on w.sig=b.sig
      where not d.winner_dominates or b.ord=w.ord
    )
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_candidates
    from kept;

    v_after:=jsonb_array_length(v_candidates);

    v_result:=jsonb_set(v_result,'{candidate_sessions}',v_candidates,true);
    v_result:=jsonb_set(
      v_result,
      '{coherence_gate,box_canonical_candidate_dedup}',
      jsonb_build_object(
        'version','box-canonical-candidate-dedup-v1',
        'applied',v_after<v_before,
        'candidate_count_before',v_before,
        'candidate_count_after',v_after,
        'removed_count',greatest(0,v_before-v_after),
        'dominance_required',true,
        'c4_hard_gates_unchanged',true,
        'composition_contract_signature',true
      ),
      true
    );
  end if;

  return v_result;
end;
$function$;
