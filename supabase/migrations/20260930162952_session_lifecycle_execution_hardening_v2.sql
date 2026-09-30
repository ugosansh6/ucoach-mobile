-- UGEROD session lifecycle contract
-- Canonical order:
-- generated -> in_progress -> WOD revealed -> WOD started -> completed
-- This migration is intentionally self-contained so STAGING/PROD do not depend
-- on DEV-only historical migrations that are not yet synchronized to Git.

create or replace function public.mark_wod_revealed(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
  v_anchor jsonb;
  v_unlimited boolean:=false;
  v_effective_count int:=0;
  v_locked boolean:=false;
  v_remaining int:=0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select *
  into v_session
  from public.workout_sessions
  where id=p_session_id
    and user_id=v_user
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status in ('completed','abandoned') then
    return jsonb_build_object(
      'status','NOT_REVEALABLE',
      'reason','SESSION_CLOSED',
      'session_id',p_session_id,
      'session_status',v_session.status
    );
  end if;

  if v_session.status<>'in_progress' or v_session.started_at is null then
    return jsonb_build_object(
      'status','SESSION_NOT_STARTED',
      'reason','EXPLICIT_SESSION_START_REQUIRED',
      'session_id',p_session_id,
      'session_status',v_session.status,
      'wod_revealed',false,
      'mutated',false,
      'lifecycle_contract','generated->in_progress->wod_revealed->wod_started'
    );
  end if;

  if jsonb_typeof(v_session.wod_format_anchor_json)<>'object'
     or v_session.wod_format_anchor_json='{}'::jsonb
     or jsonb_array_length(coalesce(v_session.wod_format_anchor_json->'exercises','[]'::jsonb))=0 then
    v_anchor:=public.c4_session_wod_candidate(p_session_id);
  else
    v_anchor:=v_session.wod_format_anchor_json;
  end if;

  update public.workout_sessions
  set wod_revealed_at=coalesce(wod_revealed_at,now()),
      wod_format_anchor_json=coalesce(v_anchor,'{}'::jsonb),
      updated_at=now()
  where id=p_session_id and user_id=v_user
  returning * into v_session;

  v_unlimited:=public.c4_user_unlimited_format_changes_v1(v_user);
  v_effective_count:=case when v_unlimited then 0 else coalesce(v_session.format_change_count,0) end;
  v_locked:=v_session.wod_started_at is not null or (not v_unlimited and v_effective_count>=3);
  v_remaining:=case
    when v_session.wod_started_at is not null then 0
    when v_unlimited then 3
    else greatest(0,3-v_effective_count)
  end;

  return jsonb_build_object(
    'status','WOD_REVEALED',
    'session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,
    'wod_started_at',v_session.wod_started_at,
    'format_change_count',v_effective_count,
    'format_change_limit',3,
    'remaining_format_changes',v_remaining,
    'format_change_unlimited',v_unlimited,
    'format_locked',v_locked,
    'format_lock_reason',case
      when v_session.wod_started_at is not null then 'WOD_ALREADY_STARTED'
      when not v_unlimited and v_effective_count>=3 then 'FORMAT_CHANGE_LIMIT_REACHED'
      else null
    end,
    'format_lock_contract','LOCK_ON_WOD_START_NOT_REVEAL',
    'format_anchor_frozen',true,
    'lifecycle_contract','generated->in_progress->wod_revealed->wod_started'
  );
end;
$function$;

create or replace function public.mark_wod_started(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid:=auth.uid();
  v_session public.workout_sessions%rowtype;
  v_anchor jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user
  for update;

  if not found then raise exception 'Session not found'; end if;

  if v_session.status in ('completed','abandoned') then
    return jsonb_build_object(
      'status','NOT_STARTABLE','reason','SESSION_CLOSED',
      'session_id',p_session_id,'session_status',v_session.status
    );
  end if;

  if v_session.status<>'in_progress' or v_session.started_at is null then
    return jsonb_build_object(
      'status','SESSION_NOT_STARTED','reason','EXPLICIT_SESSION_START_REQUIRED',
      'session_id',p_session_id,'session_status',v_session.status,
      'wod_started',false,'mutated',false,
      'lifecycle_contract','generated->in_progress->wod_revealed->wod_started'
    );
  end if;

  if v_session.wod_revealed_at is null then
    return jsonb_build_object(
      'status','WOD_NOT_REVEALED','reason','EXPLICIT_WOD_REVEAL_REQUIRED',
      'session_id',p_session_id,'session_status',v_session.status,
      'wod_started',false,'mutated',false,
      'lifecycle_contract','generated->in_progress->wod_revealed->wod_started'
    );
  end if;

  if jsonb_typeof(v_session.wod_format_anchor_json)<>'object'
     or v_session.wod_format_anchor_json='{}'::jsonb
     or jsonb_array_length(coalesce(v_session.wod_format_anchor_json->'exercises','[]'::jsonb))=0 then
    v_anchor:=public.c4_session_wod_candidate(p_session_id);
  else
    v_anchor:=v_session.wod_format_anchor_json;
  end if;

  update public.workout_sessions
  set wod_started_at=coalesce(wod_started_at,now()),
      wod_format_anchor_json=coalesce(v_anchor,'{}'::jsonb),
      updated_at=now()
  where id=p_session_id and user_id=v_user
  returning * into v_session;

  return jsonb_build_object(
    'status','WOD_STARTED','session_id',p_session_id,
    'wod_revealed_at',v_session.wod_revealed_at,
    'wod_started_at',v_session.wod_started_at,
    'format_change_count',v_session.format_change_count,
    'format_change_limit',3,'remaining_format_changes',0,
    'format_locked',true,'format_anchor_frozen',true,
    'lifecycle_contract','generated->in_progress->wod_revealed->wod_started'
  );
end;
$function$;

create or replace function public.enforce_workout_session_lifecycle_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_has_wod boolean:=false;
begin
  if new.status='in_progress' and new.started_at is null then
    raise exception 'SESSION_LIFECYCLE: in_progress requires started_at';
  end if;

  if old.wod_revealed_at is null and new.wod_revealed_at is not null then
    if new.status<>'in_progress' or new.started_at is null then
      raise exception 'SESSION_LIFECYCLE: WOD reveal requires a started session';
    end if;
  end if;

  if old.wod_started_at is null and new.wod_started_at is not null then
    if new.status<>'in_progress' or new.started_at is null then
      raise exception 'SESSION_LIFECYCLE: WOD start requires a started session';
    end if;
    if old.wod_revealed_at is null then
      raise exception 'SESSION_LIFECYCLE: WOD must be revealed before WOD start';
    end if;
  end if;

  if old.status<>'completed' and new.status='completed' then
    if old.status<>'in_progress' or old.started_at is null then
      raise exception 'SESSION_LIFECYCLE: completion requires a started session';
    end if;

    select exists(
      select 1
      from public.workout_session_exercises wse
      where wse.session_id=old.id
        and lower(coalesce(wse.block_key,''))='wod'
    ) into v_has_wod;

    if v_has_wod
       and (old.wod_revealed_at is null or old.wod_started_at is null) then
      raise exception 'SESSION_LIFECYCLE: WOD session cannot complete before WOD start';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_workout_session_lifecycle_v1
on public.workout_sessions;

create trigger trg_enforce_workout_session_lifecycle_v1
before update on public.workout_sessions
for each row
execute function public.enforce_workout_session_lifecycle_v1();

create or replace function public.enforce_session_exercise_execution_started_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
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
before update on public.workout_session_exercises
for each row
execute function public.enforce_session_exercise_execution_started_v1();

create or replace function public.enforce_exercise_log_session_started_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
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
before insert on public.exercise_logs
for each row
execute function public.enforce_exercise_log_session_started_v1();
