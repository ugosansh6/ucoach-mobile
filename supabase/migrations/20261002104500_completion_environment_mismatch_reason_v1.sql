-- Completion UX V1: allow an environment-related execution reason.
-- This reason remains contextual: it explains why work was adapted/not completed
-- and must never be interpreted as athlete capability evidence.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='complete_workout_session_v1_pre_block_filter'
  limit 1;

  if v_def is null then
    raise exception 'complete_workout_session_v1_pre_block_filter not found';
  end if;

  v_def := replace(
    v_def,
    '''TECHNIQUE_DIFFICULTY'',''LOAD_TOO_HEAVY'',''FATIGUE'',''PAIN_DISCOMFORT'',''EQUIPMENT'',''TIME'',''OTHER''',
    '''TECHNIQUE_DIFFICULTY'',''LOAD_TOO_HEAVY'',''FATIGUE'',''PAIN_DISCOMFORT'',''EQUIPMENT'',''TIME'',''ENVIRONMENT_MISMATCH'',''OTHER'''
  );

  v_def := replace(
    v_def,
    '''MOVEMENT_FAILURE'',''FATIGUE'',''PAIN_DISCOMFORT'',''TIME'',''MOTIVATION'',''EQUIPMENT'',''OTHER''',
    '''MOVEMENT_FAILURE'',''FATIGUE'',''PAIN_DISCOMFORT'',''TIME'',''MOTIVATION'',''EQUIPMENT'',''ENVIRONMENT_MISMATCH'',''OTHER'''
  );

  execute v_def;
end;
$$;

create or replace function public.coach_normalize_reason_code_v1(p_code text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case upper(trim(coalesce(p_code,'')))
    when 'WOD_ALREADY_STARTED' then 'WOD_ALREADY_STARTED'
    when 'FORMAT_CHANGE_LIMIT_REACHED' then 'FORMAT_CHANGE_LIMIT_REACHED'
    when 'SESSION_NOT_FOUND' then 'SESSION_NOT_FOUND'
    when 'PREMIUM_REQUIRED' then 'PREMIUM_REQUIRED'
    when 'NO_SAFE_CURATED_SKILL_PATH' then 'NO_SAFE_CURATED_SKILL_PATH'
    when 'INSUFFICIENT_UNALLOCATED_TIME' then 'INSUFFICIENT_UNALLOCATED_TIME'
    when 'NO_SAFE_SWAP' then 'NO_SAFE_SWAP'
    when 'EQUIPMENT' then 'EQUIPMENT_MISSING'
    when 'MATERIAL' then 'EQUIPMENT_MISSING'
    when 'EQUIPMENT_MISSING' then 'EQUIPMENT_MISSING'
    when 'EQUIPMENT_INCOMPATIBLE' then 'EQUIPMENT_MISSING'
    when 'ENVIRONMENT' then 'ENVIRONMENT_MISMATCH'
    when 'ENVIRONMENT_MISMATCH' then 'ENVIRONMENT_MISMATCH'
    when 'PAIN' then 'PAIN_OR_INJURY'
    when 'PAIN_DISCOMFORT' then 'PAIN_OR_INJURY'
    when 'INJURY' then 'PAIN_OR_INJURY'
    when 'UNSAFE_FOR_ZONE' then 'PAIN_OR_INJURY'
    when 'TECHNICAL_LEVEL' then 'TECHNICAL_LEVEL'
    when 'TECHNICAL_LEVEL_TOO_HIGH' then 'TECHNICAL_LEVEL'
    when 'COMPLEXITY_TOO_HIGH' then 'TECHNICAL_LEVEL'
    when 'CAPABILITY_NOT_CONFIRMED' then 'CAPABILITY_NOT_CONFIRMED'
    when 'DELOAD' then 'DELOAD_GUARD'
    when 'DELOAD_GUARD' then 'DELOAD_GUARD'
    when 'WORKLOAD_TOO_HIGH' then 'WORKLOAD_TOO_HIGH'
    when 'ATHLETE_WORKLOAD_EXCEEDED' then 'WORKLOAD_TOO_HIGH'
    when 'DURATION_INCOMPATIBLE' then 'DURATION_INCOMPATIBLE'
    when 'TIME_BUDGET' then 'DURATION_INCOMPATIBLE'
    when 'NO_SAFE_TIME_BUDGET' then 'DURATION_INCOMPATIBLE'
    when 'MECHANIC_INCOMPATIBLE' then 'MECHANIC_INCOMPATIBLE'
    when 'NOT_RECOMMENDED' then 'MECHANIC_INCOMPATIBLE'
    else upper(trim(coalesce(p_code,'')))
  end;
$$;
