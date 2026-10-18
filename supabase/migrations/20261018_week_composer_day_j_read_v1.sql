-- W11 Composer → day-J preparation: read-only, user-scoped discovery.
-- This deliberately does not pretend that the deferred dose is a playable workout.
create or replace function public.week_read_composer_for_day_v1(
  p_user_id uuid,
  p_local_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item public.user_training_plan_items%rowtype;
  v_draft jsonb;
begin
  if p_user_id is null or p_local_date is null then
    raise exception 'User and local date required';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode = '42501';
  end if;
  select * into v_item
  from public.user_training_plan_items
  where user_id = p_user_id
    and recommended_date = p_local_date
    and jsonb_typeof(planning_context_json #> '{w11,composer_draft}') = 'object'
    and status in ('available','claimed')
  order by updated_at desc, id
  limit 1;
  if not found then
    return jsonb_build_object('found',false,'local_date',p_local_date);
  end if;
  v_draft := v_item.planning_context_json #> '{w11,composer_draft}';
  return jsonb_build_object(
    'found',true,
    'contract_version','W11_COMPOSER_DAY_J_READ_V1',
    'local_date',p_local_date,
    'plan_item_id',v_item.id,
    'session_id',v_item.session_id,
    'status',v_item.status,
    'composer_draft',v_draft,
    'future_context',coalesce(v_item.planning_context_json #> '{w11,future_context}','{}'::jsonb),
    'semantics',jsonb_build_object(
      'user_block_selection_is_stable',true,
      'day_j_readiness_and_pain_only',true,
      'dose_finalization_deferred',true,
      'read_does_not_materialize_workout',true
    )
  );
end;
$$;
revoke all on function public.week_read_composer_for_day_v1(uuid,date) from public;
grant execute on function public.week_read_composer_for_day_v1(uuid,date) to authenticated, service_role;
