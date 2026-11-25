-- Atomic, explicitly confirmed edition of a not-started generated composition.
create or replace function public.week_save_composer_revision_v1(p_user_id uuid,p_plan_item_id uuid,p_draft jsonb,p_context jsonb,p_confirm_replacement boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.user_training_plan_items%rowtype; s public.workout_sessions%rowtype; changed boolean; result jsonb; previous uuid;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into item from public.user_training_plan_items where id=p_plan_item_id and user_id=p_user_id for update;
 if not found then raise exception 'PLAN_ITEM_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if item.session_id is not null then
   select * into s from public.workout_sessions where id=item.session_id and user_id=p_user_id for update;
   if not found or s.status<>'generated' or s.started_at is not null then raise exception 'STARTED_OR_CLOSED_SESSION_IMMUTABLE'; end if;
   if s.planning_context_json->>'session_source' is distinct from 'W11_COMPOSER_DAY_J' then raise exception 'NOT_A_COMPOSER_SESSION'; end if;
   changed := (coalesce(s.planning_context_json->'composer_draft','{}')-array['saved_at','prescription_preview','dose_finalization_deferred'])
     is distinct from (p_draft-array['saved_at','prescription_preview','dose_finalization_deferred']);
   if changed and not coalesce(p_confirm_replacement,false) then return jsonb_build_object('status','CONFIRM_REPLACEMENT_REQUIRED','session_id',s.id); end if;
   if changed then
     previous:=s.id;
     update public.workout_sessions set status='abandoned',planning_context_json=planning_context_json||jsonb_build_object('composer_revision_confirmed',true,'composer_revision_confirmed_at',now()),updated_at=now() where id=s.id;
     update public.user_training_plan_items set session_id=null,status='available' where id=item.id;
   end if;
 end if;
 if p_context is not null then perform public.week_update_plan_item_context_v1(p_user_id,p_plan_item_id,p_context); end if;
 result:=public.week_save_composer_draft_v1(p_user_id,p_plan_item_id,p_draft);
 return result||jsonb_build_object('status','SAVED','previous_session_id',previous,'replacement_explicitly_confirmed',previous is not null);
end $$;
revoke all on function public.week_save_composer_revision_v1(uuid,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.week_save_composer_revision_v1(uuid,uuid,jsonb,jsonb,boolean) to authenticated,service_role;
