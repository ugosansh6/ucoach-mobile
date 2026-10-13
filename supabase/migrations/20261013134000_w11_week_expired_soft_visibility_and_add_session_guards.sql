create or replace function public.week_read_contract_v2(p_user_id uuid, p_anchor_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_projection jsonb;
  v_presentation jsonb;
  v_semantics jsonb;
  v_planned jsonb;
  v_future jsonb;
  v_plan_focus text;
  v_plan_region text;
  v_plan_intent text;
  v_plan_context jsonb;
  v_persisted_plan jsonb;
  v_provenance text;
  v_ensure jsonb;
  v_item_date date;
  v_is_soft boolean;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user'; end if;

  v_ensure := public.week_ensure_persisted_coach_plan_v1(p_user_id,v_anchor);
  v_base := public.week_read_contract_v1(p_user_id,v_anchor);

  for v_item in select value from jsonb_array_elements(coalesce(v_base->'items','[]'::jsonb))
  loop
    select i.planned_focus,i.planned_target_region,i.planned_progression_intent,coalesce(i.planning_context_json,'{}'::jsonb)
      into v_plan_focus,v_plan_region,v_plan_intent,v_plan_context
    from public.user_training_plan_items i
    where i.id=nullif(v_item->>'plan_item_id','')::uuid and i.user_id=p_user_id;

    v_planned := coalesce(v_item->'planned_context','{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('focus',v_plan_focus,'target_region',v_plan_region,'progression_intent',v_plan_intent));

    v_future := coalesce(v_plan_context#>'{w11,future_context}','{}'::jsonb);
    if jsonb_typeof(v_future)='object' and v_future<>'{}'::jsonb then
      v_planned := v_planned || jsonb_strip_nulls(jsonb_build_object(
        'duration_minutes',coalesce(nullif(v_future->>'duration_minutes','')::integer,nullif(v_planned->>'duration_minutes','')::integer),
        'environment_code',coalesce(nullif(v_future->>'environment_code',''),v_planned->>'environment_code'),
        'equipment',case when jsonb_typeof(v_future->'equipment')='array' then v_future->'equipment' else coalesce(v_planned->'equipment','[]'::jsonb) end,
        'future_context',v_future
      ));
    end if;
    v_item := jsonb_set(v_item,'{planned_context}',v_planned,true);

    v_provenance := upper(coalesce(v_item#>>'{provenance,code}','UGEROD_PROJECTION'));
    v_persisted_plan := v_plan_context#>'{w11,coach_plan}';

    if v_provenance in ('USER_ASSISTED_SESSION','USER_FREE_SESSION','SAVED_MODEL_SESSION','STRUCTURED_PROGRAM_SESSION','EXTERNAL_ACTUAL') then
      v_projection := jsonb_build_object(
        'slot_kind','USER_OWNED',
        'projection_certainty','USER_AUTHORED',
        'relationship_to_item','USER_AUTHORITY',
        'applies_to_session_content',false,
        'persistent_assignment',true,
        'replan_protected',true,
        'priority_source','USER_AUTHORITY'
      );
    elsif jsonb_typeof(v_persisted_plan)='object' then
      v_projection := jsonb_strip_nulls(jsonb_build_object(
        'slot_kind',v_persisted_plan->>'slot_kind',
        'priority',v_persisted_plan->'priority',
        'projection_certainty',v_persisted_plan->>'projection_certainty',
        'relationship_to_item','CONTENT_AUTHORITY',
        'applies_to_session_content',true,
        'persistent_assignment',true,
        'replan_protected',false,
        'priority_source',coalesce(v_persisted_plan->>'priority_source','PERSISTED_WEEK_COACH_PLAN'),
        'programming_role',v_persisted_plan->>'programming_role',
        'dose_direction',v_persisted_plan->>'dose_direction',
        'assignment_revision',nullif(v_persisted_plan->>'revision','')::integer,
        'assignment_reason_code',v_persisted_plan->>'reason_code',
        'assigned_at',v_persisted_plan->>'assigned_at',
        'anchor_date',v_persisted_plan->>'anchor_date'
      ));
    else
      v_projection := v_item->'coach_projection';
      if jsonb_typeof(v_projection)='object' then
        v_projection := v_projection || jsonb_build_object('persistent_assignment',false,'priority_source','LEGACY_DYNAMIC_FALLBACK');
      end if;
    end if;

    begin
      v_item_date := nullif(v_item->>'recommended_date','')::date;
    exception when others then
      v_item_date := null;
    end;
    v_is_soft := coalesce((v_item->>'recommended_date_is_soft')::boolean,true);

    if v_provenance='UGEROD_PROJECTION'
       and v_item->>'display_state'='PREVUE'
       and nullif(v_item->>'session_id','') is null
       and v_is_soft
       and v_item_date is not null
       and v_item_date < v_anchor then
      v_item := jsonb_set(v_item,'{display_state}',to_jsonb('CLOSED_SILENT'::text),true);
      v_item := jsonb_set(v_item,'{surface_visibility}',to_jsonb('CONTEXT_ONLY'::text),true);
      v_item := jsonb_set(v_item,'{expired_soft_opportunity}','true'::jsonb,true);
    end if;

    if jsonb_typeof(v_projection)='object' then
      v_presentation := public.week_intent_presentation_v4(
        p_user_id,
        v_plan_focus,
        coalesce(nullif(v_future->>'target_region',''),v_plan_region),
        v_plan_intent,
        v_projection->'priority',
        v_projection->>'slot_kind',
        v_projection->>'projection_certainty'
      );
      v_projection := v_projection || jsonb_build_object('presentation',v_presentation);
      v_item := jsonb_set(v_item,'{coach_projection}',v_projection,true);
    else
      v_item := v_item - 'coach_projection';
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_semantics := coalesce(v_base->'semantics','{}'::jsonb) || jsonb_build_object(
    'coach_advice_is_optional',true,
    'front_must_not_invent_coach_advice',true,
    'intent_presentation_is_evidence_bound',true,
    'intent_title_comes_from_persisted_plan_plus_concrete_priority',true,
    'priority_is_not_automatically_the_title',true,
    'why_now_is_optional',true,
    'exercise_examples_require_real_candidate_data',true,
    'exercise_examples_are_candidates_not_commitments',true,
    'no_equipment_advice_without_explicit_equipment_opportunity',true,
    'future_context_excludes_readiness_and_pain',true,
    'planned_context_is_not_actual',true,
    'week_read_does_not_reassign_coach_priorities',true,
    'coach_plan_assignments_persist_until_explicit_replan',true,
    'user_owned_items_are_replan_protected',true,
    'user_owned_item_dates_are_not_moved_by_coach',true,
    'past_soft_coach_opportunities_are_context_only',true,
    'week_read_does_not_move_expired_opportunities_forward',true
  );

  v_base := jsonb_set(v_base,'{items}',v_items,true);
  v_base := jsonb_set(v_base,'{semantics}',v_semantics,true);
  v_base := jsonb_set(v_base,'{persistence_meta}',jsonb_build_object('ensure',v_ensure),true);
  v_base := jsonb_set(v_base,'{contract_version}',to_jsonb('W11_WEEK_READ_V2_4_EXPIRED_SOFT'::text),true);
  return v_base;
end;
$function$;

create or replace function public.week_create_assisted_plan_item_v1(
  p_user_id uuid,
  p_recommended_date date,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_week_start date;
  v_sequence integer;
  v_item_id uuid;
  v_result jsonb;
  v_existing_count integer;
begin
  if p_user_id is null or p_recommended_date is null then
    raise exception 'week_create_assisted_plan_item_v1 requires user and date';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Forbidden user' using errcode='42501';
  end if;
  if p_recommended_date < current_date then
    raise exception 'Cannot add a session in the past';
  end if;

  v_week_start := public.d_week_start(p_recommended_date);
  perform pg_advisory_xact_lock(
    hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_week_start::text,0)
  );
  perform public.d_ensure_week_plan(p_user_id,p_recommended_date,false);

  select count(*)::integer
  into v_existing_count
  from public.user_training_plan_items
  where user_id=p_user_id
    and week_start=v_week_start
    and status in ('available','claimed','completed');

  if v_existing_count >= 5 then
    raise exception 'This week already contains five planned sessions';
  end if;

  if exists(
    select 1
    from public.user_training_plan_items
    where user_id=p_user_id
      and week_start=v_week_start
      and recommended_date=p_recommended_date
      and status in ('available','claimed','completed')
  ) then
    raise exception 'A session is already planned on this day';
  end if;

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
        'creation_mode','ASSISTED',
        'replan_protected',true
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
    'provenance','USER_ASSISTED_SESSION',
    'replan_protected',true,
    'max_week_sessions',5
  );
end;
$function$;