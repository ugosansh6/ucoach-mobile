update public.session_engine_policy
set config=jsonb_set(config,'{mechanic_policy}',coalesce(config->'mechanic_policy','{}'::jsonb)||jsonb_build_object('selection_mode','expand_authoritative_top3_with_policy_top3','policy_fit_role','search_expansion_only','final_candidate_scoring_uses_authoritative_base_fit',true,'max_union_mechanics',6),true)
where policy_key='c4-final-default';

do $patch$
declare v_def text; old_block text; new_block text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='simulate_session_engine_c2_raw_mechanic_policy_shadow_v1' limit 1;
  if v_def is null then raise exception 'Shadow raw C2 not found'; end if;
  old_block:=$old$mechanic_ranked as (
  select wm.mechanic_key,wm.display_name,
         public.c2_mechanic_fit_mechanic_policy_shadow_v1(wm.mechanic_key,(select s from stimulus),p_progression_intent) fit,
         row_number() over(order by public.c2_mechanic_fit_mechanic_policy_shadow_v1(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) rn
  from public.workout_mechanics wm
  where wm.active and wm.auto_free_eligible and wm.mechanic_kind='core'
), top_mechanics as (
  select * from mechanic_ranked where rn<=3
),$old$;
  new_block:=$new$mechanic_ranked as (
  select wm.mechanic_key,wm.display_name,
         public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) fit,
         public.c2_mechanic_fit_mechanic_policy_shadow_v1(wm.mechanic_key,(select s from stimulus),p_progression_intent) policy_fit,
         row_number() over(order by public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) base_rn,
         row_number() over(order by public.c2_mechanic_fit_mechanic_policy_shadow_v1(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) policy_rn
  from public.workout_mechanics wm
  where wm.active and wm.auto_free_eligible and wm.mechanic_kind='core'
), top_mechanics as (
  select mechanic_key,display_name,fit,policy_fit,base_rn,policy_rn from mechanic_ranked where base_rn<=3 or policy_rn<=3
),$new$;
  if strpos(v_def,old_block)=0 then raise exception 'Expected shadow mechanic ranking block not found'; end if;
  execute replace(v_def,old_block,new_block);
end;
$patch$;