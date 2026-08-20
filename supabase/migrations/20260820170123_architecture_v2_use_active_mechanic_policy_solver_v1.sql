do $do$
declare
  v_def text;
  v_old text := $old$  v_wod:=public.solve_session_engine_c4(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
    );$old$;
  v_new text := $new$  if coalesce((
      select (config#>>'{mechanic_policy,apply_enabled}')::boolean
      from public.session_engine_policy
      where policy_key=p_policy_key
    ),false) then
      v_wod:=public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
      );
    else
      v_wod:=public.solve_session_engine_c4(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,v_wod_try,p_policy_key
      );
    end if;$new$;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='c4_apply_session_architecture_v2'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';

  if v_def is null then
    raise exception 'c4_apply_session_architecture_v2 exact signature not found';
  end if;

  if position(v_old in v_def)=0 then
    raise exception 'Expected legacy Architecture V2 solver call not found; refusing unsafe rewrite';
  end if;

  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end
$do$;

comment on function public.c4_apply_session_architecture_v2(uuid,jsonb,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)
is 'Session Architecture V2. When mechanic_policy.apply_enabled=true, final V2 WOD recompilation uses the active mechanic-policy solver so mechanic freshness/policy decisions are not lost. Legacy solver is preserved when mechanic policy is disabled.';
