create or replace function public.c4_tabata_variety_penalty_v2(
  p_user_id uuid,
  p_exercise_id text
) returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  with target as (
    select movement_pattern
    from public.exercises
    where id=p_exercise_id
  ),
  completed_week as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at) >= date_trunc('week',now())
  ),
  recent_completed as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
    order by coalesce(ws.completed_at,ws.created_at) desc
    limit 6
  ),
  recent_presented as (
    select ws.id,
           row_number() over(order by coalesce(ws.generated_at,ws.created_at) desc) as rn
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('generated','in_progress','abandoned','completed')
      and ws.generated_workout is not null
      and jsonb_array_length(coalesce(ws.generated_workout->'blocks','[]'::jsonb))>0
    order by coalesce(ws.generated_at,ws.created_at) desc
    limit 6
  ),
  presented_exact as (
    select coalesce(max(
      case rp.rn
        when 1 then 20
        when 2 then 10
        when 3 then 6
        when 4 then 3
        when 5 then 2
        else 1
      end
    ),0)::numeric as penalty
    from recent_presented rp
    join public.workout_session_exercises wse
      on wse.session_id=rp.id
     and wse.block_key='tabata'
     and wse.exercise_id=p_exercise_id
  )
  select
    12 * (
      select count(*)
      from public.workout_session_exercises wse
      where wse.exercise_id=p_exercise_id
        and wse.block_key='tabata'
        and wse.session_id in (select id from completed_week)
    )
    + 3 * (
      select count(*)
      from public.workout_session_exercises wse
      join public.exercises e on e.id=wse.exercise_id
      where wse.block_key='tabata'
        and wse.session_id in (select id from completed_week)
        and e.movement_pattern=(select movement_pattern from target)
    )
    + 2 * (
      select count(*)
      from public.workout_session_exercises wse
      where wse.exercise_id=p_exercise_id
        and wse.block_key='tabata'
        and wse.session_id in (select id from recent_completed)
    )
    + (select penalty from presented_exact);
$function$;

comment on function public.c4_tabata_variety_penalty_v2(uuid,text) is
'Tabata freshness v2: completed sessions remain training evidence; recent presented sessions add soft exercise freshness only and never create mastery/load evidence.';

create or replace function public.c4_tabata_variety_penalty_v1(
  p_user_id uuid,
  p_exercise_id text
) returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.c4_tabata_variety_penalty_v2(p_user_id,p_exercise_id);
$function$;