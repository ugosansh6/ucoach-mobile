-- MSW-062: avoid expensive week Coach projection during page read.
-- Preserve lock, authorization behavior, provenance guards and idempotence.
-- Session role/dose are resolved on day J by the session engine.
-- Applied on UGEROD DEV on 2026-10-23.

CREATE OR REPLACE FUNCTION public.week_ensure_persisted_coach_plan_v1(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_week_start date := public.d_week_start(coalesce(p_anchor_date,current_date));
  v_missing integer := 0;
  v_projection jsonb;
  v_slot jsonb;
  v_item_id uuid;
  v_item record;
  v_provenance text;
  v_snapshot jsonb;
  v_persisted integer := 0;
  v_protected integer := 0;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then raise exception 'Forbidden user' using errcode='42501'; end if;

  select count(*) into v_missing
  from public.user_training_plan_items i
  left join public.workout_sessions s on s.id=i.session_id
  where i.user_id=p_user_id
    and i.week_start=v_week_start
    and i.status in ('available','claimed')
    and public.week_item_provenance_v1(
      coalesce(i.planning_context_json,'{}'::jsonb),
      coalesce(s.planning_context_json,'{}'::jsonb),
      coalesce(s.generated_workout,'{}'::jsonb),
      i.session_id is not null
    ) in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION')
    and coalesce(i.planning_context_json#>'{w11,coach_plan}','null'::jsonb)='null'::jsonb;

  if v_missing=0 then
    return jsonb_build_object(
      'version','W11_PERSISTED_COACH_PLAN_V1',
      'status','ALREADY_PERSISTED',
      'week_start',v_week_start,
      'persisted_count',0,
      'engine_recomputed',false
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-coach-plan:'||p_user_id::text||':'||v_week_start::text,0));

  select count(*) into v_missing
  from public.user_training_plan_items i
  left join public.workout_sessions s on s.id=i.session_id
  where i.user_id=p_user_id
    and i.week_start=v_week_start
    and i.status in ('available','claimed')
    and public.week_item_provenance_v1(
      coalesce(i.planning_context_json,'{}'::jsonb),
      coalesce(s.planning_context_json,'{}'::jsonb),
      coalesce(s.generated_workout,'{}'::jsonb),
      i.session_id is not null
    ) in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION')
    and coalesce(i.planning_context_json#>'{w11,coach_plan}','null'::jsonb)='null'::jsonb;

  if v_missing=0 then
    return jsonb_build_object(
      'version','W11_PERSISTED_COACH_PLAN_V1',
      'status','ALREADY_PERSISTED',
      'week_start',v_week_start,
      'persisted_count',0,
      'engine_recomputed',false
    );
  end if;

  v_projection := jsonb_build_object(
    'version','W11_FAST_WEEK_PRIORITY_SNAPSHOT_V1',
    'projected_slots',coalesce((
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'source_plan_item_id',slot.value->>'plan_item_id',
          'slot_kind',slot.value#>>'{coach_projection,slot_kind}',
          'priority',slot.value#>'{coach_projection,priority}',
          'projection_certainty',slot.value#>>'{coach_projection,projection_certainty}',
          'priority_source',coalesce(slot.value#>>'{coach_projection,priority_source}','PERSISTED_BLOCK_PRIORITY_V2_FAST_READ')
        ))
        order by coalesce(nullif(slot.value->>'sequence_index','')::integer,2147483647)
      )
      from jsonb_array_elements(
        coalesce(public.week_read_contract_v1(p_user_id,v_week_start)->'items','[]'::jsonb)
      ) as slot(value)
      where slot.value->>'display_state' in ('PREVUE','PRETE','ACTIVE')
        and nullif(slot.value->>'plan_item_id','') is not null
        and jsonb_typeof(slot.value->'coach_projection')='object'
        and jsonb_typeof(slot.value#>'{coach_projection,priority}')='object'
    ),'[]'::jsonb)
  );

  for v_slot in
    select value from jsonb_array_elements(coalesce(v_projection->'projected_slots','[]'::jsonb))
  loop
    begin
      v_item_id := nullif(v_slot->>'source_plan_item_id','')::uuid;
    exception when others then
      v_item_id := null;
    end;
    if v_item_id is null then continue; end if;

    select i.*, s.planning_context_json as session_context, s.generated_workout as session_generated
    into v_item
    from public.user_training_plan_items i
    left join public.workout_sessions s on s.id=i.session_id
    where i.id=v_item_id and i.user_id=p_user_id
    for update of i;

    if not found then continue; end if;

    v_provenance := public.week_item_provenance_v1(
      coalesce(v_item.planning_context_json,'{}'::jsonb),
      coalesce(v_item.session_context,'{}'::jsonb),
      coalesce(v_item.session_generated,'{}'::jsonb),
      v_item.session_id is not null
    );

    if v_provenance not in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION') then
      v_protected := v_protected+1;
      continue;
    end if;

    if coalesce(v_item.planning_context_json#>'{w11,coach_plan}','null'::jsonb) <> 'null'::jsonb then
      continue;
    end if;

    v_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'version','W11_PERSISTED_COACH_PLAN_V1',
      'revision',1,
      'persisted',true,
      'anchor_date',v_week_start,
      'assigned_at',now(),
      'reason_code','INITIAL_WEEK_PLAN',
      'slot_kind',v_slot->>'slot_kind',
      'priority',v_slot->'priority',
      'programming_role',v_slot->>'programming_role',
      'dose_direction',v_slot->>'dose_direction',
      'projection_certainty',v_slot->>'projection_certainty',
      'priority_source',coalesce(v_slot->>'priority_source','PERSISTED_BLOCK_PRIORITY_V2'),
      'source_projection_version',v_projection->>'version',
      'coach_owned',true,
      'replan_protected',false
    ));

    update public.user_training_plan_items
    set planning_context_json = coalesce(planning_context_json,'{}'::jsonb)
      || jsonb_build_object(
        'w11',coalesce(planning_context_json->'w11','{}'::jsonb)
          || jsonb_build_object('coach_plan',v_snapshot)
      ),
      updated_at=now()
    where id=v_item.id;

    v_persisted := v_persisted+1;
  end loop;

  return jsonb_build_object(
    'version','W11_PERSISTED_COACH_PLAN_V1',
    'status',case when v_persisted>0 then 'PERSISTED' else 'NO_MATCHING_COACH_SLOT' end,
    'week_start',v_week_start,
    'persisted_count',v_persisted,
    'protected_user_owned_count',v_protected,
    'engine_recomputed',false,
    'anchor_policy','WEEK_START_ON_INITIAL_ASSIGNMENT'
  );
end;
$function$
;
