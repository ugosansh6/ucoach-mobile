-- PERF-004: targeted swap availability for HOME, BOX, GYM and OUTDOOR.
create or replace function public.get_workout_swap_availability_for_exercise_v1(
  p_session_exercise_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '8s'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_session record;
  r record;
  v_easy jsonb:=jsonb_build_object('status','NOT_AVAILABLE');
  v_equiv jsonb:=jsonb_build_object('status','NOT_AVAILABLE');
  v_hard jsonb:=jsonb_build_object('status','NOT_AVAILABLE');
  v_undo jsonb:=jsonb_build_object('status','NOT_AVAILABLE');
  v_history record;
  v_block_key text;
  v_effective_block_key text;
  v_any boolean:=false;
  v_manual_stack jsonb;
  v_manual_undo_id text;
  v_undo_name text;
  v_is_gym_strength boolean:=false;
  v_item jsonb;
begin
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select
    ws.id,ws.status,ws.wod_started_at,ws.wod_manual_swap_history_json,
    ws.planned_environment_code,wse.id as session_exercise_id,wse.block_key,
    wse.position,wse.exercise_id,wse.solver_decision_json
  into v_session
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id
  where wse.id=p_session_exercise_id and ws.user_id=v_user_id;

  if not found then raise exception 'Session exercise instance not found'; end if;

  r:=v_session;
  v_block_key:=case r.block_key when 'warm_up' then 'warmup' else r.block_key end;
  v_is_gym_strength:=
    upper(coalesce(v_session.planned_environment_code,''))='GYM'
    and upper(coalesce(r.solver_decision_json->>'module_code',''))='STRENGTH';
  v_effective_block_key:=case when v_is_gym_strength then 'strength' else v_block_key end;

  if v_session.status in ('generated','in_progress') and v_is_gym_strength then
    v_easy:=public.gym_strength_swap_candidate_v1(v_user_id,r.session_exercise_id,'easier','{}'::text[],null);
    v_equiv:=public.gym_strength_swap_candidate_v1(v_user_id,r.session_exercise_id,'equivalent','{}'::text[],null);
    v_hard:=public.gym_strength_swap_candidate_v1(v_user_id,r.session_exercise_id,'harder','{}'::text[],null);

    select h.*,coalesce(nullif(e.display_name,''),e.name) as from_name
    into v_history
    from public.workout_session_swap_history h
    join public.exercises e on e.id=h.from_exercise_id
    where h.user_id=v_user_id and h.session_id=v_session.id
      and h.session_exercise_id=r.session_exercise_id
      and h.undone_at is null and h.to_exercise_id=r.exercise_id
    order by h.id desc limit 1;

    if found then
      v_undo_name:=v_history.from_name;
      v_undo:=public.gym_strength_swap_candidate_v1(
        v_user_id,r.session_exercise_id,'undo','{}'::text[],v_history.from_exercise_id
      );
    end if;

  elsif v_session.status in ('generated','in_progress')
    and v_block_key in ('warmup','tabata','skill','wod') then

    if v_block_key='wod' then
      v_easy:=public.c4_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'easier','{}'::text[],null);
      v_equiv:=public.c4_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'equivalent','{}'::text[],null);
      v_hard:=public.c4_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'harder','{}'::text[],null);
    else
      v_easy:=public.c4_non_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'easier','{}'::text[],null);
      v_equiv:=public.c4_non_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'equivalent','{}'::text[],null);
      v_hard:=public.c4_non_wod_swap_candidate_v3(v_user_id,r.session_exercise_id,'harder','{}'::text[],null);
    end if;

    if v_block_key='wod' and v_session.wod_started_at is null then
      v_manual_stack:=coalesce(v_session.wod_manual_swap_history_json->(r.position::text),'[]'::jsonb);
      if jsonb_typeof(v_manual_stack)='array' and jsonb_array_length(v_manual_stack)>0 then
        v_manual_undo_id:=v_manual_stack->>(jsonb_array_length(v_manual_stack)-1);
      end if;
    end if;

    if v_manual_undo_id is not null then
      v_undo:=public.c4_wod_swap_candidate_v3(
        v_user_id,r.session_exercise_id,'undo','{}'::text[],v_manual_undo_id
      );
      select coalesce(nullif(e.display_name,''),e.name)
      into v_undo_name from public.exercises e where e.id=v_manual_undo_id;
    else
      select h.*,coalesce(nullif(e.display_name,''),e.name) as from_name
      into v_history
      from public.workout_session_swap_history h
      join public.exercises e on e.id=h.from_exercise_id
      where h.user_id=v_user_id and h.session_id=v_session.id
        and h.session_exercise_id=r.session_exercise_id
        and h.undone_at is null and h.to_exercise_id=r.exercise_id
      order by h.id desc limit 1;

      if found then
        v_undo_name:=v_history.from_name;
        if v_block_key='wod' then
          v_undo:=public.c4_wod_swap_candidate_v3(
            v_user_id,r.session_exercise_id,'undo','{}'::text[],v_history.from_exercise_id
          );
        else
          v_undo:=public.c4_non_wod_swap_candidate_v3(
            v_user_id,r.session_exercise_id,'undo','{}'::text[],v_history.from_exercise_id
          );
        end if;
      end if;
    end if;
  end if;

  v_any:=
    coalesce(v_easy->>'status','')='AVAILABLE'
    or coalesce(v_equiv->>'status','')='AVAILABLE'
    or coalesce(v_hard->>'status','')='AVAILABLE'
    or coalesce(v_undo->>'status','')='AVAILABLE';

  v_item:=jsonb_build_object(
    'available',v_any,
    'status',case when v_any then 'AVAILABLE' else 'NO_SAFE_SWAP' end,
    'block_key',v_effective_block_key,
    'exercise_id',r.exercise_id,
    'directions',jsonb_build_object(
      'easier',jsonb_build_object('available',coalesce(v_easy->>'status','')='AVAILABLE','candidate_exercise_id',v_easy->>'new_exercise_id'),
      'equivalent',jsonb_build_object('available',coalesce(v_equiv->>'status','')='AVAILABLE','candidate_exercise_id',v_equiv->>'new_exercise_id'),
      'harder',jsonb_build_object('available',coalesce(v_hard->>'status','')='AVAILABLE','candidate_exercise_id',v_hard->>'new_exercise_id')
    ),
    'can_undo',coalesce(v_undo->>'status','')='AVAILABLE',
    'undo_exercise_id',case when coalesce(v_undo->>'status','')='AVAILABLE' then v_undo->>'new_exercise_id' else null end,
    'undo_exercise_name',case when coalesce(v_undo->>'status','')='AVAILABLE' then v_undo_name else null end,
    'undo_survives_format_change',(not v_is_gym_strength) and v_block_key='wod'
      and v_session.wod_started_at is null and v_manual_undo_id is not null
  );

  return jsonb_build_object(
    'version','swap-availability-target-v1',
    'session_id',v_session.id,
    'session_exercise_id',r.session_exercise_id,
    'item',v_item,
    'items',jsonb_build_object(r.session_exercise_id::text,v_item)
  );
end;
$function$;

revoke all on function public.get_workout_swap_availability_for_exercise_v1(uuid) from public;
revoke all on function public.get_workout_swap_availability_for_exercise_v1(uuid) from anon;
grant execute on function public.get_workout_swap_availability_for_exercise_v1(uuid) to authenticated;
