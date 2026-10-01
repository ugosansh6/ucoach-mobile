-- Common started-session adaptation contract for HOME / BOX / GYM / OUTDOOR.
-- Invariants:
--   * same session id
--   * already-realized progress is immutable
--   * no new session and no debt
--   * only remaining dose is recalculated
--   * no load in kg is invented

create or replace function public.ugerod_jsonb_numeric_v1(
  p_obj jsonb,
  p_key text
)
returns numeric
language sql
immutable
as $$
  select case
    when p_obj is null or p_key is null then null
    when jsonb_typeof(p_obj -> p_key) = 'number' then (p_obj ->> p_key)::numeric
    when coalesce(p_obj ->> p_key, '') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_obj ->> p_key)::numeric
    else null
  end;
$$;

create or replace function public.ugerod_adapt_fatigue_prescription_v2(
  p_environment text,
  p_block_key text,
  p_prescription jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_env text := upper(coalesce(nullif(trim(p_environment), ''), 'UNKNOWN'));
  v_block text := lower(coalesce(nullif(trim(p_block_key), ''), ''));
  v jsonb := coalesce(p_prescription, '{}'::jsonb);
  v_before jsonb := coalesce(p_prescription, '{}'::jsonb);
  v_params jsonb := case
    when jsonb_typeof(coalesce(p_prescription, '{}'::jsonb) -> 'block_parameters') = 'object'
      then coalesce(p_prescription, '{}'::jsonb) -> 'block_parameters'
    else '{}'::jsonb
  end;
  v_mechanic text := upper(coalesce(
    p_prescription ->> 'mechanic',
    p_prescription ->> 'block_mechanic',
    ''
  ));
  v_n numeric;
  v_new numeric;
  v_repeats numeric;
  v_work numeric;
  v_recovery numeric;
  v_duration_seconds numeric;
  v_changed boolean := false;
begin
  if v_block = 'warmup' then
    v_block := 'warm_up';
  end if;

  if v_env not in ('HOME', 'BOX', 'GYM', 'OUTDOOR') then
    return v;
  end if;

  -- Preparation / signature blocks are intentionally left alone. The fatigue
  -- action targets the actual training dose, not low-fatigue preparation.
  if v_env in ('HOME', 'BOX') and v_block not in ('skill', 'wod') then
    return v;
  end if;
  if v_env = 'GYM' and v_block not in ('skill', 'wod') then
    return v;
  end if;
  if v_env = 'OUTDOOR'
     and v_block not in ('conditioning', 'wod')
     and v_mechanic not like 'RUN_%' then
    return v;
  end if;

  -- HOME / BOX / GYM: reduce reps on the remaining work. Existing load fields
  -- are never created or modified; intensity is expressed through dose/RPE.
  if v_env in ('HOME', 'BOX', 'GYM')
     or (v_env = 'OUTDOOR' and v_mechanic not like 'RUN_%') then
    v_n := public.ugerod_jsonb_numeric_v1(v, 'execution_target_reps');
    if v_n is not null and v_n > 1 then
      v_new := greatest(1, floor(v_n * 0.80));
      if v_new < v_n then
        v := jsonb_set(v, '{execution_target_reps}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v, 'reps_max');
    if v_n is not null and v_n > 1 then
      v_new := greatest(1, floor(v_n * 0.85));
      if v_new < v_n then
        v := jsonb_set(v, '{reps_max}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v, 'reps_min');
    if v_n is not null and v_n > 1 then
      v_new := greatest(1, floor(v_n * 0.85));
      if v_new < v_n then
        v := jsonb_set(v, '{reps_min}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    -- Keep a coherent range if both bounds exist.
    if public.ugerod_jsonb_numeric_v1(v, 'reps_min') is not null
       and public.ugerod_jsonb_numeric_v1(v, 'reps_max') is not null
       and public.ugerod_jsonb_numeric_v1(v, 'reps_min') > public.ugerod_jsonb_numeric_v1(v, 'reps_max') then
      v := jsonb_set(
        v,
        '{reps_min}',
        to_jsonb(public.ugerod_jsonb_numeric_v1(v, 'reps_max')::int),
        true
      );
      v_changed := true;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v, 'sets');
    if v_n is not null and v_n > 2 then
      v := jsonb_set(v, '{sets}', to_jsonb((v_n - 1)::int), true);
      v_changed := true;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'sets');
    if v_n is not null and v_n > 2 then
      v_params := jsonb_set(v_params, '{sets}', to_jsonb((v_n - 1)::int), true);
      v_changed := true;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'cycles');
    if v_n is not null and v_n > 3 then
      v_params := jsonb_set(v_params, '{cycles}', to_jsonb((v_n - 1)::int), true);
      v_changed := true;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'rounds');
    if v_n is not null and v_n > 3 then
      v_params := jsonb_set(v_params, '{rounds}', to_jsonb((v_n - 1)::int), true);
      v_changed := true;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'target_reps');
    if v_n is not null and v_n > 1 then
      v_new := greatest(1, floor(v_n * 0.80));
      if v_new < v_n then
        v_params := jsonb_set(v_params, '{target_reps}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'rep_target');
    if v_n is not null and v_n > 1 then
      v_new := greatest(1, floor(v_n * 0.80));
      if v_new < v_n then
        v_params := jsonb_set(v_params, '{rep_target}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    -- For timed WODs, reduce actual work duration when the contract exposes a
    -- real duration. Do not shorten a time cap alone: that could make the task harder.
    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'duration_minutes');
    if v_n is not null and v_n > 8 then
      v_new := greatest(6, floor(v_n * 0.80));
      if v_new < v_n then
        v_params := jsonb_set(v_params, '{duration_minutes}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v, 'execution_target_duration_seconds');
    if v_n is not null and v_n > 300 then
      v_new := greatest(300, floor(v_n * 0.80));
      if v_new < v_n then
        v := jsonb_set(v, '{execution_target_duration_seconds}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;
  end if;

  -- OUTDOOR running keeps the same mechanic/place logic. The dose is reduced
  -- through repeats, duration or an already-existing distance target.
  if v_env = 'OUTDOOR' and v_mechanic like 'RUN_%' then
    v_repeats := public.ugerod_jsonb_numeric_v1(v_params, 'repeats');
    if v_repeats is not null and v_repeats > 2 then
      v_new := greatest(2, ceil(v_repeats * 0.80));
      if v_new < v_repeats then
        v_params := jsonb_set(v_params, '{repeats}', to_jsonb(v_new::int), true);
        v_changed := true;
        v_repeats := v_new;
      end if;
    end if;

    v_work := public.ugerod_jsonb_numeric_v1(v_params, 'work_seconds');
    v_recovery := public.ugerod_jsonb_numeric_v1(v_params, 'recovery_seconds');
    if v_repeats is not null and v_work is not null then
      v_duration_seconds := v_repeats * (v_work + coalesce(v_recovery, 0));
      if v_duration_seconds > 0 then
        v := jsonb_set(
          v,
          '{execution_target_duration_seconds}',
          to_jsonb(round(v_duration_seconds)::int),
          true
        );
        v_changed := true;
      end if;
    else
      v_n := public.ugerod_jsonb_numeric_v1(v, 'execution_target_duration_seconds');
      if v_n is not null and v_n > 600 then
        v_new := greatest(600, floor(v_n * 0.80));
        if v_new < v_n then
          v := jsonb_set(v, '{execution_target_duration_seconds}', to_jsonb(v_new::int), true);
          v_changed := true;
        end if;
      end if;

      v_n := public.ugerod_jsonb_numeric_v1(v_params, 'duration_seconds');
      if v_n is not null and v_n > 600 then
        v_new := greatest(600, floor(v_n * 0.80));
        if v_new < v_n then
          v_params := jsonb_set(v_params, '{duration_seconds}', to_jsonb(v_new::int), true);
          v_changed := true;
        end if;
      end if;

      v_n := public.ugerod_jsonb_numeric_v1(v_params, 'duration_minutes');
      if v_n is not null and v_n > 10 then
        v_new := greatest(10, floor(v_n * 0.80));
        if v_new < v_n then
          v_params := jsonb_set(v_params, '{duration_minutes}', to_jsonb(v_new::int), true);
          v_changed := true;
        end if;
      end if;
    end if;

    v_n := public.ugerod_jsonb_numeric_v1(v_params, 'distance_target_meters');
    if v_n is not null and v_n > 0 then
      v_new := greatest(100, floor(v_n * 0.80));
      if v_new < v_n then
        v_params := jsonb_set(v_params, '{distance_target_meters}', to_jsonb(v_new::int), true);
        v_changed := true;
      end if;
    end if;
  end if;

  -- RPE is a safe way to communicate lower intensity without inventing kg.
  v_n := public.ugerod_jsonb_numeric_v1(v, 'target_rpe_max');
  if v_n is not null and v_n > 6 then
    v_new := greatest(6, v_n - 1);
    if v_new < v_n then
      v := jsonb_set(v, '{target_rpe_max}', to_jsonb(v_new), true);
      v_changed := true;
    end if;
  end if;

  v_n := public.ugerod_jsonb_numeric_v1(v, 'target_rpe_min');
  if v_n is not null and v_n > 5 then
    v_new := greatest(5, v_n - 1);
    if v_new < v_n then
      v := jsonb_set(v, '{target_rpe_min}', to_jsonb(v_new), true);
      v_changed := true;
    end if;
  end if;

  if v_params <> '{}'::jsonb and v_params is distinct from coalesce(v_before -> 'block_parameters', '{}'::jsonb) then
    v := jsonb_set(v, '{block_parameters}', v_params, true);
  end if;

  if v_changed then
    v := v || jsonb_build_object(
      'started_session_adaptation',
      jsonb_build_object(
        'version', 'adapt-started-session-v2',
        'reason', 'MORE_FATIGUED',
        'environment', v_env,
        'dose_reduced', true,
        'load_kg_invented', false
      )
    );
  end if;

  return v;
end;
$$;

create or replace function public.ugerod_patch_generated_workout_prescription_v2(
  p_workout jsonb,
  p_session_exercise_id uuid,
  p_block_key text,
  p_position integer,
  p_prescription jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_workout jsonb := coalesce(p_workout, '{}'::jsonb);
  v_blocks jsonb := '[]'::jsonb;
  v_block jsonb;
  v_block_out jsonb;
  v_exercises jsonb;
  v_ex jsonb;
  v_ex_out jsonb;
  v_block_ord bigint;
  v_ex_ord bigint;
  v_matched boolean;
  v_norm_block text;
  v_params jsonb := case
    when jsonb_typeof(coalesce(p_prescription, '{}'::jsonb) -> 'block_parameters') = 'object'
      then coalesce(p_prescription, '{}'::jsonb) -> 'block_parameters'
    else '{}'::jsonb
  end;
  v_mj jsonb;
  v_rp jsonb;
  v_sc jsonb;
  v_duration numeric;
  v_structure text;
begin
  for v_block, v_block_ord in
    select value, ordinality
    from jsonb_array_elements(coalesce(v_workout -> 'blocks', '[]'::jsonb)) with ordinality
  loop
    v_block_out := v_block;
    v_exercises := '[]'::jsonb;
    v_matched := false;

    for v_ex, v_ex_ord in
      select value, ordinality
      from jsonb_array_elements(coalesce(v_block -> 'exercises', '[]'::jsonb)) with ordinality
    loop
      if coalesce(v_ex ->> 'session_exercise_id', '') = p_session_exercise_id::text
         or (
           coalesce(v_ex ->> 'session_exercise_id', '') = ''
           and lower(coalesce(v_block ->> 'block_key', '')) = lower(coalesce(p_block_key, ''))
           and v_ex_ord = p_position
         ) then
        v_ex_out := v_ex || jsonb_build_object(
          'prescription', p_prescription,
          'prescription_json', p_prescription
        );
        v_matched := true;
      else
        v_ex_out := v_ex;
      end if;

      v_exercises := v_exercises || jsonb_build_array(v_ex_out);
    end loop;

    if v_matched then
      v_block_out := jsonb_set(v_block_out, '{exercises}', v_exercises, true);
      v_norm_block := lower(coalesce(v_block_out ->> 'block_key', p_block_key, ''));

      if v_params <> '{}'::jsonb then
        v_mj := case
          when jsonb_typeof(v_block_out -> 'mechanic_json') = 'object'
            then v_block_out -> 'mechanic_json'
          else '{}'::jsonb
        end;
        v_mj := jsonb_set(v_mj, '{parameters}', v_params, true);

        v_duration := public.ugerod_jsonb_numeric_v1(p_prescription, 'execution_target_duration_seconds');
        if v_duration is not null and v_duration > 0 then
          v_mj := jsonb_set(v_mj, '{predicted_elapsed_seconds}', to_jsonb(round(v_duration)::int), true);
        end if;

        v_block_out := jsonb_set(v_block_out, '{mechanic_json}', v_mj, true);

        v_duration := public.ugerod_jsonb_numeric_v1(v_params, 'duration_minutes');
        if v_duration is null then
          v_duration := public.ugerod_jsonb_numeric_v1(p_prescription, 'execution_target_duration_seconds');
          if v_duration is not null then
            v_duration := ceil(v_duration / 60.0);
          end if;
        end if;
        if v_duration is not null and v_duration > 0 then
          v_block_out := jsonb_set(v_block_out, '{duration_minutes}', to_jsonb(v_duration::int), true);
        end if;
      end if;

      if v_norm_block = 'skill' then
        v_sc := case
          when jsonb_typeof(v_block_out -> 'skill_contract') = 'object'
            then v_block_out -> 'skill_contract'
          when jsonb_typeof(v_block_out -> 'skillContract') = 'object'
            then v_block_out -> 'skillContract'
          else '{}'::jsonb
        end;

        if public.ugerod_jsonb_numeric_v1(p_prescription, 'sets') is not null then
          v_sc := jsonb_set(
            v_sc,
            '{sets}',
            to_jsonb(public.ugerod_jsonb_numeric_v1(p_prescription, 'sets')::int),
            true
          );
        end if;
        v_sc := jsonb_set(
          v_sc,
          '{prescription_patch}',
          coalesce(v_sc -> 'prescription_patch', '{}'::jsonb) || p_prescription,
          true
        );
        v_block_out := jsonb_set(v_block_out, '{skill_contract}', v_sc, true);
        v_block_out := jsonb_set(v_block_out, '{skillContract}', v_sc, true);
      end if;

      if jsonb_typeof(v_block_out -> 'running_protocol') = 'object' and v_params <> '{}'::jsonb then
        v_rp := v_block_out -> 'running_protocol';
        v_rp := jsonb_set(v_rp, '{parameters}', v_params, true);
        v_duration := public.ugerod_jsonb_numeric_v1(p_prescription, 'execution_target_duration_seconds');
        if v_duration is not null and v_duration > 0 then
          v_rp := jsonb_set(v_rp, '{predicted_elapsed_seconds}', to_jsonb(round(v_duration)::int), true);
          v_rp := jsonb_set(v_rp, '{duration_minutes}', to_jsonb(ceil(v_duration / 60.0)::int), true);
          v_block_out := jsonb_set(v_block_out, '{duration_minutes}', to_jsonb(ceil(v_duration / 60.0)::int), true);
        end if;
        v_block_out := jsonb_set(v_block_out, '{running_protocol}', v_rp, true);
      end if;

      if v_norm_block = 'wod' then
        begin
          v_structure := public.c4_wod_structure_v1(
            coalesce(v_block_out ->> 'mechanic', p_prescription ->> 'mechanic'),
            coalesce(v_block_out -> 'mechanic_json', '{}'::jsonb),
            coalesce(
              nullif(v_block_out ->> 'duration_minutes', '')::int,
              nullif((v_block_out -> 'mechanic_json') ->> 'wod_budget_minutes', '')::int,
              10
            )
          );
          if v_structure is not null and trim(v_structure) <> '' then
            v_block_out := jsonb_set(v_block_out, '{structure}', to_jsonb(v_structure), true);
          end if;
        exception when others then
          null;
        end;
      end if;
    end if;

    v_blocks := v_blocks || jsonb_build_array(v_block_out);
  end loop;

  return jsonb_set(v_workout, '{blocks}', v_blocks, true);
end;
$$;

create or replace function public.adapt_started_session_v2(
  p_session_id uuid,
  p_reason text,
  p_protected_progress jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.workout_sessions%rowtype;
  v_environment text;
  v_reason text := upper(replace(coalesce(trim(p_reason), ''), ' ', '_'));
  v_protected uuid[] := '{}'::uuid[];
  v_validated_blocks text[] := '{}'::text[];
  v_candidate text;
  v_id uuid;
  v_variant jsonb := '{}'::jsonb;
  v_variant_count int := 0;
  v_dose_count int := 0;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb;
  v_after jsonb;
  v_workout jsonb;
  v_mechanic text;
  v_block text;
  r record;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select *
  into v_session
  from public.workout_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'SESSION_NOT_FOUND',
      'version', 'adapt-started-session-v2',
      'session_id', p_session_id,
      'mutated', false
    );
  end if;

  if v_session.user_id <> v_user_id then
    raise exception 'Forbidden user';
  end if;

  if v_session.status <> 'in_progress' or v_session.started_at is null then
    return jsonb_build_object(
      'status', 'SESSION_NOT_ADAPTABLE',
      'version', 'adapt-started-session-v2',
      'session_id', p_session_id,
      'reason', 'SESSION_NOT_IN_PROGRESS',
      'mutated', false
    );
  end if;

  if v_reason not in ('MORE_FATIGUED', 'PLUS_FATIGUE', 'FATIGUE', 'TOO_TIRED') then
    return jsonb_build_object(
      'status', 'UNSUPPORTED_REASON',
      'version', 'adapt-started-session-v2',
      'session_id', p_session_id,
      'reason', p_reason,
      'mutated', false
    );
  end if;

  v_environment := public.normalize_session_environment_v1(
    coalesce(
      v_session.planned_environment_code,
      v_session.generated_workout #>> '{meta,environment_code}',
      'HOME'
    )
  );
  if v_environment = 'UNKNOWN' then
    v_environment := 'HOME';
  end if;

  -- Front-provided progress is advisory; backend execution state remains authoritative.
  if jsonb_typeof(coalesce(p_protected_progress -> 'session_exercise_ids', '[]'::jsonb)) = 'array' then
    for v_candidate in
      select value
      from jsonb_array_elements_text(coalesce(p_protected_progress -> 'session_exercise_ids', '[]'::jsonb))
    loop
      begin
        v_id := v_candidate::uuid;
        if exists (
          select 1 from public.workout_session_exercises
          where id = v_id and session_id = p_session_id
        ) and not (v_id = any(v_protected)) then
          v_protected := array_append(v_protected, v_id);
        end if;
      exception when others then
        null;
      end;
    end loop;
  end if;

  begin
    v_id := nullif(p_protected_progress ->> 'active_session_exercise_id', '')::uuid;
    if v_id is not null
       and exists (select 1 from public.workout_session_exercises where id = v_id and session_id = p_session_id)
       and not (v_id = any(v_protected)) then
      v_protected := array_append(v_protected, v_id);
    end if;
  exception when others then
    null;
  end;

  if jsonb_typeof(coalesce(p_protected_progress -> 'validated_blocks', '[]'::jsonb)) = 'array' then
    select coalesce(array_agg(
      case lower(value)
        when 'warmup' then 'warm_up'
        else lower(value)
      end
    ), '{}'::text[])
    into v_validated_blocks
    from jsonb_array_elements_text(coalesce(p_protected_progress -> 'validated_blocks', '[]'::jsonb));
  end if;

  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
  into v_protected
  from (
    select unnest(v_protected) id
    union all
    select wse.id
    from public.workout_session_exercises wse
    where wse.session_id = p_session_id
      and (
        lower(coalesce(wse.block_key, '')) = any(v_validated_blocks)
        or coalesce(wse.user_execution_status, 'pending') <> 'pending'
        or coalesce(wse.status, 'pending') <> 'pending'
        or wse.reps_completed is not null
        or wse.weight_kg is not null
        or wse.duration_seconds is not null
        or wse.distance_meters is not null
        or wse.rpe is not null
        or (
          wse.actual_attempts_json is not null
          and wse.actual_attempts_json <> '{}'::jsonb
          and wse.actual_attempts_json <> '[]'::jsonb
        )
      )
    union all
    select wse.id
    from public.workout_session_exercises wse
    where wse.session_id = p_session_id
      and v_session.wod_started_at is not null
      and wse.block_key = 'wod'
  ) x;

  -- HOME / BOX may use an already-safe easier adjacent variant, but only on
  -- remaining Skill/WOD instances. GYM and OUTDOOR preserve exercise identity.
  if v_environment in ('HOME', 'BOX') then
    v_variant := public.d_adapt_started_session_fatigue_v1(
      v_user_id,
      p_session_id,
      v_protected
    );
    v_variant_count := coalesce(nullif(v_variant ->> 'applied_count', '')::int, 0);
  end if;

  select generated_workout
  into v_workout
  from public.workout_sessions
  where id = p_session_id;

  for r in
    select
      wse.id,
      wse.block_key,
      wse.position,
      wse.exercise_id,
      wse.exercise_name,
      coalesce(wse.prescription_json, '{}'::jsonb) as prescription_json
    from public.workout_session_exercises wse
    where wse.session_id = p_session_id
      and not (wse.id = any(v_protected))
    order by
      case wse.block_key
        when 'skill' then 1
        when 'conditioning' then 2
        when 'wod' then 3
        else 9
      end,
      wse.position,
      wse.id
  loop
    v_block := lower(coalesce(r.block_key, ''));
    v_mechanic := upper(coalesce(
      r.prescription_json ->> 'mechanic',
      r.prescription_json ->> 'block_mechanic',
      ''
    ));

    if v_environment in ('HOME', 'BOX') and v_block not in ('skill', 'wod') then
      continue;
    end if;
    if v_environment = 'GYM' and v_block not in ('skill', 'wod') then
      continue;
    end if;
    if v_environment = 'OUTDOOR'
       and v_block not in ('conditioning', 'wod')
       and v_mechanic not like 'RUN_%' then
      continue;
    end if;

    v_before := r.prescription_json;
    v_after := public.ugerod_adapt_fatigue_prescription_v2(
      v_environment,
      r.block_key,
      r.prescription_json
    );

    if v_after is distinct from v_before then
      update public.workout_session_exercises
      set prescription_json = v_after,
          prescription = public.c4_prescription_text(v_after),
          expected_rpe_min = nullif(v_after ->> 'target_rpe_min', '')::numeric,
          expected_rpe_max = nullif(v_after ->> 'target_rpe_max', '')::numeric,
          solver_decision_json = coalesce(solver_decision_json, '{}'::jsonb) || jsonb_build_object(
            'started_session_adaptation',
            jsonb_build_object(
              'version', 'adapt-started-session-v2',
              'reason', 'MORE_FATIGUED',
              'environment', v_environment,
              'dose_reduced', true,
              'progress_protected', true,
              'load_kg_invented', false,
              'adapted_at', now()
            )
          ),
          updated_at = now()
      where id = r.id and session_id = p_session_id;

      v_workout := public.ugerod_patch_generated_workout_prescription_v2(
        v_workout,
        r.id,
        r.block_key,
        r.position,
        v_after
      );

      if r.block_key = 'wod' and jsonb_typeof(v_after -> 'block_parameters') = 'object' then
        update public.workout_sessions
        set mechanic_json = jsonb_set(
          coalesce(mechanic_json, '{}'::jsonb),
          '{parameters}',
          v_after -> 'block_parameters',
          true
        )
        where id = p_session_id and user_id = v_user_id;
      end if;

      v_dose_count := v_dose_count + 1;
      v_changed := v_changed || jsonb_build_array(jsonb_build_object(
        'session_exercise_id', r.id,
        'block_key', r.block_key,
        'exercise_id', r.exercise_id,
        'mechanic', nullif(v_mechanic, ''),
        'dose_reduced', true,
        'exercise_changed', false,
        'load_kg_changed', false
      ));
    end if;
  end loop;

  update public.workout_sessions
  set readiness = 'low',
      generated_workout = coalesce(v_workout, generated_workout),
      planning_context_json = coalesce(planning_context_json, '{}'::jsonb) || jsonb_build_object(
        'last_global_adaptation',
        jsonb_build_object(
          'version', 'adapt-started-session-v2',
          'reason', 'MORE_FATIGUED',
          'environment', v_environment,
          'same_session', true,
          'new_session_created', false,
          'debt_created', false,
          'protected_progress_preserved', true,
          'protected_session_exercise_ids', to_jsonb(v_protected),
          'easier_variant_count', v_variant_count,
          'dose_reduced_count', v_dose_count,
          'load_kg_invented', false,
          'adapted_at', now()
        )
      ),
      updated_at = now()
  where id = p_session_id and user_id = v_user_id and status = 'in_progress';

  begin
    perform public.d_sync_session_stimulus_ledger(p_session_id);
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'status', case
      when v_variant_count + v_dose_count > 0 then 'ADAPTED'
      else 'NO_SAFE_CHANGE'
    end,
    'version', 'adapt-started-session-v2',
    'session_id', p_session_id,
    'environment', v_environment,
    'reason', 'MORE_FATIGUED',
    'mutated', (v_variant_count + v_dose_count > 0),
    'same_session', true,
    'new_session_created', false,
    'debt_created', false,
    'protected_progress_preserved', true,
    'protected_session_exercise_ids', to_jsonb(v_protected),
    'easier_variant_count', v_variant_count,
    'dose_reduced_count', v_dose_count,
    'load_kg_invented', false,
    'focus_preserved', true,
    'terrain_preserved', v_environment = 'OUTDOOR',
    'variant_adaptation', case when v_environment in ('HOME', 'BOX') then v_variant else null end,
    'changed_exercises', v_changed,
    'message', case
      when v_variant_count + v_dose_count > 0
        then 'Les blocs restants ont été allégés sans toucher à ce qui est déjà réalisé.'
      else 'Aucune modification sûre supplémentaire n’est disponible pour les blocs restants.'
    end,
    'generated_workout', coalesce(v_workout, v_session.generated_workout)
  );
end;
$$;

revoke all on function public.adapt_started_session_v2(uuid, text, jsonb) from public;
grant execute on function public.adapt_started_session_v2(uuid, text, jsonb) to authenticated;
