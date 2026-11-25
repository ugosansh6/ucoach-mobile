-- Phase C2 — Coach Score + Solver en simulation (read-only)
-- Does not replace bright-handler and does not mutate capability state.

insert into public.session_engine_policy(policy_key,version,active,config,updated_at)
values (
  'c2-sim-default',
  'c2-sim-v1',
  false,
  jsonb_build_object(
    'simulation_only', true,
    'coach_score_weights', jsonb_build_object(
      'stimulus_fit',0.30,
      'progression_fit',0.15,
      'prescription_fit',0.15,
      'complexity_fit',0.10,
      'weekly_coherence',0.05,
      'fatigue_fit',0.15,
      'session_similarity',0.10
    ),
    'session_mix_weights', jsonb_build_object(
      'exercise_base',0.70,
      'pattern_diversity',0.10,
      'muscle_diversity',0.10,
      'mechanic_fit',0.10
    ),
    'notes', jsonb_build_array(
      'C2 is simulation-only; no production routing.',
      'Weekly coherence is neutral until Phase D.',
      'Numeric load is never invented without a confirmed capability/inventory signal.',
      'Hard gates execute before scoring.'
    )
  ),
  now()
)
on conflict (policy_key) do update
set version=excluded.version, active=false, config=excluded.config, updated_at=now();

create or replace function public.c2_exercise_stimulus_proxy(p_exercise_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  e record;
  v_strength numeric;
  v_conditioning numeric;
  v_endurance numeric;
  v_power numeric;
  v_stability numeric;
  v_mobility numeric;
  v_density numeric;
  v_local_fatigue numeric;
  v_complexity numeric;
begin
  select * into e from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  v_strength := greatest(
    case when e.training_focus='Strength' then 90 else 20 end,
    case when 'load'=any(e.tracking_modes) then 75 else 0 end,
    case when e.exercise_family in ('Squat','Hinge','Lunge','Push','Pull') then 55 else 0 end
  );

  v_conditioning := greatest(
    least(100,coalesce(e.cardio_score,1)*20),
    case when e.training_focus='Conditioning' then 90 else 0 end,
    case when e.movement_pattern in ('Conditioning','Locomotion') then 85 else 0 end
  );

  v_endurance := least(100,
    20
    + coalesce(e.fatigue_score,1)*10
    + case when 'reps'=any(e.tracking_modes) then 15 else 0 end
    + case when e.prescription_type='metabolic_high' then 20 else 0 end
  );

  v_power := greatest(
    case when e.training_focus='Power' then 90 else 20 end,
    case when e.movement_pattern='Jump' then 85 else 0 end
  );

  v_stability := greatest(
    case when e.training_focus='Stability' then 90 else 20 end,
    case when e.exercise_family='Core' then 65 else 0 end,
    case when e.movement_pattern in ('Anti-Extension','Anti-Rotation') then 75 else 0 end
  );

  v_mobility := greatest(
    case when e.training_focus='Mobility' then 90 else 20 end,
    case when e.movement_pattern='Mobility' then 90 else 0 end
  );

  v_density := greatest(0,least(100,
    85 - greatest(coalesce(e.transition_cost,2)-1,0)*15 + (coalesce(e.cardio_score,3)-3)*5
  ));
  v_local_fatigue := greatest(0,least(100,coalesce(e.fatigue_score,3)*20));
  v_complexity := greatest(0,least(100,coalesce(e.technical_complexity,3)*20));

  return jsonb_build_object(
    'proxy_version','c2-exercise-proxy-v1',
    'proxy_only',true,
    'qualities',jsonb_build_object(
      'strength',v_strength,
      'conditioning',v_conditioning,
      'muscular_endurance',v_endurance,
      'power',v_power,
      'stability',v_stability,
      'mobility',v_mobility
    ),
    'density_compatibility',v_density,
    'local_fatigue',v_local_fatigue,
    'complexity',v_complexity
  );
end;
$$;

create or replace function public.c2_mechanic_fit(
  p_mechanic_key text,
  p_stimulus jsonb,
  p_progression_intent text default null
)
returns numeric
language plpgsql
stable
as $$
declare
  s_strength numeric := coalesce((p_stimulus#>>'{qualities,strength,score}')::numeric,50);
  s_cond numeric := coalesce((p_stimulus#>>'{qualities,conditioning,score}')::numeric,50);
  s_end numeric := coalesce((p_stimulus#>>'{qualities,muscular_endurance,score}')::numeric,50);
  s_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  s_complexity numeric := coalesce((p_stimulus#>>'{complexity,score}')::numeric,50);
  m_strength numeric;
  m_cond numeric;
  m_end numeric;
  m_density numeric;
  m_complexity numeric;
  v_score numeric;
  v_intent text := upper(coalesce(p_progression_intent,''));
begin
  case upper(p_mechanic_key)
    when 'AMRAP' then m_strength:=35;m_cond:=90;m_end:=80;m_density:=90;m_complexity:=45;
    when 'EMOM' then m_strength:=50;m_cond:=75;m_end:=65;m_density:=65;m_complexity:=55;
    when 'FOR_TIME' then m_strength:=40;m_cond:=85;m_end:=80;m_density:=80;m_complexity:=50;
    when 'CIRCUIT' then m_strength:=55;m_cond:=65;m_end:=65;m_density:=60;m_complexity:=45;
    when 'LADDER' then m_strength:=60;m_cond:=55;m_end:=80;m_density:=55;m_complexity:=55;
    when 'PYRAMID' then m_strength:=65;m_cond:=45;m_end:=70;m_density:=45;m_complexity:=55;
    when 'STRENGTH' then m_strength:=95;m_cond:=20;m_end:=40;m_density:=30;m_complexity:=60;
    when 'PROGRESSIVE_INTERVAL' then m_strength:=35;m_cond:=80;m_end:=75;m_density:=70;m_complexity:=50;
    else return 0;
  end case;

  v_score := 100 - (
    abs(s_strength-m_strength)*0.20 +
    abs(s_cond-m_cond)*0.30 +
    abs(s_end-m_end)*0.20 +
    abs(s_density-m_density)*0.20 +
    abs(s_complexity-m_complexity)*0.10
  );

  if upper(p_mechanic_key)='PROGRESSIVE_INTERVAL' and v_intent in ('RECALIBRATE','EXPLORE') then
    v_score:=v_score+12;
  end if;
  if upper(p_mechanic_key)='STRENGTH' and v_intent='DELOAD' then
    v_score:=v_score-10;
  end if;

  return round(greatest(0,least(100,v_score)),2);
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
as $$
declare
  e record;
  s record;
  v_reps_min int;
  v_reps_max int;
  v_time_min int;
  v_time_max int;
  v_distance_min int;
  v_distance_max int;
  v_rpe_min numeric := coalesce((p_stimulus#>>'{rpe_target,min}')::numeric,6);
  v_rpe_max numeric := coalesce((p_stimulus#>>'{rpe_target,max}')::numeric,8);
  v_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_intent text := upper(coalesce(p_progression_intent,''));
  v_has_load_inventory boolean := false;
  v_progress_axis text := 'none';
  v_load_strategy text := 'not_applicable';
begin
  select id,prescription_type,tracking_modes,movement_side,technical_complexity
  into e from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  select * into s from public.user_exercise_coach_state
  where user_id=p_user_id and exercise_id=p_exercise_id;

  select exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end) x
    where nullif(x->>'load_kg','') is not null
       or nullif(x->>'max_load_kg','') is not null
       or nullif(x->>'min_load_kg','') is not null
  ) into v_has_load_inventory;

  case coalesce(e.prescription_type,'reps_standard')
    when 'reps_heavy' then v_reps_min:=4;v_reps_max:=8;
    when 'metabolic_high' then v_reps_min:=12;v_reps_max:=16;
    when 'reps_unilateral' then v_reps_min:=8;v_reps_max:=12;
    when 'isometric' then
      if v_density>=70 then v_time_min:=20;v_time_max:=30; else v_time_min:=30;v_time_max:=40; end if;
    when 'distance' then
      if upper(p_mechanic_key) in ('AMRAP','FOR_TIME','PROGRESSIVE_INTERVAL') then v_distance_min:=20;v_distance_max:=40;
      else v_distance_min:=15;v_distance_max:=30; end if;
    else
      if upper(p_mechanic_key)='STRENGTH' then v_reps_min:=5;v_reps_max:=8;
      elsif v_density>=70 then v_reps_min:=8;v_reps_max:=12;
      else v_reps_min:=6;v_reps_max:=10; end if;
  end case;

  if 'load'=any(e.tracking_modes) then
    if coalesce(s.capability_confidence,0)>0 and coalesce(s.load_envelope,'{}'::jsonb)<>'{}'::jsonb and v_has_load_inventory then
      v_load_strategy:='within_confirmed_capability_and_inventory';
    elsif v_has_load_inventory then
      v_load_strategy:='inventory_known_capability_unconfirmed';
    else
      v_load_strategy:='no_numeric_load_without_confirmed_inventory';
    end if;
  end if;

  if v_intent='PROGRESS' and coalesce(s.recommendation,'') in ('PROGRESS_POSSIBLE','PROGRESS_RECOMMENDED') then
    if 'reps'=any(e.tracking_modes) then v_progress_axis:='reps';
    elsif 'time'=any(e.tracking_modes) then v_progress_axis:='time';
    elsif 'distance'=any(e.tracking_modes) then v_progress_axis:='distance';
    elsif 'load'=any(e.tracking_modes) and v_load_strategy='within_confirmed_capability_and_inventory' then v_progress_axis:='load';
    end if;
  elsif v_intent='RECALIBRATE' then
    v_progress_axis:='recalibration_only';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'solver_version','c2-prescription-sim-v1',
    'simulation_only',true,
    'mechanic',upper(p_mechanic_key),
    'prescription_type',e.prescription_type,
    'tracking_modes',e.tracking_modes,
    'reps_min',v_reps_min,
    'reps_max',v_reps_max,
    'reps_semantics',case when e.prescription_type='reps_unilateral' then 'per_side' else 'total' end,
    'duration_seconds_min',v_time_min,
    'duration_seconds_max',v_time_max,
    'distance_meters_min',v_distance_min,
    'distance_meters_max',v_distance_max,
    'target_rpe_min',v_rpe_min,
    'target_rpe_max',v_rpe_max,
    'load_strategy',v_load_strategy,
    'confirmed_load_envelope',case when coalesce(s.capability_confidence,0)>0 then s.load_envelope else null end,
    'progression_axis',v_progress_axis,
    'progression_budget_rule','at_most_one_axis',
    'unresolved_fields',jsonb_build_array('rounds','cap','whole_wod_density','whole_wod_volume')
  ));
end;
$$;

create or replace function public.c2_candidate_pool(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_usable_for text default 'WOD',
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_limit integer default 20
)
returns table(
  exercise_id text,
  exercise_name text,
  movement_pattern text,
  exercise_family text,
  body_region text,
  candidate_score numeric,
  score_components jsonb,
  stimulus_proxy jsonb,
  prescription_simulation jsonb
)
language sql
stable
as $$
with stimulus as (
  select public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default') s
), zones as (
  select public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])) z
), recent_sessions as (
  select ws.id
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.generated_at) desc
  limit 3
), base as (
  select hg.exercise_id::text,hg.exercise_name::text,hg.movement_pattern::text,hg.exercise_family::text,
         e.body_region::text,e.prescription_type,e.tracking_modes,e.technical_complexity,e.fatigue_score,e.transition_cost,e.training_focus,
         public.c2_exercise_stimulus_proxy(hg.exercise_id::text) proxy,
         cs.recommendation,cs.state,cs.exposure_count,cs.overall_confidence,cs.capability_confidence,cs.capability_freshness,
         (select count(distinct rs.id) from recent_sessions rs join public.workout_session_exercises wse on wse.session_id=rs.id where wse.exercise_id=hg.exercise_id) exact_recent,
         (select count(distinct rs.id) from recent_sessions rs join public.workout_session_exercises wse on wse.session_id=rs.id join public.exercises re on re.id=wse.exercise_id where re.exercise_family=hg.exercise_family) family_recent,
         (select s from stimulus) stimulus
  from zones z
  cross join lateral public.session_hard_gate_candidates(z.z,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty) hg
  join public.exercises e on e.id=hg.exercise_id
  left join public.user_exercise_coach_state cs on cs.user_id=p_user_id and cs.exercise_id=hg.exercise_id
  where not coalesce(e.warmup_only,false)
), scored as (
  select b.*,
    greatest(0,least(100,
      (
        (100-abs((b.stimulus#>>'{qualities,strength,score}')::numeric-(b.proxy#>>'{qualities,strength}')::numeric)) * ((b.stimulus#>>'{qualities,strength,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,conditioning,score}')::numeric-(b.proxy#>>'{qualities,conditioning}')::numeric)) * ((b.stimulus#>>'{qualities,conditioning,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric-(b.proxy#>>'{qualities,muscular_endurance}')::numeric)) * ((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,power,score}')::numeric-(b.proxy#>>'{qualities,power}')::numeric)) * ((b.stimulus#>>'{qualities,power,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,stability,score}')::numeric-(b.proxy#>>'{qualities,stability}')::numeric)) * ((b.stimulus#>>'{qualities,stability,score}')::numeric+10) +
        (100-abs((b.stimulus#>>'{qualities,mobility,score}')::numeric-(b.proxy#>>'{qualities,mobility}')::numeric)) * ((b.stimulus#>>'{qualities,mobility,score}')::numeric+10)
      ) / greatest(1,
        ((b.stimulus#>>'{qualities,strength,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,conditioning,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,muscular_endurance,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,power,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,stability,score}')::numeric+10)+
        ((b.stimulus#>>'{qualities,mobility,score}')::numeric+10)
      )
      * 0.85
      + case
          when coalesce(p_target_region,'')='' then 15
          when b.body_region=p_target_region then 15
          when b.body_region='Full Body' then 12
          else 4
        end
    )) as stimulus_fit,
    case upper(coalesce(p_progression_intent,''))
      when 'PROGRESS' then case coalesce(b.recommendation,'') when 'PROGRESS_RECOMMENDED' then 95 when 'PROGRESS_POSSIBLE' then 90 when 'MAINTAIN' then 60 when 'LEARN' then 35 when 'RECOVER' then 10 else 45 end
      when 'MAINTAIN' then case coalesce(b.recommendation,'') when 'MAINTAIN' then 90 when 'LEARN' then 70 when 'PROGRESS_POSSIBLE' then 70 when 'PROGRESS_RECOMMENDED' then 65 when 'RECOVER' then 20 else 60 end
      when 'CONSOLIDATE' then case coalesce(b.recommendation,'') when 'MAINTAIN' then 92 when 'LEARN' then 75 when 'PROGRESS_POSSIBLE' then 70 when 'PROGRESS_RECOMMENDED' then 65 when 'RECOVER' then 20 else 60 end
      when 'DELOAD' then case coalesce(b.recommendation,'') when 'RECOVER' then 85 when 'LEARN' then 75 when 'MAINTAIN' then 75 when 'PROGRESS_POSSIBLE' then 45 when 'PROGRESS_RECOMMENDED' then 40 else 60 end
      when 'RECALIBRATE' then case when coalesce(b.exposure_count,0)=0 then 90 when coalesce(b.capability_freshness,0)<0.35 then 92 when coalesce(b.overall_confidence,0)<35 then 85 else 60 end
      when 'EXPLORE' then case when coalesce(b.exposure_count,0)=0 then 95 when coalesce(b.exposure_count,0)<=2 then 80 else 50 end
      else case coalesce(b.recommendation,'') when 'PROGRESS_RECOMMENDED' then 90 when 'PROGRESS_POSSIBLE' then 85 when 'MAINTAIN' then 75 when 'LEARN' then 60 when 'RECOVER' then 20 else 65 end
    end::numeric as progression_fit,
    greatest(0,least(100,
      case
        when cardinality(b.tracking_modes)=0 then 35
        when 'load'=any(b.tracking_modes) and not exists(
          select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p_inventory,'[]'::jsonb))='array' then coalesce(p_inventory,'[]'::jsonb) else '[]'::jsonb end) x
          where nullif(x->>'load_kg','') is not null or nullif(x->>'max_load_kg','') is not null or nullif(x->>'min_load_kg','') is not null
        ) then 55
        else 78
      end
      + case when b.prescription_type is not null then 8 else 0 end
      + least(12,coalesce(b.capability_confidence,0)*12)
    )) as prescription_fit,
    greatest(0,least(100,
      case when b.technical_complexity*20 > (b.stimulus#>>'{complexity,score}')::numeric
        then 100-abs(b.technical_complexity*20-(b.stimulus#>>'{complexity,score}')::numeric)*1.35
        else 100-abs(b.technical_complexity*20-(b.stimulus#>>'{complexity,score}')::numeric)*0.55 end
    )) as complexity_fit,
    50::numeric as weekly_coherence,
    greatest(0,least(100,
      case when b.fatigue_score*20 > (b.stimulus#>>'{local_fatigue,score}')::numeric
        then 100-abs(b.fatigue_score*20-(b.stimulus#>>'{local_fatigue,score}')::numeric)*1.20
        else 100-abs(b.fatigue_score*20-(b.stimulus#>>'{local_fatigue,score}')::numeric)*0.50 end
    )) as fatigue_fit,
    greatest(0,least(100,100 - b.exact_recent*25 - greatest(b.family_recent-b.exact_recent,0)*7))::numeric as session_similarity
  from base b
), final as (
  select s.*,
    round(
      s.stimulus_fit*0.30 +
      s.progression_fit*0.15 +
      s.prescription_fit*0.15 +
      s.complexity_fit*0.10 +
      s.weekly_coherence*0.05 +
      s.fatigue_fit*0.15 +
      s.session_similarity*0.10,2
    ) candidate_score
  from scored s
)
select exercise_id,exercise_name,movement_pattern,exercise_family,body_region,candidate_score,
       jsonb_build_object(
         'stimulus_fit',round(stimulus_fit,2),
         'progression_fit',round(progression_fit,2),
         'prescription_fit',round(prescription_fit,2),
         'complexity_fit',round(complexity_fit,2),
         'weekly_coherence',weekly_coherence,
         'weekly_coherence_reason','deferred_to_phase_d',
         'fatigue_fit',round(fatigue_fit,2),
         'session_similarity',round(session_similarity,2),
         'recent_exact_sessions',exact_recent,
         'recent_family_sessions',family_recent,
         'hard_gate_pass',true
       ) score_components,
       proxy stimulus_proxy,
       public.c2_solver_prescription(p_user_id,exercise_id,stimulus,
         case when p_focus='Strength' then 'STRENGTH' when p_focus in ('Conditioning','Fat Loss') then 'AMRAP' else 'CIRCUIT' end,
         p_progression_intent,p_inventory) prescription_simulation
from final
order by candidate_score desc,exercise_id
limit greatest(1,least(coalesce(p_limit,20),100));
$$;

create or replace function public.simulate_session_engine_c2(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 5
)
returns jsonb
language sql
stable
as $$
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
    case
      when exists(
        select 1
        from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u
          group by muscle_id
        ) z where cnt>=3
      ) then 3
      when exists(
        select 1
        from (
          select muscle_id,count(*) cnt
          from (
            select unnest(x.m1) muscle_id
            union all select unnest(x.m2)
            union all select unnest(x.m3)
          ) u
          group by muscle_id
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
), scored as (
  select f.*,
    round(f.avg_exercise_score*0.70 + f.pattern_diversity*0.10 + f.muscle_diversity*0.10 + f.mechanic_fit*0.10,2) session_score
  from filtered f
), top_sessions as (
  select * from scored
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
  'version','c2-sim-v1',
  'simulation_only',true,
  'mutates_production_state',false,
  'stimulus',(select s from stimulus),
  'normalized_zones',public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[])),
  'hard_gate_priority',(select s->'hard_gate_priority' from stimulus),
  'pool_count',(select count(*) from pool),
  'top_mechanics',(select j from mechanics_json),
  'candidate_sessions',(select j from sessions_json),
  'known_limitations',jsonb_build_array(
    'weekly_coherence_neutral_until_phase_d',
    'whole_wod_round_time_and_volume_simulation_deferred_to_c3',
    'numeric_load_requires_confirmed_inventory_and_capability',
    'exercise_stimulus_is_a_catalog_proxy_until_contextual_simulation_c3'
  )
);
$$;

comment on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer)
is 'Phase C2 read-only simulation: hard gates -> exercise candidates -> mechanic fit -> draft solver prescription -> candidate session Coach Score. Does not replace production generator.';;
