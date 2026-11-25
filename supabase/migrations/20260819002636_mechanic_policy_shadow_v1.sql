update public.session_engine_policy
set config=jsonb_set(
  config,
  '{mechanic_policy}',
  jsonb_build_object(
    'enabled',true,
    'shadow_mode',true,
    'apply_enabled',false,
    'version','mechanic-policy-shadow-v1',
    'candidate_pool','auto_free_core',
    'base_fit_weight',0.65,
    'session_intent_weight',0.35,
    'feature_flag_note','shadow_evaluates_but_never_changes_authoritative_session'
  ),
  true
)
where policy_key='c4-final-default';

create or replace function public.program_coach_solver_session_intent_v1(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_progression_intent text
) returns jsonb
language plpgsql
stable
set search_path='public'
as $function$
declare
  v_strategy jsonb:='{}'::jsonb;
  v_start jsonb:='{}'::jsonb;
  v_class jsonb:='{}'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  v_strategy:=public.program_coach_week_strategy_v1(p_user_id,public.d_week_start(current_date));
  v_start:=public.program_coach_start_state_v1(p_user_id,current_date);
  v_class:=public.program_coach_session_intent_classify_v1(
    p_focus,p_progression_intent,p_readiness,p_duration_minutes,
    v_strategy#>>'{block_phase,phase}',
    v_strategy#>>'{recent_load,load_pressure}',
    v_start->>'maturity_stage',
    coalesce(v_strategy->'quality_priorities','[]'::jsonb),
    coalesce(v_strategy->'movement_pattern_priorities','[]'::jsonb)
  );
  return v_class||jsonb_build_object(
    'version','mechanic-policy-session-intent-bridge-v1',
    'program_phase',v_strategy#>>'{block_phase,phase}',
    'recent_load_pressure',v_strategy#>>'{recent_load,load_pressure}',
    'athlete_maturity',v_start->>'maturity_stage'
  );
end;
$function$;

create or replace function public.build_session_stimulus_target_mechanic_policy_shadow_v1(
  p_user_id uuid,
  p_focus text,
  p_duration_minutes integer,
  p_readiness text,
  p_target_region text,
  p_progression_intent text,
  p_policy_key text default 'c1-default'
) returns jsonb
language plpgsql
stable
set search_path='public'
as $function$
declare
  v_base jsonb;
  v_intent jsonb;
begin
  v_base:=public.build_session_stimulus_target(
    p_focus,p_duration_minutes,p_readiness,p_target_region,p_progression_intent,p_policy_key
  );
  v_intent:=public.program_coach_solver_session_intent_v1(
    p_user_id,p_focus,p_duration_minutes,p_readiness,p_progression_intent
  );
  return v_base||jsonb_build_object(
    'session_intent_shadow',v_intent->>'proposed_session_intent',
    'session_intent_shadow_detail',v_intent,
    'mechanic_policy_shadow_version','mechanic-policy-shadow-v1'
  );
end;
$function$;

create or replace function public.c2_mechanic_fit_mechanic_policy_shadow_v1(
  p_mechanic_key text,
  p_stimulus jsonb,
  p_progression_intent text default null
) returns numeric
language plpgsql
stable
set search_path='public'
as $function$
declare
  m text:=upper(coalesce(p_mechanic_key,''));
  intent text:=upper(coalesce(nullif(p_stimulus->>'session_intent_shadow',''),'CLASSIC'));
  readiness text:=lower(coalesce(p_stimulus#>>'{readiness,band}',p_stimulus#>>'{readiness,raw}','normal'));
  progress text:=upper(coalesce(nullif(p_progression_intent,''),p_stimulus->>'progression_intent','MAINTAIN'));
  duration int:=coalesce(nullif(p_stimulus->>'duration_minutes','')::int,45);
  base_fit numeric:=public.c2_mechanic_fit(p_mechanic_key,p_stimulus,p_progression_intent);
  intent_fit numeric:=60;
  adjustment numeric:=0;
  result numeric;
begin
  intent_fit:=case intent
    when 'CLASSIC' then case m
      when 'CIRCUIT' then 92 when 'EMOM' then 88 when 'AMRAP' then 82 when 'FOR_TIME' then 75
      when 'HIIT' then 68 when 'LADDER' then 68 when 'PYRAMID' then 60 when 'PROGRESSIVE_INTERVAL' then 58
      when 'SETS_REPS' then 35 else 55 end
    when 'STRENGTH_QUALITY' then case m
      when 'SETS_REPS' then 98 when 'PYRAMID' then 90 when 'LADDER' then 86 when 'EMOM' then 78
      when 'CIRCUIT' then 72 when 'FOR_TIME' then 58 when 'AMRAP' then 52 when 'PROGRESSIVE_INTERVAL' then 50
      when 'HIIT' then 35 else 55 end
    when 'SKILL_DEVELOPMENT' then case m
      when 'EMOM' then 96 when 'CIRCUIT' then 92 when 'AMRAP' then 78 when 'FOR_TIME' then 72
      when 'LADDER' then 68 when 'PYRAMID' then 60 when 'SETS_REPS' then 55 when 'PROGRESSIVE_INTERVAL' then 55
      when 'HIIT' then 50 else 55 end
    when 'CONDITIONING' then case m
      when 'HIIT' then 98 when 'AMRAP' then 96 when 'FOR_TIME' then 94 when 'EMOM' then 88
      when 'PROGRESSIVE_INTERVAL' then 82 when 'CIRCUIT' then 78 when 'LADDER' then 68 when 'PYRAMID' then 50
      when 'SETS_REPS' then 25 else 55 end
    when 'CONSOLIDATE' then case m
      when 'CIRCUIT' then 96 when 'EMOM' then 92 when 'SETS_REPS' then 82 when 'PYRAMID' then 75
      when 'LADDER' then 72 when 'AMRAP' then 68 when 'FOR_TIME' then 55 when 'PROGRESSIVE_INTERVAL' then 40
      when 'HIIT' then 35 else 55 end
    else 60 end;

  if readiness in ('low','faible') then
    if m in ('CIRCUIT','EMOM') then adjustment:=adjustment+5; end if;
    if m='HIIT' then adjustment:=adjustment-12; end if;
    if m='PROGRESSIVE_INTERVAL' then adjustment:=adjustment-10; end if;
    if m='FOR_TIME' then adjustment:=adjustment-6; end if;
  elsif readiness='high' and intent='CONDITIONING' then
    if m in ('HIIT','AMRAP','FOR_TIME','PROGRESSIVE_INTERVAL') then adjustment:=adjustment+3; end if;
  end if;

  if progress='DELOAD' then
    if m='CIRCUIT' then adjustment:=adjustment+5; end if;
    if m in ('HIIT','PROGRESSIVE_INTERVAL','FOR_TIME') then adjustment:=adjustment-10; end if;
  elsif progress='EXPLORE' then
    if m in ('PROGRESSIVE_INTERVAL','LADDER','PYRAMID') then adjustment:=adjustment+5; end if;
  end if;

  if duration<=30 then
    if m in ('EMOM','AMRAP','HIIT') then adjustment:=adjustment+3; end if;
    if m in ('SETS_REPS','PYRAMID','LADDER') then adjustment:=adjustment-4; end if;
  elsif duration>=60 then
    if m in ('CIRCUIT','SETS_REPS','LADDER','PYRAMID') then adjustment:=adjustment+3; end if;
  end if;

  result:=base_fit*0.65+intent_fit*0.35+adjustment;
  return round(greatest(0,least(100,result)),2);
end;
$function$;

create or replace function public.program_coach_mechanic_policy_rank_v1(
  p_stimulus jsonb,
  p_progression_intent text default null
) returns jsonb
language sql
stable
set search_path='public'
as $function$
  select jsonb_build_object(
    'version','mechanic-policy-shadow-v1',
    'mode','SHADOW',
    'session_intent',coalesce(p_stimulus->>'session_intent_shadow','CLASSIC'),
    'apply_enabled',false,
    'ranked_mechanics',coalesce(jsonb_agg(jsonb_build_object(
      'mechanic',mechanic_key,
      'base_fit',base_fit,
      'policy_fit',policy_fit,
      'delta',round(policy_fit-base_fit,2)
    ) order by policy_fit desc,base_fit desc,mechanic_key),'[]'::jsonb),
    'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false)
  )
  from (
    select wm.mechanic_key,
      public.c2_mechanic_fit(wm.mechanic_key,p_stimulus,p_progression_intent) base_fit,
      public.c2_mechanic_fit_mechanic_policy_shadow_v1(wm.mechanic_key,p_stimulus,p_progression_intent) policy_fit
    from public.workout_mechanics wm
    where wm.active and wm.mechanic_kind='core' and wm.auto_free_eligible
  ) q;
$function$;

do $clone$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='simulate_session_engine_c2_raw'
  limit 1;
  if v_def is null then raise exception 'simulate_session_engine_c2_raw not found'; end if;
  if (length(v_def)-length(replace(v_def,'public.build_session_stimulus_target(','')))/length('public.build_session_stimulus_target(')<>1 then raise exception 'Unexpected build stimulus call count'; end if;
  if (length(v_def)-length(replace(v_def,'public.c2_mechanic_fit(','')))/length('public.c2_mechanic_fit(')<>2 then raise exception 'Unexpected mechanic fit call count'; end if;
  v_def:=replace(v_def,'public.simulate_session_engine_c2_raw(','public.simulate_session_engine_c2_raw_mechanic_policy_shadow_v1(');
  v_def:=replace(v_def,'public.build_session_stimulus_target(','public.build_session_stimulus_target_mechanic_policy_shadow_v1(p_user_id,');
  v_def:=replace(v_def,'public.c2_mechanic_fit(','public.c2_mechanic_fit_mechanic_policy_shadow_v1(');
  execute v_def;
end;
$clone$;

do $clone$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='simulate_session_engine_c2'
  limit 1;
  if v_def is null then raise exception 'simulate_session_engine_c2 not found'; end if;
  if strpos(v_def,'public.simulate_session_engine_c2_raw(')=0 then raise exception 'Raw C2 bridge not found'; end if;
  v_def:=replace(v_def,'public.simulate_session_engine_c2(','public.simulate_session_engine_c2_mechanic_policy_shadow_v1(');
  v_def:=replace(v_def,'public.simulate_session_engine_c2_raw(','public.simulate_session_engine_c2_raw_mechanic_policy_shadow_v1(');
  execute v_def;
end;
$clone$;

do $clone$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='solve_session_engine_c4_raw_v15'
  limit 1;
  if v_def is null then raise exception 'solve_session_engine_c4_raw_v15 not found'; end if;
  if strpos(v_def,'public.simulate_session_engine_c2(')=0 then raise exception 'C4 to C2 bridge not found'; end if;
  v_def:=replace(v_def,'public.solve_session_engine_c4_raw_v15(','public.solve_session_engine_c4_mechanic_policy_shadow_v1(');
  v_def:=replace(v_def,'public.simulate_session_engine_c2(','public.simulate_session_engine_c2_mechanic_policy_shadow_v1(');
  execute v_def;
end;
$clone$;

revoke all on function public.program_coach_solver_session_intent_v1(uuid,text,integer,text,text) from public,anon;
revoke all on function public.build_session_stimulus_target_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text) from public,anon;
revoke all on function public.simulate_session_engine_c2_raw_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
revoke all on function public.simulate_session_engine_c2_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.simulate_session_engine_c2_raw_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;
grant execute on function public.simulate_session_engine_c2_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer) to service_role;
grant execute on function public.program_coach_solver_session_intent_v1(uuid,text,integer,text,text) to authenticated,service_role;
grant execute on function public.build_session_stimulus_target_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text) to authenticated,service_role;
grant execute on function public.c2_mechanic_fit_mechanic_policy_shadow_v1(text,jsonb,text) to authenticated,service_role;
grant execute on function public.program_coach_mechanic_policy_rank_v1(jsonb,text) to authenticated,service_role;
revoke all on function public.solve_session_engine_c4_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) from public,anon;
grant execute on function public.solve_session_engine_c4_mechanic_policy_shadow_v1(uuid,text,integer,text,text,text,text[],jsonb,integer,text,integer,integer,text) to authenticated,service_role;
