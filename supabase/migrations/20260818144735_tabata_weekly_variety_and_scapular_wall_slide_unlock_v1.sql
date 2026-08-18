update public.exercises
set display_name='Glissés d’omoplates au mur',
    warmup_role='mobility'
where id='EX436';

create or replace function public.c4_tabata_variety_penalty_v1(
  p_user_id uuid,
  p_exercise_id text
) returns numeric
language sql
stable
security definer
set search_path='public'
as $$
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
    );
$$;

comment on function public.c4_tabata_variety_penalty_v1(uuid,text) is
'Tabata variety is based on completed training only. Same exercise in current week is strongly penalized, same pattern moderately penalized, recent completed exposure lightly penalized. It is a soft preference, never a safety override.';

do $$
declare
  v_oid oid;
  v_sql text;
  v_old text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_apply_session_architecture_v2'
    and p.prokind='f'
  limit 1;

  if v_oid is null then
    raise exception 'c4_apply_session_architecture_v2 not found';
  end if;

  v_sql:=pg_get_functiondef(v_oid);
  v_old:='4*(select count(*) from public.workout_session_exercises wse
         where wse.exercise_id=e.id and wse.block_key=''tabata''
           and wse.session_id in (select ws.id from public.workout_sessions ws where ws.user_id=p_user_id order by ws.created_at desc limit 6)) asc,';
  v_new:='public.c4_tabata_variety_penalty_v1(p_user_id,e.id) asc,';

  if position(v_old in v_sql)=0 then
    raise exception 'Tabata recency selection fragment not found; refusing blind patch';
  end if;

  v_sql:=replace(v_sql,v_old,v_new);
  execute v_sql;
end $$;

update public.workout_sessions
set generated_workout=public.ugerod_apply_display_names_to_workout_v1(generated_workout),
    updated_at=updated_at
where status in ('generated','in_progress') and generated_workout is not null;

update public.workout_session_exercises wse
set exercise_name=coalesce(nullif(btrim(e.display_name),''),e.name),
    updated_at=wse.updated_at
from public.exercises e
where e.id=wse.exercise_id and wse.status='pending';