-- C51 — Support V1 des séances de 20 minutes
-- DEV appliqué le 13/08/2026.

create or replace function public.build_session_stimulus_target(
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text default null::text,
  p_progression_intent text default null::text,
  p_policy_key text default 'c1-default'::text
)
returns jsonb
language plpgsql
stable
as $function$
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

  if p_duration_minutes is null or p_duration_minutes < 20 or p_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 20 and 90 minutes';
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
    'contract_version','c1-stimulus-v1.1-20min',
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
$function$;

create or replace function public.c3_wod_budget_minutes(
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null::integer,
  p_policy_key text default 'c3-sim-default'::text
)
returns integer
language plpgsql
stable
as $function$
declare
  v_cfg jsonb;
  v_fraction numeric;
  v_min int;
  v_max int;
  v_result int;
begin
  if p_total_duration_minutes is null or p_total_duration_minutes < 20 or p_total_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 20 and 90 minutes';
  end if;

  if p_exact_wod_minutes is not null then
    if p_exact_wod_minutes < 8 or p_exact_wod_minutes >= p_total_duration_minutes then
      raise exception 'Exact WOD duration must be >= 8 and lower than total session duration';
    end if;
    return p_exact_wod_minutes;
  end if;

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_fraction := coalesce((v_cfg#>>'{wod_budget,fraction_of_session}')::numeric,0.45);
  v_min := coalesce((v_cfg#>>'{wod_budget,min_minutes}')::int,12);
  v_max := coalesce((v_cfg#>>'{wod_budget,max_minutes}')::int,30);
  v_result := round(p_total_duration_minutes*v_fraction)::int;

  if p_total_duration_minutes < 30 then
    return greatest(8, least(p_total_duration_minutes - 5, v_result));
  end if;

  return greatest(v_min,least(v_max,v_result));
end;
$function$;
