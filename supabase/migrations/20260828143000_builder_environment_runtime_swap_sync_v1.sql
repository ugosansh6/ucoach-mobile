create or replace function public.sync_user_session_builder_runtime_swap_v1(
  p_session_exercise_id uuid,
  p_old_exercise_id text,
  p_substitute jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_ex record;
  v_module text;
  v_builder_block_id text;
  v_source text;
  v_old_count int := 0;
  v_new_count int := 0;
  v_blocks jsonb;
  v_safe_sub jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select wse.id, wse.session_id, wse.exercise_id, wse.prescription_json,
         wse.solver_decision_json, ws.user_id, ws.generated_workout
    into v_row
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id = wse.session_id
  where wse.id = p_session_exercise_id;

  if not found or v_row.user_id <> v_uid then
    raise exception 'Forbidden session exercise';
  end if;

  v_source := coalesce(v_row.solver_decision_json->>'source','');
  v_module := upper(coalesce(v_row.solver_decision_json->>'module_code',''));
  v_builder_block_id := v_row.solver_decision_json->>'builder_block_id';

  if v_source <> 'user_session_builder' or v_module not in ('GYM','TABATA','TABATA_ABS','SKILL') then
    return jsonb_build_object(
      'status','NOT_APPLIED',
      'reason_code','BUILDER_RUNTIME_SWAP_SYNC_NOT_REQUIRED',
      'session_exercise_id',p_session_exercise_id,
      'module_code',nullif(v_module,''),
      'version','builder-environment-runtime-swap-sync-v1'
    );
  end if;

  select id, name, movement_pattern, exercise_family, body_region, tracking_modes
    into v_ex
  from public.exercises
  where id = v_row.exercise_id;

  if not found then
    raise exception 'Replacement exercise not found';
  end if;

  with target_blocks as (
    select b
    from jsonb_array_elements(coalesce(v_row.generated_workout->'blocks','[]'::jsonb)) b
    where (v_builder_block_id is not null and b->>'builder_block_id' = v_builder_block_id)
       or upper(coalesce(b->>'module_code','')) = v_module
  )
  select
    coalesce(sum((select count(*) from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) e where e->>'exercise_id' = p_old_exercise_id)),0)::int,
    coalesce(sum((select count(*) from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) e where e->>'exercise_id' = v_row.exercise_id)),0)::int
  into v_old_count, v_new_count
  from target_blocks;

  if v_old_count = 0 then
    return jsonb_build_object(
      'status',case when v_new_count > 0 then 'ALREADY_SYNCED' else 'NOT_APPLIED' end,
      'reason_code',case when v_new_count > 0 then 'RUNTIME_ALREADY_CONTAINS_REPLACEMENT' else 'RUNTIME_EXERCISE_MATCH_NOT_FOUND' end,
      'session_exercise_id',p_session_exercise_id,
      'module_code',v_module,
      'new_exercise_id',v_row.exercise_id,
      'version','builder-environment-runtime-swap-sync-v1'
    );
  end if;

  v_safe_sub := jsonb_build_object(
    'id', v_ex.id,
    'exercise_id', v_ex.id,
    'name', v_ex.name,
    'pattern', v_ex.movement_pattern,
    'family', v_ex.exercise_family,
    'region', v_ex.body_region,
    'tracking_modes', coalesce(to_jsonb(v_ex.tracking_modes),'[]'::jsonb),
    'prescription', coalesce(v_row.prescription_json,'{}'::jsonb),
    'prescription_json', coalesce(v_row.prescription_json,'{}'::jsonb),
    'session_exercise_id', p_session_exercise_id
  );

  select coalesce(jsonb_agg(
    case
      when (v_builder_block_id is not null and b->>'builder_block_id' = v_builder_block_id)
        or upper(coalesce(b->>'module_code','')) = v_module
      then jsonb_set(
        b,
        '{exercises}',
        coalesce((
          select jsonb_agg(
            case
              when e->>'exercise_id' = p_old_exercise_id
              then e || v_safe_sub
              else e
            end
            order by ord
          )
          from jsonb_array_elements(coalesce(b->'exercises','[]'::jsonb)) with ordinality x(e,ord)
        ),'[]'::jsonb),
        true
      )
      else b
    end
    order by bord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_row.generated_workout->'blocks','[]'::jsonb)) with ordinality z(b,bord);

  update public.workout_sessions
  set generated_workout = jsonb_set(coalesce(generated_workout,'{}'::jsonb),'{blocks}',v_blocks,true),
      updated_at = now()
  where id = v_row.session_id and user_id = v_uid;

  return jsonb_build_object(
    'status','SYNCED',
    'session_id',v_row.session_id,
    'session_exercise_id',p_session_exercise_id,
    'module_code',v_module,
    'old_exercise_id',p_old_exercise_id,
    'new_exercise_id',v_row.exercise_id,
    'version','builder-environment-runtime-swap-sync-v1'
  );
end;
$$;

revoke all on function public.sync_user_session_builder_runtime_swap_v1(uuid,text,jsonb) from public, anon;
grant execute on function public.sync_user_session_builder_runtime_swap_v1(uuid,text,jsonb) to authenticated, service_role;
