create or replace function public.week_remove_plan_item_v1(
  p_user_id uuid,
  p_plan_item_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_session_status text;
  v_anchor_week_start date;
  v_anchor_week_end date;
  v_session_abandoned boolean := false;
begin
  if p_user_id is null or p_plan_item_id is null or p_anchor_date is null then
    raise exception 'week_remove_plan_item_v1 requires user, item and anchor date';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not allowed to remove another user''s week item' using errcode='42501';
  end if;

  v_anchor_week_start := public.d_week_start(p_anchor_date);
  v_anchor_week_end := v_anchor_week_start + 6;

  perform pg_advisory_xact_lock(
    hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_anchor_week_start::text,0)
  );

  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;

  if not found then
    raise exception 'Week item not found' using errcode='P0002';
  end if;

  if v_item.week_start <> v_anchor_week_start then
    raise exception 'Week item is outside the requested week';
  end if;

  if v_item.status not in ('available','claimed') then
    raise exception 'This item can no longer be removed';
  end if;

  if v_item.session_id is not null then
    select ws.status into v_session_status
    from public.workout_sessions ws
    where ws.id=v_item.session_id
    for update;

    if v_session_status in ('in_progress','completed') then
      raise exception 'This session can no longer be removed';
    end if;

    if v_session_status='generated' then
      update public.workout_sessions
      set status='abandoned', updated_at=now()
      where id=v_item.session_id;
      v_session_abandoned := true;
    end if;
  end if;

  update public.user_training_plan_items
  set status='skipped',
      planning_context_json = jsonb_set(
        jsonb_set(coalesce(planning_context_json,'{}'::jsonb), '{user_removed}', 'true'::jsonb, true),
        '{user_removed_at}', to_jsonb(now()::text), true
      ),
      updated_at=now()
  where id=v_item.id;

  return jsonb_build_object(
    'contract_version','W11_WEEK_REMOVE_V1',
    'plan_item_id',v_item.id,
    'recommended_date',v_item.recommended_date,
    'removed',true,
    'session_abandoned',v_session_abandoned,
    'user_debt_created',false,
    'content_deleted',false,
    'history_deleted',false,
    'refresh_with','week_read_contract_v2'
  );
end;
$function$;

grant execute on function public.week_remove_plan_item_v1(uuid,uuid,date) to authenticated;
