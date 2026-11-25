do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_apply_skill_path_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_zone_terms text[], p_inventory jsonb, p_target_region text, p_max_complexity integer, p_progression_intent text, p_readiness text';
  if v_def is null then raise exception 'c4_apply_skill_path_v1 exact signature not found'; end if;

  v_old:=E'  select hist.path_key,coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)\n  into v_mini_anchor_path,v_mini_last_completed_date\n  from public.workout_sessions ws\n  join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n  join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.active\n  where ws.user_id=p_user_id and ws.status=''completed''\n    and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days\n  order by coalesce(ws.completed_at,ws.created_at) desc,wse.updated_at desc\n  limit 1;\n\n  if v_mini_anchor_path is not null then\n    select count(distinct ws.id)::int into v_mini_completed_exposures\n    from public.workout_sessions ws\n    join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n    join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=v_mini_anchor_path and hist.active\n    where ws.user_id=p_user_id and ws.status=''completed''\n      and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days;\n  end if;';

  v_new:=E'  select case\n    when coalesce((ws.planning_context_json#>>''{architecture,skill_path,mini_cycle,active}'')::boolean,false)\n      and not coalesce((ws.planning_context_json#>>''{architecture,skill_path,mini_cycle,selected_anchor_path}'')::boolean,false)\n      and nullif(ws.planning_context_json#>>''{architecture,skill_path,mini_cycle,anchor_path_key}'','''') is not null\n    then ws.planning_context_json#>>''{architecture,skill_path,mini_cycle,anchor_path_key}''\n    else hist.path_key\n  end\n  into v_mini_anchor_path\n  from public.workout_sessions ws\n  join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n  join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.active\n  where ws.user_id=p_user_id and ws.status=''completed''\n    and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days\n  order by coalesce(ws.completed_at,ws.created_at) desc,wse.updated_at desc\n  limit 1;\n\n  if v_mini_anchor_path is not null then\n    select max(coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)),\n           count(distinct ws.id)::int\n    into v_mini_last_completed_date,v_mini_completed_exposures\n    from public.workout_sessions ws\n    join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n    join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=v_mini_anchor_path and hist.active\n    where ws.user_id=p_user_id and ws.status=''completed''\n      and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days;\n  end if;';

  if position(v_old in v_def)=0 then raise exception 'Mini-cycle anchor block not found; refusing unsafe rewrite'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

comment on function public.c4_apply_skill_path_v1(uuid,jsonb,text[],jsonb,text,integer,text,text)
is 'Skill Path V1 mini-cycle continuity. Forced detours caused by target-region/readiness coherence do not steal an incomplete mini-cycle anchor; the prior anchor may resume while within its exposure/gap window. Safety/equipment/region remain hard gates.';