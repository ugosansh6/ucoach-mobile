create or replace function public.d_finalize_weekly_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_base jsonb; v_user_id uuid; v_anchor_date date:=current_date; v_directives jsonb:=null; v_directives_error text:=null; v_program jsonb:=null; v_program_error text:=null; v_replan jsonb:=null; v_replan_error text:=null; v_persisted_replan jsonb:=null; v_persisted_replan_error text:=null;
begin
  v_base:=public.d_finalize_weekly_session_pre_m89(p_session_id);
  select user_id,coalesce(started_local_date,generation_local_date,current_date) into v_user_id,v_anchor_date from public.workout_sessions where id=p_session_id;
  if v_user_id is not null then
    begin
      v_directives:=public.pi_refresh_coaching_directives(v_user_id,current_date,90);
      update public.coach_post_completion_errors set resolved_at=coalesce(resolved_at,now()),last_seen_at=now() where session_id=p_session_id and stage='PI_REFRESH' and resolved_at is null;
    exception when others then
      v_directives_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text) values(p_session_id,v_user_id,'PI_REFRESH',v_directives_error)
      on conflict(session_id,stage) do update set user_id=excluded.user_id,error_text=excluded.error_text,occurrences=public.coach_post_completion_errors.occurrences+1,last_seen_at=now(),resolved_at=null;
    end;
    begin
      v_program:=public.program_coach_refresh_week_state_v1(v_user_id,current_date);
      update public.coach_post_completion_errors set resolved_at=coalesce(resolved_at,now()),last_seen_at=now() where session_id=p_session_id and stage='PROGRAM_WEEK_REFRESH' and resolved_at is null;
    exception when others then
      v_program_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text) values(p_session_id,v_user_id,'PROGRAM_WEEK_REFRESH',v_program_error)
      on conflict(session_id,stage) do update set user_id=excluded.user_id,error_text=excluded.error_text,occurrences=public.coach_post_completion_errors.occurrences+1,last_seen_at=now(),resolved_at=null;
    end;
    begin
      v_replan:=public.program_coach_replan_after_completed_session_v1(p_session_id,current_date);
      update public.coach_post_completion_errors set resolved_at=coalesce(resolved_at,now()),last_seen_at=now() where session_id=p_session_id and stage='PROGRAM_REPLAN' and resolved_at is null;
    exception when others then
      v_replan_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text) values(p_session_id,v_user_id,'PROGRAM_REPLAN',v_replan_error)
      on conflict(session_id,stage) do update set user_id=excluded.user_id,error_text=excluded.error_text,occurrences=public.coach_post_completion_errors.occurrences+1,last_seen_at=now(),resolved_at=null;
    end;
    begin
      perform public.week_ensure_persisted_coach_plan_v1(v_user_id,v_anchor_date);
      v_persisted_replan:=public.week_replan_persisted_coach_plan_v1(v_user_id,v_anchor_date,'SESSION_COMPLETED',null,p_session_id);
      update public.coach_post_completion_errors set resolved_at=coalesce(resolved_at,now()),last_seen_at=now() where session_id=p_session_id and stage='W11_PERSISTED_REPLAN' and resolved_at is null;
    exception when others then
      v_persisted_replan_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text) values(p_session_id,v_user_id,'W11_PERSISTED_REPLAN',v_persisted_replan_error)
      on conflict(session_id,stage) do update set user_id=excluded.user_id,error_text=excluded.error_text,occurrences=public.coach_post_completion_errors.occurrences+1,last_seen_at=now(),resolved_at=null;
    end;
  end if;
  return v_base||jsonb_build_object('version','d1-finalize-weekly-session-persisted-replan-v2','pi_refresh_after_weekly_finalize',v_directives_error is null,'pi_refresh_error',v_directives_error,'pi_data_maturity',v_directives->'data_maturity','program_coach_shadow_refresh',v_program_error is null,'program_coach_shadow_error',v_program_error,'program_coach_shadow',coalesce(v_program,'{}'::jsonb),'program_coach_replan_shadow',v_replan_error is null,'program_coach_replan_error',v_replan_error,'program_coach_replan',coalesce(v_replan,'{}'::jsonb),'w11_persisted_replan_applied',v_persisted_replan_error is null,'w11_persisted_replan_error',v_persisted_replan_error,'w11_persisted_replan',coalesce(v_persisted_replan,'{}'::jsonb),'user_owned_sessions_replan_protected',true,'post_completion_errors_persisted',true);
end;$function$;