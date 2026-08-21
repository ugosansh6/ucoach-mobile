create or replace function public.progression_data_contract_v1(
  p_user_id uuid,
  p_period_days integer default 28,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date := coalesce(p_anchor_date, current_date);
  v_days int := least(1825, greatest(28, coalesce(p_period_days, 28)));
  v_since date;
  v_pi jsonb;
  v_athlete jsonb;
  v_records jsonb;
  v_profile jsonb;
  v_athletic_evidence jsonb := '[]'::jsonb;
  v_current_week jsonb;
  v_period_weeks int := 0;
  v_period_realized int := 0;
  v_period_target int := 0;
  v_active_plan_ratio numeric := 0;
  v_current_week_ratio numeric := 0;
  v_current_week_realized int := 0;
  v_current_week_target int := 0;
  v_completed_sessions int := 0;
  v_total_minutes numeric := 0;
  v_avg_rpe numeric;
  v_avg_feeling numeric;
  v_weekly_load jsonb := '[]'::jsonb;
  v_recent_sessions jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user';
  end if;

  v_since := v_anchor - (v_days - 1);

  v_pi := public.pi_progression_snapshot(p_user_id, v_days, v_anchor);
  v_athlete := public.athlete_profile_summary_v1(p_user_id);
  v_records := public.pr_book_snapshot_v1(p_user_id);

  select jsonb_strip_nulls(jsonb_build_object(
    'firstname', p.firstname,
    'experience', p.experience,
    'weekly_session_target', p.weekly_session_target
  ))
  into v_profile
  from public.profiles p
  where p.id = p_user_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'dimension', u.dimension,
    'confidence', u.confidence,
    'sample_count', u.sample_count,
    'trend', u.trend,
    'explanation', u.explanation_json,
    'calculated_at', u.calculated_at
  )) order by case u.dimension
    when 'strength' then 1
    when 'conditioning' then 2
    when 'power' then 3
    when 'stability' then 4
    when 'mobility' then 5
    else 99
  end), '[]'::jsonb)
  into v_athletic_evidence
  from public.user_athletic_profile u
  where u.user_id = p_user_id;

  select value
  into v_current_week
  from jsonb_array_elements(coalesce(v_pi #> '{consistency,weeks}', '[]'::jsonb))
  order by (value->>'week_start')::date desc
  limit 1;

  select
    count(*)::int,
    coalesce(sum((w->>'realized_sessions')::int), 0)::int,
    coalesce(sum((w->>'target_sessions')::int), 0)::int
  into v_period_weeks, v_period_realized, v_period_target
  from jsonb_array_elements(coalesce(v_pi #> '{consistency,weeks}', '[]'::jsonb)) w;

  if v_period_target > 0 then
    v_active_plan_ratio := round((v_period_realized::numeric / v_period_target::numeric), 3);
  end if;

  if v_current_week is not null then
    v_current_week_realized := coalesce((v_current_week->>'realized_sessions')::int, 0);
    v_current_week_target := coalesce((v_current_week->>'target_sessions')::int, 0);
    v_current_week_ratio := coalesce((v_current_week->>'completion_ratio')::numeric, 0);
  else
    v_current_week_target := coalesce((v_profile->>'weekly_session_target')::int, 3);

    select count(*)::int
    into v_current_week_realized
    from public.workout_sessions ws
    where ws.user_id = p_user_id
      and ws.status = 'completed'
      and coalesce(ws.started_local_date, ws.generation_local_date, ws.completed_at::date, ws.created_at::date)
          between date_trunc('week', v_anchor::timestamp)::date and v_anchor;

    if v_current_week_target > 0 then
      v_current_week_ratio := round(
        least(v_current_week_realized, v_current_week_target)::numeric /
        v_current_week_target::numeric,
        3
      );
    end if;

    v_current_week := jsonb_build_object(
      'week_start', date_trunc('week', v_anchor::timestamp)::date,
      'week_end', date_trunc('week', v_anchor::timestamp)::date + 6,
      'realized_sessions', v_current_week_realized,
      'target_sessions', v_current_week_target,
      'completion_ratio', v_current_week_ratio,
      'target_reached', v_current_week_realized >= v_current_week_target
    );
  end if;

  select
    count(*)::int,
    coalesce(sum(ws.duration_minutes), 0),
    round(avg(ws.global_rpe)::numeric, 1),
    round(avg(ws.post_workout_feeling)::numeric, 1)
  into v_completed_sessions, v_total_minutes, v_avg_rpe, v_avg_feeling
  from public.workout_sessions ws
  where ws.user_id = p_user_id
    and ws.status = 'completed'
    and coalesce(ws.started_local_date, ws.generation_local_date, ws.completed_at::date, ws.created_at::date)
        between v_since and v_anchor;

  select coalesce(jsonb_agg(jsonb_build_object(
    'week_start', q.week_start,
    'load', q.load,
    'sessions', q.sessions
  ) order by q.week_start), '[]'::jsonb)
  into v_weekly_load
  from (
    select
      date_trunc('week', utl.calculated_at)::date as week_start,
      round(sum(coalesce(utl.load_score, 0))::numeric, 0) as load,
      count(distinct utl.session_id)::int as sessions
    from public.user_training_load utl
    where utl.user_id = p_user_id
      and utl.calculated_at::date between v_since and v_anchor
    group by 1
  ) q;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'session_id', q.id,
    'session_date', q.session_date,
    'target_region', q.target_region,
    'focus', q.focus,
    'duration_minutes', q.duration_minutes,
    'global_rpe', q.global_rpe,
    'post_workout_feeling', q.post_workout_feeling,
    'completed_at', q.completed_at
  )) order by q.session_date desc, q.completed_at desc), '[]'::jsonb)
  into v_recent_sessions
  from (
    select
      ws.id,
      coalesce(ws.started_local_date, ws.generation_local_date, ws.completed_at::date, ws.created_at::date) as session_date,
      ws.target_region,
      ws.focus,
      ws.duration_minutes,
      ws.global_rpe,
      ws.post_workout_feeling,
      ws.completed_at
    from public.workout_sessions ws
    where ws.user_id = p_user_id
      and ws.status = 'completed'
      and coalesce(ws.started_local_date, ws.generation_local_date, ws.completed_at::date, ws.created_at::date)
          between v_since and v_anchor
    order by session_date desc, ws.completed_at desc
    limit 5
  ) q;

  return jsonb_build_object(
    'version', 'w1-progression-data-contract-v1',
    'anchor_date', v_anchor,
    'period_days', v_days,
    'period_start', v_since,
    'profile', coalesce(v_profile, '{}'::jsonb),
    'maturity', coalesce(v_pi->'data_maturity', '{}'::jsonb),
    'overall', coalesce(v_pi->'overall', '{}'::jsonb),
    'activity', jsonb_build_object(
      'summary', jsonb_build_object(
        'completed_sessions', v_completed_sessions,
        'total_minutes', v_total_minutes,
        'avg_rpe', v_avg_rpe,
        'avg_post_workout_feeling', v_avg_feeling
      ),
      'current_week', v_current_week,
      'active_plan_consistency', jsonb_build_object(
        'weeks_with_plan', v_period_weeks,
        'realized_sessions', v_period_realized,
        'target_sessions', v_period_target,
        'completion_ratio', v_active_plan_ratio
      ),
      'weekly_load', v_weekly_load,
      'recent_sessions', v_recent_sessions,
      'consistency_history', coalesce(v_pi->'consistency', '{}'::jsonb)
    ),
    'movement_capabilities', coalesce(v_pi->'movement_capabilities', '[]'::jsonb),
    'protocol_capabilities', coalesce(v_pi->'protocol_capabilities', '[]'::jsonb),
    'athlete_profile', coalesce(v_athlete, '{}'::jsonb),
    'athletic_evidence', v_athletic_evidence,
    'records', coalesce(v_records, '{}'::jsonb),
    'coach_signals', coalesce(v_pi->'coach_signals', '[]'::jsonb),
    'decision_feed', coalesce(v_pi->'decision_feed', '{}'::jsonb),
    'authority', jsonb_build_object(
      'movement_capability', 'user_exercise_capabilities + capability_update_events',
      'protocol_capability', 'user_protocol_capabilities + protocol_capability_events',
      'athlete_profile', 'user_athletic_profile',
      'performance_records', 'user_performance_records_current',
      'training_activity', 'workout_sessions',
      'training_load', 'user_training_load',
      'legacy_user_exercise_progress_is_authoritative', false
    ),
    'semantics', jsonb_build_object(
      'estimated_capability_is_not_a_confirmed_pr', true,
      'missing_evidence_is_not_a_weakness', true,
      'confidence_and_freshness_are_required_context', true,
      'current_week_ratio_is_distinct_from_period_consistency', true,
      'period_consistency_counts_only_weeks_with_an_active_plan', true,
      'local_session_date_preferred_for_activity', true
    )
  );
end;
$function$;

revoke all on function public.progression_data_contract_v1(uuid, integer, date) from public;
grant execute on function public.progression_data_contract_v1(uuid, integer, date) to authenticated, service_role;
