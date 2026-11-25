create or replace function public.resolve_exercise_log_instance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session_user uuid;
  v_match_count int;
  v_match_id uuid;
  v_marker_text text;
  v_marker_id uuid;
  v_planned_prescription jsonb;
begin
  if new.session_id is null then
    return new;
  end if;

  select user_id into v_session_user
  from public.workout_sessions
  where id = new.session_id;

  if not found then
    raise exception 'Unknown workout session %', new.session_id;
  end if;

  if new.user_id <> v_session_user then
    raise exception 'exercise_logs user_id does not own session %', new.session_id;
  end if;

  -- B2.6.4 bridge: the compatibility Edge Function can carry the exact
  -- workout_session_exercises.id through the legacy notes field.  The marker is
  -- removed before persistence, so it never leaks into user-visible history.
  if new.session_exercise_id is null and new.notes is not null then
    v_marker_text := substring(
      new.notes from '\[\[UGEROD_INSTANCE:([0-9a-fA-F-]{36})\]\]'
    );

    if v_marker_text is not null then
      begin
        v_marker_id := v_marker_text::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid UGEROD session exercise marker';
      end;

      select wse.id, coalesce(wse.prescription_json, '{}'::jsonb)
      into v_match_id, v_planned_prescription
      from public.workout_session_exercises wse
      where wse.id = v_marker_id
        and wse.session_id = new.session_id
        and wse.exercise_id = new.exercise_id;

      if not found then
        raise exception 'UGEROD instance marker % does not match session/exercise', v_marker_id;
      end if;

      new.session_exercise_id := v_match_id;
      new.prescription_json := coalesce(v_planned_prescription, new.prescription_json, '{}'::jsonb);
      new.notes := nullif(
        btrim(
          regexp_replace(
            new.notes,
            '\[\[UGEROD_INSTANCE:[0-9a-fA-F-]{36}\]\]\s*',
            '',
            'g'
          )
        ),
        ''
      );
    end if;
  end if;

  if new.session_exercise_id is not null then
    select coalesce(wse.prescription_json, '{}'::jsonb)
    into v_planned_prescription
    from public.workout_session_exercises wse
    where wse.id = new.session_exercise_id
      and wse.session_id = new.session_id
      and wse.exercise_id = new.exercise_id;

    if not found then
      raise exception 'session_exercise_id % does not match session/exercise', new.session_exercise_id;
    end if;

    -- Exact planned prescription is part of the performance observation
    -- contract; never let a duplicate exercise inherit another instance's plan.
    new.prescription_json := coalesce(v_planned_prescription, new.prescription_json, '{}'::jsonb);
    return new;
  end if;

  select count(*), min(id)
  into v_match_count, v_match_id
  from public.workout_session_exercises
  where session_id = new.session_id
    and exercise_id = new.exercise_id;

  if v_match_count = 1 then
    new.session_exercise_id := v_match_id;
  elsif v_match_count = 0 then
    if coalesce(new.source_kind, 'internal') = 'internal' then
      raise exception 'No workout_session_exercise instance for session %, exercise %', new.session_id, new.exercise_id;
    end if;
  else
    raise exception 'Ambiguous exercise instance for session %, exercise %. Pass session_exercise_id explicitly.', new.session_id, new.exercise_id;
  end if;

  return new;
end;
$function$;;
