-- UGEROD V2: equipment as weak contextual utility; CONSOLIDATE may reinvest spare time.

create or replace function public.program_coach_equipment_opportunity_shadow_v1(
  p_user_id uuid,
  p_anchor_date date,
  p_session_context jsonb,
  p_inventory jsonb
)
returns jsonb
language plpgsql
stable
set search_path='public'
as $function$
declare
  v jsonb;
  v_items jsonb:='[]'::jsonb;
  v_high_count int:=0;
begin
  v:=public.program_coach_equipment_opportunity_shadow_v1_base(
    p_user_id,p_anchor_date,p_session_context,p_inventory
  );

  if coalesce(v->>'status','')='NOT_ELIGIBLE' then
    return jsonb_set(v,'{version}',to_jsonb('equipment-opportunity-shadow-v3-utility'::text),true);
  end if;

  with scored as (
    select
      ord,
      x,
      case
        when coalesce(x->>'level','')<>'OPTIONAL' then coalesce(x->>'level','OPTIONAL')
        when coalesce(nullif(x->>'relevant_exercise_count','')::int,0)=0 then 'OPTIONAL'
        when coalesce(x->>'category','') in ('Bodyweight','Accessoire','Récupération') then 'OPTIONAL'
        when coalesce(nullif(x->>'historical_observation_days','')::int,0)>=2
             and coalesce(nullif(x->>'availability_days','')::int,0)=0
          then 'HIGH_VALUE_NEW'
        when coalesce(nullif(x->>'historical_observation_days','')::int,0)>=4
             and coalesce(nullif(x->>'availability_share','')::numeric,1)<=0.35
          then 'HIGH_VALUE_RARE'
        when coalesce(nullif(x->>'availability_days','')::int,0)>=3
             and coalesce(nullif(x->>'utilization_when_available','')::numeric,1)<=0.34
          then 'MEDIUM_UNDERUSED'
        when coalesce(nullif(x->>'focus_relevant_exercise_count','')::int,0)>=1
          then 'OPTIONAL_USEFUL_TODAY'
        else 'OPTIONAL'
      end new_level
    from jsonb_array_elements(coalesce(v->'opportunities','[]'::jsonb)) with ordinality q(x,ord)
  ), rebuilt as (
    select
      ord,
      x||jsonb_build_object(
        'level',new_level,
        'recommended_soft_bias',case new_level
          when 'HIGH_VALUE_NEW' then 0.18
          when 'HIGH_VALUE_RARE' then 0.16
          when 'MEDIUM_UNDERUSED' then 0.08
          when 'OPTIONAL_USEFUL_TODAY' then 0.04
          else 0.00 end,
        'reason',case new_level
          when 'HIGH_VALUE_NEW' then 'EQUIPMENT_AVAILABLE_TODAY_NOT_SEEN_IN_RECENT_SESSION_DAYS'
          when 'HIGH_VALUE_RARE' then 'EQUIPMENT_RARELY_AVAILABLE_AND_RELEVANT_TODAY'
          when 'MEDIUM_UNDERUSED' then 'EQUIPMENT_OFTEN_AVAILABLE_BUT_RARELY_USED_IN_TRAINING_BLOCKS'
          when 'OPTIONAL_USEFUL_TODAY' then 'EQUIPMENT_HAS_FOCUS_RELEVANT_USE_TODAY'
          else 'NO_STRONG_EQUIPMENT_OPPORTUNITY' end,
        'single_relevant_exercise_qualified',new_level in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE','MEDIUM_UNDERUSED'),
        'utility_only',new_level='OPTIONAL_USEFUL_TODAY'
      ) item,
      new_level
    from scored
  )
  select
    coalesce(jsonb_agg(item order by ord),'[]'::jsonb),
    count(*) filter(where new_level in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE'))::int
  into v_items,v_high_count
  from rebuilt;

  v:=jsonb_set(v,'{version}',to_jsonb('equipment-opportunity-shadow-v3-utility'::text),true);
  v:=jsonb_set(v,'{opportunities}',v_items,true);
  v:=jsonb_set(v,'{status}',to_jsonb(case when v_high_count>0 then 'HIGH_VALUE_EQUIPMENT_OPPORTUNITY' else 'NO_HIGH_VALUE_EQUIPMENT_OPPORTUNITY' end::text),true);
  v:=jsonb_set(v,'{selection_contract,single_relevant_exercise_can_qualify}','true'::jsonb,true);
  v:=jsonb_set(v,'{selection_contract,single_relevant_exercise_still_requires_active_quality_gate}','true'::jsonb,true);
  v:=jsonb_set(v,'{selection_contract,optional_focus_relevant_equipment_is_weak_utility_signal}','true'::jsonb,true);
  v:=jsonb_set(v,'{selection_contract,optional_utility_never_forces_use}','true'::jsonb,true);

  return v;
end;
$function$;

-- Active adapter: inspect weak utility opportunities with a stricter quality floor.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_apply_equipment_opportunity_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_session_context jsonb, p_anchor_date date, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_apply_equipment_opportunity_v1 exact signature not found'; end if;

  v_old:=$txt$where x->>'level' in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE','MEDIUM_UNDERUSED')$txt$;
  v_new:=$txt$where x->>'level' in ('HIGH_VALUE_NEW','HIGH_VALUE_RARE','MEDIUM_UNDERUSED','OPTIONAL_USEFUL_TODAY')$txt$;
  if position(v_old in v_def)=0 then raise exception 'equipment level filter marker not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=$txt$order by case x->>'level' when 'HIGH_VALUE_NEW' then 0 when 'HIGH_VALUE_RARE' then 1 when 'MEDIUM_UNDERUSED' then 2 else 3 end,$txt$;
  v_new:=$txt$order by case x->>'level' when 'HIGH_VALUE_NEW' then 0 when 'HIGH_VALUE_RARE' then 1 when 'MEDIUM_UNDERUSED' then 2 when 'OPTIONAL_USEFUL_TODAY' then 3 else 4 end,$txt$;
  if position(v_old in v_def)=0 then raise exception 'equipment ordering marker not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=$txt$  v_budget_before:=public.c4_session_pattern_budget_v1(v_intent,coalesce(r->'blocks','[]'::jsonb),'{}'::jsonb);$txt$;
  v_new:=$txt$  if v_level='OPTIONAL_USEFUL_TODAY' then
    v_quality_delta_floor:=-0.5;
  end if;

  v_budget_before:=public.c4_session_pattern_budget_v1(v_intent,coalesce(r->'blocks','[]'::jsonb),'{}'::jsonb);$txt$;
  if position(v_old in v_def)=0 then raise exception 'pattern budget marker not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end $do$;

-- CONSOLIDATE no longer blocks quality-preserving reinvestment.
do $do$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.proname='c4_reinvest_available_time_v1'
    and pg_get_function_identity_arguments(p.oid)='p_user_id uuid, p_plan jsonb, p_session_intent text, p_focus text, p_duration_minutes integer, p_readiness text, p_target_region text, p_progression_intent text, p_zone_terms text[], p_inventory jsonb, p_max_complexity integer, p_max_difficulty text, p_candidate_count integer, p_policy_key text';
  if v_def is null then raise exception 'c4_reinvest_available_time_v1 exact signature not found'; end if;

  v_old:=$txt$  if not v_enabled or v_unallocated<4 or v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' or v_intent='CONSOLIDATE' then$txt$;
  v_new:=$txt$  if not v_enabled or v_unallocated<4 or v_readiness='low' or upper(coalesce(p_progression_intent,''))='DELOAD' then$txt$;
  if position(v_old in v_def)=0 then raise exception 'time reinvestment consolidate gate marker not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  v_old:=$txt$      'reason',case when not v_enabled then 'DISABLED' when v_unallocated<4 then 'TOO_LITTLE_USEFUL_TIME' else 'RECOVERY_OR_DELOAD_PRESERVES_SHORTER_SESSION' end,$txt$;
  v_new:=$txt$      'reason',case when not v_enabled then 'DISABLED' when v_unallocated<4 then 'TOO_LITTLE_USEFUL_TIME' when v_readiness='low' then 'LOW_READINESS_PRESERVES_SHORTER_SESSION' else 'DELOAD_PRESERVES_SHORTER_SESSION' end,$txt$;
  if position(v_old in v_def)=0 then raise exception 'time reinvestment reason marker not found'; end if;
  v_def:=replace(v_def,v_old,v_new);

  execute v_def;
end $do$;

update public.session_engine_policy
set config=jsonb_set(
  jsonb_set(
    coalesce(config,'{}'::jsonb),
    '{time_reinvestment,consolidate_preserves_shorter_session}',
    'false'::jsonb,
    true
  ),
  '{context_opportunity,optional_focus_relevant_equipment_utility}',
  'true'::jsonb,
  true
), updated_at=now()
where policy_key='c4-final-default';
