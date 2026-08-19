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
  select case when v_session.planning_context_json->>'session_source'='external_import' then 'external_import' else 'internal' end,i.id
  into v_source,v_import_id from public.external_session_imports i where i.committed_session_id=p_session_id limit 1;
  if v_session.planning_context_json->>'session_source'='external_import' then v_source:='external_import'; end if;
  begin v_global_factor:=public.d_session_execution_factor_v2(p_session_id); exception when others then v_global_factor:=case when v_session.status='completed' then 1 else 0 end; end;
  delete from public.session_stimulus_ledger where session_id=p_session_id and stimulus_type='pattern' and metadata_json->>'source'='rolling-pattern-exposure-v1';
  with eligible as (
    select wse.id,wse.exercise_id,wse.block_key,wse.position,wse.duration_seconds,wse.user_execution_status,wse.status,e.movement_pattern,case when wse.block_key='skill' then 1.25::numeric else 1.0::numeric end block_multiplier
    from public.workout_session_exercises wse join public.exercises e on e.id=wse.exercise_id
    where wse.session_id=p_session_id and nullif(e.movement_pattern,'') is not null and wse.block_key not in ('unlock','warmup','warm_up','tabata','core')
  ), block_meta as (
    select b->>'block_key' block_key,coalesce(nullif(b->>'duration_minutes','')::numeric,0) duration_minutes from jsonb_array_elements(coalesce(v_session.generated_workout->'blocks','[]'::jsonb)) b
  ), counts as (select block_key,count(*)::numeric n from eligible group by block_key), base as (
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
revoke all on function public.d_sync_session_pattern_ledger_v1(uuid) from public,anon,authenticated;
grant execute on function public.d_sync_session_pattern_ledger_v1(uuid) to service_role;

create or replace function public.program_coach_pattern_exposure_shadow_v1(p_user_id uuid,p_anchor_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_anchor date:=coalesce(p_anchor_date,current_date); v_rows jsonb:='[]'::jsonb; v_total7 numeric:=0; v_total10 numeric:=0; v_total28 numeric:=0; v_dominant jsonb:='[]'::jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then raise exception 'Forbidden user'; end if;
  with a as (
    select stimulus_key movement_pattern,sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-6 and v_anchor) exposure_7d,sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-9 and v_anchor) exposure_10d,sum(coalesce(realized_value,0)) filter(where occurred_at::date between v_anchor-27 and v_anchor) exposure_28d,count(distinct session_id) filter(where occurred_at::date between v_anchor-9 and v_anchor and coalesce(realized_value,0)>0) sessions_10d
    from public.session_stimulus_ledger where user_id=p_user_id and stimulus_type='pattern' and metadata_json->>'ledger_role'='realized' and metadata_json->>'source'='rolling-pattern-exposure-v1' and occurred_at::date between v_anchor-27 and v_anchor group by stimulus_key
  ), totals as (select coalesce(sum(exposure_7d),0) t7,coalesce(sum(exposure_10d),0) t10,coalesce(sum(exposure_28d),0) t28 from a), scored as (
    select a.*,case when t.t7>0 then a.exposure_7d/t.t7 else 0 end share_7d,case when t.t10>0 then a.exposure_10d/t.t10 else 0 end share_10d,case when t.t28>0 then a.exposure_28d/t.t28 else 0 end share_28d,case when t.t10>0 and a.exposure_10d>=12 and a.exposure_10d/t.t10>=0.35 then 'HIGH' when t.t10>0 and a.exposure_10d>=8 and a.exposure_10d/t.t10>=0.22 then 'MEDIUM' else 'LOW' end recent_pressure from a cross join totals t
  )
  select t7,t10,t28,coalesce((select jsonb_agg(jsonb_build_object('movement_pattern',movement_pattern,'exposure_7d',round(exposure_7d,2),'exposure_10d',round(exposure_10d,2),'exposure_28d',round(exposure_28d,2),'share_7d',round(share_7d,4),'share_10d',round(share_10d,4),'share_28d',round(share_28d,4),'sessions_10d',sessions_10d,'recent_pressure',recent_pressure,'recent_vs_28d_share_delta',round(share_10d-share_28d,4)) order by exposure_10d desc,movement_pattern) from scored),'[]'::jsonb),coalesce((select jsonb_agg(jsonb_build_object('movement_pattern',movement_pattern,'share_10d',round(share_10d,4),'exposure_10d',round(exposure_10d,2),'recent_pressure',recent_pressure) order by share_10d desc,movement_pattern) from scored where recent_pressure='HIGH'),'[]'::jsonb)
  into v_total7,v_total10,v_total28,v_rows,v_dominant from totals;
  return jsonb_build_object('version','rolling-pattern-exposure-shadow-v1','mode','SHADOW','status',case when v_total28>0 then 'AVAILABLE' else 'INSUFFICIENT_HISTORY' end,'anchor_date',v_anchor,'totals',jsonb_build_object('7d',round(v_total7,2),'10d',round(v_total10,2),'28d',round(v_total28,2)),'pattern_exposure',v_rows,'high_recent_pressure_patterns',v_dominant,'semantics',jsonb_build_object('realized_training_only',true,'skill_multiplier',1.25,'warmup_unlock_tabata_excluded',true,'external_and_internal_sessions_share_same_ledger',true,'recent_pressure_is_soft_not_injury_risk',true,'not_equal_distribution_target',true),'authority',jsonb_build_object('shadow_only',true,'may_change_session_decision',false,'may_change_exercise_selection',false));
end;
$$;
revoke all on function public.program_coach_pattern_exposure_shadow_v1(uuid,date) from public,anon;
grant execute on function public.program_coach_pattern_exposure_shadow_v1(uuid,date) to authenticated,service_role;

create or replace function public.d_sync_session_stimulus_ledger(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_base jsonb; v_factor numeric; v_source text:='internal'; v_import_id uuid:=null; v_pattern jsonb:='{}'::jsonb;
begin
  v_base:=public.d_sync_session_stimulus_ledger_pre_m89(p_session_id); v_factor:=public.d_session_execution_factor_v2(p_session_id);
  select case when ws.planning_context_json->>'session_source'='external_import' then 'external_import' else 'internal' end,i.id into v_source,v_import_id from public.workout_sessions ws left join public.external_session_imports i on i.committed_session_id=ws.id where ws.id=p_session_id;
  update public.session_stimulus_ledger r set realized_value=p.planned_value*v_factor,metadata_json=coalesce(r.metadata_json,'{}'::jsonb)||jsonb_build_object('execution_factor',round(v_factor,4),'execution_factor_version','m8.9-block-duration-plus-protocol-v1') from public.session_stimulus_ledger p where r.session_id=p_session_id and p.session_id=p_session_id and r.metadata_json->>'ledger_role'='realized' and p.metadata_json->>'ledger_role'='planned' and r.stimulus_type='focus' and p.stimulus_type=r.stimulus_type and p.stimulus_key=r.stimulus_key and p.unit=r.unit;
  update public.session_stimulus_ledger set metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('execution_factor',round(v_factor,4),'execution_factor_version','m8.9-block-duration-plus-protocol-v1','session_source',v_source),source_kind=v_source,external_import_id=case when v_source='external_import' then v_import_id else null end where session_id=p_session_id;
  begin v_pattern:=public.d_sync_session_pattern_ledger_v1(p_session_id); exception when others then v_pattern:=jsonb_build_object('status','ERROR','version','rolling-pattern-exposure-v1','error',sqlerrm,'decision_authority',false); end;
  return v_base||jsonb_build_object('version','d1-stimulus-ledger-m89-pattern-v1','execution_factor',round(v_factor,4),'execution_factor_contract','block_duration_weighted_with_protocol_actual','source_kind',v_source,'external_import_id',v_import_id,'pattern_exposure_ledger',v_pattern);
end;
$$;