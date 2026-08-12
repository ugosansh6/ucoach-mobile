create or replace function public.pi_exercise_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns table(
  exercise_id text,
  exercise_name text,
  movement_pattern text,
  training_focus text,
  body_region text,
  directive text,
  priority_score numeric,
  confidence numeric,
  evidence_count integer,
  source text,
  latest_decision text,
  reason_codes text[]
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with cfg as (
  select coalesce(p_anchor_date,current_date) anchor_date,
         greatest(28,least(coalesce(p_period_days,90),3650)) period_days
), latest_live as (
  select distinct on (cue.exercise_id)
    cue.exercise_id::text,
    cue.decision,
    coalesce(el.created_at,cue.created_at) observed_at
  from public.capability_update_events cue
  left join public.exercise_logs el on el.id=cue.exercise_log_id
  cross join cfg
  where cue.user_id=p_user_id
    and cue.applied
    and coalesce(el.created_at,cue.created_at)::date >= cfg.anchor_date-cfg.period_days
    and coalesce(el.created_at,cue.created_at)::date <= cfg.anchor_date
  order by cue.exercise_id,coalesce(el.created_at,cue.created_at) desc,cue.id desc
), base as (
  select
    cs.exercise_id::text,
    e.name::text exercise_name,
    e.movement_pattern::text,
    e.training_focus::text,
    e.body_region::text,
    coalesce(cs.exposure_count,0)::int exposure_count,
    coalesce(cs.valid_evidence_count,0)::int valid_evidence_count,
    cs.state,
    cs.recommendation,
    coalesce(cs.performance_delta,0)::numeric performance_delta,
    greatest(
      least(1.0,coalesce(cs.capability_confidence,0)::numeric),
      least(1.0,coalesce(cs.overall_confidence,0)::numeric/100.0)
    ) raw_confidence,
    cs.last_observed_at,
    ll.decision latest_decision,
    ll.observed_at latest_live_at,
    cfg.anchor_date,
    cfg.period_days
  from public.user_exercise_coach_state cs
  join public.exercises e on e.id=cs.exercise_id
  cross join cfg
  left join latest_live ll on ll.exercise_id=cs.exercise_id
  where coalesce(cs.exposure_count,0)>0
     or coalesce(cs.valid_evidence_count,0)>0
     or ll.exercise_id is not null
), normalized as (
  select b.*,
    greatest(0,least(1,
      b.raw_confidence * case
        when b.last_observed_at is null then 0.75
        when b.last_observed_at::date >= b.anchor_date-45 then 1.0
        when b.last_observed_at::date >= b.anchor_date-90 then 0.85
        when b.last_observed_at::date >= b.anchor_date-180 then 0.65
        else 0.45 end
    ))::numeric effective_confidence,
    greatest(b.exposure_count,b.valid_evidence_count)::int effective_evidence
  from base b
), classified as (
  select n.*,
    case
      when n.latest_decision='RECALIBRATE' and n.effective_confidence>=0.40 then 'RECALIBRATE'
      when n.latest_decision in ('EXPAND','ADD_FRONTIER_POINT') and n.effective_confidence>=0.45 then 'PROGRESS'
      when n.recommendation='PROGRESS_RECOMMENDED' and n.effective_confidence>=0.55 then 'PROGRESS'
      when n.recommendation='PROGRESS_POSSIBLE' and n.effective_confidence>=0.45 then 'DEVELOP'
      when n.state='RECOVER' and n.effective_evidence>=2 then 'CONSOLIDATE'
      when n.effective_evidence<3 or n.effective_confidence<0.35 then 'LEARN'
      else 'MAINTAIN'
    end directive
  from normalized n
)
select
  c.exercise_id,c.exercise_name,c.movement_pattern,c.training_focus,c.body_region,c.directive,
  round((case c.directive
    when 'RECALIBRATE' then 96
    when 'PROGRESS' then 92
    when 'DEVELOP' then 84
    when 'CONSOLIDATE' then 72
    when 'MAINTAIN' then 62
    else 45 end) * (0.65+0.35*c.effective_confidence),2) priority_score,
  round(c.effective_confidence,4) confidence,
  c.effective_evidence evidence_count,
  case when c.latest_decision is not null then 'b2.7-live-capability'
       when c.recommendation is not null then 'legacy-progress-fallback'
       else 'evidence-learning' end source,
  c.latest_decision,
  array_remove(array[
    case when c.latest_decision='EXPAND' then 'LIVE_CAPABILITY_EXPANDED' end,
    case when c.latest_decision='ADD_FRONTIER_POINT' then 'LIVE_LOAD_FRONTIER_EXPANDED' end,
    case when c.latest_decision='RECALIBRATE' then 'LIVE_CAPABILITY_RECALIBRATION' end,
    case when c.recommendation='PROGRESS_RECOMMENDED' then 'LEGACY_PROGRESS_RECOMMENDED' end,
    case when c.recommendation='PROGRESS_POSSIBLE' then 'LEGACY_PROGRESS_POSSIBLE' end,
    case when c.state='RECOVER' then 'RECOVERY_STATE' end,
    case when c.effective_evidence<3 then 'SPARSE_EVIDENCE' end,
    case when c.effective_confidence<0.35 then 'LOW_CONFIDENCE' end
  ],null)::text[] reason_codes
from classified c
order by priority_score desc,c.exercise_id;
$function$;;
