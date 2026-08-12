-- Phase C4 — final session solver + quality gates + anti-redundancy.
-- Still read-only at database level: no workout/capability state is mutated by these functions.

insert into public.session_engine_policy(policy_key,version,active,config,updated_at)
values (
  'c4-final-default',
  'c4-final-v1',
  false,
  jsonb_build_object(
    'selection_weights',jsonb_build_object(
      'coach_score',0.55,
      'whole_wod_fit',0.30,
      'anti_redundancy',0.15
    ),
    'anti_redundancy',jsonb_build_object(
      'recent_sessions',3,
      'exact_non_anchor_penalty',45,
      'family_penalty',25,
      'pattern_penalty',15,
      'anchor_patterns',jsonb_build_array('Conditioning','Locomotion')
    ),
    'mechanic_defaults',jsonb_build_object(
      'ladder_start_reps',2,
      'ladder_increment_reps',2,
      'ladder_max_rungs',12,
      'pyramid_base_reps',4,
      'pyramid_multipliers',jsonb_build_array(1,2,3,2,1),
      'pyramid_max_cycles',3,
      'progressive_start_reps',3,
      'progressive_increment_reps',1,
      'progressive_interval_seconds',60,
      'progressive_reserve_seconds',8,
      'max_final_rounds',20
    ),
    'quality_gate',jsonb_build_object(
      'max_jump_count',1,
      'max_joint_impact_5_count',1,
      'amrap_max_transition_cost',3,
      'emom_max_high_complexity_count',1,
      'emom_max_fatigue_5_count',1,
      'low_readiness_max_complexity',3,
      'low_readiness_max_fatigue',4,
      'duration_underfill_tolerance_percent',20,
      'duration_overfill_percent',105
    ),
    'legacy_inventory_defaults',jsonb_build_object(
      'E03',2,
      'default',1,
      'note','Legacy preparation UI treats Haltères as a pair. No numeric load is inferred.'
    ),
    'notes',jsonb_build_array(
      'Pain/equipment/technical gates remain absolute and execute before ranking.',
      'Mechanic overlays are explicit and transparent.',
      'Numeric load is never invented.',
      'C4 SQL solver is read-only; production routing is handled separately.'
    )
  ),
  now()
)
on conflict (policy_key) do update
set version=excluded.version,active=false,config=excluded.config,updated_at=now();

create or replace function public.c4_legacy_inventory_from_equipment_names(
  p_names text[],
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_result jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  with requested as (
    select trim(x) name from unnest(coalesce(p_names,'{}'::text[])) x where trim(x)<>''
  ), matched as (
    select distinct e.id,e.name,
      coalesce((v_cfg#>>array['legacy_inventory_defaults',e.id])::int,
               (v_cfg#>>'{legacy_inventory_defaults,default}')::int,1) quantity
    from requested r
    join public.equipment e on lower(trim(e.name))=lower(r.name) or lower(trim(e.id))=lower(r.name)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'equipment_id',id,
    'quantity',quantity,
    'source','legacy_equipment_selection',
    'load_confidence','unknown'
  ) order by id),'[]'::jsonb)
  into v_result from matched;

  return v_result;
end;
$$;

create or replace function public.c4_prepare_candidate(
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_compatible boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_start int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes := coalesce(v_pres->'tracking_modes','[]'::jsonb);

    if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL') then
      if not exists(select 1 from jsonb_array_elements_text(v_modes) m where m='reps') then
        v_compatible := false;
        v_reasons := v_reasons || jsonb_build_array(v_mechanic||'_REQUIRES_REP_TRACKED_EXERCISES:'||(v_ex->>'exercise_id'));
      else
        if v_mechanic='LADDER' then
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','ascending_ladder',
            'start_reps',v_start,
            'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2)
          ));
        elsif v_mechanic='PYRAMID' then
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','pyramid',
            'base_reps',v_start,
            'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}'
          ));
        else
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','progressive_interval',
            'start_reps',v_start,
            'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),
            'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60)
          ));
        end if;
      end if;
    end if;

    v_exercises := v_exercises || jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  return jsonb_set(
    jsonb_set(p_candidate,'{exercises}',v_exercises,true),
    '{c4_preparation}',
    jsonb_build_object(
      'mechanic_compatible',v_compatible,
      'reasons',v_reasons,
      'version','c4-prepare-v1'
    ),true
  );
end;
$$;

create or replace function public.c4_redundancy_score(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_recent int;
  v_exact_pen numeric;
  v_family_pen numeric;
  v_pattern_pen numeric;
  v_exact_ratio numeric := 0;
  v_family_ratio numeric := 0;
  v_pattern_ratio numeric := 0;
  v_score numeric := 100;
  v_recent_count int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_recent := coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,3);
  v_exact_pen := coalesce((v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,45);
  v_family_pen := coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25);
  v_pattern_pen := coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15);

  with recent as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at) desc
    limit v_recent
  ), cand as (
    select e.id,e.exercise_family,e.movement_pattern,
           e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
  ), recent_ex as (
    select distinct wse.exercise_id,e.exercise_family,e.movement_pattern
    from recent r
    join public.workout_session_exercises wse on wse.session_id=r.id and wse.block_key='wod'
    join public.exercises e on e.id=wse.exercise_id
  ), stats as (
    select
      (select count(*) from recent) recent_count,
      (select count(*)::numeric / greatest(1,(select count(*) from cand where not anchor))
       from cand c where not c.anchor and exists(select 1 from recent_ex r where r.exercise_id=c.id)) exact_ratio,
      (select count(*)::numeric / greatest(1,(select count(distinct exercise_family) from cand))
       from (select distinct exercise_family from cand) c where exists(select 1 from recent_ex r where r.exercise_family=c.exercise_family)) family_ratio,
      (select count(*)::numeric / greatest(1,(select count(distinct movement_pattern) from cand))
       from (select distinct movement_pattern from cand) c where exists(select 1 from recent_ex r where r.movement_pattern=c.movement_pattern)) pattern_ratio
  )
  select recent_count,coalesce(exact_ratio,0),coalesce(family_ratio,0),coalesce(pattern_ratio,0)
  into v_recent_count,v_exact_ratio,v_family_ratio,v_pattern_ratio from stats;

  if v_recent_count>0 then
    v_score := greatest(0,least(100,100-v_exact_ratio*v_exact_pen-v_family_ratio*v_family_pen-v_pattern_ratio*v_pattern_pen));
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),
    'recent_sessions_considered',v_recent_count,
    'exact_non_anchor_overlap_ratio',round(v_exact_ratio,3),
    'family_overlap_ratio',round(v_family_ratio,3),
    'pattern_overlap_ratio',round(v_pattern_ratio,3),
    'anchor_exact_repeat_exempt',true,
    'version','c4-redundancy-v1'
  );
end;
$$;

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
      v_rest_per_round := greatest(1,v_n)*coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
      v_sets := greatest(1,least(coalesce((v_c3_cfg#>>'{operational_assumptions,strength_max_sets}')::int,4),
        floor((v_target_sec+v_rest_per_round)/(v_round_sec+v_rest_per_round))));
      v_rounds := v_sets;
      v_elapsed := v_sets*v_round_sec + greatest(0,v_sets-1)*v_rest_per_round;
      v_active := v_round_active*v_sets;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_sets);
      v_multiplier := v_sets;
      if v_sets<2 then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('STRENGTH_LT_2_SETS'); end if;

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
      v_rest_per_round := 0;
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
    when 'STRENGTH' then jsonb_build_object('sets',v_sets,'rest_between_exercises_seconds',coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75))
    when 'LADDER' then jsonb_build_object('rungs',v_rungs,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2))
    when 'PYRAMID' then jsonb_build_object('cycles',v_pyramid_cycles,'base_reps',coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4),'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}')
    when 'PROGRESSIVE_INTERVAL' then jsonb_build_object('expected_stage',v_stage,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve)
    else '{}'::jsonb
  end;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb) || jsonb_build_object(
      'c4_solver_version','c4-final-v1',
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
      'version','c4-final-v1',
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
$$;

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
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_zone_ids text[] := public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]));
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_ex jsonb;
  e record;
  v_reasons jsonb := '[]'::jsonb;
  v_jump int := 0;
  v_impact5 int := 0;
  v_emom_tech int := 0;
  v_emom_fatigue int := 0;
  v_hinge5 boolean := false;
  v_jump5 boolean := false;
  v_anchor boolean := false;
  v_count int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    v_reasons:=v_reasons||coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb);
  end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_count:=v_count+1;
    select id,movement_pattern,exercise_family,technical_complexity,fatigue_score,joint_impact,transition_cost,warmup_only
    into e from public.exercises where id=v_ex->>'exercise_id';
    if not found then
      v_reasons:=v_reasons||jsonb_build_array('UNKNOWN_EXERCISE:'||(v_ex->>'exercise_id'));
      continue;
    end if;

    if not public.exercise_safe_for_zones(e.id,v_zone_ids) then v_reasons:=v_reasons||jsonb_build_array('PAIN_GATE:'||e.id); end if;
    if not public.exercise_equipment_compatible(e.id,p_inventory) then v_reasons:=v_reasons||jsonb_build_array('EQUIPMENT_GATE:'||e.id); end if;
    if coalesce(e.warmup_only,false) then v_reasons:=v_reasons||jsonb_build_array('WARMUP_ONLY_IN_WOD:'||e.id); end if;
    if e.technical_complexity is null or e.fatigue_score is null or e.joint_impact is null then v_reasons:=v_reasons||jsonb_build_array('MISSING_CRITICAL_METADATA:'||e.id); end if;
    if coalesce(e.technical_complexity,99)>p_max_complexity then v_reasons:=v_reasons||jsonb_build_array('TECHNICAL_LEVEL_GATE:'||e.id); end if;

    if v_readiness='low' and coalesce(e.technical_complexity,99)>coalesce((v_cfg#>>'{quality_gate,low_readiness_max_complexity}')::int,3) then
      v_reasons:=v_reasons||jsonb_build_array('LOW_READINESS_COMPLEXITY:'||e.id);
    end if;
    if v_readiness='low' and coalesce(e.fatigue_score,99)>coalesce((v_cfg#>>'{quality_gate,low_readiness_max_fatigue}')::int,4) then
      v_reasons:=v_reasons||jsonb_build_array('LOW_READINESS_FATIGUE:'||e.id);
    end if;

    if e.movement_pattern='Jump' then v_jump:=v_jump+1; end if;
    if coalesce(e.joint_impact,0)>=5 then v_impact5:=v_impact5+1; end if;
    if v_mechanic='AMRAP' and coalesce(e.transition_cost,99)>coalesce((v_cfg#>>'{quality_gate,amrap_max_transition_cost}')::int,3) then
      v_reasons:=v_reasons||jsonb_build_array('AMRAP_TRANSITION_COST:'||e.id);
    end if;
    if v_mechanic='EMOM' and coalesce(e.technical_complexity,0)>=4 then v_emom_tech:=v_emom_tech+1; end if;
    if v_mechanic='EMOM' and coalesce(e.fatigue_score,0)>=5 then v_emom_fatigue:=v_emom_fatigue+1; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Hinge' and coalesce(e.fatigue_score,0)>=5 then v_hinge5:=true; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Jump' and coalesce(e.fatigue_score,0)>=5 then v_jump5:=true; end if;
    if e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion') then v_anchor:=true; end if;
  end loop;

  if v_count=0 then v_reasons:=v_reasons||jsonb_build_array('EMPTY_WOD'); end if;
  if v_jump>coalesce((v_cfg#>>'{quality_gate,max_jump_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('MAX_JUMP_COUNT'); end if;
  if v_impact5>coalesce((v_cfg#>>'{quality_gate,max_joint_impact_5_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('MAX_JOINT_IMPACT_5_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_tech>coalesce((v_cfg#>>'{quality_gate,emom_max_high_complexity_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('EMOM_HIGH_COMPLEXITY_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_fatigue>coalesce((v_cfg#>>'{quality_gate,emom_max_fatigue_5_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('EMOM_FATIGUE_5_COUNT'); end if;
  if v_mechanic='FOR_TIME' and v_hinge5 and v_jump5 then v_reasons:=v_reasons||jsonb_build_array('FOR_TIME_HINGE5_PLUS_JUMP5'); end if;
  if p_focus in ('Conditioning','Fat Loss') and not v_anchor then v_reasons:=v_reasons||jsonb_build_array('CONDITIONING_ANCHOR_REQUIRED'); end if;
  if coalesce((p_candidate#>>'{c4_final,feasible}')::boolean,false)=false then v_reasons:=v_reasons||jsonb_build_array('FINAL_SOLVER_INFEASIBLE'); end if;
  if coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','')='OVERFILLED' then v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED'); end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',jsonb_build_object(
      'pain',true,'equipment',true,'technical_level',true,'readiness_caps',true,
      'jump_count',v_jump,'impact5_count',v_impact5,'conditioning_anchor',v_anchor
    ),
    'version','c4-quality-gate-v1'
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
      'version','c4-final-v1','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_prepared := public.c4_prepare_candidate(v_candidate,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate(v_final,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_candidate->>'coach_score')::numeric,0)*v_weight_coach +
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
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_candidate->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1',
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
$$;

comment on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
is 'Phase C4 final read-only Session Engine solver. C1 stimulus + C2 candidates + C3 whole-WOD simulation + mechanic overlays + hard quality gates + anti-redundancy + final ranking. Does not persist a workout.';;
