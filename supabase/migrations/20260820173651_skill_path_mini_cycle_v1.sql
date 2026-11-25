update public.session_engine_policy
set config=jsonb_set(
  config,
  '{skill_path,mini_cycle}',
  jsonb_build_object(
    'version','skill-mini-cycle-v1',
    'target_completed_exposures',3,
    'window_days',35,
    'max_gap_days',21,
    'completed_exposures_only',true,
    'same_day_presented_continuity_preserved',true,
    'region_coherence_before_minicycle',true,
    'disable_priority_on_low_readiness_or_deload',true,
    'safety_equipment_and_region_remain_hard_gates',true
  ),true
)
where policy_key='c4-final-default';

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

  v_old:='  v_manual_anchor boolean:=false;';
  v_new:=v_old||E'\n  v_mini_cfg jsonb:=''{}''::jsonb;\n  v_mini_target int:=3;\n  v_mini_window_days int:=35;\n  v_mini_max_gap_days int:=21;\n  v_mini_anchor_path text:=null;\n  v_mini_completed_exposures int:=0;\n  v_mini_last_completed_date date:=null;\n  v_mini_active boolean:=false;';
  if position(v_old in v_def)=0 then raise exception 'Mini-cycle declare insertion point not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=E'  with recent_sessions as (\n';
  v_new:=E'  select coalesce(config#>''{skill_path,mini_cycle}'',''{}''::jsonb) into v_mini_cfg\n  from public.session_engine_policy where policy_key=''c4-final-default'';\n  v_mini_target:=greatest(2,least(coalesce(nullif(v_mini_cfg->>''target_completed_exposures'','''')::int,3),4));\n  v_mini_window_days:=greatest(14,least(coalesce(nullif(v_mini_cfg->>''window_days'','''')::int,35),70));\n  v_mini_max_gap_days:=greatest(7,least(coalesce(nullif(v_mini_cfg->>''max_gap_days'','''')::int,21),35));\n\n  select hist.path_key,coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)\n  into v_mini_anchor_path,v_mini_last_completed_date\n  from public.workout_sessions ws\n  join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n  join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.active\n  where ws.user_id=p_user_id and ws.status=''completed''\n    and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days\n  order by coalesce(ws.completed_at,ws.created_at) desc,wse.updated_at desc\n  limit 1;\n\n  if v_mini_anchor_path is not null then\n    select count(distinct ws.id)::int into v_mini_completed_exposures\n    from public.workout_sessions ws\n    join public.workout_session_exercises wse on wse.session_id=ws.id and wse.block_key=''skill''\n    join public.skill_path_members hist on hist.exercise_id=wse.exercise_id and hist.path_key=v_mini_anchor_path and hist.active\n    where ws.user_id=p_user_id and ws.status=''completed''\n      and coalesce(ws.generation_local_date,ws.completed_at::date,ws.created_at::date)>=current_date-v_mini_window_days;\n  end if;\n\n  v_mini_active:=v_mini_anchor_path is not null\n    and v_mini_completed_exposures between 1 and v_mini_target-1\n    and v_mini_last_completed_date is not null\n    and current_date-v_mini_last_completed_date<=v_mini_max_gap_days\n    and public.normalize_session_readiness(p_readiness)<>''low''\n    and upper(coalesce(p_progression_intent,''''))<>''DELOAD'';\n\n  with recent_sessions as (\n';
  if position(v_old in v_def)=0 then raise exception 'Mini-cycle state insertion point not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=E'  order by\n    case when same_day_continuity then 0 else 1 end,\n    region_rank asc,\n    recent_count asc,';
  v_new:=E'  order by\n    case when same_day_continuity then 0 else 1 end,\n    region_rank asc,\n    case when v_mini_active and path_key=v_mini_anchor_path then 0 else 1 end,\n    recent_count asc,';
  if position(v_old in v_def)=0 then raise exception 'Mini-cycle path ordering insertion point not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:='    ''recent_path_count'',coalesce(v_path.recent_count,0),';
  v_new:=v_old||E'\n    ''mini_cycle'',jsonb_build_object(\n      ''version'',''skill-mini-cycle-v1'',\n      ''active'',v_mini_active,\n      ''anchor_path_key'',v_mini_anchor_path,\n      ''selected_anchor_path'',v_mini_active and v_path.path_key=v_mini_anchor_path,\n      ''completed_exposures_before_session'',v_mini_completed_exposures,\n      ''target_completed_exposures'',v_mini_target,\n      ''window_days'',v_mini_window_days,\n      ''max_gap_days'',v_mini_max_gap_days,\n      ''last_completed_date'',v_mini_last_completed_date,\n      ''completed_exposures_only'',true,\n      ''region_coherence_before_minicycle'',true,\n      ''disabled_by_low_readiness_or_deload'',public.normalize_session_readiness(p_readiness)=''low'' or upper(coalesce(p_progression_intent,''''))=''DELOAD''\n    ),';
  if position(v_old in v_def)=0 then raise exception 'Mini-cycle metadata insertion point not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end $do$;

comment on function public.c4_apply_skill_path_v1(uuid,jsonb,text[],jsonb,text,integer,text,text)
is 'Skill Path V1 with mini-cycle continuity: after opening a completed skill path, prefer the same eligible path until 3 completed exposures within 35 days, max 21-day gap. Safety/equipment/region remain hard gates; low readiness and DELOAD disable mini-cycle priority.';