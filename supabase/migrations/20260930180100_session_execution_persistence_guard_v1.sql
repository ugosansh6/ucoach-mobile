-- SESSION EXECUTION PERSISTENCE GUARD V1
-- Execution actuals/logs require an officially started session.

create or replace function public.enforce_session_exercise_execution_started_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_status text;
  v_started_at timestamptz;
  v_execution_changed boolean:=false;
begin
  v_execution_changed:=
    (
      new.user_execution_status is distinct from old.user_execution_status
      and lower(coalesce(new.user_execution_status,'pending'))<>'pending'
    )
    or new.reps_completed is distinct from old.reps_completed
    or new.weight_kg is distinct from old.weight_kg
    or new.duration_seconds is distinct from old.duration_seconds
    or new.distance_meters is distinct from old.distance_meters
    or new.rpe is distinct from old.rpe;

  if not v_execution_changed then
    return new;
  end if;

  select ws.status,ws.started_at
  into v_status,v_started_at
  from public.workout_sessions ws
  where ws.id=new.session_id;

  if v_started_at is null
     or lower(coalesce(v_status,'')) not in ('in_progress','completed') then
    raise exception 'SESSION_LIFECYCLE: exercise execution requires a started session';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_session_exercise_execution_started_v1
on public.workout_session_exercises;

create trigger trg_enforce_session_exercise_execution_started_v1
before update of
  user_execution_status,
  reps_completed,
  weight_kg,
  duration_seconds,
  distance_meters,
  rpe
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
begin
  if new.session_id is null or coalesce(new.source_kind,'internal')<>'internal' then
    return new;
  end if;

  select ws.status,ws.started_at
  into v_status,v_started_at
  from public.workout_sessions ws
  where ws.id=new.session_id;

  if v_started_at is null
     or lower(coalesce(v_status,'')) not in ('in_progress','completed') then
    raise exception 'SESSION_LIFECYCLE: exercise log requires a started session';
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
