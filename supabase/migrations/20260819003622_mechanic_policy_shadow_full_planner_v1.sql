do $clone$
declare r record; v_def text;
begin
  for r in
    select * from (values
      ('solve_session_engine_c4_pre_p1d','solve_session_engine_c4_pre_p1d_mechanic_policy_shadow_v1','solve_session_engine_c4_raw_v15','solve_session_engine_c4_mechanic_policy_shadow_v1'),
      ('solve_session_engine_c4','solve_session_engine_c4_mechanic_policy_shadow_full_v1','solve_session_engine_c4_pre_p1d','solve_session_engine_c4_pre_p1d_mechanic_policy_shadow_v1'),
      ('c4_plan_full_session_pre_skill_contract_v2','c4_plan_full_session_pre_skill_contract_mechanic_policy_shadow_v1','solve_session_engine_c4','solve_session_engine_c4_mechanic_policy_shadow_full_v1'),
      ('c4_plan_full_session_pre_wod_caps','c4_plan_full_session_pre_wod_caps_mechanic_policy_shadow_v1','c4_plan_full_session_pre_skill_contract_v2','c4_plan_full_session_pre_skill_contract_mechanic_policy_shadow_v1'),
      ('c4_plan_full_session_pre_skill_contract_final_v2','c4_plan_full_session_pre_skill_contract_final_mechanic_policy_shadow_v1','c4_plan_full_session_pre_wod_caps','c4_plan_full_session_pre_wod_caps_mechanic_policy_shadow_v1'),
      ('c4_plan_full_session_pre_preparation_v11','c4_plan_full_session_pre_preparation_v11_mechanic_policy_shadow_v1','c4_plan_full_session_pre_skill_contract_final_v2','c4_plan_full_session_pre_skill_contract_final_mechanic_policy_shadow_v1'),
      ('c4_plan_full_session_pre_preparation_v12','c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow_v1','c4_plan_full_session_pre_preparation_v11','c4_plan_full_session_pre_preparation_v11_mechanic_policy_shadow_v1'),
      ('c4_plan_full_session','c4_plan_full_session_mechanic_policy_shadow_v1','c4_plan_full_session_pre_preparation_v12','c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow_v1')
    ) as t(old_name,new_name,dep_old,dep_new)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=r.old_name
    limit 1;
    if v_def is null then raise exception 'Source function % not found',r.old_name; end if;
    if strpos(v_def,'public.'||r.dep_old||'(')=0 then raise exception 'Dependency % not found in %',r.dep_old,r.old_name; end if;
    v_def:=replace(v_def,'public.'||r.old_name||'(','public.'||r.new_name||'(');
    v_def:=replace(v_def,'public.'||r.dep_old||'(','public.'||r.dep_new||'(');
    execute v_def;
  end loop;
end;
$clone$;

revoke all on function public.solve_session_engine_c4_pre_p1d_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_pre_skill_contract_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_pre_wod_caps_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_pre_skill_contract_final_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_pre_preparation_v11_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;
revoke all on function public.c4_plan_full_session_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) from public,anon,authenticated;

grant execute on function public.solve_session_engine_c4_pre_p1d_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to service_role;
grant execute on function public.solve_session_engine_c4_mechanic_policy_shadow_full_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_pre_skill_contract_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_pre_wod_caps_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_pre_skill_contract_final_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_pre_preparation_v11_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_pre_preparation_v12_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;
grant execute on function public.c4_plan_full_session_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to service_role;