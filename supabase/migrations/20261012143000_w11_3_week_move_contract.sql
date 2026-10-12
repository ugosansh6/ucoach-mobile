create or replace function public.week_move_plan_item_v1(
  p_user_id uuid,
  p_plan_item_id uuid,
  p_target_date date,
  p_anchor_date date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.user_training_plan_items%rowtype;
  v_session_status text;
  v_anchor_week_start date;
  v_anchor_week_end date;
  v_item_week_end date;
  v_date_is_soft boolean;
  v_previous_date date;
  v_collision_count integer := 0;
  v_changed boolean := false;
begin
  if p_user_id is null
     or p_plan_item_id is null
     or p_target_date is null
     or p_anchor_date is null then
    raise exception 'week_move_plan_item_v1 requires user, item, target date and anchor date';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not allowed to move another user''s week item'
      using errcode = '42501';
  end if;

  v_anchor_week_start := public.d_week_start(p_anchor_date);
  v_anchor_week_end := v_anchor_week_start + 6;

  select *
  into v_item
  from public.user_training_plan_items
  where id = p_plan_item_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Week item not found'
      using errcode = 'P0002';
  end if;

  if v_item.week_start is null then
    raise exception 'Week item has no week boundary';
  end if;

  v_item_week_end := v_item.week_start + 6;

  if v_item.week_start <> v_anchor_week_start
     or v_item_week_end <> v_anchor_week_end then
    raise exception 'Week item is outside the requested week';
  end if;

  if p_target_date < v_item.week_start
     or p_target_date > v_item_week_end then
    raise exception 'Target date must stay inside the same week';
  end if;

  v_date_is_soft := coalesce(
    (v_item.planning_context_json->>'recommended_date_is_soft')::boolean,
    true
  );

  if not v_date_is_soft then
    raise exception 'This item has a fixed date';
  end if;

  if v_item.status not in ('available', 'claimed') then
    raise exception 'This item can no longer be moved';
  end if;

  if v_item.session_id is not null then
    select ws.status
    into v_session_status
    from public.workout_sessions ws
    where ws.id = v_item.session_id;

    if v_session_status in ('in_progress', 'completed', 'abandoned') then
      raise exception 'This session can no longer be moved';
    end if;
  end if;

  v_previous_date := v_item.recommended_date;

  if v_previous_date is distinct from p_target_date then
    update public.user_training_plan_items
    set recommended_date = p_target_date,
        updated_at = now()
    where id = v_item.id;

    v_changed := true;
  end if;

  select count(*)::integer
  into v_collision_count
  from public.user_training_plan_items i
  where i.user_id = p_user_id
    and i.week_start = v_item.week_start
    and i.id <> v_item.id
    and i.recommended_date = p_target_date
    and i.status in ('available', 'claimed');

  return jsonb_build_object(
    'contract_version', 'W11.3',
    'plan_item_id', v_item.id,
    'previous_date', v_previous_date,
    'recommended_date', p_target_date,
    'week_start', v_item.week_start,
    'week_end', v_item_week_end,
    'changed', v_changed,
    'recommended_date_is_soft', true,
    'has_collision', v_collision_count > 0,
    'collision_count', v_collision_count,
    'collision_policy', 'ALLOW_AND_ADVISE',
    'user_debt_created', false,
    'content_mutated', false,
    'session_identity_mutated', false,
    'sequence_mutated', false,
    'refresh_with', 'week_read_contract_v1'
  );
end;
$$;

revoke all on function public.week_move_plan_item_v1(uuid, uuid, date, date) from public;
revoke all on function public.week_move_plan_item_v1(uuid, uuid, date, date) from anon;
grant execute on function public.week_move_plan_item_v1(uuid, uuid, date, date) to authenticated;
grant execute on function public.week_move_plan_item_v1(uuid, uuid, date, date) to service_role;

comment on function public.week_move_plan_item_v1(uuid, uuid, date, date) is
  'W11.3 soft-date write contract. Moves only the recommended date of an owned movable plan item inside its stored week. Collisions are allowed and surfaced for non-blocking Coach advice; no session debt, catch-up, content rewrite, session identity rewrite or sequence rewrite is created.';
