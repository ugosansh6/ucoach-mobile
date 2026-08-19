create or replace function public.c2_candidate_pool_pre_p2b(
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
) returns table(
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
set search_path to 'public'
as $function$
with cfg as materialized (
  select coalesce((
    select upper(config#>>'{program_coach,weekly_budget_mode}')
    from public.session_engine_policy
    where policy_key='c4-final-default'
  ),'SHADOW') as weekly_budget_mode
), snap as materialized (
  select case when c.weekly_budget_mode='ACTIVE'
    then public.program_coach_weekly_scoring_snapshot_v1(p_user_id,current_date)
    else null::jsonb
  end as snapshot
  from cfg c
), base as (
  select *
  from public.c2_candidate_pool_pre_p1b(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_usable_for,p_max_complexity,p_max_difficulty,p_limit
  )
), fitted as (
  select b.*,c.weekly_budget_mode,
         case when c.weekly_budget_mode='ACTIVE'
           then public.c2_weekly_coherence_from_snapshot_v1(b.stimulus_proxy,s.snapshot)
           else public.c2_weekly_coherence_fit_v1(p_user_id,b.exercise_id,current_date)
         end as fit
  from base b
  cross join cfg c
  cross join snap s
)
select f.exercise_id,f.exercise_name,f.movement_pattern,f.exercise_family,f.body_region,
       round(greatest(0,least(100,f.candidate_score + (coalesce(nullif(f.fit->>'score','')::numeric,50)-50)*0.05)),2) candidate_score,
       jsonb_set(
         jsonb_set(coalesce(f.score_components,'{}'::jsonb),'{weekly_coherence}',to_jsonb(coalesce(nullif(f.fit->>'score','')::numeric,50)),true),
         '{weekly_coherence_contract}',coalesce(f.fit,'{}'::jsonb),true
       ) || jsonb_build_object(
         'weekly_coherence_reason',case when f.weekly_budget_mode='ACTIVE'
           then 'realized_week_plus_rolling_10d_program_budget_soft_bias_no_debt'
           else 'realized_week_plus_rolling_10d_soft_bias_no_debt' end,
         'weekly_coherence_score_delta',round((coalesce(nullif(f.fit->>'score','')::numeric,50)-50)*0.05,2),
         'weekly_budget_mode',f.weekly_budget_mode,
         'weekly_budget_snapshot_reused',f.weekly_budget_mode='ACTIVE'
       ) score_components,
       f.stimulus_proxy,f.prescription_simulation
from fitted f
order by candidate_score desc,f.exercise_id
limit greatest(1,least(coalesce(p_limit,20),100));
$function$;
