-- C4.4a — mechanic + structure diversity as a soft tie-breaker, never a hard safety override.
update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(config,'{anti_redundancy,mechanic_penalty}','10'::jsonb,true),
  '{anti_redundancy,structure_penalty}','12'::jsonb,true
)
where policy_key='c4-final-default';

create or replace function public.c4_redundancy_score(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg jsonb;
  v_recent int;
  v_exact_pen numeric;v_family_pen numeric;v_pattern_pen numeric;v_mechanic_pen numeric;v_structure_pen numeric;
  v_exact_ratio numeric:=0;v_family_ratio numeric:=0;v_pattern_ratio numeric:=0;v_mechanic_ratio numeric:=0;v_structure_ratio numeric:=0;
  v_score numeric:=100;v_recent_count int:=0;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate#>>'{c4_final,mechanic_json,variant_key}',''));
  v_count int:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_structure text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_recent:=coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,3);
  v_exact_pen:=coalesce((v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,45);
  v_family_pen:=coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25);
  v_pattern_pen:=coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15);
  v_mechanic_pen:=coalesce((v_cfg#>>'{anti_redundancy,mechanic_penalty}')::numeric,10);
  v_structure_pen:=coalesce((v_cfg#>>'{anti_redundancy,structure_penalty}')::numeric,12);
  v_structure:=v_mechanic||':'||coalesce(nullif(v_variant,''),'BASE')||':'||v_count::text;

  with recent as (
    select ws.id,
      upper(coalesce(ws.mechanic_json->>'mechanic_key',ws.mechanic_json->>'mechanic','')) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (select count(*) from public.workout_session_exercises z where z.session_id=ws.id and z.block_key='wod') exercise_count
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at) desc
    limit v_recent
  ), cand as (
    select e.id,e.exercise_family,e.movement_pattern,e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
  ), recent_ex as (
    select distinct wse.exercise_id,e.exercise_family,e.movement_pattern
    from recent r join public.workout_session_exercises wse on wse.session_id=r.id and wse.block_key='wod'
    join public.exercises e on e.id=wse.exercise_id
  ), stats as (
    select
      (select count(*) from recent) recent_count,
      (select count(*)::numeric/greatest(1,(select count(*) from cand where not anchor)) from cand c where not c.anchor and exists(select 1 from recent_ex r where r.exercise_id=c.id)) exact_ratio,
      (select count(*)::numeric/greatest(1,(select count(distinct exercise_family) from cand)) from (select distinct exercise_family from cand) c where exists(select 1 from recent_ex r where r.exercise_family=c.exercise_family)) family_ratio,
      (select count(*)::numeric/greatest(1,(select count(distinct movement_pattern) from cand)) from (select distinct movement_pattern from cand) c where exists(select 1 from recent_ex r where r.movement_pattern=c.movement_pattern)) pattern_ratio,
      (select count(*)::numeric/greatest(1,(select count(*) from recent)) from recent r where r.mechanic=v_mechanic) mechanic_ratio,
      (select count(*)::numeric/greatest(1,(select count(*) from recent)) from recent r where (r.mechanic||':'||coalesce(nullif(r.variant_key,''),'BASE')||':'||r.exercise_count::text)=v_structure) structure_ratio
  )
  select recent_count,coalesce(exact_ratio,0),coalesce(family_ratio,0),coalesce(pattern_ratio,0),coalesce(mechanic_ratio,0),coalesce(structure_ratio,0)
  into v_recent_count,v_exact_ratio,v_family_ratio,v_pattern_ratio,v_mechanic_ratio,v_structure_ratio from stats;

  if v_recent_count>0 then
    v_score:=greatest(0,least(100,100-v_exact_ratio*v_exact_pen-v_family_ratio*v_family_pen-v_pattern_ratio*v_pattern_pen-v_mechanic_ratio*v_mechanic_pen-v_structure_ratio*v_structure_pen));
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),'recent_sessions_considered',v_recent_count,
    'exact_non_anchor_overlap_ratio',round(v_exact_ratio,3),'family_overlap_ratio',round(v_family_ratio,3),'pattern_overlap_ratio',round(v_pattern_ratio,3),
    'mechanic_overlap_ratio',round(v_mechanic_ratio,3),'structure_overlap_ratio',round(v_structure_ratio,3),
    'candidate_structure_signature',v_structure,'anchor_exact_repeat_exempt',true,
    'mechanic_structure_is_soft_tiebreaker',true,'version','c4-redundancy-v2-c44'
  );
end;
$$;;
