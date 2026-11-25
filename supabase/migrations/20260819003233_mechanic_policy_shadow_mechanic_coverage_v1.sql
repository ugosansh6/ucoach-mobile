do $patch$
declare v_def text; old_order text; new_order text; old_json text; new_json text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='simulate_session_engine_c2_raw_mechanic_policy_shadow_v1'
  limit 1;
  if v_def is null then raise exception 'Shadow raw C2 not found'; end if;

  old_order:=$old$order by session_score desc,mechanic_key,e1,e2,e3
  limit greatest(1,least(coalesce(p_candidate_count,5),20))$old$;
  new_order:=$new$order by mechanic_rank asc,session_score desc,mechanic_key,e1,e2,e3
  limit greatest(1,least(coalesce(p_candidate_count,5),20))$new$;
  if strpos(v_def,old_order)=0 then raise exception 'Top session ordering fragment not found'; end if;
  v_def:=replace(v_def,old_order,new_order);

  old_json:=$old$select coalesce(jsonb_agg(jsonb_build_object('mechanic_key',mechanic_key,'display_name',display_name,'fit',fit) order by fit desc,mechanic_key),'[]'::jsonb) j
  from top_mechanics$old$;
  new_json:=$new$select coalesce(jsonb_agg(jsonb_build_object(
    'mechanic_key',mechanic_key,'display_name',display_name,'fit',fit,'policy_fit',policy_fit,
    'base_top3',base_rn<=3,'policy_top3',policy_rn<=3,'base_rank',base_rn,'policy_rank',policy_rn
  ) order by least(base_rn,policy_rn),policy_fit desc,fit desc,mechanic_key),'[]'::jsonb) j
  from top_mechanics$new$;
  if strpos(v_def,old_json)=0 then raise exception 'Mechanics JSON fragment not found'; end if;
  v_def:=replace(v_def,old_json,new_json);
  execute v_def;
end;
$patch$;

update public.session_engine_policy
set config=jsonb_set(config,'{mechanic_policy}',coalesce(config->'mechanic_policy','{}'::jsonb)||jsonb_build_object(
  'candidate_coverage_rule','best_candidate_per_explored_mechanic_before_fill',
  'mechanic_policy_explainability',true
),true)
where policy_key='c4-final-default';