

-- SOURCE MIGRATION: 20260811114024_phase_b264_explicit_session_exercise_bridge.sql
create or replace function public.resolve_exercise_log_instance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session_user uuid;
  v_match_count int;
  v_match_id uuid;
  v_marker_text text;
  v_marker_id uuid;
  v_planned_prescription jsonb;
begin
  if new.session_id is null then
    return new;
  end if;

  select user_id into v_session_user
  from public.workout_sessions
  where id = new.session_id;

  if not found then
    raise exception 'Unknown workout session %', new.session_id;
  end if;

  if new.user_id <> v_session_user then
    raise exception 'exercise_logs user_id does not own session %', new.session_id;
  end if;

  -- B2.6.4 bridge: the compatibility Edge Function can carry the exact
  -- workout_session_exercises.id through the legacy notes field.  The marker is
  -- removed before persistence, so it never leaks into user-visible history.
  if new.session_exercise_id is null and new.notes is not null then
    v_marker_text := substring(
      new.notes from '\[\[UGEROD_INSTANCE:([0-9a-fA-F-]{36})\]\]'
    );

    if v_marker_text is not null then
      begin
        v_marker_id := v_marker_text::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid UGEROD session exercise marker';
      end;

      select wse.id, coalesce(wse.prescription_json, '{}'::jsonb)
      into v_match_id, v_planned_prescription
      from public.workout_session_exercises wse
      where wse.id = v_marker_id
        and wse.session_id = new.session_id
        and wse.exercise_id = new.exercise_id;

      if not found then
        raise exception 'UGEROD instance marker % does not match session/exercise', v_marker_id;
      end if;

      new.session_exercise_id := v_match_id;
      new.prescription_json := coalesce(v_planned_prescription, new.prescription_json, '{}'::jsonb);
      new.notes := nullif(
        btrim(
          regexp_replace(
            new.notes,
            '\[\[UGEROD_INSTANCE:[0-9a-fA-F-]{36}\]\]\s*',
            '',
            'g'
          )
        ),
        ''
      );
    end if;
  end if;

  if new.session_exercise_id is not null then
    select coalesce(wse.prescription_json, '{}'::jsonb)
    into v_planned_prescription
    from public.workout_session_exercises wse
    where wse.id = new.session_exercise_id
      and wse.session_id = new.session_id
      and wse.exercise_id = new.exercise_id;

    if not found then
      raise exception 'session_exercise_id % does not match session/exercise', new.session_exercise_id;
    end if;

    -- Exact planned prescription is part of the performance observation
    -- contract; never let a duplicate exercise inherit another instance's plan.
    new.prescription_json := coalesce(v_planned_prescription, new.prescription_json, '{}'::jsonb);
    return new;
  end if;

  select count(*), min(id)
  into v_match_count, v_match_id
  from public.workout_session_exercises
  where session_id = new.session_id
    and exercise_id = new.exercise_id;

  if v_match_count = 1 then
    new.session_exercise_id := v_match_id;
  elsif v_match_count = 0 then
    if coalesce(new.source_kind, 'internal') = 'internal' then
      raise exception 'No workout_session_exercise instance for session %, exercise %', new.session_id, new.exercise_id;
    end if;
  else
    raise exception 'Ambiguous exercise instance for session %, exercise %. Pass session_exercise_id explicitly.', new.session_id, new.exercise_id;
  end if;

  return new;
end;
$function$;;



-- SOURCE MIGRATION: 20260811114803_phase_c1_session_stimulus_contract.sql
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
is 'Phase C1 pure target builder: focus + duration + readiness + optional region/intent -> explainable session stimulus. No exercise selection.';;



-- SOURCE MIGRATION: 20260811115832_phase_c2_coach_score_solver_simulation.sql
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



-- SOURCE MIGRATION: 20260811115938_phase_c2_conditioning_anchor_guard.sql
alter function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer)
rename to simulate_session_engine_c2_raw;

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
language plpgsql
stable
as $$
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
      select 1
      from jsonb_array_elements(coalesce(s->'exercises','[]'::jsonb)) e
      where e->>'pattern' in ('Conditioning','Locomotion')
    );

    if jsonb_array_length(v_filtered)=0 then
      v_status := 'NO_SAFE_COHERENT_WOD';
    end if;
  else
    v_filtered := coalesce(v_raw->'candidate_sessions','[]'::jsonb);
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_raw,'{version}','"c2-sim-v1.1"'::jsonb,true),
      '{candidate_sessions}',v_filtered,true
    ),
    '{coherence_gate}',
    jsonb_build_object(
      'status',v_status,
      'conditioning_anchor_required',v_requires_anchor,
      'conditioning_anchor_definition','movement_pattern in Conditioning|Locomotion',
      'never_force_when_no_safe_coherent_candidate',true
    ),
    true
  );
end;
$$;

comment on function public.simulate_session_engine_c2(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer)
is 'Canonical Phase C2 simulation. Adds absolute conditioning-anchor coherence guard; returns NO_SAFE_COHERENT_WOD instead of forcing a poor session.';;



-- SOURCE MIGRATION: 20260811121155_phase_c3_whole_wod_simulation.sql
-- Phase C3 — Whole-WOD mechanic simulation (read-only / simulation only)
-- C2 chooses coherent candidates. C3 checks whether the assembled WOD can actually fit
-- the selected mechanic, time envelope and fatigue/density constraints.

insert into public.session_engine_policy(policy_key,version,active,config,updated_at)
values (
  'c3-sim-default',
  'c3-whole-wod-v1',
  false,
  jsonb_build_object(
    'simulation_only', true,
    'wod_budget', jsonb_build_object(
      'fraction_of_session', 0.45,
      'min_minutes', 12,
      'max_minutes', 30,
      'note', 'Default only when no exact WOD block duration is supplied. Exact architecture duration takes precedence.'
    ),
    'operational_assumptions', jsonb_build_object(
      'reps_standard_seconds_per_rep', 2.5,
      'reps_heavy_seconds_per_rep', 3.5,
      'reps_unilateral_seconds_per_rep', 2.5,
      'metabolic_high_seconds_per_rep', 1.8,
      'distance_default_m_per_second', 2.0,
      'transition_seconds_per_cost_point', 3.0,
      'amrap_sustainable_fraction', 0.90,
      'amrap_low_fraction', 0.80,
      'emom_max_work_seconds', 50,
      'emom_min_rest_seconds', 10,
      'for_time_target_fraction_of_cap', 0.75,
      'circuit_round_rest_seconds', 45,
      'strength_rest_seconds', 75,
      'strength_max_sets', 4,
      'progressive_interval_seconds', 60,
      'progressive_stop_reserve_seconds', 8,
      'note', 'Operational simulation defaults, not physiological norms. They are explicit so they can be calibrated later from observed UGEROD sessions.'
    ),
    'hard_rules', jsonb_build_object(
      'never_force_infeasible_session', true,
      'emom_requires_rest_margin', true,
      'for_time_must_fit_cap', true,
      'pain_and_equipment_already_filtered_by_c2', true
    )
  ),
  now()
)
on conflict (policy_key) do update
set version=excluded.version,active=false,config=excluded.config,updated_at=now();

create or replace function public.c3_wod_budget_minutes(
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c3-sim-default'
)
returns integer
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_fraction numeric;
  v_min int;
  v_max int;
  v_result int;
begin
  if p_total_duration_minutes is null or p_total_duration_minutes < 30 or p_total_duration_minutes > 90 then
    raise exception 'V1 session duration must be between 30 and 90 minutes';
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
  return greatest(v_min,least(v_max,v_result));
end;
$$;

create or replace function public.c3_unit_estimate(
  p_exercise_id text,
  p_prescription jsonb,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
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
  v_sec_per_rep numeric;
  v_speed numeric;
  v_work_seconds numeric;
  v_transition_seconds numeric;
  v_primary_muscles text[];
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

  v_sec_per_rep := case v_type
    when 'reps_heavy' then coalesce((v_cfg#>>'{operational_assumptions,reps_heavy_seconds_per_rep}')::numeric,3.5)
    when 'reps_unilateral' then coalesce((v_cfg#>>'{operational_assumptions,reps_unilateral_seconds_per_rep}')::numeric,2.5)
    when 'metabolic_high' then coalesce((v_cfg#>>'{operational_assumptions,metabolic_high_seconds_per_rep}')::numeric,1.8)
    else coalesce((v_cfg#>>'{operational_assumptions,reps_standard_seconds_per_rep}')::numeric,2.5)
  end;
  v_speed := coalesce((v_cfg#>>'{operational_assumptions,distance_default_m_per_second}')::numeric,2.0);

  v_work_seconds := case
    when v_duration is not null then v_duration
    when v_distance is not null then v_distance/greatest(0.1,v_speed)
    when v_reps_total is not null then v_reps_total*v_sec_per_rep
    else 20
  end;

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
    'estimate_basis',case when v_duration is not null then 'prescribed_time' when v_distance is not null then 'distance_default_speed' when v_reps_total is not null then 'rep_pacing_default' else 'fallback_20_seconds' end
  ));
end;
$$;

create or replace function public.c3_simulate_candidate_wod(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb := coalesce(p_candidate->'exercises','[]'::jsonb);
  v_n int := jsonb_array_length(v_exercises);
  v_wod_min int;
  v_wod_sec numeric;
  v_round_active numeric := 0;
  v_round_transition numeric := 0;
  v_round_sec numeric := 0;
  v_total_active numeric := 0;
  v_predicted_sec numeric := 0;
  v_rest_sec numeric := 0;
  v_rounds numeric := 0;
  v_rounds_low numeric := 0;
  v_rounds_high numeric := 0;
  v_cycles int := 0;
  v_sets int := 0;
  v_rungs int := 0;
  v_stage int := 0;
  v_density numeric := 0;
  v_total_reps numeric := 0;
  v_total_distance numeric := 0;
  v_total_isometric numeric := 0;
  v_fatigue_units numeric := 0;
  v_max_station_work numeric := 0;
  v_min_station_rest numeric := 60;
  v_status text := 'OK';
  v_reasons jsonb := '[]'::jsonb;
  v_units jsonb := '[]'::jsonb;
  v_unit jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_multiplier numeric := 1;
  v_emom_max numeric;
  v_emom_min_rest numeric;
  v_amrap_sustain numeric;
  v_amrap_low numeric;
  v_for_time_fraction numeric;
  v_circuit_rest numeric;
  v_strength_rest numeric;
  v_strength_max_sets int;
  v_progressive_interval numeric;
  v_progressive_reserve numeric;
  v_increment_seconds numeric := 0;
  v_base_progressive_work numeric := 0;
  v_muscle_total numeric := 0;
  v_max_muscle numeric := 0;
  v_max_muscle_share numeric := 0;
  v_local_fatigue_index numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_target_local_fatigue numeric := coalesce((p_stimulus#>>'{local_fatigue,score}')::numeric,50);
  v_density_fit numeric := 0;
  v_local_fatigue_fit numeric := 0;
  v_whole_wod_fit numeric := 0;
  rec record;
begin
  if v_n=0 then
    return jsonb_build_object('status','NO_EXERCISES','feasible',false);
  end if;

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_wod_min := public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_policy_key);
  v_wod_sec := v_wod_min*60;

  v_emom_max := coalesce((v_cfg#>>'{operational_assumptions,emom_max_work_seconds}')::numeric,50);
  v_emom_min_rest := coalesce((v_cfg#>>'{operational_assumptions,emom_min_rest_seconds}')::numeric,10);
  v_amrap_sustain := coalesce((v_cfg#>>'{operational_assumptions,amrap_sustainable_fraction}')::numeric,0.90);
  v_amrap_low := coalesce((v_cfg#>>'{operational_assumptions,amrap_low_fraction}')::numeric,0.80);
  v_for_time_fraction := coalesce((v_cfg#>>'{operational_assumptions,for_time_target_fraction_of_cap}')::numeric,0.75);
  v_circuit_rest := coalesce((v_cfg#>>'{operational_assumptions,circuit_round_rest_seconds}')::numeric,45);
  v_strength_rest := coalesce((v_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
  v_strength_max_sets := coalesce((v_cfg#>>'{operational_assumptions,strength_max_sets}')::int,4);
  v_progressive_interval := coalesce((v_cfg#>>'{operational_assumptions,progressive_interval_seconds}')::numeric,60);
  v_progressive_reserve := coalesce((v_cfg#>>'{operational_assumptions,progressive_stop_reserve_seconds}')::numeric,8);

  for v_ex in select value from jsonb_array_elements(v_exercises)
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_unit := public.c3_unit_estimate(v_ex->>'exercise_id',v_pres,p_policy_key);
    v_units := v_units || jsonb_build_array(v_unit);
    v_round_active := v_round_active + coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0);
    v_round_transition := v_round_transition + coalesce((v_unit->>'estimated_transition_seconds')::numeric,0);
    v_fatigue_units := v_fatigue_units + coalesce((v_unit->>'fatigue_score')::numeric,3);
    v_max_station_work := greatest(v_max_station_work,coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0));
    v_min_station_rest := least(v_min_station_rest,60-coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0));
    if nullif(v_unit->>'reps_total','') is not null then
      v_increment_seconds := v_increment_seconds + greatest(0.8,coalesce((v_unit->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(v_unit->>'reps_total')::numeric));
    end if;
  end loop;

  v_round_sec := greatest(1,v_round_active+v_round_transition);

  case v_mechanic
    when 'AMRAP' then
      v_rounds := greatest(1,floor(v_wod_sec/v_round_sec*v_amrap_sustain));
      v_rounds_low := greatest(1,floor(v_wod_sec/v_round_sec*v_amrap_low));
      v_rounds_high := greatest(v_rounds,floor(v_wod_sec/v_round_sec));
      v_total_active := v_round_active*v_rounds;
      v_predicted_sec := v_wod_sec;
      v_rest_sec := greatest(0,v_wod_sec-v_total_active-v_round_transition*v_rounds);

    when 'EMOM' then
      v_cycles := floor(v_wod_min/greatest(1,v_n));
      if v_cycles<1 then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('emom_cycle_longer_than_wod');
      end if;
      if v_max_station_work>v_emom_max or v_min_station_rest<v_emom_min_rest then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('emom_insufficient_rest_margin');
      end if;
      v_rounds:=greatest(0,v_cycles);
      v_total_active:=v_round_active*v_rounds;
      v_predicted_sec:=greatest(0,v_cycles)*v_n*60;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);

    when 'FOR_TIME' then
      v_rounds := greatest(1,least(6,round((v_wod_sec*v_for_time_fraction)/v_round_sec)));
      v_predicted_sec := v_round_sec*v_rounds;
      v_total_active := v_round_active*v_rounds;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_rounds);
      if v_predicted_sec>v_wod_sec then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('predicted_for_time_exceeds_cap');
      end if;

    when 'CIRCUIT' then
      v_rounds := greatest(1,floor((v_wod_sec+v_circuit_rest)/(v_round_sec+v_circuit_rest)));
      v_predicted_sec := least(v_wod_sec,v_rounds*v_round_sec+greatest(0,v_rounds-1)*v_circuit_rest);
      v_total_active := v_round_active*v_rounds;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_rounds);

    when 'STRENGTH' then
      v_sets := greatest(1,least(v_strength_max_sets,floor(v_wod_sec/greatest(1,v_round_sec+v_n*v_strength_rest))));
      v_rounds := v_sets;
      v_predicted_sec := v_sets*v_round_sec + greatest(0,v_sets-1)*v_n*v_strength_rest;
      v_total_active := v_round_active*v_sets;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active-v_round_transition*v_sets);
      if v_sets<2 then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('strength_block_cannot_fit_two_quality_sets');
      end if;

    when 'LADDER' then
      v_rungs := greatest(3,least(7,floor(v_wod_sec/v_round_sec)));
      v_rounds := v_rungs;
      v_multiplier := (v_rungs+1)/2.0;
      v_predicted_sec := least(v_wod_sec,v_round_sec*v_multiplier);
      v_total_active := v_round_active*v_multiplier;
      v_rest_sec := greatest(0,v_predicted_sec-v_total_active);

    when 'PYRAMID' then
      v_rungs := 5;
      v_multiplier := 3.8;
      if v_round_sec*v_multiplier>v_wod_sec then
        v_rungs:=3;
        v_multiplier:=2.4;
      end if;
      v_rounds:=v_rungs;
      v_predicted_sec:=v_round_sec*v_multiplier;
      v_total_active:=v_round_active*v_multiplier;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);
      if v_predicted_sec>v_wod_sec then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('pyramid_volume_exceeds_wod_budget');
      end if;

    when 'PROGRESSIVE_INTERVAL' then
      v_base_progressive_work := v_round_active+v_round_transition;
      if v_base_progressive_work>v_progressive_interval-v_progressive_reserve then
        v_status:='INFEASIBLE';
        v_reasons:=v_reasons||jsonb_build_array('progressive_interval_start_does_not_fit');
        v_stage:=0;
      else
        v_stage := least(v_wod_min, greatest(1, floor((v_progressive_interval-v_progressive_reserve-v_base_progressive_work)/greatest(1,v_increment_seconds))+1));
      end if;
      v_rounds:=v_stage;
      v_predicted_sec:=least(v_wod_sec,v_stage*v_progressive_interval);
      v_total_active:=case when v_stage>0 then v_stage*v_round_active + greatest(0,v_stage-1)*v_stage/2.0*v_increment_seconds else 0 end;
      v_rest_sec:=greatest(0,v_predicted_sec-v_total_active);

    else
      v_status:='UNSUPPORTED_MECHANIC';
      v_reasons:=v_reasons||jsonb_build_array('unsupported_mechanic:'||v_mechanic);
      v_predicted_sec:=0;
      v_total_active:=0;
      v_rounds:=0;
  end case;

  -- Aggregate predicted volume using the execution multiplier of the mechanic.
  v_multiplier := case
    when v_mechanic='LADDER' then greatest(1,(v_rungs+1)/2.0)
    when v_mechanic='PYRAMID' then case when v_rungs=5 then 3.8 else 2.4 end
    when v_mechanic='PROGRESSIVE_INTERVAL' then greatest(0,v_stage)
    else greatest(0,v_rounds)
  end;

  select
    coalesce(sum(coalesce(nullif(u->>'reps_total','')::numeric,0)*v_multiplier),0),
    coalesce(sum(coalesce(nullif(u->>'distance_meters','')::numeric,0)*v_multiplier),0),
    coalesce(sum(coalesce(nullif(u->>'duration_seconds','')::numeric,0)*v_multiplier),0)
  into v_total_reps,v_total_distance,v_total_isometric
  from jsonb_array_elements(v_units) u;

  -- Local fatigue concentration: share of weighted primary-muscle exposure carried by the most-loaded primary muscle.
  with unit_rows as (
    select u,
           coalesce((u->>'fatigue_score')::numeric,3)*v_multiplier as weighted
    from jsonb_array_elements(v_units) u
  ), muscle_rows as (
    select m.value#>>'{}' as muscle_id, ur.weighted
    from unit_rows ur
    cross join lateral jsonb_array_elements(coalesce(ur.u->'primary_muscles','[]'::jsonb)) m
  ), agg as (
    select muscle_id,sum(weighted) w from muscle_rows group by muscle_id
  )
  select coalesce(sum(w),0),coalesce(max(w),0) into v_muscle_total,v_max_muscle from agg;

  v_max_muscle_share := case when v_muscle_total>0 then v_max_muscle/v_muscle_total else 0 end;
  v_local_fatigue_index := least(100,round(v_max_muscle_share*100,2));
  v_density := case when v_predicted_sec>0 then least(100,round(v_total_active/v_predicted_sec*100,2)) else 0 end;
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_local_fatigue_fit := greatest(0,100-abs(v_local_fatigue_index-v_target_local_fatigue));
  v_whole_wod_fit := round(v_density_fit*0.60+v_local_fatigue_fit*0.40,2);

  if v_status='OK' and v_mechanic in ('AMRAP','CIRCUIT','FOR_TIME','LADDER','PYRAMID') and v_round_sec>v_wod_sec then
    v_status:='INFEASIBLE';
    v_reasons:=v_reasons||jsonb_build_array('single_round_exceeds_wod_budget');
  end if;

  return jsonb_build_object(
    'version','c3-whole-wod-v1',
    'simulation_only',true,
    'mechanic',v_mechanic,
    'status',v_status,
    'feasible',v_status='OK',
    'reasons',v_reasons,
    'wod_budget_minutes',v_wod_min,
    'wod_budget_source',case when p_exact_wod_minutes is null then 'derived_default' else 'exact_input' end,
    'per_exercise_units',v_units,
    'round_model',jsonb_build_object(
      'exercise_count',v_n,
      'active_work_seconds',round(v_round_active,2),
      'transition_seconds',round(v_round_transition,2),
      'round_seconds',round(v_round_sec,2)
    ),
    'mechanic_projection',jsonb_strip_nulls(jsonb_build_object(
      'expected_rounds_or_sets',round(v_rounds,2),
      'rounds_low',case when v_mechanic='AMRAP' then v_rounds_low else null end,
      'rounds_high',case when v_mechanic='AMRAP' then v_rounds_high else null end,
      'emom_cycles',case when v_mechanic='EMOM' then v_cycles else null end,
      'emom_max_station_work_seconds',case when v_mechanic='EMOM' then round(v_max_station_work,2) else null end,
      'emom_min_station_rest_seconds',case when v_mechanic='EMOM' then round(v_min_station_rest,2) else null end,
      'for_time_cap_seconds',case when v_mechanic='FOR_TIME' then v_wod_sec else null end,
      'ladder_or_pyramid_rungs',case when v_mechanic in ('LADDER','PYRAMID') then v_rungs else null end,
      'progressive_expected_stage',case when v_mechanic='PROGRESSIVE_INTERVAL' then v_stage else null end,
      'progressive_stop_rule',case when v_mechanic='PROGRESSIVE_INTERVAL' then 'stop before interval work exceeds interval minus reserve' else null end,
      'predicted_elapsed_seconds',round(v_predicted_sec,2),
      'predicted_active_work_seconds',round(v_total_active,2),
      'predicted_rest_or_slack_seconds',round(v_rest_sec,2)
    )),
    'predicted_volume',jsonb_build_object(
      'total_reps',round(v_total_reps,2),
      'total_distance_meters',round(v_total_distance,2),
      'total_prescribed_hold_seconds',round(v_total_isometric,2),
      'active_work_seconds',round(v_total_active,2)
    ),
    'whole_wod_metrics',jsonb_build_object(
      'density_percent',round(v_density,2),
      'target_density_score',v_target_density,
      'density_fit',round(v_density_fit,2),
      'max_primary_muscle_share',round(v_max_muscle_share,3),
      'local_fatigue_concentration_index',round(v_local_fatigue_index,2),
      'target_local_fatigue_score',v_target_local_fatigue,
      'local_fatigue_fit',round(v_local_fatigue_fit,2),
      'whole_wod_fit',v_whole_wod_fit
    )
  );
end;
$$;

create or replace function public.simulate_session_engine_c3(
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
  p_candidate_count integer default 5,
  p_exact_wod_minutes integer default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_candidate jsonb;
  v_sim jsonb;
  v_enriched jsonb;
  v_feasible int := 0;
  v_infeasible int := 0;
  v_final_status text := 'OK';
begin
  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c3-whole-wod-v1',
      'simulation_only',true,
      'mutates_production_state',false,
      'status','NO_SAFE_COHERENT_WOD',
      'c2',v_c2,
      'candidate_sessions','[]'::jsonb
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_sim := public.c3_simulate_candidate_wod(v_candidate,v_stimulus,p_duration_minutes,p_exact_wod_minutes,'c3-sim-default');
    v_enriched := v_candidate || jsonb_build_object(
      'whole_wod_simulation',v_sim,
      'c3_whole_wod_fit',coalesce((v_sim#>>'{whole_wod_metrics,whole_wod_fit}')::numeric,0),
      'c3_combined_score',round(coalesce((v_candidate->>'coach_score')::numeric,0)*0.75 + coalesce((v_sim#>>'{whole_wod_metrics,whole_wod_fit}')::numeric,0)*0.25,2)
    );
    if coalesce((v_sim->>'feasible')::boolean,false) then
      v_feasible:=v_feasible+1;
      v_candidates:=v_candidates||jsonb_build_array(v_enriched);
    else
      v_infeasible:=v_infeasible+1;
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c3_combined_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_candidates
  from jsonb_array_elements(v_candidates) x;

  if v_feasible=0 then v_final_status:='NO_FEASIBLE_WHOLE_WOD'; end if;

  return jsonb_build_object(
    'version','c3-whole-wod-v1',
    'simulation_only',true,
    'mutates_production_state',false,
    'status',v_final_status,
    'stimulus',v_stimulus,
    'wod_budget_minutes',public.c3_wod_budget_minutes(p_duration_minutes,p_exact_wod_minutes,'c3-sim-default'),
    'input_candidate_count',jsonb_array_length(coalesce(v_c2->'candidate_sessions','[]'::jsonb)),
    'feasible_candidate_count',v_feasible,
    'infeasible_candidate_count',v_infeasible,
    'candidate_sessions',v_candidates,
    'c2_summary',jsonb_build_object(
      'pool_count',v_c2->'pool_count',
      'top_mechanics',v_c2->'top_mechanics',
      'coherence_gate',v_c2->'coherence_gate'
    ),
    'known_limitations',jsonb_build_array(
      'weekly_coherence_remains_phase_d',
      'operational_pacing_defaults_need_calibration_from_real_sessions',
      'numeric_load_still_requires_confirmed_capability_and_inventory',
      'c3_is_not_routed_to_production_session_generation'
    )
  );
end;
$$;

comment on function public.simulate_session_engine_c3(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer)
is 'Phase C3 read-only whole-WOD simulator. Adds mechanic-specific time/round/set/volume/density/local-fatigue feasibility to C2 candidate sessions. Never mutates production state.';;



-- SOURCE MIGRATION: 20260811121336_phase_c3_duration_and_muscle_ledger_refinement.sql
-- Phase C3 refinement — duration utilization + explicit primary-muscle exposure ledger.

update public.session_engine_policy
set config = jsonb_set(
  jsonb_set(
    config,
    '{mechanic_duration_target_percent}',
    jsonb_build_object(
      'AMRAP',100,'EMOM',90,'FOR_TIME',75,'CIRCUIT',90,'STRENGTH',75,
      'LADDER',85,'PYRAMID',85,'PROGRESSIVE_INTERVAL',85
    ),true
  ),
  '{whole_wod_fit_weights}',
  jsonb_build_object('density_fit',0.45,'local_fatigue_fit',0.30,'duration_fit',0.25),true
), updated_at=now()
where policy_key='c3-sim-default';

alter function public.c3_simulate_candidate_wod(jsonb,jsonb,integer,integer,text)
rename to c3_simulate_candidate_wod_raw;

create or replace function public.c3_simulate_candidate_wod(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_raw jsonb;
  v_cfg jsonb;
  v_mechanic text;
  v_budget_sec numeric;
  v_elapsed numeric;
  v_round_active numeric;
  v_total_active numeric;
  v_exposure_multiplier numeric;
  v_util numeric;
  v_target_util numeric;
  v_duration_fit numeric;
  v_density_fit numeric;
  v_local_fit numeric;
  v_whole_fit numeric;
  v_duration_status text := 'OK';
  v_ledger jsonb := '[]'::jsonb;
  v_stage int;
  v_progressive_reps numeric;
  v_result jsonb;
begin
  v_raw := public.c3_simulate_candidate_wod_raw(
    p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_policy_key
  );

  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C3 policy %',p_policy_key; end if;

  v_mechanic := upper(coalesce(v_raw->>'mechanic',''));
  v_budget_sec := coalesce((v_raw->>'wod_budget_minutes')::numeric,0)*60;
  v_elapsed := coalesce((v_raw#>>'{mechanic_projection,predicted_elapsed_seconds}')::numeric,0);
  v_round_active := coalesce((v_raw#>>'{round_model,active_work_seconds}')::numeric,0);
  v_total_active := coalesce((v_raw#>>'{mechanic_projection,predicted_active_work_seconds}')::numeric,0);
  v_exposure_multiplier := case when v_round_active>0 then v_total_active/v_round_active else 0 end;
  v_util := case when v_budget_sec>0 then least(150,v_elapsed/v_budget_sec*100) else 0 end;
  v_target_util := coalesce((v_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_duration_fit := greatest(0,100-abs(v_util-v_target_util)*1.25);
  v_density_fit := coalesce((v_raw#>>'{whole_wod_metrics,density_fit}')::numeric,0);
  v_local_fit := coalesce((v_raw#>>'{whole_wod_metrics,local_fatigue_fit}')::numeric,0);
  v_whole_fit := round(v_density_fit*0.45+v_local_fit*0.30+v_duration_fit*0.25,2);

  if v_util < greatest(0,v_target_util-25) then
    v_duration_status := 'UNDERFILLED';
  elsif v_util > 105 then
    v_duration_status := 'OVERFILLED';
  end if;

  with units as (
    select u,
           coalesce((u->>'fatigue_score')::numeric,3)*v_exposure_multiplier weighted
    from jsonb_array_elements(coalesce(v_raw->'per_exercise_units','[]'::jsonb)) u
  ), muscles as (
    select m.value#>>'{}' muscle_id, sum(units.weighted) weighted_exposure
    from units
    cross join lateral jsonb_array_elements(coalesce(units.u->'primary_muscles','[]'::jsonb)) m
    group by m.value#>>'{}'
  ), totals as (
    select coalesce(sum(weighted_exposure),0) total from muscles
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'muscle_id',muscle_id,
      'weighted_exposure_units',round(weighted_exposure,2),
      'share',case when totals.total>0 then round(weighted_exposure/totals.total,3) else 0 end
    ) order by weighted_exposure desc,muscle_id
  ),'[]'::jsonb)
  into v_ledger
  from muscles cross join totals;

  -- Progressive intervals add one rep per stage to rep-tracked exercises.
  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_stage := coalesce((v_raw#>>'{mechanic_projection,progressive_expected_stage}')::int,0);
    select coalesce(sum(
      case when nullif(u->>'reps_total','') is not null
        then v_stage*(u->>'reps_total')::numeric + greatest(0,v_stage-1)*v_stage/2.0
        else 0 end
    ),0)
    into v_progressive_reps
    from jsonb_array_elements(coalesce(v_raw->'per_exercise_units','[]'::jsonb)) u;
    v_raw := jsonb_set(v_raw,'{predicted_volume,total_reps}',to_jsonb(round(v_progressive_reps,2)),true);
  end if;

  v_result := jsonb_set(
    jsonb_set(
      jsonb_set(
        v_raw,
        '{whole_wod_metrics,time_utilization_percent}',to_jsonb(round(v_util,2)),true
      ),
      '{whole_wod_metrics,target_time_utilization_percent}',to_jsonb(v_target_util),true
    ),
    '{whole_wod_metrics,duration_fit}',to_jsonb(round(v_duration_fit,2)),true
  );
  v_result := jsonb_set(v_result,'{whole_wod_metrics,duration_status}',to_jsonb(v_duration_status),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,whole_wod_fit}',to_jsonb(v_whole_fit),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,primary_muscle_exposure_ledger}',v_ledger,true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,exposure_multiplier}',to_jsonb(round(v_exposure_multiplier,3)),true);
  v_result := jsonb_set(v_result,'{whole_wod_metrics,solver_action_hint}',to_jsonb(
    case
      when coalesce(v_raw->>'status','')<>'OK' then 'reject_or_rebuild_candidate'
      when v_duration_status='UNDERFILLED' then 'increase_rounds_or_volume_in_c4'
      when v_duration_status='OVERFILLED' then 'reduce_rounds_or_volume_in_c4'
      else 'mechanic_volume_is_time_coherent'
    end
  ),true);

  return jsonb_set(v_result,'{version}','"c3-whole-wod-v1.1"'::jsonb,true);
end;
$$;

comment on function public.c3_simulate_candidate_wod(jsonb,jsonb,integer,integer,text)
is 'C3 canonical candidate simulator v1.1. Adds time utilization, duration fit and primary-muscle exposure ledger; progressive rep volume includes stage increments.';;



-- SOURCE MIGRATION: 20260811122720_phase_c4_final_solver_quality_gates.sql
-- Phase C4 — final session solver + quality gates + anti-redundancy.
-- Still read-only at database level: no workout/capability state is mutated by these functions.

insert into public.session_engine_policy(policy_key,version,active,config,updated_at)
values (
  'c4-final-default',
  'c4-final-v1',
  false,
  jsonb_build_object(
    'selection_weights',jsonb_build_object(
      'coach_score',0.55,
      'whole_wod_fit',0.30,
      'anti_redundancy',0.15
    ),
    'anti_redundancy',jsonb_build_object(
      'recent_sessions',3,
      'exact_non_anchor_penalty',45,
      'family_penalty',25,
      'pattern_penalty',15,
      'anchor_patterns',jsonb_build_array('Conditioning','Locomotion')
    ),
    'mechanic_defaults',jsonb_build_object(
      'ladder_start_reps',2,
      'ladder_increment_reps',2,
      'ladder_max_rungs',12,
      'pyramid_base_reps',4,
      'pyramid_multipliers',jsonb_build_array(1,2,3,2,1),
      'pyramid_max_cycles',3,
      'progressive_start_reps',3,
      'progressive_increment_reps',1,
      'progressive_interval_seconds',60,
      'progressive_reserve_seconds',8,
      'max_final_rounds',20
    ),
    'quality_gate',jsonb_build_object(
      'max_jump_count',1,
      'max_joint_impact_5_count',1,
      'amrap_max_transition_cost',3,
      'emom_max_high_complexity_count',1,
      'emom_max_fatigue_5_count',1,
      'low_readiness_max_complexity',3,
      'low_readiness_max_fatigue',4,
      'duration_underfill_tolerance_percent',20,
      'duration_overfill_percent',105
    ),
    'legacy_inventory_defaults',jsonb_build_object(
      'E03',2,
      'default',1,
      'note','Legacy preparation UI treats Haltères as a pair. No numeric load is inferred.'
    ),
    'notes',jsonb_build_array(
      'Pain/equipment/technical gates remain absolute and execute before ranking.',
      'Mechanic overlays are explicit and transparent.',
      'Numeric load is never invented.',
      'C4 SQL solver is read-only; production routing is handled separately.'
    )
  ),
  now()
)
on conflict (policy_key) do update
set version=excluded.version,active=false,config=excluded.config,updated_at=now();

create or replace function public.c4_legacy_inventory_from_equipment_names(
  p_names text[],
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_result jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  with requested as (
    select trim(x) name from unnest(coalesce(p_names,'{}'::text[])) x where trim(x)<>''
  ), matched as (
    select distinct e.id,e.name,
      coalesce((v_cfg#>>array['legacy_inventory_defaults',e.id])::int,
               (v_cfg#>>'{legacy_inventory_defaults,default}')::int,1) quantity
    from requested r
    join public.equipment e on lower(trim(e.name))=lower(r.name) or lower(trim(e.id))=lower(r.name)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'equipment_id',id,
    'quantity',quantity,
    'source','legacy_equipment_selection',
    'load_confidence','unknown'
  ) order by id),'[]'::jsonb)
  into v_result from matched;

  return v_result;
end;
$$;

create or replace function public.c4_prepare_candidate(
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_modes jsonb;
  v_compatible boolean := true;
  v_reasons jsonb := '[]'::jsonb;
  v_start int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb);
    v_modes := coalesce(v_pres->'tracking_modes','[]'::jsonb);

    if v_mechanic in ('LADDER','PYRAMID','PROGRESSIVE_INTERVAL') then
      if not exists(select 1 from jsonb_array_elements_text(v_modes) m where m='reps') then
        v_compatible := false;
        v_reasons := v_reasons || jsonb_build_array(v_mechanic||'_REQUIRES_REP_TRACKED_EXERCISES:'||(v_ex->>'exercise_id'));
      else
        if v_mechanic='LADDER' then
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','ascending_ladder',
            'start_reps',v_start,
            'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2)
          ));
        elsif v_mechanic='PYRAMID' then
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','pyramid',
            'base_reps',v_start,
            'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}'
          ));
        else
          v_start := coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3);
          v_pres := jsonb_set(jsonb_set(v_pres,'{reps_min}',to_jsonb(v_start),true),'{reps_max}',to_jsonb(v_start),true);
          v_pres := v_pres || jsonb_build_object('mechanic_overlay',jsonb_build_object(
            'type','progressive_interval',
            'start_reps',v_start,
            'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),
            'interval_seconds',coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::int,60)
          ));
        end if;
      end if;
    end if;

    v_exercises := v_exercises || jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  return jsonb_set(
    jsonb_set(p_candidate,'{exercises}',v_exercises,true),
    '{c4_preparation}',
    jsonb_build_object(
      'mechanic_compatible',v_compatible,
      'reasons',v_reasons,
      'version','c4-prepare-v1'
    ),true
  );
end;
$$;

create or replace function public.c4_redundancy_score(
  p_user_id uuid,
  p_candidate jsonb,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_recent int;
  v_exact_pen numeric;
  v_family_pen numeric;
  v_pattern_pen numeric;
  v_exact_ratio numeric := 0;
  v_family_ratio numeric := 0;
  v_pattern_ratio numeric := 0;
  v_score numeric := 100;
  v_recent_count int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_recent := coalesce((v_cfg#>>'{anti_redundancy,recent_sessions}')::int,3);
  v_exact_pen := coalesce((v_cfg#>>'{anti_redundancy,exact_non_anchor_penalty}')::numeric,45);
  v_family_pen := coalesce((v_cfg#>>'{anti_redundancy,family_penalty}')::numeric,25);
  v_pattern_pen := coalesce((v_cfg#>>'{anti_redundancy,pattern_penalty}')::numeric,15);

  with recent as (
    select ws.id
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
    order by coalesce(ws.completed_at,ws.generated_at) desc
    limit v_recent
  ), cand as (
    select e.id,e.exercise_family,e.movement_pattern,
           e.movement_pattern in ('Conditioning','Locomotion') anchor
    from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb)) x
    join public.exercises e on e.id=x->>'exercise_id'
  ), recent_ex as (
    select distinct wse.exercise_id,e.exercise_family,e.movement_pattern
    from recent r
    join public.workout_session_exercises wse on wse.session_id=r.id and wse.block_key='wod'
    join public.exercises e on e.id=wse.exercise_id
  ), stats as (
    select
      (select count(*) from recent) recent_count,
      (select count(*)::numeric / greatest(1,(select count(*) from cand where not anchor))
       from cand c where not c.anchor and exists(select 1 from recent_ex r where r.exercise_id=c.id)) exact_ratio,
      (select count(*)::numeric / greatest(1,(select count(distinct exercise_family) from cand))
       from (select distinct exercise_family from cand) c where exists(select 1 from recent_ex r where r.exercise_family=c.exercise_family)) family_ratio,
      (select count(*)::numeric / greatest(1,(select count(distinct movement_pattern) from cand))
       from (select distinct movement_pattern from cand) c where exists(select 1 from recent_ex r where r.movement_pattern=c.movement_pattern)) pattern_ratio
  )
  select recent_count,coalesce(exact_ratio,0),coalesce(family_ratio,0),coalesce(pattern_ratio,0)
  into v_recent_count,v_exact_ratio,v_family_ratio,v_pattern_ratio from stats;

  if v_recent_count>0 then
    v_score := greatest(0,least(100,100-v_exact_ratio*v_exact_pen-v_family_ratio*v_family_pen-v_pattern_ratio*v_pattern_pen));
  end if;

  return jsonb_build_object(
    'score',round(v_score,2),
    'recent_sessions_considered',v_recent_count,
    'exact_non_anchor_overlap_ratio',round(v_exact_ratio,3),
    'family_overlap_ratio',round(v_family_ratio,3),
    'pattern_overlap_ratio',round(v_pattern_ratio,3),
    'anchor_exact_repeat_exempt',true,
    'version','c4-redundancy-v1'
  );
end;
$$;

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c3_cfg jsonb;
  v_sim jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_n int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_wod_min int;
  v_wod_sec numeric;
  v_round_active numeric;
  v_round_transition numeric;
  v_round_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_elapsed numeric := 0;
  v_active numeric := 0;
  v_rest numeric := 0;
  v_units jsonb;
  v_rounds numeric := 0;
  v_sets numeric := 0;
  v_cycles numeric := 0;
  v_rungs int := 0;
  v_pyramid_cycles int := 0;
  v_stage int := 0;
  v_multiplier numeric := 0;
  v_tri numeric := 0;
  v_total_reps numeric := 0;
  v_total_distance numeric := 0;
  v_total_holds numeric := 0;
  v_base_reps numeric := 0;
  v_base_distance numeric := 0;
  v_base_holds numeric := 0;
  v_rep_exercises int := 0;
  v_increment_seconds numeric := 0;
  v_interval numeric;
  v_reserve numeric;
  v_stage_work numeric;
  v_rest_per_round numeric;
  v_max_rounds int;
  v_density numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_local_index numeric := 0;
  v_target_local numeric := coalesce((p_stimulus#>>'{local_fatigue,score}')::numeric,50);
  v_density_fit numeric := 0;
  v_local_fit numeric := 0;
  v_duration_util numeric := 0;
  v_duration_fit numeric := 0;
  v_whole_fit numeric := 0;
  v_under_tol numeric;
  v_over numeric;
  v_duration_status text := 'OK';
  v_status text := 'OK';
  v_reasons jsonb := '[]'::jsonb;
  v_mechanic_json jsonb;
  v_final_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_overlay jsonb;
  v_seq_sum numeric := 9;
  i int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_c4_policy_key;
  select config into v_c3_cfg from public.session_engine_policy where policy_key=p_c3_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_c4_policy_key; end if;
  if v_c3_cfg is null then raise exception 'Unknown C3 policy %',p_c3_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object('status','INCOMPATIBLE_MECHANIC','feasible',false,'reasons',p_candidate#>'{c4_preparation,reasons}')
    );
  end if;

  v_sim := public.c3_simulate_candidate_wod(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_min := public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_sec := v_wod_min*60;
  v_round_active := coalesce((v_sim#>>'{round_model,active_work_seconds}')::numeric,0);
  v_round_transition := coalesce((v_sim#>>'{round_model,transition_seconds}')::numeric,0);
  v_round_sec := greatest(1,v_round_active+v_round_transition);
  v_units := coalesce(v_sim->'per_exercise_units','[]'::jsonb);
  v_target_util := coalesce((v_c3_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_target_sec := v_wod_sec*v_target_util/100.0;
  v_max_rounds := coalesce((v_cfg#>>'{mechanic_defaults,max_final_rounds}')::int,20);
  v_under_tol := coalesce((v_cfg#>>'{quality_gate,duration_underfill_tolerance_percent}')::numeric,20);
  v_over := coalesce((v_cfg#>>'{quality_gate,duration_overfill_percent}')::numeric,105);

  select
    coalesce(sum(coalesce(nullif(u->>'reps_total','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'distance_meters','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'duration_seconds','')::numeric,0)),0),
    count(*) filter (where nullif(u->>'reps_total','') is not null),
    coalesce(sum(case when nullif(u->>'reps_total','') is not null then
      coalesce((u->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u->>'reps_total')::numeric)
      else 0 end),0)
  into v_base_reps,v_base_distance,v_base_holds,v_rep_exercises,v_increment_seconds
  from jsonb_array_elements(v_units) u;

  case v_mechanic
    when 'AMRAP' then
      v_rounds := greatest(1,least(v_max_rounds,coalesce((v_sim#>>'{mechanic_projection,expected_rounds_or_sets}')::numeric,1)));
      v_elapsed := v_wod_sec;
      v_active := least(v_elapsed,v_round_active*v_rounds);
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'EMOM' then
      v_cycles := floor(v_wod_min/greatest(1,v_n));
      v_rounds := v_cycles;
      v_elapsed := v_cycles*v_n*60;
      v_active := v_round_active*v_cycles;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_cycles;
      if v_cycles<1 then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_NO_COMPLETE_CYCLE'); end if;
      if coalesce((v_sim#>>'{mechanic_projection,emom_min_station_rest_seconds}')::numeric,0) < coalesce((v_c3_cfg#>>'{operational_assumptions,emom_min_rest_seconds}')::numeric,10) then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_REST_MARGIN');
      end if;

    when 'FOR_TIME' then
      v_rounds := greatest(1,least(v_max_rounds,floor(v_target_sec/v_round_sec)));
      v_elapsed := v_round_sec*v_rounds;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FOR_TIME_EXCEEDS_CAP'); end if;

    when 'CIRCUIT' then
      v_rest_per_round := coalesce((v_c3_cfg#>>'{operational_assumptions,circuit_round_rest_seconds}')::numeric,45);
      v_rounds := greatest(1,least(v_max_rounds,floor((v_target_sec+v_rest_per_round)/(v_round_sec+v_rest_per_round))));
      v_elapsed := v_rounds*v_round_sec + greatest(0,v_rounds-1)*v_rest_per_round;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'STRENGTH' then
      v_rest_per_round := greatest(1,v_n)*coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
      v_sets := greatest(1,least(coalesce((v_c3_cfg#>>'{operational_assumptions,strength_max_sets}')::int,4),
        floor((v_target_sec+v_rest_per_round)/(v_round_sec+v_rest_per_round))));
      v_rounds := v_sets;
      v_elapsed := v_sets*v_round_sec + greatest(0,v_sets-1)*v_rest_per_round;
      v_active := v_round_active*v_sets;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_sets);
      v_multiplier := v_sets;
      if v_sets<2 then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('STRENGTH_LT_2_SETS'); end if;

    when 'LADDER' then
      for i in 3..coalesce((v_cfg#>>'{mechanic_defaults,ladder_max_rungs}')::int,12) loop
        v_tri := i*(i+1)/2.0;
        if v_round_active*v_tri + v_round_transition*i <= v_target_sec then v_rungs:=i; end if;
      end loop;
      if v_rungs<3 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('LADDER_LT_3_RUNGS');
      else
        v_tri := v_rungs*(v_rungs+1)/2.0;
        v_elapsed := v_round_active*v_tri + v_round_transition*v_rungs;
        v_active := v_round_active*v_tri;
        v_rest := greatest(0,v_elapsed-v_active);
        v_multiplier := v_tri;
      end if;

    when 'PYRAMID' then
      v_seq_sum := 9;
      v_rest_per_round := 0;
      v_pyramid_cycles := greatest(1,least(coalesce((v_cfg#>>'{mechanic_defaults,pyramid_max_cycles}')::int,3),
        floor(v_target_sec/greatest(1,v_round_active*v_seq_sum+v_round_transition*5))));
      v_elapsed := v_pyramid_cycles*(v_round_active*v_seq_sum+v_round_transition*5);
      v_active := v_pyramid_cycles*v_round_active*v_seq_sum;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_pyramid_cycles*v_seq_sum;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PYRAMID_EXCEEDS_BUDGET'); end if;

    when 'PROGRESSIVE_INTERVAL' then
      v_interval := coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::numeric,60);
      v_reserve := coalesce((v_cfg#>>'{mechanic_defaults,progressive_reserve_seconds}')::numeric,8);
      v_stage := 0;
      for i in 1..v_wod_min loop
        v_stage_work := v_round_active + (i-1)*v_increment_seconds + v_round_transition;
        if v_stage_work <= v_interval-v_reserve then v_stage:=i; else exit; end if;
      end loop;
      if v_stage<1 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_START_DOES_NOT_FIT');
      else
        v_elapsed := v_stage*v_interval;
        v_active := v_stage*v_round_active + (v_stage-1)*v_stage/2.0*v_increment_seconds;
        v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_stage);
        v_multiplier := v_stage;
      end if;

    else
      v_status:='UNSUPPORTED_MECHANIC';
      v_reasons:=v_reasons||jsonb_build_array('UNSUPPORTED_MECHANIC:'||v_mechanic);
  end case;

  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_total_reps := v_base_reps*v_stage + v_rep_exercises*(v_stage-1)*v_stage/2.0;
    v_total_distance := 0;
    v_total_holds := 0;
  else
    v_total_reps := v_base_reps*v_multiplier;
    v_total_distance := v_base_distance*v_multiplier;
    v_total_holds := v_base_holds*v_multiplier;
  end if;

  v_density := case when v_elapsed>0 then least(100,v_active/v_elapsed*100) else 0 end;
  v_local_index := coalesce((v_sim#>>'{whole_wod_metrics,max_primary_muscle_share}')::numeric,0)*100;
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_local_fit := greatest(0,100-abs(v_local_index-v_target_local));
  v_duration_util := case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_duration_fit := greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_whole_fit := round(
    v_density_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,density_fit}')::numeric,0.45)+
    v_local_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,local_fatigue_fit}')::numeric,0.30)+
    v_duration_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,duration_fit}')::numeric,0.25),2
  );

  if v_duration_util < greatest(0,v_target_util-v_under_tol) then v_duration_status:='UNDERFILLED'; end if;
  if v_duration_util > v_over then v_duration_status:='OVERFILLED'; end if;
  if v_status='OK' and v_duration_status='OVERFILLED' then
    v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED');
  end if;

  v_overlay := case v_mechanic
    when 'AMRAP' then jsonb_build_object('duration_minutes',v_wod_min,'expected_rounds',round(v_rounds,1))
    when 'EMOM' then jsonb_build_object('duration_minutes',round(v_elapsed/60.0,1),'cycles',v_cycles,'station_seconds',60)
    when 'FOR_TIME' then jsonb_build_object('rounds',v_rounds,'cap_seconds',v_wod_sec)
    when 'CIRCUIT' then jsonb_build_object('rounds',v_rounds,'rest_between_rounds_seconds',v_rest_per_round)
    when 'STRENGTH' then jsonb_build_object('sets',v_sets,'rest_between_exercises_seconds',coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75))
    when 'LADDER' then jsonb_build_object('rungs',v_rungs,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2))
    when 'PYRAMID' then jsonb_build_object('cycles',v_pyramid_cycles,'base_reps',coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4),'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}')
    when 'PROGRESSIVE_INTERVAL' then jsonb_build_object('expected_stage',v_stage,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve)
    else '{}'::jsonb
  end;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb) || jsonb_build_object(
      'c4_solver_version','c4-final-v1',
      'block_mechanic',v_mechanic,
      'block_parameters',v_overlay,
      'target_rpe_min',p_stimulus#>>'{rpe_target,min}',
      'target_rpe_max',p_stimulus#>>'{rpe_target,max}'
    );
    v_final_exercises := v_final_exercises || jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  v_mechanic_json := jsonb_build_object(
    'mechanic_key',v_mechanic,
    'parameters',v_overlay,
    'wod_budget_minutes',v_wod_min,
    'predicted_elapsed_seconds',round(v_elapsed,2),
    'time_utilization_percent',round(v_duration_util,2),
    'duration_status',v_duration_status
  );

  return jsonb_set(p_candidate,'{exercises}',v_final_exercises,true) || jsonb_build_object(
    'c4_final',jsonb_build_object(
      'version','c4-final-v1',
      'status',v_status,
      'feasible',v_status='OK',
      'reasons',v_reasons,
      'mechanic_json',v_mechanic_json,
      'predicted_volume',jsonb_build_object(
        'total_reps',round(v_total_reps,2),
        'total_distance_meters',round(v_total_distance,2),
        'total_hold_seconds',round(v_total_holds,2),
        'active_work_seconds',round(v_active,2)
      ),
      'whole_wod_metrics',jsonb_build_object(
        'density_percent',round(v_density,2),
        'density_fit',round(v_density_fit,2),
        'local_fatigue_concentration_index',round(v_local_index,2),
        'local_fatigue_fit',round(v_local_fit,2),
        'duration_fit',round(v_duration_fit,2),
        'duration_status',v_duration_status,
        'time_utilization_percent',round(v_duration_util,2),
        'whole_wod_fit',v_whole_fit,
        'primary_muscle_exposure_ledger',v_sim#>'{whole_wod_metrics,primary_muscle_exposure_ledger}'
      )
    )
  );
end;
$$;

create or replace function public.c4_candidate_quality_gate(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_zone_ids text[] := public.normalize_body_zone_ids(coalesce(p_zone_terms,'{}'::text[]));
  v_readiness text := public.normalize_session_readiness(p_readiness);
  v_ex jsonb;
  e record;
  v_reasons jsonb := '[]'::jsonb;
  v_jump int := 0;
  v_impact5 int := 0;
  v_emom_tech int := 0;
  v_emom_fatigue int := 0;
  v_hinge5 boolean := false;
  v_jump5 boolean := false;
  v_anchor boolean := false;
  v_count int := 0;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    v_reasons:=v_reasons||coalesce(p_candidate#>'{c4_preparation,reasons}','[]'::jsonb);
  end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_count:=v_count+1;
    select id,movement_pattern,exercise_family,technical_complexity,fatigue_score,joint_impact,transition_cost,warmup_only
    into e from public.exercises where id=v_ex->>'exercise_id';
    if not found then
      v_reasons:=v_reasons||jsonb_build_array('UNKNOWN_EXERCISE:'||(v_ex->>'exercise_id'));
      continue;
    end if;

    if not public.exercise_safe_for_zones(e.id,v_zone_ids) then v_reasons:=v_reasons||jsonb_build_array('PAIN_GATE:'||e.id); end if;
    if not public.exercise_equipment_compatible(e.id,p_inventory) then v_reasons:=v_reasons||jsonb_build_array('EQUIPMENT_GATE:'||e.id); end if;
    if coalesce(e.warmup_only,false) then v_reasons:=v_reasons||jsonb_build_array('WARMUP_ONLY_IN_WOD:'||e.id); end if;
    if e.technical_complexity is null or e.fatigue_score is null or e.joint_impact is null then v_reasons:=v_reasons||jsonb_build_array('MISSING_CRITICAL_METADATA:'||e.id); end if;
    if coalesce(e.technical_complexity,99)>p_max_complexity then v_reasons:=v_reasons||jsonb_build_array('TECHNICAL_LEVEL_GATE:'||e.id); end if;

    if v_readiness='low' and coalesce(e.technical_complexity,99)>coalesce((v_cfg#>>'{quality_gate,low_readiness_max_complexity}')::int,3) then
      v_reasons:=v_reasons||jsonb_build_array('LOW_READINESS_COMPLEXITY:'||e.id);
    end if;
    if v_readiness='low' and coalesce(e.fatigue_score,99)>coalesce((v_cfg#>>'{quality_gate,low_readiness_max_fatigue}')::int,4) then
      v_reasons:=v_reasons||jsonb_build_array('LOW_READINESS_FATIGUE:'||e.id);
    end if;

    if e.movement_pattern='Jump' then v_jump:=v_jump+1; end if;
    if coalesce(e.joint_impact,0)>=5 then v_impact5:=v_impact5+1; end if;
    if v_mechanic='AMRAP' and coalesce(e.transition_cost,99)>coalesce((v_cfg#>>'{quality_gate,amrap_max_transition_cost}')::int,3) then
      v_reasons:=v_reasons||jsonb_build_array('AMRAP_TRANSITION_COST:'||e.id);
    end if;
    if v_mechanic='EMOM' and coalesce(e.technical_complexity,0)>=4 then v_emom_tech:=v_emom_tech+1; end if;
    if v_mechanic='EMOM' and coalesce(e.fatigue_score,0)>=5 then v_emom_fatigue:=v_emom_fatigue+1; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Hinge' and coalesce(e.fatigue_score,0)>=5 then v_hinge5:=true; end if;
    if v_mechanic='FOR_TIME' and e.movement_pattern='Jump' and coalesce(e.fatigue_score,0)>=5 then v_jump5:=true; end if;
    if e.movement_pattern in ('Conditioning','Locomotion') or e.exercise_family in ('Conditioning','Locomotion') then v_anchor:=true; end if;
  end loop;

  if v_count=0 then v_reasons:=v_reasons||jsonb_build_array('EMPTY_WOD'); end if;
  if v_jump>coalesce((v_cfg#>>'{quality_gate,max_jump_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('MAX_JUMP_COUNT'); end if;
  if v_impact5>coalesce((v_cfg#>>'{quality_gate,max_joint_impact_5_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('MAX_JOINT_IMPACT_5_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_tech>coalesce((v_cfg#>>'{quality_gate,emom_max_high_complexity_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('EMOM_HIGH_COMPLEXITY_COUNT'); end if;
  if v_mechanic='EMOM' and v_emom_fatigue>coalesce((v_cfg#>>'{quality_gate,emom_max_fatigue_5_count}')::int,1) then v_reasons:=v_reasons||jsonb_build_array('EMOM_FATIGUE_5_COUNT'); end if;
  if v_mechanic='FOR_TIME' and v_hinge5 and v_jump5 then v_reasons:=v_reasons||jsonb_build_array('FOR_TIME_HINGE5_PLUS_JUMP5'); end if;
  if p_focus in ('Conditioning','Fat Loss') and not v_anchor then v_reasons:=v_reasons||jsonb_build_array('CONDITIONING_ANCHOR_REQUIRED'); end if;
  if coalesce((p_candidate#>>'{c4_final,feasible}')::boolean,false)=false then v_reasons:=v_reasons||jsonb_build_array('FINAL_SOLVER_INFEASIBLE'); end if;
  if coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','')='OVERFILLED' then v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED'); end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',jsonb_build_object(
      'pain',true,'equipment',true,'technical_level',true,'readiness_caps',true,
      'jump_count',v_jump,'impact5_count',v_impact5,'conditioning_anchor',v_anchor
    ),
    'version','c4-quality-gate-v1'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_prepared := public.c4_prepare_candidate(v_candidate,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate(v_final,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_candidate->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_candidate->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;

comment on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
is 'Phase C4 final read-only Session Engine solver. C1 stimulus + C2 candidates + C3 whole-WOD simulation + mechanic overlays + hard quality gates + anti-redundancy + final ranking. Does not persist a workout.';;



-- SOURCE MIGRATION: 20260811122852_phase_c4_block_rules_region_coherence.sql
-- C4 refinement: enforce WOD block-rule exercise counts and explicit target-region coherence.

update public.session_engine_policy
set version='c4-final-v1.1',
    config=jsonb_set(config,'{quality_gate,explicit_region_min_share}','0.60'::jsonb,true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_expand_candidate_to_block_rules(
  p_candidate jsonb,
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_max_difficulty text
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_exercises jsonb := coalesce(p_candidate->'exercises','[]'::jsonb);
  v_count int := jsonb_array_length(v_exercises);
  v_min int := 0;
  v_max int := 99;
  v_needed int := 0;
  r record;
  v_added jsonb := '[]'::jsonb;
  v_new_score numeric;
begin
  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;

  if not found then
    return jsonb_set(p_candidate,'{c4_block_rules}',jsonb_build_object(
      'rule_found',false,'exercise_count',v_count,'expanded',false
    ),true);
  end if;

  if v_count < v_min then
    v_needed := v_min-v_count;
    for r in
      select * from public.c2_candidate_pool(
        p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
        p_zone_terms,p_inventory,'WOD',p_max_complexity,p_max_difficulty,40
      ) cp
      where not exists(
        select 1 from jsonb_array_elements(v_exercises) e where e->>'exercise_id'=cp.exercise_id
      )
      order by cp.candidate_score desc,cp.exercise_id
    loop
      exit when v_needed<=0;
      v_exercises := v_exercises || jsonb_build_array(jsonb_build_object(
        'exercise_id',r.exercise_id,
        'name',r.exercise_name,
        'pattern',r.movement_pattern,
        'family',r.exercise_family,
        'candidate_score',r.candidate_score,
        'components',r.score_components,
        'prescription',public.c2_solver_prescription(
          p_user_id,r.exercise_id,
          public.build_session_stimulus_target(p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,'c1-default'),
          v_mechanic,p_progression_intent,p_inventory
        )
      ));
      v_added := v_added || jsonb_build_array(r.exercise_id);
      v_needed := v_needed-1;
    end loop;
  end if;

  select round(coalesce(avg((x->>'candidate_score')::numeric),0)*0.90 + coalesce((p_candidate->>'mechanic_fit')::numeric,0)*0.10,2)
  into v_new_score
  from jsonb_array_elements(v_exercises) x;

  return jsonb_set(
    jsonb_set(
      jsonb_set(p_candidate,'{exercises}',v_exercises,true),
      '{coach_score}',to_jsonb(v_new_score),true
    ),
    '{c4_block_rules}',jsonb_build_object(
      'rule_found',true,
      'min_exercises',v_min,
      'max_exercises',v_max,
      'exercise_count',jsonb_array_length(v_exercises),
      'expanded',jsonb_array_length(v_added)>0,
      'added_exercise_ids',v_added,
      'valid_count',jsonb_array_length(v_exercises) between v_min and v_max
    ),true
  );
end;
$$;

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_base jsonb;
  v_reasons jsonb;
  v_count int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_min int;
  v_max int;
  v_match int := 0;
  v_required int := 0;
  v_share numeric;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_ex jsonb;
  v_region text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_base := public.c4_candidate_quality_gate(
    p_candidate,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons := coalesce(v_base->'hard_gate_reasons','[]'::jsonb);

  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;
  if found and not (v_count between v_min and v_max) then
    v_reasons:=v_reasons||jsonb_build_array('BLOCK_RULE_EXERCISE_COUNT');
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    v_share := coalesce((v_cfg#>>'{quality_gate,explicit_region_min_share}')::numeric,0.60);
    v_required := ceil(v_count*v_share)::int;
    for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
    loop
      select body_region into v_region from public.exercises where id=v_ex->>'exercise_id';
      if v_region=p_target_region then v_match:=v_match+1; end if;
    end loop;
    if v_match<v_required then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE');
    end if;
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',(v_base->'checks') || jsonb_build_object(
      'block_rule_min',v_min,
      'block_rule_max',v_max,
      'exercise_count',v_count,
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required
    ),
    'version','c4-quality-gate-v1.1'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.1','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.1','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.1',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;
;



-- SOURCE MIGRATION: 20260811123006_phase_c4_conditioning_region_balance.sql
update public.session_engine_policy
set version='c4-final-v1.2',
    config=jsonb_set(config,'{quality_gate,conditioning_explicit_region_min_share}','0.34'::jsonb,true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_base jsonb;
  v_reasons jsonb;
  v_count int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_min int;
  v_max int;
  v_match int := 0;
  v_required int := 0;
  v_share numeric;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_ex jsonb;
  v_region text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_base := public.c4_candidate_quality_gate(
    p_candidate,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons := coalesce(v_base->'hard_gate_reasons','[]'::jsonb);

  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;
  if found and not (v_count between v_min and v_max) then
    v_reasons:=v_reasons||jsonb_build_array('BLOCK_RULE_EXERCISE_COUNT');
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    v_share := case when p_focus in ('Conditioning','Fat Loss')
      then coalesce((v_cfg#>>'{quality_gate,conditioning_explicit_region_min_share}')::numeric,0.34)
      else coalesce((v_cfg#>>'{quality_gate,explicit_region_min_share}')::numeric,0.60)
    end;
    v_required := ceil(v_count*v_share)::int;
    for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
    loop
      select body_region into v_region from public.exercises where id=v_ex->>'exercise_id';
      if v_region=p_target_region then v_match:=v_match+1; end if;
    end loop;
    if v_match<v_required then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE');
    end if;
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',(v_base->'checks') || jsonb_build_object(
      'block_rule_min',v_min,
      'block_rule_max',v_max,
      'exercise_count',v_count,
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required,
      'region_min_share',v_share
    ),
    'version','c4-quality-gate-v1.2'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.2','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.2','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.2',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;;



-- SOURCE MIGRATION: 20260811123104_phase_c4_conditioning_target_region_rule.sql
update public.session_engine_policy
set version='c4-final-v1.3',
    config=jsonb_set(config,'{quality_gate,conditioning_region_rule}',to_jsonb('half_floor_min_one'::text),true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_base jsonb;
  v_reasons jsonb;
  v_count int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_min int;
  v_max int;
  v_match int := 0;
  v_required int := 0;
  v_share numeric;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_ex jsonb;
  v_region text;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_base := public.c4_candidate_quality_gate(
    p_candidate,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons := coalesce(v_base->'hard_gate_reasons','[]'::jsonb);

  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;
  if found and not (v_count between v_min and v_max) then
    v_reasons:=v_reasons||jsonb_build_array('BLOCK_RULE_EXERCISE_COUNT');
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    if p_focus in ('Conditioning','Fat Loss') then
      v_required := greatest(1,floor(v_count/2.0)::int);
      v_share := case when v_count>0 then v_required::numeric/v_count else 0 end;
    else
      v_share := coalesce((v_cfg#>>'{quality_gate,explicit_region_min_share}')::numeric,0.60);
      v_required := ceil(v_count*v_share)::int;
    end if;

    for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
    loop
      select body_region into v_region from public.exercises where id=v_ex->>'exercise_id';
      if v_region=p_target_region then v_match:=v_match+1; end if;
    end loop;
    if v_match<v_required then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE');
    end if;
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',(v_base->'checks') || jsonb_build_object(
      'block_rule_min',v_min,
      'block_rule_max',v_max,
      'exercise_count',v_count,
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required,
      'region_min_share',v_share
    ),
    'version','c4-quality-gate-v1.3'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.3','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.3','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.3',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;;



-- SOURCE MIGRATION: 20260811123231_phase_c4_final_duration_gate.sql
update public.session_engine_policy
set version='c4-final-v1.4', updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_candidate_quality_gate_v2(
  p_candidate jsonb,
  p_readiness text,
  p_focus text,
  p_target_region text,
  p_zone_terms text[],
  p_inventory jsonb,
  p_max_complexity integer,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_base jsonb;
  v_reasons jsonb;
  v_count int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_min int;
  v_max int;
  v_match int := 0;
  v_required int := 0;
  v_share numeric;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_ex jsonb;
  v_region text;
  v_duration_status text := coalesce(p_candidate#>>'{c4_final,whole_wod_metrics,duration_status}','');
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_base := public.c4_candidate_quality_gate(
    p_candidate,p_readiness,p_focus,p_zone_terms,p_inventory,p_max_complexity,p_policy_key
  );
  v_reasons := coalesce(v_base->'hard_gate_reasons','[]'::jsonb);

  select min_exercises,max_exercises into v_min,v_max
  from public.block_rules
  where block_key='wod' and upper(coalesce(format,''))=v_mechanic and active
  order by id limit 1;
  if found and not (v_count between v_min and v_max) then
    v_reasons:=v_reasons||jsonb_build_array('BLOCK_RULE_EXERCISE_COUNT');
  end if;

  if p_target_region in ('Upper','Lower','Core') then
    if p_focus in ('Conditioning','Fat Loss') then
      v_required := greatest(1,floor(v_count/2.0)::int);
      v_share := case when v_count>0 then v_required::numeric/v_count else 0 end;
    else
      v_share := coalesce((v_cfg#>>'{quality_gate,explicit_region_min_share}')::numeric,0.60);
      v_required := ceil(v_count*v_share)::int;
    end if;

    for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
    loop
      select body_region into v_region from public.exercises where id=v_ex->>'exercise_id';
      if v_region=p_target_region then v_match:=v_match+1; end if;
    end loop;
    if v_match<v_required then
      v_reasons:=v_reasons||jsonb_build_array('EXPLICIT_TARGET_REGION_COHERENCE');
    end if;
  end if;

  if v_duration_status='UNDERFILLED' then
    v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_UNDERFILLED');
  end if;

  return jsonb_build_object(
    'pass',jsonb_array_length(v_reasons)=0,
    'hard_gate_reasons',v_reasons,
    'mechanic',v_mechanic,
    'checks',(v_base->'checks') || jsonb_build_object(
      'block_rule_min',v_min,
      'block_rule_max',v_max,
      'exercise_count',v_count,
      'target_region',p_target_region,
      'region_match_count',v_match,
      'region_required_count',v_required,
      'region_min_share',v_share,
      'duration_status',v_duration_status
    ),
    'version','c4-quality-gate-v1.4'
  );
end;
$$;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c2 jsonb;
  v_stimulus jsonb;
  v_candidate jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_red jsonb;
  v_score numeric;
  v_weight_coach numeric;
  v_weight_whole numeric;
  v_weight_red numeric;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_sorted jsonb := '[]'::jsonb;
  v_selected jsonb;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_weight_coach := coalesce((v_cfg#>>'{selection_weights,coach_score}')::numeric,0.55);
  v_weight_whole := coalesce((v_cfg#>>'{selection_weights,whole_wod_fit}')::numeric,0.30);
  v_weight_red := coalesce((v_cfg#>>'{selection_weights,anti_redundancy}')::numeric,0.15);

  v_c2 := public.simulate_session_engine_c2(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,greatest(5,least(coalesce(p_candidate_count,10),20))
  );
  v_stimulus := v_c2->'stimulus';

  if coalesce(v_c2#>>'{coherence_gate,status}','OK')<>'OK' then
    return jsonb_build_object(
      'version','c4-final-v1.4','status','NO_SAFE_COHERENT_WOD','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates','[]'::jsonb,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(v_c2->'candidate_sessions','[]'::jsonb))
  loop
    v_expanded := public.c4_expand_candidate_to_block_rules(
      v_candidate,p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty
    );
    v_prepared := public.c4_prepare_candidate(v_expanded,p_policy_key);
    v_final := public.c4_finalize_candidate(v_prepared,v_stimulus,p_duration_minutes,p_exact_wod_minutes,p_policy_key,'c3-sim-default');
    v_gate := public.c4_candidate_quality_gate_v2(v_final,p_readiness,p_focus,p_target_region,p_zone_terms,p_inventory,p_max_complexity,p_policy_key);
    v_red := public.c4_redundancy_score(p_user_id,v_final,p_policy_key);

    if coalesce((v_gate->>'pass')::boolean,false) then
      v_score := round(
        coalesce((v_final->>'coach_score')::numeric,0)*v_weight_coach +
        coalesce((v_final#>>'{c4_final,whole_wod_metrics,whole_wod_fit}')::numeric,0)*v_weight_whole +
        coalesce((v_red->>'score')::numeric,0)*v_weight_red,2
      );
      v_accepted := v_accepted || jsonb_build_array(
        v_final || jsonb_build_object(
          'c4_quality_gate',v_gate,
          'c4_anti_redundancy',v_red,
          'c4_selection_score',v_score
        )
      );
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'mechanic',v_candidate->>'mechanic',
        'exercise_ids',(select coalesce(jsonb_agg(x->>'exercise_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(v_final->'exercises','[]'::jsonb)) x),
        'quality_gate',v_gate,
        'final_status',v_final#>>'{c4_final,status}'
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(x order by (x->>'c4_selection_score')::numeric desc,(x->>'coach_score')::numeric desc),'[]'::jsonb)
  into v_sorted from jsonb_array_elements(v_accepted) x;

  if jsonb_array_length(v_sorted)=0 then
    return jsonb_build_object(
      'version','c4-final-v1.4','status','NO_FINAL_CANDIDATE','production_mutation',false,
      'stimulus',v_stimulus,'selected_candidate',null,'accepted_candidates','[]'::jsonb,
      'rejected_candidates',v_rejected,'c2_coherence_gate',v_c2->'coherence_gate'
    );
  end if;

  v_selected := v_sorted->0;
  return jsonb_build_object(
    'version','c4-final-v1.4',
    'status','READY',
    'production_mutation',false,
    'stimulus',v_stimulus,
    'selected_candidate',v_selected,
    'accepted_candidates',v_sorted,
    'rejected_candidates',v_rejected,
    'candidate_count',jsonb_array_length(v_sorted),
    'selection_weights',v_cfg->'selection_weights',
    'quality_gate_priority',v_stimulus->'hard_gate_priority',
    'legacy_inventory_note',v_cfg#>'{legacy_inventory_defaults,note}'
  );
end;
$$;;



-- SOURCE MIGRATION: 20260811123400_phase_c4_strength_time_solver.sql
update public.session_engine_policy
set version='c4-final-v1.5',
    config=jsonb_set(config,'{mechanic_defaults,strength_max_sets}','5'::jsonb,true),
    updated_at=now()
where policy_key='c4-final-default';

create or replace function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_c3_cfg jsonb;
  v_sim jsonb;
  v_mechanic text := upper(coalesce(p_candidate->>'mechanic',''));
  v_n int := jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  v_wod_min int;
  v_wod_sec numeric;
  v_round_active numeric;
  v_round_transition numeric;
  v_round_sec numeric;
  v_target_util numeric;
  v_target_sec numeric;
  v_elapsed numeric := 0;
  v_active numeric := 0;
  v_rest numeric := 0;
  v_units jsonb;
  v_rounds numeric := 0;
  v_sets numeric := 0;
  v_cycles numeric := 0;
  v_rungs int := 0;
  v_pyramid_cycles int := 0;
  v_stage int := 0;
  v_multiplier numeric := 0;
  v_tri numeric := 0;
  v_total_reps numeric := 0;
  v_total_distance numeric := 0;
  v_total_holds numeric := 0;
  v_base_reps numeric := 0;
  v_base_distance numeric := 0;
  v_base_holds numeric := 0;
  v_rep_exercises int := 0;
  v_increment_seconds numeric := 0;
  v_interval numeric;
  v_reserve numeric;
  v_stage_work numeric;
  v_rest_per_round numeric;
  v_strength_rest numeric;
  v_strength_max_sets int;
  v_max_rounds int;
  v_density numeric := 0;
  v_target_density numeric := coalesce((p_stimulus#>>'{density,score}')::numeric,50);
  v_local_index numeric := 0;
  v_target_local numeric := coalesce((p_stimulus#>>'{local_fatigue,score}')::numeric,50);
  v_density_fit numeric := 0;
  v_local_fit numeric := 0;
  v_duration_util numeric := 0;
  v_duration_fit numeric := 0;
  v_whole_fit numeric := 0;
  v_under_tol numeric;
  v_over numeric;
  v_duration_status text := 'OK';
  v_status text := 'OK';
  v_reasons jsonb := '[]'::jsonb;
  v_mechanic_json jsonb;
  v_final_exercises jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_overlay jsonb;
  v_seq_sum numeric := 9;
  i int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_c4_policy_key;
  select config into v_c3_cfg from public.session_engine_policy where policy_key=p_c3_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_c4_policy_key; end if;
  if v_c3_cfg is null then raise exception 'Unknown C3 policy %',p_c3_policy_key; end if;

  if coalesce((p_candidate#>>'{c4_preparation,mechanic_compatible}')::boolean,true)=false then
    return p_candidate || jsonb_build_object(
      'c4_final',jsonb_build_object('status','INCOMPATIBLE_MECHANIC','feasible',false,'reasons',p_candidate#>'{c4_preparation,reasons}')
    );
  end if;

  v_sim := public.c3_simulate_candidate_wod(p_candidate,p_stimulus,p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_min := public.c3_wod_budget_minutes(p_total_duration_minutes,p_exact_wod_minutes,p_c3_policy_key);
  v_wod_sec := v_wod_min*60;
  v_round_active := coalesce((v_sim#>>'{round_model,active_work_seconds}')::numeric,0);
  v_round_transition := coalesce((v_sim#>>'{round_model,transition_seconds}')::numeric,0);
  v_round_sec := greatest(1,v_round_active+v_round_transition);
  v_units := coalesce(v_sim->'per_exercise_units','[]'::jsonb);
  v_target_util := coalesce((v_c3_cfg#>>array['mechanic_duration_target_percent',v_mechanic])::numeric,85);
  v_target_sec := v_wod_sec*v_target_util/100.0;
  v_max_rounds := coalesce((v_cfg#>>'{mechanic_defaults,max_final_rounds}')::int,20);
  v_under_tol := coalesce((v_cfg#>>'{quality_gate,duration_underfill_tolerance_percent}')::numeric,20);
  v_over := coalesce((v_cfg#>>'{quality_gate,duration_overfill_percent}')::numeric,105);
  v_strength_rest := coalesce((v_c3_cfg#>>'{operational_assumptions,strength_rest_seconds}')::numeric,75);
  v_strength_max_sets := coalesce((v_cfg#>>'{mechanic_defaults,strength_max_sets}')::int,5);

  select
    coalesce(sum(coalesce(nullif(u->>'reps_total','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'distance_meters','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(u->>'duration_seconds','')::numeric,0)),0),
    count(*) filter (where nullif(u->>'reps_total','') is not null),
    coalesce(sum(case when nullif(u->>'reps_total','') is not null then
      coalesce((u->>'estimated_active_work_seconds')::numeric,0)/greatest(1,(u->>'reps_total')::numeric)
      else 0 end),0)
  into v_base_reps,v_base_distance,v_base_holds,v_rep_exercises,v_increment_seconds
  from jsonb_array_elements(v_units) u;

  case v_mechanic
    when 'AMRAP' then
      v_rounds := greatest(1,least(v_max_rounds,coalesce((v_sim#>>'{mechanic_projection,expected_rounds_or_sets}')::numeric,1)));
      v_elapsed := v_wod_sec;
      v_active := least(v_elapsed,v_round_active*v_rounds);
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'EMOM' then
      v_cycles := floor(v_wod_min/greatest(1,v_n));
      v_rounds := v_cycles;
      v_elapsed := v_cycles*v_n*60;
      v_active := v_round_active*v_cycles;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_cycles;
      if v_cycles<1 then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_NO_COMPLETE_CYCLE'); end if;
      if coalesce((v_sim#>>'{mechanic_projection,emom_min_station_rest_seconds}')::numeric,0) < coalesce((v_c3_cfg#>>'{operational_assumptions,emom_min_rest_seconds}')::numeric,10) then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('EMOM_REST_MARGIN');
      end if;

    when 'FOR_TIME' then
      v_rounds := greatest(1,least(v_max_rounds,floor(v_target_sec/v_round_sec)));
      v_elapsed := v_round_sec*v_rounds;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FOR_TIME_EXCEEDS_CAP'); end if;

    when 'CIRCUIT' then
      v_rest_per_round := coalesce((v_c3_cfg#>>'{operational_assumptions,circuit_round_rest_seconds}')::numeric,45);
      v_rounds := greatest(1,least(v_max_rounds,floor((v_target_sec+v_rest_per_round)/(v_round_sec+v_rest_per_round))));
      v_elapsed := v_rounds*v_round_sec + greatest(0,v_rounds-1)*v_rest_per_round;
      v_active := v_round_active*v_rounds;
      v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_rounds);
      v_multiplier := v_rounds;

    when 'STRENGTH' then
      v_sets := 0;
      for i in 2..v_strength_max_sets loop
        if i*v_round_sec + greatest(0,i*v_n-1)*v_strength_rest <= v_target_sec then v_sets:=i; end if;
      end loop;
      if v_sets<2 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('STRENGTH_LT_2_SETS');
      else
        v_rounds := v_sets;
        v_elapsed := v_sets*v_round_sec + greatest(0,v_sets*v_n-1)*v_strength_rest;
        v_active := v_round_active*v_sets;
        v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_sets);
        v_multiplier := v_sets;
      end if;

    when 'LADDER' then
      for i in 3..coalesce((v_cfg#>>'{mechanic_defaults,ladder_max_rungs}')::int,12) loop
        v_tri := i*(i+1)/2.0;
        if v_round_active*v_tri + v_round_transition*i <= v_target_sec then v_rungs:=i; end if;
      end loop;
      if v_rungs<3 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('LADDER_LT_3_RUNGS');
      else
        v_tri := v_rungs*(v_rungs+1)/2.0;
        v_elapsed := v_round_active*v_tri + v_round_transition*v_rungs;
        v_active := v_round_active*v_tri;
        v_rest := greatest(0,v_elapsed-v_active);
        v_multiplier := v_tri;
      end if;

    when 'PYRAMID' then
      v_seq_sum := 9;
      v_pyramid_cycles := greatest(1,least(coalesce((v_cfg#>>'{mechanic_defaults,pyramid_max_cycles}')::int,3),
        floor(v_target_sec/greatest(1,v_round_active*v_seq_sum+v_round_transition*5))));
      v_elapsed := v_pyramid_cycles*(v_round_active*v_seq_sum+v_round_transition*5);
      v_active := v_pyramid_cycles*v_round_active*v_seq_sum;
      v_rest := greatest(0,v_elapsed-v_active);
      v_multiplier := v_pyramid_cycles*v_seq_sum;
      if v_elapsed>v_wod_sec then v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PYRAMID_EXCEEDS_BUDGET'); end if;

    when 'PROGRESSIVE_INTERVAL' then
      v_interval := coalesce((v_cfg#>>'{mechanic_defaults,progressive_interval_seconds}')::numeric,60);
      v_reserve := coalesce((v_cfg#>>'{mechanic_defaults,progressive_reserve_seconds}')::numeric,8);
      v_stage := 0;
      for i in 1..v_wod_min loop
        v_stage_work := v_round_active + (i-1)*v_increment_seconds + v_round_transition;
        if v_stage_work <= v_interval-v_reserve then v_stage:=i; else exit; end if;
      end loop;
      if v_stage<1 then
        v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('PROGRESSIVE_START_DOES_NOT_FIT');
      else
        v_elapsed := v_stage*v_interval;
        v_active := v_stage*v_round_active + (v_stage-1)*v_stage/2.0*v_increment_seconds;
        v_rest := greatest(0,v_elapsed-v_active-v_round_transition*v_stage);
        v_multiplier := v_stage;
      end if;

    else
      v_status:='UNSUPPORTED_MECHANIC';
      v_reasons:=v_reasons||jsonb_build_array('UNSUPPORTED_MECHANIC:'||v_mechanic);
  end case;

  if v_mechanic='PROGRESSIVE_INTERVAL' then
    v_total_reps := v_base_reps*v_stage + v_rep_exercises*(v_stage-1)*v_stage/2.0;
    v_total_distance := 0;
    v_total_holds := 0;
  else
    v_total_reps := v_base_reps*v_multiplier;
    v_total_distance := v_base_distance*v_multiplier;
    v_total_holds := v_base_holds*v_multiplier;
  end if;

  v_density := case when v_elapsed>0 then least(100,v_active/v_elapsed*100) else 0 end;
  v_local_index := coalesce((v_sim#>>'{whole_wod_metrics,max_primary_muscle_share}')::numeric,0)*100;
  v_density_fit := greatest(0,100-abs(v_density-v_target_density));
  v_local_fit := greatest(0,100-abs(v_local_index-v_target_local));
  v_duration_util := case when v_wod_sec>0 then v_elapsed/v_wod_sec*100 else 0 end;
  v_duration_fit := greatest(0,100-abs(v_duration_util-v_target_util)*1.25);
  v_whole_fit := round(
    v_density_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,density_fit}')::numeric,0.45)+
    v_local_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,local_fatigue_fit}')::numeric,0.30)+
    v_duration_fit*coalesce((v_c3_cfg#>>'{whole_wod_fit_weights,duration_fit}')::numeric,0.25),2
  );

  if v_duration_util < greatest(0,v_target_util-v_under_tol) then v_duration_status:='UNDERFILLED'; end if;
  if v_duration_util > v_over then v_duration_status:='OVERFILLED'; end if;
  if v_status='OK' and v_duration_status='OVERFILLED' then
    v_status:='INFEASIBLE'; v_reasons:=v_reasons||jsonb_build_array('FINAL_DURATION_OVERFILLED');
  end if;

  v_overlay := case v_mechanic
    when 'AMRAP' then jsonb_build_object('duration_minutes',v_wod_min,'expected_rounds',round(v_rounds,1))
    when 'EMOM' then jsonb_build_object('duration_minutes',round(v_elapsed/60.0,1),'cycles',v_cycles,'station_seconds',60)
    when 'FOR_TIME' then jsonb_build_object('rounds',v_rounds,'cap_seconds',v_wod_sec)
    when 'CIRCUIT' then jsonb_build_object('rounds',v_rounds,'rest_between_rounds_seconds',v_rest_per_round)
    when 'STRENGTH' then jsonb_build_object('sets',v_sets,'rest_between_exercises_seconds',v_strength_rest)
    when 'LADDER' then jsonb_build_object('rungs',v_rungs,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_start_reps}')::int,2),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,ladder_increment_reps}')::int,2))
    when 'PYRAMID' then jsonb_build_object('cycles',v_pyramid_cycles,'base_reps',coalesce((v_cfg#>>'{mechanic_defaults,pyramid_base_reps}')::int,4),'multipliers',v_cfg#>'{mechanic_defaults,pyramid_multipliers}')
    when 'PROGRESSIVE_INTERVAL' then jsonb_build_object('expected_stage',v_stage,'start_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_start_reps}')::int,3),'increment_reps',coalesce((v_cfg#>>'{mechanic_defaults,progressive_increment_reps}')::int,1),'interval_seconds',v_interval,'stop_reserve_seconds',v_reserve)
    else '{}'::jsonb
  end;

  for v_ex in select value from jsonb_array_elements(coalesce(p_candidate->'exercises','[]'::jsonb))
  loop
    v_pres := coalesce(v_ex->'prescription','{}'::jsonb) || jsonb_build_object(
      'c4_solver_version','c4-final-v1.5',
      'block_mechanic',v_mechanic,
      'block_parameters',v_overlay,
      'target_rpe_min',p_stimulus#>>'{rpe_target,min}',
      'target_rpe_max',p_stimulus#>>'{rpe_target,max}'
    );
    v_final_exercises := v_final_exercises || jsonb_build_array(jsonb_set(v_ex,'{prescription}',v_pres,true));
  end loop;

  v_mechanic_json := jsonb_build_object(
    'mechanic_key',v_mechanic,
    'parameters',v_overlay,
    'wod_budget_minutes',v_wod_min,
    'predicted_elapsed_seconds',round(v_elapsed,2),
    'time_utilization_percent',round(v_duration_util,2),
    'duration_status',v_duration_status
  );

  return jsonb_set(p_candidate,'{exercises}',v_final_exercises,true) || jsonb_build_object(
    'c4_final',jsonb_build_object(
      'version','c4-final-v1.5',
      'status',v_status,
      'feasible',v_status='OK',
      'reasons',v_reasons,
      'mechanic_json',v_mechanic_json,
      'predicted_volume',jsonb_build_object(
        'total_reps',round(v_total_reps,2),
        'total_distance_meters',round(v_total_distance,2),
        'total_hold_seconds',round(v_total_holds,2),
        'active_work_seconds',round(v_active,2)
      ),
      'whole_wod_metrics',jsonb_build_object(
        'density_percent',round(v_density,2),
        'density_fit',round(v_density_fit,2),
        'local_fatigue_concentration_index',round(v_local_index,2),
        'local_fatigue_fit',round(v_local_fit,2),
        'duration_fit',round(v_duration_fit,2),
        'duration_status',v_duration_status,
        'time_utilization_percent',round(v_duration_util,2),
        'whole_wod_fit',v_whole_fit,
        'primary_muscle_exposure_ledger',v_sim#>'{whole_wod_metrics,primary_muscle_exposure_ledger}'
      )
    )
  );
end;
$$;;



-- SOURCE MIGRATION: 20260811123910_phase_c4_version_coherence.sql
-- C4 metadata coherence: keep the canonical public solver version aligned with the finalizer/policy.
alter function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
rename to solve_session_engine_c4_raw_v15;

create or replace function public.solve_session_engine_c4(
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
  p_candidate_count integer default 10,
  p_exact_wod_minutes integer default null,
  p_policy_key text default 'c4-final-default'
)
returns jsonb
language sql
stable
as $$
  select jsonb_set(
    public.solve_session_engine_c4_raw_v15(
      p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
      p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,
      p_exact_wod_minutes,p_policy_key
    ),
    '{version}',
    '"c4-final-v1.5"'::jsonb,
    true
  );
$$;

comment on function public.solve_session_engine_c4(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text)
is 'Canonical C4 Session Engine solver v1.5. Read-only: final C1+C2+C3+C4 selection, quality gates and anti-redundancy; no workout persistence.';;



-- SOURCE MIGRATION: 20260811132942_phase_b27_live_exercise_capability_loop.sql
-- Phase B2.7.1 — controlled activation of the real exercise capability loop.
-- Keeps legacy progression + shadow engine in parallel.

insert into public.performance_engine_policy(
  policy_key,engine_version,positive_confirmations_required,negative_confirmations_required,
  confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
  freshness_half_life_days,active,notes,updated_at
)
select
  'b2.7-live-default','b2.7-live-1',positive_confirmations_required,negative_confirmations_required,
  confidence_half_evidence,positive_candidate_evidence_factor,negative_candidate_evidence_factor,
  freshness_half_life_days,true,
  'B2.7 controlled live policy. Legacy user_exercise_progress and B2.6 shadow remain in parallel during transition.',
  now()
from public.performance_engine_policy
where policy_key='b2.5-draft-default'
on conflict (policy_key) do update set
  engine_version=excluded.engine_version,
  positive_confirmations_required=excluded.positive_confirmations_required,
  negative_confirmations_required=excluded.negative_confirmations_required,
  confidence_half_evidence=excluded.confidence_half_evidence,
  positive_candidate_evidence_factor=excluded.positive_candidate_evidence_factor,
  negative_candidate_evidence_factor=excluded.negative_candidate_evidence_factor,
  freshness_half_life_days=excluded.freshness_half_life_days,
  active=true,
  notes=excluded.notes,
  updated_at=now();

update public.performance_engine_policy
set active=false,updated_at=now()
where policy_key<>'b2.7-live-default' and active;

create table if not exists public.capability_live_run_errors(
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  error_text text not null,
  created_at timestamptz not null default now()
);

alter table public.capability_live_run_errors enable row level security;

drop policy if exists capability_live_run_errors_select_own on public.capability_live_run_errors;
create policy capability_live_run_errors_select_own
on public.capability_live_run_errors for select
to authenticated
using (user_id=auth.uid());

drop policy if exists capability_live_run_errors_insert_own on public.capability_live_run_errors;
create policy capability_live_run_errors_insert_own
on public.capability_live_run_errors for insert
to authenticated
with check (user_id=auth.uid());

-- One applied live proposal per exact log + capability family + fresh/repeatable mode.
create unique index if not exists uq_capability_update_event_live_observation
on public.capability_update_events(
  exercise_log_id,
  capability_family,
  ((comparison_json->>'capability_mode'))
)
where applied and exercise_log_id is not null and (comparison_json->>'capability_mode') is not null;

create or replace function public.run_capability_live_session(
  p_session_id uuid,
  p_engine_policy_key text default 'b2.7-live-default',
  p_quality_policy_key text default 'b2.6-adapter-draft-1'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_policy_active boolean;
  v_log record;
  v_adapter jsonb;
  v_update jsonb;
  v_result jsonb;
  v_family text;
  v_mode text;
  v_applied int:=0;
  v_skipped_existing int:=0;
  v_excluded int:=0;
  v_protocol_scoped int:=0;
begin
  select user_id into v_user_id
  from public.workout_sessions
  where id=p_session_id;

  if not found then
    raise exception 'Unknown session %',p_session_id;
  end if;

  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot run live capability engine for another user session';
  end if;

  select active into v_policy_active
  from public.performance_engine_policy
  where policy_key=p_engine_policy_key;

  if not found then
    raise exception 'Unknown performance engine policy %',p_engine_policy_key;
  end if;

  if not coalesce(v_policy_active,false) then
    raise exception 'Performance engine policy % is not active',p_engine_policy_key;
  end if;

  for v_log in
    select id,user_id,exercise_id,session_exercise_id,created_at
    from public.exercise_logs
    where session_id=p_session_id
    order by created_at,id
  loop
    v_adapter:=public.build_capability_observation_inputs(v_log.id,p_quality_policy_key);

    if coalesce((v_adapter->>'excluded')::boolean,false) then
      v_excluded:=v_excluded+1;
      continue;
    end if;

    for v_update in
      select value from jsonb_array_elements(coalesce(v_adapter->'updates','[]'::jsonb))
    loop
      v_family:=v_update->>'family';
      v_mode:=v_update->>'capability_mode';

      -- Density/progressive belong to protocol capability, not an isolated exercise.
      if v_family not in ('reps','load_reps','time','pace','loaded_distance') then
        v_protocol_scoped:=v_protocol_scoped+1;
        continue;
      end if;

      if exists(
        select 1
        from public.capability_update_events cue
        where cue.exercise_log_id=v_log.id
          and cue.capability_family=v_family
          and cue.applied
          and cue.comparison_json->>'capability_mode'=v_mode
      ) then
        v_skipped_existing:=v_skipped_existing+1;
        continue;
      end if;

      v_result:=public.apply_capability_observation(
        v_log.user_id,
        v_log.exercise_id::varchar,
        v_log.id,
        v_family,
        coalesce(v_adapter->'expected','{}'::jsonb),
        coalesce(v_adapter->'actual','{}'::jsonb),
        coalesce((v_update->>'quality')::numeric,0),
        coalesce((v_adapter->>'capability_eligible')::boolean,false),
        coalesce((v_adapter->>'pain_affected')::boolean,false),
        coalesce(v_adapter->>'observation_role','CAPABILITY_EXCLUDED'),
        coalesce(v_update->'comparison','{}'::jsonb),
        p_engine_policy_key,
        coalesce(v_log.created_at,now())
      );

      if coalesce((v_result->>'applied')::boolean,false) then
        v_applied:=v_applied+1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'version','b2.7-live-runtime-1',
    'session_id',p_session_id,
    'user_id',v_user_id,
    'policy_key',p_engine_policy_key,
    'quality_policy_key',p_quality_policy_key,
    'applied_proposals',v_applied,
    'skipped_existing_proposals',v_skipped_existing,
    'excluded_observations',v_excluded,
    'protocol_scoped_proposals',v_protocol_scoped,
    'legacy_progression_preserved',true,
    'shadow_engine_preserved',true,
    'real_capability_mutated',v_applied>0
  );
end;
$$;

comment on function public.run_capability_live_session(uuid,text,text)
is 'B2.7 controlled live capability runner. Applies exact per-exercise observations idempotently while preserving legacy progression and shadow runtime.';

grant execute on function public.run_capability_live_session(uuid,text,text) to authenticated;;



-- SOURCE MIGRATION: 20260811133129_phase_b27_protocol_capability_foundation.sql
-- Phase B2.7.2 — protocol-level capability foundation.
-- Progressive/density performance belongs to the complete protocol, not to one exercise row.

alter table public.workout_sessions
add column if not exists actual_protocol_outcome_json jsonb not null default '{}'::jsonb;

alter table public.workout_sessions
drop constraint if exists workout_sessions_actual_protocol_outcome_object;
alter table public.workout_sessions
add constraint workout_sessions_actual_protocol_outcome_object
check (jsonb_typeof(actual_protocol_outcome_json)='object');

create table if not exists public.user_protocol_capabilities(
  user_id uuid not null references auth.users(id) on delete cascade,
  protocol_signature text not null,
  mechanic_key text not null,
  variant_key text,
  protocol_json jsonb not null default '{}'::jsonb,
  best_outcome_json jsonb not null default '{}'::jsonb,
  latest_outcome_json jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  freshness numeric not null default 0 check (freshness between 0 and 1),
  effective_evidence numeric not null default 0 check (effective_evidence>=0),
  evidence_count integer not null default 0 check (evidence_count>=0),
  valid_evidence_count integer not null default 0 check (valid_evidence_count>=0),
  last_observed_at timestamptz,
  last_valid_observed_at timestamptz,
  engine_version text not null default 'b2.7-protocol-1',
  updated_at timestamptz not null default now(),
  primary key(user_id,protocol_signature)
);

create table if not exists public.protocol_capability_events(
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  protocol_signature text not null,
  mechanic_key text not null,
  variant_key text,
  protocol_kind text not null,
  decision text not null,
  quality numeric not null default 0 check (quality between 0 and 1),
  expected_json jsonb not null default '{}'::jsonb,
  actual_json jsonb not null default '{}'::jsonb,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  applied boolean not null default true,
  created_at timestamptz not null default now(),
  unique(session_id,protocol_signature)
);

alter table public.user_protocol_capabilities enable row level security;
alter table public.protocol_capability_events enable row level security;

drop policy if exists user_protocol_capabilities_own_all on public.user_protocol_capabilities;
create policy user_protocol_capabilities_own_all
on public.user_protocol_capabilities for all
to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid());

drop policy if exists protocol_capability_events_select_own on public.protocol_capability_events;
create policy protocol_capability_events_select_own
on public.protocol_capability_events for select
to authenticated
using (user_id=auth.uid());

create or replace function public.build_session_protocol_descriptor(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_mechanic text;
  v_variant text;
  v_parameters jsonb;
  v_exercises jsonb;
  v_protocol jsonb;
  v_signature text;
begin
  select
    ws.user_id,
    upper(coalesce(
      nullif(ws.mechanic_json->>'mechanic_key',''),
      nullif(ws.mechanic_json->>'mechanic',''),
      nullif(ws.mechanic_json->>'kind',''),
      nullif(ws.generated_workout->'meta'->>'format',''),
      'UNKNOWN'
    )),
    upper(nullif(coalesce(
      ws.mechanic_json->>'variant_key',
      ws.mechanic_json#>>'{parameters,variant_key}'
    ),'')),
    coalesce(ws.mechanic_json->'parameters','{}'::jsonb)
  into v_user_id,v_mechanic,v_variant,v_parameters
  from public.workout_sessions ws
  where ws.id=p_session_id;

  if not found then raise exception 'Unknown session %',p_session_id; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot inspect another user protocol';
  end if;

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'exercise_id',wse.exercise_id,
      'position',wse.position,
      'prescription',coalesce(wse.prescription_json,'{}'::jsonb)
    )) order by wse.position,wse.id
  ),'[]'::jsonb)
  into v_exercises
  from public.workout_session_exercises wse
  where wse.session_id=p_session_id and wse.block_key='wod';

  v_protocol:=jsonb_strip_nulls(jsonb_build_object(
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'parameters',v_parameters,
    'exercises',v_exercises
  ));

  v_signature:=lower(v_mechanic)||':'||lower(coalesce(v_variant,'base'))||':'||md5(v_protocol::text);

  return jsonb_build_object(
    'protocol_signature',v_signature,
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'protocol_json',v_protocol,
    'exercise_count',jsonb_array_length(v_exercises),
    'version','b2.7-protocol-signature-1'
  );
end;
$$;

create or replace function public.apply_session_protocol_observation(
  p_session_id uuid,
  p_quality numeric default null,
  p_policy_key text default 'b2.7-live-default'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_expected jsonb;
  v_actual jsonb;
  v_observed_at timestamptz;
  v_desc jsonb;
  v_signature text;
  v_mechanic text;
  v_variant text;
  v_kind text;
  v_quality numeric;
  v_policy record;
  v_old public.user_protocol_capabilities%rowtype;
  v_before jsonb:='{}'::jsonb;
  v_best jsonb:='{}'::jsonb;
  v_stage numeric;
  v_partial numeric;
  v_old_stage numeric;
  v_old_partial numeric;
  v_effective numeric:=0;
  v_conf numeric:=0;
  v_decision text;
  v_reason text[]:='{}'::text[];
begin
  select ws.user_id,
         coalesce(nullif(ws.mechanic_json,'{}'::jsonb),ws.generated_workout->'meta','{}'::jsonb),
         coalesce(ws.actual_protocol_outcome_json,'{}'::jsonb),
         coalesce(ws.completed_at,ws.updated_at,now())
  into v_user_id,v_expected,v_actual,v_observed_at
  from public.workout_sessions ws where ws.id=p_session_id;

  if not found then raise exception 'Unknown session %',p_session_id; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot update another user protocol capability';
  end if;

  if v_actual='{}'::jsonb then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','NO_PROTOCOL_ACTUAL','session_id',p_session_id);
  end if;

  if coalesce((v_actual->>'pain_affected')::boolean,false) then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','PAIN_STATE_ONLY','session_id',p_session_id);
  end if;

  select * into v_policy from public.performance_engine_policy where policy_key=p_policy_key and active;
  if not found then raise exception 'Active performance policy % not found',p_policy_key; end if;

  v_desc:=public.build_session_protocol_descriptor(p_session_id);
  v_signature:=v_desc->>'protocol_signature';
  v_mechanic:=v_desc->>'mechanic_key';
  v_variant:=nullif(v_desc->>'variant_key','');

  v_kind:=case
    when coalesce(v_variant,'') in ('DEATH_BY','DEATH_BY_COUPLET') or v_mechanic='PROGRESSIVE_INTERVAL' then 'progressive_limit'
    when v_actual ? 'rounds_completed' or v_actual ? 'work_seconds' then 'density'
    else 'generic_protocol'
  end;

  v_quality:=greatest(0,least(1,coalesce(
    p_quality,
    nullif(v_actual->>'observation_quality','')::numeric,
    case when v_kind='progressive_limit' and v_actual ? 'last_completed_stage' then 0.90 else 0.70 end
  )));

  if exists(select 1 from public.protocol_capability_events where session_id=p_session_id and protocol_signature=v_signature and applied) then
    return jsonb_build_object('version','b2.7-protocol-runtime-1','status','IDEMPOTENT_SKIP','protocol_signature',v_signature,'session_id',p_session_id);
  end if;

  select * into v_old
  from public.user_protocol_capabilities
  where user_id=v_user_id and protocol_signature=v_signature
  for update;

  if found then
    v_before:=jsonb_build_object(
      'best_outcome_json',v_old.best_outcome_json,
      'latest_outcome_json',v_old.latest_outcome_json,
      'confidence',v_old.confidence,
      'freshness',v_old.freshness,
      'effective_evidence',v_old.effective_evidence,
      'evidence_count',v_old.evidence_count,
      'valid_evidence_count',v_old.valid_evidence_count
    );
    v_best:=coalesce(v_old.best_outcome_json,'{}'::jsonb);
    v_effective:=coalesce(v_old.effective_evidence,0)+v_quality;
  else
    v_effective:=v_quality;
  end if;

  if v_kind='progressive_limit' then
    v_stage:=nullif(v_actual->>'last_completed_stage','')::numeric;
    v_partial:=coalesce(nullif(v_actual->>'partial_next_stage_reps','')::numeric,0);
    if v_stage is null then
      return jsonb_build_object('version','b2.7-protocol-runtime-1','status','SKIPPED','reason','PROGRESSIVE_STAGE_MISSING','protocol_signature',v_signature);
    end if;

    v_old_stage:=nullif(v_best->>'last_completed_stage','')::numeric;
    v_old_partial:=coalesce(nullif(v_best->>'partial_next_stage_reps','')::numeric,0);

    if v_old_stage is null then
      v_best:=v_actual;
      v_decision:='INITIALIZE_PROTOCOL';
    elsif v_stage>v_old_stage or (v_stage=v_old_stage and v_partial>v_old_partial) then
      v_best:=v_actual;
      v_decision:='EXPAND_PROTOCOL_FRONTIER';
    elsif v_stage=v_old_stage and v_partial=v_old_partial then
      v_decision:='CONFIRM_PROTOCOL';
    else
      v_decision:='HOLD_BEST_RECALIBRATION_PENDING';
      v_reason:=array['LOWER_SINGLE_PROTOCOL_RESULT_DOES_NOT_REGRESS_BEST'];
    end if;
  else
    if v_best='{}'::jsonb then v_best:=v_actual; end if;
    v_decision:=case when found then 'CONFIRM_PROTOCOL_CONTEXT' else 'INITIALIZE_PROTOCOL_CONTEXT' end;
  end if;

  v_conf:=public.capability_confidence_from_evidence(v_effective,v_policy.confidence_half_evidence);

  insert into public.user_protocol_capabilities(
    user_id,protocol_signature,mechanic_key,variant_key,protocol_json,best_outcome_json,latest_outcome_json,
    confidence,freshness,effective_evidence,evidence_count,valid_evidence_count,last_observed_at,last_valid_observed_at,
    engine_version,updated_at
  ) values (
    v_user_id,v_signature,v_mechanic,v_variant,v_desc->'protocol_json',v_best,v_actual,
    v_conf,1,v_effective,coalesce(v_old.evidence_count,0)+1,coalesce(v_old.valid_evidence_count,0)+1,
    v_observed_at,v_observed_at,'b2.7-protocol-1',now()
  )
  on conflict(user_id,protocol_signature) do update set
    mechanic_key=excluded.mechanic_key,variant_key=excluded.variant_key,protocol_json=excluded.protocol_json,
    best_outcome_json=excluded.best_outcome_json,latest_outcome_json=excluded.latest_outcome_json,
    confidence=excluded.confidence,freshness=excluded.freshness,effective_evidence=excluded.effective_evidence,
    evidence_count=excluded.evidence_count,valid_evidence_count=excluded.valid_evidence_count,
    last_observed_at=excluded.last_observed_at,last_valid_observed_at=excluded.last_valid_observed_at,
    engine_version=excluded.engine_version,updated_at=now();

  insert into public.protocol_capability_events(
    user_id,session_id,protocol_signature,mechanic_key,variant_key,protocol_kind,decision,quality,
    expected_json,actual_json,before_json,after_json,reason_codes,applied
  ) values (
    v_user_id,p_session_id,v_signature,v_mechanic,v_variant,v_kind,v_decision,v_quality,
    v_expected,v_actual,v_before,jsonb_build_object(
      'best_outcome_json',v_best,'latest_outcome_json',v_actual,'confidence',v_conf,'freshness',1,
      'effective_evidence',v_effective
    ),v_reason,true
  );

  return jsonb_build_object(
    'version','b2.7-protocol-runtime-1','status','APPLIED','session_id',p_session_id,
    'protocol_signature',v_signature,'protocol_kind',v_kind,'decision',v_decision,
    'quality',v_quality,'confidence',v_conf,'best_outcome',v_best
  );
end;
$$;

grant execute on function public.build_session_protocol_descriptor(uuid) to authenticated;
grant execute on function public.apply_session_protocol_observation(uuid,numeric,text) to authenticated;

comment on table public.user_protocol_capabilities is
'Protocol-level capability state for multi-exercise or mechanic-specific performance (e.g. Death By Couplet). Kept separate from per-exercise capability.';

comment on function public.apply_session_protocol_observation(uuid,numeric,text) is
'B2.7 protocol capability updater. Progressive-limit protocols such as Death By/Death By Couplet use last completed stage + partial next-stage work as a high-quality performance boundary. One lower result never regresses the stored best.';;



-- SOURCE MIGRATION: 20260811133840_phase_b27_restrict_live_rpc_execution.sql
-- B2.7 hardening: SECURITY DEFINER helpers must never be callable anonymously.

revoke all on function public.run_capability_live_session(uuid,text,text) from public;
revoke all on function public.run_capability_live_session(uuid,text,text) from anon;
grant execute on function public.run_capability_live_session(uuid,text,text) to authenticated;

revoke all on function public.apply_session_protocol_observation(uuid,numeric,text) from public;
revoke all on function public.apply_session_protocol_observation(uuid,numeric,text) from anon;
grant execute on function public.apply_session_protocol_observation(uuid,numeric,text) to authenticated;

revoke all on function public.build_session_protocol_descriptor(uuid) from public;
revoke all on function public.build_session_protocol_descriptor(uuid) from anon;
revoke all on function public.build_session_protocol_descriptor(uuid) from authenticated;
;

