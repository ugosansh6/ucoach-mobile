-- W11 / Ma semaine
-- Persist only information a user can know ahead of time.
-- Readiness, pain and other day-of execution inputs are intentionally excluded.

create or replace function public.week_update_plan_item_context_v1(
  p_user_id uuid,
  p_plan_item_id uuid,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    select 1
    from public.workout_sessions ws
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
      select 1
      from jsonb_array_elements(v_equipment) e
      where jsonb_typeof(e) <> 'string'
    ) then
      raise exception 'equipment values must be strings';
    end if;
  else
    v_equipment := coalesce(
      v_item.planning_context_json#>'{w11,future_context,equipment}',
      '[]'::jsonb
    );
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
        '{w11,future_context}',
        v_future,
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

grant execute on function public.week_update_plan_item_context_v1(uuid,uuid,jsonb) to authenticated;

create or replace function public.week_read_contract_v2(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_projection jsonb;
  v_presentation jsonb;
  v_semantics jsonb;
  v_planned jsonb;
  v_future jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_base := public.week_read_contract_v1(
    p_user_id,
    coalesce(p_anchor_date, current_date)
  );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_base->'items', '[]'::jsonb))
  loop
    v_projection := v_item->'coach_projection';
    if jsonb_typeof(v_projection) = 'object' then
      v_presentation := public.week_intent_presentation_v1(
        v_projection->'priority',
        v_projection->>'slot_kind',
        v_projection->>'projection_certainty'
      );
      v_projection := v_projection || jsonb_build_object(
        'presentation', v_presentation
      );
      v_item := jsonb_set(v_item, '{coach_projection}', v_projection, true);
    end if;

    v_planned := coalesce(v_item->'planned_context','{}'::jsonb);
    v_future := coalesce(
      v_planned#>'{planning_context,w11,future_context}',
      '{}'::jsonb
    );
    if jsonb_typeof(v_future) = 'object' and v_future <> '{}'::jsonb then
      v_planned := v_planned || jsonb_strip_nulls(jsonb_build_object(
        'duration_minutes',coalesce(
          nullif(v_future->>'duration_minutes','')::integer,
          nullif(v_planned->>'duration_minutes','')::integer
        ),
        'environment_code',coalesce(
          nullif(v_future->>'environment_code',''),
          v_planned->>'environment_code'
        ),
        'equipment',case
          when jsonb_typeof(v_future->'equipment')='array' then v_future->'equipment'
          else coalesce(v_planned->'equipment','[]'::jsonb)
        end,
        'future_context',v_future
      ));
      v_item := jsonb_set(v_item,'{planned_context}',v_planned,true);
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_semantics := coalesce(v_base->'semantics', '{}'::jsonb) || jsonb_build_object(
    'coach_advice_is_optional', true,
    'front_must_not_invent_coach_advice', true,
    'intent_presentation_is_evidence_bound', true,
    'exercise_examples_require_real_candidate_data', true,
    'future_context_excludes_readiness_and_pain', true,
    'planned_context_is_not_actual', true
  );

  v_base := jsonb_set(v_base, '{items}', v_items, true);
  v_base := jsonb_set(v_base, '{semantics}', v_semantics, true);
  v_base := jsonb_set(
    v_base,
    '{contract_version}',
    to_jsonb('W11_WEEK_READ_V2'::text),
    true
  );
  return v_base;
end;
$function$;
