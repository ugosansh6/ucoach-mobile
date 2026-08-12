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
  v_start_offset int:=0;
  v_i int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target from public.profiles where id=p_user_id;
  if not found then return 0; end if;

  select count(*) into v_completed
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_current_week and v_current_week+6;

  if exists(select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_current_week) then
    select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_current_week;
  end if;

  -- If the current week is still below target, keep the streak earned by completed previous weeks.
  if v_completed<v_target then
    v_start_offset:=1;
  end if;

  for v_i in v_start_offset..greatest(v_start_offset,least(coalesce(p_max_weeks,12),52)-1+v_start_offset) loop
    v_week:=v_current_week-(v_i*7);

    select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target
    from public.profiles where id=p_user_id;
    if exists(select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week) then
      select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    end if;

    select count(*) into v_completed
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

    if v_completed>=v_target then
      v_streak:=v_streak+1;
    else
      exit;
    end if;
  end loop;
  return v_streak;
end;
$$;
revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon,authenticated;;
