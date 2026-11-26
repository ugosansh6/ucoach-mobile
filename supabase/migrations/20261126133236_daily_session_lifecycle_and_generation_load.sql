-- Daily session stabilization: scoped generation load, no change to analytics or historical actuals.
-- Old in-progress sessions from different local dates retain the existing stale-session lifecycle.
CREATE UNIQUE INDEX workout_sessions_one_started_local_day_uidx ON public.workout_sessions(user_id,started_local_date)
WHERE status='in_progress' AND started_local_date IS NOT NULL;
CREATE OR REPLACE FUNCTION public.e_mark_session_started(p_session_id uuid, p_local_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.workout_sessions%rowtype;
  v_date date:=coalesce(p_local_date,current_date);
  v_other uuid;
  v_constraint text;
begin
  select * into v_session
  from public.workout_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  if v_session.status in ('completed','abandoned') then
    return jsonb_build_object('status','CLOSED','session_id',p_session_id,'session_status',v_session.status);
  end if;

  if v_session.status='in_progress'
     and v_session.started_local_date is not null
     and v_session.started_local_date<>v_date then
    return jsonb_build_object(
      'status','STALE_SESSION_REQUIRES_RECHECKIN',
      'session_id',p_session_id,
      'started_local_date',v_session.started_local_date,
      'requested_local_date',v_date
    );
  end if;

  -- Same-day lifecycle uniqueness; older frozen sessions retain their recheck-in path.
  select id into v_other from public.workout_sessions
  where user_id=v_session.user_id and status='in_progress'
    and started_local_date=v_date and id<>p_session_id
  order by started_at desc nulls last,id limit 1;
  if v_other is not null then
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',p_session_id,'active_session_id',v_other);
  end if;
  begin
  update public.workout_sessions
  set status='in_progress',
      started_at=coalesce(started_at,now()),
      started_local_date=coalesce(started_local_date,v_date),
      generation_local_date=coalesce(generation_local_date,v_date),
      updated_at=now()
  where id=p_session_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint=CONSTRAINT_NAME;
    if v_constraint<>'workout_sessions_one_started_local_day_uidx' then raise; end if;
    select id into v_other from public.workout_sessions
    where user_id=v_session.user_id and status='in_progress'
      and started_local_date=v_date and id<>p_session_id
    order by started_at desc nulls last,id limit 1;
    return jsonb_build_object('status','OTHER_SESSION_ACTIVE','session_id',p_session_id,'active_session_id',v_other);
  end;

  return jsonb_build_object(
    'status','IN_PROGRESS',
    'session_id',p_session_id,
    'started_local_date',coalesce(v_session.started_local_date,v_date),
    'frozen_for_local_day',true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.program_coach_recent_load_v1(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_exclude_today boolean := coalesce(current_setting('ugerod.daily_generation_anchor',true),'')=v_anchor::text;
  v_load_end date := case when v_exclude_today then v_anchor-1 else v_anchor end;
  v_target int := 3;
  v_s7 int := 0;
  v_s14 int := 0;
  v_s28 int := 0;
  v_rpe7 numeric := null;
  v_rpe14 numeric := null;
  v_rpe28 numeric := null;
  v_feel7 numeric := null;
  v_high_rpe7 int := 0;
  v_pressure text := 'LOW';
  v_conf text := 'LOW';
  v_stim jsonb := '[]'::jsonb;
  v_windows jsonb := '{}'::jsonb;
  v_source_context jsonb := '[]'::jsonb;
  v_pattern_context jsonb := '{}'::jsonb;
  v_reason_codes jsonb := '[]'::jsonb;
  v_max_consecutive_days int := 0;
  v_last_completed_date date := null;
  v_last_pain_date date := null;
  v_ledger_sessions_28d int := 0;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target
  from public.profiles
  where id=p_user_id;

  with execution_by_session as (
    select
      wse.session_id,
      count(*) filter(where wse.user_execution_status='completed')::int as completed_exercises,
      count(*) filter(where wse.user_execution_status='adapted')::int as adapted_exercises,
      count(*) filter(where wse.user_execution_status='not_completed')::int as not_completed_exercises
    from public.workout_session_exercises wse
    group by wse.session_id
  ), pain_by_session as (
    select
      el.session_id,
      count(*) filter(where coalesce(el.pain_affected,false))::int as pain_affected_exercises,
      max(el.created_at::date) filter(where coalesce(el.pain_affected,false)) as last_pain_date
    from public.exercise_logs el
    group by el.session_id
  ), session_rows as (
    select
      ws.id as session_id,
      coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) as session_date,
      ws.duration_minutes::numeric as session_duration_budget_minutes,
      case
        when coalesce(ws.planning_context_json#>>'{architecture,active_training_minutes}','') ~ '^[0-9]+([.][0-9]+)?$'
          then (ws.planning_context_json#>>'{architecture,active_training_minutes}')::numeric
        when coalesce(ws.planning_context_json#>>'{architecture,planned_minutes}','') ~ '^[0-9]+([.][0-9]+)?$'
          then (ws.planning_context_json#>>'{architecture,planned_minutes}')::numeric
        else null
      end as prescribed_active_minutes,
      ws.global_rpe::numeric as global_rpe,
      ws.post_workout_feeling::numeric as post_workout_feeling,
      ws.readiness,
      coalesce(e.completed_exercises,0) as completed_exercises,
      coalesce(e.adapted_exercises,0) as adapted_exercises,
      coalesce(e.not_completed_exercises,0) as not_completed_exercises,
      coalesce(p.pain_affected_exercises,0) as pain_affected_exercises,
      p.last_pain_date,
      case
        when coalesce(ws.actual_protocol_outcome_json->>'controlled_timing','false')='true'
          then true else false
      end as controlled_timing,
      case
        when coalesce(ws.actual_protocol_outcome_json->>'elapsed_seconds','') ~ '^[0-9]+([.][0-9]+)?$'
          then (ws.actual_protocol_outcome_json->>'elapsed_seconds')::numeric
        else null
      end as controlled_wod_seconds,
      case
        when coalesce(ws.actual_protocol_outcome_json->>'completion_ratio','') ~ '^[0-9]+([.][0-9]+)?$'
          then (ws.actual_protocol_outcome_json->>'completion_ratio')::numeric
        else null
      end as protocol_completion_ratio,
      case
        when coalesce(ws.expected_stimulus_json#>>'{density,score}','') ~ '^[0-9]+([.][0-9]+)?$'
          then (ws.expected_stimulus_json#>>'{density,score}')::numeric
        else null
      end as prescribed_density_score
    from public.workout_sessions ws
    left join execution_by_session e on e.session_id=ws.id
    left join pain_by_session p on p.session_id=ws.id
    where ws.user_id=p_user_id
      and ws.status='completed' and public.session_counts_as_training_v1(ws.id)
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)
          between v_anchor-27 and v_load_end
  ), window_rows as (
    select
      d.days,
      count(sr.session_id)::int as completed_sessions,
      count(distinct sr.session_date)::int as training_days,
      coalesce(sum(sr.session_duration_budget_minutes),0) as session_duration_budget_minutes,
      coalesce(sum(sr.prescribed_active_minutes),0) as prescribed_active_minutes,
      count(sr.prescribed_active_minutes)::int as prescribed_active_minutes_observed_sessions,
      round(avg(sr.session_duration_budget_minutes),2) as average_session_duration_budget_minutes,
      count(sr.global_rpe)::int as rpe_observed_sessions,
      round(avg(sr.global_rpe),2) as average_rpe,
      count(*) filter(where sr.global_rpe>=9)::int as high_rpe_sessions,
      count(sr.post_workout_feeling)::int as feeling_observed_sessions,
      round(avg(sr.post_workout_feeling),2) as average_post_workout_feeling,
      coalesce(sum(sr.completed_exercises),0)::int as completed_exercises,
      coalesce(sum(sr.adapted_exercises),0)::int as adapted_exercises,
      coalesce(sum(sr.not_completed_exercises),0)::int as not_completed_exercises,
      coalesce(sum(sr.pain_affected_exercises),0)::int as pain_affected_exercises,
      count(*) filter(where sr.completed_exercises+sr.adapted_exercises+sr.not_completed_exercises>0)::int as execution_observed_sessions,
      count(*) filter(where sr.controlled_timing)::int as controlled_timing_sessions,
      coalesce(sum(sr.controlled_wod_seconds) filter(where sr.controlled_timing),0) as controlled_wod_seconds,
      count(sr.protocol_completion_ratio)::int as protocol_completion_observed_sessions,
      round(avg(sr.protocol_completion_ratio),4) as average_protocol_completion_ratio,
      count(sr.prescribed_density_score)::int as prescribed_density_observed_sessions,
      round(avg(sr.prescribed_density_score),2) as average_prescribed_density_score
    from unnest(array[7,14,28]) d(days)
    left join session_rows sr on sr.session_date between v_anchor-(d.days-1) and v_load_end
    group by d.days
  )
  select jsonb_object_agg(
    days::text,
    jsonb_build_object(
      'completed_sessions',completed_sessions,
      'training_days',training_days,
      'session_duration_budget_minutes',round(session_duration_budget_minutes,2),
      'prescribed_active_minutes',round(prescribed_active_minutes,2),
      'prescribed_active_minutes_observed_sessions',prescribed_active_minutes_observed_sessions,
      'average_session_duration_budget_minutes',average_session_duration_budget_minutes,
      'intensity',jsonb_build_object(
        'rpe_observed_sessions',rpe_observed_sessions,
        'average_rpe',average_rpe,
        'high_rpe_sessions',high_rpe_sessions
      ),
      'tolerance',jsonb_build_object(
        'feeling_observed_sessions',feeling_observed_sessions,
        'average_post_workout_feeling',average_post_workout_feeling,
        'completed_exercises',completed_exercises,
        'adapted_exercises',adapted_exercises,
        'not_completed_exercises',not_completed_exercises,
        'pain_affected_exercises',pain_affected_exercises
      ),
      'density_context',jsonb_build_object(
        'controlled_timing_sessions',controlled_timing_sessions,
        'controlled_wod_seconds',round(controlled_wod_seconds,2),
        'protocol_completion_observed_sessions',protocol_completion_observed_sessions,
        'average_protocol_completion_ratio',average_protocol_completion_ratio,
        'prescribed_density_observed_sessions',prescribed_density_observed_sessions,
        'average_prescribed_density_score',average_prescribed_density_score
      ),
      'coverage',jsonb_build_object(
        'rpe',case when completed_sessions>0 then round(rpe_observed_sessions::numeric/completed_sessions,3) else 0 end,
        'feeling',case when completed_sessions>0 then round(feeling_observed_sessions::numeric/completed_sessions,3) else 0 end,
        'execution_status',case when completed_sessions>0 then round(execution_observed_sessions::numeric/completed_sessions,3) else 0 end,
        'controlled_timing',case when completed_sessions>0 then round(controlled_timing_sessions::numeric/completed_sessions,3) else 0 end
      )
    )
  )
  into v_windows
  from window_rows;

  v_s7 := coalesce((v_windows#>>'{7,completed_sessions}')::int,0);
  v_s14 := coalesce((v_windows#>>'{14,completed_sessions}')::int,0);
  v_s28 := coalesce((v_windows#>>'{28,completed_sessions}')::int,0);
  v_rpe7 := nullif(v_windows#>>'{7,intensity,average_rpe}','')::numeric;
  v_rpe14 := nullif(v_windows#>>'{14,intensity,average_rpe}','')::numeric;
  v_rpe28 := nullif(v_windows#>>'{28,intensity,average_rpe}','')::numeric;
  v_feel7 := nullif(v_windows#>>'{7,tolerance,average_post_workout_feeling}','')::numeric;
  v_high_rpe7 := coalesce(nullif(v_windows#>>'{7,intensity,high_rpe_sessions}','')::int,0);

  with days as (
    select distinct coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date) as d
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed' and public.session_counts_as_training_v1(ws.id)
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)
          between v_anchor-27 and v_load_end
  ), islands as (
    select d,d-(row_number() over(order by d))::int as grp
    from days
  )
  select coalesce(max(streak),0)::int,max(last_day)
  into v_max_consecutive_days,v_last_completed_date
  from (
    select count(*)::int streak,max(d) last_day
    from islands
    group by grp
  ) s;

  select max(el.created_at::date)
  into v_last_pain_date
  from public.exercise_logs el
  join public.workout_sessions ws on ws.id=el.session_id
  where ws.user_id=p_user_id and ws.status='completed' and public.session_counts_as_training_v1(ws.id)
    and coalesce(el.pain_affected,false)
    and el.created_at::date between v_anchor-27 and v_load_end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stimulus_type',stimulus_type,
    'stimulus_key',stimulus_key,
    'unit',unit,
    'realized_7d',round(realized_7d,2),
    'realized_14d',round(realized_14d,2),
    'realized_28d',round(realized_28d,2),
    'sessions_7d',sessions_7d,
    'sessions_14d',sessions_14d,
    'sessions_28d',sessions_28d,
    'last_exposure_date',last_exposure_date,
    'days_since_last_exposure',case when last_exposure_date is null then null else v_anchor-last_exposure_date end,
    'source_kinds',source_kinds
  ) order by stimulus_type,stimulus_key),'[]'::jsonb)
  into v_stim
  from (
    select
      stimulus_type,
      stimulus_key,
      unit,
      coalesce(sum(realized_value) filter(where occurred_at::date between v_anchor-6 and v_load_end),0) as realized_7d,
      coalesce(sum(realized_value) filter(where occurred_at::date between v_anchor-13 and v_load_end),0) as realized_14d,
      coalesce(sum(realized_value) filter(where occurred_at::date between v_anchor-27 and v_load_end),0) as realized_28d,
      count(distinct session_id) filter(where occurred_at::date between v_anchor-6 and v_load_end and coalesce(realized_value,0)>0)::int as sessions_7d,
      count(distinct session_id) filter(where occurred_at::date between v_anchor-13 and v_load_end and coalesce(realized_value,0)>0)::int as sessions_14d,
      count(distinct session_id) filter(where occurred_at::date between v_anchor-27 and v_load_end and coalesce(realized_value,0)>0)::int as sessions_28d,
      max(occurred_at::date) filter(where coalesce(realized_value,0)>0) as last_exposure_date,
      to_jsonb(array_agg(distinct source_kind order by source_kind)) as source_kinds
    from public.session_stimulus_ledger
    where user_id=p_user_id
      and occurred_at::date between v_anchor-27 and v_load_end
      and metadata_json->>'ledger_role'='realized'
      and realized_value is not null
    group by stimulus_type,stimulus_key,unit
  ) q;

  with per_session_source as (
    select session_id,coalesce(nullif(source_kind,''),'unknown') source_kind
    from public.session_stimulus_ledger
    where user_id=p_user_id
      and occurred_at::date between v_anchor-27 and v_load_end
      and metadata_json->>'ledger_role'='realized'
      and realized_value is not null
    group by session_id,coalesce(nullif(source_kind,''),'unknown')
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('source_kind',source_kind,'sessions_28d',sessions) order by source_kind),'[]'::jsonb),
    coalesce(sum(sessions),0)::int
  into v_source_context,v_ledger_sessions_28d
  from (
    select source_kind,count(distinct session_id)::int sessions
    from per_session_source
    group by source_kind
  ) s;

  v_pattern_context := public.program_coach_pattern_exposure_shadow_v1(p_user_id,v_anchor);
  v_conf := case when v_s28>=8 then 'HIGH' when v_s28>=3 then 'MEDIUM' else 'LOW' end;
  v_pressure := public.program_coach_load_pressure_classification_v1(v_target,v_s7,v_high_rpe7,v_feel7);

  select coalesce(jsonb_agg(reason order by priority,reason),'[]'::jsonb)
  into v_reason_codes
  from (
    select 10 priority,'SESSION_FREQUENCY_WELL_ABOVE_TARGET' reason where v_s7>=v_target+2
    union all select 20,'SESSION_FREQUENCY_ABOVE_TARGET' where v_s7=v_target+1
    union all select 30,'WEEKLY_SESSION_TARGET_REACHED' where v_s7=v_target
    union all select 40,'HIGH_RPE_CLUSTER' where v_high_rpe7>=2
    union all select 50,'HIGH_RPE_SESSION_PRESENT' where v_high_rpe7=1
    union all select 60,'LOW_POST_WORKOUT_FEELING_CLUSTER' where v_s7>=2 and v_feel7 is not null and v_feel7<=4
    union all select 70,'CONSECUTIVE_TRAINING_DAYS' where v_max_consecutive_days>=2
    union all select 80,'HIGH_LOCAL_PATTERN_PRESSURE' where jsonb_array_length(coalesce(v_pattern_context->'high_recent_pressure_patterns','[]'::jsonb))>0
    union all select 90,'LIMITED_28D_HISTORY' where v_s28<3
    union all select 100,'NO_COMPLETED_SESSION_28D' where v_s28=0
  ) reasons;

  return jsonb_build_object(
    'version','program-coach-recent-load-v2-explainable',
    'anchor_date',v_anchor,
    'weekly_session_target',v_target,
    'sessions',jsonb_build_object('7d',v_s7,'14d',v_s14,'28d',v_s28),
    'average_rpe',jsonb_build_object('7d',round(v_rpe7,2),'14d',round(v_rpe14,2),'28d',round(v_rpe28,2)),
    'average_post_workout_feeling_7d',round(v_feel7,2),
    'high_rpe_sessions_7d',v_high_rpe7,
    'windows',v_windows,
    'stimulus_windows',v_stim,
    'pattern_context',v_pattern_context,
    'source_context_28d',v_source_context,
    'load_pressure',v_pressure,
    'load_pressure_reason_codes',case
      when jsonb_array_length(v_reason_codes)=0 then jsonb_build_array('NO_LOAD_PRESSURE_TRIGGER')
      else v_reason_codes
    end,
    'signal_confidence',v_conf,
    'recency',jsonb_build_object(
      'last_completed_session_date',v_last_completed_date,
      'days_since_last_completed_session',case when v_last_completed_date is null then null else v_anchor-v_last_completed_date end,
      'max_consecutive_training_days_28d',v_max_consecutive_days,
      'last_pain_affected_date',v_last_pain_date,
      'days_since_last_pain_affected',case when v_last_pain_date is null then null else v_anchor-v_last_pain_date end
    ),
    'data_quality',jsonb_build_object(
      'completed_sessions_28d',v_s28,
      'ledger_session_coverage_28d',case when v_s28>0 then round(least(v_ledger_sessions_28d,v_s28)::numeric/v_s28,3) else 0 end,
      'rpe_coverage_28d',coalesce(nullif(v_windows#>>'{28,coverage,rpe}','')::numeric,0),
      'feeling_coverage_28d',coalesce(nullif(v_windows#>>'{28,coverage,feeling}','')::numeric,0),
      'controlled_timing_coverage_28d',coalesce(nullif(v_windows#>>'{28,coverage,controlled_timing}','')::numeric,0),
      'confidence_label',v_conf,
      'known_limitations',jsonb_build_array(
        'SESSION_DURATION_IS_A_BUDGET_NOT_CONTROLLED_ACTIVE_TIME',
        'PRESCRIBED_DENSITY_IS_NOT_ACTUAL_DENSITY',
        'RPE_AND_FEELING_ARE_USER_REPORTED',
        'MISSING_SIGNAL_REMAINS_UNKNOWN'
      )
    ),
    'semantics',jsonb_build_object(
      'descriptive_not_medical',true,
      'no_acute_chronic_ratio',true,
      'no_physiological_recovery_score',true,
      'controlled_timing_required_for_actual_time_claims',true,
      'prescribed_density_kept_separate_from_observed_execution',true,
      'patterns_are_programming_context_not_injury_risk',true,
      'readiness_today_still_authoritative',true,
      'safety_overrides_program',true
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.program_coach_pattern_exposure_shadow_v1(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_load_end date:=case when coalesce(current_setting('ugerod.daily_generation_anchor',true),'')=v_anchor::text then v_anchor-1 else v_anchor end;
  v_rows jsonb:='[]'::jsonb;
  v_total7 numeric:=0;
  v_total10 numeric:=0;
  v_total28 numeric:=0;
  v_dominant jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  with a as (
    select stimulus_key movement_pattern,
           sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-6 and v_load_end) exposure_7d,
           sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-9 and v_load_end) exposure_10d,
           sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-27 and v_load_end) exposure_28d,
           count(distinct session_id) filter(where occurred_at::date between v_anchor-9 and v_load_end and coalesce(realized_value,0)>0) sessions_10d
    from public.session_stimulus_ledger
    where user_id=p_user_id and stimulus_type='pattern'
      and metadata_json->>'ledger_role'='realized'
      and metadata_json->>'source'='rolling-pattern-exposure-v1'
      and occurred_at::date between v_anchor-27 and v_load_end
    group by stimulus_key
  ), totals as (
    select coalesce(sum(exposure_7d),0) t7,coalesce(sum(exposure_10d),0) t10,coalesce(sum(exposure_28d),0) t28 from a
  ), scored as (
    select a.*,
           case when t.t7>0 then a.exposure_7d/t.t7 else 0 end share_7d,
           case when t.t10>0 then a.exposure_10d/t.t10 else 0 end share_10d,
           case when t.t28>0 then a.exposure_28d/t.t28 else 0 end share_28d,
           case
             when t.t10>0 and a.exposure_10d>=12 and a.exposure_10d/t.t10>=0.35 then 'HIGH'
             when t.t10>0 and a.exposure_10d>=8 and a.exposure_10d/t.t10>=0.22 then 'MEDIUM'
             else 'LOW'
           end recent_pressure
    from a cross join totals t
  )
  select t7,t10,t28,
         coalesce((select jsonb_agg(jsonb_build_object(
           'movement_pattern',movement_pattern,'exposure_7d',round(exposure_7d,2),'exposure_10d',round(exposure_10d,2),'exposure_28d',round(exposure_28d,2),
           'share_7d',round(share_7d,4),'share_10d',round(share_10d,4),'share_28d',round(share_28d,4),
           'sessions_10d',sessions_10d,'recent_pressure',recent_pressure,
           'recent_vs_28d_share_delta',round(share_10d-share_28d,4)
         ) order by exposure_10d desc,movement_pattern) from scored),'[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
           'movement_pattern',movement_pattern,'share_10d',round(share_10d,4),'exposure_10d',round(exposure_10d,2),'recent_pressure',recent_pressure
         ) order by share_10d desc,movement_pattern) from scored where recent_pressure='HIGH'),'[]'::jsonb)
  into v_total7,v_total10,v_total28,v_rows,v_dominant
  from totals;

  return jsonb_build_object(
    'version','rolling-pattern-exposure-shadow-v1','mode','SHADOW','status',case when v_total28>0 then 'AVAILABLE' else 'INSUFFICIENT_HISTORY' end,
    'anchor_date',v_anchor,'totals',jsonb_build_object('7d',round(v_total7,2),'10d',round(v_total10,2),'28d',round(v_total28,2)),
    'pattern_exposure',v_rows,'high_recent_pressure_patterns',v_dominant,
    'semantics',jsonb_build_object(
      'realized_training_only',true,'skill_multiplier',1.25,'warmup_unlock_tabata_excluded',true,
      'external_and_internal_sessions_share_same_ledger',true,'recent_pressure_is_soft_not_injury_risk',true,
      'not_equal_distribution_target',true
    ),
    'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_exercise_selection',false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.d_resolve_session_context(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE, p_duration_minutes integer DEFAULT 45, p_readiness text DEFAULT 'normal'::text, p_focus_override text DEFAULT NULL::text, p_target_region_override text DEFAULT NULL::text, p_progression_intent_override text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_active_session public.workout_sessions%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_pi jsonb:='{}'::jsonb;
  v_pi_hint text:='MAINTAIN';
  v_pi_stage text:='LOW';
  v_planned_intent text;
  v_long_inactivity_days int:=90;
  v_days_since_last int:=null;
  v_exclude_today boolean:=coalesce(current_setting('ugerod.daily_generation_anchor',true),'')=v_anchor::text;
  v_has_completed_today boolean:=false;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;

  select coalesce((config#>>'{weekly_loop,long_inactivity_recalibrate_days}')::int,90)
  into v_long_inactivity_days
  from public.session_engine_policy
  where policy_key='c4-final-default';
  v_long_inactivity_days:=greatest(1,coalesce(v_long_inactivity_days,90));

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id
    and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    select * into v_active_session
    from public.workout_sessions
    where id=v_active.session_id;

    if v_active_session.status='in_progress'
       and v_active_session.started_local_date=v_anchor then
      return jsonb_build_object(
        'status','RESUME_EXISTING',
        'version','d1-session-context-v5-inactivity',
        'week_start',v_week,
        'plan_item_id',v_active.id,
        'resume_session_id',v_active.session_id,
        'focus',v_active.planned_focus,
        'target_region',v_active.planned_target_region,
        'progression_intent',v_active.planned_progression_intent,
        'started_local_date',v_active_session.started_local_date,
        'frozen_for_local_day',true,
        'reason_codes',jsonb_build_array('daily_session:resume_started_today')
      );
    end if;

    delete from public.session_stimulus_ledger
    where session_id=v_active.session_id
      and metadata_json->>'source'='phase_d_weekly_loop';

    update public.workout_sessions
    set status='abandoned',
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh',jsonb_build_object(
            'released_at',now(),
            'released_for_local_date',v_anchor,
            'reason',case
              when v_active_session.status='generated' then 'new_checkin_before_start'
              else 'new_local_day_after_started_session'
            end
          )
        ),
        updated_at=now()
    where id=v_active.session_id;

    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,
        claimed_at=null,
        updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_active.session_id,
          'daily_refresh_released_at',now()
        )
    where id=v_active.id;

    v_reasons:=array_append(v_reasons,
      case when v_active_session.status='generated'
        then 'daily_session:rebuild_for_new_checkin'
        else 'daily_session:unfreeze_new_local_day'
      end
    );
  end if;

  select directive_json into v_pi
  from public.user_coaching_directive_runtime
  where user_id=p_user_id;
  if v_pi is null then
    v_pi:=public.pi_coaching_directives(p_user_id,v_anchor,90);
  end if;
  v_pi_hint:=upper(coalesce(v_pi#>>'{session_recommendation,progression_intent_hint}','MAINTAIN'));
  v_pi_stage:=upper(coalesce(v_pi#>>'{data_maturity,stage}','LOW'));

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;
  if v_exclude_today then
    select exists(select 1 from public.workout_sessions ws where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)=v_anchor)
    into v_has_completed_today;
  end if;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date <= v_anchor
    and (not v_exclude_today or coalesce(ws.started_local_date,ws.generation_local_date,ws.completed_at::date,ws.created_at::date)<v_anchor)
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    v_days_since_last:=greatest(0,v_anchor-v_last.completed_at::date);
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=v_anchor then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  v_planned_intent:=upper(coalesce(v_item.planned_progression_intent,'MAINTAIN'));

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_days_since_last is not null and v_days_since_last>=v_long_inactivity_days then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:long_inactivity_recalibrate');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_has_completed_today and (v_item.id is null or v_completed_count>=v_target) then
    -- Completing another workout today is not a reason to prescribe consolidation.
    -- Explicit intent, current low readiness and prior-day recovery guards above remain authoritative.
    v_intent:=coalesce(nullif(v_item.planned_progression_intent,'') ,'MAINTAIN');
    if v_item.id is null then v_intent:='MAINTAIN'; end if;
    v_reasons:=array_append(v_reasons,'intent:same_day_extra_session_no_count_penalty');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='RECALIBRATE' and v_planned_intent<>'CONSOLIDATE' then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_recalibrate');
  elsif v_pi_stage in ('MEDIUM','HIGH') and v_pi_hint='CONSOLIDATE' and v_planned_intent='PROGRESS' then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:progression_intelligence_consolidate');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');
    v_reasons:=array_append(v_reasons,'intent:weekly_plan');
    if v_pi_hint='PROGRESS' then
      v_reasons:=array_append(v_reasons,'pi:progress_signal_used_as_candidate_bias');
    elsif v_pi_hint='MAINTAIN' then
      v_reasons:=array_append(v_reasons,'pi:no_strong_intent_override');
    end if;
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v5-inactivity','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'days_since_last_completed_session',v_days_since_last,
    'long_inactivity_recalibrate_days',v_long_inactivity_days,
    'daily_refresh',jsonb_build_object('new_checkin_rebuilds_unstarted_session',true,'started_session_frozen_for_local_day_only',true),
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'progression_intelligence',jsonb_build_object(
      'version',v_pi->>'version',
      'data_maturity',coalesce(v_pi->'data_maturity','{}'::jsonb),
      'session_recommendation',coalesce(v_pi->'session_recommendation','{}'::jsonb),
      'guardrails',coalesce(v_pi->'guardrails','{}'::jsonb)
    ),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.d_generate_adaptive_session_v2(p_user_id uuid, p_focus_override text, p_duration_minutes integer, p_readiness text, p_target_region_override text DEFAULT NULL::text, p_progression_intent_override text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_available_equipment text[] DEFAULT '{}'::text[], p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 12, p_policy_key text DEFAULT 'c4-final-default'::text, p_anchor_date date DEFAULT CURRENT_DATE, p_force_recalculate_started boolean DEFAULT false, p_protected_session_exercise_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_result jsonb:='{}'::jsonb;
  v_failed_result jsonb:='{}'::jsonb;
  v_status text;
  v_previous_daily_scope text:=coalesce(current_setting('ugerod.daily_generation_anchor',true),'');
begin
  perform set_config('ugerod.daily_generation_anchor',v_anchor::text,true);
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  -- One adaptive generation decision at a time for a user/local day.
  -- This prevents two concurrent requests from releasing/reclaiming the same plan item.
  perform pg_advisory_xact_lock(
    hashtextextended('ugerod:adaptive-generation:'||p_user_id::text||':'||v_anchor::text,0)
  );

  begin
    v_result:=public.d_generate_adaptive_session_v2_pre_transactional_replacement_v1(
      p_user_id,p_focus_override,p_duration_minutes,p_readiness,p_target_region_override,
      p_progression_intent_override,p_zone_terms,p_inventory,p_available_equipment,
      p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key,v_anchor,
      p_force_recalculate_started,p_protected_session_exercise_ids
    );

    v_status:=coalesce(v_result->>'status','');
    if v_status in (
      'generated',
      'resume_existing',
      'safety_adapted_existing',
      'safety_adapt_partial_recalc_required',
      'STARTED_SESSION_CONFIRM_REQUIRED',
      'RECALC_LIMIT_REACHED'
    ) then
      perform set_config('ugerod.daily_generation_anchor',v_previous_daily_scope,true);
      return v_result||jsonb_build_object(
        'transactional_replacement',jsonb_build_object(
          'version','transactional-session-replacement-v1',
          'serialized_by_user_local_day',true,
          'replacement_committed',v_status='generated',
          'existing_session_preserved_on_failure',true
        )
      );
    end if;

    -- The nested block is a PostgreSQL subtransaction. Raising here rolls back
    -- session abandonment, plan release and any partial candidate session writes.
    v_failed_result:=v_result;
    raise exception using
      errcode='UG001',
      message='UGEROD_TRANSACTIONAL_REPLACEMENT_ROLLBACK';
  exception when sqlstate 'UG001' then
    perform set_config('ugerod.daily_generation_anchor',v_previous_daily_scope,true);
    return coalesce(v_failed_result,'{}'::jsonb)||jsonb_build_object(
      'transactional_replacement',jsonb_build_object(
        'version','transactional-session-replacement-v1',
        'serialized_by_user_local_day',true,
        'replacement_committed',false,
        'existing_session_preserved_on_failure',true,
        'rollback_applied',true
      )
    );
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_environment_session_v4(p_user_id uuid, p_environment_code text, p_surface_code text DEFAULT NULL::text, p_requested_format_code text DEFAULT NULL::text, p_execution_style text DEFAULT NULL::text, p_user_focus text DEFAULT 'General Fitness'::text, p_duration_minutes integer DEFAULT 45, p_readiness text DEFAULT 'normal'::text, p_target_region text DEFAULT NULL::text, p_progression_intent text DEFAULT NULL::text, p_zone_terms text[] DEFAULT '{}'::text[], p_inventory jsonb DEFAULT '[]'::jsonb, p_available_equipment text[] DEFAULT '{}'::text[], p_outdoor_place_code text DEFAULT NULL::text, p_reliable_distance boolean DEFAULT false, p_running_allowed boolean DEFAULT true, p_calibration_opportunity boolean DEFAULT false, p_max_complexity integer DEFAULT 3, p_max_difficulty text DEFAULT 'Intermédiaire'::text, p_candidate_count integer DEFAULT 20, p_policy_key text DEFAULT 'c4-final-default'::text, p_start_now boolean DEFAULT false, p_anchor_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_environment text := public.normalize_session_environment_v1(p_environment_code);
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_resolution jsonb := null;
  v_effective_region text := p_target_region;
  v_existing public.workout_sessions%rowtype;
  v_result jsonb;
  v_workout jsonb;
  v_previous_daily_scope text:=coalesce(current_setting('ugerod.daily_generation_anchor',true),'');
begin
  perform set_config('ugerod.daily_generation_anchor',v_anchor::text,true);
  if p_user_id is null then raise exception 'p_user_id is required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  if v_environment='GYM' then
    -- Existing open sessions keep their current region contract. This prevents a
    -- deployment from silently changing a generated/in-progress legacy session.
    select ws.*
    into v_existing
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('generated','in_progress')
      and coalesce(ws.started_local_date,ws.generation_local_date)=v_anchor
    order by
      case when ws.status='in_progress' then 0 else 1 end,
      coalesce(ws.started_at,ws.generated_at,ws.updated_at) desc
    limit 1;

    if v_existing.id is not null
       and upper(coalesce(v_existing.planned_environment_code,''))='GYM'
       and p_target_region is null then
      v_effective_region := v_existing.target_region;
      v_resolution := jsonb_build_object(
        'status','RESOLVED',
        'version','gym-target-region-resolver-v1',
        'target_region',v_effective_region,
        'source','EXISTING_OPEN_SESSION_PRESERVED',
        'session_id',v_existing.id,
        'anchor_date',v_anchor
      );
    else
      v_resolution := public.gym_resolve_target_region_v1(
        p_user_id,p_user_focus,v_anchor,p_target_region
      );
      v_effective_region := v_resolution->>'target_region';
    end if;
  end if;

  v_result := public.generate_environment_session_v3(
    p_user_id,
    v_environment,
    p_surface_code,
    p_requested_format_code,
    p_execution_style,
    p_user_focus,
    p_duration_minutes,
    p_readiness,
    v_effective_region,
    p_progression_intent,
    p_zone_terms,
    p_inventory,
    p_available_equipment,
    p_outdoor_place_code,
    p_reliable_distance,
    p_running_allowed,
    p_calibration_opportunity,
    p_max_complexity,
    p_max_difficulty,
    p_candidate_count,
    p_policy_key,
    p_start_now,
    v_anchor
  );

  if v_environment='GYM'
     and v_resolution is not null
     and nullif(v_result->>'session_id','') is not null
     and coalesce((v_result->>'session_persisted')::boolean,false) then
    update public.workout_sessions
    set target_region=coalesce(target_region,v_effective_region),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)
          || jsonb_build_object(
            'gym_target_region_resolution',
            v_resolution || jsonb_build_object(
              'effective_target_region',v_effective_region
            )
          ),
        generated_workout=jsonb_set(
          coalesce(generated_workout,'{}'::jsonb),
          '{meta}',
          coalesce(generated_workout->'meta','{}'::jsonb)
            || jsonb_build_object(
              'resolved_target_region',v_effective_region,
              'gym_target_region_resolution',v_resolution
            ),
          true
        ),
        updated_at=now()
    where id=(v_result->>'session_id')::uuid
      and user_id=p_user_id;

    select generated_workout
    into v_workout
    from public.workout_sessions
    where id=(v_result->>'session_id')::uuid
      and user_id=p_user_id;

    v_result := jsonb_set(v_result,'{generated_workout}',coalesce(v_workout,'{}'::jsonb),true);
  end if;

  perform set_config('ugerod.daily_generation_anchor',v_previous_daily_scope,true);

  return v_result || jsonb_build_object(
    'version','environment-session-generator-v4-environment-coaching',
    'resolved_target_region',case when v_environment='GYM' then v_effective_region else p_target_region end,
    'gym_target_region_resolution',case when v_environment='GYM' then v_resolution else null end
  );
end;
$function$;
