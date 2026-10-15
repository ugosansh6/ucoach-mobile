create or replace function public.week_save_composer_draft_v1(
  p_user_id uuid,
  p_plan_item_id uuid,
  p_draft jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb := coalesce(p_draft, '{}'::jsonb);
  v_saved jsonb;
begin
  if p_user_id is null or p_plan_item_id is null then
    raise exception 'week_save_composer_draft_v1 requires user and plan item';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if jsonb_typeof(v_draft) <> 'object' then
    raise exception 'Composer draft must be a JSON object';
  end if;

  select * into v_item
  from public.user_training_plan_items
  where id = p_plan_item_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Week item not found' using errcode='P0002';
  end if;
  if v_item.status not in ('available','claimed') then
    raise exception 'This week item can no longer be composed';
  end if;
  if v_item.session_id is not null and exists (
    select 1 from public.workout_sessions ws
    where ws.id = v_item.session_id
      and ws.user_id = p_user_id
      and ws.status in ('in_progress','completed','abandoned')
  ) then
    raise exception 'This week item can no longer change its composer draft';
  end if;

  v_saved := v_draft || jsonb_build_object(
    'version','w11-composer-draft-v1',
    'saved_at',now(),
    'structure_stable',true,
    'dose_finalization_deferred',true
  );

  update public.user_training_plan_items
  set planning_context_json = jsonb_set(
        coalesce(planning_context_json,'{}'::jsonb),
        '{w11,composer_draft}',
        v_saved,
        true
      ),
      updated_at = now()
  where id = v_item.id;

  return jsonb_build_object(
    'contract_version','W11_COMPOSER_DRAFT_V1',
    'plan_item_id',v_item.id,
    'recommended_date',v_item.recommended_date,
    'composer_draft',v_saved,
    'semantics',jsonb_build_object(
      'structure_is_user_owned',true,
      'readiness_is_not_persisted_for_future',true,
      'pain_is_not_persisted_for_future',true,
      'dose_finalization_is_deferred',true
    )
  );
end;
$$;

grant execute on function public.week_save_composer_draft_v1(uuid,uuid,jsonb) to authenticated;
