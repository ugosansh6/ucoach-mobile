-- V1 guardrail: mechanic-specific WOD caps. No change to sport hierarchy or candidate ranking.
update public.session_engine_policy
set config = jsonb_set(
  coalesce(config,'{}'::jsonb),
  '{wod_duration_caps_minutes}',
  jsonb_build_object(
    'HIIT',25,
    'AMRAP',35,
    'EMOM',40,
    'FOR_TIME',40,
    'PROGRESSIVE_INTERVAL',40,
    'LADDER',40,
    'PYRAMID',40,
    'REP_TARGET',40,
    'ODD_EVEN',40,
    'COUPLET',40,
    'DECK',40,
    'CIRCUIT',50,
    'CHIPPER',50,
    'STRENGTH',50,
    'EVERY_X_MINUTES',50,
    'DEFAULT',50
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.c4_mechanic_wod_cap_minutes(
  p_mechanic text,
  p_policy_key text default 'c4-final-default'
) returns integer
language plpgsql stable
set search_path='public'
as $$
declare
  v_cfg jsonb;
  v_mech text:=upper(coalesce(p_mechanic,''));
  v_cap int;
begin
  select config into v_cfg from public.session_engine_policy where policy_key=p_policy_key;
  if v_cfg is null then raise exception 'Unknown C4 policy %',p_policy_key; end if;
  v_cap:=coalesce(
    nullif(v_cfg#>>array['wod_duration_caps_minutes',v_mech],'')::int,
    nullif(v_cfg#>>'{wod_duration_caps_minutes,DEFAULT}','')::int,
    50
  );
  return greatest(10,least(50,v_cap));
end;
$$;

alter function public.c4_finalize_candidate(jsonb,jsonb,integer,integer,text,text)
  rename to c4_finalize_candidate_pre_wod_caps;

create function public.c4_finalize_candidate(
  p_candidate jsonb,
  p_stimulus jsonb,
  p_total_duration_minutes integer,
  p_exact_wod_minutes integer default null,
  p_c4_policy_key text default 'c4-final-default',
  p_c3_policy_key text default 'c3-sim-default'
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_mechanic text:=upper(coalesce(p_candidate->>'mechanic',''));
  v_cap int;
  v_effective_exact int;
  v_result jsonb;
begin
  v_cap:=public.c4_mechanic_wod_cap_minutes(v_mechanic,p_c4_policy_key);
  v_effective_exact:=case
    when p_exact_wod_minutes is null then null
    else least(p_exact_wod_minutes,v_cap)
  end;

  v_result:=public.c4_finalize_candidate_pre_wod_caps(
    p_candidate,p_stimulus,p_total_duration_minutes,v_effective_exact,p_c4_policy_key,p_c3_policy_key
  );

  return jsonb_set(
    v_result,
    '{c4_final,wod_duration_guardrail}',
    jsonb_build_object(
      'mechanic',v_mechanic,
      'cap_minutes',v_cap,
      'requested_wod_minutes',p_exact_wod_minutes,
      'effective_wod_minutes',coalesce(v_effective_exact,nullif(v_result#>>'{c4_final,mechanic_json,wod_budget_minutes}','')::int),
      'cap_applied',p_exact_wod_minutes is not null and p_exact_wod_minutes>v_cap,
      'version','v1-mechanic-wod-cap-1'
    ),
    true
  );
end;
$$;

alter function public.c4_plan_full_session(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,text)
  rename to c4_plan_full_session_pre_wod_caps;

create function public.c4_plan_full_session(
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
  p_candidate_count integer default 12,
  p_policy_key text default 'c4-final-default'
) returns jsonb
language plpgsql stable
set search_path='public'
as $$
declare
  v_plan jsonb;
  v_actual_wod int;
  v_original_wod int;
  v_warmup int;
  v_tabata int;
  v_skill int;
  v_planned int;
  v_blocks jsonb;
  v_mechanic text;
begin
  v_plan:=public.c4_plan_full_session_pre_wod_caps(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,
    p_zone_terms,p_inventory,p_max_complexity,p_max_difficulty,p_candidate_count,p_policy_key
  );

  if coalesce(v_plan->>'status','')<>'READY' then return v_plan; end if;

  v_mechanic:=upper(coalesce(v_plan#>>'{selected_candidate,mechanic}',''));
  v_actual_wod:=coalesce(
    nullif(v_plan#>>'{selected_candidate,c4_final,mechanic_json,wod_budget_minutes}','')::int,
    nullif(v_plan#>>'{architecture,wod_minutes}','')::int,
    0
  );
  v_original_wod:=coalesce(nullif(v_plan#>>'{architecture,wod_minutes}','')::int,v_actual_wod);
  v_warmup:=coalesce(nullif(v_plan#>>'{architecture,warmup_minutes}','')::int,0);
  v_tabata:=coalesce(nullif(v_plan#>>'{architecture,tabata_minutes}','')::int,0);
  v_skill:=coalesce(nullif(v_plan#>>'{architecture,skill_minutes}','')::int,0);
  v_planned:=v_warmup+v_tabata+v_skill+v_actual_wod;

  select coalesce(jsonb_agg(
    case when b->>'block_key'='wod'
      then b||jsonb_build_object('duration_minutes',v_actual_wod)
      else b end
    order by ord
  ),'[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(coalesce(v_plan->'blocks','[]'::jsonb)) with ordinality x(b,ord);

  v_plan:=jsonb_set(v_plan,'{blocks}',v_blocks,true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_minutes}',to_jsonb(v_actual_wod),true);
  v_plan:=jsonb_set(v_plan,'{architecture,planned_minutes}',to_jsonb(v_planned),true);
  v_plan:=jsonb_set(v_plan,'{architecture,unallocated_available_minutes}',to_jsonb(greatest(0,p_duration_minutes-v_planned)),true);
  v_plan:=jsonb_set(v_plan,'{architecture,wod_duration_guardrail}',jsonb_build_object(
    'mechanic',v_mechanic,
    'cap_minutes',public.c4_mechanic_wod_cap_minutes(v_mechanic,p_policy_key),
    'pre_guardrail_wod_minutes',v_original_wod,
    'final_wod_minutes',v_actual_wod,
    'available_time_is_maximum_not_fill_target',true,
    'version','v1-mechanic-wod-cap-1'
  ),true);

  return v_plan;
end;
$$;

revoke all on function public.c4_mechanic_wod_cap_minutes(text,text) from public, anon;
grant execute on function public.c4_mechanic_wod_cap_minutes(text,text) to authenticated;
;
