-- W11 / Ma semaine
-- Allow a user to reserve an assisted session on an otherwise empty day.

create or replace function public.week_create_assisted_plan_item_v1(
  p_user_id uuid,
  p_recommended_date date,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_week_start date;
  v_sequence integer;
  v_item_id uuid;
  v_result jsonb;
begin
  if p_user_id is null or p_recommended_date is null then
    raise exception 'week_create_assisted_plan_item_v1 requires user and date';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;

  v_week_start := public.d_week_start(p_recommended_date);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'ugerod:week-edit:'||p_user_id::text||':'||v_week_start::text,
      0
    )
  );
  perform public.d_ensure_week_plan(p_user_id,p_recommended_date,false);

  select coalesce(max(sequence_index),0)+1
  into v_sequence
  from public.user_training_plan_items
  where user_id=p_user_id and week_start=v_week_start;

  insert into public.user_training_plan_items(
    user_id,
    sequence_index,
    recommended_date,
    status,
    week_start,
    planning_context_json
  ) values (
    p_user_id,
    v_sequence,
    p_recommended_date,
    'available',
    v_week_start,
    jsonb_build_object(
      'plan_version','w11-user-assisted-v1',
      'recommended_date_is_soft',true,
      'user_debt_created',false,
      'wod_pre_generated',false,
      'w11',jsonb_build_object(
        'provenance','USER_ASSISTED_SESSION',
        'creation_mode','ASSISTED'
      )
    )
  )
  returning id into v_item_id;

  v_result := public.week_update_plan_item_context_v1(
    p_user_id,
    v_item_id,
    coalesce(p_context,'{}'::jsonb)
  );

  return v_result || jsonb_build_object(
    'created',true,
    'sequence_index',v_sequence,
    'week_start',v_week_start,
    'week_end',v_week_start+6,
    'provenance','USER_ASSISTED_SESSION'
  );
end;
$function$;

grant execute on function public.week_create_assisted_plan_item_v1(uuid,date,jsonb) to authenticated;
