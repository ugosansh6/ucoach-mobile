

-- SOURCE MIGRATION: 20260811200243_fc4_format_catalog_and_entitlement_enforcement.sql
-- F-C4 — dry-run compatibility catalog + server-side entitlement enforcement

create or replace function public.c4_evaluate_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  ws record;
  v_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_names text[];
  v_inventory jsonb;
  v_base jsonb;
  v_exercises jsonb:='[]'::jsonb;
  v_ex jsonb;
  v_pres jsonb;
  v_expanded jsonb;
  v_prepared jsonb;
  v_final jsonb;
  v_gate jsonb;
  v_original_count int;
  v_final_count int;
  v_wod_min int;
  v_class text;
  v_max_complexity int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  select * into ws
  from public.workout_sessions
  where id=p_session_id and user_id=p_user_id;

  if not found then
    return jsonb_build_object(
      'compatible',false,
      'classification','NOT_RECOMMENDED',
      'reason_codes',jsonb_build_array('SESSION_NOT_FOUND')
    );
  end if;

  if not exists(
    select 1
    from public.workout_mechanics wm
    where wm.mechanic_key=v_mechanic
      and wm.active
      and wm.mechanic_kind='core'
  ) then
    return jsonb_build_object(
      'compatible',false,
      'classification','NOT_RECOMMENDED',
      'reason_codes',jsonb_build_array('UNKNOWN_OR_INACTIVE_CORE_MECHANIC')
    );
  end if;

  if v_variant<>'' and not exists(
    select 1
    from public.workout_mechanic_variants wmv
    where wmv.variant_key=v_variant
      and wmv.mechanic_key=v_mechanic
      and wmv.active
  ) then
    return jsonb_build_object(
      'compatible',false,
      'classification','NOT_RECOMMENDED',
      'reason_codes',jsonb_build_array('UNKNOWN_OR_INACTIVE_VARIANT')
    );
  end if;

  v_names:=coalesce(ws.available_equipment,'{}'::text[]);

  if cardinality(v_names)=0 then
    select coalesce(array_agg(e.name order by e.id),'{}'::text[])
    into v_names
    from public.user_equipment_inventory ui
    join public.equipment e on e.id=ui.equipment_id
    where ui.user_id=p_user_id and ui.active;
  end if;

  if cardinality(v_names)=0 then
    v_names:=array['Aucun'];
  end if;

  v_inventory:=public.resolve_user_equipment_inventory(
    p_user_id,
    v_names,
    'c4-final-default'
  );

  v_base:=public.c4_session_wod_candidate(p_session_id);

  if v_base is null or jsonb_array_length(coalesce(v_base->'exercises','[]'::jsonb))=0 then
    return jsonb_build_object(
      'compatible',false,
      'classification','NOT_RECOMMENDED',
      'reason_codes',jsonb_build_array('SESSION_HAS_NO_WOD')
    );
  end if;

  v_original_count:=jsonb_array_length(v_base->'exercises');
  v_max_complexity:=case lower(coalesce(ws.readiness,'normal'))
    when 'low' then 3
    else 5
  end;

  for v_ex in
    select value from jsonb_array_elements(v_base->'exercises')
  loop
    v_pres:=public.c2_solver_prescription(
      p_user_id,
      v_ex->>'exercise_id',
      ws.expected_stimulus_json,
      v_mechanic,
      ws.progression_intent,
      v_inventory
    );

    v_exercises:=v_exercises||jsonb_build_array(
      jsonb_set(v_ex,'{prescription}',v_pres,true)
    );
  end loop;

  v_base:=jsonb_set(v_base,'{exercises}',v_exercises,true);
  v_base:=jsonb_set(v_base,'{mechanic}',to_jsonb(v_mechanic),true);

  if v_variant<>'' then
    v_base:=jsonb_set(v_base,'{variant_key}',to_jsonb(v_variant),true);
  else
    v_base:=v_base-'variant_key';
  end if;

  v_base:=jsonb_set(v_base,'{overlays}','[]'::jsonb,true);

  v_expanded:=public.c4_expand_candidate_to_block_rules(
    v_base,
    p_user_id,
    coalesce(ws.focus,'General Fitness'),
    coalesce(ws.duration_minutes,45),
    coalesce(ws.readiness,'normal'),
    ws.target_region,
    ws.progression_intent,
    coalesce(ws.injured_zones,'{}'::text[]),
    v_inventory,
    v_max_complexity,
    'Avancé'
  );

  v_prepared:=public.c4_prepare_candidate(
    v_expanded,
    'c4-final-default'
  );

  v_wod_min:=coalesce(
    nullif(ws.mechanic_json->>'wod_budget_minutes','')::int,
    nullif(ws.planning_context_json#>>'{architecture,wod_minutes}','')::int,
    (
      select nullif(b->>'duration_minutes','')::int
      from jsonb_array_elements(coalesce(ws.generated_workout->'blocks','[]'::jsonb)) b
      where b->>'block_key'='wod'
      limit 1
    ),
    10
  );

  v_final:=public.c4_finalize_candidate(
    v_prepared,
    ws.expected_stimulus_json,
    coalesce(ws.duration_minutes,45),
    v_wod_min,
    'c4-final-default',
    'c3-sim-default'
  );

  v_gate:=public.c4_candidate_quality_gate_v2(
    v_final,
    coalesce(ws.readiness,'normal'),
    coalesce(ws.focus,'General Fitness'),
    ws.target_region,
    coalesce(ws.injured_zones,'{}'::text[]),
    v_inventory,
    v_max_complexity,
    'c4-final-default'
  );

  v_final_count:=jsonb_array_length(coalesce(v_final->'exercises','[]'::jsonb));

  if coalesce((v_final#>>'{c4_final,feasible}')::boolean,false)=false
     or coalesce((v_gate->>'pass')::boolean,false)=false then
    return jsonb_build_object(
      'compatible',false,
      'classification','NOT_RECOMMENDED',
      'mechanic',v_mechanic,
      'variant_key',nullif(v_variant,''),
      'original_exercise_count',v_original_count,
      'final_exercise_count',v_final_count,
      'reason_codes',coalesce(v_final#>'{c4_final,reasons}','[]'::jsonb)
        || coalesce(v_gate->'hard_gate_reasons','[]'::jsonb),
      'quality_gate',v_gate,
      'mechanic_json',v_final#>'{c4_final,mechanic_json}'
    );
  end if;

  v_class:=case
    when v_final_count=v_original_count then 'COMPATIBLE'
    else 'ADAPTABLE'
  end;

  return jsonb_build_object(
    'compatible',true,
    'classification',v_class,
    'mechanic',v_mechanic,
    'variant_key',nullif(v_variant,''),
    'original_exercise_count',v_original_count,
    'final_exercise_count',v_final_count,
    'reason_codes','[]'::jsonb,
    'quality_gate',v_gate,
    'mechanic_json',v_final#>'{c4_final,mechanic_json}'
  );
end;
$function$;

create or replace function public.get_workout_format_options(
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_tier text;
  v_current_mechanic text;
  v_current_variant text;
  v_options jsonb:='[]'::jsonb;
  v_eval jsonb;
  r record;
  v_entitled boolean;
  v_locked boolean;
  v_compatible boolean;
  v_option_id text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists(
    select 1 from public.workout_sessions
    where id=p_session_id and user_id=v_user_id
  ) then
    raise exception 'Session not found';
  end if;

  select coalesce(subscription_tier,'FREE')
  into v_tier
  from public.profiles
  where id=v_user_id;

  v_tier:=coalesce(v_tier,'FREE');

  select
    upper(coalesce(mechanic_json->>'mechanic_key','CIRCUIT')),
    upper(coalesce(mechanic_json->>'variant_key',''))
  into v_current_mechanic,v_current_variant
  from public.workout_sessions
  where id=p_session_id and user_id=v_user_id;

  -- Core mechanics.
  for r in
    select
      wm.mechanic_key,
      null::text as variant_key,
      wm.display_name,
      wm.short_description,
      wm.manual_free_eligible,
      wm.manual_premium_eligible,
      0 as variant_sort
    from public.workout_mechanics wm
    where wm.active and wm.mechanic_kind='core'

    union all

    -- Named variants are separate user-facing choices.
    select
      wmv.mechanic_key,
      wmv.variant_key,
      wmv.display_name,
      wmv.short_description,
      wmv.manual_free_eligible,
      wmv.manual_premium_eligible,
      1 as variant_sort
    from public.workout_mechanic_variants wmv
    join public.workout_mechanics wm
      on wm.mechanic_key=wmv.mechanic_key
     and wm.active
     and wm.mechanic_kind='core'
    where wmv.active

    order by mechanic_key,variant_sort,variant_key nulls first
  loop
    v_eval:=public.c4_evaluate_session_format(
      v_user_id,
      p_session_id,
      r.mechanic_key,
      r.variant_key
    );

    v_compatible:=coalesce((v_eval->>'compatible')::boolean,false);
    v_entitled:=case
      when v_tier='PREMIUM' then coalesce(r.manual_premium_eligible,false)
      else coalesce(r.manual_free_eligible,false)
    end;
    v_locked:=v_compatible and not v_entitled;
    v_option_id:=case
      when r.variant_key is null then r.mechanic_key
      else r.variant_key
    end;

    v_options:=v_options||jsonb_build_array(
      jsonb_build_object(
        'option_id',v_option_id,
        'mechanic',r.mechanic_key,
        'variant_key',r.variant_key,
        'display_name',r.display_name,
        'description',r.short_description,
        'compatible',v_compatible,
        'classification',coalesce(v_eval->>'classification','NOT_RECOMMENDED'),
        'entitled',v_entitled,
        'locked',v_locked,
        'selectable',v_compatible and v_entitled,
        'current',
          r.mechanic_key=v_current_mechanic
          and coalesce(r.variant_key,'')=coalesce(v_current_variant,''),
        'reason_codes',coalesce(v_eval->'reason_codes','[]'::jsonb),
        'mechanic_json',v_eval->'mechanic_json'
      )
    );
  end loop;

  return jsonb_build_object(
    'session_id',p_session_id,
    'subscription_tier',v_tier,
    'current_mechanic',v_current_mechanic,
    'current_variant',nullif(v_current_variant,''),
    'options',v_options,
    'version','fc4-format-options-v1'
  );
end;
$function$;

-- Keep the existing mutating compiler as a private implementation.
alter function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb)
  rename to c4_recompile_session_format_core;

revoke all on function public.c4_recompile_session_format_core(uuid,uuid,text,text,jsonb)
from public, anon, authenticated;

create or replace function public.c4_recompile_session_format(
  p_user_id uuid,
  p_session_id uuid,
  p_new_mechanic text,
  p_variant_key text default null,
  p_overlays jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_mechanic text:=upper(trim(coalesce(p_new_mechanic,'')));
  v_variant text:=upper(trim(coalesce(p_variant_key,'')));
  v_tier text;
  v_core_allowed boolean:=false;
  v_variant_allowed boolean:=true;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  if not exists(
    select 1 from public.workout_sessions
    where id=p_session_id and user_id=p_user_id
  ) then
    raise exception 'Session not found';
  end if;

  select coalesce(subscription_tier,'FREE')
  into v_tier
  from public.profiles
  where id=p_user_id;

  v_tier:=coalesce(v_tier,'FREE');

  select case
    when v_tier='PREMIUM' then wm.manual_premium_eligible
    else wm.manual_free_eligible
  end
  into v_core_allowed
  from public.workout_mechanics wm
  where wm.mechanic_key=v_mechanic
    and wm.active
    and wm.mechanic_kind='core';

  if coalesce(v_core_allowed,false)=false then
    return jsonb_build_object(
      'status','PREMIUM_REQUIRED',
      'classification','PREMIUM_REQUIRED',
      'mutated',false,
      'mechanic',v_mechanic,
      'variant_key',nullif(v_variant,''),
      'subscription_tier',v_tier
    );
  end if;

  if v_variant<>'' then
    select case
      when v_tier='PREMIUM' then wmv.manual_premium_eligible
      else wmv.manual_free_eligible
    end
    into v_variant_allowed
    from public.workout_mechanic_variants wmv
    where wmv.variant_key=v_variant
      and wmv.mechanic_key=v_mechanic
      and wmv.active;

    if coalesce(v_variant_allowed,false)=false then
      return jsonb_build_object(
        'status','PREMIUM_REQUIRED',
        'classification','PREMIUM_REQUIRED',
        'mutated',false,
        'mechanic',v_mechanic,
        'variant_key',v_variant,
        'subscription_tier',v_tier
      );
    end if;
  end if;

  return public.c4_recompile_session_format_core(
    p_user_id,
    p_session_id,
    v_mechanic,
    nullif(v_variant,''),
    coalesce(p_overlays,'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.c4_evaluate_session_format(uuid,uuid,text,text)
from public, anon, authenticated;

revoke all on function public.get_workout_format_options(uuid)
from public, anon;
grant execute on function public.get_workout_format_options(uuid)
to authenticated;

revoke all on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb)
from public, anon;
grant execute on function public.c4_recompile_session_format(uuid,uuid,text,text,jsonb)
to authenticated;;



-- SOURCE MIGRATION: 20260811200341_fc4_hiit_mechanic_fit.sql
create or replace function public.c2_mechanic_fit(
  p_mechanic_key text,
  p_stimulus jsonb,
  p_progression_intent text default null
)
returns numeric
language plpgsql
stable
set search_path = public
as $function$
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
    when 'HIIT' then m_strength:=30;m_cond:=95;m_end:=82;m_density:=90;m_complexity:=45;
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

  if upper(p_mechanic_key)='HIIT' and v_intent='DELOAD' then
    v_score:=v_score-12;
  end if;

  return round(greatest(0,least(100,v_score)),2);
end;
$function$;;



-- SOURCE MIGRATION: 20260811212452_phase_fc5_execution_status_and_reasons.sql
alter table public.workout_session_exercises
  add column if not exists user_execution_status text,
  add column if not exists execution_reason_code text;

update public.workout_session_exercises
set user_execution_status = case status
  when 'pending' then 'pending'
  when 'skipped' then 'not_completed'
  else 'completed'
end
where user_execution_status is null;

alter table public.workout_session_exercises
  alter column user_execution_status set default 'pending',
  alter column user_execution_status set not null;

alter table public.workout_session_exercises
  drop constraint if exists workout_session_exercises_user_execution_status_check;
alter table public.workout_session_exercises
  add constraint workout_session_exercises_user_execution_status_check
  check (user_execution_status = any (array['pending'::text,'completed'::text,'adapted'::text,'not_completed'::text]));

alter table public.exercise_logs
  add column if not exists user_execution_status text,
  add column if not exists execution_reason_code text;

update public.exercise_logs
set user_execution_status = case status
  when 'skipped' then 'not_completed'
  else 'completed'
end
where user_execution_status is null;

alter table public.exercise_logs
  alter column user_execution_status set default 'completed',
  alter column user_execution_status set not null;

alter table public.exercise_logs
  drop constraint if exists exercise_logs_user_execution_status_check;
alter table public.exercise_logs
  add constraint exercise_logs_user_execution_status_check
  check (user_execution_status = any (array['completed'::text,'adapted'::text,'not_completed'::text]));

comment on column public.workout_session_exercises.user_execution_status is 'User-facing execution outcome. Legacy status remains pending/completed/skipped for engine compatibility.';
comment on column public.workout_session_exercises.execution_reason_code is 'Optional user reason selected on completion screen for adapted or non-completed execution.';
comment on column public.exercise_logs.user_execution_status is 'User-facing completed/adapted/not_completed outcome, separate from legacy completed/skipped capability status.';
comment on column public.exercise_logs.execution_reason_code is 'Optional user-selected reason code for adaptation or non-completion.';;



-- SOURCE MIGRATION: 20260811215105_phase_fc5_deck_runtime_order.sql
create or replace function public.c4_build_deck_order(p_session_id uuid)
returns jsonb
language sql
stable
set search_path to public
as $function$
with ranks as (
  select * from (values
    (1,'2',2),(2,'3',3),(3,'4',4),(4,'5',5),(5,'6',6),(6,'7',7),
    (7,'8',8),(8,'9',9),(9,'10',10),(10,'J',10),(11,'Q',10),(12,'K',10),(13,'A',11)
  ) v(rank_index,rank_label,reps)
), cards as (
  select
    suit_index,
    r.rank_index,
    r.rank_label,
    r.reps,
    md5(p_session_id::text||':'||suit_index::text||':'||r.rank_index::text) as shuffle_key
  from generate_series(1,4) suit_index
  cross join ranks r
), ordered as (
  select
    row_number() over(order by shuffle_key,suit_index,rank_index)::int as card_index,
    suit_index,
    rank_label,
    reps
  from cards
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'card_index',card_index,
      'suit_index',suit_index,
      'rank',rank_label,
      'reps',reps
    ) order by card_index
  ),
  '[]'::jsonb
)
from ordered;
$function$;

revoke all on function public.c4_build_deck_order(uuid) from public, anon;
grant execute on function public.c4_build_deck_order(uuid) to authenticated;

create or replace function public.c4_apply_wod_candidate(p_user_id uuid, p_session_id uuid, p_candidate jsonb, p_quality_gate jsonb, p_action text default 'RECOMPILE'::text)
returns jsonb
language plpgsql
security definer
set search_path to public
as $function$
declare
  ws record;
  v_final jsonb:=coalesce(p_candidate->'c4_final','{}'::jsonb);
  v_mechanic_json jsonb:=coalesce(p_candidate#>'{c4_final,mechanic_json}','{}'::jsonb);
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',v_mechanic_json->>'mechanic_key','CIRCUIT'));
  v_params jsonb:=coalesce(v_mechanic_json->'parameters','{}'::jsonb);
  v_ex jsonb;v_pres jsonb;v_instance uuid;v_name text;v_position int:=0;v_new_count int;
  v_rounds int;v_cap jsonb;v_wod_exercises jsonb:='[]'::jsonb;
  v_generated jsonb;v_blocks jsonb:='[]'::jsonb;v_block jsonb;v_wod_block jsonb:='{}'::jsonb;v_found_wod boolean:=false;
  v_duration int;v_rpe_min numeric;v_rpe_max numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select * into ws from public.workout_sessions where id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  if ws.status not in ('generated','in_progress') then raise exception 'Session cannot be recompiled in status %',ws.status; end if;

  if v_mechanic='DECK' then
    v_mechanic_json:=jsonb_set(
      v_mechanic_json,
      '{parameters,deck_order}',
      public.c4_build_deck_order(p_session_id),
      true
    );
    v_mechanic_json:=jsonb_set(
      v_mechanic_json,
      '{parameters,deck_order_version}',
      to_jsonb('fc5-deterministic-deck-v1'::text),
      true
    );
    v_params:=coalesce(v_mechanic_json->'parameters','{}'::jsonb);
  end if;

  v_new_count:=jsonb_array_length(coalesce(p_candidate->'exercises','[]'::jsonb));
  if v_new_count=0 then raise exception 'Cannot apply empty WOD'; end if;
  v_rpe_min:=nullif(ws.expected_stimulus_json#>>'{rpe_target,min}','')::numeric;
  v_rpe_max:=nullif(ws.expected_stimulus_json#>>'{rpe_target,max}','')::numeric;
  v_rounds:=coalesce(nullif(v_params->>'rounds','')::int,nullif(v_params->>'sets','')::int,nullif(v_params->>'cycles','')::int,nullif(v_params->>'rungs','')::int);

  for v_ex in select value from jsonb_array_elements(p_candidate->'exercises')
  loop
    v_position:=v_position+1;v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    select name into v_name from public.exercises where id=v_ex->>'exercise_id';
    select id into v_instance from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position=v_position;

    select coalesce(jsonb_build_object(
      'source','user_exercise_coach_state','state',s.state,'recommendation',s.recommendation,
      'reps_envelope',s.reps_envelope,'load_envelope',s.load_envelope,'time_envelope',s.time_envelope,'distance_envelope',s.distance_envelope,'pace_envelope',s.pace_envelope,
      'capability_confidence',s.capability_confidence,'capability_freshness',s.capability_freshness,'valid_evidence_count',s.valid_evidence_count),'{}'::jsonb)
    into v_cap from public.user_exercise_coach_state s where s.user_id=p_user_id and s.exercise_id=v_ex->>'exercise_id';

    if v_instance is null then
      insert into public.workout_session_exercises(
        session_id,exercise_id,exercise_name,block_key,position,status,prescription,prescription_json,rounds,
        expected_outcome_json,expected_rpe_min,expected_rpe_max,capacity_snapshot_json,solver_decision_json
      ) values (
        p_session_id,v_ex->>'exercise_id',v_name,'wod',v_position,'pending',public.c4_prescription_text(v_pres),v_pres,v_rounds,
        jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        v_rpe_min,v_rpe_max,coalesce(v_cap,'{}'::jsonb),
        jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic)
      ) returning id into v_instance;
    else
      update public.workout_session_exercises set
        exercise_id=v_ex->>'exercise_id',exercise_name=v_name,status='pending',prescription=public.c4_prescription_text(v_pres),prescription_json=v_pres,rounds=v_rounds,
        expected_outcome_json=jsonb_build_object('mechanic',v_mechanic,'block_parameters',v_params,'predicted_block_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb)),
        expected_rpe_min=v_rpe_min,expected_rpe_max=v_rpe_max,capacity_snapshot_json=coalesce(v_cap,'{}'::jsonb),
        solver_decision_json=jsonb_build_object('engine_version','c4-full-backend-v2','action',p_action,'quality_gate',coalesce(p_quality_gate,'{}'::jsonb),'exercise_candidate_score',v_ex->'candidate_score','score_components',coalesce(v_ex->'components','{}'::jsonb),'mechanic',v_mechanic),
        updated_at=now()
      where id=v_instance;
    end if;

    v_wod_exercises:=v_wod_exercises||jsonb_build_array(jsonb_build_object(
      'id',v_ex->>'exercise_id','session_exercise_id',v_instance,'name',v_name,
      'pattern',(select movement_pattern from public.exercises where id=v_ex->>'exercise_id'),
      'region',(select body_region from public.exercises where id=v_ex->>'exercise_id'),
      'prescription',public.c4_prescription_text(v_pres),'prescription_json',v_pres,
      'tracking_modes',(select to_jsonb(tracking_modes) from public.exercises where id=v_ex->>'exercise_id')
    ));
  end loop;

  delete from public.workout_session_exercises where session_id=p_session_id and block_key='wod' and position>v_new_count;

  v_generated:=coalesce(ws.generated_workout,'{}'::jsonb);
  for v_block in select value from jsonb_array_elements(coalesce(v_generated->'blocks','[]'::jsonb))
  loop
    if v_block->>'block_key'='wod' then
      v_found_wod:=true;
      v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,nullif(v_block->>'duration_minutes','')::int,10);
      v_wod_block:=v_block||jsonb_build_object(
        'block_key','wod','block_name',coalesce(v_block->>'block_name','WOD principal'),'duration_minutes',v_duration,
        'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min',
        'rounds',v_rounds,'exercises',v_wod_exercises,
        'expected_outcome',jsonb_build_object('role','primary_training_stimulus','predicted_volume',coalesce(v_final->'predicted_volume','{}'::jsonb),'whole_wod_metrics',coalesce(v_final->'whole_wod_metrics','{}'::jsonb))
      );
      v_blocks:=v_blocks||jsonb_build_array(v_wod_block);
    else
      v_blocks:=v_blocks||jsonb_build_array(v_block);
    end if;
  end loop;
  if not v_found_wod then
    v_duration:=coalesce(nullif(v_mechanic_json->>'wod_budget_minutes','')::int,10);
    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object('block_key','wod','block_name','WOD principal','duration_minutes',v_duration,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'structure',v_mechanic||' — '||v_duration||' min','rounds',v_rounds,'exercises',v_wod_exercises));
  end if;

  v_generated:=jsonb_set(v_generated,'{blocks}',v_blocks,true);
  v_generated:=jsonb_set(v_generated,'{version}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,session_engine}','"c4-full-backend-v2"'::jsonb,true);
  v_generated:=jsonb_set(v_generated,'{meta,last_wod_action}',to_jsonb(p_action),true);

  update public.workout_sessions set
    mechanic_json=v_mechanic_json,
    quality_gate_json=coalesce(p_quality_gate,'{}'::jsonb),
    generated_workout=v_generated,updated_at=now()
  where id=p_session_id and user_id=p_user_id;

  return jsonb_build_object('status','APPLIED','session_id',p_session_id,'action',p_action,'mechanic',v_mechanic,'mechanic_json',v_mechanic_json,'exercise_count',v_new_count,'exercises',v_wod_exercises,'generated_workout',v_generated);
end;
$function$;;



-- SOURCE MIGRATION: 20260811215757_phase_fc6_protocol_actual_contract.sql
create or replace function public.build_session_protocol_descriptor(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to public
as $function$
declare
  v_user_id uuid;
  v_mechanic text;
  v_variant text;
  v_parameters jsonb;
  v_signature_parameters jsonb;
  v_exercises jsonb;
  v_protocol jsonb;
  v_signature_protocol jsonb;
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

  -- Runtime-only randomization must not create a new capability signature.
  v_signature_parameters:=v_parameters-'deck_order';
  v_signature_protocol:=jsonb_strip_nulls(jsonb_build_object(
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'parameters',v_signature_parameters,
    'exercises',v_exercises
  ));

  v_signature:=lower(v_mechanic)||':'||lower(coalesce(v_variant,'base'))||':'||md5(v_signature_protocol::text);

  return jsonb_build_object(
    'protocol_signature',v_signature,
    'mechanic_key',v_mechanic,
    'variant_key',v_variant,
    'protocol_json',v_protocol,
    'signature_protocol_json',v_signature_protocol,
    'exercise_count',jsonb_array_length(v_exercises),
    'version','b2.7-protocol-signature-2-fc6'
  );
end;
$function$;

create or replace function public.protocol_partial_progress_ratio(p_protocol jsonb, p_actual jsonb)
returns numeric
language plpgsql
immutable
set search_path to public
as $function$
declare
  v_explicit numeric;
  v_failed_stage numeric;
  v_ex jsonb;
  v_id text;
  v_pres jsonb;
  v_overlay jsonb;
  v_start numeric;
  v_increment numeric;
  v_target numeric;
  v_actual_reps numeric;
  v_target_total numeric:=0;
  v_actual_total numeric:=0;
  v_count int:=0;
begin
  v_explicit:=nullif(p_actual->>'partial_progress_ratio','')::numeric;
  if v_explicit is not null then
    return greatest(0,least(1,v_explicit));
  end if;

  v_failed_stage:=coalesce(
    nullif(p_actual->>'failed_stage','')::numeric,
    nullif(p_actual->>'last_completed_stage','')::numeric + 1
  );

  if v_failed_stage is null then return 0; end if;

  if jsonb_typeof(p_actual->'partial_reps_by_exercise')='object' then
    for v_ex in select value from jsonb_array_elements(coalesce(p_protocol->'exercises','[]'::jsonb))
    loop
      v_count:=v_count+1;
      v_id:=v_ex->>'exercise_id';
      v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
      v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);
      v_start:=coalesce(
        nullif(v_overlay->>'start_reps','')::numeric,
        nullif(v_overlay->>'base_reps','')::numeric,
        nullif(v_pres->>'start_reps','')::numeric,
        nullif(v_pres->>'reps_min','')::numeric,
        0
      );
      v_increment:=coalesce(
        nullif(v_overlay->>'increment_reps','')::numeric,
        nullif(v_pres->>'increment_reps','')::numeric,
        0
      );
      v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
      v_actual_reps:=greatest(0,coalesce(nullif(p_actual->'partial_reps_by_exercise'->>v_id,'')::numeric,0));
      v_target_total:=v_target_total+v_target;
      v_actual_total:=v_actual_total+least(v_target,v_actual_reps);
    end loop;

    if v_count>0 and v_target_total>0 then
      return greatest(0,least(1,v_actual_total/v_target_total));
    end if;
  end if;

  if jsonb_array_length(coalesce(p_protocol->'exercises','[]'::jsonb))=1
     and nullif(p_actual->>'partial_next_stage_reps','') is not null then
    v_ex:=p_protocol->'exercises'->0;
    v_pres:=coalesce(v_ex->'prescription','{}'::jsonb);
    v_overlay:=coalesce(v_pres->'mechanic_overlay','{}'::jsonb);
    v_start:=coalesce(
      nullif(v_overlay->>'start_reps','')::numeric,
      nullif(v_overlay->>'base_reps','')::numeric,
      nullif(v_pres->>'start_reps','')::numeric,
      nullif(v_pres->>'reps_min','')::numeric,
      0
    );
    v_increment:=coalesce(
      nullif(v_overlay->>'increment_reps','')::numeric,
      nullif(v_pres->>'increment_reps','')::numeric,
      0
    );
    v_target:=greatest(0,v_start + greatest(0,v_failed_stage-1)*v_increment);
    if v_target>0 then
      return greatest(0,least(1,(p_actual->>'partial_next_stage_reps')::numeric/v_target));
    end if;
  end if;

  return 0;
end;
$function$;

create or replace function public.record_session_protocol_outcome(
  p_session_id uuid,
  p_actual jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_user_id uuid;
  v_existing jsonb;
  v_actual jsonb;
begin
  if p_actual is null or jsonb_typeof(p_actual)<>'object' then
    raise exception 'Protocol outcome must be a JSON object';
  end if;

  select user_id,coalesce(actual_protocol_outcome_json,'{}'::jsonb)
  into v_user_id,v_existing
  from public.workout_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is null or auth.uid()<>v_user_id then
    raise exception 'Forbidden user';
  end if;

  v_actual:=jsonb_strip_nulls(
    p_actual || jsonb_build_object(
      'recorded_at',now(),
      'source','ugerod_session_player',
      'version','fc6-protocol-actual-v1'
    )
  );

  update public.workout_sessions
  set actual_protocol_outcome_json=v_existing||v_actual,
      updated_at=now()
  where id=p_session_id and user_id=v_user_id;

  return jsonb_build_object(
    'status','RECORDED',
    'session_id',p_session_id,
    'actual_protocol_outcome_json',v_existing||v_actual,
    'version','fc6-protocol-actual-v1'
  );
end;
$function$;

revoke all on function public.record_session_protocol_outcome(uuid,jsonb) from public, anon;
grant execute on function public.record_session_protocol_outcome(uuid,jsonb) to authenticated;;



-- SOURCE MIGRATION: 20260811220431_phase_fc6_execution_context_observation_role.sql
create or replace view public.performance_observation_contract as
select
  el.id as exercise_log_id,
  el.user_id,
  el.session_id,
  el.session_exercise_id,
  el.exercise_id,
  e.name as exercise_name,
  wse.block_key,
  wse.position,
  el.source_kind,
  coalesce(
    nullif(wse.expected_outcome_json,'{}'::jsonb),
    nullif(wse.prescription_json,'{}'::jsonb),
    el.prescription_json,
    '{}'::jsonb
  ) as expected_json,
  case
    when el.actual_json <> '{}'::jsonb then el.actual_json
    else jsonb_strip_nulls(jsonb_build_object(
      'reps',el.reps_completed,
      'load_kg',el.weight_kg,
      'duration_seconds',el.duration_seconds,
      'distance_meters',el.distance_meters,
      'rpe',el.rpe,
      'status',el.status,
      'user_execution_status',el.user_execution_status,
      'execution_reason_code',el.execution_reason_code
    ))
  end as actual_json,
  el.observation_context_json,
  el.observation_quality_json,
  el.comparison_context_json,
  el.observation_quality as legacy_quality_scalar,
  el.capability_eligible,
  el.pain_affected,
  el.pain_zones,
  el.skip_reason,
  case
    when el.pain_affected then 'STATE_ONLY_PAIN'::text
    when el.user_execution_status='adapted' then 'CAPABILITY_EXCLUDED'::text
    when el.user_execution_status='not_completed'
         and lower(coalesce(el.execution_reason_code,el.skip_reason,'')) in (
           'equipment','material','time','lack_of_time','motivation'
         ) then 'CONTEXT_ONLY'::text
    when el.status='skipped'::text
         and lower(coalesce(el.skip_reason,'')) in (
           'equipment','material','time','lack_of_time','motivation'
         ) then 'CONTEXT_ONLY'::text
    when el.user_execution_status='not_completed' or el.status='skipped'::text then 'NON_PERFORMANCE_OBSERVATION'::text
    when not el.capability_eligible then 'CAPABILITY_EXCLUDED'::text
    else 'CAPABILITY_CANDIDATE'::text
  end as observation_role,
  el.created_at as observed_at,
  el.user_execution_status,
  el.execution_reason_code
from public.exercise_logs el
left join public.workout_session_exercises wse on wse.id=el.session_exercise_id
left join public.exercises e on e.id::text=el.exercise_id;;



-- SOURCE MIGRATION: 20260811221723_phase_d_weekly_adaptive_loop.sql
create table if not exists public.user_training_weeks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  weekly_session_target smallint not null,
  primary_goal text not null,
  status text not null default 'active',
  plan_version text not null default 'd1-weekly-loop-v1',
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start),
  constraint user_training_weeks_target_check check (weekly_session_target between 1 and 7),
  constraint user_training_weeks_goal_check check (primary_goal in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning')),
  constraint user_training_weeks_status_check check (status in ('active','closed')),
  constraint user_training_weeks_context_check check (jsonb_typeof(context_json)='object')
);

alter table public.user_training_weeks enable row level security;
drop policy if exists "Users own training weeks" on public.user_training_weeks;
create policy "Users own training weeks" on public.user_training_weeks
for all using (auth.uid()=user_id) with check (auth.uid()=user_id);

alter table public.user_training_plan_items
  add column if not exists week_start date,
  add column if not exists planned_focus text,
  add column if not exists planned_target_region text,
  add column if not exists planned_progression_intent text,
  add column if not exists planned_duration_minutes smallint,
  add column if not exists planning_context_json jsonb not null default '{}'::jsonb,
  add column if not exists claimed_at timestamptz;

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_status_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_status_check
  check (status in ('available','claimed','completed','skipped'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_focus_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_focus_check
  check (planned_focus is null or planned_focus in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_region_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_region_check
  check (planned_target_region is null or planned_target_region in ('Upper','Lower','Core','Full Body'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planned_intent_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planned_intent_check
  check (planned_progression_intent is null or planned_progression_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE'));

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_duration_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_duration_check
  check (planned_duration_minutes is null or planned_duration_minutes between 30 and 90);

alter table public.user_training_plan_items drop constraint if exists user_training_plan_items_planning_context_check;
alter table public.user_training_plan_items add constraint user_training_plan_items_planning_context_check
  check (jsonb_typeof(planning_context_json)='object');

create unique index if not exists user_training_plan_items_week_sequence_uidx
  on public.user_training_plan_items(user_id,week_start,sequence_index)
  where week_start is not null;
create index if not exists user_training_plan_items_week_status_idx
  on public.user_training_plan_items(user_id,week_start,status,recommended_date,sequence_index);

create or replace function public.d_week_start(p_date date)
returns date
language sql
immutable
as $$
  select date_trunc('week',p_date::timestamp)::date
$$;

create or replace function public.d_primary_goal(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((
    select g.name
    from public.user_goals ug
    join public.goals g on g.id=ug.goal_id
    where ug.user_id=p_user_id
      and g.name in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning')
    order by coalesce(ug.priority,999),ug.id
    limit 1
  ),'General Fitness')
$$;

create or replace function public.d_plan_recommended_offset(p_sequence int,p_target int)
returns int
language sql
immutable
as $$
  select case
    when greatest(1,p_target)=1 then 0
    else round(((greatest(1,p_sequence)-1)::numeric*6)/(greatest(1,p_target)-1))::int
  end
$$;

create or replace function public.d_base_progression_intent(p_sequence int,p_target int)
returns text
language sql
immutable
as $$
  select case
    when greatest(1,p_sequence)>=greatest(1,p_target) then 'CONSOLIDATE'
    when mod(greatest(1,p_sequence),2)=1 then 'PROGRESS'
    else 'MAINTAIN'
  end
$$;

create or replace function public.d_base_target_region(p_goal text,p_sequence int)
returns text
language plpgsql
immutable
as $$
declare
  v_index int:=mod(greatest(1,p_sequence)-1,4);
begin
  if p_goal in ('Strength','Muscle Gain') then
    return case v_index when 0 then 'Upper' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  if p_goal='Conditioning' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Upper' else 'Full Body' end;
  end if;
  if p_goal='Fat Loss' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  return case v_index when 0 then 'Full Body' when 1 then 'Upper' when 2 then 'Lower' else 'Full Body' end;
end;
$$;

create or replace function public.d_rebuild_weekly_stimulus_targets(
  p_user_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  v_stim jsonb;
  v_duration numeric;
  v_count int:=0;
  v_keys text[]:=array['strength','conditioning','muscular_endurance','power','stability','mobility'];
  v_key text;
  v_score numeric;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot rebuild another user weekly targets';
  end if;

  delete from public.weekly_stimulus_targets
  where user_id=p_user_id and week_start=p_week_start;

  for r in
    select * from public.user_training_plan_items
    where user_id=p_user_id and week_start=p_week_start
    order by sequence_index
  loop
    v_duration:=coalesce(r.planned_duration_minutes,45);
    v_stim:=public.build_session_stimulus_target(
      coalesce(r.planned_focus,public.d_primary_goal(p_user_id)),
      v_duration::int,
      'normal',
      r.planned_target_region,
      r.planned_progression_intent,
      'c1-default'
    );

    foreach v_key in array v_keys loop
      v_score:=coalesce(nullif(v_stim#>>array['qualities',v_key,'score'],'')::numeric,0)*v_duration/60.0;
      insert into public.weekly_stimulus_targets(
        user_id,week_start,stimulus_type,stimulus_key,target_value,unit,context_json,updated_at
      ) values (
        p_user_id,p_week_start,'focus',v_key,v_score,'score_minute',
        jsonb_build_object('source','phase_d_weekly_plan','plan_version','d1-weekly-loop-v1'),now()
      )
      on conflict(user_id,week_start,stimulus_type,stimulus_key) do update set
        target_value=public.weekly_stimulus_targets.target_value+excluded.target_value,
        unit=excluded.unit,
        context_json=excluded.context_json,
        updated_at=now();
    end loop;
    v_count:=v_count+1;
  end loop;

  insert into public.weekly_stimulus_targets(
    user_id,week_start,stimulus_type,stimulus_key,target_value,unit,context_json,updated_at
  ) values (
    p_user_id,p_week_start,'other','sessions',v_count,'session',
    jsonb_build_object('source','phase_d_weekly_plan','plan_version','d1-weekly-loop-v1'),now()
  )
  on conflict(user_id,week_start,stimulus_type,stimulus_key) do update set
    target_value=excluded.target_value,unit=excluded.unit,context_json=excluded.context_json,updated_at=now();

  return jsonb_build_object(
    'status','OK','version','d1-weekly-targets-v1','user_id',p_user_id,'week_start',p_week_start,
    'planned_session_count',v_count
  );
end;
$$;

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if p_force_rebuild and v_exists and not exists(
    select 1 from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
  ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object('created_from_anchor_date',p_anchor_date,'baseline_duration_minutes',45,'planned_not_generated',true)
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object('plan_version','d1-weekly-loop-v1','recommended_date_is_soft',true,'wod_pre_generated',false)
      );
    end loop;
  end if;

  -- Backfill completed sessions that existed before the weekly loop was created.
  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(
        select 1 from public.user_training_plan_items i where i.session_id=ws.id
      )
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;

    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v1','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.d_week_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_completed int;
  v_available int;
  v_claimed int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot inspect another user week';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
  select count(*) filter(where status='completed'),count(*) filter(where status='available'),count(*) filter(where status='claimed')
  into v_completed,v_available,v_claimed
  from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;

  return jsonb_build_object(
    'version','d1-week-snapshot-v1','week_start',v_week,'week_end',v_week+6,'primary_goal',v_goal,
    'weekly_session_target',v_target,'completed_plan_items',v_completed,'available_plan_items',v_available,'claimed_plan_items',v_claimed,
    'actual_completed_sessions',(
      select count(*) from public.workout_sessions ws where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
    ),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence_index) from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week),'[]'::jsonb),
    'stimulus_balance',coalesce((select jsonb_agg(to_jsonb(b) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$$;

create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes int default 45,
  p_readiness text default 'normal',
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_missed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id and i.week_start=v_week and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by i.sequence_index
  limit 1;

  if found then
    return jsonb_build_object(
      'status','RESUME_EXISTING','version','d1-session-context-v1','week_start',v_week,
      'plan_item_id',v_active.id,'resume_session_id',v_active.session_id,
      'focus',v_active.planned_focus,'target_region',v_active.planned_target_region,
      'progression_intent',v_active.planned_progression_intent,
      'reason_codes',jsonb_build_array('weekly_loop:resume_claimed_session')
    );
  end if;

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by
    case when i.recommended_date<=coalesce(p_anchor_date,current_date) then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1
  for update;

  select count(*) into v_missed from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
    and i.recommended_date<coalesce(p_anchor_date,current_date);

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');v_reasons:=array_append(v_reasons,'intent:weekly_plan');
  end if;

  if v_item.id is not null and v_item.recommended_date<coalesce(p_anchor_date,current_date) then
    v_reasons:=array_append(v_reasons,'schedule:soft_reschedule_after_recommended_date');
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v1','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'missed_recommended_dates',v_missed,'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$$;

create or replace function public.d_sync_session_stimulus_ledger(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_user_id uuid;
  v_duration numeric;
  v_factor numeric:=null;
  v_count int;
  v_key text;
  v_score numeric;
  v_planned numeric;
  v_keys text[]:=array['strength','conditioning','muscular_endurance','power','stability','mobility'];
  v_occurred timestamptz;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  v_user_id:=v_session.user_id;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot sync another user session ledger';
  end if;

  v_duration:=coalesce(v_session.duration_minutes,45);
  v_occurred:=coalesce(v_session.completed_at,v_session.generated_at,v_session.created_at,now());

  if v_session.status='completed' then
    select count(*),coalesce(avg(case coalesce(user_execution_status,'pending')
      when 'completed' then 1.0 when 'adapted' then 0.70 when 'not_completed' then 0.0 else 0.0 end),1)
    into v_count,v_factor
    from public.workout_session_exercises where session_id=p_session_id;
    if v_count=0 then v_factor:=1; end if;
  end if;

  delete from public.session_stimulus_ledger
  where session_id=p_session_id and metadata_json->>'source'='phase_d_weekly_loop';

  foreach v_key in array v_keys loop
    v_score:=coalesce(nullif(v_session.expected_stimulus_json#>>array['qualities',v_key,'score'],'')::numeric,0);
    v_planned:=v_score*v_duration/60.0;
    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
    ) values (
      v_user_id,p_session_id,'internal','focus',v_key,v_planned,
      case when v_factor is null then null else v_planned*v_factor end,
      'score_minute',jsonb_build_object('source','phase_d_weekly_loop','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_occurred
    );
  end loop;

  insert into public.session_stimulus_ledger(
    user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
  ) values (
    v_user_id,p_session_id,'internal','other','sessions',1,
    case when v_session.status='completed' then 1 else null end,
    'session',jsonb_build_object('source','phase_d_weekly_loop','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_occurred
  );

  return jsonb_build_object('status','OK','version','d1-stimulus-ledger-v1','session_id',p_session_id,'execution_factor',v_factor);
end;
$$;

create or replace function public.d_finalize_weekly_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_item_id uuid;
  v_week date;
  v_sync jsonb;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then
    raise exception 'Cannot finalize another user weekly session';
  end if;
  if v_session.status<>'completed' then
    return jsonb_build_object('status','SKIPPED','reason','SESSION_NOT_COMPLETED','session_id',p_session_id);
  end if;
  v_week:=public.d_week_start(coalesce(v_session.completed_at,v_session.created_at)::date);

  select id into v_item_id from public.user_training_plan_items
  where user_id=v_session.user_id and session_id=p_session_id
  limit 1 for update;

  if v_item_id is not null then
    update public.user_training_plan_items set status='completed',completed_at=v_session.completed_at,updated_at=now()
    where id=v_item_id;
  end if;

  v_sync:=public.d_sync_session_stimulus_ledger(p_session_id);

  return jsonb_build_object(
    'status','OK','version','d1-finalize-weekly-session-v1','session_id',p_session_id,'plan_item_id',v_item_id,
    'week_start',v_week,'stimulus_ledger',v_sync
  );
end;
$$;

create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null,
  p_progression_intent_override text default null,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire',
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default',
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_context:=public.d_resolve_session_context(
    p_user_id,p_anchor_date,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v1','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb)
    );
  end if;

  v_generated:=public.c4_generate_full_session(
    p_user_id,
    coalesce(v_context->>'focus',p_focus_override,'General Fitness'),
    p_duration_minutes,
    p_readiness,
    nullif(v_context->>'target_region',''),
    nullif(v_context->>'progression_intent',''),
    p_zone_terms,p_inventory,p_available_equipment,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object('weekly_loop',v_context,'version','d1-adaptive-generation-v1');
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;
  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;

  update public.workout_sessions set
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1'
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object(
        'claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context
      )
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v1','weekly_loop',v_context,
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1'
    )
  );
end;
$$;

revoke all on function public.d_ensure_week_plan(uuid,date,boolean) from public,anon;
revoke all on function public.d_week_snapshot(uuid,date) from public,anon;
revoke all on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) from public,anon;
revoke all on function public.d_rebuild_weekly_stimulus_targets(uuid,date) from public,anon;
revoke all on function public.d_sync_session_stimulus_ledger(uuid) from public,anon;
revoke all on function public.d_finalize_weekly_session(uuid) from public,anon;
revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;

grant execute on function public.d_ensure_week_plan(uuid,date,boolean) to authenticated;
grant execute on function public.d_week_snapshot(uuid,date) to authenticated;
grant execute on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) to authenticated;
grant execute on function public.d_finalize_weekly_session(uuid) to authenticated;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated;
;



-- SOURCE MIGRATION: 20260811221845_phase_d_weekly_loop_runtime_errors.sql
create table if not exists public.weekly_loop_run_errors (
  id bigint generated by default as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  error_text text not null,
  created_at timestamptz not null default now()
);
alter table public.weekly_loop_run_errors enable row level security;
drop policy if exists "Users read own weekly loop errors" on public.weekly_loop_run_errors;
create policy "Users read own weekly loop errors" on public.weekly_loop_run_errors for select using (auth.uid()=user_id);
;



-- SOURCE MIGRATION: 20260811222159_phase_d_planned_actual_week_boundary.sql
create or replace function public.d_sync_session_stimulus_ledger(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_user_id uuid;
  v_duration numeric;
  v_factor numeric:=null;
  v_count int;
  v_key text;
  v_score numeric;
  v_planned numeric;
  v_keys text[]:=array['strength','conditioning','muscular_endurance','power','stability','mobility'];
  v_planned_at timestamptz;
  v_realized_at timestamptz;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  v_user_id:=v_session.user_id;
  if auth.uid() is not null and auth.uid()<>v_user_id then
    raise exception 'Cannot sync another user session ledger';
  end if;

  v_duration:=coalesce(v_session.duration_minutes,45);
  v_planned_at:=coalesce(v_session.generated_at,v_session.created_at,now());
  v_realized_at:=coalesce(v_session.completed_at,v_session.updated_at,now());

  if v_session.status='completed' then
    select count(*),coalesce(avg(case coalesce(user_execution_status,'pending')
      when 'completed' then 1.0 when 'adapted' then 0.70 when 'not_completed' then 0.0 else 0.0 end),1)
    into v_count,v_factor
    from public.workout_session_exercises where session_id=p_session_id;
    if v_count=0 then v_factor:=1; end if;
  end if;

  delete from public.session_stimulus_ledger
  where session_id=p_session_id and metadata_json->>'source'='phase_d_weekly_loop';

  foreach v_key in array v_keys loop
    v_score:=coalesce(nullif(v_session.expected_stimulus_json#>>array['qualities',v_key,'score'],'')::numeric,0);
    v_planned:=v_score*v_duration/60.0;

    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
    ) values (
      v_user_id,p_session_id,'internal','focus',v_key,v_planned,null,
      'score_minute',jsonb_build_object('source','phase_d_weekly_loop','ledger_role','planned','progression_intent',v_session.progression_intent),v_planned_at
    );

    if v_factor is not null then
      insert into public.session_stimulus_ledger(
        user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
      ) values (
        v_user_id,p_session_id,'internal','focus',v_key,0,v_planned*v_factor,
        'score_minute',jsonb_build_object('source','phase_d_weekly_loop','ledger_role','realized','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_realized_at
      );
    end if;
  end loop;

  insert into public.session_stimulus_ledger(
    user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
  ) values (
    v_user_id,p_session_id,'internal','other','sessions',1,null,'session',
    jsonb_build_object('source','phase_d_weekly_loop','ledger_role','planned','progression_intent',v_session.progression_intent),v_planned_at
  );

  if v_session.status='completed' then
    insert into public.session_stimulus_ledger(
      user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at
    ) values (
      v_user_id,p_session_id,'internal','other','sessions',0,1,'session',
      jsonb_build_object('source','phase_d_weekly_loop','ledger_role','realized','execution_factor',v_factor,'progression_intent',v_session.progression_intent),v_realized_at
    );
  end if;

  return jsonb_build_object(
    'status','OK','version','d1-stimulus-ledger-v2','session_id',p_session_id,'execution_factor',v_factor,
    'planned_week_start',public.d_week_start(v_planned_at::date),
    'realized_week_start',case when v_factor is null then null else public.d_week_start(v_realized_at::date) end
  );
end;
$$;

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  -- Old unclaimed intentions become explicit misses when a new week begins.
  update public.user_training_plan_items
  set status='skipped',updated_at=now(),planning_context_json=planning_context_json||jsonb_build_object('closed_by_new_week',true)
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if p_force_rebuild and v_exists and not exists(
    select 1 from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
  ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object('created_from_anchor_date',p_anchor_date,'baseline_duration_minutes',45,'planned_not_generated',true)
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object('plan_version','d1-weekly-loop-v1','recommended_date_is_soft',true,'wod_pre_generated',false)
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v2','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes int default 45,
  p_readiness text default 'normal',
  p_focus_override text default null,
  p_target_region_override text default null,
  p_progression_intent_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_missed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;
  perform public.d_ensure_week_plan(p_user_id,p_anchor_date,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  -- Resume an already generated UGEROD session even if it was claimed at the end of the previous week.
  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id and i.status='claimed' and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    return jsonb_build_object(
      'status','RESUME_EXISTING','version','d1-session-context-v2','week_start',v_week,
      'plan_item_id',v_active.id,'resume_session_id',v_active.session_id,
      'focus',v_active.planned_focus,'target_region',v_active.planned_target_region,
      'progression_intent',v_active.planned_progression_intent,
      'reason_codes',jsonb_build_array('weekly_loop:resume_claimed_session')
    );
  end if;

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=coalesce(p_anchor_date,current_date) then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  select count(*) into v_missed from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
    and i.recommended_date<coalesce(p_anchor_date,current_date);

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');v_reasons:=array_append(v_reasons,'intent:weekly_plan');
  end if;

  if v_item.id is not null and v_item.recommended_date<coalesce(p_anchor_date,current_date) then
    v_reasons:=array_append(v_reasons,'schedule:soft_reschedule_after_recommended_date');
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v2','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'missed_recommended_dates',v_missed,'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$$;
;



-- SOURCE MIGRATION: 20260811222255_phase_d_dashboard_planning_snapshot.sql
create or replace function public.d_goal_streak(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_max_weeks int default 12
)
returns int
language plpgsql
security definer
set search_path=public
as $$
declare
  v_current_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_week date;
  v_target int;
  v_completed int;
  v_streak int:=0;
  v_i int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target from public.profiles where id=p_user_id;
  if not found then return 0; end if;

  for v_i in 0..greatest(0,least(coalesce(p_max_weeks,12),52)-1) loop
    v_week:=v_current_week-(v_i*7);
    select count(*) into v_completed
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

    if exists(select 1 from public.user_training_weeks w where w.user_id=p_user_id and w.week_start=v_week) then
      select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    end if;

    if v_completed>=v_target then
      v_streak:=v_streak+1;
    else
      exit;
    end if;
  end loop;
  return v_streak;
end;
$$;

create or replace function public.d_dashboard_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_month_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_month date:=date_trunc('month',coalesce(p_month_start,p_anchor_date,current_date)::timestamp)::date;
  v_month_end date:=(date_trunc('month',v_month::timestamp)+interval '1 month - 1 day')::date;
  v_target int;
  v_goal text;
  v_week_completed int;
  v_total_completed int;
  v_form numeric;
  v_rpe numeric;
  v_streak int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);
  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks where user_id=p_user_id and week_start=v_week;

  select count(*) into v_week_completed from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*) into v_total_completed from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed';

  select round(avg(post_workout_feeling)::numeric,1),round(avg(global_rpe)::numeric,1)
  into v_form,v_rpe
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)>=v_anchor::timestamptz-interval '6 days';

  v_streak:=public.d_goal_streak(p_user_id,v_anchor,12);

  return jsonb_build_object(
    'version','d1-dashboard-snapshot-v1',
    'anchor_date',v_anchor,
    'week_start',v_week,
    'week_end',v_week+6,
    'month_start',v_month,
    'month_end',v_month_end,
    'primary_goal',v_goal,
    'weekly_session_target',v_target,
    'completed_sessions_this_week',v_week_completed,
    'remaining_sessions_this_week',greatest(0,v_target-v_week_completed),
    'weekly_goal_reached',v_week_completed>=v_target,
    'consecutive_goal_weeks',v_streak,
    'total_completed_sessions',v_total_completed,
    'form_trend_7d',v_form,
    'rpe_trend_7d',v_rpe,
    'week_days',coalesce((
      select jsonb_agg(jsonb_build_object(
        'date',d.day_date,
        'completed',coalesce(s.completed,false),
        'session_id',s.session_id,
        'planned',coalesce(p.planned,false),
        'plan_item_id',p.plan_item_id,
        'plan_status',p.plan_status,
        'planned_focus',p.planned_focus,
        'planned_target_region',p.planned_target_region,
        'planned_progression_intent',p.planned_progression_intent,
        'recommended_date_is_soft',true
      ) order by d.day_date)
      from (
        select (v_week+g)::date as day_date from generate_series(0,6) g
      ) d
      left join lateral (
        select true as completed,ws.id as session_id
        from public.workout_sessions ws
        where ws.user_id=p_user_id and ws.status='completed'
          and coalesce(ws.completed_at,ws.created_at)::date=d.day_date
        order by coalesce(ws.completed_at,ws.created_at) desc limit 1
      ) s on true
      left join lateral (
        select true as planned,i.id as plan_item_id,i.status as plan_status,i.planned_focus,i.planned_target_region,i.planned_progression_intent
        from public.user_training_plan_items i
        where i.user_id=p_user_id and i.week_start=v_week and i.recommended_date=d.day_date
        order by i.sequence_index limit 1
      ) p on true
    ),'[]'::jsonb),
    'next_plan_item',coalesce((
      select jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent
      )
      from public.user_training_plan_items i
      where i.user_id=p_user_id and i.week_start=v_week and i.status in ('available','claimed')
      order by case when i.status='claimed' then 0 else 1 end,i.sequence_index limit 1
    ),'{}'::jsonb),
    'month_sessions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id',ws.id,
        'date',coalesce(ws.completed_at,ws.created_at)::date,
        'completed_at',ws.completed_at,
        'focus',ws.focus,
        'target_region',ws.target_region,
        'duration_minutes',ws.duration_minutes,
        'mechanic',coalesce(nullif(ws.mechanic_json->>'variant_key',''),nullif(ws.mechanic_json->>'mechanic_key',''),nullif(ws.mechanic_json->>'mechanic',''),'CIRCUIT'),
        'global_rpe',ws.global_rpe,
        'post_workout_feeling',ws.post_workout_feeling,
        'progression_intent',ws.progression_intent
      ) order by coalesce(ws.completed_at,ws.created_at) desc)
      from public.workout_sessions ws
      where ws.user_id=p_user_id and ws.status='completed'
        and coalesce(ws.completed_at,ws.created_at)::date between v_month and v_month_end
    ),'[]'::jsonb),
    'recent_sessions',coalesce((
      select jsonb_agg(x.obj order by x.completed_at desc)
      from (
        select coalesce(ws.completed_at,ws.created_at) as completed_at,
          jsonb_build_object(
            'session_id',ws.id,'completed_at',ws.completed_at,'date',coalesce(ws.completed_at,ws.created_at)::date,
            'focus',ws.focus,'target_region',ws.target_region,'duration_minutes',ws.duration_minutes,
            'mechanic',coalesce(nullif(ws.mechanic_json->>'variant_key',''),nullif(ws.mechanic_json->>'mechanic_key',''),nullif(ws.mechanic_json->>'mechanic',''),'CIRCUIT'),
            'global_rpe',ws.global_rpe,'post_workout_feeling',ws.post_workout_feeling,'progression_intent',ws.progression_intent
          ) as obj
        from public.workout_sessions ws
        where ws.user_id=p_user_id and ws.status='completed'
        order by coalesce(ws.completed_at,ws.created_at) desc
        limit 5
      ) x
    ),'[]'::jsonb),
    'stimulus_balance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,
        'target_value',b.target_value,'planned_from_sessions',b.planned_from_sessions,
        'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target,
        'completion_ratio',case when coalesce(b.target_value,0)>0 then round(least(1,coalesce(b.realized_value,0)/b.target_value),3) else null end
      ) order by b.stimulus_type,b.stimulus_key)
      from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon;
revoke all on function public.d_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.d_dashboard_snapshot(uuid,date,date) to authenticated;
;



-- SOURCE MIGRATION: 20260811222428_phase_d_restrict_internal_rpc_surface.sql
revoke all on function public.d_primary_goal(uuid) from public,anon,authenticated;
revoke all on function public.d_rebuild_weekly_stimulus_targets(uuid,date) from public,anon,authenticated;
revoke all on function public.d_sync_session_stimulus_ledger(uuid) from public,anon,authenticated;
revoke all on function public.d_resolve_session_context(uuid,date,integer,text,text,text,text) from public,anon,authenticated;
revoke all on function public.d_ensure_week_plan(uuid,date,boolean) from public,anon,authenticated;
revoke all on function public.d_week_snapshot(uuid,date) from public,anon,authenticated;
revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon,authenticated;

-- Public runtime surface intentionally kept for signed-in users only.
revoke all on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) from public,anon;
grant execute on function public.d_generate_adaptive_session(uuid,text,integer,text,text,text,text[],jsonb,text[],integer,text,integer,text,date) to authenticated;

revoke all on function public.d_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.d_dashboard_snapshot(uuid,date,date) to authenticated;

revoke all on function public.d_finalize_weekly_session(uuid) from public,anon;
grant execute on function public.d_finalize_weekly_session(uuid) to authenticated;

create or replace function public.d_week_start(p_date date)
returns date
language sql
immutable
set search_path=pg_catalog,public
as $$
  select date_trunc('week',p_date::timestamp)::date
$$;

create or replace function public.d_plan_recommended_offset(p_sequence int,p_target int)
returns int
language sql
immutable
set search_path=pg_catalog,public
as $$
  select case when greatest(1,p_target)=1 then 0
    else round(((greatest(1,p_sequence)-1)::numeric*6)/(greatest(1,p_target)-1))::int end
$$;

create or replace function public.d_base_progression_intent(p_sequence int,p_target int)
returns text
language sql
immutable
set search_path=pg_catalog,public
as $$
  select case
    when greatest(1,p_sequence)>=greatest(1,p_target) then 'CONSOLIDATE'
    when mod(greatest(1,p_sequence),2)=1 then 'PROGRESS'
    else 'MAINTAIN' end
$$;

create or replace function public.d_base_target_region(p_goal text,p_sequence int)
returns text
language plpgsql
immutable
set search_path=pg_catalog,public
as $$
declare v_index int:=mod(greatest(1,p_sequence)-1,4);
begin
  if p_goal in ('Strength','Muscle Gain') then
    return case v_index when 0 then 'Upper' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  elsif p_goal='Conditioning' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Upper' else 'Full Body' end;
  elsif p_goal='Fat Loss' then
    return case v_index when 0 then 'Full Body' when 1 then 'Lower' when 2 then 'Full Body' else 'Upper' end;
  end if;
  return case v_index when 0 then 'Full Body' when 1 then 'Upper' when 2 then 'Lower' else 'Full Body' end;
end;
$$;;



-- SOURCE MIGRATION: 20260811222512_phase_d_goal_streak_current_week_semantics.sql
create or replace function public.d_goal_streak(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_max_weeks int default 12
)
returns int
language plpgsql
security definer
set search_path=public
as $$
declare
  v_current_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_week date;
  v_target int;
  v_completed int;
  v_streak int:=0;
  v_start_offset int:=0;
  v_i int;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target from public.profiles where id=p_user_id;
  if not found then return 0; end if;

  select count(*) into v_completed
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_current_week and v_current_week+6;

  if exists(select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_current_week) then
    select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_current_week;
  end if;

  -- If the current week is still below target, keep the streak earned by completed previous weeks.
  if v_completed<v_target then
    v_start_offset:=1;
  end if;

  for v_i in v_start_offset..greatest(v_start_offset,least(coalesce(p_max_weeks,12),52)-1+v_start_offset) loop
    v_week:=v_current_week-(v_i*7);

    select least(7,greatest(1,coalesce(weekly_session_target,3))) into v_target
    from public.profiles where id=p_user_id;
    if exists(select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week) then
      select weekly_session_target into v_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    end if;

    select count(*) into v_completed
    from public.workout_sessions ws
    where ws.user_id=p_user_id and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

    if v_completed>=v_target then
      v_streak:=v_streak+1;
    else
      exit;
    end if;
  end loop;
  return v_streak;
end;
$$;
revoke all on function public.d_goal_streak(uuid,date,integer) from public,anon,authenticated;;



-- SOURCE MIGRATION: 20260811231222_phase_e1_coach_teaser_and_soft_week_semantics.sql
alter table public.user_training_plan_items
  drop constraint if exists user_training_plan_items_status_check;

alter table public.user_training_plan_items
  add constraint user_training_plan_items_status_check
  check (status in ('available','claimed','completed','skipped','unrealized'));

update public.user_training_plan_items
set status='unrealized',
    planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
      || jsonb_build_object(
        'closed_week_unrealized',true,
        'recommended_date_is_soft',true,
        'user_debt_created',false
      ),
    updated_at=now()
where status='skipped'
  and coalesce(planning_context_json,'{}'::jsonb) @> '{"closed_by_new_week":true}'::jsonb;

create or replace function public.d_ensure_week_plan(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_force_rebuild boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_exists boolean;
  v_seq int;
  v_offset int;
  v_completed record;
  v_item_id uuid;
  v_existing_completed int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot create another user weekly plan';
  end if;

  select least(7,greatest(1,coalesce(weekly_session_target,3)))
  into v_target from public.profiles where id=p_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_goal:=public.d_primary_goal(p_user_id);

  -- The recommendation date is soft. At week rollover, an unused intention is
  -- archived as unrealized data only. It never creates a debt or a missed-session UX.
  update public.user_training_plan_items
  set status='unrealized',
      updated_at=now(),
      planning_context_json=(coalesce(planning_context_json,'{}'::jsonb)-'closed_by_new_week')
        || jsonb_build_object(
          'closed_week_unrealized',true,
          'recommended_date_is_soft',true,
          'user_debt_created',false
        )
  where user_id=p_user_id and week_start<v_week and status='available';

  update public.user_training_weeks w
  set status='closed',updated_at=now()
  where w.user_id=p_user_id and w.week_start<v_week and w.status='active'
    and not exists(
      select 1 from public.user_training_plan_items i
      join public.workout_sessions ws on ws.id=i.session_id
      where i.user_id=w.user_id and i.week_start=w.week_start and i.status='claimed'
        and ws.status in ('generated','in_progress')
    );

  select exists(
    select 1 from public.user_training_weeks where user_id=p_user_id and week_start=v_week
  ) into v_exists;

  if p_force_rebuild and v_exists and not exists(
    select 1 from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status in ('claimed','completed')
  ) then
    delete from public.user_training_plan_items where user_id=p_user_id and week_start=v_week;
    delete from public.user_training_weeks where user_id=p_user_id and week_start=v_week;
    v_exists:=false;
  end if;

  if not v_exists then
    insert into public.user_training_weeks(
      user_id,week_start,weekly_session_target,primary_goal,status,plan_version,context_json
    ) values (
      p_user_id,v_week,v_target,v_goal,'active','d1-weekly-loop-v1',
      jsonb_build_object(
        'created_from_anchor_date',p_anchor_date,
        'baseline_duration_minutes',45,
        'planned_not_generated',true,
        'recommended_dates_are_soft',true,
        'no_session_debt',true
      )
    );

    for v_seq in 1..v_target loop
      v_offset:=public.d_plan_recommended_offset(v_seq,v_target);
      insert into public.user_training_plan_items(
        user_id,sequence_index,recommended_date,status,week_start,planned_focus,
        planned_target_region,planned_progression_intent,planned_duration_minutes,planning_context_json
      ) values (
        p_user_id,v_seq,v_week+v_offset,'available',v_week,v_goal,
        public.d_base_target_region(v_goal,v_seq),public.d_base_progression_intent(v_seq,v_target),45,
        jsonb_build_object(
          'plan_version','d1-weekly-loop-v1',
          'recommended_date_is_soft',true,
          'wod_pre_generated',false,
          'user_debt_created',false
        )
      );
    end loop;
  end if;

  for v_completed in
    select ws.id,ws.completed_at
    from public.workout_sessions ws
    where ws.user_id=p_user_id
      and ws.status='completed'
      and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6
      and not exists(select 1 from public.user_training_plan_items i where i.session_id=ws.id)
    order by coalesce(ws.completed_at,ws.created_at),ws.id
  loop
    select id into v_item_id
    from public.user_training_plan_items
    where user_id=p_user_id and week_start=v_week and status='available'
    order by sequence_index
    limit 1
    for update;
    exit when v_item_id is null;
    update public.user_training_plan_items set
      status='completed',session_id=v_completed.id,completed_at=v_completed.completed_at,
      claimed_at=coalesce(claimed_at,v_completed.completed_at),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object('backfilled_existing_session',true)
    where id=v_item_id;
    v_existing_completed:=v_existing_completed+1;
    v_item_id:=null;
  end loop;

  perform public.d_rebuild_weekly_stimulus_targets(p_user_id,v_week);

  return jsonb_build_object(
    'status','READY','version','d1-weekly-plan-v3-soft-no-debt','user_id',p_user_id,'week_start',v_week,
    'weekly_session_target',(select weekly_session_target from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'primary_goal',(select primary_goal from public.user_training_weeks where user_id=p_user_id and week_start=v_week),
    'backfilled_completed_sessions',v_existing_completed,
    'recommended_dates_are_soft',true,
    'user_session_debt',false,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'sequence_index',i.sequence_index,'recommended_date',i.recommended_date,'status',i.status,
        'session_id',i.session_id,'planned_focus',i.planned_focus,'planned_target_region',i.planned_target_region,
        'planned_progression_intent',i.planned_progression_intent,'planned_duration_minutes',i.planned_duration_minutes,
        'planning_context',i.planning_context_json
      ) order by i.sequence_index)
      from public.user_training_plan_items i where i.user_id=p_user_id and i.week_start=v_week
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.e_coach_note_preview(
  p_user_id uuid,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_total_completed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_plan_status text;
  v_plan_intent text;
  v_last_rpe numeric;
  v_last_feeling numeric;
  v_last_session_id uuid;
  v_exception_ratio numeric:=0;
  v_category text:='DEFAULT';
  v_confidence text:='LOW';
  v_variant int:=0;
  v_text text;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Forbidden user';
  end if;

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select count(*) into v_total_completed
  from public.workout_sessions
  where user_id=p_user_id and status='completed';

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities
  where user_id=p_user_id;

  select i.status,i.planned_progression_intent
  into v_plan_status,v_plan_intent
  from public.user_training_plan_items i
  where i.user_id=p_user_id
    and i.week_start=v_week
    and i.status in ('claimed','available')
  order by case when i.status='claimed' then 0 else 1 end,
           case when i.recommended_date<=v_anchor then 0 else 1 end,
           i.recommended_date,
           i.sequence_index
  limit 1;

  select ws.id,ws.global_rpe,ws.post_workout_feeling
  into v_last_session_id,v_last_rpe,v_last_feeling
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last_session_id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0
      when 'adapted' then 1
      when 'not_completed' then 1
      else 0 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse
    where wse.session_id=v_last_session_id;
  end if;

  if v_total_completed<4 or v_capability_rows<5 then
    v_confidence:='LOW';
  elsif v_total_completed<10 or v_confident_rows<5 then
    v_confidence:='MEDIUM';
  else
    v_confidence:='HIGH';
  end if;

  if v_plan_status='claimed' then
    v_category:='READY';
  elsif v_total_completed=0 then
    v_category:='STARTER';
  elsif v_confidence='LOW' then
    v_category:='LEARNING';
  elsif v_exception_ratio>=0.50 or v_plan_intent='RECALIBRATE' then
    v_category:='TEST';
  elsif coalesce(v_last_rpe,0)>=9 or coalesce(v_last_feeling,10)<=3 then
    v_category:='CONTROL';
  elsif v_plan_intent='PROGRESS' then
    v_category:='CHALLENGE';
  elsif v_plan_intent='CONSOLIDATE' then
    v_category:='BUILD';
  elsif v_plan_intent='EXPLORE' then
    v_category:='SURPRISE';
  elsif v_plan_intent='DELOAD' then
    v_category:='CONTROL';
  elsif v_plan_intent='MAINTAIN' then
    v_category:='STEADY';
  else
    v_category:='DEFAULT';
  end if;

  v_variant:=get_byte(
    decode(md5(p_user_id::text||'|'||v_anchor::text||'|'||v_category),'hex'),
    0
  ) % 4;

  v_text:=case v_category
    when 'STARTER' then case v_variant
      when 0 then 'Pas de panique, j’aimerais simplement te tester un peu aujourd’hui.'
      when 1 then 'On apprend encore à se connaître. Aujourd’hui, je prends quelques repères.'
      when 2 then 'Pour commencer, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      else 'Première mission : me donner quelques repères. Je m’occupe du reste.' end
    when 'LEARNING' then case v_variant
      when 0 then 'Je commence à mieux te connaître. Aujourd’hui, je prends encore quelques repères.'
      when 1 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 2 then 'On affine encore la recette. Suis simplement ce que je te propose.'
      else 'J’ai encore quelques choses à apprendre sur toi. Aujourd’hui va m’aider.' end
    when 'TEST' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'Aujourd’hui, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      when 2 then 'Je vais ajuster un peu la recette aujourd’hui. Rien à prouver.'
      else 'Petite prise de repères aujourd’hui. Ne cherche pas à en faire plus que prévu.' end
    when 'CONTROL' then case v_variant
      when 0 then 'Aujourd’hui, je garde un peu de marge. On fait les choses proprement.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. Je veux surtout une séance propre.'
      when 2 then 'On garde de l’énergie aujourd’hui. La régularité fait aussi progresser.'
      else 'Aujourd’hui, on joue la carte de la maîtrise. Pas besoin de forcer.' end
    when 'CHALLENGE' then case v_variant
      when 0 then 'J’ai prévu de monter un peu le curseur aujourd’hui. Garde-en sous le pied au départ.'
      when 1 then 'Ça devrait chauffer un peu aujourd’hui. Pars progressivement.'
      when 2 then 'Je vais te challenger un peu plus aujourd’hui. Fais-moi confiance.'
      else 'J’ai quelque chose d’un peu plus relevé pour toi aujourd’hui.' end
    when 'BUILD' then case v_variant
      when 0 then 'Aujourd’hui, on consolide ce qu’on construit depuis quelques séances.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. On continue de bâtir.'
      when 2 then 'Je veux une séance propre aujourd’hui. Le reste viendra tout seul.'
      else 'On avance sans forcer le trait aujourd’hui. Fais confiance au processus.' end
    when 'SURPRISE' then case v_variant
      when 0 then 'Je change un peu la recette aujourd’hui. Fais-moi confiance.'
      when 1 then 'J’ai envie de te surprendre un peu aujourd’hui.'
      when 2 then 'Un peu de nouveauté aujourd’hui. Je garde le reste pour moi.'
      else 'Aujourd’hui, je sors légèrement de nos habitudes. À toi de jouer.' end
    when 'STEADY' then case v_variant
      when 0 then 'Aujourd’hui, on construit. Rien de spectaculaire, mais chaque répétition compte.'
      when 1 then 'On garde le rythme aujourd’hui. Fais simple, propre et régulier.'
      when 2 then 'Séance utile aujourd’hui : pas besoin d’en faire plus que prévu.'
      else 'Je garde la recette simple aujourd’hui. À toi de mettre de la qualité.' end
    when 'READY' then case v_variant
      when 0 then 'Ta séance t’attend. J’ai gardé le reste secret.'
      when 1 then 'Tout est prêt. À toi de venir découvrir ce que je t’ai préparé.'
      when 2 then 'J’ai déjà préparé la suite. On reprend quand tu veux.'
      else 'Ta séance est prête. Je garde encore un peu de suspense.' end
    else case v_variant
      when 0 then 'J’ai préparé quelque chose pour toi aujourd’hui. Fais-moi confiance.'
      when 1 then 'On garde un peu de suspense. Viens voir ce que je t’ai préparé.'
      when 2 then 'Aujourd’hui, suis simplement le plan. Je m’occupe du reste.'
      else 'Une nouvelle séance t’attend. Je garde la recette pour moi.' end
  end;

  return jsonb_build_object(
    'version','e1-coach-note-preview-v1',
    'headline','LE MOT DU COACH',
    'text',v_text,
    'category',v_category,
    'data_confidence',v_confidence,
    'pre_checkin',true,
    'spoiler_safe',true,
    'uses_ai',false,
    'decision_basis',jsonb_build_object(
      'planned_intent',v_plan_intent,
      'completed_sessions',v_total_completed,
      'capability_rows',v_capability_rows,
      'confident_capability_rows',v_confident_rows,
      'previous_exception_ratio',round(v_exception_ratio,3)
    )
  );
end;
$$;

create or replace function public.e_session_coach_note(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_total_completed int:=0;
  v_capability_rows int:=0;
  v_confident_rows int:=0;
  v_confidence text:='LOW';
  v_category text:='DEFAULT';
  v_variant int:=0;
  v_text text;
  v_rpe_max numeric;
  v_density numeric;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  select count(*) into v_total_completed from public.workout_sessions
  where user_id=v_session.user_id and status='completed';

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=v_session.user_id;

  if v_total_completed<4 or v_capability_rows<5 then
    v_confidence:='LOW';
  elsif v_total_completed<10 or v_confident_rows<5 then
    v_confidence:='MEDIUM';
  else
    v_confidence:='HIGH';
  end if;

  v_rpe_max:=nullif(v_session.expected_stimulus_json#>>'{rpe_target,max}','')::numeric;
  v_density:=nullif(v_session.expected_stimulus_json#>>'{density,score}','')::numeric;

  if v_confidence='LOW' then v_category:='LEARNING';
  elsif upper(coalesce(v_session.progression_intent,''))='RECALIBRATE' then v_category:='TEST';
  elsif upper(coalesce(v_session.progression_intent,''))='DELOAD' or lower(coalesce(v_session.readiness,''))='low' then v_category:='CONTROL';
  elsif upper(coalesce(v_session.progression_intent,''))='EXPLORE' then v_category:='SURPRISE';
  elsif upper(coalesce(v_session.progression_intent,''))='CONSOLIDATE' then v_category:='BUILD';
  elsif upper(coalesce(v_session.progression_intent,''))='PROGRESS' and (coalesce(v_rpe_max,0)>=8 or coalesce(v_density,0)>=65) then v_category:='CHALLENGE';
  elsif upper(coalesce(v_session.progression_intent,''))='PROGRESS' then v_category:='BUILD';
  else v_category:='STEADY';
  end if;

  v_variant:=get_byte(decode(md5(v_session.user_id::text||'|'||p_session_id::text||'|'||v_category),'hex'),0)%4;

  v_text:=case v_category
    when 'LEARNING' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'On affine encore la recette. Suis simplement ce que je te propose.'
      when 2 then 'Je prends encore quelques repères aujourd’hui. Fais-moi confiance.'
      else 'On apprend encore à se connaître. Je m’occupe du reste.' end
    when 'TEST' then case v_variant
      when 0 then 'Pas de panique, j’aimerais te tester un peu aujourd’hui.'
      when 1 then 'Aujourd’hui, je veux surtout voir comment tu réagis. Fais-moi confiance.'
      when 2 then 'Je vais ajuster un peu la recette aujourd’hui. Rien à prouver.'
      else 'Petite prise de repères aujourd’hui. Ne cherche pas à en faire plus que prévu.' end
    when 'CONTROL' then case v_variant
      when 0 then 'Aujourd’hui, je garde un peu de marge. On fait les choses proprement.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. Je veux surtout une séance propre.'
      when 2 then 'On garde de l’énergie aujourd’hui. La régularité fait aussi progresser.'
      else 'Aujourd’hui, on joue la carte de la maîtrise. Pas besoin de forcer.' end
    when 'CHALLENGE' then case v_variant
      when 0 then 'J’ai prévu de monter un peu le curseur aujourd’hui. Garde-en sous le pied au départ.'
      when 1 then 'Ça devrait chauffer aujourd’hui. Pars progressivement, tu en auras besoin.'
      when 2 then 'Je vais te challenger un peu plus aujourd’hui. Fais-moi confiance.'
      else 'J’ai quelque chose d’un peu plus relevé pour toi aujourd’hui.' end
    when 'BUILD' then case v_variant
      when 0 then 'Aujourd’hui, on consolide ce qu’on construit depuis quelques séances.'
      when 1 then 'Pas besoin d’en faire trop aujourd’hui. On continue de bâtir.'
      when 2 then 'Je veux une séance propre aujourd’hui. Le reste viendra tout seul.'
      else 'On avance sans forcer le trait aujourd’hui. Fais confiance au processus.' end
    when 'SURPRISE' then case v_variant
      when 0 then 'Je change un peu la recette aujourd’hui. Fais-moi confiance.'
      when 1 then 'J’ai envie de te surprendre un peu aujourd’hui.'
      when 2 then 'Un peu de nouveauté aujourd’hui. Je garde le reste pour moi.'
      else 'Aujourd’hui, je sors légèrement de nos habitudes. À toi de jouer.' end
    else case v_variant
      when 0 then 'On garde le rythme aujourd’hui. Fais simple, propre et régulier.'
      when 1 then 'Séance utile aujourd’hui : pas besoin d’en faire plus que prévu.'
      when 2 then 'Aujourd’hui, suis simplement le plan. Je m’occupe du reste.'
      else 'Je garde la recette simple aujourd’hui. À toi de mettre de la qualité.' end
  end;

  return jsonb_build_object(
    'version','e1-session-coach-note-v1',
    'headline','LE MOT DU COACH',
    'text',v_text,
    'category',v_category,
    'data_confidence',v_confidence,
    'pre_checkin',false,
    'spoiler_safe',true,
    'uses_ai',false
  );
end;
$$;

create or replace function public.e_dashboard_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_month_start date default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_snapshot jsonb;
  v_note jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_snapshot:=public.d_dashboard_snapshot(p_user_id,p_anchor_date,p_month_start);
  v_note:=public.e_coach_note_preview(p_user_id,p_anchor_date);
  return v_snapshot||jsonb_build_object(
    'version','e1-dashboard-snapshot-v1',
    'coach_note',v_note,
    'weekly_schedule_explanation_enabled',false,
    'recommended_dates_are_soft',true,
    'session_debt_enabled',false
  );
end;
$$;

revoke all on function public.e_coach_note_preview(uuid,date) from public,anon;
revoke all on function public.e_session_coach_note(uuid) from public,anon;
revoke all on function public.e_dashboard_snapshot(uuid,date,date) from public,anon;
grant execute on function public.e_coach_note_preview(uuid,date) to authenticated;
grant execute on function public.e_session_coach_note(uuid) to authenticated;
grant execute on function public.e_dashboard_snapshot(uuid,date,date) to authenticated;;



-- SOURCE MIGRATION: 20260811231527_phase_e2_long_term_training_consistency.sql
create or replace function public.e_training_consistency_history(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_months_back integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_months int:=least(120,greatest(1,coalesce(p_months_back,24)));
  v_from date:=(date_trunc('month',v_anchor::timestamp)-((v_months-1)||' months')::interval)::date;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  return jsonb_build_object(
    'version','e2-training-consistency-v1',
    'from_date',v_from,
    'through_date',v_anchor,
    'weeks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start',w.week_start,
        'week_end',w.week_start+6,
        'target_sessions',w.weekly_session_target,
        'realized_sessions',coalesce(a.realized_sessions,0),
        'target_reached',coalesce(a.realized_sessions,0)>=w.weekly_session_target,
        'completion_ratio',case when w.weekly_session_target>0 then round(coalesce(a.realized_sessions,0)::numeric/w.weekly_session_target,3) else null end
      ) order by w.week_start)
      from public.user_training_weeks w
      left join lateral (
        select count(*)::int as realized_sessions
        from public.workout_sessions ws
        where ws.user_id=w.user_id and ws.status='completed'
          and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6
      ) a on true
      where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
    ),'[]'::jsonb),
    'months',coalesce((
      with weeks as (
        select w.week_start,w.weekly_session_target,
          (select count(*)::int from public.workout_sessions ws
           where ws.user_id=w.user_id and ws.status='completed'
             and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6) as realized
        from public.user_training_weeks w
        where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
      )
      select jsonb_agg(jsonb_build_object(
        'month_start',m.month_start,
        'weeks_with_plan',m.weeks_with_plan,
        'target_sessions',m.target_sessions,
        'realized_sessions',m.realized_sessions,
        'completion_ratio',case when m.target_sessions>0 then round(m.realized_sessions::numeric/m.target_sessions,3) else null end
      ) order by m.month_start)
      from (
        select date_trunc('month',week_start::timestamp)::date as month_start,
          count(*)::int as weeks_with_plan,
          sum(weekly_session_target)::int as target_sessions,
          sum(realized)::int as realized_sessions
        from weeks
        group by 1
      ) m
    ),'[]'::jsonb),
    'years',coalesce((
      with weeks as (
        select w.week_start,w.weekly_session_target,
          (select count(*)::int from public.workout_sessions ws
           where ws.user_id=w.user_id and ws.status='completed'
             and coalesce(ws.completed_at,ws.created_at)::date between w.week_start and w.week_start+6) as realized
        from public.user_training_weeks w
        where w.user_id=p_user_id and w.week_start between public.d_week_start(v_from) and public.d_week_start(v_anchor)
      )
      select jsonb_agg(jsonb_build_object(
        'year',y.year_value,
        'weeks_with_plan',y.weeks_with_plan,
        'target_sessions',y.target_sessions,
        'realized_sessions',y.realized_sessions,
        'completion_ratio',case when y.target_sessions>0 then round(y.realized_sessions::numeric/y.target_sessions,3) else null end
      ) order by y.year_value)
      from (
        select extract(year from week_start)::int as year_value,
          count(*)::int as weeks_with_plan,
          sum(weekly_session_target)::int as target_sessions,
          sum(realized)::int as realized_sessions
        from weeks
        group by 1
      ) y
    ),'[]'::jsonb),
    'lifetime',jsonb_build_object(
      'weeks_with_plan',(select count(*) from public.user_training_weeks where user_id=p_user_id),
      'target_sessions',(select coalesce(sum(weekly_session_target),0) from public.user_training_weeks where user_id=p_user_id),
      'realized_sessions',(select count(*) from public.workout_sessions where user_id=p_user_id and status='completed')
    ),
    'semantics',jsonb_build_object(
      'recommended_dates_are_soft',true,
      'unrealized_week_creates_debt',false,
      'new_week_starts_clean',true
    )
  );
end;
$$;

revoke all on function public.e_training_consistency_history(uuid,date,integer) from public,anon;
grant execute on function public.e_training_consistency_history(uuid,date,integer) to authenticated;;



-- SOURCE MIGRATION: 20260812000603_phase_e2_daily_session_refresh_and_dashboard_v1_retry.sql
alter table public.workout_sessions
  add column if not exists generation_local_date date,
  add column if not exists started_local_date date;

update public.workout_sessions
set generation_local_date = coalesce(generation_local_date, generated_at::date)
where generation_local_date is null;

update public.workout_sessions
set started_local_date = coalesce(started_local_date, started_at::date)
where started_at is not null and started_local_date is null;

create or replace function public.e_mark_session_started(
  p_session_id uuid,
  p_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.workout_sessions%rowtype;
  v_date date:=coalesce(p_local_date,current_date);
begin
  select * into v_session
  from public.workout_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Forbidden user'; end if;

  if v_session.status in ('completed','abandoned') then
    return jsonb_build_object('status','CLOSED','session_id',p_session_id,'session_status',v_session.status);
  end if;

  if v_session.status='in_progress'
     and v_session.started_local_date is not null
     and v_session.started_local_date<>v_date then
    return jsonb_build_object(
      'status','STALE_SESSION_REQUIRES_RECHECKIN',
      'session_id',p_session_id,
      'started_local_date',v_session.started_local_date,
      'requested_local_date',v_date
    );
  end if;

  update public.workout_sessions
  set status='in_progress',
      started_at=coalesce(started_at,now()),
      started_local_date=coalesce(started_local_date,v_date),
      generation_local_date=coalesce(generation_local_date,v_date),
      updated_at=now()
  where id=p_session_id;

  return jsonb_build_object(
    'status','IN_PROGRESS',
    'session_id',p_session_id,
    'started_local_date',coalesce(v_session.started_local_date,v_date),
    'frozen_for_local_day',true
  );
end;
$function$;

revoke all on function public.e_mark_session_started(uuid,date) from public, anon;
grant execute on function public.e_mark_session_started(uuid,date) to authenticated;

create or replace function public.d_resolve_session_context(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_duration_minutes integer default 45,
  p_readiness text default 'normal'::text,
  p_focus_override text default null::text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_week date:=public.d_week_start(coalesce(p_anchor_date,current_date));
  v_target int;
  v_goal text;
  v_item public.user_training_plan_items%rowtype;
  v_active public.user_training_plan_items%rowtype;
  v_active_session public.workout_sessions%rowtype;
  v_completed_count int;
  v_last record;
  v_exception_ratio numeric:=0;
  v_intent text;
  v_focus text;
  v_region text;
  v_reasons text[]:='{}'::text[];
  v_override_intent text:=upper(nullif(trim(coalesce(p_progression_intent_override,'')),''));
  v_readiness text:=lower(trim(coalesce(p_readiness,'normal')));
  v_capability_rows int:=0;
  v_confident_rows int:=0;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot resolve another user session context';
  end if;

  perform public.d_ensure_week_plan(p_user_id,v_anchor,false);

  select weekly_session_target,primary_goal into v_target,v_goal
  from public.user_training_weeks
  where user_id=p_user_id and week_start=v_week;

  select i.* into v_active
  from public.user_training_plan_items i
  join public.workout_sessions ws on ws.id=i.session_id and ws.user_id=i.user_id
  where i.user_id=p_user_id
    and i.status='claimed'
    and ws.status in ('generated','in_progress')
  order by coalesce(i.claimed_at,i.updated_at) desc
  limit 1;

  if found then
    select * into v_active_session
    from public.workout_sessions
    where id=v_active.session_id;

    if v_active_session.status='in_progress'
       and v_active_session.started_local_date=v_anchor then
      return jsonb_build_object(
        'status','RESUME_EXISTING',
        'version','d1-session-context-v3-daily-freeze',
        'week_start',v_week,
        'plan_item_id',v_active.id,
        'resume_session_id',v_active.session_id,
        'focus',v_active.planned_focus,
        'target_region',v_active.planned_target_region,
        'progression_intent',v_active.planned_progression_intent,
        'started_local_date',v_active_session.started_local_date,
        'frozen_for_local_day',true,
        'reason_codes',jsonb_build_array('daily_session:resume_started_today')
      );
    end if;

    delete from public.session_stimulus_ledger
    where session_id=v_active.session_id
      and metadata_json->>'source'='phase_d_weekly_loop';

    update public.workout_sessions
    set status='abandoned',
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh',jsonb_build_object(
            'released_at',now(),
            'released_for_local_date',v_anchor,
            'reason',case
              when v_active_session.status='generated' then 'new_checkin_before_start'
              else 'new_local_day_after_started_session'
            end
          )
        ),
        updated_at=now()
    where id=v_active.session_id;

    update public.user_training_plan_items
    set status=case when week_start<v_week then 'skipped' else 'available' end,
        session_id=null,
        claimed_at=null,
        updated_at=now(),
        planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
          'daily_refresh_released_session_id',v_active.session_id,
          'daily_refresh_released_at',now()
        )
    where id=v_active.id;

    v_reasons:=array_append(v_reasons,
      case when v_active_session.status='generated'
        then 'daily_session:rebuild_for_new_checkin'
        else 'daily_session:unfreeze_new_local_day'
      end
    );
  end if;

  select count(*) into v_completed_count
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and coalesce(ws.completed_at,ws.created_at)::date between v_week and v_week+6;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_capability_rows,v_confident_rows
  from public.user_exercise_capabilities where user_id=p_user_id;

  select ws.id,ws.global_rpe,ws.post_workout_feeling,ws.target_region,ws.completed_at into v_last
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
  order by coalesce(ws.completed_at,ws.updated_at) desc
  limit 1;

  if v_last.id is not null then
    select coalesce(avg(case coalesce(wse.user_execution_status,'pending')
      when 'completed' then 0 when 'adapted' then 1 else 1 end),0)
    into v_exception_ratio
    from public.workout_session_exercises wse where wse.session_id=v_last.id;
  end if;

  select i.* into v_item
  from public.user_training_plan_items i
  where i.user_id=p_user_id and i.week_start=v_week and i.status='available'
  order by case when i.recommended_date<=v_anchor then 0 else 1 end,
    i.recommended_date,i.sequence_index
  limit 1 for update;

  if p_focus_override in ('General Fitness','Fat Loss','Muscle Gain','Strength','Conditioning') then
    v_focus:=p_focus_override;v_reasons:=array_append(v_reasons,'focus:user_or_profile_override');
  else
    v_focus:=coalesce(v_item.planned_focus,v_goal,'General Fitness');v_reasons:=array_append(v_reasons,'focus:weekly_plan');
  end if;

  if p_target_region_override in ('Upper','Lower','Core','Full Body') then
    v_region:=p_target_region_override;v_reasons:=array_append(v_reasons,'region:user_day_preference');
  else
    v_region:=coalesce(v_item.planned_target_region,'Full Body');v_reasons:=array_append(v_reasons,'region:weekly_rotation');
  end if;

  if v_override_intent in ('PROGRESS','MAINTAIN','CONSOLIDATE','DELOAD','RECALIBRATE','EXPLORE') then
    v_intent:=v_override_intent;v_reasons:=array_append(v_reasons,'intent:explicit_override');
  elsif v_readiness in ('low','faible') then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:low_readiness');
  elsif v_last.id is not null and coalesce(v_last.global_rpe,0)>=9 and coalesce(v_last.post_workout_feeling,10)<=4 then
    v_intent:='DELOAD';v_reasons:=array_append(v_reasons,'intent:high_rpe_low_post_feeling');
  elsif v_exception_ratio>=0.50 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:previous_session_many_exceptions');
  elsif v_last.id is not null and (coalesce(v_last.global_rpe,0)>=9 or coalesce(v_last.post_workout_feeling,10)<=3) then
    v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:recovery_guard');
  elsif v_item.id is null or v_completed_count>=v_target then
    if v_readiness in ('high','olympique') and v_confident_rows>=5 then
      v_intent:='EXPLORE';v_reasons:=array_append(v_reasons,'intent:extra_session_high_readiness_explore');
    else
      v_intent:='CONSOLIDATE';v_reasons:=array_append(v_reasons,'intent:extra_session_after_week_target');
    end if;
  elsif v_capability_rows<5 and v_completed_count=0 then
    v_intent:='RECALIBRATE';v_reasons:=array_append(v_reasons,'intent:sparse_capability_evidence');
  else
    v_intent:=coalesce(v_item.planned_progression_intent,'MAINTAIN');v_reasons:=array_append(v_reasons,'intent:weekly_plan');
  end if;

  return jsonb_build_object(
    'status','READY','version','d1-session-context-v3-daily-freeze','week_start',v_week,'week_end',v_week+6,
    'plan_item_id',v_item.id,'sequence_index',v_item.sequence_index,'recommended_date',v_item.recommended_date,
    'weekly_session_target',v_target,'completed_before',v_completed_count,'remaining_before',greatest(0,v_target-v_completed_count),
    'extra_session',v_item.id is null,
    'focus',v_focus,'target_region',v_region,'progression_intent',v_intent,
    'daily_refresh',jsonb_build_object('new_checkin_rebuilds_unstarted_session',true,'started_session_frozen_for_local_day_only',true),
    'capability_evidence',jsonb_build_object('rows',v_capability_rows,'confident_rows',v_confident_rows),
    'previous_session',case when v_last.id is null then '{}'::jsonb else jsonb_build_object(
      'session_id',v_last.id,'global_rpe',v_last.global_rpe,'post_workout_feeling',v_last.post_workout_feeling,
      'target_region',v_last.target_region,'exception_ratio',round(v_exception_ratio,3)
    ) end,
    'reason_codes',to_jsonb(v_reasons),
    'weekly_stimulus_balance',coalesce((select jsonb_agg(jsonb_build_object(
      'stimulus_type',b.stimulus_type,'stimulus_key',b.stimulus_key,'unit',b.unit,'target_value',b.target_value,
      'planned_from_sessions',b.planned_from_sessions,'realized_value',b.realized_value,'remaining_to_target',b.remaining_to_target
    ) order by b.stimulus_type,b.stimulus_key) from public.weekly_stimulus_balance b where b.user_id=p_user_id and b.week_start=v_week),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.d_generate_adaptive_session(
  p_user_id uuid,
  p_focus_override text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region_override text default null::text,
  p_progression_intent_override text default null::text,
  p_zone_terms text[] default '{}'::text[],
  p_inventory jsonb default '[]'::jsonb,
  p_available_equipment text[] default '{}'::text[],
  p_max_complexity integer default 3,
  p_max_difficulty text default 'Intermédiaire'::text,
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'::text,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb;
  v_generated jsonb;
  v_session_id uuid;
  v_plan_item_id uuid;
  v_existing jsonb;
  v_anchor date:=coalesce(p_anchor_date,current_date);
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_context:=public.d_resolve_session_context(
    p_user_id,v_anchor,p_duration_minutes,p_readiness,p_focus_override,p_target_region_override,p_progression_intent_override
  );

  if v_context->>'status'='RESUME_EXISTING' then
    select generated_workout into v_existing from public.workout_sessions
    where id=(v_context->>'resume_session_id')::uuid and user_id=p_user_id;
    return jsonb_build_object(
      'status','resume_existing','version','d1-adaptive-generation-v2-daily-freeze','session_id',(v_context->>'resume_session_id')::uuid,
      'weekly_loop',v_context,'generated_workout',coalesce(v_existing,'{}'::jsonb)
    );
  end if;

  v_generated:=public.c4_generate_full_session(
    p_user_id,
    coalesce(v_context->>'focus',p_focus_override,'General Fitness'),
    p_duration_minutes,
    p_readiness,
    nullif(v_context->>'target_region',''),
    nullif(v_context->>'progression_intent',''),
    p_zone_terms,p_inventory,p_available_equipment,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_generated->>'status','')<>'generated' or nullif(v_generated->>'session_id','') is null then
    return v_generated||jsonb_build_object('weekly_loop',v_context,'version','d1-adaptive-generation-v2-daily-freeze');
  end if;

  v_session_id:=(v_generated->>'session_id')::uuid;
  v_plan_item_id:=nullif(v_context->>'plan_item_id','')::uuid;

  update public.workout_sessions set
    generation_local_date=v_anchor,
    planning_context_json=coalesce(planning_context_json,'{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,
      'weekly_loop_version','d1-weekly-loop-v1',
      'daily_refresh',jsonb_build_object('generation_local_date',v_anchor,'started_session_frozen_for_local_day_only',true)
    ),updated_at=now()
  where id=v_session_id and user_id=p_user_id;

  if v_plan_item_id is not null then
    update public.user_training_plan_items set
      status='claimed',session_id=v_session_id,claimed_at=now(),updated_at=now(),
      planning_context_json=planning_context_json||jsonb_build_object(
        'claimed_session_id',v_session_id,'claimed_at',now(),'resolved_context',v_context
      )
    where id=v_plan_item_id and user_id=p_user_id and status='available';
    if not found then raise exception 'Weekly plan item could not be claimed'; end if;
  end if;

  perform public.d_sync_session_stimulus_ledger(v_session_id);

  return v_generated||jsonb_build_object(
    'version','d1-adaptive-generation-v2-daily-freeze','weekly_loop',v_context,
    'meta',coalesce(v_generated->'meta','{}'::jsonb)||jsonb_build_object(
      'weekly_loop',v_context,'weekly_loop_version','d1-weekly-loop-v1','generation_local_date',v_anchor
    )
  );
end;
$function$;

create or replace function public.e_dashboard_snapshot(
  p_user_id uuid,
  p_anchor_date date default current_date,
  p_month_start date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_month date:=date_trunc('month',coalesce(p_month_start,p_anchor_date,current_date)::timestamp)::date;
  v_snapshot jsonb;
  v_note jsonb;
  v_total int:=0;
  v_form_samples int:=0;
  v_learning_stage text;
  v_learning_visible boolean;
  v_learning_text text;
  v_active jsonb:='{}'::jsonb;
  v_months jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_snapshot:=public.d_dashboard_snapshot(p_user_id,v_anchor,v_month);
  v_note:=public.e_coach_note_preview(p_user_id,v_anchor);
  v_total:=coalesce((v_snapshot->>'total_completed_sessions')::int,0);

  select count(*) into v_form_samples
  from public.workout_sessions ws
  where ws.user_id=p_user_id and ws.status='completed'
    and ws.post_workout_feeling is not null
    and coalesce(ws.completed_at,ws.created_at)::date between v_anchor-6 and v_anchor;

  select jsonb_build_object(
    'session_id',ws.id,
    'status',ws.status,
    'started_local_date',ws.started_local_date,
    'started_at',ws.started_at,
    'frozen_for_local_day',true
  )
  into v_active
  from public.workout_sessions ws
  where ws.user_id=p_user_id
    and ws.status='in_progress'
    and ws.started_local_date=v_anchor
  order by ws.started_at desc
  limit 1;

  v_active:=coalesce(v_active,'{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
    'month_start',m.month_start,
    'completed_sessions',(
      select count(*) from public.workout_sessions ws
      where ws.user_id=p_user_id and ws.status='completed'
        and coalesce(ws.completed_at,ws.created_at)::date>=m.month_start
        and coalesce(ws.completed_at,ws.created_at)::date<(m.month_start+interval '1 month')::date
    )
  ) order by m.month_start desc),'[]'::jsonb)
  into v_months
  from (
    select (date_trunc('month',v_anchor::timestamp)-(g||' months')::interval)::date as month_start
    from generate_series(0,5) g
  ) m;

  if v_total=0 then
    v_learning_stage:='NEW';
    v_learning_visible:=true;
    v_learning_text:='Tes premières séances vont me permettre de mieux calibrer ton entraînement.';
  elsif coalesce(v_note->>'data_confidence','LOW')='LOW' then
    v_learning_stage:='LEARNING';
    v_learning_visible:=true;
    v_learning_text:='Chaque séance me donne de nouveaux repères pour mieux adapter les suivantes.';
  elsif coalesce(v_note->>'data_confidence','LOW')='MEDIUM' then
    v_learning_stage:='CALIBRATING';
    v_learning_visible:=true;
    v_learning_text:='Ton profil se précise. Je commence à avoir assez de recul pour affiner mes décisions.';
  else
    v_learning_stage:='KNOWN';
    v_learning_visible:=false;
    v_learning_text:=null;
  end if;

  return v_snapshot||jsonb_build_object(
    'version','e2-dashboard-snapshot-v1',
    'coach_note',v_note,
    'active_session_today',v_active,
    'monthly_activity',v_months,
    'form_samples_7d',v_form_samples,
    'profile_learning',jsonb_build_object(
      'stage',v_learning_stage,
      'visible',v_learning_visible,
      'title','UGEROD APPREND À TE CONNAÎTRE',
      'text',v_learning_text
    ),
    'weekly_schedule_explanation_enabled',false,
    'recommended_dates_are_soft',true,
    'session_debt_enabled',false,
    'daily_session_refresh',jsonb_build_object(
      'checkin_always_re_evaluates_context',true,
      'started_session_frozen_for_local_day_only',true,
      'next_local_day_unfreezes',true
    )
  );
end;
$function$;

revoke all on function public.e_dashboard_snapshot(uuid,date,date) from public, anon;
grant execute on function public.e_dashboard_snapshot(uuid,date,date) to authenticated;
;



-- SOURCE MIGRATION: 20260812001332_phase_pi1_progression_intelligence_snapshot.sql
create or replace function public.pi_progression_snapshot(
  p_user_id uuid,
  p_period_days integer default 90,
  p_anchor_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_anchor date:=coalesce(p_anchor_date,current_date);
  v_days int:=least(1825,greatest(28,coalesce(p_period_days,90)));
  v_since date;
  v_total_sessions int:=0;
  v_period_sessions int:=0;
  v_period_minutes numeric:=0;
  v_avg_rpe numeric;
  v_avg_feeling numeric;
  v_cap_rows int:=0;
  v_confident_cap_rows int:=0;
  v_protocol_rows int:=0;
  v_cap_events int:=0;
  v_positive_events int:=0;
  v_recalibration_events int:=0;
  v_protocol_positive_events int:=0;
  v_protocol_recalibration_events int:=0;
  v_stage text;
  v_overall_state text;
  v_overall_text text;
  v_consistency jsonb;
  v_movements jsonb;
  v_protocols jsonb;
  v_legacy jsonb;
  v_signals jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;

  v_since:=v_anchor-(v_days-1);

  select count(*) into v_total_sessions
  from public.workout_sessions
  where user_id=p_user_id and status='completed';

  select count(*),coalesce(sum(duration_minutes),0),round(avg(global_rpe)::numeric,1),round(avg(post_workout_feeling)::numeric,1)
  into v_period_sessions,v_period_minutes,v_avg_rpe,v_avg_feeling
  from public.workout_sessions
  where user_id=p_user_id and status='completed'
    and coalesce(completed_at,created_at)::date between v_since and v_anchor;

  select count(*),count(*) filter(where confidence>=0.60)
  into v_cap_rows,v_confident_cap_rows
  from public.user_exercise_capabilities
  where user_id=p_user_id;

  select count(*) into v_protocol_rows
  from public.user_protocol_capabilities
  where user_id=p_user_id;

  select
    count(*),
    count(*) filter(where decision ilike 'EXPAND%' or decision ilike '%PROGRESS%'),
    count(*) filter(where decision ilike '%RECALIBRAT%')
  into v_cap_events,v_positive_events,v_recalibration_events
  from public.capability_update_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;

  select
    count(*) filter(where decision ilike 'EXPAND%' or decision ilike '%PROGRESS%'),
    count(*) filter(where decision ilike '%RECALIBRAT%')
  into v_protocol_positive_events,v_protocol_recalibration_events
  from public.protocol_capability_events
  where user_id=p_user_id and applied
    and created_at::date between v_since and v_anchor;

  if v_total_sessions=0 then
    v_stage:='EMPTY';
  elsif v_total_sessions<4 or v_cap_rows<3 then
    v_stage:='LEARNING';
  elsif v_total_sessions<10 or v_confident_cap_rows<5 then
    v_stage:='CALIBRATING';
  else
    v_stage:='ESTABLISHED';
  end if;

  if v_stage in ('EMPTY','LEARNING') then
    v_overall_state:='LEARNING';
    v_overall_text:='UGEROD accumule encore des références avant de tirer des conclusions sur ta progression.';
  elsif (v_recalibration_events+v_protocol_recalibration_events)>=2
        and (v_recalibration_events+v_protocol_recalibration_events)>(v_positive_events+v_protocol_positive_events) then
    v_overall_state:='RECALIBRATING';
    v_overall_text='Certaines références récentes demandent à être recalibrées avant de pousser plus loin.';
  elsif (v_positive_events+v_protocol_positive_events)>=2 then
    v_overall_state:='PROGRESSING';
    v_overall_text:='Plusieurs signaux récents indiquent une progression suffisamment nette pour influencer les prochaines séances.';
  else
    v_overall_state:='STABLE';
    v_overall_text:='Les références récentes sont globalement stables. UGEROD continue de consolider et d’observer.';
  end if;

  v_consistency:=public.e_training_consistency_history(
    p_user_id,
    v_anchor,
    least(120,greatest(2,ceil(v_days/30.0)::int+1))
  );

  select coalesce(jsonb_agg(x.obj order by x.priority asc,x.confidence desc,x.last_observed_at desc),'[]'::jsonb)
  into v_movements
  from (
    select
      case signal
        when 'PROGRESSING' then 1
        when 'RECALIBRATING' then 2
        when 'STABLE' then 3
        else 4
      end as priority,
      c.confidence,
      c.last_observed_at,
      jsonb_build_object(
        'source','b2.7-live-capability',
        'exercise_id',c.exercise_id,
        'name',e.name,
        'movement_pattern',e.movement_pattern,
        'exercise_family',e.exercise_family,
        'body_region',e.body_region,
        'training_focus',e.training_focus,
        'tracking_modes',e.tracking_modes,
        'signal',signal,
        'latest_decision',latest_decision,
        'positive_events_period',positive_events,
        'recalibration_events_period',recalibration_events,
        'hold_events_period',hold_events,
        'confidence',round(coalesce(c.confidence,0),3),
        'freshness',round(coalesce(f.dynamic_freshness,c.freshness,0),3),
        'evidence_count',c.evidence_count,
        'valid_evidence_count',c.valid_evidence_count,
        'last_observed_at',c.last_observed_at,
        'last_valid_observed_at',c.last_valid_observed_at,
        'reps_envelope',c.reps_envelope,
        'load_envelope',c.load_envelope,
        'time_envelope',c.time_envelope,
        'distance_envelope',c.distance_envelope,
        'pace_envelope',c.pace_envelope,
        'confidence_json',c.confidence_json,
        'evidence_json',c.evidence_json
      ) as obj
    from public.user_exercise_capabilities c
    join public.exercises e on e.id=c.exercise_id
    left join lateral (
      select round(avg(public.capability_freshness_from_age(
        extract(epoch from (v_anchor::timestamptz-(j.value->>'last_valid_observed_at')::timestamptz))/86400.0,
        coalesce(public.jsonb_num(j.value,'half_life_days'),45)
      ))::numeric,3) as dynamic_freshness
      from jsonb_each(coalesce(c.freshness_json,'{}'::jsonb)) j
      where j.value ? 'last_valid_observed_at'
    ) f on true
    left join lateral (
      select cue.decision as latest_decision
      from public.capability_update_events cue
      where cue.user_id=c.user_id and cue.exercise_id=c.exercise_id and cue.applied
        and cue.created_at::date between v_since and v_anchor
      order by cue.created_at desc,cue.id desc
      limit 1
    ) ld on true
    left join lateral (
      select
        count(*) filter(where cue.decision ilike 'EXPAND%' or cue.decision ilike '%PROGRESS%')::int as positive_events,
        count(*) filter(where cue.decision ilike '%RECALIBRAT%')::int as recalibration_events,
        count(*) filter(where cue.decision='HOLD')::int as hold_events
      from public.capability_update_events cue
      where cue.user_id=c.user_id and cue.exercise_id=c.exercise_id and cue.applied
        and cue.created_at::date between v_since and v_anchor
    ) ev on true
    cross join lateral (
      select case
        when coalesce(c.confidence,0)<0.45 or coalesce(c.valid_evidence_count,0)<2 then 'LEARNING'
        when coalesce(ld.latest_decision,'') ilike '%RECALIBRAT%' or coalesce(ev.recalibration_events,0)>coalesce(ev.positive_events,0) then 'RECALIBRATING'
        when coalesce(ld.latest_decision,'') ilike 'EXPAND%' or coalesce(ld.latest_decision,'') ilike '%PROGRESS%' or coalesce(ev.positive_events,0)>0 then 'PROGRESSING'
        else 'STABLE'
      end as signal
    ) s
    order by priority,c.confidence desc,c.last_observed_at desc
    limit 12
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.priority,x.confidence desc,x.last_observed_at desc),'[]'::jsonb)
  into v_protocols
  from (
    select
      case signal when 'PROGRESSING' then 1 when 'RECALIBRATING' then 2 when 'STABLE' then 3 else 4 end as priority,
      p.confidence,p.last_observed_at,
      jsonb_build_object(
        'source','b2.7-protocol-capability',
        'protocol_signature',p.protocol_signature,
        'mechanic_key',p.mechanic_key,
        'variant_key',p.variant_key,
        'signal',signal,
        'latest_decision',latest_decision,
        'boundary_type',boundary_type,
        'positive_events_period',positive_events,
        'recalibration_events_period',recalibration_events,
        'confidence',round(coalesce(p.confidence,0),3),
        'freshness',round(coalesce(p.freshness,0),3),
        'evidence_count',p.evidence_count,
        'valid_evidence_count',p.valid_evidence_count,
        'best_outcome',p.best_outcome_json,
        'latest_outcome',p.latest_outcome_json,
        'last_observed_at',p.last_observed_at
      ) as obj
    from public.user_protocol_capabilities p
    left join lateral (
      select pe.decision as latest_decision,pe.boundary_type
      from public.protocol_capability_events pe
      where pe.user_id=p.user_id and pe.protocol_signature=p.protocol_signature and pe.applied
        and pe.created_at::date between v_since and v_anchor
      order by pe.created_at desc,pe.id desc
      limit 1
    ) ld on true
    left join lateral (
      select
        count(*) filter(where pe.decision ilike 'EXPAND%' or pe.decision ilike '%PROGRESS%')::int as positive_events,
        count(*) filter(where pe.decision ilike '%RECALIBRAT%')::int as recalibration_events
      from public.protocol_capability_events pe
      where pe.user_id=p.user_id and pe.protocol_signature=p.protocol_signature and pe.applied
        and pe.created_at::date between v_since and v_anchor
    ) ev on true
    cross join lateral (
      select case
        when coalesce(p.confidence,0)<0.45 or coalesce(p.valid_evidence_count,0)<2 then 'LEARNING'
        when coalesce(ld.latest_decision,'') ilike '%RECALIBRAT%' or coalesce(ev.recalibration_events,0)>coalesce(ev.positive_events,0) then 'RECALIBRATING'
        when coalesce(ld.latest_decision,'') ilike 'EXPAND%' or coalesce(ld.latest_decision,'') ilike '%PROGRESS%' or coalesce(ev.positive_events,0)>0 then 'PROGRESSING'
        else 'STABLE'
      end as signal
    ) s
    where p.user_id=p_user_id
    order by priority,p.confidence desc,p.last_observed_at desc
    limit 8
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source','legacy-progress-fallback',
    'exercise_id',up.exercise_id,
    'name',e.name,
    'movement_pattern',e.movement_pattern,
    'training_focus',e.training_focus,
    'state',up.state,
    'recommendation',up.recommendation,
    'performance_delta',up.performance_delta,
    'overall_confidence',up.overall_confidence,
    'exposure_count',up.exposure_count,
    'current_performance',up.current_performance_json,
    'best_performance',up.best_performance_json,
    'last_observed_at',up.last_observed_at
  ) order by up.overall_confidence desc nulls last),'[]'::jsonb)
  into v_legacy
  from (
    select * from public.user_exercise_progress
    where user_id=p_user_id
    order by overall_confidence desc nulls last,last_observed_at desc nulls last
    limit 12
  ) up
  join public.exercises e on e.id=up.exercise_id;

  if v_stage='EMPTY' then
    v_signals:=jsonb_build_array(jsonb_build_object(
      'type','LEARNING','priority',1,
      'title','TON ÉVOLUTION COMMENCE ICI',
      'text','Termine tes premières séances pour donner à UGEROD des références fiables.'
    ));
  elsif v_stage in ('LEARNING','CALIBRATING') then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','LEARNING','priority',1,
      'title','UGEROD AFFINE TON PROFIL',
      'text','Les données s’accumulent. Les tendances deviendront plus affirmées à mesure que les références se confirment.'
    ));
  end if;

  if (v_positive_events+v_protocol_positive_events)>0 then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','PROGRESSION_SIGNAL','priority',2,
      'title','DES SIGNAUX DE PROGRESSION APPARAISSENT',
      'text','UGEROD a détecté des références récentes en hausse. Elles pourront influencer les prochaines séances si elles se confirment.'
    ));
  end if;

  if (v_recalibration_events+v_protocol_recalibration_events)>0 then
    v_signals:=v_signals||jsonb_build_array(jsonb_build_object(
      'type','RECALIBRATION_SIGNAL','priority',3,
      'title','CERTAINES RÉFÉRENCES SONT À RECALIBRER',
      'text','Une performance plus basse ne supprime pas ton niveau acquis : UGEROD cherche d’abord à confirmer la nouvelle référence.'
    ));
  end if;

  return jsonb_build_object(
    'version','pi1-progression-intelligence-v1',
    'anchor_date',v_anchor,
    'period_days',v_days,
    'period_start',v_since,
    'data_maturity',jsonb_build_object(
      'stage',v_stage,
      'total_completed_sessions',v_total_sessions,
      'period_completed_sessions',v_period_sessions,
      'live_capability_exercises',v_cap_rows,
      'confident_capability_exercises',v_confident_cap_rows,
      'protocol_capabilities',v_protocol_rows,
      'capability_events_period',v_cap_events
    ),
    'overall',jsonb_build_object(
      'state',v_overall_state,
      'text',v_overall_text,
      'positive_events',v_positive_events+v_protocol_positive_events,
      'recalibration_events',v_recalibration_events+v_protocol_recalibration_events
    ),
    'training_summary',jsonb_build_object(
      'completed_sessions',v_period_sessions,
      'total_minutes',v_period_minutes,
      'avg_rpe',v_avg_rpe,
      'avg_post_workout_feeling',v_avg_feeling
    ),
    'consistency',v_consistency,
    'movement_capabilities',v_movements,
    'protocol_capabilities',v_protocols,
    'legacy_progress_fallback',case when v_cap_rows=0 then v_legacy else '[]'::jsonb end,
    'coach_signals',v_signals,
    'decision_feed',jsonb_build_object(
      'progression_candidate_exercise_ids',coalesce((
        select jsonb_agg((m->>'exercise_id')) from jsonb_array_elements(v_movements) m where m->>'signal'='PROGRESSING'
      ),'[]'::jsonb),
      'recalibration_candidate_exercise_ids',coalesce((
        select jsonb_agg((m->>'exercise_id')) from jsonb_array_elements(v_movements) m where m->>'signal'='RECALIBRATING'
      ),'[]'::jsonb),
      'progression_candidate_protocols',coalesce((
        select jsonb_agg((p->>'protocol_signature')) from jsonb_array_elements(v_protocols) p where p->>'signal'='PROGRESSING'
      ),'[]'::jsonb),
      'recalibration_candidate_protocols',coalesce((
        select jsonb_agg((p->>'protocol_signature')) from jsonb_array_elements(v_protocols) p where p->>'signal'='RECALIBRATING'
      ),'[]'::jsonb),
      'integration_status','READY_FOR_WEEKLY_AND_SESSION_ENGINE_CONSUMPTION'
    )
  );
end;
$function$;

revoke all on function public.pi_progression_snapshot(uuid,integer,date) from public, anon;
grant execute on function public.pi_progression_snapshot(uuid,integer,date) to authenticated;
;



-- SOURCE MIGRATION: 20260812010459_pi2_coaching_directives_runtime.sql
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

