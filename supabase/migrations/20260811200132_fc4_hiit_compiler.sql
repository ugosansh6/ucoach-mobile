create or replace function public.c4_finalize_hiit_candidate(
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
set search_path = public
as $function$
declare
  v_cfg jsonb;
  v_exercises jsonb := coalesce(p_candidate->'exercises','[]'::jsonb);
  v_final_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_n int := jsonb_array_length(v_exercises);
  v_wod_min int;
  v_wod_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_work int;
  v_rest int;
  v_rounds int;
  v_candidate_elapsed numeric;
  v_best_score numeric := null;
  v_score numeric;
  v_best_work int := null;
  v_best_rest int := null;
  v_best_rounds int := null;
  v_elapsed numeric := 0;
  v_active numeric := 0;
  v_rest_total numeric := 0;
  v_density numeric := 0;
  v_duration_util numeric := 0;
  v_duration_fit numeric := 0;
  v_density_fit numeric := 0;
  v_whole_fit numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,55);
  v_readiness text := lower(coalesce(p_stimulus#>>'{readiness,band}',p_stimulus#>>'{readiness,raw}','normal'));
  v_min_rest_ratio numeric := 0.30;
  v_work_options jsonb;
  v_rest_options jsonb;
  v_min_rounds int;
  v_max_rounds int;
  v_position int := 0;
begin
  select config into v_cfg
  from public.session_engine_policy
  where policy_key=p_c4_policy_key;

  if v_cfg is null then
    raise exception 'Unknown C4 policy %', p_c4_policy_key;
  end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INCOMPATIBLE_MECHANIC',
        'feasible',false,
        'reasons',coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb)
      )
    );
  end if;

  if v_n < 3 or v_n > 5 then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INFEASIBLE',
        'feasible',false,
        'reasons',jsonb_build_array('HIIT_REQUIRES_3_TO_5_EXERCISES')
      )
    );
  end if;

  v_wod_min := public.c3_wod_budget_minutes(
    p_total_duration_minutes,
    p_exact_wod_minutes,
    p_c3_policy_key
  );
  v_wod_sec := v_wod_min*60;
  v_target_util := coalesce(
    (v_cfg#>>'{mechanic_defaults,hiit_target_utilization_percent}')::numeric,
    92
  );
  v_target_sec := v_wod_sec*v_target_util/100.0;

  v_work_options := coalesce(
    v_cfg#>'{mechanic_defaults,hiit_work_options_seconds}',
    '[30,40,45,50]'::jsonb
  );
  v_rest_options := coalesce(
    v_cfg#>'{mechanic_defaults,hiit_rest_options_seconds}',
    '[15,20,30]'::jsonb
  );
  v_min_rounds := coalesce((v_cfg#>>'{mechanic_defaults,hiit_min_rounds}')::int,3);
  v_max_rounds := coalesce((v_cfg#>>'{mechanic_defaults,hiit_max_rounds}')::int,6);

  if v_readiness='low' then
    v_min_rest_ratio := 0.50;
  elsif v_readiness='high' then
    v_min_rest_ratio := 0.25;
  else
    v_min_rest_ratio := 0.30;
  end if;

  for v_work in
    select value::int from jsonb_array_elements_text(v_work_options)
  loop
    for v_rest in
      select value::int from jsonb_array_elements_text(v_rest_options)
    loop
      if v_rest < ceil(v_work*v_min_rest_ratio) then
        continue;
      end if;

      for v_rounds in v_min_rounds..v_max_rounds loop
        -- One work/rest station per exercise. Parameters stay solver-controlled.
        v_candidate_elapsed := v_n*(v_work+v_rest)*v_rounds;

        if v_candidate_elapsed > v_wod_sec*1.05 then
          continue;
        end if;

        -- Primary goal: fit the WOD budget. Secondary tie-break: familiar 40/20 x4 baseline.
        v_score := abs(v_candidate_elapsed-v_target_sec)
          + abs(v_work-40)*0.20
          + abs(v_rest-20)*0.10
          + abs(v_rounds-4)*2;

        if v_best_score is null or v_score < v_best_score then
          v_best_score := v_score;
          v_best_work := v_work;
          v_best_rest := v_rest;
          v_best_rounds := v_rounds;
        end if;
      end loop;
    end loop;
  end loop;

  if v_best_work is null then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','INFEASIBLE',
        'feasible',false,
        'reasons',jsonb_build_array('HIIT_NO_SAFE_WORK_REST_CONFIGURATION')
      )
    );
  end if;

  v_elapsed := v_n*(v_best_work+v_best_rest)*v_best_rounds;
  v_active := v_n*v_best_work*v_best_rounds;
  v_rest_total := v_n*v_best_rest*v_best_rounds;
  v_density := case when v_elapsed>0 then v_active/v_elapsed*100 else 0 end;
  v_duration_util := case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_duration_fit := greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_whole_fit := round(v_density_fit*0.55+v_duration_fit*0.45,2);

  for v_ex in
    select value from jsonb_array_elements(v_exercises)
  loop
    v_position := v_position+1;
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes := coalesce(v_pres->'tracking_modes','[]'::jsonb);

    if not exists(
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(v_modes)='array' then v_modes else '[]'::jsonb end
      ) m where m='time'
    ) then
      v_modes := v_modes || jsonb_build_array('time');
    end if;

    v_pres := v_pres || jsonb_build_object(
      'mechanic','HIIT',
      'block_mechanic','HIIT',
      'duration_seconds_min',v_best_work,
      'duration_seconds_max',v_best_work,
      'tracking_modes',v_modes,
      'mechanic_overlay',jsonb_build_object(
        'type','hiit_station',
        'exercise_position',v_position,
        'work_seconds',v_best_work,
        'rest_seconds',v_best_rest,
        'rounds',v_best_rounds
      ),
      'block_parameters',jsonb_build_object(
        'exercise_count',v_n,
        'rounds',v_best_rounds,
        'work_seconds',v_best_work,
        'rest_seconds',v_best_rest,
        'station_order','sequential',
        'solver_controlled',true
      ),
      'c4_solver_version','c4-hiit-v1'
    );

    v_final_exercises := v_final_exercises ||
      jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  return jsonb_set(p_candidate,'{exercises}',v_final_exercises,true) ||
    jsonb_build_object(
      'c4_final',jsonb_build_object(
        'version','c4-hiit-v1',
        'status','OK',
        'feasible',true,
        'reasons','[]'::jsonb,
        'mechanic_json',jsonb_build_object(
          'mechanic_key','HIIT',
          'parameters',jsonb_build_object(
            'exercise_count',v_n,
            'rounds',v_best_rounds,
            'work_seconds',v_best_work,
            'rest_seconds',v_best_rest,
            'station_order','sequential',
            'solver_controlled',true
          ),
          'wod_budget_minutes',v_wod_min,
          'predicted_elapsed_seconds',round(v_elapsed,2),
          'time_utilization_percent',round(v_duration_util,2),
          'duration_status','OK'
        ),
        'predicted_volume',jsonb_build_object(
          'active_work_seconds',round(v_active,2),
          'rest_seconds',round(v_rest_total,2)
        ),
        'whole_wod_metrics',jsonb_build_object(
          'density_percent',round(v_density,2),
          'density_fit',round(v_density_fit,2),
          'local_fatigue_concentration_index',50,
          'local_fatigue_fit',50,
          'duration_fit',round(v_duration_fit,2),
          'duration_status','OK',
          'time_utilization_percent',round(v_duration_util,2),
          'whole_wod_fit',v_whole_fit,
          'primary_muscle_exposure_ledger','[]'::jsonb
        )
      )
    );
end;
$function$;

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
set search_path = public
as $function$
declare
  v_result jsonb;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',''));
  v_rungs int;
  v_schedule jsonb:='[]'::jsonb;
  x jsonb;
  v_base int;
  v_inc int;
  v_first int;
  v_last int;
begin
  if v_mechanic='HIIT' then
    return public.c4_finalize_hiit_candidate(
      p_candidate,
      p_stimulus,
      p_total_duration_minutes,
      p_exact_wod_minutes,
      p_c4_policy_key,
      p_c3_policy_key
    );
  end if;

  v_result:=public.c4_finalize_candidate_c41_dispatch_base(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c4_policy_key,p_c3_policy_key
  );

  if v_mechanic='COUPLET' and v_variant in ('ASCENDING_COUPLET','DESCENDING_COUPLET') then
    v_rungs:=coalesce(nullif(v_result#>>'{c4_final,mechanic_json,parameters,rungs}','')::int,0);
    for x in select value from jsonb_array_elements(coalesce(v_result->'exercises','[]'::jsonb))
    loop
      v_base:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,start_reps}','')::int,1);
      v_inc:=coalesce(nullif(x#>>'{prescription,mechanic_overlay,increment_reps}','')::int,1);
      if v_variant='DESCENDING_COUPLET' then
        v_first:=v_base+greatest(0,v_rungs-1)*v_inc;
        v_last:=v_base;
      else
        v_first:=v_base;
        v_last:=v_base+greatest(0,v_rungs-1)*v_inc;
      end if;
      v_schedule:=v_schedule||jsonb_build_array(jsonb_build_object(
        'exercise_id',x->>'exercise_id','base_reps',v_base,'increment_reps',v_inc,
        'first_stage_reps',v_first,'last_stage_reps',v_last
      ));
    end loop;
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,sequence_direction}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'descending' else 'ascending' end),true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,per_exercise_schedule}',v_schedule,true);
    v_result:=jsonb_set(v_result,'{c4_final,mechanic_json,parameters,execution_rule}',
      to_jsonb(case when v_variant='DESCENDING_COUPLET' then 'start_at_highest_compiled_stage_then_subtract_each_exercise_increment_until_base' else 'start_at_each_exercise_base_then_add_its_increment_each_stage' end),true);
  end if;

  return v_result;
end;
$function$;;
