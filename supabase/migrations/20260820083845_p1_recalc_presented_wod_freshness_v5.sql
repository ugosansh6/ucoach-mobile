create or replace function public.c4_redundancy_score_v5(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_recent int;
  v_exact_pen numeric;v_family_pen numeric;v_pattern_pen numeric;v_mechanic_pen numeric;v_structure_pen numeric;
  v_exact_pressure numeric:=0;v_family_pressure numeric:=0;v_pattern_pressure numeric:=0;v_mechanic_pressure numeric:=0;v_structure_pressure numeric:=0;
  v_score numeric:=100;v_recent_count int:=0;v_completed_count int:=0;v_presented_count int:=0;
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',p_candidate#>>'{c4_final,mechanic_json,mechanic_key}',''));
  v_variant text:=upper(coalesce(p_candidate->>'variant_key',p_candidate#>>'{c4_final,mechanic_json,variant_key}',''));
  v_count int:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_structure text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_recent:=greatest(1,least(coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,5),8));
  v_exact_pen:=coalesce((v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,45);
  v_family_pen:=coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25);
  v_pattern_pen:=coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15);
  v_mechanic_pen:=coalesce((v_cfg#>>'{anti_redundancy,mechanic_penalty}')::numeric,10);
  v_structure_pen:=coalesce((v_cfg#>>'{anti_redundancy,structure_penalty}')::numeric,12);
  v_structure:=v_mechanic||':'||coalesce(nullif(v_variant,''),'BASE')||':'||v_count::text;

  with completed0 as (
    select ws.id,
      row_number() over(order by coalesce(ws.completed_at,ws.generated_at,ws.created_at) desc) rn,
      upper(coalesce(ws.mechanic_json->>'mechanic_key',ws.mechanic_json->>'mechanic','')) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (select count(*) from public.workout_session_exercises z where z.session_id=ws.id and z.block_key='wod') exercise_count,
      'completed'::text memory_type
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at,ws.created_at) desc
    limit v_recent
  ), presented0 as (
    select ws.id,
      row_number() over(order by coalesce(ws.generated_at,ws.created_at) desc) rn,
      upper(coalesce(ws.mechanic_json->>'mechanic_key',ws.mechanic_json->>'mechanic','')) mechanic,
      upper(coalesce(ws.mechanic_json->>'variant_key','')) variant_key,
      (select count(*) from public.workout_session_exercises z where z.session_id=ws.id and z.block_key='wod') exercise_count,
      'presented_only'::text memory_type
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status in ('generated','in_progress','abandoned')
      and ws.generated_workout is not null
      and jsonb_array_length(coalesce(ws.generated_workout->'blocks','[]'::jsonb))>0
      and not (
        ws.status='abandoned'
        and coalesce(ws.generation_local_date,ws.created_at::date)=current_date
        and coalesce(ws.planning_context_json#>>'{daily_refresh,reason}','') in (
          'prestart_safety_refresh','forced_recalculate_started_session'
        )
      )
    order by coalesce(ws.generated_at,ws.created_at) desc
    limit 3
  ), recent as (
    select c.*,
      coalesce(nullif(v_cfg#>>array['anti_redundancy','recency_weights',(c.rn-1)::text],'')::numeric,
        case c.rn when 1 then 1.0 when 2 then 0.75 when 3 then 0.5 when 4 then 0.3 else 0.15 end) weight
    from completed0 c
    union all
    select p.*,
      case p.rn when 1 then 0.45 when 2 then 0.30 else 0.15 end weight
    from presented0 p
  ), cand as (
    select e.id,e.exercise_family,e.movement_pattern,e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
  ), recent_ex as (
    select r.rn,r.weight,r.memory_type,wse.exercise_id,e.exercise_family,e.movement_pattern
    from recent r
    join public.workout_session_exercises wse on wse.session_id=r.id and wse.block_key='wod'
    join public.exercises e on e.id=wse.exercise_id
  ), exact_values as (
    select c.id,coalesce(max(re.weight),0) pressure
    from cand c left join recent_ex re on re.exercise_id=c.id
    where not c.anchor
    group by c.id
  ), family_values as (
    select c.exercise_family,coalesce(max(re.weight),0) pressure
    from (select distinct exercise_family from cand where exercise_family is not null) c
    left join recent_ex re on re.exercise_family=c.exercise_family
    group by c.exercise_family
  ), pattern_values as (
    select c.movement_pattern,coalesce(max(re.weight),0) pressure
    from (select distinct movement_pattern from cand where movement_pattern is not null) c
    left join recent_ex re on re.movement_pattern=c.movement_pattern
    group by c.movement_pattern
  )
  select
    (select count(*) from recent),
    (select count(*) from recent where memory_type='completed'),
    (select count(*) from recent where memory_type='presented_only'),
    coalesce((select avg(pressure) from exact_values),0),
    coalesce((select avg(pressure) from family_values),0),
    coalesce((select avg(pressure) from pattern_values),0),
    coalesce((select max(weight) from recent where mechanic=v_mechanic),0),
    coalesce((select max(weight) from recent where (mechanic||':'||coalesce(nullif(variant_key,''),'BASE')||':'||exercise_count::text)=v_structure),0)
  into v_recent_count,v_completed_count,v_presented_count,v_exact_pressure,v_family_pressure,v_pattern_pressure,v_mechanic_pressure,v_structure_pressure;

  if v_recent_count>0 then
    v_score:=greatest(0,least(100,
      100-v_exact_pressure*v_exact_pen-v_family_pressure*v_family_pen-v_pattern_pressure*v_pattern_pen-v_mechanic_pressure*v_mechanic_pen-v_structure_pressure*v_structure_pen
    ));
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),'recent_sessions_considered',v_recent_count,
    'completed_sessions_considered',v_completed_count,
    'presented_only_sessions_considered',v_presented_count,
    'presented_only_latest_weight',0.45,
    'presented_only_is_soft_memory',true,
    'new_checkin_replaced_session_is_soft_memory',true,
    'exact_non_anchor_overlap_ratio',round(v_exact_pressure,3),'family_overlap_ratio',round(v_family_pressure,3),'pattern_overlap_ratio',round(v_pattern_pressure,3),
    'mechanic_overlap_ratio',round(v_mechanic_pressure,3),'structure_overlap_ratio',round(v_structure_pressure,3),
    'candidate_structure_signature',v_structure,'anchor_exact_repeat_exempt',true,
    'recency_weighted',true,'recent_session_limit',v_recent,
    'recency_weights',coalesce(v_cfg#>'{anti_redundancy,recency_weights}','[1.0,0.75,0.5,0.3,0.15]'::jsonb),
    'mechanic_structure_is_soft_tiebreaker',true,
    'presented_memory_does_not_create_training_evidence',true,
    'version','c4-redundancy-v5-new-checkin-soft-memory'
  );
end;
$function$;

create or replace function public.c4_redundancy_score(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select public.c4_redundancy_score_v5(p_user_id,p_candidate,p_policy_key);
$function$;