-- Phase C3 — Whole-WOD mechanic simulation (read-only / simulation only)
-- C2 chooses coherent candidates. C3 checks whether the assembled WOD can actually fit
-- the selected mechanic, time envelope and fatigue/density constraints.

insert into public.session_engine_policy(policy_key,version,active,config,updated_at)
values (
  'c3-sim-default',
  'c3-whole-wod-v1',
  false,
  jsonb_build_object(
    'simulation_only', true,
    'wod_budget', jsonb_build_object(
      'fraction_of_session', 0.45,
      'min_minutes', 12,
      'max_minutes', 30,
      'note', 'Default only when no exact WOD block duration is supplied. Exact architecture duration takes precedence.'
    ),
    'operational_assumptions', jsonb_build_object(
      'reps_standard_seconds_per_rep', 2.5,
      'reps_heavy_seconds_per_rep', 3.5,
      'reps_unilateral_seconds_per_rep', 2.5,
      'metabolic_high_seconds_per_rep', 1.8,
      'distance_default_m_per_second', 2.0,
      'transition_seconds_per_cost_point', 3.0,
      'amrap_sustainable_fraction', 0.90,
      'amrap_low_fraction', 0.80,
      'emom_max_work_seconds', 50,
      'emom_min_rest_seconds', 10,
      'for_time_target_fraction_of_cap', 0.75,
      'circuit_round_rest_seconds', 45,
      'strength_rest_seconds', 75,
      'strength_max_sets', 4,
      'progressive_interval_seconds', 60,
      'progressive_stop_reserve_seconds', 8,
      'note', 'Operational simulation defaults, not physiological norms. They are explicit so they can be calibrated later from observed UGEROD sessions.'
    ),
    'hard_rules', jsonb_build_object(
      'never_force_infeasible_session', true,
      'emom_requires_rest_margin', true,
      'for_time_must_fit_cap', true,
      'pain_and_equipment_already_filtered_by_c2', true
    )
  ),
  now()
)
on conflict (policy_key) do update
set version=excluded.version,active=false,config=excluded.config,updated_at=now();

create or replace function public.c3_wod_budget_minutes(
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c3-sim-default'
)
returns integer
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_fraction numeric;
  v_min int;
  v_max int;
  v_result int;
begin
  if p_total_duration_minutes is null or p_total_duration_minutes < 30 or p_total_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 30 and 90 minutes';
  end if;

  if p_exact_wod_minutes is not null then
    if p_exact_wod_minutes < 8 or p_exact_wod_minutes >= p_total_duration_minutes then
      raise exception 'Exact WOD duration must be >= 8 and lower than total session duration';
    end if;
    return p_exact_wod_minutes;
  end if;

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_fraction := coalesce((v_cfg#>>'{wod_budget,fraction_of_session}')::numeric,0.45);
  v_min := coalesce((v_cfg#>>'{wod_budget,min_minutes}')::int,12);
  v_max := coalesce((v_cfg#>>'{wod_budget,max_minutes}')::int,30);
  v_result := round(p_total_duration_minutes*v_fraction)::int;
  return greatest(v_min,least(v_max,v_result));
end;
$$;

create or replace function public.c3_unit_estimate(
  p_exercise_id text,
  p_prescription jsonb,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  e record;
  v_type text;
  v_reps_min numeric;
  v_reps_max numeric;
  v_reps_each numeric;
  v_reps_total numeric;
  v_duration_min numeric;
  v_duration_max numeric;
  v_duration numeric;
  v_distance_min numeric;
  v_distance_max numeric;
  v_distance numeric;
  v_sec_per_rep numeric;
  v_speed numeric;
  v_work_seconds numeric;
  v_transition_seconds numeric;
  v_primary_muscles text[];
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  select id,prescription_type,tracking_modes,movement_side,fatigue_score,transition_cost,technical_complexity,movement_pattern,exercise_family,body_region
  into e from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  v_type := coalesce(p_prescription->>'prescription_type',e.prescription_type,'reps_standard');
  v_reps_min := nullif(p_prescription->>'reps_min','')::numeric;
  v_reps_max := nullif(p_prescription->>'reps_max','')::numeric;
  v_duration_min := nullif(p_prescription->>'duration_seconds_min','')::numeric;
  v_duration_max := nullif(p_prescription->>'duration_seconds_max','')::numeric;
  v_distance_min := nullif(p_prescription->>'distance_meters_min','')::numeric;
  v_distance_max := nullif(p_prescription->>'distance_meters_max','')::numeric;

  if v_reps_min is not null or v_reps_max is not null then
    v_reps_each := (coalesce(v_reps_min,v_reps_max)+coalesce(v_reps_max,v_reps_min))/2.0;
    v_reps_total := case when coalesce(p_prescription->>'reps_semantics','total')='per_side' then v_reps_each*2 else v_reps_each end;
  end if;

  if v_duration_min is not null or v_duration_max is not null then
    v_duration := (coalesce(v_duration_min,v_duration_max)+coalesce(v_duration_max,v_duration_min))/2.0;
  end if;

  if v_distance_min is not null or v_distance_max is not null then
    v_distance := (coalesce(v_distance_min,v_distance_max)+coalesce(v_distance_max,v_distance_min))/2.0;
  end if;

  v_sec_per_rep := case v_type
    when 'reps_heavy' then coalesce((v_cfg#>>'{operational_assumptions,reps_heavy_seconds_per_rep}')::numeric,3.5)
    when 'reps_unilateral' then coalesce((v_cfg#>>'{operational_assumptions,reps_unilateral_seconds_per_rep}')::numeric,2.5)
    when 'metabolic_high' then coalesce((v_cfg#>>'{operational_assumptions,metabolic_high_seconds_per_rep}')::numeric,1.8)
    else coalesce((v_cfg#>>'{operational_assumptions,reps_standard_seconds_per_rep}')::numeric,2.5)
  end;
  v_speed := coalesce((v_cfg#>>'{operational_assumptions,distance_default_m_per_second}')::numeric,2.0);

  v_work_seconds := case
    when v_duration is not null then v_duration
    when v_distance is not null then v_distance/greatest(0.1,v_speed)
    when v_reps_total is not null then v_reps_total*v_sec_per_rep
    else 20
  end;

  v_transition_seconds := greatest(0,coalesce(e.transition_cost,1)) * coalesce((v_cfg#>>'{operational_assumptions,transition_seconds_per_cost_point}')::numeric,3.0);

  select coalesce(array_agg(em.muscle_id order by em.muscle_id),'{}'::text[])
  into v_primary_muscles
  from public.exercise_muscles em
  where em.exercise_id=p_exercise_id and em.priority='primary';

  return jsonb_strip_nulls(jsonb_build_object(
    'exercise_id',p_exercise_id,
    'prescription_type',v_type,
    'reps_each',round(v_reps_each,2),
    'reps_total',round(v_reps_total,2),
    'duration_seconds',round(v_duration,2),
    'distance_meters',round(v_distance,2),
    'estimated_active_work_seconds',round(v_work_seconds,2),
    'estimated_transition_seconds',round(v_transition_seconds,2),
    'fatigue_score',coalesce(e.fatigue_score,3),
    'technical_complexity',coalesce(e.technical_complexity,3),
    'movement_pattern',e.movement_pattern,
    'exercise_family',e.exercise_family,
    'body_region',e.body_region,
    'primary_muscles',to_jsonb(v_primary_muscles),
    'estimate_basis',case when v_duration is not null then 'prescribed_time' when v_distance is not null then 'distance_default_speed' when v_reps_total is not null then 'rep_pacing_default' else 'fallback_20_seconds' end
  ));
end;
$$;

create or replace function public.c3_simulate_candidate_wod(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb := coalesce(p_candidate->'exercises','[]'::jsonb);
  v_n int := jsonb_array_length(v_exercises);
  v_wod_min int;
  v_wod_sec numeric;
  v_round_active numeric := 0;
  v_round_transition numeric := 0;
  v_round_sec numeric := 0;
  v_total_active numeric := 0;
  v_predicted_sec numeric := 0;
  v_rest_sec numeric := 0;
  v_rounds numeric := 0;
  v_rounds_low numeric := 0;
  v_rounds_high numeric := 0;
  v_cycles int := 0;
  v_sets int := 0;
  v_rungs int := 0;
  v_stage int := 0;
  v_density numeric := 0;
  v_total_reps numeric := 0;
  v_total_distance numeric := 0;
  v_total_isometric numeric := 0;
  v_fatigue_units numeric := 0;
  v_max_station_work numeric := 0;
  v_min_station_rest numeric := 60;
  v_status text := 'OK';
  v_reasons jsonb := '[]'::jsonb;
  v_units jsonb := '[]'::jsonb;
  v_unit jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_multiplier numeric := 1;
  v_emom_max numeric;
  v_emom_min_rest numeric;
  v_amrap_sustain numeric;
  v_amrap_low numeric;
  v_for_time_fraction numeric;
  v_circuit_rest numeric;
  v_strength_rest numeric;
  v_strength_max_sets int;
  v_progressive_interval numeric;
  v_progressive_reserve numeric;
  v_increment_seconds numeric := 0;
  v_base_progressive_work numeric := 0;
  v_muscle_total numeric := 0;
  v_max_muscle numeric := 0;
  v_max_muscle_share numeric := 0;
  v_local_fatigue_index numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_target_local_fatigue numeric := coalesce((p_stimulus#>>'{local_fatigue,score}')::numeric,50);
  v_density_fit numeric := 0;
  v_local_fatigue_fit numeric := 0;
  v_whole_wod_fit numeric := 0;
  rec record;
begin
  if v_n=0 then
    return jsonb_build_object('status','NO_EXERCISES','feasible',false);
  end if;

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_wod_min := public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_policy_key);
  v_wod_sec := v_wod_min*60;

  v_emom_max := coalesce((v_cfg#>>'{operational_assumptions,emom_max_work_seconds}')::numeric,50);
  v_emom_min_rest := coalesce((v_cfg#>>'{operational_assumptions,emom_min_rest_seconds}')::numeric,10);
  v_amrap_sustain := coalesce((v_cfg#>>'{operational_assumptions,amrap_sustainable_fraction}')::numeric,0.90);
  v_amrap_low := coalesce((v_cfg#>>'{operational_assumptions,amrap_low_fraction}')::numeric,0.80);
  v_for_time_fraction := coalesce((v_cfg#>>'{operational_assumptions,for_time_target_fraction_of_cap}')::numeric,0.75);
  v_circuit_rest := coalesce((v_cfg#>>'{operational_assumptions,circuit_round_rest_seconds}')::numeric,45);
  v_strength_rest := coalesce((v_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
  v_strength_max_sets := coalesce((v_cfg#>>'{operational_assumptions,strength_max_sets}')::int,4);
  v_progressive_interval := coalesce((v_cfg#>>'{operational_assumptions,progressive_interval_seconds}')::numeric,60);
  v_progressive_reserve := coalesce((v_cfg#>>'{operational_assumptions,progressive_stop_reserve_seconds}')::numeric,8);

  for v_ex in select value from jsonb_array_elements(v_exercises)
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_unit := public.c3_unit_estimate(v_ex->>'exercise_id',v_pres,p_policy_key);
    v_units := v_units || jsonb_build_array(v_unit);
    v_round_active := v_round_active + coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0);
    v_round_transition := v_round_transition + coalesce((v_unit->>'estimated_transition_seconds')::numeric,0);
    v_fatigue_units := v_fatigue_units + coalesce((v_unit->>'fatigue_score')::numeric,3);
    v_max_station_work := greatest(v_max_station_work,coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0));
    v_min_station_rest := least(v_min_station_rest,60-coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0));
    if nullif(v_unit->>'reps_total','') is not null then
      v_increment_seconds := v_increment_seconds + greatest(0.8,coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(v_unit->>'reps_total')::numeric));
    end if;
  end loop;

  v_round_sec := greatest(1,v_round_active+v_round_transition);

  case v_mechanic
    when 'AMRAP' then
      v_rounds := greatest(1,floor(v_wod_sec/v_round_sec*v_amrap_sustain));
      v_rounds_low := greatest(1,floor(v_wod_sec/v_round_sec*v_amrap_low));
      v_rounds_high := greatest(v_rounds,floor(v_wod_sec/v_round_sec));
      v_total_active := v_round_active*v_rounds;
      v_predicted_sec := v_wod_sec;
      v_rest_sec := greatest(0,v_wod_sec-v_total_active-v_round_transition*v_rounds);

    when 'EMOM' then
      v_cycles := floor(v_wod_min/greatest(1,v_n));
      if v_cycles<1 then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('emom_cycle_longer_than_wod');
      end if;
      if v_max_station_work>v_emom_max or v_min_station_rest<v_emom_min_rest then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('emom_insufficient_rest_margin');
      end if;
      v_rounds:=greatest(0,v_cycles);
      v_total_active:=v_round_active*v_rounds;
      v_predicted_sec:=greatest(0,v_cycles)*v_n*60;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);

    when 'FOR_TIME' then
      v_rounds := greatest(1,least(6,round((v_wod_sec*v_for_time_fraction)/v_round_sec)));
      v_predicted_sec := v_round_sec*v_rounds;
      v_total_active := v_round_active*v_rounds;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_rounds);
      if v_predicted_sec>v_wod_sec then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('predicted_for_time_exceeds_cap');
      end if;

    when 'CIRCUIT' then
      v_rounds := greatest(1,floor((v_wod_sec+v_circuit_rest)/(v_round_sec+v_circuit_rest)));
      v_predicted_sec := least(v_wod_sec,v_rounds*v_round_sec+greatest(0,v_rounds-1)*v_circuit_rest);
      v_total_active := v_round_active*v_rounds;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_rounds);

    when 'STRENGTH' then
      v_sets := greatest(1,least(v_strength_max_sets,floor(v_wod_sec/greatest(1,v_round_sec+v_n*v_strength_rest))));
      v_rounds := v_sets;
      v_predicted_sec := v_sets*v_round_sec + greatest(0,v_sets-1)*v_n*v_strength_rest;
      v_total_active := v_round_active*v_sets;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_sets);
      if v_sets<2 then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('strength_block_cannot_fit_two_quality_sets');
      end if;

    when 'LADDER' then
      v_rungs := greatest(3,least(7,floor(v_wod_sec/v_round_sec)));
      v_rounds := v_rungs;
      v_multiplier := (v_rungs+1)/2.0;
      v_predicted_sec := least(v_wod_sec,v_round_sec*v_multiplier);
      v_total_active := v_round_active*v_multiplier;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active);

    when 'PYRAMID' then
      v_rungs := 5;
      v_multiplier := 3.8;
      if v_round_sec*v_multiplier>v_wod_sec then
        v_rungs:=3;
        v_multiplier:=2.4;
      end if;
      v_rounds:=v_rungs;
      v_predicted_sec:=v_round_sec*v_multiplier;
      v_total_active:=v_round_active*v_multiplier;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);
      if v_predicted_sec>v_wod_sec then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('pyramid_volume_exceeds_wod_budget');
      end if;

    when 'PROGRESSIVE_INTERVAL' then
      v_base_progressive_work := v_round_active+v_round_transition;
      if v_base_progressive_work>v_progressive_interval-v_progressive_reserve then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('progressive_interval_start_does_not_fit');
        v_stage:=0;
      else
        v_stage := least(v_wod_min, greatest(1, floor((v_progressive_interval-v_progressive_reserve-v_base_progressive_work)/greatest(1,v_increment_seconds))+1));
      end if;
      v_rounds:=v_stage;
      v_predicted_sec:=least(v_wod_sec,v_stage*v_progressive_interval);
      v_total_active:=case when v_stage>0 then v_stage*v_round_active + greatest(0,v_stage-1)*v_stage/2.0*v_increment_seconds else 0 end;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);

    else
      v_status:='UNSUPPORTED_MECHANIC';
      v_reasons:=v_reasons||jsonb_build_array('unsupported_mechanic:'||v_mechanic);
      v_predicted_sec:=0;
      v_total_active:=0;
      v_rounds:=0;
  end case;

  -- Aggregate predicted volume using the execution multiplier of the mechanic.
  v_multiplier := case
    when v_mechanic='LADDER' then greatest(1,(v_rungs+1)/2.0)
    when v_mechanic='PYRAMID' then case when v_rungs=5 then 3.8 else 2.4 end
    when v_mechanic='PROGRESSIVE_INTERVAL' then greatest(0,v_stage)
    else greatest(0,v_rounds)
  end;

  select
    coalesce(sum(coalesce(nullif(u->>'reps_total','')::numeric,0)*v_multiplier),0),
    coalesce(sum(coalesce(nullif(u->>'distance_meters','')::numeric,0)*v_multiplier),0),
    coalesce(sum(coalesce(nullif(u->>'duration_seconds','')::numeric,0)*v_multiplier),0)
  into v_total_reps,v_total_distance,v_total_isometric
  from jsonb_array_elements(v_units) u;

  -- Local fatigue concentration: share of weighted primary-muscle exposure carried by the most-loaded primary muscle.
  with unit_rows as (
    select u,
           coalesce((u->>'fatigue_score')::numeric,3)*v_multiplier as weighted
    from jsonb_array_elements(v_units) u
  ), muscle_rows as (
    select m.value#>>'{}' as muscle_id, ur.weighted
    from unit_rows ur
    cross join lateral jsonb_array_elements(coalesce(ur.u->'primary_muscles','[]'::jsonb)) m
  ), agg as (
    select muscle_id,sum(weighted) w from muscle_rows group by muscle_id
  )
  select coalesce(sum(w),0),coalesce(max(w),0) into v_muscle_total,v_max_muscle from agg;

  v_max_muscle_share := case when v_muscle_total>0 then v_max_muscle/v_muscle_total else 0 end;
  v_local_fatigue_index := least(100,round(v_max_muscle_share*100,2));
  v_density := case when v_predicted_sec>0 then least(100,round(v_total_active/v_predicted_sec*100,2)) else 0 end;
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_local_fatigue_fit := greatest(0,100-abs(v_local_fatigue_index-v_target_local_fatigue));
  v_whole_wod_fit := round(v_density_fit*0.60+v_local_fatigue_fit*0.40,2);

  if v_status='OK' and v_mechanic in ('AMRAP','CIRCUIT','FOR_TIME','LADDER','PYRAMID') and v_round_sec>v_wod_sec then
    v_status:='INFEASIBLE';
    v_reasons:=v_reasons||jsonb_build_array('single_round_exceeds_wod_budget');
  end if;

  return jsonb_build_object(
    'version','c3-whole-wod-v1',
    'simulation_only',true,
    'mechanic',v_mechanic,
    'status',v_status,
    'feasible',v_status='OK',
    'reasons',v_reasons,
    'wod_budget_minutes',v_wod_min,
    'wod_budget_source',case when p_exact_wod_minutes is null then 'derived_default' else 'exact_input' end,
    'per_exercise_units',v_units,
    'round_model',jsonb_build_object(
      'exercise_count',v_n,
      'active_work_seconds',round(v_round_active,2),
      'transition_seconds',round(v_round_transition,2),
      'round_seconds',round(v_round_sec,2)
    ),
    'mechanic_projection',jsonb_strip_nulls(jsonb_build_object(
      'expected_rounds_or_sets',round(v_rounds,2),
      'rounds_low',case when v_mechanic='AMRAP' then v_rounds_low else null end,
      'rounds_high',case when v_mechanic='AMRAP' then v_rounds_high else null end,
      'emom_cycles',case when v_mechanic='EMOM' then v_cycles else null end,
      'emom_max_station_work_seconds',case when v_mechanic='EMOM' then round(v_max_station_work,2) else null end,
      'emom_min_station_rest_seconds',case when v_mechanic='EMOM' then round(v_min_station_rest,2) else null end,
      'for_time_cap_seconds',case when v_mechanic='FOR_TIME' then v_wod_sec else null end,
      'ladder_or_pyramid_rungs',case when v_mechanic in ('LADDER','PYRAMID') then v_rungs else null end,
      'progressive_expected_stage',case when v_mechanic='PROGRESSIVE_INTERVAL' then v_stage else null end,
      'progressive_stop_rule',case when v_mechanic='PROGRESSIVE_INTERVAL' then 'stop before interval work exceeds interval minus reserve' else null end,
      'predicted_elapsed_seconds',round(v_predicted_sec,2),
      'predicted_active_work_seconds',round(v_total_active,2),
      'predicted_rest_or_slack_seconds',round(v_rest_sec,2)
    )),
    'predicted_volume',jsonb_build_object(
      'total_reps',round(v_total_reps,2),
      'total_distance_meters',round(v_total_distance,2),
      'total_prescribed_hold_seconds',round(v_total_isometric,2),
      'active_work_seconds',round(v_total_active,2)
    ),
    'whole_wod_metrics',jsonb_build_object(
      'density_percent',round(v_density,2),
      'target_density_score',v_target_density,
      'density_fit',round(v_density_fit,2),
      'max_primary_muscle_share',round(v_max_muscle_share,3),
      'local_fatigue_concentration_index',round(v_local_fatigue_index,2),
      'target_local_fatigue_score',v_target_local_fatigue,
      'local_fatigue_fit',round(v_local_fatigue_fit,2),
      'whole_wod_fit',v_whole_wod_fit
    )
  );
end;
$$;

create or replace function public.simulate_session_engine_c3(
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
  p_candidate_count integer default 5,
  p_exact_wod_minutes integer default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_candidate jsonb;
  v_sim jsonb;
  v_enriched jsonb;
  v_feasible int := 0;
  v_infeasible int := 0;
  v_final_status text := 'OK';
begin
  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c3-whole-wod-v1',
      'simulation_only',true,
      'mutates_production_state',false,
      'status','NO_SAFE_COHERENT_WOD',
      'c2',v_c2,
      'candidate_sessions','[]'::jsonb
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_sim := public.c3_simulate_candidate_wod(v_candidate,v_stimulus,p_duration_minutes,p_exact_wod_minutes,'c3-sim-default');
    v_enriched := v_candidate || jsonb_build_object(
      'whole_wod_simulation',v_sim,
      'c3_whole_wod_fit',coalesce((v_sim#>>'{whole_wod_metrics,whole_wod_fit}')::numeric,0),
      'c3_combined_score',round(coalesce((v_candidate->>'coach_score')::numeric,0)*0.75 + coalesce((v_sim#>>'{whole_wod_metrics,whole_wod_fit}')::numeric,0)*0.25,2)
    );
    if coalesce((v_sim->>'feasible')::boolean,false) then
      v_feasible:=v_feasible+1;
      v_candidates:=v_candidates||jsonb_build_array(v_enriched);
    else
      v_infeasible:=v_infeasible+1;
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c3_combined_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_candidates
  from jsonb_array_elements(v_candidates) x;

  if v_feasible=0 then v_final_status:='NO_FEASIBLE_WHOLE_WOD'; end if;

  return jsonb_build_object(
    'version','c3-whole-wod-v1',
    'simulation_only',true,
    'mutates_production_state',false,
    'status',v_final_status,
    'stimulus',v_stimulus,
    'wod_budget_minutes',public.c3_wod_budget_minutes(p_duration_minutes,p_exact_wod_minutes,'c3-sim-default'),
    'input_candidate_count',jsonb_array_length(coalesce(v_c2->'candidate_sessions','[]'::jsonb)),
    'feasible_candidate_count',v_feasible,
    'infeasible_candidate_count',v_infeasible,
    'candidate_sessions',v_candidates,
    'c2_summary',jsonb_build_object(
      'pool_count',v_c2->'pool_count',
      'top_mechanics',v_c2->'top_mechanics',
      'coherence_gate',v_c2->'coherence_gate'
    ),
    'known_limitations',jsonb_build_array(
      'weekly_coherence_remains_phase_d',
      'operational_pacing_defaults_need_calibration_from_real_sessions',
      'numeric_load_still_requires_confirmed_capability_and_inventory',
      'c3_is_not_routed_to_production_session_generation'
    )
  );
end;
$$;

comment on function public.simulate_session_engine_c3(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer)
is 'Phase C3 read-only whole-WOD simulator. Adds mechanic-specific time/round/set/volume/density/local-fatigue feasibility to C2 candidate sessions. Never mutates production state.';;
