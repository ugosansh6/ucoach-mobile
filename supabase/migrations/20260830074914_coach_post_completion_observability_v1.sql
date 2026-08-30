create table if not exists public.coach_post_completion_errors (
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null,
  stage text not null check(stage in ('PI_REFRESH','PROGRAM_WEEK_REFRESH','PROGRAM_REPLAN')),
  error_text text not null,
  occurrences integer not null default 1 check(occurrences>=1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(session_id,stage)
);

alter table public.coach_post_completion_errors enable row level security;
revoke all on table public.coach_post_completion_errors from public, anon, authenticated;

create index if not exists coach_post_completion_errors_user_unresolved_idx
  on public.coach_post_completion_errors(user_id,last_seen_at desc)
  where resolved_at is null;

comment on table public.coach_post_completion_errors is
'Internal observability for non-blocking coaching refresh failures after a session has been safely completed. Never used as training evidence.';

create or replace function public.d_finalize_weekly_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_base jsonb;
  v_user_id uuid;
  v_directives jsonb:=null;
  v_directives_error text:=null;
  v_program jsonb:=null;
  v_program_error text:=null;
  v_replan jsonb:=null;
  v_replan_error text:=null;
begin
  v_base:=public.d_finalize_weekly_session_pre_m89(p_session_id);
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;

  if v_user_id is not null then
    begin
      v_directives:=public.pi_refresh_coaching_directives(v_user_id,current_date,90);
      update public.coach_post_completion_errors
      set resolved_at=coalesce(resolved_at,now()),last_seen_at=now()
      where session_id=p_session_id and stage='PI_REFRESH' and resolved_at is null;
    exception when others then
      v_directives_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text)
      values(p_session_id,v_user_id,'PI_REFRESH',v_directives_error)
      on conflict(session_id,stage) do update set
        user_id=excluded.user_id,
        error_text=excluded.error_text,
        occurrences=public.coach_post_completion_errors.occurrences+1,
        last_seen_at=now(),
        resolved_at=null;
    end;

    begin
      v_program:=public.program_coach_refresh_week_state_v1(v_user_id,current_date);
      update public.coach_post_completion_errors
      set resolved_at=coalesce(resolved_at,now()),last_seen_at=now()
      where session_id=p_session_id and stage='PROGRAM_WEEK_REFRESH' and resolved_at is null;
    exception when others then
      v_program_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text)
      values(p_session_id,v_user_id,'PROGRAM_WEEK_REFRESH',v_program_error)
      on conflict(session_id,stage) do update set
        user_id=excluded.user_id,
        error_text=excluded.error_text,
        occurrences=public.coach_post_completion_errors.occurrences+1,
        last_seen_at=now(),
        resolved_at=null;
    end;

    begin
      v_replan:=public.program_coach_replan_after_completed_session_v1(p_session_id,current_date);
      update public.coach_post_completion_errors
      set resolved_at=coalesce(resolved_at,now()),last_seen_at=now()
      where session_id=p_session_id and stage='PROGRAM_REPLAN' and resolved_at is null;
    exception when others then
      v_replan_error:=sqlerrm;
      insert into public.coach_post_completion_errors(session_id,user_id,stage,error_text)
      values(p_session_id,v_user_id,'PROGRAM_REPLAN',v_replan_error)
      on conflict(session_id,stage) do update set
        user_id=excluded.user_id,
        error_text=excluded.error_text,
        occurrences=public.coach_post_completion_errors.occurrences+1,
        last_seen_at=now(),
        resolved_at=null;
    end;
  end if;

  return v_base||jsonb_build_object(
    'version','d1-finalize-weekly-session-observable-v1',
    'pi_refresh_after_weekly_finalize',v_directives_error is null,
    'pi_refresh_error',v_directives_error,
    'pi_data_maturity',v_directives->'data_maturity',
    'program_coach_shadow_refresh',v_program_error is null,
    'program_coach_shadow_error',v_program_error,
    'program_coach_shadow',coalesce(v_program,'{}'::jsonb),
    'program_coach_replan_shadow',v_replan_error is null,
    'program_coach_replan_error',v_replan_error,
    'program_coach_replan',coalesce(v_replan,'{}'::jsonb),
    'post_completion_errors_persisted',true
  );
end;
$function$;
