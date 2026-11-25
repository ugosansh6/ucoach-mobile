create or replace function public.d_sync_session_pattern_ledger_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.workout_sessions%rowtype;
  v_source text:='internal';
  v_import_id uuid:=null;
  v_global_factor numeric:=1;
  v_inserted_planned int:=0;
  v_inserted_realized int:=0;
begin
  select * into v_session from public.workout_sessions where id=p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if auth.uid() is not null and auth.uid()<>v_session.user_id then raise exception 'Cannot sync another user session pattern ledger'; end if;
  select case when ws.planning_context_json->>'session_source'='external_import' then 'external_import' else 'internal' end,i.id
  into v_source,v_import_id
  from public.workout_sessions ws left join public.external_session_imports i on i.committed_session_id=ws.id
  where ws.id=p_session_id;
  v_source:=coalesce(v_source,'internal');
  begin v_global_factor:=public.d_session_execution_factor_v2(p_session_id); exception when others then v_global_factor:=case when v_session.status='completed' then 1 else 0 end; end;
  delete from public.session_stimulus_ledger where session_id=p_session_id and stimulus_type='pattern' and metadata_json->>'source'='rolling-pattern-exposure-v1';
  with eligible as (
    select wse.id,wse.exercise_id,wse.block_key,wse.position,wse.duration_seconds,wse.user_execution_status,wse.status,e.movement_pattern,case when wse.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
    from public.workout_session_exercises wse join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=p_session_id and nullif(e.movement_pattern,'') is not null and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
  ), block_meta as (select b->>'block_key' block_key,coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b), counts as (select block_key,count(*)::numeric n from eligible group by block_key), base as (
    select el.*,case when coalesce(bm.duration_minutes,0)>0 then (bm.duration_minutes/coalesce(c.n,1))*el.block_multiplier when coalesce(el.duration_seconds,0)>0 then (el.duration_seconds::numeric/60.0)*el.block_multiplier else (coalesce(v_session.duration_minutes,45)::numeric/greatest(count(*) over()::numeric,1))*el.block_multiplier end planned_exposure,
      case lower(coalesce(el.user_execution_status,el.status,'')) when 'completed' then 1.0::numeric when 'adapted' then 0.70::numeric when 'not_completed' then 0::numeric when 'skipped' then 0::numeric else greatest(0,least(coalesce(v_global_factor,0),1)) end execution_factor
    from eligible el left join block_meta bm on bm.block_key=el.block_key left join counts c on c.block_key=el.block_key
  ), agg as (select movement_pattern,sum(planned_exposure) planned_exposure,count(*)::int exercise_instances from base group by movement_pattern)
  insert into public.session_stimulus_ledger(user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at,external_import_id)
  select v_session.user_id,p_session_id,v_source,'pattern',movement_pattern,planned_exposure,null,'weighted_minute',jsonb_build_object('source','rolling-pattern-exposure-v1','ledger_role','planned','exercise_instances',exercise_instances,'skill_exposure_multiplier',1.25,'warmup_unlock_tabata_excluded',true,'session_source',v_source),coalesce(v_session.generated_at,v_session.created_at,now()),case when v_source='external_import' then v_import_id else null end from agg;
  get diagnostics v_inserted_planned=row_count;
  if v_session.status='completed' then
    with eligible as (
      select wse.id,wse.exercise_id,wse.block_key,wse.position,wse.duration_seconds,wse.user_execution_status,wse.status,e.movement_pattern,case when wse.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
      from public.workout_session_exercises wse join public.exercises e on e.id=wse.exercise_id where wse.session_id=p_session_id and nullif(e.movement_pattern,'') is not null and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
    ), block_meta as (select b->>'block_key' block_key,coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b), counts as (select block_key,count(*)::numeric n from eligible group by block_key), base as (
      select el.*,case when coalesce(bm.duration_minutes,0)>0 then (bm.duration_minutes/coalesce(c.n,1))*el.block_multiplier when coalesce(el.duration_seconds,0)>0 then (el.duration_seconds::numeric/60.0)*el.block_multiplier else (coalesce(v_session.duration_minutes,45)::numeric/greatest(count(*) over()::numeric,1))*el.block_multiplier end planned_exposure,
        case lower(coalesce(el.user_execution_status,el.status,'')) when 'completed' then 1.0::numeric when 'adapted' then 0.70::numeric when 'not_completed' then 0::numeric when 'skipped' then 0::numeric else greatest(0,least(coalesce(v_global_factor,0),1)) end execution_factor
      from eligible el left join block_meta bm on bm.block_key=el.block_key left join counts c on c.block_key=el.block_key
    ), agg as (select movement_pattern,sum(planned_exposure*execution_factor) realized_exposure,count(*)::int exercise_instances,round(avg(execution_factor),4) mean_execution_factor from base group by movement_pattern)
    insert into public.session_stimulus_ledger(user_id,session_id,source_kind,stimulus_type,stimulus_key,planned_value,realized_value,unit,metadata_json,occurred_at,external_import_id)
    select v_session.user_id,p_session_id,v_source,'pattern',movement_pattern,0,realized_exposure,'weighted_minute',jsonb_build_object('source','rolling-pattern-exposure-v1','ledger_role','realized','exercise_instances',exercise_instances,'mean_execution_factor',mean_execution_factor,'skill_exposure_multiplier',1.25,'warmup_unlock_tabata_excluded',true,'session_source',v_source),coalesce(v_session.completed_at,v_session.updated_at,now()),case when v_source='external_import' then v_import_id else null end from agg;
    get diagnostics v_inserted_realized=row_count;
  end if;
  return jsonb_build_object('status','OK','version','rolling-pattern-exposure-v1','session_id',p_session_id,'source_kind',v_source,'planned_pattern_rows',v_inserted_planned,'realized_pattern_rows',v_inserted_realized,'skill_multiplier',1.25,'warmup_unlock_tabata_excluded',true,'decision_authority',false);
end;
$$;