-- BUILD-013 / GYM-008: exact gym set actuals must drive longitudinal exposure.
-- Reuses the existing execution semantics: completed=1, adapted=.70, not_completed=0.

create or replace function public.session_exercise_execution_factor_v2(
  p_session_id uuid,
  p_session_exercise_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_status text;
  v_summary jsonb;
  v_recorded numeric;
  v_completed numeric;
  v_adapted numeric;
begin
  select ws.user_id, lower(coalesce(wse.user_execution_status,wse.status,''))
  into v_user_id,v_status
  from public.workout_session_exercises wse
  join public.workout_sessions ws on ws.id=wse.session_id
  where wse.session_id=p_session_id and wse.id=p_session_exercise_id;

  if v_user_id is null then return 0; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  select el.actual_json->'gym_set_summary'
  into v_summary
  from public.exercise_logs el
  where el.session_id=p_session_id and el.session_exercise_id=p_session_exercise_id
  order by el.created_at desc,el.id desc
  limit 1;

  if jsonb_typeof(v_summary)='object' then
    v_recorded:=coalesce(public.jsonb_num(v_summary,'recorded_set_count'),0);
    v_completed:=coalesce(public.jsonb_num(v_summary,'completed_set_count'),0);
    v_adapted:=coalesce(public.jsonb_num(v_summary,'adapted_set_count'),0);
    if v_recorded>0 then
      return greatest(0,least(1,(v_completed+(0.70*v_adapted))/v_recorded));
    end if;
  end if;

  return case v_status
    when 'completed' then 1.0
    when 'adapted' then 0.70
    when 'not_completed' then 0.0
    when 'skipped' then 0.0
    else 0.0
  end;
end;
$function$;

revoke execute on function public.session_exercise_execution_factor_v2(uuid,uuid) from public, anon;
grant execute on function public.session_exercise_execution_factor_v2(uuid,uuid) to authenticated;

create or replace function public.session_original_block_execution_factor_v1(p_session_id uuid, p_block_key text)
returns numeric
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_key text:=lower(coalesce(p_block_key,''));
  v_factor numeric;
  v_rows int;
  v_planned_seconds numeric;
  v_actual_seconds numeric;
begin
  select user_id into v_user_id from public.workout_sessions where id=p_session_id;
  if v_user_id is null then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_user_id then raise exception 'Forbidden user'; end if;

  select count(*),coalesce(avg(public.session_exercise_execution_factor_v2(p_session_id,wse.id)),0)
  into v_rows,v_factor
  from public.workout_session_exercises wse
  where wse.session_id=p_session_id
    and lower(coalesce(wse.solver_decision_json->>'gym_block_key',wse.solver_decision_json->>'outdoor_block_key',''))=v_key;

  if v_rows=0 then return null; end if;

  if v_key='cardio' then
    select sum(coalesce(nullif(wse.prescription_json->>'block_duration_minutes','')::numeric,0)*60),
           sum(coalesce(wse.duration_seconds,0))
    into v_planned_seconds,v_actual_seconds
    from public.workout_session_exercises wse
    where wse.session_id=p_session_id
      and lower(coalesce(wse.solver_decision_json->>'gym_block_key',''))='cardio'
      and coalesce(wse.user_execution_status,'pending') in ('completed','adapted');
    if coalesce(v_planned_seconds,0)>0 and coalesce(v_actual_seconds,0)>0 then
      v_factor:=least(v_factor,least(1,v_actual_seconds/v_planned_seconds));
    end if;
  end if;

  return greatest(0,least(1,coalesce(v_factor,0)));
end;
$function$;

-- Keep the proven running/status ledger intact and post-correct only realized
-- pattern exposure when exact gym-set evidence exists.
alter function public.d_sync_session_pattern_ledger_v1(uuid)
  rename to d_sync_session_pattern_ledger_v1_pre_exact_gym_sets;

create or replace function public.d_sync_session_pattern_ledger_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_base jsonb;
  v_session public.workout_sessions%rowtype;
  v_has_exact_sets boolean:=false;
  v_corrected int:=0;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Cannot sync another user session pattern ledger'; end if;

  v_base:=public.d_sync_session_pattern_ledger_v1_pre_exact_gym_sets(p_session_id);

  select exists(
    select 1 from public.exercise_logs el
    where el.session_id=p_session_id
      and jsonb_typeof(el.actual_json->'gym_set_summary')='object'
      and coalesce(public.jsonb_num(el.actual_json->'gym_set_summary','recorded_set_count'),0)>0
  ) into v_has_exact_sets;

  if not v_has_exact_sets or v_session.status<>'completed' then
    return v_base||jsonb_build_object(
      'gym_exact_set_actual_applied',false,
      'gym_exact_set_contract','gym-set-longitudinal-factor-v1'
    );
  end if;

  with eligible_raw as (
    select wse.id,wse.exercise_id,wse.block_key,wse.duration_seconds,wse.solver_decision_json,
           e.movement_pattern,
           lower(coalesce(
             nullif(wse.solver_decision_json->>'gym_block_key',''),
             nullif(wse.solver_decision_json->>'outdoor_block_key',''),
             case upper(coalesce(wse.solver_decision_json->>'module_code',''))
               when 'STRENGTH' then 'strength'
               when 'CARDIO' then 'cardio'
               when 'CONDITIONING' then 'conditioning'
               when 'GYM' then 'gym'
               when 'STREET_GYM' then 'street_gym'
               when 'SKILL' then 'skill'
               when 'WOD' then 'wod'
               else null
             end,
             wse.block_key
           )) runtime_block_key
    from public.workout_session_exercises wse
    join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=p_session_id
      and nullif(e.movement_pattern,'') is not null
      and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
  ), eligible as (
    select er.*,
           case when er.runtime_block_key='skill' or er.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
    from eligible_raw er
  ), block_meta as (
    select lower(b->>'block_key') runtime_block_key,
           coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes
    from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
  ), counts as (
    select runtime_block_key,count(*)::numeric n from eligible group by runtime_block_key
  ), exposure as (
    select el.movement_pattern,
           case
             when coalesce(bm.duration_minutes,0)>0 then (bm.duration_minutes/coalesce(c.n,1))*el.block_multiplier
             when coalesce(el.duration_seconds,0)>0 then (el.duration_seconds::numeric/60.0)*el.block_multiplier
             else (coalesce(v_session.duration_minutes,45)::numeric/greatest(count(*) over()::numeric,1))*el.block_multiplier
           end planned_exposure,
           public.session_exercise_execution_factor_v2(p_session_id,el.id) execution_factor
    from eligible el
    left join block_meta bm on bm.runtime_block_key=el.runtime_block_key
    left join counts c on c.runtime_block_key=el.runtime_block_key
  ), agg as (
    select movement_pattern,
           sum(planned_exposure*execution_factor) realized_exposure,
           round(avg(execution_factor),4) mean_execution_factor
    from exposure group by movement_pattern
  )
  update public.session_stimulus_ledger l
  set realized_value=a.realized_exposure,
      metadata_json=coalesce(l.metadata_json,'{}'::jsonb)||jsonb_build_object(
        'gym_exact_set_actual_applied',true,
        'gym_exact_set_contract','gym-set-longitudinal-factor-v1',
        'mean_execution_factor',a.mean_execution_factor
      )
  from agg a
  where l.session_id=p_session_id
    and l.stimulus_type='pattern'
    and l.stimulus_key=a.movement_pattern
    and l.metadata_json->>'ledger_role'='realized'
    and l.metadata_json->>'source'='rolling-pattern-exposure-v1';
  get diagnostics v_corrected=row_count;

  return v_base||jsonb_build_object(
    'gym_exact_set_actual_applied',true,
    'gym_exact_set_contract','gym-set-longitudinal-factor-v1',
    'gym_exact_set_corrected_pattern_rows',v_corrected
  );
end;
$function$;

revoke execute on function public.d_sync_session_pattern_ledger_v1(uuid) from public, anon;
grant execute on function public.d_sync_session_pattern_ledger_v1(uuid) to authenticated;