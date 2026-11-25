-- UGEROD A3 — hierarchical work-rate estimation
-- Level 1: prescription-type defaults
-- Level 2: exercise-specific calibrated/observed rate
-- Level 3: user-specific observed rate

create table if not exists public.c3_work_rate_defaults (
  prescription_type text primary key,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  default_value numeric not null check (default_value > 0),
  source text not null default 'c3_policy_default',
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_work_rate_overrides (
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  source text not null default 'manual_calibration',
  notes text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (exercise_id, metric)
);

create table if not exists public.exercise_work_rate_estimates (
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  user_count integer not null default 0 check (user_count >= 0),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  eligible boolean not null default false,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (exercise_id, metric)
);

create table if not exists public.user_exercise_work_rate_estimates (
  user_id uuid not null references public.profiles(id) on delete cascade,
  exercise_id varchar not null references public.exercises(id) on delete cascade,
  metric text not null check (metric in ('seconds_per_rep','meters_per_second')),
  estimate_value numeric not null check (estimate_value > 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  eligible boolean not null default false,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id, metric)
);

alter table public.c3_work_rate_defaults enable row level security;
alter table public.exercise_work_rate_overrides enable row level security;
alter table public.exercise_work_rate_estimates enable row level security;
alter table public.user_exercise_work_rate_estimates enable row level security;

drop policy if exists c3_work_rate_defaults_read on public.c3_work_rate_defaults;
create policy c3_work_rate_defaults_read on public.c3_work_rate_defaults
for select to authenticated using (true);

drop policy if exists exercise_work_rate_overrides_read on public.exercise_work_rate_overrides;
create policy exercise_work_rate_overrides_read on public.exercise_work_rate_overrides
for select to authenticated using (true);

drop policy if exists exercise_work_rate_estimates_read on public.exercise_work_rate_estimates;
create policy exercise_work_rate_estimates_read on public.exercise_work_rate_estimates
for select to authenticated using (true);

drop policy if exists user_exercise_work_rate_estimates_read_own on public.user_exercise_work_rate_estimates;
create policy user_exercise_work_rate_estimates_read_own on public.user_exercise_work_rate_estimates
for select to authenticated using (auth.uid() = user_id);

revoke all on public.c3_work_rate_defaults from anon;
revoke all on public.exercise_work_rate_overrides from anon;
revoke all on public.exercise_work_rate_estimates from anon;
revoke all on public.user_exercise_work_rate_estimates from anon;

grant select on public.c3_work_rate_defaults to authenticated;
grant select on public.exercise_work_rate_overrides to authenticated;
grant select on public.exercise_work_rate_estimates to authenticated;
grant select on public.user_exercise_work_rate_estimates to authenticated;

-- Seed the generic layer from the explicit C3 policy, not from per-exercise hardcodes.
insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_standard','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_standard_seconds_per_rep}')::numeric,2.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_unilateral','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_unilateral_seconds_per_rep}')::numeric,2.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'reps_heavy','seconds_per_rep',coalesce((config#>>'{operational_assumptions,reps_heavy_seconds_per_rep}')::numeric,3.5),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'metabolic_high','seconds_per_rep',coalesce((config#>>'{operational_assumptions,metabolic_high_seconds_per_rep}')::numeric,1.8),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

insert into public.c3_work_rate_defaults(prescription_type,metric,default_value,source,notes)
select 'distance','meters_per_second',coalesce((config#>>'{operational_assumptions,distance_default_m_per_second}')::numeric,2.0),'c3_policy_default','Generic operational default; replaced by exercise/user evidence when eligible.'
from public.session_engine_policy where policy_key='c3-sim-default'
on conflict (prescription_type) do update set metric=excluded.metric,default_value=excluded.default_value,source=excluded.source,notes=excluded.notes,updated_at=now();

create or replace function public.c3_work_rate_samples(
  p_user_id uuid,
  p_exercise_id text,
  p_metric text,
  p_days integer default 180
)
returns table(sample_user_id uuid, sample_value numeric, quality numeric, observed_at timestamptz)
language sql
stable
set search_path = public
as $$
  select
    l.user_id,
    case
      when p_metric='seconds_per_rep' then l.duration_seconds::numeric / nullif(l.reps_completed,0)
      when p_metric='meters_per_second' then l.distance_meters / nullif(l.duration_seconds,0)
      else null
    end as sample_value,
    greatest(0,least(1,coalesce(l.observation_quality,0.70))) as quality,
    l.created_at
  from public.exercise_logs l
  join public.exercises e on e.id=l.exercise_id
  where l.exercise_id=p_exercise_id
    and (p_user_id is null or l.user_id=p_user_id)
    and l.created_at >= now() - make_interval(days => greatest(1,p_days))
    and l.status='completed'
    and coalesce(l.capability_eligible,false)=true
    and coalesce(l.pain_affected,false)=false
    and l.session_exercise_id is not null
    and coalesce(l.source_kind,'internal')='internal'
    and greatest(0,least(1,coalesce(l.observation_quality,0.70))) >= 0.60
    and coalesce(l.prescription_json->>'prescription_type',e.prescription_type)=e.prescription_type
    and (
      (p_metric='seconds_per_rep'
        and l.reps_completed>0 and l.duration_seconds>0
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'reps'
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'time'
        and l.duration_seconds::numeric/nullif(l.reps_completed,0) between 0.30 and 30.0)
      or
      (p_metric='meters_per_second'
        and l.distance_meters>0 and l.duration_seconds>0
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'distance'
        and coalesce(l.prescription_json->'tracking_modes','[]'::jsonb) ? 'time'
        and l.distance_meters/nullif(l.duration_seconds,0) between 0.10 and 10.0)
    );
$$;

create or replace function public.c3_refresh_work_rate_estimates(
  p_user_id uuid,
  p_exercise_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metric text;
  v_count int;
  v_users int;
  v_value numeric;
  v_quality numeric;
  v_last timestamptz;
  v_conf numeric;
  v_fresh numeric;
begin
  if p_user_id is null or p_exercise_id is null then return; end if;

  delete from public.user_exercise_work_rate_estimates
  where user_id=p_user_id and exercise_id=p_exercise_id;

  delete from public.exercise_work_rate_estimates
  where exercise_id=p_exercise_id;

  foreach v_metric in array array['seconds_per_rep','meters_per_second']
  loop
    with samples as (
      select * from public.c3_work_rate_samples(p_user_id,p_exercise_id,v_metric,180)
      order by observed_at desc
      limit 8
    )
    select count(*), percentile_cont(0.5) within group(order by sample_value)::numeric,
           avg(quality), max(observed_at)
    into v_count,v_value,v_quality,v_last
    from samples;

    if v_count>0 and v_value is not null then
      v_fresh := case
        when v_last >= now()-interval '30 days' then 1.0
        when v_last >= now()-interval '90 days' then 0.8
        when v_last >= now()-interval '180 days' then 0.6
        else 0.0 end;
      v_conf := least(1.0,(v_count::numeric/6.0))*coalesce(v_quality,0);

      insert into public.user_exercise_work_rate_estimates(
        user_id,exercise_id,metric,estimate_value,evidence_count,confidence,freshness,eligible,last_observed_at,updated_at
      ) values (
        p_user_id,p_exercise_id,v_metric,round(v_value,4),v_count,round(v_conf,3),v_fresh,
        (v_count>=3 and v_conf>=0.55 and v_fresh>=0.60),v_last,now()
      );
    end if;

    with samples as (
      select * from public.c3_work_rate_samples(null,p_exercise_id,v_metric,365)
      order by observed_at desc
      limit 100
    )
    select count(*),count(distinct sample_user_id),
           percentile_cont(0.5) within group(order by sample_value)::numeric,
           avg(quality),max(observed_at)
    into v_count,v_users,v_value,v_quality,v_last
    from samples;

    if v_count>0 and v_value is not null then
      v_fresh := case
        when v_last >= now()-interval '60 days' then 1.0
        when v_last >= now()-interval '180 days' then 0.8
        when v_last >= now()-interval '365 days' then 0.6
        else 0.0 end;
      v_conf := least(1.0,(v_count::numeric/12.0)*0.60 + (v_users::numeric/5.0)*0.40) * coalesce(v_quality,0);

      insert into public.exercise_work_rate_estimates(
        exercise_id,metric,estimate_value,evidence_count,user_count,confidence,freshness,eligible,last_observed_at,updated_at
      ) values (
        p_exercise_id,v_metric,round(v_value,4),v_count,v_users,round(v_conf,3),v_fresh,
        (v_count>=8 and v_users>=3 and v_conf>=0.55 and v_fresh>=0.60),v_last,now()
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.c3_refresh_work_rate_estimates(uuid,text) from public,anon,authenticated;

create or replace function public.c3_work_rate_log_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' then
    perform public.c3_refresh_work_rate_estimates(old.user_id,old.exercise_id);
    return old;
  end if;

  if tg_op='UPDATE' and (old.user_id is distinct from new.user_id or old.exercise_id is distinct from new.exercise_id) then
    perform public.c3_refresh_work_rate_estimates(old.user_id,old.exercise_id);
  end if;

  perform public.c3_refresh_work_rate_estimates(new.user_id,new.exercise_id);
  return new;
end;
$$;

revoke all on function public.c3_work_rate_log_refresh_trigger() from public,anon,authenticated;

drop trigger if exists trg_c3_refresh_work_rate_on_log on public.exercise_logs;
create trigger trg_c3_refresh_work_rate_on_log
after insert or delete or update of reps_completed,duration_seconds,distance_meters,observation_quality,capability_eligible,pain_affected,status,session_exercise_id,prescription_json,exercise_id,user_id
on public.exercise_logs
for each row execute function public.c3_work_rate_log_refresh_trigger();

create or replace function public.c3_resolve_work_rate(
  p_exercise_id text,
  p_prescription_type text,
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_metric text;
  v_value numeric;
  v_source text;
  v_evidence int := 0;
  v_conf numeric := 0;
  v_fresh numeric := 0;
  v_last timestamptz;
begin
  v_metric := case
    when p_prescription_type='distance' then 'meters_per_second'
    when p_prescription_type in ('reps_standard','reps_unilateral','reps_heavy','metabolic_high') then 'seconds_per_rep'
    else null end;

  if v_metric is null then
    return jsonb_build_object('metric',null,'value',null,'source','prescribed_time_or_no_rate_needed');
  end if;

  if p_user_id is not null then
    select estimate_value,evidence_count,confidence,freshness,last_observed_at
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.user_exercise_work_rate_estimates
    where user_id=p_user_id and exercise_id=p_exercise_id and metric=v_metric and eligible
    limit 1;
    if found then v_source:='user_observed'; end if;
  end if;

  if v_value is null then
    select estimate_value,0,1,1,null
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.exercise_work_rate_overrides
    where exercise_id=p_exercise_id and metric=v_metric and active
    limit 1;
    if found then v_source:='exercise_calibrated_override'; end if;
  end if;

  if v_value is null then
    select estimate_value,evidence_count,confidence,freshness,last_observed_at
    into v_value,v_evidence,v_conf,v_fresh,v_last
    from public.exercise_work_rate_estimates
    where exercise_id=p_exercise_id and metric=v_metric and eligible
    limit 1;
    if found then v_source:='exercise_observed'; end if;
  end if;

  if v_value is null then
    select default_value into v_value
    from public.c3_work_rate_defaults
    where prescription_type=p_prescription_type and metric=v_metric;
    if v_value is null and v_metric='seconds_per_rep' then
      select default_value into v_value from public.c3_work_rate_defaults where prescription_type='reps_standard';
    end if;
    if v_value is null then v_value := case when v_metric='meters_per_second' then 2.0 else 2.5 end; end if;
    v_source:='prescription_type_default';
    v_evidence:=0; v_conf:=0; v_fresh:=0; v_last:=null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'metric',v_metric,'value',round(v_value,4),'source',v_source,
    'evidence_count',v_evidence,'confidence',v_conf,'freshness',v_fresh,'last_observed_at',v_last,
    'hierarchy','user > exercise_override > exercise_observed > prescription_type_default',
    'version','a3-work-rate-v1'
  ));
end;
$$;

revoke all on function public.c3_resolve_work_rate(text,text,uuid) from public,anon;
grant execute on function public.c3_resolve_work_rate(text,text,uuid) to authenticated;

create or replace function public.c3_unit_estimate(
  p_exercise_id text,
  p_prescription jsonb,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cfg jsonb;
  e record;
  v_type text;
  v_reps_min numeric;
  v_reps_max numeric;
  v_reps_each numeric;
  v_reps_total numeric;
  v_duration_min numeric;
  v_duration_max numeric;
  v_duration numeric;
  v_distance_min numeric;
  v_distance_max numeric;
  v_distance numeric;
  v_rate jsonb;
  v_sec_per_rep numeric;
  v_speed numeric;
  v_work_seconds numeric;
  v_transition_seconds numeric;
  v_primary_muscles text[];
  v_basis text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  select id,prescription_type,tracking_modes,movement_side,fatigue_score,transition_cost,technical_complexity,movement_pattern,exercise_family,body_region
  into e from public.exercises where id=p_exercise_id;
  if not found then raise exception 'Unknown exercise %',p_exercise_id; end if;

  v_type := coalesce(p_prescription->>'prescription_type',e.prescription_type,'reps_standard');
  v_reps_min := nullif(p_prescription->>'reps_min','')::numeric;
  v_reps_max := nullif(p_prescription->>'reps_max','')::numeric;
  v_duration_min := nullif(p_prescription->>'duration_seconds_min','')::numeric;
  v_duration_max := nullif(p_prescription->>'duration_seconds_max','')::numeric;
  v_distance_min := nullif(p_prescription->>'distance_meters_min','')::numeric;
  v_distance_max := nullif(p_prescription->>'distance_meters_max','')::numeric;

  if v_reps_min is not null or v_reps_max is not null then
    v_reps_each := (coalesce(v_reps_min,v_reps_max)+coalesce(v_reps_max,v_reps_min))/2.0;
    v_reps_total := case when coalesce(p_prescription->>'reps_semantics','total')='per_side' then v_reps_each*2 else v_reps_each end;
  end if;

  if v_duration_min is not null or v_duration_max is not null then
    v_duration := (coalesce(v_duration_min,v_duration_max)+coalesce(v_duration_max,v_duration_min))/2.0;
  end if;

  if v_distance_min is not null or v_distance_max is not null then
    v_distance := (coalesce(v_distance_min,v_distance_max)+coalesce(v_distance_max,v_distance_min))/2.0;
  end if;

  v_rate := public.c3_resolve_work_rate(p_exercise_id,v_type,auth.uid());
  if v_rate->>'metric'='seconds_per_rep' then v_sec_per_rep := (v_rate->>'value')::numeric; end if;
  if v_rate->>'metric'='meters_per_second' then v_speed := (v_rate->>'value')::numeric; end if;

  v_work_seconds := case
    when v_duration is not null then v_duration
    when v_distance is not null then v_distance/greatest(0.1,coalesce(v_speed,2.0))
    when v_reps_total is not null then v_reps_total*coalesce(v_sec_per_rep,2.5)
    else 20
  end;

  v_basis := case
    when v_duration is not null then 'prescribed_time'
    when v_distance is not null then coalesce(v_rate->>'source','prescription_type_default')
    when v_reps_total is not null then coalesce(v_rate->>'source','prescription_type_default')
    else 'fallback_20_seconds' end;

  v_transition_seconds := greatest(0,coalesce(e.transition_cost,1)) * coalesce((v_cfg#>>'{operational_assumptions,transition_seconds_per_cost_point}')::numeric,3.0);

  select coalesce(array_agg(em.muscle_id order by em.muscle_id),'{}'::text[])
  into v_primary_muscles
  from public.exercise_muscles em
  where em.exercise_id=p_exercise_id and em.priority='primary';

  return jsonb_strip_nulls(jsonb_build_object(
    'exercise_id',p_exercise_id,
    'prescription_type',v_type,
    'reps_each',round(v_reps_each,2),
    'reps_total',round(v_reps_total,2),
    'duration_seconds',round(v_duration,2),
    'distance_meters',round(v_distance,2),
    'estimated_active_work_seconds',round(v_work_seconds,2),
    'estimated_transition_seconds',round(v_transition_seconds,2),
    'fatigue_score',coalesce(e.fatigue_score,3),
    'technical_complexity',coalesce(e.technical_complexity,3),
    'movement_pattern',e.movement_pattern,
    'exercise_family',e.exercise_family,
    'body_region',e.body_region,
    'primary_muscles',to_jsonb(v_primary_muscles),
    'estimate_basis',v_basis,
    'work_rate_resolution',v_rate,
    'work_rate_version','a3-hierarchical-v1'
  ));
end;
$$;

-- Refresh any existing real observations; no synthetic data is inserted.
do $$
declare r record;
begin
  for r in select distinct user_id,exercise_id from public.exercise_logs where user_id is not null and exercise_id is not null
  loop
    perform public.c3_refresh_work_rate_estimates(r.user_id,r.exercise_id);
  end loop;
end $$;;
