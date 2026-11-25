update public.session_engine_policy
set version='c4-final-v1.5',
    config=jsonb_set(config,'{mechanic_defaults,strength_max_sets}','5'::jsonb,true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c3_cfg jsonb;
  v_sim jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_n int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_wod_min int;
  v_wod_sec numeric;
  v_round_active numeric;
  v_round_transition numeric;
  v_round_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_elapsed numeric := 0;
  v_active numeric := 0;
  v_rest numeric := 0;
  v_units jsonb;
  v_rounds numeric := 0;
  v_sets numeric := 0;
  v_cycles numeric := 0;
  v_rungs int := 0;
  v_pyramid_cycles int := 0;
  v_stage int := 0;
  v_multiplier numeric := 0;
  v_tri numeric := 0;
  v_total_reps numeric := 0;
  v_total_distance numeric := 0;
  v_total_holds numeric := 0;
  v_base_reps numeric := 0;
  v_base_distance numeric := 0;
  v_base_holds numeric := 0;
  v_rep_exercises int := 0;
  v_increment_seconds numeric := 0;
  v_interval numeric;
  v_reserve numeric;
  v_stage_work numeric;
  v_rest_per_round numeric;
  v_strength_rest numeric;
  v_strength_max_sets int;
  v_max_rounds int;
  v_density numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_local_index numeric := 0;
  v_target_local numeric := coalesce((p_stimulus#>>'{local_fatigue,score}')::numeric,50);
  v_density_fit numeric := 0;
  v_local_fit numeric := 0;
  v_duration_util numeric := 0;
  v_duration_fit numeric := 0;
  v_whole_fit numeric := 0;
  v_under_tol numeric;
  v_over numeric;
  v_duration_status text := 'OK';
  v_status text := 'OK';
  v_reasons jsonb := '[]'::jsonb;
  v_mechanic_json jsonb;
  v_final_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_overlay jsonb;
  v_seq_sum numeric := 9;
  i int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_c4_policy_key;
  select config into v_c3_cfg from public.session_engine_policy where policy_key=p_c3_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_c4_policy_key; end if;
  if v_c3_cfg is null then raise exception 'Unknown C3 policy %',p_c3_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object('status','INCOMPATIBLE_MECHANIC','feasible',false,'reasons',p_candidate#>'{c4_preparation,reasons}')
    );
  end if;

  v_sim := public.c3_simulate_candidate_wod(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_min := public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_sec := v_wod_min*60;
  v_round_active := coalesce((v_sim#>>'{round_model,active_work_seconds}')::numeric,0);
  v_round_transition := coalesce((v_sim#>>'{round_model,transition_seconds}')::numeric,0);
  v_round_sec := greatest(1,v_round_active+v_round_transition);
  v_units := coalesce(v_sim->'per_exercise_units','[]'::jsonb);
  v_target_util := coalesce((v_c3_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_target_sec := v_wod_sec*v_target_util/100.0;
  v_max_rounds := coalesce((v_cfg#>>'{mechanic_defaults,max_final_rounds}')::int,20);
  v_under_tol := coalesce((v_cfg#>>'{quality_gate,duration_underfill_tolerance_percent}')::numeric,20);
  v_over := coalesce((v_cfg#>>'{quality_gate,duration_overfill_percent}')::numeric,105);
  v_strength_rest := coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
  v_strength_max_sets := coalesce((v_cfg#>>'{mechanic_defaults,strength_max_sets}')::int,5);

  select
    coalesce(sum(coalesce(nullif(u->>'reps_total','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'distance_meters','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'duration_seconds','')::numeric,0)),0),
    count(*) filter (where nullif(u->>'reps_total','') is not null),
    coalesce(sum(case when nullif(u->>'reps_total','') is not null then
      coalesce((u->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u->>'reps_total')::numeric)
      else 0 end),0)
  into v_base_reps,v_base_distance,v_base_holds,v_rep_exercises,v_increment_seconds
  from jsonb_array_elements(v_units) u;

  case v_mechanic
    when 'AMRAP' then
      v_rounds := greatest(1,least(v_max_rounds,coalesce((v_sim#>>'{mechanic_projection,expected_rounds_or_sets}')::numeric,1)));
      v_elapsed := v_wod_sec;
      v_active := least(v_elapsed,v_round_active*v_rounds);
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'EMOM' then
      v_cycles := floor(v_wod_min/greatest(1,v_n));
      v_rounds := v_cycles;
      v_elapsed := v_cycles*v_n*60;
      v_active := v_round_active*v_cycles;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_cycles;
      if v_cycles<1 then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_NO_COMPLETE_CYCLE'); end if;
      if coalesce((v_sim#>>'{mechanic_projection,emom_min_station_rest_seconds}')::numeric,0) < coalesce((v_c3_cfg#>>'{operational_assumptions,emom_min_rest_seconds}')::numeric,10) then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_REST_MARGIN');
      end if;

    when 'FOR_TIME' then
      v_rounds := greatest(1,least(v_max_rounds,floor(v_target_sec/v_round_sec)));
      v_elapsed := v_round_sec*v_rounds;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FOR_TIME_EXCEEDS_CAP'); end if;

    when 'CIRCUIT' then
      v_rest_per_round := coalesce((v_c3_cfg#>>'{operational_assumptions,circuit_round_rest_seconds}')::numeric,45);
      v_rounds := greatest(1,least(v_max_rounds,floor((v_target_sec+v_rest_per_round)/(v_round_sec+v_rest_per_round))));
      v_elapsed := v_rounds*v_round_sec + greatest(0,v_rounds-1)*v_rest_per_round;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'STRENGTH' then
      v_sets := 0;
      for i in 2..v_strength_max_sets loop
        if i*v_round_sec + greatest(0,i*v_n-1)*v_strength_rest <= v_target_sec then v_sets:=i; end if;
      end loop;
      if v_sets<2 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('STRENGTH_LT_2_SETS');
      else
        v_rounds := v_sets;
        v_elapsed := v_sets*v_round_sec + greatest(0,v_sets*v_n-1)*v_strength_rest;
        v_active := v_round_active*v_sets;
        v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_sets);
        v_multiplier := v_sets;
      end if;

    when 'LADDER' then
      for i in 3..coalesce((v_cfg#>>'{mechanic_defaults,ladder_max_rungs}')::int,12) loop
        v_tri := i*(i+1)/2.0;
        if v_round_active*v_tri + v_round_transition*i <= v_target_sec then v_rungs:=i; end if;
      end loop;
      if v_rungs<3 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('LADDER_LT_3_RUNGS');
      else
        v_tri := v_rungs*(v_rungs+1)/2.0;
        v_elapsed := v_round_active*v_tri + v_round_transition*v_rungs;
        v_active := v_round_active*v_tri;
        v_rest := greatest(0,v_elapsed-v_active);
        v_multiplier := v_tri;
      end if;

    when 'PYRAMID' then
      v_seq_sum := 9;
      v_pyramid_cycles := greatest(1,least(coalesce((v_cfg#>>'{mechanic_defaults,pyramid_max_cycles}')::int,3),
        floor(v_target_sec/greatest(1,v_round_active*v_seq_sum+v_round_transition*5))));
      v_elapsed := v_pyramid_cycles*(v_round_active*v_seq_sum+v_round_transition*5);
      v_active := v_pyramid_cycles*v_round_active*v_seq_sum;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_pyramid_cycles*v_seq_sum;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PYRAMID_EXCEEDS_BUDGET'); end if;

    when 'PROGRESSIVE_INTERVAL' then
      v_interval := coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::numeric,60);
      v_reserve := coalesce((v_cfg#>>'{mechanic_defaults,progressive_reserve_seconds}')::numeric,8);
      v_stage := 0;
      for i in 1..v_wod_min loop
        v_stage_work := v_round_active + (i-1)*v_increment_seconds + v_round_transition;
        if v_stage_work <= v_interval-v_reserve then v_stage:=i; else exit; end if;
      end loop;
      if v_stage<1 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_START_DOES_NOT_FIT');
      else
        v_elapsed := v_stage*v_interval;
        v_active := v_stage*v_round_active + (v_stage-1)*v_stage/2.0*v_increment_seconds;
        v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_stage);
        v_multiplier := v_stage;
      end if;

    else
      v_status:='UNSUPPORTED_MECHANIC';
      v_reasons:=v_reasons||jsonb_build_array('UNSUPPORTED_MECHANIC:'||v_mechanic);
  end case;

  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_total_reps := v_base_reps*v_stage + v_rep_exercises*(v_stage-1)*v_stage/2.0;
    v_total_distance := 0;
    v_total_holds := 0;
  else
    v_total_reps := v_base_reps*v_multiplier;
    v_total_distance := v_base_distance*v_multiplier;
    v_total_holds := v_base_holds*v_multiplier;
  end if;

  v_density := case when v_elapsed>0 then least(100,v_active/v_elapsed*100) else 0 end;
  v_local_index := coalesce((v_sim#>>'{whole_wod_metrics,max_primary_muscle_share}')::numeric,0)*100;
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_local_fit := greatest(0,100-abs(v_local_index-v_target_local));
  v_duration_util := case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_duration_fit := greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_whole_fit := round(
    v_density_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,density_fit}')::numeric,0.45)+
    v_local_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,local_fatigue_fit}')::numeric,0.30)+
    v_duration_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,duration_fit}')::numeric,0.25),2
  );

  if v_duration_util < greatest(0,v_target_util-v_under_tol) then v_duration_status:='UNDERFILLED'; end if;
  if v_duration_util > v_over then v_duration_status:='OVERFILLED'; end if;
  if v_status='OK' and v_duration_status='OVERFILLED' then
    v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED');
  end if;

  v_overlay := case v_mechanic
    when 'AMRAP' then jsonb_build_object('duration_minutes',v_wod_min,'expected_rounds',round(v_rounds,1))
    when 'EMOM' then jsonb_build_object('duration_minutes',round(v_elapsed/60.0,1),'cycles',v_cycles,'station_seconds',60)
    when 'FOR_TIME' then jsonb_build_object('rounds',v_rounds,'cap_seconds',v_wod_sec)
    when 'CIRCUIT' then jsonb_build_object('rounds',v_rounds,'rest_between_rounds_seconds',v_rest_per_round)
    when 'STRENGTH' then jsonb_build_object('sets',v_sets,'rest_between_exercises_seconds',v_strength_rest)
    when 'LADDER' then jsonb_build_object('rungs',v_rungs,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2))
    when 'PYRAMID' then jsonb_build_object('cycles',v_pyramid_cycles,'base_reps',coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4),'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}')
    when 'PROGRESSIVE_INTERVAL' then jsonb_build_object('expected_stage',v_stage,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve)
    else '{}'::jsonb
  end;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb) || jsonb_build_object(
      'c4_solver_version','c4-final-v1.5',
      'block_mechanic',v_mechanic,
      'block_parameters',v_overlay,
      'target_rpe_min',p_stimulus#>>'{rpe_target,min}',
      'target_rpe_max',p_stimulus#>>'{rpe_target,max}'
    );
    v_final_exercises := v_final_exercises || jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  v_mechanic_json := jsonb_build_object(
    'mechanic_key',v_mechanic,
    'parameters',v_overlay,
    'wod_budget_minutes',v_wod_min,
    'predicted_elapsed_seconds',round(v_elapsed,2),
    'time_utilization_percent',round(v_duration_util,2),
    'duration_status',v_duration_status
  );

  return jsonb_set(p_candidate,'{exercises}',v_final_exercises,true) || jsonb_build_object(
    'c4_final',jsonb_build_object(
      'version','c4-final-v1.5',
      'status',v_status,
      'feasible',v_status='OK',
      'reasons',v_reasons,
      'mechanic_json',v_mechanic_json,
      'predicted_volume',jsonb_build_object(
        'total_reps',round(v_total_reps,2),
        'total_distance_meters',round(v_total_distance,2),
        'total_hold_seconds',round(v_total_holds,2),
        'active_work_seconds',round(v_active,2)
      ),
      'whole_wod_metrics',jsonb_build_object(
        'density_percent',round(v_density,2),
        'density_fit',round(v_density_fit,2),
        'local_fatigue_concentration_index',round(v_local_index,2),
        'local_fatigue_fit',round(v_local_fit,2),
        'duration_fit',round(v_duration_fit,2),
        'duration_status',v_duration_status,
        'time_utilization_percent',round(v_duration_util,2),
        'whole_wod_fit',v_whole_fit,
        'primary_muscle_exposure_ledger',v_sim#>'{whole_wod_metrics,primary_muscle_exposure_ledger}'
      )
    )
  );
end;
$$;;
