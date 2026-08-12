-- C4.2 — dynamic composition + mature-capability-aware prescriptions

update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(config,'{capability_prescription,min_confidence}','0.60'::jsonb,true),
      '{capability_prescription,min_freshness}','0.40'::jsonb,true
    ),
    '{capability_prescription,min_valid_evidence}','3'::jsonb,true
  ),
  '{capability_prescription,conservative_fraction}','0.75'::jsonb,true
)
where policy_key='c4-final-default';

-- Resolve a numeric load only when BOTH mature capability and relevant real inventory agree.
create or replace function public.c4_resolve_numeric_load(
  p_exercise_id text,
  p_inventory jsonb,
  p_load_envelope jsonb
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  r record;
  inv jsonb;
  v_cap_max numeric;
  v_inv_load numeric;
  v_best numeric:=null;
  v_equipment text:=null;
  v_scope text:=null;
  v_count int:=1;
  v_total numeric:=null;
begin
  select max(nullif(x->>'load_kg','')::numeric)
  into v_cap_max
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_load_envelope->'frontier','[]'::jsonb))='array' then coalesce(p_load_envelope->'frontier','[]'::jsonb) else '[]'::jsonb end) x;

  if v_cap_max is null or v_cap_max<=0 then
    return jsonb_build_object('confirmed',false,'reason','no_confirmed_load_capability');
  end if;

  for r in
    select els.equipment_id,els.load_scope,greatest(1,coalesce(els.expected_implement_count,1)) expected_count,coalesce(els.symmetric_load,false) symmetric_load
    from public.exercise_load_semantics els
    where els.exercise_id=p_exercise_id
  loop
    for inv in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end)
    loop
      if inv->>'equipment_id'=r.equipment_id and coalesce(nullif(inv->>'quantity','')::int,0)>=r.expected_count then
        v_inv_load:=coalesce(nullif(inv->>'load_kg','')::numeric,nullif(inv->>'max_load_kg','')::numeric);
        if v_inv_load is not null and v_inv_load>0 and v_inv_load<=v_cap_max and (v_best is null or v_inv_load>v_best) then
          v_best:=v_inv_load;v_equipment:=r.equipment_id;v_scope:=r.load_scope;v_count:=r.expected_count;
        end if;
      end if;
    end loop;
  end loop;

  if v_best is null then
    return jsonb_build_object('confirmed',false,'reason','no_inventory_load_within_confirmed_capability','capability_max_load_kg',v_cap_max);
  end if;

  v_total:=case when v_scope='per_implement' then v_best*v_count else v_best end;
  return jsonb_build_object(
    'confirmed',true,'load_kg',v_best,'load_scope',v_scope,'implement_count',v_count,
    'total_external_load_kg',v_total,'equipment_id',v_equipment,'capability_max_load_kg',v_cap_max,
    'source','confirmed_capability_intersect_real_inventory'
  );
end;
$$;

create or replace function public.c2_solver_prescription(
  p_user_id uuid,
  p_exercise_id text,
  p_stimulus jsonb,
  p_mechanic_key text,
  p_progression_intent text default null,
  p_inventory jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
declare
  e record;
  s record;
  c record;
  cfg jsonb;
  v_reps_min int;
  v_reps_max int;
  v_time_min int;
  v_time_max int;
  v_distance_min int;
  v_distance_max int;
  v_rpe_min numeric:=coalesce((p_stimulus#>>'{rpe_target,min}')::numeric,6);
  v_rpe_max numeric:=coalesce((p_stimulus#>>'{rpe_target,max}')::numeric,8);
  v_density numeric:=coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_intent text:=upper(coalesce(p_progression_intent,''));
  v_progress_axis text:='none';
  v_load_strategy text:='not_applicable';
  v_load jsonb:='{}'::jsonb;
  v_numeric_load numeric:=null;
  v_cap_mature boolean:=false;
  v_cap_source text:='generic_catalog_default';
  v_fraction numeric:=0.75;
  v_repeat numeric;
  v_frontier_distance numeric;
begin
  select id,prescription_type,tracking_modes,movement_side,technical_complexity into e
  from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  select config into cfg from public.session_engine_policy where policy_key='c4-final-default';
  select * into s from public.user_exercise_coach_state where user_id=p_user_id and exercise_id=p_exercise_id;
  select * into c from public.user_exercise_capabilities where user_id=p_user_id and exercise_id=p_exercise_id;

  v_fraction:=case v_intent when 'PROGRESS' then 0.82 when 'DELOAD' then 0.60 when 'CONSOLIDATE' then 0.72 when 'RECALIBRATE' then 0.68 else coalesce((cfg#>>'{capability_prescription,conservative_fraction}')::numeric,0.75) end;
  v_cap_mature:=coalesce(c.confidence,0)>=coalesce((cfg#>>'{capability_prescription,min_confidence}')::numeric,0.60)
    and coalesce(c.freshness,0)>=coalesce((cfg#>>'{capability_prescription,min_freshness}')::numeric,0.40)
    and coalesce(c.valid_evidence_count,0)>=coalesce((cfg#>>'{capability_prescription,min_valid_evidence}')::int,3);

  -- Generic fallback remains explicit.
  case coalesce(e.prescription_type,'reps_standard')
    when 'reps_heavy' then v_reps_min:=4;v_reps_max:=8;
    when 'metabolic_high' then v_reps_min:=12;v_reps_max:=16;
    when 'reps_unilateral' then v_reps_min:=8;v_reps_max:=12;
    when 'isometric' then if v_density>=70 then v_time_min:=20;v_time_max:=30; else v_time_min:=30;v_time_max:=40; end if;
    when 'distance' then if upper(p_mechanic_key) in ('AMRAP','FOR_TIME','PROGRESSIVE_INTERVAL','CHIPPER') then v_distance_min:=20;v_distance_max:=40; else v_distance_min:=15;v_distance_max:=30; end if;
    else if upper(p_mechanic_key)='STRENGTH' then v_reps_min:=5;v_reps_max:=8; elsif v_density>=70 then v_reps_min:=8;v_reps_max:=12; else v_reps_min:=6;v_reps_max:=10; end if;
  end case;

  -- Mature observed capability overrides declared/generic dose, conservatively.
  if v_cap_mature then
    if 'reps'=any(e.tracking_modes) then
      v_repeat:=nullif(c.reps_envelope->>'repeatable_reps','')::numeric;
      if v_repeat is not null and v_repeat>0 then
        v_reps_min:=greatest(1,floor(v_repeat*v_fraction)::int);
        v_reps_max:=greatest(v_reps_min,ceil(v_repeat*least(0.90,v_fraction+0.08))::int);
        v_cap_source:='mature_reps_envelope';
      end if;
    end if;

    if 'time'=any(e.tracking_modes) and coalesce(e.prescription_type,'')='isometric' then
      v_repeat:=nullif(c.time_envelope->>'repeatable_seconds','')::numeric;
      if v_repeat is not null and v_repeat>0 then
        v_time_min:=greatest(5,floor(v_repeat*v_fraction/5)*5)::int;
        v_time_max:=greatest(v_time_min,ceil(v_repeat*least(0.90,v_fraction+0.08)/5)*5)::int;
        v_cap_source:='mature_time_envelope';
      end if;
    end if;

    if 'distance'=any(e.tracking_modes) then
      select max(nullif(x->>'distance_meters','')::numeric) into v_frontier_distance
      from jsonb_array_elements(case when jsonb_typeof(coalesce(c.pace_envelope->'frontier','[]'::jsonb))='array' then coalesce(c.pace_envelope->'frontier','[]'::jsonb) else '[]'::jsonb end) x;
      if v_frontier_distance is not null and v_frontier_distance>0 then
        v_distance_min:=greatest(5,floor(v_frontier_distance*v_fraction/5)*5)::int;
        v_distance_max:=greatest(v_distance_min,ceil(v_frontier_distance*least(0.90,v_fraction+0.08)/5)*5)::int;
        v_cap_source:='mature_pace_distance_frontier';
      end if;
    end if;
  end if;

  if 'load'=any(e.tracking_modes) then
    if v_cap_mature then v_load:=public.c4_resolve_numeric_load(p_exercise_id,p_inventory,c.load_envelope); end if;
    if coalesce((v_load->>'confirmed')::boolean,false) then
      v_numeric_load:=nullif(v_load->>'load_kg','')::numeric;
      v_load_strategy:='confirmed_numeric_load';
    elsif exists(select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then p_inventory else '[]'::jsonb end) x where nullif(x->>'load_kg','') is not null or nullif(x->>'max_load_kg','') is not null) then
      v_load_strategy:='inventory_known_capability_unconfirmed';
    else
      v_load_strategy:='no_numeric_load_without_confirmed_inventory_and_capability';
    end if;
  end if;

  if v_intent='PROGRESS' and coalesce(s.recommendation,'') in ('PROGRESS_POSSIBLE','PROGRESS_RECOMMENDED') then
    if 'reps'=any(e.tracking_modes) then v_progress_axis:='reps';
    elsif 'time'=any(e.tracking_modes) then v_progress_axis:='time';
    elsif 'distance'=any(e.tracking_modes) then v_progress_axis:='distance';
    elsif 'load'=any(e.tracking_modes) and v_load_strategy='confirmed_numeric_load' then v_progress_axis:='load'; end if;
  elsif v_intent='RECALIBRATE' then v_progress_axis:='recalibration_only';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'solver_version','c2-prescription-v2-c42','simulation_only',true,'mechanic',upper(p_mechanic_key),
    'prescription_type',e.prescription_type,'tracking_modes',e.tracking_modes,
    'reps_min',v_reps_min,'reps_max',v_reps_max,
    'reps_semantics',case when e.prescription_type='reps_unilateral' then 'per_side' else 'total' end,
    'duration_seconds_min',v_time_min,'duration_seconds_max',v_time_max,
    'distance_meters_min',v_distance_min,'distance_meters_max',v_distance_max,
    'load_kg',v_numeric_load,'load_strategy',v_load_strategy,'load_resolution',case when 'load'=any(e.tracking_modes) then v_load else null end,
    'target_rpe_min',v_rpe_min,'target_rpe_max',v_rpe_max,
    'capability_source',v_cap_source,'capability_mature',v_cap_mature,
    'capability_confidence',case when c.user_id is not null then c.confidence else null end,
    'capability_freshness',case when c.user_id is not null then c.freshness else null end,
    'valid_evidence_count',case when c.user_id is not null then c.valid_evidence_count else null end,
    'progression_axis',v_progress_axis,'progression_budget_rule','at_most_one_axis',
    'unresolved_fields',jsonb_build_array('rounds','cap','whole_wod_density','whole_wod_volume')
  ));
end;
$$;

-- Exercise count is now a solver variable instead of an initial fixed three repaired only upward.
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
)
returns jsonb
language plpgsql
stable
set search_path=public
as $$
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

  -- Mechanic-specific structural contracts take precedence.
  if v_mechanic in ('ODD_EVEN','COUPLET') then v_target:=2; end if;
  if v_mechanic='DECK' then v_target:=4; end if;
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    if upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY' then v_target:=1;
    elsif upper(coalesce(p_candidate->>'variant_key',''))='DEATH_BY_COUPLET' then v_target:=2;
    else v_target:=greatest(v_min,least(v_max,2)); end if;
  end if;

  -- Trim first: retain best-scoring composition; Conditioning anchor is protected.
  if v_count>v_target then
    select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into v_new
    from (
      select value x,row_number() over(order by
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
  select coalesce(array_agg(distinct e.movement_pattern),'{}'::text[]) into v_existing_patterns
  from jsonb_array_elements(v_exercises) x join public.exercises e on e.id=x->>'exercise_id';

  v_needed:=v_target-v_count;
  -- Pass 1 adds new movement patterns; pass 2 fills by score if needed.
  for v_pass in 1..2 loop
    exit when v_needed<=0;
    for r in
      select * from public.c2_candidate_pool(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,60
      ) cp
      where not exists(select 1 from jsonb_array_elements(v_exercises) e where e->>'exercise_id'=cp.exercise_id)
        and (v_pass=2 or not (cp.movement_pattern=any(v_existing_patterns)))
      order by cp.candidate_score desc,cp.exercise_id
    loop
      exit when v_needed<=0;
      v_exercises:=v_exercises||jsonb_build_array(jsonb_build_object(
        'exercise_id',r.exercise_id,'name',r.exercise_name,'pattern',r.movement_pattern,'family',r.exercise_family,
        'candidate_score',r.candidate_score,'components',r.score_components,
        'prescription',public.c2_solver_prescription(p_user_id,r.exercise_id,v_stimulus,v_mechanic,p_progression_intent,p_inventory)
      ));
      v_existing_patterns:=array_append(v_existing_patterns,r.movement_pattern);
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
      'valid_count',jsonb_array_length(v_exercises) between v_min and v_max
    ),true);
end;
$$;;
