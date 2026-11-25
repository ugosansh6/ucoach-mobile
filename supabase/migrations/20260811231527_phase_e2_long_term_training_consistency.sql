create or replace function public.e_training_consistency_history(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_months_back integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_months int:=least(120,greatest(1,coalesce(p_months_back,24)));
  v_from date:=(date_trunc('month',v_anchor::timestamp)-((v_months-1)||' months')::interval)::date;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  return jsonb_build_object(
    'version','e2-training-consistency-v1',
    'from_date',v_from,
    'through_date',v_anchor,
    'weeks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start',w.week_start,
        'week_end',w.week_start+6,
        'target_sessions',w.weekly_session_target,
        'realized_sessions',coalesce(a.realized_sessions,0),
        'target_reached',coalesce(a.realized_sessions,0)>=w.weekly_session_target,
        'completion_ratio',case when w.weekly_session_target>0 then round(coalesce(a.realized_sessions,0)::numeric/w.weekly_session_target,3) else null end
      ) order by w.week_start)
      from public.user_training_weeks w
      left join lateral (
        select count(*)::int as realized_sessions
        from public.workout_sessions ws
        where ws.user_id=w.user_id and ws.status='completed'
          and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6
      ) a on true
      where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
    ),'[]'::jsonb),
    'months',coalesce((
      with weeks as (
        select w.week_start,w.weekly_session_target,
          (select count(*)::int from public.workout_sessions ws
           where ws.user_id=w.user_id and ws.status='completed'
             and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6) as realized
        from public.user_training_weeks w
        where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
      )
      select jsonb_agg(jsonb_build_object(
        'month_start',m.month_start,
        'weeks_with_plan',m.weeks_with_plan,
        'target_sessions',m.target_sessions,
        'realized_sessions',m.realized_sessions,
        'completion_ratio',case when m.target_sessions>0 then round(m.realized_sessions::numeric/m.target_sessions,3) else null end
      ) order by m.month_start)
      from (
        select date_trunc('month',week_start::timestamp)::date as month_start,
          count(*)::int as weeks_with_plan,
          sum(weekly_session_target)::int as target_sessions,
          sum(realized)::int as realized_sessions
        from weeks
        group by 1
      ) m
    ),'[]'::jsonb),
    'years',coalesce((
      with weeks as (
        select w.week_start,w.weekly_session_target,
          (select count(*)::int from public.workout_sessions ws
           where ws.user_id=w.user_id and ws.status='completed'
             and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6) as realized
        from public.user_training_weeks w
        where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
      )
      select jsonb_agg(jsonb_build_object(
        'year',y.year_value,
        'weeks_with_plan',y.weeks_with_plan,
        'target_sessions',y.target_sessions,
        'realized_sessions',y.realized_sessions,
        'completion_ratio',case when y.target_sessions>0 then round(y.realized_sessions::numeric/y.target_sessions,3) else null end
      ) order by y.year_value)
      from (
        select extract(year from week_start)::int as year_value,
          count(*)::int as weeks_with_plan,
          sum(weekly_session_target)::int as target_sessions,
          sum(realized)::int as realized_sessions
        from weeks
        group by 1
      ) y
    ),'[]'::jsonb),
    'lifetime',jsonb_build_object(
      'weeks_with_plan',(select count(*) from public.user_training_weeks where user_id=p_user_id),
      'target_sessions',(select coalesce(sum(weekly_session_target),0) from public.user_training_weeks where user_id=p_user_id),
      'realized_sessions',(select count(*) from public.workout_sessions where user_id=p_user_id and status='completed')
    ),
    'semantics',jsonb_build_object(
      'recommended_dates_are_soft',true,
      'unrealized_week_creates_debt',false,
      'new_week_starts_clean',true
    )
  );
end;
$$;

revoke all on function public.e_training_consistency_history(uuid,date,integer) from public,anon;
grant execute on function public.e_training_consistency_history(uuid,date,integer) to authenticated;;
