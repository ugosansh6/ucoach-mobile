-- Activate anticipated plans only in the actual week; keep read and expensive review separate.
CREATE OR REPLACE FUNCTION public.week_anticipated_activation_pending_v1(p_user_id uuid,p_week_start date)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
 SELECT p_week_start=public.d_week_start(current_date) AND EXISTS(
   SELECT 1 FROM public.user_training_weeks w WHERE w.user_id=p_user_id AND w.week_start=p_week_start
     AND (w.context_json->>'anticipated_week_prepared'='true' OR w.created_at::date<w.week_start)
     AND w.context_json#>>'{anticipated_week_activation,activated_at}' IS NULL
 );
$function$;
REVOKE ALL ON FUNCTION public.week_anticipated_activation_pending_v1(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.week_anticipated_activation_pending_v1(uuid,date) TO service_role;

CREATE OR REPLACE FUNCTION public.d_ensure_week_plan(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE, p_force_rebuild boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_stored_target int;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
  v_current_week date:=public.d_week_start(current_date);
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_week::text,0));

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  -- Initialising a future calendar must never close the current week.
  if v_week <= v_current_week then
  update public.user_training_plan_items
  set status='unrealized',
      updated_at=now(),
      planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
        || jsonb_build_object(
          'closed_week_unrealized',true,
          'recommended_date_is_soft',true,
          'user_debt_created',false
        )
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );
  end if;

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if v_exists then
    select weekly_session_target into v_stored_target
    from public.user_training_weeks
    where user_id=p_user_id and week_start=v_week;
  end if;

  if v_exists
     and (p_force_rebuild or v_stored_target is distinct from v_target)
     and not exists(
       select 1 from public.user_training_plan_items
       where user_id=p_user_id and week_start=v_week and (
         status in ('claimed','completed','skipped')
         or session_id is not null
         or jsonb_typeof(planning_context_json#>'{w11,composer_draft}')='object'
         or jsonb_typeof(planning_context_json#>'{w11,future_context}')='object'
         or jsonb_typeof(planning_context_json#>'{w11,last_schedule_edit}')='object'
         or coalesce(planning_context_json#>>'{w11,provenance}','UGEROD_PROJECTION') not in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION')
         or coalesce(planning_context_json#>>'{w11,replan_protected}','false')='true'
       )
     ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object(
        'created_from_anchor_date',p_anchor_date,
        'anticipated_week_prepared',v_week>v_current_week,
        'baseline_duration_minutes',45,
        'planned_not_generated',true,
        'recommended_dates_are_soft',true,
        'no_session_debt',true,
        'weekly_target_synced_from_profile',true
      )
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object(
          'plan_version','d1-weekly-loop-v1',
          'recommended_date_is_soft',true,
          'wod_pre_generated',false,
          'user_debt_created',false
        )
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed' and public.session_counts_as_training_v1(ws.id)
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v4-profile-target-sync','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'recommended_dates_are_soft',true,
    'user_session_debt',false,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_read_contract_v2(p_user_id uuid, p_anchor_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_anchor date := coalesce(p_anchor_date,current_date);
  v_base jsonb;
  v_items jsonb := '[]'::jsonb;
  v_context_items jsonb := '[]'::jsonb;
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
  v_planning_slot_count integer := 0;
  v_draft jsonb;
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

    v_draft := v_plan_context#>'{w11,composer_draft}';
    if jsonb_typeof(v_draft)='object' then
      v_item := v_item || jsonb_strip_nulls(jsonb_build_object('has_composer_draft',true,'composer_title',coalesce(nullif(v_draft#>>'{architecture,title}',''),nullif(v_draft#>>'{intent,label}',''))));
    end if;

    v_provenance := upper(coalesce(v_item#>>'{provenance,code}','UGEROD_PROJECTION'));
    v_persisted_plan := v_plan_context#>'{w11,coach_plan}';

    if jsonb_typeof(v_draft)='object' or v_provenance in ('USER_ASSISTED_SESSION','USER_FREE_SESSION','SAVED_MODEL_SESSION','STRUCTURED_PROGRAM_SESSION','EXTERNAL_ACTUAL') then
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
      if public.d_week_start(v_anchor)>public.d_week_start(current_date) and v_projection->>'slot_kind'<>'USER_OWNED' then
        v_projection := v_projection || jsonb_build_object('projection_certainty','CONDITIONAL_FUTURE');
      end if;
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

    if lower(coalesce(v_item->>'lifecycle_status','')) not in ('skipped','unrealized') then
      v_planning_slot_count := v_planning_slot_count + 1;
    end if;

    if coalesce(v_item->>'surface_visibility','PRIMARY')='CONTEXT_ONLY'
       or coalesce(v_item->>'display_state','PREVUE')='CLOSED_SILENT' then
      v_context_items := v_context_items || jsonb_build_array(v_item);
    else
      v_items := v_items || jsonb_build_array(v_item);
    end if;
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
    'week_read_does_not_move_expired_opportunities_forward',true,
    'items_are_surface_visible_only',true,
    'context_items_never_render_as_sessions',true
  );

  v_base := jsonb_set(v_base,'{items}',v_items,true);
  v_base := jsonb_set(v_base,'{context_items}',v_context_items,true);
  v_base := jsonb_set(v_base,'{planning_slot_count}',to_jsonb(v_planning_slot_count),true);
  v_base := jsonb_set(v_base,'{semantics}',v_semantics,true);
  v_base := jsonb_set(v_base,'{persistence_meta}',jsonb_build_object('ensure',v_ensure),true);
  v_base := jsonb_set(v_base,'{contract_version}',to_jsonb('W11_WEEK_READ_V2_5_SURFACE_SPLIT'::text),true);
  v_base := v_base || jsonb_build_object('anticipated_activation_pending',public.week_anticipated_activation_pending_v1(p_user_id,public.d_week_start(v_anchor)));
  return v_base;
end;
$function$;

CREATE OR REPLACE FUNCTION public.week_activate_anticipated_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
 v_anchor date:=current_date;
 v_week date:=public.d_week_start(current_date);
 v_contract jsonb;
 v_role jsonb;
 v_maintenance jsonb;
 v_item public.user_training_plan_items%rowtype;
 v_previous jsonb;
 v_core jsonb;
 v_previous_core jsonb;
 v_priority jsonb;
 v_kind text;
 v_programming_role text;
 v_certainty text;
 v_snapshot jsonb;
 v_rank integer:=0;
 v_changed integer:=0;
 v_unchanged integer:=0;
 v_protected integer:=0;
 v_meta jsonb;
BEGIN
 IF p_user_id IS NULL OR auth.uid() IS NULL OR auth.uid()<>p_user_id THEN
   RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT public.week_anticipated_activation_pending_v1(p_user_id,v_week) THEN
   RETURN jsonb_build_object('status','NOT_PENDING','week_start',v_week);
 END IF;
 -- Share the existing coach assignment lock. Never queue behind another replan.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ugerod:week-coach-plan:'||p_user_id::text||':'||v_week::text,0)) THEN
   RETURN jsonb_build_object('status','IN_PROGRESS','week_start',v_week);
 END IF;
 IF NOT public.week_anticipated_activation_pending_v1(p_user_id,v_week) THEN
   RETURN jsonb_build_object('status','NOT_PENDING','week_start',v_week);
 END IF;

 -- Reuse V2 cycle authority and role resolver. Avoid full V1/V2 projection
 -- and duplicate dose/diagnostic calculations; day-J is still dose authority.
 IF EXISTS(
   SELECT 1 FROM public.user_training_plan_items i
   WHERE i.user_id=p_user_id AND i.week_start=v_week AND i.status='available'
     AND i.session_id IS NULL AND i.recommended_date>=v_anchor
     AND public.week_item_provenance_v1(i.planning_context_json,'{}'::jsonb,'{}'::jsonb,false)='UGEROD_PROJECTION'
     AND jsonb_typeof(coalesce(i.planning_context_json#>'{w11,composer_draft}','null'::jsonb))<>'object'
     AND coalesce(i.planning_context_json#>>'{w11,replan_protected}','false')<>'true'
 ) THEN
   v_contract:=public.program_coach_block_priority_snapshot_v2(p_user_id,v_anchor)->'priority_contract';
   v_maintenance:=coalesce(v_contract->'maintenance','[]'::jsonb);
   v_role:=public.program_coach_session_role_v2(p_user_id,v_anchor,null,null);
   -- Existing V2 open-slot order: sequence, eligible remaining dates, no catch-up.
   -- User-authored opportunities still reserve their slot; do not shift their content.
   FOR v_item IN
     SELECT i.* FROM public.user_training_plan_items i
     WHERE i.user_id=p_user_id AND i.week_start=v_week AND i.status='available'
       AND i.session_id IS NULL AND i.recommended_date>=v_anchor
     ORDER BY i.sequence_index,i.recommended_date,i.id FOR UPDATE OF i
   LOOP
     v_rank:=v_rank+1;
     IF public.week_item_provenance_v1(v_item.planning_context_json,'{}'::jsonb,'{}'::jsonb,false)<>'UGEROD_PROJECTION'
        OR jsonb_typeof(v_item.planning_context_json#>'{w11,composer_draft}')='object'
        OR coalesce(v_item.planning_context_json#>>'{w11,replan_protected}','false')='true' THEN
       v_protected:=v_protected+1; CONTINUE;
     END IF;
     v_priority:=null; v_programming_role:=null; v_kind:='FLEXIBLE_COMPLEMENT';
     IF v_rank=1 THEN
       v_priority:=v_contract->'primary_priority'; v_kind:='PERSISTED_PRIMARY_PRIORITY';
       v_programming_role:=v_role->>'recommended_role';
     ELSIF v_rank=2 AND jsonb_typeof(v_contract->'secondary_priority')='object' THEN
       v_priority:=v_contract->'secondary_priority'; v_kind:='PERSISTED_SECONDARY_PRIORITY'; v_programming_role:='DEVELOPMENT';
     ELSIF v_rank=3 AND jsonb_array_length(v_maintenance)>0 THEN
       v_priority:=jsonb_build_object('kind','MAINTENANCE_POOL','key','week_balance','programming_state','MAINTAIN','candidates',v_maintenance,'priority_reason','PRESERVE_NON_PRIORITY_CAPACITIES_WITHOUT_FORCED_EQUAL_DISTRIBUTION');
       v_kind:='MAINTENANCE_POOL'; v_programming_role:='MAINTENANCE';
     END IF;
     v_certainty:=case when v_rank=1 and v_item.recommended_date=v_anchor then 'CURRENT_RECOMMENDATION' else 'CONDITIONAL_FUTURE' end;
     v_core:=jsonb_strip_nulls(jsonb_build_object('slot_kind',v_kind,'priority',v_priority,
       'programming_role',v_programming_role,'dose_direction','TO_RECALCULATE_AT_SESSION_TIME','projection_certainty',v_certainty));
     v_previous:=v_item.planning_context_json#>'{w11,coach_plan}';
     v_previous_core:=jsonb_strip_nulls(jsonb_build_object('slot_kind',v_previous->'slot_kind','priority',v_previous->'priority',
       'programming_role',v_previous->'programming_role','dose_direction',v_previous->'dose_direction','projection_certainty',v_previous->'projection_certainty'));
     IF v_previous IS NOT NULL AND v_previous_core=v_core THEN v_unchanged:=v_unchanged+1; CONTINUE; END IF;
     v_snapshot:=v_core||jsonb_build_object('version','W11_PERSISTED_COACH_PLAN_V1','revision',coalesce(nullif(v_previous->>'revision','')::integer,0)+1,
       'persisted',true,'anchor_date',v_anchor,'assigned_at',now(),'reason_code','ANTICIPATED_WEEK_ACTIVATED',
       'priority_source','PERSISTED_BLOCK_PRIORITY_V2','source_projection_version','W11_ANTICIPATED_ACTIVATION_V1',
       'coach_owned',true,'replan_protected',false);
     UPDATE public.user_training_plan_items
       SET planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('w11',coalesce(planning_context_json->'w11','{}'::jsonb)||jsonb_build_object('coach_plan',v_snapshot)),
           updated_at=now()
       WHERE id=v_item.id AND user_id=p_user_id;
     v_changed:=v_changed+1;
   END LOOP;
 END IF;
 v_meta:=jsonb_build_object('version','W11_ANTICIPATED_ACTIVATION_V1','activated_at',now(),'anchor_date',v_anchor,
   'changed_count',v_changed,'unchanged_count',v_unchanged,'protected_count',v_protected,'cycle_priority_preserved',true,'day_j_dose_deferred',true);
 UPDATE public.user_training_weeks SET context_json=coalesce(context_json,'{}'::jsonb)||jsonb_build_object('anticipated_week_activation',v_meta),
   updated_at=now() WHERE user_id=p_user_id AND week_start=v_week;
 RETURN v_meta||jsonb_build_object('status','ACTIVATED','week_start',v_week);
END;
$function$;
REVOKE ALL ON FUNCTION public.week_activate_anticipated_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.week_activate_anticipated_v1(uuid) TO authenticated,service_role;
