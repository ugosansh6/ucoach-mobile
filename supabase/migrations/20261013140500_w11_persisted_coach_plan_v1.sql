create or replace function public.week_ensure_persisted_coach_plan_v1(p_user_id uuid,p_anchor_date date default current_date)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_week_start date:=public.d_week_start(coalesce(p_anchor_date,current_date)); v_missing integer:=0; v_projection jsonb; v_slot jsonb; v_item_id uuid; v_item record; v_provenance text; v_snapshot jsonb; v_persisted integer:=0; v_protected integer:=0;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user' using errcode='42501'; end if;
  select count(*) into v_missing from public.user_training_plan_items i left join public.workout_sessions s on s.id=i.session_id
  where i.user_id=p_user_id and i.week_start=v_week_start and i.status in ('available','claimed')
    and public.week_item_provenance_v1(coalesce(i.planning_context_json,'{}'::jsonb),coalesce(s.planning_context_json,'{}'::jsonb),coalesce(s.generated_workout,'{}'::jsonb),i.session_id is not null) in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION')
    and coalesce(i.planning_context_json#>'{w11,coach_plan}','null'::jsonb)='null'::jsonb;
  if v_missing=0 then return jsonb_build_object('version','W11_PERSISTED_COACH_PLAN_V1','status','ALREADY_PERSISTED','week_start',v_week_start,'persisted_count',0,'engine_recomputed',false); end if;
  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-coach-plan:'||p_user_id::text||':'||v_week_start::text,0));
  v_projection:=public.program_coach_ideal_week_projection_v2(p_user_id,v_week_start,null,null);
  for v_slot in select value from jsonb_array_elements(coalesce(v_projection->'projected_slots','[]'::jsonb)) loop
    begin v_item_id:=nullif(v_slot->>'source_plan_item_id','')::uuid; exception when others then v_item_id:=null; end;
    if v_item_id is null then continue; end if;
    select i.*,s.planning_context_json session_context,s.generated_workout session_generated into v_item
    from public.user_training_plan_items i left join public.workout_sessions s on s.id=i.session_id where i.id=v_item_id and i.user_id=p_user_id for update of i;
    if not found then continue; end if;
    v_provenance:=public.week_item_provenance_v1(coalesce(v_item.planning_context_json,'{}'::jsonb),coalesce(v_item.session_context,'{}'::jsonb),coalesce(v_item.session_generated,'{}'::jsonb),v_item.session_id is not null);
    if v_provenance not in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION') then v_protected:=v_protected+1; continue; end if;
    if coalesce(v_item.planning_context_json#>'{w11,coach_plan}','null'::jsonb)<>'null'::jsonb then continue; end if;
    v_snapshot:=jsonb_strip_nulls(jsonb_build_object('version','W11_PERSISTED_COACH_PLAN_V1','revision',1,'persisted',true,'anchor_date',v_week_start,'assigned_at',now(),'reason_code','INITIAL_WEEK_PLAN','slot_kind',v_slot->>'slot_kind','priority',v_slot->'priority','programming_role',v_slot->>'programming_role','dose_direction',v_slot->>'dose_direction','projection_certainty',v_slot->>'projection_certainty','priority_source',coalesce(v_slot->>'priority_source','PERSISTED_BLOCK_PRIORITY_V2'),'source_projection_version',v_projection->>'version','coach_owned',true,'replan_protected',false));
    update public.user_training_plan_items set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('w11',coalesce(planning_context_json->'w11','{}'::jsonb)||jsonb_build_object('coach_plan',v_snapshot)),updated_at=now() where id=v_item.id;
    v_persisted:=v_persisted+1;
  end loop;
  return jsonb_build_object('version','W11_PERSISTED_COACH_PLAN_V1','status',case when v_persisted>0 then 'PERSISTED' else 'NO_MATCHING_COACH_SLOT' end,'week_start',v_week_start,'persisted_count',v_persisted,'protected_user_owned_count',v_protected,'engine_recomputed',true,'anchor_policy','WEEK_START_ON_INITIAL_ASSIGNMENT');
end;$function$;

create or replace function public.week_replan_persisted_coach_plan_v1(p_user_id uuid,p_anchor_date date default current_date,p_reason_code text default 'EXPLICIT_REPLAN_EVENT',p_trigger_plan_item_id uuid default null,p_trigger_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_week_start date:=public.d_week_start(coalesce(p_anchor_date,current_date)); v_projection jsonb; v_slot jsonb; v_item_id uuid; v_item record; v_provenance text; v_previous jsonb; v_next_core jsonb; v_previous_core jsonb; v_snapshot jsonb; v_revision integer; v_changed integer:=0; v_unchanged integer:=0; v_protected integer:=0; v_changed_ids jsonb:='[]'::jsonb;
begin
  if p_user_id is null then raise exception 'User required'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-coach-plan:'||p_user_id::text||':'||v_week_start::text,0));
  v_projection:=public.program_coach_ideal_week_projection_v2(p_user_id,coalesce(p_anchor_date,current_date),null,null);
  for v_slot in select value from jsonb_array_elements(coalesce(v_projection->'projected_slots','[]'::jsonb)) loop
    begin v_item_id:=nullif(v_slot->>'source_plan_item_id','')::uuid; exception when others then v_item_id:=null; end;
    if v_item_id is null then continue; end if;
    select i.*,s.planning_context_json session_context,s.generated_workout session_generated,s.status session_status into v_item from public.user_training_plan_items i left join public.workout_sessions s on s.id=i.session_id where i.id=v_item_id and i.user_id=p_user_id and i.week_start=v_week_start for update of i;
    if not found then continue; end if;
    v_provenance:=public.week_item_provenance_v1(coalesce(v_item.planning_context_json,'{}'::jsonb),coalesce(v_item.session_context,'{}'::jsonb),coalesce(v_item.session_generated,'{}'::jsonb),v_item.session_id is not null);
    if v_provenance not in ('UGEROD_PROJECTION','UGEROD_GENERATED_SESSION') or v_item.status<>'available' or v_item.session_id is not null then v_protected:=v_protected+1; continue; end if;
    v_previous:=v_item.planning_context_json#>'{w11,coach_plan}'; v_revision:=coalesce(nullif(v_previous->>'revision','')::integer,0)+1;
    v_next_core:=jsonb_strip_nulls(jsonb_build_object('slot_kind',v_slot->>'slot_kind','priority',v_slot->'priority','programming_role',v_slot->>'programming_role','dose_direction',v_slot->>'dose_direction'));
    v_previous_core:=jsonb_strip_nulls(jsonb_build_object('slot_kind',v_previous->>'slot_kind','priority',v_previous->'priority','programming_role',v_previous->>'programming_role','dose_direction',v_previous->>'dose_direction'));
    if v_previous is not null and v_previous_core=v_next_core then v_unchanged:=v_unchanged+1; continue; end if;
    v_snapshot:=jsonb_strip_nulls(jsonb_build_object('version','W11_PERSISTED_COACH_PLAN_V1','revision',v_revision,'persisted',true,'anchor_date',coalesce(p_anchor_date,current_date),'assigned_at',now(),'reason_code',upper(coalesce(nullif(trim(p_reason_code),''),'EXPLICIT_REPLAN_EVENT')),'trigger_plan_item_id',p_trigger_plan_item_id,'trigger_session_id',p_trigger_session_id,'slot_kind',v_slot->>'slot_kind','priority',v_slot->'priority','programming_role',v_slot->>'programming_role','dose_direction',v_slot->>'dose_direction','projection_certainty',v_slot->>'projection_certainty','priority_source',coalesce(v_slot->>'priority_source','PERSISTED_BLOCK_PRIORITY_V2'),'source_projection_version',v_projection->>'version','coach_owned',true,'replan_protected',false));
    update public.user_training_plan_items set planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('w11',coalesce(planning_context_json->'w11','{}'::jsonb)||jsonb_build_object('coach_plan',v_snapshot)),updated_at=now() where id=v_item.id;
    v_changed:=v_changed+1; v_changed_ids:=v_changed_ids||jsonb_build_array(v_item.id);
  end loop;
  return jsonb_build_object('version','W11_PERSISTED_REPLAN_V1','status','REPLAN_EVALUATED','week_start',v_week_start,'anchor_date',coalesce(p_anchor_date,current_date),'reason_code',upper(coalesce(nullif(trim(p_reason_code),''),'EXPLICIT_REPLAN_EVENT')),'changed_count',v_changed,'unchanged_count',v_unchanged,'protected_count',v_protected,'changed_plan_item_ids',v_changed_ids,'user_owned_items_mutated',false,'generated_or_started_sessions_mutated',false);
end;$function$;