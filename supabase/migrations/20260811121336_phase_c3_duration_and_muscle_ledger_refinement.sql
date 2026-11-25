-- Phase C3 refinement — duration utilization + explicit primary-muscle exposure ledger.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    config,
    '{mechanic_duration_target_percent}',
    jsonb_build_object(
      'AMRAP',100,'EMOM',90,'FOR_TIME',75,'CIRCUIT',90,'STRENGTH',75,
      'LADDER',85,'PYRAMID',85,'PROGRESSIVE_INTERVAL',85
    ),true
  ),
  '{whole_wod_fit_weights}',
  jsonb_build_object('density_fit',0.45,'local_fatigue_fit',0.30,'duration_fit',0.25),true
), updated_at=now()
where policy_key='c3-sim-default';

alter function public.c3_simulate_candidate_wod(jsonb,jsonb,integer,integer,text)
rename to c3_simulate_candidate_wod_raw;

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
  v_raw jsonb;
  v_cfg jsonb;
  v_mechanic text;
  v_budget_sec numeric;
  v_elapsed numeric;
  v_round_active numeric;
  v_total_active numeric;
  v_exposure_multiplier numeric;
  v_util numeric;
  v_target_util numeric;
  v_duration_fit numeric;
  v_density_fit numeric;
  v_local_fit numeric;
  v_whole_fit numeric;
  v_duration_status text := 'OK';
  v_ledger jsonb := '[]'::jsonb;
  v_stage int;
  v_progressive_reps numeric;
  v_result jsonb;
begin
  v_raw := public.c3_simulate_candidate_wod_raw(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_policy_key
  );

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_mechanic := upper(coalesce(v_raw->>'mechanic',''));
  v_budget_sec := coalesce((v_raw->>'wod_budget_minutes')::numeric,0)*60;
  v_elapsed := coalesce((v_raw#>>'{mechanic_projection,predicted_elapsed_seconds}')::numeric,0);
  v_round_active := coalesce((v_raw#>>'{round_model,active_work_seconds}')::numeric,0);
  v_total_active := coalesce((v_raw#>>'{mechanic_projection,predicted_active_work_seconds}')::numeric,0);
  v_exposure_multiplier := case when v_round_active>0 then v_total_active/v_round_active else 0 end;
  v_util := case when v_budget_sec>0 then least(150,v_elapsed/v_budget_sec*100) else 0 end;
  v_target_util := coalesce((v_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_duration_fit := greatest(0,100-abs(v_util-v_target_util)*1.25);
  v_density_fit := coalesce((v_raw#>>'{whole_wod_metrics,density_fit}')::numeric,0);
  v_local_fit := coalesce((v_raw#>>'{whole_wod_metrics,local_fatigue_fit}')::numeric,0);
  v_whole_fit := round(v_density_fit*0.45+v_local_fit*0.30+v_duration_fit*0.25,2);

  if v_util < greatest(0,v_target_util-25) then
    v_duration_status := 'UNDERFILLED';
  elsif v_util > 105 then
    v_duration_status := 'OVERFILLED';
  end if;

  with units as (
    select u,
           coalesce((u->>'fatigue_score')::numeric,3)*v_exposure_multiplier weighted
    from jsonb_array_elements(coalesce(v_raw->'per_exercise_units','[]'::jsonb)) u
  ), muscles as (
    select m.value#>>'{}' muscle_id, sum(units.weighted) weighted_exposure
    from units
    cross join lateral jsonb_array_elements(coalesce(units.u->'primary_muscles','[]'::jsonb)) m
    group by m.value#>>'{}'
  ), totals as (
    select coalesce(sum(weighted_exposure),0) total from muscles
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'muscle_id',muscle_id,
      'weighted_exposure_units',round(weighted_exposure,2),
      'share',case when totals.total>0 then round(weighted_exposure/totals.total,3) else 0 end
    ) order by weighted_exposure desc,muscle_id
  ),'[]'::jsonb)
  into v_ledger
  from muscles cross join totals;

  -- Progressive intervals add one rep per stage to rep-tracked exercises.
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_stage := coalesce((v_raw#>>'{mechanic_projection,progressive_expected_stage}')::int,0);
    select coalesce(sum(
      case when nullif(u->>'reps_total','') is not null
        then v_stage*(u->>'reps_total')::numeric + greatest(0,v_stage-1)*v_stage/2.0
        else 0 end
    ),0)
    into v_progressive_reps
    from jsonb_array_elements(coalesce(v_raw->'per_exercise_units','[]'::jsonb)) u;
    v_raw := jsonb_set(v_raw,'{predicted_volume,total_reps}',to_jsonb(round(v_progressive_reps,2)),true);
  end if;

  v_result := jsonb_set(
    jsonb_set(
      jsonb_set(
        v_raw,
        '{whole_wod_metrics,time_utilization_percent}',to_jsonb(round(v_util,2)),true
      ),
      '{whole_wod_metrics,target_time_utilization_percent}',to_jsonb(v_target_util),true
    ),
    '{whole_wod_metrics,duration_fit}',to_jsonb(round(v_duration_fit,2)),true
  );
  v_result := jsonb_set(v_result,'{whole_wod_metrics,duration_status}',to_jsonb(v_duration_status),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,whole_wod_fit}',to_jsonb(v_whole_fit),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,primary_muscle_exposure_ledger}',v_ledger,true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,exposure_multiplier}',to_jsonb(round(v_exposure_multiplier,3)),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,solver_action_hint}',to_jsonb(
    case
      when coalesce(v_raw->>'status','')<>'OK' then 'reject_or_rebuild_candidate'
      when v_duration_status='UNDERFILLED' then 'increase_rounds_or_volume_in_c4'
      when v_duration_status='OVERFILLED' then 'reduce_rounds_or_volume_in_c4'
      else 'mechanic_volume_is_time_coherent'
    end
  ),true);

  return jsonb_set(v_result,'{version}','"c3-whole-wod-v1.1"'::jsonb,true);
end;
$$;

comment on function public.c3_simulate_candidate_wod(jsonb,jsonb,integer,integer,text)
is 'C3 canonical candidate simulator v1.1. Adds time utilization, duration fit and primary-muscle exposure ledger; progressive rep volume includes stage increments.';;
