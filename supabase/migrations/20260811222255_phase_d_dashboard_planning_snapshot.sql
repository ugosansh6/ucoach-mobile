create or replace function public.d_goal_streak(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_max_weeks int default 12
)
returns int
language plpgsql
security definer
set search_path=public
as $$
declare
  v_current_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_week date;
  v_target int;
  v_completed int;
  v_streak int:=0;
  v_i int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target from public.profiles where id=p_user_id;
  if not found then return 0; end if;

  for v_i in 0..greatest(0,least(coalesce(p_max_weeks,12),52)-1) loop
    v_week:=v_current_week-(v_i*7);
    select count(*) into v_completed
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

    if exists(select 1 from public.user_training_weeks w where w.user_id=p_user_id and w.week_start=v_week) then
      select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    end if;

    if v_completed>=v_target then
      v_streak:=v_streak+1;
    else
      exit;
    end if;
  end loop;
  return v_streak;
end;
$$;

create or replace function public.d_dashboard_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_month_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_month date:=date_trunc('month',coalesce(p_month_start,p_anchor_date,current_date)::timestamp)::date;
  v_month_end date:=(date_trunc('month',v_month::timestamp)+interval '1 month - 1 day')::date;
  v_target int;
  v_goal text;
  v_week_completed int;
  v_total_completed int;
  v_form numeric;
  v_rpe numeric;
  v_streak int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  select count(*) into v_week_completed from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*) into v_total_completed from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed';

  select round(avg(post_workout_feeling)::numeric,1),round(avg(global_rpe)::numeric,1)
  into v_form,v_rpe
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)>=v_anchor::timestamptz-interval '6 days';

  v_streak:=public.d_goal_streak(p_user_id,v_anchor,12);

  return jsonb_build_object(
    'version','d1-dashboard-snapshot-v1',
    'anchor_date',v_anchor,
    'week_start',v_week,
    'week_end',v_week+6,
    'month_start',v_month,
    'month_end',v_month_end,
    'primary_goal',v_goal,
    'weekly_session_target',v_target,
    'completed_sessions_this_week',v_week_completed,
    'remaining_sessions_this_week',greatest(0,v_target-v_week_completed),
    'weekly_goal_reached',v_week_completed>=v_target,
    'consecutive_goal_weeks',v_streak,
    'total_completed_sessions',v_total_completed,
    'form_trend_7d',v_form,
    'rpe_trend_7d',v_rpe,
    'week_days',coalesce((
      select jsonb_agg(jsonb_build_object(
        'date',d.day_date,
        'completed',coalesce(s.completed,false),
        'session_id',s.session_id,
        'planned',coalesce(p.planned,false),
        'plan_item_id',p.plan_item_id,
        'plan_status',p.plan_status,
        'planned_focus',p.planned_focus,
        'planned_target_region',p.planned_target_region,
        'planned_progression_intent',p.planned_progression_intent,
        'recommended_date_is_soft',true
      ) order by d.day_date)
      from (
        select (v_week+g)::date as day_date from generate_series(0,6) g
      ) d
      left join lateral (
        select true as completed,ws.id as session_id
        from public.workout_sessions ws
        where ws.user_id=p_user_id and ws.status='completed'
          and coalesce(ws.completed_at,ws.created_at)::date=d.day_date
        order by coalesce(ws.completed_at,ws.created_at) desc limit 1
      ) s on true
      left join lateral (
        select true as planned,i.id as plan_item_id,i.status as plan_status,i.planned_focus,i.planned_target_region,i.planned_progression_intent
        from public.user_training_plan_items i
        where i.user_id=p_user_id and i.week_start=v_week and i.recommended_date=d.day_date
        order by i.sequence_index limit 1
      ) p on true
    ),'[]'::jsonb),
    'next_plan_item',coalesce((
      select jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent
      )
      from public.user_training_plan_items i
      where i.user_id=p_user_id and i.week_start=v_week and i.status in ('available','claimed')
      order by case when i.status='claimed' then 0 else 1 end,i.sequence_index limit 1
    ),'{}'::jsonb),
    'month_sessions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id',ws.id,
        'date',coalesce(ws.completed_at,ws.created_at)::date,
        'completed_at',ws.completed_at,
        'focus',ws.focus,
        'target_region',ws.target_region,
        'duration_minutes',ws.duration_minutes,
        'mechanic',coalesce(nullif(ws.mechanic_json->>'variant_key',''),nullif(ws.mechanic_json->>'mechanic_key',''),nullif(ws.mechanic_json->>'mechanic',''),'CIRCUIT'),
        'global_rpe',ws.global_rpe,
        'post_workout_feeling',ws.post_workout_feeling,
        'progression_intent',ws.progression_intent
      ) order by coalesce(ws.completed_at,ws.created_at) desc)
      from public.workout_sessions ws
      where ws.user_id=p_user_id and ws.status='completed'
        and coalesce(ws.completed_at,ws.created_at)::date between v_month and v_month_end
    ),'[]'::jsonb),
    'recent_sessions',coalesce((
      select jsonb_agg(x.obj order by x.completed_at desc)
      from (
        select coalesce(ws.completed_at,ws.created_at) as completed_at,
          jsonb_build_object(
            'session_id',ws.id,'completed_at',ws.completed_at,'date',coalesce(ws.completed_at,ws.created_at)::date,
            'focus',ws.focus,'target_region',ws.target_region,'duration_minutes',ws.duration_minutes,
            'mechanic',coalesce(nullif(ws.mechanic_json->>'variant_key',''),nullif(ws.mechanic_json->>'mechanic_key',''),nullif(ws.mechanic_json->>'mechanic',''),'CIRCUIT'),
            'global_rpe',ws.global_rpe,'post_workout_feeling',ws.post_workout_feeling,'progression_intent',ws.progression_intent
          ) as obj
        from public.workout_sessions ws
        where ws.user_id=p_user_id and ws.status='completed'
        order by coalesce(ws.completed_at,ws.created_at) desc
        limit 5
      ) x
    ),'[]'::jsonb),
    'stimulus_balance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,
        'target_value',b.target_value,'planned_from_sessions',b.planned_from_sessions,
        'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target,
        'completion_ratio',case when coalesce(b.target_value,0)>0 then round(least(1,coalesce(b.realized_value,0)/b.target_value),3) else null end
      ) order by b.stimulus_type,b.stimulus_key)
      from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon;
revoke all on function public.d_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.d_dashboard_snapshot(uuid,date,date) to authenticated;
;
