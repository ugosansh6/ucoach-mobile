-- Ensure context persists even on an initial coach slot without a w11 object.
CREATE OR REPLACE FUNCTION public.week_update_plan_item_context_v1(p_user_id uuid, p_plan_item_id uuid, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item public.user_training_plan_items%rowtype;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_future jsonb;
  v_duration integer;
  v_environment text;
  v_equipment jsonb;
  v_surface text;
  v_place text;
  v_region text;
  v_forbidden_key text;
begin
  if p_user_id is null or p_plan_item_id is null then
    raise exception 'week_update_plan_item_context_v1 requires user and plan item';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'Context must be a JSON object';
  end if;

  select key into v_forbidden_key
  from jsonb_object_keys(v_context) as key
  where key not in (
    'duration_minutes',
    'environment_code',
    'equipment',
    'surface_code',
    'outdoor_place_code',
    'target_region'
  )
  limit 1;
  if v_forbidden_key is not null then
    raise exception 'Unsupported future context field: %', v_forbidden_key;
  end if;

  select * into v_item
  from public.user_training_plan_items
  where id=p_plan_item_id and user_id=p_user_id
  for update;
  if not found then
    raise exception 'Week item not found' using errcode='P0002';
  end if;

  if v_item.status not in ('available','claimed') then
    raise exception 'This week item can no longer be prepared';
  end if;

  if v_item.session_id is not null and exists (
    select 1 from public.workout_sessions ws
    where ws.id=v_item.session_id
      and ws.user_id=p_user_id
      and ws.status in ('in_progress','completed','abandoned')
  ) then
    raise exception 'This week item can no longer change its planned context';
  end if;

  if v_context ? 'duration_minutes' then
    if v_context->'duration_minutes' = 'null'::jsonb then
      v_duration := null;
    else
      v_duration := (v_context->>'duration_minutes')::integer;
      if v_duration not between 20 and 90 then
        raise exception 'duration_minutes must be between 20 and 90';
      end if;
    end if;
  else
    v_duration := coalesce(
      nullif(v_item.planning_context_json#>>'{w11,future_context,duration_minutes}','')::integer,
      v_item.planned_duration_minutes
    );
  end if;

  if v_context ? 'environment_code' then
    if v_context->'environment_code' = 'null'::jsonb then
      v_environment := null;
    else
      v_environment := public.normalize_session_environment_v1(v_context->>'environment_code');
      if v_environment not in ('HOME','BOX','GYM','OUTDOOR') then
        raise exception 'Unsupported environment_code';
      end if;
    end if;
  else
    v_environment := nullif(v_item.planning_context_json#>>'{w11,future_context,environment_code}','');
  end if;

  if v_context ? 'equipment' then
    v_equipment := coalesce(v_context->'equipment','[]'::jsonb);
    if jsonb_typeof(v_equipment) <> 'array' then
      raise exception 'equipment must be an array';
    end if;
    if jsonb_array_length(v_equipment) > 50 then
      raise exception 'equipment contains too many values';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_equipment) e
      where jsonb_typeof(e) <> 'string'
    ) then
      raise exception 'equipment values must be strings';
    end if;
  else
    v_equipment := coalesce(v_item.planning_context_json#>'{w11,future_context,equipment}','[]'::jsonb);
  end if;

  if v_context ? 'surface_code' then
    if v_context->'surface_code' = 'null'::jsonb then
      v_surface := null;
    else
      v_surface := public.normalize_session_surface_v1(v_context->>'surface_code');
      if v_surface is null then raise exception 'Unsupported surface_code'; end if;
    end if;
  else
    v_surface := nullif(v_item.planning_context_json#>>'{w11,future_context,surface_code}','');
  end if;

  if v_context ? 'outdoor_place_code' then
    v_place := nullif(trim(v_context->>'outdoor_place_code'),'');
  else
    v_place := nullif(v_item.planning_context_json#>>'{w11,future_context,outdoor_place_code}','');
  end if;

  if v_context ? 'target_region' then
    v_region := nullif(trim(v_context->>'target_region'),'');
    if v_region is not null and v_region not in ('Upper','Lower','Core','Full Body') then
      raise exception 'Unsupported target_region';
    end if;
  else
    v_region := nullif(v_item.planning_context_json#>>'{w11,future_context,target_region}','');
  end if;

  v_future := jsonb_strip_nulls(jsonb_build_object(
    'version','w11-future-context-v1',
    'duration_minutes',v_duration,
    'environment_code',v_environment,
    'equipment',coalesce(v_equipment,'[]'::jsonb),
    'surface_code',v_surface,
    'outdoor_place_code',v_place,
    'target_region',v_region,
    'source','USER_PLANNED_CONTEXT',
    'updated_at',now()
  ));

  update public.user_training_plan_items
  set planned_duration_minutes=coalesce(v_duration,planned_duration_minutes),
      planning_context_json=jsonb_set(
        coalesce(planning_context_json,'{}'::jsonb),
        '{w11}',
        coalesce(planning_context_json->'w11','{}'::jsonb) || jsonb_build_object('future_context',v_future),
        true
      ),
      updated_at=now()
  where id=v_item.id;

  return jsonb_build_object(
    'contract_version','W11_FUTURE_CONTEXT_V1',
    'plan_item_id',v_item.id,
    'recommended_date',v_item.recommended_date,
    'future_context',v_future,
    'semantics',jsonb_build_object(
      'readiness_is_not_persisted_for_future',true,
      'pain_is_not_persisted_for_future',true,
      'planned_context_is_not_actual',true,
      'session_structure_mutated',false
    )
  );
end;
$function$;
