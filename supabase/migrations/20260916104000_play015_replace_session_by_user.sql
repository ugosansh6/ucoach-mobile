create or replace function public.replace_workout_session_by_user_v1(
  p_session_id uuid,
  p_allow_started boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_uid uuid := auth.uid();
  v_started boolean := false;
  v_released_plan_items int := 0;
begin
  if p_session_id is null then
    raise exception 'p_session_id is required';
  end if;

  select * into v_session
  from public.workout_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object(
      'status','NOT_FOUND',
      'session_id',p_session_id,
      'replaced',false,
      'version','replace-workout-session-by-user-v1'
    );
  end if;

  if v_uid is not null and v_session.user_id <> v_uid then
    raise exception 'Forbidden session';
  end if;

  if v_session.status in ('completed','abandoned') then
    return jsonb_build_object(
      'status','SESSION_NOT_REPLACEABLE',
      'session_id',p_session_id,
      'session_status',v_session.status,
      'replaced',false,
      'version','replace-workout-session-by-user-v1'
    );
  end if;

  v_started :=
    v_session.status = 'in_progress'
    or v_session.started_at is not null
    or v_session.started_local_date is not null
    or v_session.wod_started_at is not null;

  if v_started and not coalesce(p_allow_started,false) then
    return jsonb_build_object(
      'status','STARTED_SESSION_CONFIRM_REQUIRED',
      'session_id',p_session_id,
      'session_status',v_session.status,
      'started',true,
      'replaced',false,
      'version','replace-workout-session-by-user-v1'
    );
  end if;

  update public.workout_sessions
  set status = 'abandoned',
      planning_context_json = coalesce(planning_context_json,'{}'::jsonb) || jsonb_build_object(
        'lifecycle_disposition', case when v_started then 'REPLACED_AFTER_START' else 'REPLACED_BEFORE_START' end,
        'replacement_requested_at', now(),
        'replacement_requested_by_user', true,
        'progress_preserved_in_abandoned_session', v_started,
        'counts_as_completed_execution', false
      ),
      updated_at = now()
  where id = p_session_id;

  update public.user_training_plan_items i
  set status = case
        when i.week_start < public.d_week_start(current_date) then 'unrealized'
        else 'available'
      end,
      session_id = null,
      claimed_at = null,
      updated_at = now(),
      planning_context_json = coalesce(i.planning_context_json,'{}'::jsonb) || jsonb_build_object(
        'replacement_release', jsonb_build_object(
          'released_session_id', p_session_id,
          'released_at', now(),
          'reason', case when v_started then 'session_replaced_after_start' else 'session_replaced_before_start' end,
          'previous_session_started', v_started,
          'user_debt_created', false
        )
      )
  where i.user_id = v_session.user_id
    and i.session_id = p_session_id
    and i.status = 'claimed';
  get diagnostics v_released_plan_items = row_count;

  return jsonb_build_object(
    'status', case when v_started then 'REPLACED_AFTER_START' else 'REPLACED_BEFORE_START' end,
    'session_id', p_session_id,
    'previous_session_started', v_started,
    'replaced', true,
    'released_plan_items', v_released_plan_items,
    'progress_preserved_in_abandoned_session', v_started,
    'counts_as_completed_execution', false,
    'version','replace-workout-session-by-user-v1'
  );
end;
$function$;

grant execute on function public.replace_workout_session_by_user_v1(uuid, boolean) to authenticated;
