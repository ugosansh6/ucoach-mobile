-- SESSION EXECUTION PERSISTENCE GUARD V1
-- Canonical runtime invariant for HOME / BOX / GYM / OUTDOOR:
-- no execution actual can be persisted before the session starts.
-- WOD actuals additionally require an explicit reveal and explicit WOD start.

create or replace function public.enforce_session_exercise_execution_started_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_status text;
  v_started_at timestamptz;
  v_wod_revealed_at timestamptz;
  v_wod_started_at timestamptz;
  v_execution_changed boolean:=false;
begin
  v_execution_changed:=
    (
      new.user_execution_status is distinct from old.user_execution_status
      and lower(coalesce(new.user_execution_status,'pending'))<>'pending'
    )
    or (
      new.status is distinct from old.status
      and lower(coalesce(new.status,'pending')) in ('completed','skipped','not_completed','adapted')
    )
    or new.execution_reason_code is distinct from old.execution_reason_code
    or new.reps_completed is distinct from old.reps_completed
    or new.weight_kg is distinct from old.weight_kg
    or new.duration_seconds is distinct from old.duration_seconds
    or new.distance_meters is distinct from old.distance_meters
    or new.rpe is distinct from old.rpe
    or new.actual_attempts_json is distinct from old.actual_attempts_json;

  if not v_execution_changed then
    return new;
  end if;

  select
    ws.status,
    ws.started_at,
    ws.wod_revealed_at,
    ws.wod_started_at
  into
    v_status,
    v_started_at,
    v_wod_revealed_at,
    v_wod_started_at
  from public.workout_sessions ws
  where ws.id=new.session_id;

  if v_started_at is null
     or lower(coalesce(v_status,'')) not in ('in_progress','completed') then
    raise exception 'SESSION_LIFECYCLE: exercise execution requires a started session';
  end if;

  if lower(coalesce(new.block_key,''))='wod'
     and (v_wod_revealed_at is null or v_wod_started_at is null) then
    raise exception 'SESSION_LIFECYCLE: WOD execution requires WOD reveal and WOD start';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_session_exercise_execution_started_v1
on public.workout_session_exercises;

create trigger trg_enforce_session_exercise_execution_started_v1
before update of
  status,
  user_execution_status,
  execution_reason_code,
  reps_completed,
  weight_kg,
  duration_seconds,
  distance_meters,
  rpe,
  actual_attempts_json
on public.workout_session_exercises
for each row
execute function public.enforce_session_exercise_execution_started_v1();

create or replace function public.enforce_exercise_log_session_started_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_status text;
  v_started_at timestamptz;
  v_wod_revealed_at timestamptz;
  v_wod_started_at timestamptz;
  v_block_key text;
begin
  if new.session_id is null or coalesce(new.source_kind,'internal')<>'internal' then
    return new;
  end if;

  select
    ws.status,
    ws.started_at,
    ws.wod_revealed_at,
    ws.wod_started_at
  into
    v_status,
    v_started_at,
    v_wod_revealed_at,
    v_wod_started_at
  from public.workout_sessions ws
  where ws.id=new.session_id;

  if v_started_at is null
     or lower(coalesce(v_status,'')) not in ('in_progress','completed') then
    raise exception 'SESSION_LIFECYCLE: exercise log requires a started session';
  end if;

  select lower(coalesce(wse.block_key,''))
  into v_block_key
  from public.workout_session_exercises wse
  where wse.session_id=new.session_id
    and (
      (new.session_exercise_id is not null and wse.id=new.session_exercise_id)
      or
      (new.session_exercise_id is null and new.exercise_id is not null and wse.exercise_id=new.exercise_id)
    )
  order by
    case when new.session_exercise_id is not null and wse.id=new.session_exercise_id then 0 else 1 end,
    wse.position
  limit 1;

  if v_block_key='wod'
     and (v_wod_revealed_at is null or v_wod_started_at is null) then
    raise exception 'SESSION_LIFECYCLE: WOD exercise log requires WOD reveal and WOD start';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_exercise_log_session_started_v1
on public.exercise_logs;

create trigger trg_enforce_exercise_log_session_started_v1
before insert
on public.exercise_logs
for each row
execute function public.enforce_exercise_log_session_started_v1();
