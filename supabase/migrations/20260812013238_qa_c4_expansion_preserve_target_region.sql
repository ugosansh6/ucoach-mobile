create or replace function public.c4_expand_candidate_to_block_rules_c42_base(
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
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb:=coalesce(p_candidate->'exercises','[]'::jsonb);
  v_original jsonb:=v_exercises;
  v_count int:=jsonb_array_length(v_exercises);
  v_min int:=0;v_max int:=99;v_pref int;
  v_target int;
  v_needed int;
  r record;
  v_added jsonb:='[]'::jsonb;
  v_trimmed jsonb:='[]'::jsonb;
  v_new jsonb:='[]'::jsonb;
  v_new_score numeric;
  v_stimulus jsonb;
  v_existing_patterns text[]:='{}'::text[];
  v_pass int;
  v_required_region int:=0;
  v_current_region int:=0;
begin
  select min_exercises,max_exercises,preferred_exercises into v_min,v_max,v_pref
  from public.block_rules where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active order by id limit 1;

  if not found then
    return jsonb_set(p_candidate,'{c4_block_rules}',jsonb_build_object('rule_found',false,'exercise_count',v_count,'expanded',false,'dynamic_solver',false),true);
  end if;

  v_pref:=coalesce(v_pref,ceil((v_min+v_max)/2.0)::int);
  if v_min=v_max then v_target:=v_min;
  elsif p_duration_minutes<=35 then v_target:=v_min;
  elsif p_duration_minutes<=55 then v_target:=greatest(v_min,least(v_max,v_pref));
  else v_target:=greatest(v_min,least(v_max,v_pref+1)); end if;

  if v_mechanic in ('ODD_EVEN','COUPLET') then v_target:=2; end if;
  if v_mechanic='DECK' then v_target:=4; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    if upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY' then v_target:=1;
    elsif upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY_COUPLET' then v_target:=2;
    else v_target:=greatest(v_min,least(v_max,2)); end if;
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    v_required_region:=case
      when p_focus in ('Conditioning','Fat Loss') then greatest(1,floor(v_target/2.0)::int)
      else ceil(v_target*0.60)::int
    end;
  end if;

  if v_count>v_target then
    select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into v_new
    from (
      select value x,row_number() over(order by
        case when v_required_region>0 and e.body_region=p_target_region then 0 else 1 end,
        case when p_focus in ('Conditioning','Fat Loss') and (e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion')) then 0 else 1 end,
        coalesce((value->>'candidate_score')::numeric,0) desc,
        value->>'exercise_id') ord
      from jsonb_array_elements(v_exercises) value
      join public.exercises e on e.id=value->>'exercise_id'
      limit v_target
    ) q;
    select coalesce(jsonb_agg(value->>'exercise_id'),'[]'::jsonb) into v_trimmed
    from jsonb_array_elements(v_exercises) value
    where not exists(select 1 from jsonb_array_elements(v_new) z where z->>'exercise_id'=value->>'exercise_id');
    v_exercises:=v_new;v_count:=jsonb_array_length(v_exercises);
  end if;

  v_stimulus:=public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default');
  select coalesce(array_agg(distinct e.movement_pattern),'{}'::text[]),
         count(*) filter(where v_required_region>0 and e.body_region=p_target_region)
  into v_existing_patterns,v_current_region
  from jsonb_array_elements(v_exercises) x join public.exercises e on e.id=x->>'exercise_id';

  v_needed:=v_target-v_count;
  for v_pass in 1..2 loop
    exit when v_needed<=0;
    for r in
      select * from public.c2_candidate_pool(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,60
      ) cp
      where not exists(select 1 from jsonb_array_elements(v_exercises) e where e->>'exercise_id'=cp.exercise_id)
        and (v_pass=2 or not (cp.movement_pattern=any(v_existing_patterns)))
        and (v_required_region=0 or v_current_region>=v_required_region or cp.body_region=p_target_region)
      order by
        case when v_required_region>v_current_region and cp.body_region=p_target_region then 0 else 1 end,
        cp.candidate_score desc,cp.exercise_id
    loop
      exit when v_needed<=0;
      v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
        'candidate_score',r.candidate_score,'components',r.score_components,
        'prescription',public.c2_solver_prescription(p_user_id,r.exercise_id,v_stimulus,v_mechanic,p_progression_intent,p_inventory)
      ));
      v_existing_patterns:=array_append(v_existing_patterns,r.movement_pattern);
      if v_required_region>0 and r.body_region=p_target_region then v_current_region:=v_current_region+1; end if;
      v_added:=v_added||jsonb_build_array(r.exercise_id);v_needed:=v_needed-1;
    end loop;
  end loop;

  select round(coalesce(avg((x->>'candidate_score')::numeric),0)*0.90+coalesce((p_candidate->>'mechanic_fit')::numeric,0)*0.10,2)
  into v_new_score from jsonb_array_elements(v_exercises) x;

  return jsonb_set(jsonb_set(jsonb_set(p_candidate,'{exercises}',v_exercises,true),'{coach_score}',to_jsonb(v_new_score),true),
    '{c4_block_rules}',jsonb_build_object(
      'rule_found',true,'min_exercises',v_min,'max_exercises',v_max,'preferred_exercises',v_pref,
      'solver_target_exercises',v_target,'original_exercise_count',jsonb_array_length(v_original),
      'exercise_count',jsonb_array_length(v_exercises),'dynamic_solver',true,
      'added_exercise_ids',v_added,'trimmed_exercise_ids',v_trimmed,
      'target_region',p_target_region,'required_target_region_count',v_required_region,'final_target_region_count',v_current_region,
      'valid_count',jsonb_array_length(v_exercises) between v_min and v_max
    ),true);
end;
$function$;

revoke all on function public.c4_expand_candidate_to_block_rules_c42_base(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.c4_expand_candidate_to_block_rules_c42_base(jsonb,uuid,text,integer,text,text,text,text[],jsonb,integer,text) to service_role;;
