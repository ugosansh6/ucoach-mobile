-- UGEROD Phase C1 — Session Engine stimulus contract
-- Pure, explainable target builder. No frontend/UI change.

create table if not exists public.session_engine_policy (
  policy_key text primary key,
  version text not null,
  active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists session_engine_policy_one_active_idx
  on public.session_engine_policy ((active))
  where active;

insert into public.session_engine_policy(policy_key, version, active, config)
values (
  'c1-default',
  'c1-stimulus-v1',
  true,
  jsonb_build_object(
    'quality_scale', jsonb_build_object('min',0,'max',100),
    'focus_profiles', jsonb_build_object(
      'General Fitness', jsonb_build_object(
        'strength',60,'conditioning',60,'muscular_endurance',55,'power',35,'stability',50,'mobility',35,
        'density',55,'local_fatigue',50,'complexity',50,'rpe_min',6.5,'rpe_max',8.0
      ),
      'Fat Loss', jsonb_build_object(
        'strength',40,'conditioning',80,'muscular_endurance',70,'power',30,'stability',40,'mobility',30,
        'density',75,'local_fatigue',55,'complexity',45,'rpe_min',7.0,'rpe_max',8.0
      ),
      'Muscle Gain', jsonb_build_object(
        'strength',70,'conditioning',30,'muscular_endurance',65,'power',20,'stability',40,'mobility',25,
        'density',50,'local_fatigue',70,'complexity',45,'rpe_min',7.0,'rpe_max',9.0
      ),
      'Strength', jsonb_build_object(
        'strength',90,'conditioning',20,'muscular_endurance',35,'power',40,'stability',55,'mobility',30,
        'density',35,'local_fatigue',65,'complexity',60,'rpe_min',7.0,'rpe_max',9.0
      ),
      'Conditioning', jsonb_build_object(
        'strength',30,'conditioning',90,'muscular_endurance',70,'power',35,'stability',40,'mobility',25,
        'density',80,'local_fatigue',50,'complexity',45,'rpe_min',7.0,'rpe_max',8.0
      )
    ),
    'readiness_modifiers', jsonb_build_object(
      'low', jsonb_build_object('density',-15,'local_fatigue',-15,'complexity',-20,'power',-10,'rpe_shift',-1.0),
      'normal', jsonb_build_object('density',0,'local_fatigue',0,'complexity',0,'power',0,'rpe_shift',0.0),
      'high', jsonb_build_object('density',5,'local_fatigue',5,'complexity',5,'power',5,'rpe_shift',0.0)
    ),
    'hard_gate_priority', jsonb_build_array('pain','equipment','time','technical_level')
  )
)
on conflict (policy_key) do update
set version=excluded.version,
    active=excluded.active,
    config=excluded.config,
    updated_at=now();

update public.session_engine_policy
set active=false, updated_at=now()
where policy_key<>'c1-default' and active;

create or replace function public.session_stimulus_band(p_score numeric)
returns text
language sql
immutable
as $$
  select case
    when p_score is null then 'unknown'
    when p_score < 35 then 'low'
    when p_score < 65 then 'moderate'
    else 'high'
  end;
$$;

create or replace function public.normalize_session_readiness(p_readiness text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_readiness,'')));
  n numeric;
begin
  if v in ('low','faible') then return 'low'; end if;
  if v in ('normal','medium','moyen','moyenne') then return 'normal'; end if;
  if v in ('high','élevé','eleve','élevée','elevee') then return 'high'; end if;

  begin
    n := v::numeric;
    if n between 1 and 4 then return 'low'; end if;
    if n between 5 and 7 then return 'normal'; end if;
    if n between 8 and 10 then return 'high'; end if;
  exception when invalid_text_representation then
    null;
  end;

  raise exception 'Unsupported readiness value: %', p_readiness;
end;
$$;

create or replace function public.build_session_stimulus_target(
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null,
  p_progression_intent text default null,
  p_policy_key text default 'c1-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_config jsonb;
  v_profile jsonb;
  v_modifier jsonb;
  v_readiness text;
  v_focus text := trim(coalesce(p_focus,''));
  v_region text := nullif(trim(coalesce(p_target_region,'')),'');
  v_intent text := upper(nullif(trim(coalesce(p_progression_intent,'')),''));
  v_strength numeric;
  v_conditioning numeric;
  v_muscular_endurance numeric;
  v_power numeric;
  v_stability numeric;
  v_mobility numeric;
  v_density numeric;
  v_local_fatigue numeric;
  v_complexity numeric;
  v_rpe_min numeric;
  v_rpe_max numeric;
  v_shift numeric;
  v_reason_codes jsonb;
begin
  select config into v_config
  from public.session_engine_policy
  where policy_key=p_policy_key;

  if v_config is null then
    raise exception 'Unknown session engine policy: %', p_policy_key;
  end if;

  if v_focus not in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    raise exception 'Unsupported V1 focus: %', p_focus;
  end if;

  if p_duration_minutes is null or p_duration_minutes < 30 or p_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 30 and 90 minutes';
  end if;

  if v_region is not null and v_region not in ('Upper','Lower','Core','Full Body') then
    raise exception 'Unsupported target region: %', p_target_region;
  end if;

  if v_intent is not null and v_intent not in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    raise exception 'Unsupported progression intent: %', p_progression_intent;
  end if;

  v_readiness := public.normalize_session_readiness(p_readiness);
  v_profile := v_config #> array['focus_profiles',v_focus];
  v_modifier := v_config #> array['readiness_modifiers',v_readiness];

  if v_profile is null or v_modifier is null then
    raise exception 'Incomplete session policy for focus/readiness';
  end if;

  v_strength := greatest(0,least(100,(v_profile->>'strength')::numeric));
  v_conditioning := greatest(0,least(100,(v_profile->>'conditioning')::numeric));
  v_muscular_endurance := greatest(0,least(100,(v_profile->>'muscular_endurance')::numeric));
  v_power := greatest(0,least(100,(v_profile->>'power')::numeric + coalesce((v_modifier->>'power')::numeric,0)));
  v_stability := greatest(0,least(100,(v_profile->>'stability')::numeric));
  v_mobility := greatest(0,least(100,(v_profile->>'mobility')::numeric));
  v_density := greatest(0,least(100,(v_profile->>'density')::numeric + coalesce((v_modifier->>'density')::numeric,0)));
  v_local_fatigue := greatest(0,least(100,(v_profile->>'local_fatigue')::numeric + coalesce((v_modifier->>'local_fatigue')::numeric,0)));
  v_complexity := greatest(0,least(100,(v_profile->>'complexity')::numeric + coalesce((v_modifier->>'complexity')::numeric,0)));
  v_shift := coalesce((v_modifier->>'rpe_shift')::numeric,0);
  v_rpe_min := greatest(1,least(10,(v_profile->>'rpe_min')::numeric + v_shift));
  v_rpe_max := greatest(v_rpe_min,least(10,(v_profile->>'rpe_max')::numeric + v_shift));

  v_reason_codes := jsonb_build_array(
    'focus_profile:' || replace(lower(v_focus),' ','_'),
    'readiness:' || v_readiness,
    case when v_region is null then 'region:auto' else 'region:' || replace(lower(v_region),' ','_') end,
    case when v_intent is null then 'progression_intent:unspecified' else 'progression_intent:' || lower(v_intent) end
  );

  return jsonb_build_object(
    'contract_version','c1-stimulus-v1',
    'policy_key',p_policy_key,
    'focus',v_focus,
    'duration_minutes',p_duration_minutes,
    'target_region',coalesce(v_region,'AUTO'),
    'progression_intent',coalesce(v_intent,'UNSPECIFIED'),
    'readiness',jsonb_build_object('raw',p_readiness,'band',v_readiness),
    'qualities',jsonb_build_object(
      'strength',jsonb_build_object('score',v_strength,'band',public.session_stimulus_band(v_strength)),
      'conditioning',jsonb_build_object('score',v_conditioning,'band',public.session_stimulus_band(v_conditioning)),
      'muscular_endurance',jsonb_build_object('score',v_muscular_endurance,'band',public.session_stimulus_band(v_muscular_endurance)),
      'power',jsonb_build_object('score',v_power,'band',public.session_stimulus_band(v_power)),
      'stability',jsonb_build_object('score',v_stability,'band',public.session_stimulus_band(v_stability)),
      'mobility',jsonb_build_object('score',v_mobility,'band',public.session_stimulus_band(v_mobility))
    ),
    'density',jsonb_build_object('score',v_density,'band',public.session_stimulus_band(v_density)),
    'local_fatigue',jsonb_build_object('score',v_local_fatigue,'band',public.session_stimulus_band(v_local_fatigue)),
    'complexity',jsonb_build_object('score',v_complexity,'band',public.session_stimulus_band(v_complexity)),
    'rpe_target',jsonb_build_object('min',v_rpe_min,'max',v_rpe_max),
    'hard_gate_priority',v_config->'hard_gate_priority',
    'reason_codes',v_reason_codes
  );
end;
$$;

comment on function public.build_session_stimulus_target(text,integer,text,text,text,text)
is 'Phase C1 pure target builder: focus + duration + readiness + optional region/intent -> explainable session stimulus. No exercise selection.';
