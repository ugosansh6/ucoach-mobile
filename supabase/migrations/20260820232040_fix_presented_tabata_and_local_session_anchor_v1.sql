create or replace function public.ugerod_effective_session_anchor_date_v1()
returns date
language sql
stable
set search_path='public'
as $function$
  select coalesce(
    nullif(current_setting('ugerod.session_anchor_date', true),'')::date,
    current_date
  );
$function$;

grant execute on function public.ugerod_effective_session_anchor_date_v1() to authenticated,service_role;

-- D1 already owns the authoritative local anchor date. Expose it transaction-locally to nested C4 calls
-- without changing every public function signature.
do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='d_generate_adaptive_session_v2_pre_fatigue_in_place_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_focus_override text, p_duration_minutes integer, p_readiness text, p_target_region_override text, p_progression_intent_override text, p_zone_terms text[], p_inventory jsonb, p_available_equipment text[], p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text, p_anchor_date date, p_force_recalculate_started boolean, p_protected_session_exercise_ids uuid[]';
  if v_def is null then raise exception 'D1 pre-fatigue exact signature not found'; end if;
  v_old:=E'begin\n  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception ''Forbidden user''; end if;';
  v_new:=E'begin\n  perform set_config(''ugerod.session_anchor_date'',v_anchor::text,true);\n  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception ''Forbidden user''; end if;';
  if position(v_old in v_def)=0 then raise exception 'D1 begin marker not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;

-- Skill mini-cycle and same-day continuity must use the session local anchor date, not PostgreSQL UTC date.
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_apply_skill_path_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_zone_terms text[], p_inventory jsonb, p_target_region text, p_max_complexity integer, p_progression_intent text, p_readiness text';
  if v_def is null then raise exception 'c4_apply_skill_path_v1 exact signature not found'; end if;
  if position('current_date' in v_def)=0 then raise exception 'Skill path current_date marker not found'; end if;
  execute replace(v_def,'current_date','public.ugerod_effective_session_anchor_date_v1()');
end $do$;

-- Session Intent / Pattern Complement / Equipment Opportunity anchors must be coherent with D1 local date.
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_plan_full_session'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_plan_full_session exact signature not found'; end if;
  if position('current_date' in v_def)=0 then raise exception 'Planner current_date marker not found'; end if;
  execute replace(v_def,'current_date','public.ugerod_effective_session_anchor_date_v1()');
end $do$;

-- Keep daily deterministic selection aligned to the same local session day.
do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_apply_session_architecture_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_apply_session_architecture_v2 exact signature not found'; end if;
  if position('current_date' in v_def)>0 then
    execute replace(v_def,'current_date','public.ugerod_effective_session_anchor_date_v1()');
  end if;
end $do$;

-- Presented Tabata memory must survive swaps. The current session row only contains the final replacement,
-- so use swap history to remember every exercise that was actually shown to the user.
do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_tabata_variety_penalty_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_exercise_id text';
  if v_def is null then raise exception 'c4_tabata_variety_penalty_v2 exact signature not found'; end if;

  v_old:=E'    from recent_presented rp\n    join public.workout_session_exercises wse\n      on wse.session_id=rp.id\n     and wse.block_key=''tabata''\n     and wse.exercise_id=p_exercise_id';
  v_new:=E'    from recent_presented rp\n    where exists (\n      select 1\n      from public.workout_session_exercises wse\n      where wse.session_id=rp.id\n        and wse.block_key=''tabata''\n        and wse.exercise_id=p_exercise_id\n    )\n    or exists (\n      select 1\n      from public.workout_session_swap_history h\n      join public.workout_session_exercises wse on wse.id=h.session_exercise_id\n      where h.session_id=rp.id\n        and wse.block_key=''tabata''\n        and (h.from_exercise_id=p_exercise_id or h.to_exercise_id=p_exercise_id)\n    )';

  if position(v_old in v_def)=0 then raise exception 'Tabata presented-memory marker not found'; end if;
  execute replace(v_def,v_old,v_new);
end $do$;