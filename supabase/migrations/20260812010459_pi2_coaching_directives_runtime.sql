create table if not exists public.user_coaching_directive_runtime (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anchor_date date not null,
  period_days integer not null default 90 check (period_days between 28 and 3650),
  source_version text not null,
  directive_json jsonb not null default '{}'::jsonb check (jsonb_typeof(directive_json)='object'),
  refreshed_at timestamptz not null default now()
);

alter table public.user_coaching_directive_runtime enable row level security;
revoke all on table public.user_coaching_directive_runtime from public, anon, authenticated;

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
set search_path=public
as $function$
with cfg as (
  select coalesce(p_anchor_date,current_date) anchor_date,
         greatest(28,least(coalesce(p_period_days,90),3650)) period_days
), latest_live as (
  select distinct on (cue.exercise_id)
    cue.exercise_id::text,
    cue.decision,
    cue.created_at
  from public.capability_update_events cue,cfg
  where cue.user_id=p_user_id
    and cue.applied
    and cue.created_at::date >= cfg.anchor_date-cfg.period_days
    and cue.created_at::date <= cfg.anchor_date
  order by cue.exercise_id,cue.created_at desc,cue.id desc
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
    ll.created_at latest_live_at,
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
      when n.latest_decision='EXPAND' and n.effective_confidence>=0.45 then 'PROGRESS'
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
    case when c.latest_decision='RECALIBRATE' then 'LIVE_CAPABILITY_RECALIBRATION' end,
    case when c.recommendation='PROGRESS_RECOMMENDED' then 'LEGACY_PROGRESS_RECOMMENDED' end,
    case when c.recommendation='PROGRESS_POSSIBLE' then 'LEGACY_PROGRESS_POSSIBLE' end,
    case when c.state='RECOVER' then 'RECOVERY_STATE' end,
    case when c.effective_evidence<3 then 'SPARSE_EVIDENCE' end,
    case when c.effective_confidence<0.35 then 'LOW_CONFIDENCE' end
  ],null)::text[] reason_codes
from classified c
order by priority_score desc,c.exercise_id;
$function$;

create or replace function public.pi_pattern_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns table(
  movement_pattern text,
  directive text,
  priority_score numeric,
  confidence numeric,
  sampled_exercises integer,
  reliable_exercises integer,
  progress_exercises integer,
  develop_exercises integer,
  recalibrate_exercises integer,
  maintain_exercises integer,
  reason_codes text[]
)
language sql
stable
security definer
set search_path=public
as $function$
with x as (
  select * from public.pi_exercise_directives(p_user_id,p_anchor_date,p_period_days)
), a as (
  select
    coalesce(movement_pattern,'Unknown') movement_pattern,
    count(*)::int sampled_exercises,
    count(*) filter(where confidence>=0.55 and evidence_count>=3)::int reliable_exercises,
    count(*) filter(where directive='PROGRESS')::int progress_exercises,
    count(*) filter(where directive='DEVELOP')::int develop_exercises,
    count(*) filter(where directive='RECALIBRATE')::int recalibrate_exercises,
    count(*) filter(where directive in ('MAINTAIN','CONSOLIDATE'))::int maintain_exercises,
    max(priority_score)::numeric max_priority,
    avg(confidence)::numeric avg_confidence,
    max(confidence)::numeric max_confidence
  from x
  group by coalesce(movement_pattern,'Unknown')
), c as (
  select a.*,
    case
      when recalibrate_exercises>=1 and max_confidence>=0.45 then 'RECALIBRATE'
      when progress_exercises>=1 and max_confidence>=0.55 then 'PROGRESS'
      when develop_exercises>=1 and reliable_exercises>=2 and avg_confidence>=0.50 then 'DEVELOPMENT_PRIORITY'
      when maintain_exercises>=1 and reliable_exercises>=1 then 'MAINTAIN'
      else 'LEARN'
    end directive
  from a
)
select
  c.movement_pattern,c.directive,
  round(c.max_priority * case c.directive
    when 'RECALIBRATE' then 1.0
    when 'PROGRESS' then 1.0
    when 'DEVELOPMENT_PRIORITY' then 0.95
    when 'MAINTAIN' then 0.80
    else 0.60 end,2) priority_score,
  round(c.avg_confidence,4) confidence,
  c.sampled_exercises,c.reliable_exercises,c.progress_exercises,c.develop_exercises,c.recalibrate_exercises,c.maintain_exercises,
  array_remove(array[
    case when c.progress_exercises>0 then 'PATTERN_HAS_PROGRESS_CAPACITY' end,
    case when c.develop_exercises>0 then 'PATTERN_HAS_DEVELOPMENT_SIGNALS' end,
    case when c.recalibrate_exercises>0 then 'PATTERN_HAS_RECALIBRATION_SIGNAL' end,
    case when c.reliable_exercises=0 then 'PATTERN_LOW_RELIABLE_EVIDENCE' end
  ],null)::text[] reason_codes
from c
order by priority_score desc,movement_pattern;
$function$;

create or replace function public.pi_coaching_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_days int:=greatest(28,least(coalesce(p_period_days,90),3650));
  v_total_sessions int:=0;
  v_period_sessions int:=0;
  v_live_exercises int:=0;
  v_confident_exercises int:=0;
  v_stage text:='LOW';
  v_hint text:='MAINTAIN';
  v_exercises jsonb:='[]'::jsonb;
  v_patterns jsonb:='[]'::jsonb;
  v_preferred_patterns jsonb:='[]'::jsonb;
  v_preferred_exercises jsonb:='[]'::jsonb;
  v_recalibrate_patterns jsonb:='[]'::jsonb;
  v_preserve_patterns jsonb:='[]'::jsonb;
  v_reason_codes jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  select count(*)::int,
         count(*) filter(where coalesce(completed_at,created_at)::date between v_anchor-v_days and v_anchor)::int
  into v_total_sessions,v_period_sessions
  from public.workout_sessions
  where user_id=p_user_id and status='completed';

  select count(*)::int,count(*) filter(where confidence>=0.60 and valid_evidence_count>=3)::int
  into v_live_exercises,v_confident_exercises
  from public.user_exercise_capabilities
  where user_id=p_user_id;

  v_stage:=case
    when v_total_sessions<4 or v_live_exercises<3 then 'LOW'
    when v_total_sessions<10 or v_confident_exercises<5 then 'MEDIUM'
    else 'HIGH' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exercise_id',x.exercise_id,'name',x.exercise_name,'movement_pattern',x.movement_pattern,
    'training_focus',x.training_focus,'body_region',x.body_region,'directive',x.directive,
    'priority_score',x.priority_score,'confidence',x.confidence,'evidence_count',x.evidence_count,
    'source',x.source,'latest_decision',x.latest_decision,'reason_codes',to_jsonb(x.reason_codes)
  ) order by x.priority_score desc,x.exercise_id),'[]'::jsonb)
  into v_exercises
  from public.pi_exercise_directives(p_user_id,v_anchor,v_days) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'movement_pattern',x.movement_pattern,'directive',x.directive,'priority_score',x.priority_score,
    'confidence',x.confidence,'sampled_exercises',x.sampled_exercises,'reliable_exercises',x.reliable_exercises,
    'progress_exercises',x.progress_exercises,'develop_exercises',x.develop_exercises,
    'recalibrate_exercises',x.recalibrate_exercises,'maintain_exercises',x.maintain_exercises,
    'reason_codes',to_jsonb(x.reason_codes)
  ) order by x.priority_score desc,x.movement_pattern),'[]'::jsonb)
  into v_patterns
  from public.pi_pattern_directives(p_user_id,v_anchor,v_days) x;

  if exists(select 1 from public.pi_pattern_directives(p_user_id,v_anchor,v_days) where directive='RECALIBRATE' and confidence>=0.45) then
    v_hint:='RECALIBRATE';
    v_reason_codes:=v_reason_codes||jsonb_build_array('PI_CONFIRMED_RECALIBRATION_SIGNAL');
  elsif exists(select 1 from public.pi_pattern_directives(p_user_id,v_anchor,v_days) where directive='PROGRESS' and confidence>=0.55) then
    v_hint:='PROGRESS';
    v_reason_codes:=v_reason_codes||jsonb_build_array('PI_CONFIRMED_PROGRESS_SIGNAL');
  elsif exists(select 1 from public.pi_exercise_directives(p_user_id,v_anchor,v_days) where directive='CONSOLIDATE' and confidence>=0.50) then
    v_hint:='CONSOLIDATE';
    v_reason_codes:=v_reason_codes||jsonb_build_array('PI_CONSOLIDATION_SIGNAL');
  else
    v_hint:='MAINTAIN';
    v_reason_codes:=v_reason_codes||jsonb_build_array('PI_NO_STRONG_OVERRIDE');
  end if;

  select coalesce(jsonb_agg(to_jsonb(movement_pattern) order by priority_score desc),'[]'::jsonb)
  into v_preferred_patterns
  from (select movement_pattern,priority_score from public.pi_pattern_directives(p_user_id,v_anchor,v_days)
        where directive in ('PROGRESS','DEVELOPMENT_PRIORITY') order by priority_score desc limit 3) q;

  select coalesce(jsonb_agg(to_jsonb(exercise_id) order by priority_score desc),'[]'::jsonb)
  into v_preferred_exercises
  from (select exercise_id,priority_score from public.pi_exercise_directives(p_user_id,v_anchor,v_days)
        where directive in ('PROGRESS','DEVELOP') order by priority_score desc limit 8) q;

  select coalesce(jsonb_agg(to_jsonb(movement_pattern) order by priority_score desc),'[]'::jsonb)
  into v_recalibrate_patterns
  from (select movement_pattern,priority_score from public.pi_pattern_directives(p_user_id,v_anchor,v_days)
        where directive='RECALIBRATE' order by priority_score desc limit 3) q;

  select coalesce(jsonb_agg(to_jsonb(movement_pattern) order by priority_score desc),'[]'::jsonb)
  into v_preserve_patterns
  from (select movement_pattern,priority_score from public.pi_pattern_directives(p_user_id,v_anchor,v_days)
        where directive='MAINTAIN' and confidence>=0.55 order by priority_score desc limit 3) q;

  return jsonb_build_object(
    'version','pi2-coaching-directives-v1',
    'anchor_date',v_anchor,
    'period_days',v_days,
    'data_maturity',jsonb_build_object(
      'stage',v_stage,'total_completed_sessions',v_total_sessions,'period_completed_sessions',v_period_sessions,
      'live_capability_exercises',v_live_exercises,'confident_capability_exercises',v_confident_exercises
    ),
    'exercise_directives',v_exercises,
    'pattern_directives',v_patterns,
    'session_recommendation',jsonb_build_object(
      'progression_intent_hint',v_hint,
      'preferred_patterns',v_preferred_patterns,
      'preferred_exercise_ids',v_preferred_exercises,
      'recalibration_patterns',v_recalibrate_patterns,
      'preserve_patterns',v_preserve_patterns,
      'reason_codes',v_reason_codes,
      'soft_bias_only',true
    ),
    'guardrails',jsonb_build_object(
      'pain_overrides_progression',true,
      'readiness_overrides_progression',true,
      'user_goal_remains_primary',true,
      'weekly_coherence_remains_active',true,
      'low_confidence_never_becomes_confirmed_weakness',true,
      'free_premium_coaching_identical',true
    )
  );
end;
$function$;

create or replace function public.pi_refresh_coaching_directives(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_period_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_days int:=greatest(28,least(coalesce(p_period_days,90),3650));
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v:=public.pi_coaching_directives(p_user_id,v_anchor,v_days);
  insert into public.user_coaching_directive_runtime(user_id,anchor_date,period_days,source_version,directive_json,refreshed_at)
  values(p_user_id,v_anchor,v_days,coalesce(v->>'version','pi2-coaching-directives-v1'),v,now())
  on conflict(user_id) do update set
    anchor_date=excluded.anchor_date,
    period_days=excluded.period_days,
    source_version=excluded.source_version,
    directive_json=excluded.directive_json,
    refreshed_at=now();
  return v;
end;
$function$;

create or replace function public.pi_candidate_fit(
  p_user_id uuid,
  p_exercise_id text,
  p_progression_intent text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $function$
declare
  v_runtime jsonb;
  v_ex jsonb;
  v_pat jsonb;
  v_pattern text;
  v_ex_dir text;
  v_pat_dir text;
  v_conf numeric:=0;
  v_ex_score numeric:=50;
  v_pat_score numeric:=50;
  v_score numeric:=50;
  v_intent text:=upper(coalesce(p_progression_intent,''));
begin
  select directive_json into v_runtime from public.user_coaching_directive_runtime where user_id=p_user_id;
  if v_runtime is null then
    return jsonb_build_object('score',50,'status','NEUTRAL_NO_RUNTIME','soft_bias_only',true);
  end if;

  select value into v_ex from jsonb_array_elements(coalesce(v_runtime->'exercise_directives','[]'::jsonb))
  where value->>'exercise_id'=p_exercise_id limit 1;
  select movement_pattern into v_pattern from public.exercises where id=p_exercise_id;
  select value into v_pat from jsonb_array_elements(coalesce(v_runtime->'pattern_directives','[]'::jsonb))
  where value->>'movement_pattern'=coalesce(v_pattern,'') limit 1;

  v_ex_dir:=coalesce(v_ex->>'directive','');
  v_pat_dir:=coalesce(v_pat->>'directive','');
  v_conf:=greatest(coalesce(nullif(v_ex->>'confidence','')::numeric,0),coalesce(nullif(v_pat->>'confidence','')::numeric,0));

  v_ex_score:=case v_ex_dir
    when 'PROGRESS' then case when v_intent='PROGRESS' then 98 when v_intent='DELOAD' then 58 else 84 end
    when 'DEVELOP' then case when v_intent='DELOAD' then 55 else 88 end
    when 'RECALIBRATE' then case when v_intent='RECALIBRATE' then 98 else 58 end
    when 'CONSOLIDATE' then case when v_intent in ('CONSOLIDATE','DELOAD') then 88 else 66 end
    when 'MAINTAIN' then 70
    when 'LEARN' then case when v_intent in ('RECALIBRATE','EXPLORE') then 84 else 50 end
    else 50 end;

  v_pat_score:=case v_pat_dir
    when 'PROGRESS' then case when v_intent='PROGRESS' then 94 else 80 end
    when 'DEVELOPMENT_PRIORITY' then case when v_intent='DELOAD' then 55 else 90 end
    when 'RECALIBRATE' then case when v_intent='RECALIBRATE' then 94 else 58 end
    when 'MAINTAIN' then 70
    when 'LEARN' then case when v_intent in ('RECALIBRATE','EXPLORE') then 78 else 50 end
    else 50 end;

  if v_ex is not null then v_score:=v_ex_score*0.75+v_pat_score*0.25; else v_score:=v_pat_score; end if;
  if v_intent='DELOAD' then v_score:=least(v_score,72); end if;
  v_score:=50+(v_score-50)*(0.55+0.45*v_conf);

  return jsonb_build_object(
    'score',round(greatest(0,least(100,v_score)),2),
    'exercise_directive',nullif(v_ex_dir,''),
    'pattern_directive',nullif(v_pat_dir,''),
    'movement_pattern',v_pattern,
    'confidence',round(v_conf,4),
    'progression_intent',nullif(v_intent,''),
    'soft_bias_only',true,
    'runtime_anchor_date',v_runtime->>'anchor_date'
  );
end;
$function$;

revoke execute on function public.pi_exercise_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_pattern_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_refresh_coaching_directives(uuid,date,integer) from public,anon,authenticated;
revoke execute on function public.pi_candidate_fit(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.pi_coaching_directives(uuid,date,integer) from public,anon;
grant execute on function public.pi_coaching_directives(uuid,date,integer) to authenticated;;
