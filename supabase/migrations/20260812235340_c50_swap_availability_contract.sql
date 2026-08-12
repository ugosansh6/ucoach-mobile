create or replace function public.c4_wod_swap_candidate_preview(
  p_user_id uuid,
  p_session_exercise_id uuid,
  p_excluded_exercise_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  target record;
  ws record;
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;
  v_candidate jsonb;
  v_exercises jsonb;
  v_final jsonb;
  v_prepared jsonb;
  v_gate jsonb;
  v_wod_min int;
  v_max_complexity int;
  r record;
  v_pres jsonb;
  v_new_ex jsonb;
  v_tested int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select wse.*, e.movement_pattern old_pattern, e.exercise_family old_family, e.technical_complexity old_complexity
  into target
  from public.workout_session_exercises wse
  join public.workout_sessions s on s.id=wse.session_id
  join public.exercises e on e.id=wse.exercise_id
  where wse.id=p_session_exercise_id and s.user_id=p_user_id;

  if not found then
    raise exception 'Session exercise instance not found';
  end if;

  if target.block_key<>'wod' then
    return jsonb_build_object(
      'status','NOT_SUPPORTED',
      'reason','WOD_PREVIEW_REQUIRES_WOD_INSTANCE',
      'session_exercise_id',p_session_exercise_id,
      'mutated',false
    );
  end if;

  select * into ws
  from public.workout_sessions
  where id=target.session_id and user_id=p_user_id;

  if ws.status not in ('generated','in_progress') then
    return jsonb_build_object(
      'status','NOT_AVAILABLE',
      'reason','SESSION_NOT_MUTABLE',
      'session_exercise_id',p_session_exercise_id,
      'mutated',false
    );
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);
  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[])
    into v_names
    from public.user_equipment_inventory ui
    join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;
  if cardinality(v_names)=0 then v_names:=array['Aucun']; end if;

  v_inventory:=public.resolve_user_equipment_inventory(p_user_id,v_names,'c4-final-default');
  v_base:=public.c4_session_wod_candidate(target.session_id);
  v_wod_min:=coalesce(
    nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,
    nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (
      select nullif(b->>'duration_minutes','')::int
      from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
      where b->>'block_key'='wod'
      limit 1
    ),
    10
  );
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal')) when 'low' then 3 else 5 end;

  for r in
    select cp.*, ne.technical_complexity as new_complexity
    from public.c2_candidate_pool(
      p_user_id,
      coalesce(ws.focus,'General Fitness'),
      coalesce(ws.duration_minutes,45),
      coalesce(ws.readiness,'normal'),
      ws.target_region,
      ws.progression_intent,
      coalesce(ws.injured_zones,'{}'::text[]),
      v_inventory,
      'WOD',
      v_max_complexity,
      'Avancé',
      60
    ) cp
    join public.exercises ne on ne.id=cp.exercise_id
    where cp.exercise_id<>target.exercise_id
      and coalesce(ne.technical_complexity,99)<=coalesce(target.old_complexity,v_max_complexity)
      and not (cp.exercise_id=any(coalesce(p_excluded_exercise_ids,'{}'::text[])))
      and not exists(
        select 1
        from jsonb_array_elements(v_base->'exercises') x
        where x->>'exercise_id'=cp.exercise_id
      )
    order by
      case when cp.movement_pattern=target.old_pattern then 0 when cp.exercise_family=target.old_family then 1 else 2 end,
      cp.candidate_score desc,
      cp.exercise_id
  loop
    v_tested:=v_tested+1;
    exit when v_tested>25;

    v_pres:=public.c2_solver_prescription(
      p_user_id,
      r.exercise_id,
      ws.expected_stimulus_json,
      v_base->>'mechanic',
      ws.progression_intent,
      v_inventory
    );

    v_new_ex:=jsonb_build_object(
      'exercise_id',r.exercise_id,
      'name',r.exercise_name,
      'pattern',r.movement_pattern,
      'family',r.exercise_family,
      'candidate_score',r.candidate_score,
      'components',r.score_components,
      'prescription',v_pres
    );

    select coalesce(
      jsonb_agg(case when ord=target.position then v_new_ex else value end order by ord),
      '[]'::jsonb
    )
    into v_exercises
    from jsonb_array_elements(v_base->'exercises') with ordinality x(value,ord);

    v_candidate:=jsonb_set(v_base,'{exercises}',v_exercises,true);
    v_prepared:=public.c4_prepare_candidate(v_candidate,'c4-final-default');
    v_final:=public.c4_finalize_candidate(
      v_prepared,
      ws.expected_stimulus_json,
      coalesce(ws.duration_minutes,45),
      v_wod_min,
      'c4-final-default',
      'c3-sim-default'
    );
    v_gate:=public.c4_candidate_quality_gate_v2(
      v_final,
      coalesce(ws.readiness,'normal'),
      coalesce(ws.focus,'General Fitness'),
      ws.target_region,
      coalesce(ws.injured_zones,'{}'::text[]),
      v_inventory,
      v_max_complexity,
      'c4-final-default'
    );

    if coalesce((v_gate->>'pass')::boolean,false)
       and coalesce((v_final#>>'{c4_final,feasible}')::boolean,false) then
      return jsonb_build_object(
        'status','AVAILABLE',
        'mutated',false,
        'session_id',target.session_id,
        'session_exercise_id',p_session_exercise_id,
        'block_key','wod',
        'old_exercise_id',target.exercise_id,
        'new_exercise_id',r.exercise_id,
        'old_technical_complexity',target.old_complexity,
        'new_technical_complexity',r.new_complexity,
        'technical_complexity_non_increasing',coalesce(r.new_complexity,99)<=coalesce(target.old_complexity,v_max_complexity),
        'candidates_tested',v_tested
      );
    end if;
  end loop;

  return jsonb_build_object(
    'status','NO_SAFE_SWAP',
    'mutated',false,
    'session_exercise_id',p_session_exercise_id,
    'block_key','wod',
    'old_exercise_id',target.exercise_id,
    'old_technical_complexity',target.old_complexity,
    'candidates_tested',v_tested,
    'technical_complexity_must_not_increase',true
  );
end;
$function$;

create or replace function public.get_workout_swap_availability(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session record;
  r record;
  v_preview jsonb;
  v_items jsonb:='{}'::jsonb;
  v_block_key text;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select id,status
  into v_session
  from public.workout_sessions
  where id=p_session_id and user_id=v_user_id;

  if not found then
    raise exception 'Session not found';
  end if;

  for r in
    select id,block_key,position,exercise_id
    from public.workout_session_exercises
    where session_id=p_session_id
    order by
      case block_key when 'warm_up' then 1 when 'tabata' then 2 when 'skill' then 3 when 'wod' then 4 else 9 end,
      position
  loop
    v_block_key:=case r.block_key when 'warm_up' then 'warmup' else r.block_key end;

    if v_session.status not in ('generated','in_progress') then
      v_preview:=jsonb_build_object('status','NOT_AVAILABLE','reason','SESSION_NOT_MUTABLE');
    elsif v_block_key='wod' then
      v_preview:=public.c4_wod_swap_candidate_preview(v_user_id,r.id,'{}'::text[]);
    elsif v_block_key in ('warmup','tabata','skill') then
      v_preview:=public.c4_non_wod_swap_candidate(v_user_id,r.id,'{}'::text[]);
    else
      v_preview:=jsonb_build_object('status','NOT_SUPPORTED','reason','BLOCK_NOT_SUPPORTED');
    end if;

    v_status:=coalesce(v_preview->>'status','NOT_AVAILABLE');
    v_items:=v_items||jsonb_build_object(
      r.id::text,
      jsonb_build_object(
        'available',v_status='AVAILABLE',
        'status',v_status,
        'block_key',v_block_key,
        'exercise_id',r.exercise_id,
        'candidate_exercise_id',v_preview->>'new_exercise_id',
        'reason',v_preview->>'reason'
      )
    );
  end loop;

  return jsonb_build_object(
    'version','swap-availability-v1',
    'session_id',p_session_id,
    'items',v_items
  );
end;
$function$;

revoke all on function public.c4_wod_swap_candidate_preview(uuid,uuid,text[]) from public, anon, authenticated;
revoke all on function public.get_workout_swap_availability(uuid) from public, anon;
grant execute on function public.get_workout_swap_availability(uuid) to authenticated;
