create or replace function public.week_create_assisted_plan_item_v1(p_user_id uuid,p_recommended_date date,p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_week_start date; v_sequence integer; v_item_id uuid; v_result jsonb; v_replan jsonb;
begin
  if p_user_id is null or p_recommended_date is null then raise exception 'week_create_assisted_plan_item_v1 requires user and date'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user' using errcode='42501'; end if;
  v_week_start:=public.d_week_start(p_recommended_date);
  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_week_start::text,0));
  perform public.d_ensure_week_plan(p_user_id,p_recommended_date,false);
  perform public.week_ensure_persisted_coach_plan_v1(p_user_id,p_recommended_date);
  select coalesce(max(sequence_index),0)+1 into v_sequence from public.user_training_plan_items where user_id=p_user_id and week_start=v_week_start;
  insert into public.user_training_plan_items(user_id,sequence_index,recommended_date,status,week_start,planning_context_json)
  values(p_user_id,v_sequence,p_recommended_date,'available',v_week_start,jsonb_build_object('plan_version','w11-user-assisted-v1','recommended_date_is_soft',true,'user_debt_created',false,'wod_pre_generated',false,'w11',jsonb_build_object('provenance','USER_ASSISTED_SESSION','creation_mode','ASSISTED','replan_protected',true,'coach_may_move_date',false,'coach_may_rewrite_structure',false))) returning id into v_item_id;
  v_result:=public.week_update_plan_item_context_v1(p_user_id,v_item_id,coalesce(p_context,'{}'::jsonb));
  v_replan:=public.week_replan_persisted_coach_plan_v1(p_user_id,p_recommended_date,'USER_SESSION_ADDED',v_item_id,null);
  return v_result||jsonb_build_object('created',true,'sequence_index',v_sequence,'week_start',v_week_start,'week_end',v_week_start+6,'provenance','USER_ASSISTED_SESSION','replan_protected',true,'coach_replan_around_user_item',v_replan);
end;$function$;

create or replace function public.week_move_plan_item_v1(p_user_id uuid,p_plan_item_id uuid,p_target_date date,p_anchor_date date default current_date)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_item public.user_training_plan_items%rowtype; v_session_status text; v_anchor_week_start date; v_anchor_week_end date; v_item_week_end date; v_date_is_soft boolean; v_previous_date date; v_collision_count integer:=0; v_changed boolean:=false; v_replan jsonb:='{}'::jsonb;
begin
  if p_user_id is null or p_plan_item_id is null or p_target_date is null or p_anchor_date is null then raise exception 'week_move_plan_item_v1 requires user, item, target date and anchor date'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Not allowed to move another user''s week item' using errcode='42501'; end if;
  v_anchor_week_start:=public.d_week_start(p_anchor_date); v_anchor_week_end:=v_anchor_week_start+6;
  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_anchor_week_start::text,0));
  perform public.week_ensure_persisted_coach_plan_v1(p_user_id,p_anchor_date);
  select * into v_item from public.user_training_plan_items where id=p_plan_item_id and user_id=p_user_id for update;
  if not found then raise exception 'Week item not found' using errcode='P0002'; end if;
  if v_item.week_start is null then raise exception 'Week item has no week boundary'; end if;
  v_item_week_end:=v_item.week_start+6;
  if v_item.week_start<>v_anchor_week_start or v_item_week_end<>v_anchor_week_end then raise exception 'Week item is outside the requested week'; end if;
  if p_target_date<v_item.week_start or p_target_date>v_item_week_end then raise exception 'Target date must stay inside the same week'; end if;
  v_date_is_soft:=coalesce((v_item.planning_context_json->>'recommended_date_is_soft')::boolean,true);
  if not v_date_is_soft then raise exception 'This item has a fixed date'; end if;
  if v_item.status not in ('available','claimed') then raise exception 'This item can no longer be moved'; end if;
  if v_item.session_id is not null then select ws.status into v_session_status from public.workout_sessions ws where ws.id=v_item.session_id; if v_session_status in ('in_progress','completed','abandoned') then raise exception 'This session can no longer be moved'; end if; end if;
  v_previous_date:=v_item.recommended_date;
  if v_previous_date is distinct from p_target_date then update public.user_training_plan_items set recommended_date=p_target_date,updated_at=now() where id=v_item.id; v_changed:=true; v_replan:=public.week_replan_persisted_coach_plan_v1(p_user_id,p_anchor_date,'USER_MOVED_WEEK_ITEM',p_plan_item_id,null); end if;
  select count(*)::integer into v_collision_count from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_item.week_start and i.id<>v_item.id and i.recommended_date=p_target_date and i.status in ('available','claimed');
  return jsonb_build_object('contract_version','W11.4_PERSISTED_PLAN','plan_item_id',v_item.id,'previous_date',v_previous_date,'recommended_date',p_target_date,'week_start',v_item.week_start,'week_end',v_item_week_end,'changed',v_changed,'recommended_date_is_soft',true,'has_collision',v_collision_count>0,'collision_count',v_collision_count,'collision_policy','ALLOW_AND_ADVISE','user_debt_created',false,'content_mutated',false,'session_identity_mutated',false,'sequence_mutated',false,'coach_replan',v_replan,'refresh_with','week_read_contract_v2');
end;$function$;

create or replace function public.week_remove_plan_item_v1(p_user_id uuid,p_plan_item_id uuid,p_anchor_date date default current_date)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_item public.user_training_plan_items%rowtype; v_session_status text; v_anchor_week_start date; v_anchor_week_end date; v_session_abandoned boolean:=false; v_replan jsonb:='{}'::jsonb;
begin
  if p_user_id is null or p_plan_item_id is null or p_anchor_date is null then raise exception 'week_remove_plan_item_v1 requires user, item and anchor date'; end if;
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Not allowed to remove another user''s week item' using errcode='42501'; end if;
  v_anchor_week_start:=public.d_week_start(p_anchor_date); v_anchor_week_end:=v_anchor_week_start+6;
  perform pg_advisory_xact_lock(hashtextextended('ugerod:week-edit:'||p_user_id::text||':'||v_anchor_week_start::text,0));
  perform public.week_ensure_persisted_coach_plan_v1(p_user_id,p_anchor_date);
  select * into v_item from public.user_training_plan_items where id=p_plan_item_id and user_id=p_user_id for update;
  if not found then raise exception 'Week item not found' using errcode='P0002'; end if;
  if v_item.week_start<>v_anchor_week_start then raise exception 'Week item is outside the requested week'; end if;
  if v_item.status not in ('available','claimed') then raise exception 'This item can no longer be removed'; end if;
  if v_item.session_id is not null then select ws.status into v_session_status from public.workout_sessions ws where ws.id=v_item.session_id for update; if v_session_status in ('in_progress','completed') then raise exception 'This session can no longer be removed'; end if; if v_session_status='generated' then update public.workout_sessions set status='abandoned',updated_at=now() where id=v_item.session_id; v_session_abandoned:=true; end if; end if;
  update public.user_training_plan_items set status='skipped',planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object('user_removed',true,'user_removed_at',now()::text),updated_at=now() where id=v_item.id;
  v_replan:=public.week_replan_persisted_coach_plan_v1(p_user_id,p_anchor_date,'USER_REMOVED_WEEK_ITEM',p_plan_item_id,v_item.session_id);
  return jsonb_build_object('contract_version','W11_WEEK_REMOVE_V2_PERSISTED_PLAN','plan_item_id',v_item.id,'recommended_date',v_item.recommended_date,'removed',true,'session_abandoned',v_session_abandoned,'user_debt_created',false,'content_deleted',false,'history_deleted',false,'coach_replan',v_replan,'refresh_with','week_read_contract_v2');
end;$function$;