create or replace function public.c2_candidate_pool(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_usable_for text default 'WOD'::text,
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
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
set search_path=public
as $function$
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
         (select s from stimulus) stimulus,
         public.pi_candidate_fit(p_user_id,hg.exercise_id::text,p_progression_intent) pi_fit
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
    greatest(0,least(100,100 - b.exact_recent*25 - greatest(b.family_recent-b.exact_recent,0)*7))::numeric as session_similarity,
    greatest(0,least(100,coalesce(nullif(b.pi_fit->>'score','')::numeric,50)))::numeric as progression_intelligence_fit
  from base b
), final as (
  select s.*,
    round(
      s.stimulus_fit*0.28 +
      s.progression_fit*0.14 +
      s.prescription_fit*0.14 +
      s.complexity_fit*0.10 +
      s.weekly_coherence*0.05 +
      s.fatigue_fit*0.13 +
      s.session_similarity*0.08 +
      s.progression_intelligence_fit*0.08,2
    ) candidate_score
  from scored s
)
select exercise_id,exercise_name,movement_pattern,exercise_family,body_region,candidate_score,
       jsonb_build_object(
         'stimulus_fit',round(stimulus_fit,2),
         'progression_fit',round(progression_fit,2),
         'progression_intelligence_fit',round(progression_intelligence_fit,2),
         'progression_intelligence',pi_fit,
         'prescription_fit',round(prescription_fit,2),
         'complexity_fit',round(complexity_fit,2),
         'weekly_coherence',weekly_coherence,
         'weekly_coherence_reason','weekly_loop_intent_and_region_supplied_by_d',
         'fatigue_fit',round(fatigue_fit,2),
         'session_similarity',round(session_similarity,2),
         'recent_exact_sessions',exact_recent,
         'recent_family_sessions',family_recent,
         'hard_gate_pass',true,
         'score_weights',jsonb_build_object(
           'stimulus',0.28,'progression',0.14,'progression_intelligence',0.08,'prescription',0.14,
           'complexity',0.10,'weekly_coherence',0.05,'fatigue',0.13,'session_similarity',0.08
         )
       ) score_components,
       proxy stimulus_proxy,
       public.c2_solver_prescription(p_user_id,exercise_id,stimulus,
         case when p_focus='Strength' then 'STRENGTH' when p_focus in ('Conditioning','Fat Loss') then 'AMRAP' else 'CIRCUIT' end,
         p_progression_intent,p_inventory) prescription_simulation
from final
order by candidate_score desc,exercise_id
limit greatest(1,least(coalesce(p_limit,20),100));
$function$;;
