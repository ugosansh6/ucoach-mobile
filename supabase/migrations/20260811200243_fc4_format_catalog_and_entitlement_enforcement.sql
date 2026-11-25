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
