create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_result jsonb;
  v_exercises jsonb;
  v_n int;
  v_required int;
  v_current int;
  v_mechanic text;
  v_replace_id text;
  v_new jsonb;
  v_rebuilt jsonb;
  v_score numeric;
  r record;
begin
  v_result:=public.c4_expand_candidate_to_block_rules_pre_pref60(
    p_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
  );

  if p_target_region not in ('Upper','Lower','Core') then return v_result; end if;

  v_exercises:=coalesce(v_result->'exercises','[]'::jsonb);
  v_n:=jsonb_array_length(v_exercises);
  if v_n=0 then return v_result; end if;
  v_required:=ceil(v_n*0.60)::int;

  select count(*) into v_current
  from jsonb_array_elements(v_exercises) x
  join public.exercises e on e.id=x->>'exercise_id'
  where e.body_region=p_target_region;

  v_mechanic:=upper(coalesce(v_result->>'mechanic','CIRCUIT'));

  while v_current<v_required loop
    select x->>'exercise_id' into v_replace_id
    from jsonb_array_elements(v_exercises) x
    join public.exercises e on e.id=x->>'exercise_id'
    where e.body_region is distinct from p_target_region
    order by coalesce(nullif(x->>'candidate_score','')::numeric,0), x->>'exercise_id'
    limit 1;
    exit when v_replace_id is null;

    select cp.* into r
    from public.c2_candidate_pool(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,24
    ) cp
    where cp.body_region=p_target_region
      and not exists(select 1 from jsonb_array_elements(v_exercises) z where z->>'exercise_id'=cp.exercise_id)
    order by cp.candidate_score desc,cp.exercise_id
    limit 1;
    exit when not found;

    v_new:=jsonb_build_object(
      'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
      'candidate_score',r.candidate_score,'components',r.score_components,
      'prescription',public.c2_solver_prescription(
        p_user_id,r.exercise_id,
        public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'),
        v_mechanic,p_progression_intent,p_inventory
      )
    );

    select jsonb_agg(case when x->>'exercise_id'=v_replace_id then v_new else x end order by ord)
    into v_rebuilt from jsonb_array_elements(v_exercises) with ordinality z(x,ord);
    v_exercises:=coalesce(v_rebuilt,v_exercises);
    v_current:=v_current+1;
    v_replace_id:=null;
  end loop;

  select round(coalesce(avg(coalesce(nullif(x->>'candidate_score','')::numeric,0)),0)*0.90
               +coalesce(nullif(v_result->>'mechanic_fit','')::numeric,0)*0.10,2)
  into v_score from jsonb_array_elements(v_exercises) x;

  v_result:=jsonb_set(v_result,'{exercises}',v_exercises,true);
  v_result:=jsonb_set(v_result,'{coach_score}',to_jsonb(v_score),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,required_target_region_count}',to_jsonb(v_required),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,final_target_region_count}',to_jsonb(v_current),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,explicit_region_min_share}',to_jsonb(0.60::numeric),true);
  v_result:=jsonb_set(v_result,'{c4_block_rules,preference_contract_version}',to_jsonb('v1-explicit-region-60'::text),true);
  return v_result;
end;
$$;;
