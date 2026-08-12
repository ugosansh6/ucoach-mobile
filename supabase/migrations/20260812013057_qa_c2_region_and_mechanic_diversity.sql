create or replace function public.simulate_session_engine_c2_raw(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with stimulus as (
  select public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'
  ) s
), mechanic_ranked as (
  select wm.mechanic_key,wm.display_name,
         public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) fit,
         row_number() over(order by public.c2_mechanic_fit(wm.mechanic_key,(select s from stimulus),p_progression_intent) desc,wm.mechanic_key) rn
  from public.workout_mechanics wm
  where wm.active and wm.auto_free_eligible and wm.mechanic_kind='core'
), top_mechanics as (
  select * from mechanic_ranked where rn<=3
), pool_raw as (
  select cp.*,e.transition_cost,e.training_focus,
         coalesce((select array_agg(em.muscle_id order by em.muscle_id)
                   from public.exercise_muscles em
                   where em.exercise_id=cp.exercise_id and em.priority='primary'),'{}'::text[]) primary_muscles
  from public.c2_candidate_pool(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,14
  ) cp
  join public.exercises e on e.id=cp.exercise_id
), pool as (
  select row_number() over(order by candidate_score desc,exercise_id)::int rn,*
  from pool_raw
), combos as (
  select
    a.exercise_id e1,a.exercise_name n1,a.movement_pattern p1,a.exercise_family f1,a.body_region r1,
    a.candidate_score s1,a.score_components sc1,a.primary_muscles m1,coalesce(a.transition_cost,2) t1,a.training_focus tf1,
    b.exercise_id e2,b.exercise_name n2,b.movement_pattern p2,b.exercise_family f2,b.body_region r2,
    b.candidate_score s2,b.score_components sc2,b.primary_muscles m2,coalesce(b.transition_cost,2) t2,b.training_focus tf2,
    c.exercise_id e3,c.exercise_name n3,c.movement_pattern p3,c.exercise_family f3,c.body_region r3,
    c.candidate_score s3,c.score_components sc3,c.primary_muscles m3,coalesce(c.transition_cost,2) t3,c.training_focus tf3,
    m.mechanic_key,m.fit mechanic_fit
  from pool a
  join pool b on b.rn>a.rn
  join pool c on c.rn>b.rn
  cross join top_mechanics m
), assessed as (
  select x.*,
    (select count(distinct q) from unnest(array[x.p1,x.p2,x.p3]) q) pattern_count,
    (select count(distinct q) from unnest(array[x.f1,x.f2,x.f3]) q) family_count,
    ((case when x.r1=p_target_region then 1 else 0 end)
     +(case when x.r2=p_target_region then 1 else 0 end)
     +(case when x.r3=p_target_region then 1 else 0 end))::int target_region_match_count,
    case
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt>=3
      ) then 3
      when exists(
        select 1 from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u group by muscle_id
        ) z where cnt=2
      ) then 2
      else 1
    end max_primary_overlap,
    (x.p1 in ('Conditioning','Locomotion') or x.p2 in ('Conditioning','Locomotion') or x.p3 in ('Conditioning','Locomotion')
     or x.tf1='Conditioning' or x.tf2='Conditioning' or x.tf3='Conditioning') has_conditioning_anchor,
    round((x.s1+x.s2+x.s3)/3.0,2) avg_exercise_score,
    round((x.t1+x.t2+x.t3)/3.0,2) avg_transition_cost
  from combos x
), filtered as (
  select a.*,
    greatest(0,least(100,a.pattern_count/3.0*100))::numeric pattern_diversity,
    case when a.max_primary_overlap>=3 then 35 when a.max_primary_overlap=2 then 72 else 100 end::numeric muscle_diversity
  from assessed a
  where a.pattern_count>=2
    and (p_focus not in ('Conditioning','Fat Loss') or a.has_conditioning_anchor)
    and (
      p_target_region not in ('Upper','Lower','Core')
      or a.target_region_match_count >= case when p_focus in ('Conditioning','Fat Loss') then 1 else 2 end
    )
), scored as (
  select f.*,
    round(f.avg_exercise_score*0.70 + f.pattern_diversity*0.10 + f.muscle_diversity*0.10 + f.mechanic_fit*0.10,2) session_score
  from filtered f
), ranked_sessions as (
  select s.*,
    row_number() over(partition by mechanic_key order by session_score desc,e1,e2,e3) mechanic_rank
  from scored s
), top_sessions as (
  select * from ranked_sessions
  where mechanic_rank <= greatest(1,ceil(greatest(1,least(coalesce(p_candidate_count,5),20))/3.0)::int)
  order by session_score desc,mechanic_key,e1,e2,e3
  limit greatest(1,least(coalesce(p_candidate_count,5),20))
), mechanics_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object('mechanic_key',mechanic_key,'display_name',display_name,'fit',fit)
    order by fit desc,mechanic_key
  ),'[]'::jsonb) j
  from top_mechanics
), sessions_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'coach_score',session_score,
      'mechanic',mechanic_key,
      'mechanic_fit',mechanic_fit,
      'session_components',jsonb_build_object(
        'avg_exercise_coach_score',avg_exercise_score,
        'pattern_diversity',round(pattern_diversity,2),
        'muscle_diversity',muscle_diversity,
        'max_primary_muscle_overlap',max_primary_overlap,
        'conditioning_anchor',has_conditioning_anchor,
        'target_region_match_count',target_region_match_count,
        'target_region',p_target_region,
        'avg_transition_cost',avg_transition_cost
      ),
      'exercises',jsonb_build_array(
        jsonb_build_object('exercise_id',e1,'name',n1,'pattern',p1,'family',f1,'candidate_score',s1,'components',sc1,
          'prescription',public.c2_solver_prescription(p_user_id,e1,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e2,'name',n2,'pattern',p2,'family',f2,'candidate_score',s2,'components',sc2,
          'prescription',public.c2_solver_prescription(p_user_id,e2,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory)),
        jsonb_build_object('exercise_id',e3,'name',n3,'pattern',p3,'family',f3,'candidate_score',s3,'components',sc3,
          'prescription',public.c2_solver_prescription(p_user_id,e3,(select s from stimulus),mechanic_key,p_progression_intent,p_inventory))
      )
    ) order by session_score desc,mechanic_key,e1,e2,e3
  ),'[]'::jsonb) j from top_sessions
)
select jsonb_build_object(
  'version','c2-sim-v1.2',
  'simulation_only',true,
  'mutates_production_state',false,
  'stimulus',(select s from stimulus),
  'normalized_zones',public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])),
  'hard_gate_priority',(select s->'hard_gate_priority' from stimulus),
  'pool_count',(select count(*) from pool),
  'top_mechanics',(select j from mechanics_json),
  'candidate_sessions',(select j from sessions_json),
  'candidate_search_contract',jsonb_build_object(
    'explicit_region_enforced_before_c4',true,
    'mechanic_diversity_quota',true,
    'top_mechanics_considered',(select count(*) from top_mechanics)
  ),
  'known_limitations',jsonb_build_array(
    'whole_wod_round_time_and_volume_simulation_deferred_to_c3',
    'numeric_load_requires_confirmed_inventory_and_capability',
    'exercise_stimulus_is_a_catalog_proxy_until_contextual_simulation_c3'
  )
);
$function$;

create or replace function public.simulate_session_engine_c2(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 5
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_raw jsonb;
  v_filtered jsonb;
  v_requires_anchor boolean := p_focus in ('Conditioning','Fat Loss');
  v_status text := 'OK';
begin
  v_raw := public.simulate_session_engine_c2_raw(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );

  if v_requires_anchor then
    select coalesce(jsonb_agg(s order by ord),'[]'::jsonb)
    into v_filtered
    from jsonb_array_elements(coalesce(v_raw->'candidate_sessions','[]'::jsonb)) with ordinality t(s,ord)
    where exists (
      select 1 from jsonb_array_elements(coalesce(s->'exercises','[]'::jsonb)) e
      where e->>'pattern' in ('Conditioning','Locomotion')
    );
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
    if jsonb_array_length(v_filtered)=0 then v_status := 'NO_SAFE_COHERENT_WOD'; end if;
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}','"c2-sim-v1.2"'::jsonb,true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion',
      'explicit_target_region_enforced',p_target_region in ('Upper','Lower','Core'),
      'never_force_when_no_safe_coherent_candidate',true
    ),true
  );
end;
$function$;

revoke all on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
revoke all on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2_raw(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;
grant execute on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;;
