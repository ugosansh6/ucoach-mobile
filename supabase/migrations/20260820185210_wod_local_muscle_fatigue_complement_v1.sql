update public.session_engine_policy
set config=jsonb_set(config,'{local_fatigue_complement}',jsonb_build_object(
  'version','local-fatigue-complement-v1','apply_enabled',true,'primary_muscle_repeat_trigger',3,
  'max_primary_muscle_share',0.60,'max_consecutive_same_primary',2,'quality_delta_floor',-2.0,
  'soft_guard_not_hard_failure',true,'applies_after_equipment_opportunity',true,'preparation_refreshes_after_final_wod',true
),true)
where policy_key='c4-final-default';

create or replace function public.c4_wod_primary_muscle_concentration_v1(p_exercises jsonb)
returns jsonb language sql stable set search_path to 'public'
as $function$
with items as (
  select ord::int position,coalesce(x->>'exercise_id',x->>'id') exercise_id
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_exercises,'[]'::jsonb))='array' then p_exercises else '[]'::jsonb end) with ordinality z(x,ord)
), resolved as (
  select i.position,i.exercise_id,pm.muscle_id,pm.muscle_name
  from items i
  left join lateral (
    select em.muscle_id,m.name muscle_name
    from public.exercise_muscles em join public.muscles m on m.id=em.muscle_id
    where em.exercise_id=i.exercise_id and lower(coalesce(em.priority,''))='primary'
    order by em.muscle_id limit 1
  ) pm on true
), counts as (
  select muscle_id,max(muscle_name) muscle_name,count(*) cnt
  from resolved where muscle_id is not null group by muscle_id
), dom as (
  select * from counts order by cnt desc,muscle_id limit 1
), runs as (
  select r.*,position-row_number() over(partition by muscle_id order by position) grp
  from resolved r where muscle_id is not null
), maxrun as (
  select coalesce(max(cnt),0)::int max_consecutive
  from (select muscle_id,grp,count(*) cnt from runs group by muscle_id,grp) q
), cfg as (
  select coalesce((config#>>'{local_fatigue_complement,primary_muscle_repeat_trigger}')::int,3) trigger_count,
         coalesce((config#>>'{local_fatigue_complement,max_primary_muscle_share}')::numeric,0.60) max_share,
         coalesce((config#>>'{local_fatigue_complement,max_consecutive_same_primary}')::int,2) max_consecutive
  from public.session_engine_policy where policy_key='c4-final-default'
), summary as (
  select count(*)::int total_count,coalesce((select cnt from dom),0)::int dominant_count,
         (select muscle_id from dom) dominant_muscle_id,(select muscle_name from dom) dominant_muscle_name,
         coalesce((select max_consecutive from maxrun),0)::int max_consecutive,
         coalesce((select trigger_count from cfg),3)::int trigger_count,
         coalesce((select max_share from cfg),0.60)::numeric max_share,
         coalesce((select max_consecutive from cfg),2)::int max_allowed_consecutive
  from resolved
)
select jsonb_build_object(
  'version','local-fatigue-primary-muscle-v1',
  'status',case when total_count>=3 and ((dominant_count>=trigger_count and dominant_count::numeric/nullif(total_count,0)>=max_share) or max_consecutive>max_allowed_consecutive) then 'SOFT_OVERCONCENTRATION' else 'WITHIN_BUDGET' end,
  'total_exercises',total_count,'dominant_primary_muscle_id',dominant_muscle_id,'dominant_primary_muscle',dominant_muscle_name,
  'dominant_count',dominant_count,'dominant_share',case when total_count>0 then round(dominant_count::numeric/total_count,4) else 0 end,
  'max_consecutive_same_primary',max_consecutive,
  'sequence',coalesce((select jsonb_agg(jsonb_build_object('position',position,'exercise_id',exercise_id,'primary_muscle_id',muscle_id,'primary_muscle',muscle_name) order by position) from resolved),'[]'::jsonb),
  'soft_guard_only',true
) from summary;
$function$;

grant execute on function public.c4_wod_primary_muscle_concentration_v1(jsonb) to authenticated,service_role;

create or replace function public.c4_session_wod_local_fatigue_swap_allowed_v1(p_session_id uuid,p_position integer,p_candidate_exercise_id text)
returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_current jsonb;v_hyp jsonb;v_before jsonb;v_after jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('exercise_id',exercise_id) order by position),'[]'::jsonb)
  into v_current from public.workout_session_exercises where session_id=p_session_id and block_key='wod';
  select coalesce(jsonb_agg(case when ord::int=p_position then jsonb_build_object('exercise_id',p_candidate_exercise_id) else x end order by ord),'[]'::jsonb)
  into v_hyp from jsonb_array_elements(v_current) with ordinality z(x,ord);
  v_before:=public.c4_wod_primary_muscle_concentration_v1(v_current);v_after:=public.c4_wod_primary_muscle_concentration_v1(v_hyp);
  if coalesce(v_after->>'status','WITHIN_BUDGET')='WITHIN_BUDGET' then return true; end if;
  if coalesce(v_before->>'status','WITHIN_BUDGET')='SOFT_OVERCONCENTRATION' then
    return coalesce((v_after->>'dominant_count')::int,999)<coalesce((v_before->>'dominant_count')::int,999)
      or coalesce((v_after->>'max_consecutive_same_primary')::int,999)<coalesce((v_before->>'max_consecutive_same_primary')::int,999);
  end if;
  return false;
end;$function$;
grant execute on function public.c4_session_wod_local_fatigue_swap_allowed_v1(uuid,integer,text) to authenticated,service_role;

create or replace function public.c4_apply_local_fatigue_complement_v1(
  p_user_id uuid,p_plan jsonb,p_focus text default 'General Fitness',p_duration_minutes integer default 45,p_readiness text default 'normal',
  p_target_region text default null,p_progression_intent text default null,p_zone_terms text[] default '{}'::text[],p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,p_max_difficulty text default 'Intermédiaire',p_candidate_count integer default 12,p_policy_key text default 'c4-final-default'
) returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r jsonb:=coalesce(p_plan,'{}'::jsonb);v_apply boolean:=false;v_delta_floor numeric:=-2;v_wod jsonb;v_metrics jsonb;v_dom text;
  v_replace_pos int;v_replace_id text;v_current jsonb:=coalesce(r->'selected_candidate','{}'::jsonb);
  v_current_fit numeric:=coalesce(nullif(v_current#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);
  v_current_ids text[]:='{}'::text[];v_mechanic text;v_wod_minutes int:=10;c record;v_profile jsonb;v_alt_exercises jsonb;v_alt_base jsonb;
  v_alt_final jsonb;v_alt_fit numeric;v_alt_metrics jsonb;v_best jsonb:=null;v_best_fit numeric:=null;v_best_metrics jsonb:=null;
  v_best_id text:=null;v_best_pattern text:=null;v_best_score numeric:=null;v_quality_delta numeric;v_blocks jsonb;v_examined int:=0;v_feasible int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  if coalesce(r->>'status','')<>'READY' then return r; end if;
  select coalesce((config#>>'{local_fatigue_complement,apply_enabled}')::boolean,false),coalesce((config#>>'{local_fatigue_complement,quality_delta_floor}')::numeric,-2)
  into v_apply,v_delta_floor from public.session_engine_policy where policy_key=p_policy_key;
  if not v_apply then return jsonb_set(r,'{architecture,local_fatigue_complement}',jsonb_build_object('version','local-fatigue-complement-v1','mode','OFF','applied',false),true); end if;
  select b into v_wod from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b where b->>'block_key'='wod' limit 1;
  if v_wod is null then return r; end if;
  v_metrics:=public.c4_wod_primary_muscle_concentration_v1(coalesce(v_wod->'exercises','[]'::jsonb));
  if coalesce(v_metrics->>'status','')<>'SOFT_OVERCONCENTRATION' then
    return jsonb_set(r,'{architecture,local_fatigue_complement}',jsonb_build_object('version','local-fatigue-complement-v1','mode','ACTIVE','applied',false,'reason','WITHIN_LOCAL_FATIGUE_BUDGET','before',v_metrics),true);
  end if;
  v_dom:=v_metrics->>'dominant_primary_muscle_id';
  select (seq->>'position')::int,seq->>'exercise_id' into v_replace_pos,v_replace_id from jsonb_array_elements(coalesce(v_metrics->'sequence','[]'::jsonb)) seq
  where seq->>'primary_muscle_id'=v_dom order by (seq->>'position')::int desc limit 1;
  if v_replace_pos is null then return r; end if;
  select coalesce(array_agg(x->>'exercise_id' order by ord),'{}'::text[]) into v_current_ids from jsonb_array_elements(coalesce(v_wod->'exercises','[]'::jsonb)) with ordinality z(x,ord);
  v_mechanic:=upper(coalesce(v_wod->>'mechanic',v_current->>'mechanic','CIRCUIT'));v_wod_minutes:=coalesce(nullif(v_wod->>'duration_minutes','')::int,10);
  for c in
    select cp.* from public.c2_candidate_pool_pattern_complement_shadow_v1(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,greatest(30,p_candidate_count),current_date,'{}'::jsonb
    ) cp
    where not(cp.exercise_id=any(v_current_ids))
      and not exists(select 1 from public.exercise_muscles em where em.exercise_id=cp.exercise_id and lower(coalesce(em.priority,''))='primary' and em.muscle_id=v_dom)
      and not exists(select 1 from unnest(v_current_ids) id where id<>v_replace_id and public.exercise_functional_group_key_v1(id)=public.exercise_functional_group_key_v1(cp.exercise_id) and public.exercise_functional_group_key_v1(cp.exercise_id) not like 'SELF:%')
    order by cp.candidate_score desc,cp.exercise_id limit 15
  loop
    v_examined:=v_examined+1;v_profile:=public.c4_exercise_mechanic_profile(p_user_id,c.exercise_id,v_mechanic,null,p_readiness,p_progression_intent);
    if not coalesce((v_profile->>'compatible')::boolean,false) or coalesce(v_profile->>'classification','') not in ('NATURAL','ADAPTABLE') then continue; end if;
    select coalesce(jsonb_agg(case when ord::int=v_replace_pos then jsonb_build_object(
      'exercise_id',c.exercise_id,'name',c.exercise_name,'pattern',c.movement_pattern,'family',c.exercise_family,'candidate_score',c.candidate_score,
      'components',coalesce(c.score_components,'{}'::jsonb),'prescription',public.c2_solver_prescription(p_user_id,c.exercise_id,coalesce(r->'stimulus','{}'::jsonb),v_mechanic,p_progression_intent,p_inventory),'mechanic_suitability',v_profile
    ) else x end order by ord),'[]'::jsonb) into v_alt_exercises
    from jsonb_array_elements(coalesce(v_current->'exercises',v_wod->'exercises','[]'::jsonb)) with ordinality z(x,ord);
    v_alt_metrics:=public.c4_wod_primary_muscle_concentration_v1(v_alt_exercises);if coalesce(v_alt_metrics->>'status','')='SOFT_OVERCONCENTRATION' then continue; end if;
    v_alt_base:=(v_current-'c4_final')||jsonb_build_object('exercises',v_alt_exercises,'mechanic',v_mechanic);
    v_alt_final:=public.c4_finalize_candidate(v_alt_base,coalesce(r->'stimulus','{}'::jsonb),p_duration_minutes,v_wod_minutes,p_policy_key,'c3-sim-default');
    if coalesce(v_alt_final#>>'{c4_quality_gate,passed}','true')='false' or not coalesce((v_alt_final#>>'{c4_final,feasible}')::boolean,true) then continue; end if;
    v_alt_fit:=coalesce(nullif(v_alt_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}','')::numeric,0);v_feasible:=v_feasible+1;
    if v_best_fit is null or v_alt_fit>v_best_fit or (v_alt_fit=v_best_fit and c.candidate_score>coalesce(v_best_score,-999)) then
      v_best:=v_alt_final;v_best_fit:=v_alt_fit;v_best_metrics:=v_alt_metrics;v_best_id:=c.exercise_id;v_best_pattern:=c.movement_pattern;v_best_score:=c.candidate_score;
    end if;
  end loop;
  if v_best is null then return jsonb_set(r,'{architecture,local_fatigue_complement}',jsonb_build_object('version','local-fatigue-complement-v1','mode','ACTIVE','applied',false,'reason','NO_SAFE_COHERENT_ALTERNATIVE','before',v_metrics,'examined_candidates',v_examined,'feasible_candidates',v_feasible),true); end if;
  v_quality_delta:=round(v_best_fit-v_current_fit,2);
  if v_quality_delta<v_delta_floor then return jsonb_set(r,'{architecture,local_fatigue_complement}',jsonb_build_object('version','local-fatigue-complement-v1','mode','ACTIVE','applied',false,'reason','QUALITY_TRADEOFF_TOO_LARGE','before',v_metrics,'projected',v_best_metrics,'quality_delta',v_quality_delta,'quality_delta_floor',v_delta_floor),true); end if;
  select coalesce(jsonb_agg(case when b->>'block_key'='wod' then b||jsonb_build_object('mechanic',v_best->>'mechanic','mechanic_json',v_best#>'{c4_final,mechanic_json}','exercises',v_best->'exercises','expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',v_best#>'{c4_final,predicted_volume}','whole_wod_metrics',v_best#>'{c4_final,whole_wod_metrics}')) else b end order by ord),'[]'::jsonb) into v_blocks
  from jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) with ordinality z(b,ord);
  r:=jsonb_set(r,'{blocks}',v_blocks,true);r:=jsonb_set(r,'{selected_candidate}',v_best,true);
  r:=jsonb_set(r,'{architecture,local_fatigue_complement}',jsonb_build_object(
    'version','local-fatigue-complement-v1','mode','ACTIVE','applied',true,'trigger','PRIMARY_MUSCLE_OVERCONCENTRATION',
    'replace',jsonb_build_object('position',v_replace_pos,'exercise_id',v_replace_id,'primary_muscle',v_metrics->>'dominant_primary_muscle'),
    'with',jsonb_build_object('exercise_id',v_best_id,'movement_pattern',v_best_pattern),'before',v_metrics,'after',v_best_metrics,
    'quality_delta',v_quality_delta,'quality_delta_floor',v_delta_floor,'safety_equipment_level_mechanic_and_quality_gates_preserved',true
  ),true);return r;
end;$function$;
grant execute on function public.c4_apply_local_fatigue_complement_v1(uuid,jsonb,text,integer,text,text,text,text[],jsonb,integer,text,integer,text) to authenticated,service_role;

do $do$
declare v_def text;v_marker text;v_insert text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_plan_full_session'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_plan_full_session exact signature not found'; end if;
  v_marker:='  v_plan:=public.c4_apply_preparation_quality_v3(';
  v_insert:=E'  v_plan:=public.c4_apply_local_fatigue_complement_v1(\\n    p_user_id,v_plan,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_zone_terms,p_inventory,\\n    p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key\\n  );\\n  if coalesce(v_plan->>''status'','''')<>''READY'' then return v_plan; end if;\\n\\n  v_plan:=public.c4_apply_preparation_quality_v3(';
  if position(v_marker in v_def)=0 then raise exception 'Planner preparation marker not found'; end if;execute replace(v_def,v_marker,v_insert);
end $do$;

do $do$
declare v_def text;v_old text;v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.proname='c4_wod_swap_candidate_v3_base'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_session_exercise_id uuid, p_direction text, p_excluded_exercise_ids text[], p_target_exercise_id text';
  if v_def is null then raise exception 'c4_wod_swap_candidate_v3_base exact signature not found'; end if;
  v_old:='      and (v_manual_direct_progression or coalesce(ne.technical_complexity,99)<=v_user_max_complexity)';
  v_new:=v_old||E'\\n      and (v_direction=''undo'' or public.c4_session_wod_local_fatigue_swap_allowed_v1(target.session_id,target.position,cp.exercise_id))';
  if position(v_old in v_def)=0 then raise exception 'WOD swap local fatigue marker not found'; end if;execute replace(v_def,v_old,v_new);
end $do$;
